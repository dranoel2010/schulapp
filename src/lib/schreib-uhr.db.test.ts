import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { materials, subjects } from "@/db/schema";
import { markFiled } from "@/lib/inbox";
import { berlinZeitpunkt } from "@/lib/tag";
import { recallAttempts, recallItems, recallSchedule } from "@/recall/schema";
import { versuchFesthalten } from "@/recall/sessions";

/**
 * `answered_at` der Versuche, die Lernblock-Uhr und `filed_at` im
 * Eingangskorb kommen von der App-Uhr (`jetzt()`, mit Testuhr die Testuhr).
 * Der Abrufkern importiert `jetzt()` nicht (grenzen.test.ts): die Uhr reicht
 * der Aufrufer herein.
 */

let nutzer = "";
let fach = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Schreib-Uhr");
  const [f] = await testDb.insert(subjects).values({ userId: nutzer, name: "Englisch", short: "E" }).returning({ id: subjects.id });
  fach = f.id;
});

const ohneKommentare = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function quellen(): string[] {
  const dateien: string[] = [];
  const lauf = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) lauf(p);
      else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) dateien.push(p);
    }
  };
  lauf(join(process.cwd(), "src"));
  return dateien;
}

describe("Schreibwege mit der App-Uhr", () => {
  it("ein Versuch trägt answered_at und answered_on der übergebenen Uhr", async () => {
    const [i] = await testDb
      .insert(recallItems)
      .values({ userId: nutzer, subjectId: fach, promptFree: "Frage", solution: "Lösung", misconception: "x", sourceQuote: "Zitat", sourceLength: 6 })
      .returning({ id: recallItems.id });
    const [t] = await testDb.insert(recallSchedule).values({ itemId: i.id, dueOn: "2026-10-20", round: 1, sortOrder: 0 }).returning({ id: recallSchedule.id });
    const testuhr = berlinZeitpunkt("2026-10-20", "18:05");
    const r = await versuchFesthalten(nutzer, { scheduleId: t.id, itemId: i.id, answerText: "Antwort" }, "2026-10-20", testuhr);
    assert.ok(r.ok);
    const [v] = await testDb.select().from(recallAttempts).where(eq(recallAttempts.id, r.attemptId));
    assert.equal(v.answeredAt.toISOString(), testuhr.toISOString());
    assert.equal(v.answeredOn, "2026-10-20");
  });

  it("Abhaken im Eingangskorb schreibt filed_at der übergebenen Uhr, ein gesetzter bleibt", async () => {
    const [m] = await testDb.insert(materials).values({ userId: nutzer, subjectId: fach, title: "Workbook", capturedOn: "2026-10-20" }).returning({ id: materials.id });
    const testuhr = berlinZeitpunkt("2026-10-20", "16:30");
    assert.equal(await markFiled(nutzer, m.id, true, testuhr), "gesetzt");
    const [a] = await testDb.select().from(materials).where(eq(materials.id, m.id));
    assert.equal(a.filedAt?.toISOString(), testuhr.toISOString());
    assert.equal(await markFiled(nutzer, m.id, true, berlinZeitpunkt("2026-10-22", "09:00")), "unveraendert");
    const [b] = await testDb.select().from(materials).where(eq(materials.id, m.id));
    assert.equal(b.filedAt?.toISOString(), testuhr.toISOString());
    assert.equal(await markFiled(nutzer, m.id, false, testuhr), "gesetzt");
    const [c] = await testDb.select().from(materials).where(eq(materials.id, m.id));
    assert.equal(c.filedAt, null);
  });

  it("keine Schreibstelle setzt filed_at mit der Uhr des Rechners", () => {
    const muster = /filedAt:\s*(?:[^,}]*\?\s*)?new Date\(\)|filed_at\s*=\s*now\(\)/;
    assert.deepEqual(quellen().filter((d) => muster.test(readFileSync(d, "utf8"))), []);
  });

  it("jeder neue Versuch setzt answered_at selbst", () => {
    const treffer = quellen().filter((d) => /\.insert\(recallAttempts\)/.test(readFileSync(d, "utf8")));
    assert.ok(treffer.length > 0);
    for (const d of treffer) assert.match(readFileSync(d, "utf8"), /answeredAt:\s*now/, d);
  });

  it("Versuch und Lernblock-Uhr in den Actions kommen von jetzt()", () => {
    for (const datei of ["lernblock-actions.ts", "wiederholen-actions.ts", join("abruf", "actions.ts")]) {
      const code = readFileSync(join(process.cwd(), "src", "app", "(app)", datei), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(code, /new Date\(\)/, datei);
      if (datei !== join("abruf", "actions.ts")) assert.doesNotMatch(code, /todayInBerlin\(\)/, datei);
    }
  });

  it("Jev ordnet mit der Uhr des Aufrufers ein", () => {
    const aufrufe = quellen().flatMap((d) => [...ohneKommentare(readFileSync(d, "utf8")).matchAll(/\bautoFile\(([^)]*)\)/g)].map((t) => [d, t[1]] as const));
    const echte = aufrufe.filter(([d]) => !d.endsWith("auto-file.ts"));
    assert.ok(echte.length >= 2);
    for (const [d, args] of echte) assert.equal(args.split(",").length, 3, `${d}: autoFile(${args})`);
  });
});
