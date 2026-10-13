import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { homework } from "@/db/schema";
import { createExam } from "@/lib/exams";
import { createHomework, setHomeworkDone } from "@/lib/homework";
import { createSubject } from "@/lib/subjects";
import { berlinZeitpunkt } from "@/lib/tag";

import { archivSeite } from "./archiv";
import { hausaufgabenSeite } from "./hausaufgaben";
import { klausurenSeite } from "./klausur";

/**
 * Antwort 11 gegen den Harness: Klausuren bis Tag 14 nach dem Klausurtag in
 * der Liste (unten, jüngste zuerst), ab Tag 15 im Archiv; erledigte Aufgaben
 * zwei Tage unter „Erledigt“, danach im Archiv. Nichts wird gelöscht.
 */

let nutzer = "";

/** Die Uhr der Loader: Berliner Wanduhrzeit */
const um = (tag: string, hhmm = "15:00") => berlinZeitpunkt(tag, hhmm);

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Archiv");
  const fach = await createSubject(nutzer, {
    name: "Mathematik",
    short: "Ma",
    color: "blue",
    teacher: null,
    room: null,
    weightWritten: 60,
  } as never);
  for (const [title, date] of [
    ["Am Ersten", "2026-10-01"],
    ["Am Zweiten", "2026-10-02"],
    ["Kommend", "2026-10-20"],
    ["Heute", "2026-10-15"],
  ] as const) {
    await createExam(nutzer, { subjectId: fach.id, title, kind: "klausur", date, leadDays: 5, minutesPerDay: 25, notes: null });
  }
  const erledigt: [string, string][] = [
    ["eben erledigt", "2026-10-14T13:00:00Z"],
    ["vor drei Tagen erledigt", "2026-10-12T10:00:00Z"],
    ["vor drei Wochen erledigt", "2026-09-24T10:00:00Z"],
  ];
  await createHomework(nutzer, { subjectId: fach.id, title: "offen", dueDate: "2026-10-20" });
  for (const [title, doneAt] of erledigt) {
    const id = await createHomework(nutzer, { subjectId: fach.id, title, dueDate: "2026-10-12" });
    await setHomeworkDone(nutzer, id, true);
    await testDb.update(homework).set({ doneAt: new Date(doneAt) }).where(eq(homework.id, id));
  }
});

describe("Archiv: Klausuren", () => {
  it("Tag 14: vergangene unten, die jüngste zuerst, nichts im Archiv", async () => {
    const d = await klausurenSeite(nutzer, um("2026-10-15"));
    assert.deepEqual(
      d.klausuren.map((k) => `${k.thema} ${k.vorbei ? "vorbei" : "kommt"}`),
      ["Heute kommt", "Kommend kommt", "Am Zweiten vorbei", "Am Ersten vorbei"],
    );
    assert.equal(d.archiv, 0);
    assert.deepEqual((await archivSeite(nutzer, um("2026-10-15"))).klausuren, []);
  });

  it("Tag 15 (ab 04:00 Berliner Zeit): die Klausur vom 1.10. steht im Archiv", async () => {
    const nachts = await klausurenSeite(nutzer, um("2026-10-16", "03:30"));
    assert.ok(nachts.klausuren.some((k) => k.thema === "Am Ersten"));
    const d = await klausurenSeite(nutzer, um("2026-10-16", "04:00"));
    assert.ok(!d.klausuren.some((k) => k.thema === "Am Ersten"));
    assert.equal(d.archiv, 1);
    const a = await archivSeite(nutzer, um("2026-10-16", "04:00"));
    assert.deepEqual(
      a.klausuren.map((k) => k.thema),
      ["Am Ersten"],
    );
  });

  it("im Archiv die jüngste zuerst", async () => {
    const a = await archivSeite(nutzer, um("2026-10-30"));
    assert.deepEqual(
      a.klausuren.map((k) => k.thema),
      ["Heute", "Am Zweiten", "Am Ersten"],
    );
  });
});

describe("Archiv: Hausaufgaben", () => {
  it("zwei Tage unter „Erledigt“, danach im Archiv, auch nach drei Wochen noch", async () => {
    const jetzt = new Date("2026-10-14T15:00:00Z");
    const h = await hausaufgabenSeite(nutzer, jetzt);
    assert.deepEqual(
      h.erledigt.map((a) => a.text),
      ["eben erledigt"],
    );
    assert.equal(h.archiv, 2);
    const a = await archivSeite(nutzer, jetzt);
    assert.deepEqual(
      a.aufgaben.map((x) => x.text),
      ["vor drei Tagen erledigt", "vor drei Wochen erledigt"],
    );
    assert.ok(a.aufgaben.every((x) => x.done));
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  });
});
