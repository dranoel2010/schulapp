import { dbBereit, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { createExam, setTopics } from "@/lib/exams";
import { createSubject } from "@/lib/subjects";
import { berlinZeitpunkt } from "@/lib/tag";

import { archivSeite } from "./archiv";
import { klausurenSeite, klausurSeite } from "./klausur";

/**
 * Abnahmerunde 16: Eine Klausur ohne Titel heißt in der Liste „Klausuren“
 * wie auf ihrer eigenen Seite, also nach ihren Themen (Prototyp Z. 1134),
 * nicht nach ihrer Art. Das Archiv liest sie genauso.
 */

let nutzer = "";
let ohneTitel = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("KlausurenThema");
  const fach = await createSubject(nutzer, {
    name: "Geschichte",
    short: "Ge",
    color: "amber",
    teacher: null,
    room: null,
    weightWritten: 50,
  } as never);
  const k = await createExam(nutzer, { subjectId: fach.id, title: null, kind: "klausur", date: "2026-10-20", leadDays: 5, minutesPerDay: 25, notes: null });
  ohneTitel = k.id;
  await setTopics(nutzer, k.id, ["Industrialisierung in Deutschland", "Industrialisierung in England"]);
  await createExam(nutzer, { subjectId: fach.id, title: null, kind: "test", date: "2026-10-22", leadDays: 3, minutesPerDay: 20, notes: null });
  await createExam(nutzer, { subjectId: fach.id, title: "Weimarer Republik", kind: "klausur", date: "2026-09-01", leadDays: 5, minutesPerDay: 25, notes: null });
});

describe("Liste „Klausuren“: Thema einer Klausur ohne Titel", () => {
  it("zeigt die Themen mit Komma, wie die Seite der Klausur", async () => {
    const jetzt = berlinZeitpunkt("2026-10-12", "16:40");
    const d = await klausurenSeite(nutzer, jetzt);
    const zeile = d.klausuren.find((k) => k.id === ohneTitel);
    assert.equal(zeile?.thema, "Industrialisierung in Deutschland, Industrialisierung in England");
    const seite = await klausurSeite(nutzer, { id: ohneTitel });
    assert.equal(seite?.thema, zeile?.thema);
  });

  it("ohne Titel und ohne Themen bleibt die Art", async () => {
    const d = await klausurenSeite(nutzer, berlinZeitpunkt("2026-10-12", "16:40"));
    assert.deepEqual(
      d.klausuren.map((k) => k.thema),
      ["Industrialisierung in Deutschland, Industrialisierung in England", "Test"],
    );
  });

  it("das Archiv nimmt denselben Rückfall, ein Titel geht vor", async () => {
    const a = await archivSeite(nutzer, berlinZeitpunkt("2026-11-30", "15:00"));
    assert.deepEqual(
      a.klausuren.map((k) => k.thema),
      ["Test", "Industrialisierung in Deutschland, Industrialisierung in England", "Weimarer Republik"],
    );
  });
});
