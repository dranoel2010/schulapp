import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { homework, subjects } from "@/db/schema";
import { aufgabeImArchiv } from "@/lib/kombi/archiv";
import { createHomework, setHomeworkDone } from "@/lib/homework";
import { berlinZeitpunkt } from "@/lib/tag";
import { recallAttempts, recallItems, recallSchedule } from "@/recall/schema";
import { urteilFesthalten } from "@/recall/sessions";

/**
 * Der Erledigt-Zeitpunkt (`done_at`) kommt von der App-Uhr (`jetzt()`, mit
 * Testuhr die Testuhr), nicht von der Uhr des Rechners. Sonst stimmen bei
 * einem Durchlauf über mehrere Tage mit der Testuhr „Erledigt“, das Archiv
 * nach zwei Tagen und der Dauertakt nicht.
 */

let nutzer = "";
let fach = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Erledigt-Uhr");
  const [f] = await testDb.insert(subjects).values({ userId: nutzer, name: "Englisch", short: "E" }).returning({ id: subjects.id });
  fach = f.id;
});

describe("done_at mit der App-Uhr", () => {
  it("Abhaken schreibt den Zeitpunkt der übergebenen Uhr, Wiederöffnen leert ihn", async () => {
    const id = await createHomework(nutzer, { subjectId: fach, title: "Workbook p. 12", dueDate: "2026-10-20", details: "" } as never);
    const testuhr = berlinZeitpunkt("2026-10-20", "16:30");
    await setHomeworkDone(nutzer, id, true, testuhr);
    const [a] = await testDb.select().from(homework).where(eq(homework.id, id));
    assert.equal(a.doneAt?.toISOString(), testuhr.toISOString());
    // zwei Tage später nach der Testuhr im Archiv, am Tag danach noch nicht
    const iso = a.doneAt!.toISOString();
    assert.equal(aufgabeImArchiv({ done: true, doneAt: iso }, berlinZeitpunkt("2026-10-21", "16:30").getTime()), false);
    assert.equal(aufgabeImArchiv({ done: true, doneAt: iso }, berlinZeitpunkt("2026-10-23", "16:31").getTime()), true);
    await setHomeworkDone(nutzer, id, false, testuhr);
    const [b] = await testDb.select().from(homework).where(eq(homework.id, id));
    assert.equal(b.doneAt, null);
  });

  it("ohne Testuhr gilt die Uhr des Rechners", async () => {
    const id = await createHomework(nutzer, { subjectId: fach, title: "Vokabeln", dueDate: "2026-10-20", details: "" } as never);
    const vor = Date.now();
    await setHomeworkDone(nutzer, id, true);
    const [a] = await testDb.select().from(homework).where(eq(homework.id, id));
    assert.ok(a.doneAt && a.doneAt.getTime() >= vor - 1000 && a.doneAt.getTime() <= Date.now() + 1000);
  });

  it("„Saß“ schließt den Termin mit dem Zeitpunkt der App-Uhr", async () => {
    const [i] = await testDb
      .insert(recallItems)
      .values({ userId: nutzer, subjectId: fach, promptFree: "Frage", solution: "Lösung", misconception: "x", sourceQuote: "Zitat", sourceLength: 6 })
      .returning({ id: recallItems.id });
    const [t] = await testDb.insert(recallSchedule).values({ itemId: i.id, dueOn: "2026-10-20", round: 1, sortOrder: 0 }).returning({ id: recallSchedule.id });
    const [v] = await testDb
      .insert(recallAttempts)
      .values({ userId: nutzer, itemId: i.id, scheduleId: t.id, answeredOn: "2026-10-20", gapDays: 3, answerText: "Antwort", correct: false })
      .returning({ id: recallAttempts.id });
    const testuhr = berlinZeitpunkt("2026-10-20", "18:05");
    assert.deepEqual(await urteilFesthalten(nutzer, v.id, true, testuhr), { ok: true, wiederholt: false });
    const [z] = await testDb.select().from(recallSchedule).where(eq(recallSchedule.id, t.id));
    assert.equal(z.doneAt?.toISOString(), testuhr.toISOString());
  });

  it("keine Schreibstelle setzt done_at mit der Uhr des Rechners", () => {
    const dateien: string[] = [];
    const lauf = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) lauf(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) dateien.push(p);
      }
    };
    lauf(join(process.cwd(), "src"));
    const muster = /doneAt:\s*(?:[^,}]*\?\s*)?new Date\(\)|done_at\s*=\s*now\(\)/;
    const treffer = dateien.filter((d) => muster.test(readFileSync(d, "utf8")));
    assert.deepEqual(treffer, []);
  });
});
