import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { lessons } from "@/db/schema";
import { createHomework } from "@/lib/homework";
import { createSubject } from "@/lib/subjects";
import { berlinZeitpunkt } from "@/lib/tag";

import { hausaufgabenSeite } from "./hausaufgaben";

/**
 * Abnahme 12: am Morgen sagen Startseite („Abgeben“, `istAbgabeAm`) und die
 * Seite „Hausaufgaben“ („Heute“) dasselbe. Eine überfällige offene Aufgabe
 * steht an einem Schultag unter „Heute“, nicht unter „Für ⟨Tag⟩“.
 */

let nutzer = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Hausaufgaben am Morgen");
  const fach = await createSubject(nutzer, {
    name: "Geschichte",
    short: "Ge",
    color: "blue",
    teacher: null,
    room: null,
    weightWritten: 60,
  } as never);
  await testDb.insert(lessons).values([1, 2, 3, 4, 5].map((weekday) => ({ userId: nutzer, subjectId: fach.id, weekday, period: 1 })));
  // eingetragen in dieser Reihenfolge: die überfällige zuletzt
  await createHomework(nutzer, { subjectId: fach.id, title: "heute fällig", dueDate: "2026-10-13" });
  await createHomework(nutzer, { subjectId: fach.id, title: "für morgen", dueDate: "2026-10-14" });
  await createHomework(nutzer, { subjectId: fach.id, title: "war gestern fällig", dueDate: "2026-10-12" });
});

describe("Hausaufgaben am Morgen", () => {
  it("Di 07:10: die überfällige steht unter „Heute“, zuerst, und nicht unter „Für Mittwoch“", async () => {
    const d = await hausaufgabenSeite(nutzer, berlinZeitpunkt("2026-10-13", "07:10"));
    assert.deepEqual(d.heuteFaellig.map((a) => a.text), ["war gestern fällig", "heute fällig"]);
    assert.equal(d.ns, "2026-10-14");
    assert.deepEqual(d.fuer.map((a) => a.text), ["für morgen"]);
  });

  it("Di 04:01 (nach dem Tageswechsel) genauso", async () => {
    const d = await hausaufgabenSeite(nutzer, berlinZeitpunkt("2026-10-13", "04:01"));
    assert.deepEqual(d.heuteFaellig.map((a) => a.text), ["war gestern fällig", "heute fällig"]);
  });

  it("am Samstag (kein Schultag) bleibt „Heute“ leer, die überfälligen stehen bei „Für Montag“", async () => {
    const d = await hausaufgabenSeite(nutzer, berlinZeitpunkt("2026-10-17", "10:00"));
    assert.deepEqual(d.heuteFaellig, []);
    assert.deepEqual(d.fuer.map((a) => a.text), ["war gestern fällig", "heute fällig", "für morgen"]);
  });
});
