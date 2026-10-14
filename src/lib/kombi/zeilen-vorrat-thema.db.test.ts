import { dbBereit, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { createExam, generatePlan, setTopics } from "@/lib/exams";
import { zeilenVorrat } from "@/lib/kombi/zeilen-vorrat";
import { createSubject } from "@/lib/subjects";
import { berlinZeitpunkt } from "@/lib/tag";

/**
 * Abnahmerunde 17: Die Zeile nennt eine Klausur ohne Titel nach ihren Themen
 * wie Liste, Seite und Archiv (klausurThema), nicht „Klausur“. Ein Thema, das
 * zwei Klausuren eines Fachs teilen, steht unter „Themen“ nur einmal und
 * führt zur näheren.
 */

let nutzer = "";
let test = "";
let nah = "";
let fern = "";
let gesch = "";
let englisch = "";
const JETZT = berlinZeitpunkt("2026-10-12", "16:40");

const fach = (name: string, short: string) =>
  createSubject(nutzer, { name, short, color: "amber", teacher: null, room: null, weightWritten: 50 } as never);

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("ZeileThema");
  const bio = await fach("Biologie", "Bio");
  const ma = await fach("Mathematik", "M");
  const t = await createExam(nutzer, { subjectId: bio.id, title: null, kind: "test", date: "2026-10-20", leadDays: 7, minutesPerDay: 20, notes: null });
  test = t.id;
  await setTopics(nutzer, t.id, ["Zellteilung"]);
  await createExam(nutzer, { subjectId: bio.id, title: null, kind: "test", date: "2026-10-23", leadDays: 3, minutesPerDay: 20, notes: null });
  const a = await createExam(nutzer, { subjectId: ma.id, title: "Quadratische Funktionen", kind: "klausur", date: "2026-10-16", leadDays: 4, minutesPerDay: 25, notes: null });
  const b = await createExam(nutzer, { subjectId: ma.id, title: "Quadratische Funktionen", kind: "klausur", date: "2026-10-17", leadDays: 5, minutesPerDay: 25, notes: null });
  nah = a.id;
  fern = b.id;
  await setTopics(nutzer, a.id, ["Scheitelpunktform"]);
  await setTopics(nutzer, b.id, ["Scheitelpunktform"]);
  const ge = await fach("Geschichte", "G");
  const en = await fach("Englisch", "E");
  gesch = ge.id;
  englisch = en.id;
  const g = await createExam(nutzer, { subjectId: ge.id, title: null, kind: "test", date: "2026-10-20", leadDays: 5, minutesPerDay: 20, notes: null });
  await setTopics(nutzer, g.id, ["Industrialisierung in Deutschland", "Industrialisierung in England"]);
  const e = await createExam(nutzer, { subjectId: en.id, title: null, kind: "test", date: "2026-10-21", leadDays: 5, minutesPerDay: 20, notes: null });
  for (const id of [test, nah, fern, g.id, e.id]) await generatePlan(nutzer, id, "2026-10-12");
});

describe("Zeile: Name einer Klausur ohne Titel", () => {
  it("nimmt die Themen, ohne Themen die Art", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    assert.equal(v.klausuren.find((k) => k.id === test)?.thema, "Zellteilung");
    assert.ok(v.klausuren.some((k) => k.thema === "Test"));
    assert.ok(!v.klausuren.some((k) => k.thema === "Klausur"));
    assert.ok(!v.themenListe.some((t) => t.t === "Klausur"));
  });
});

describe("Zeile: Themen ohne Dopplung", () => {
  it("ein Thema je Fach und Titel, Ziel ist die nähere Klausur", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    const q = v.themenListe.filter((t) => t.t === "Quadratische Funktionen");
    assert.equal(q.length, 1);
    assert.deepEqual(q[0].ziel, { art: "klausur", id: nah });
    const s = v.themenListe.filter((t) => t.t === "Scheitelpunktform");
    assert.equal(s.length, 1);
    assert.deepEqual(s[0].ziel, { art: "klausur", id: nah });
    const schluessel = v.themenListe.map((t) => `${t.fachId}:${t.t}`);
    assert.equal(new Set(schluessel).size, schluessel.length);
  });
});

describe("Zeile: nur echte Themen", () => {
  it("Klausur ohne Titel mit zwei Themen: genau die zwei Themen, nicht ihr zusammengesetzter Name", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    const g = v.themenListe.filter((t) => t.fachId === gesch).map((t) => t.t).sort();
    assert.deepEqual(g, ["Industrialisierung in Deutschland", "Industrialisierung in England"]);
  });

  it("Test ohne Titel und ohne Themen: kein Thema „Test“", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    assert.ok(!v.themenListe.some((t) => t.fachId === englisch && (t.t === "Test" || t.t === "Klausur")));
    assert.ok(!v.themenListe.some((t) => t.t === "Test"));
  });

  it("Klausur mit eigenem Titel: der Titel bleibt ein Thema", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    assert.ok(v.themenListe.some((t) => t.t === "Quadratische Funktionen"));
  });
});

describe("Zeile: Hilfsmittel der Probeklausur (Antwort vom 14.10.2026)", () => {
  it("in Mathematik mit Taschenrechner, in Biologie ohne Hilfsmittel", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    const probeVon = (id: string) => v.klausuren.find((k) => k.id === id)?.plan.filter((p) => p.art === "Probeklausur").map((p) => p.thema);
    assert.deepEqual(probeVon(fern), ["mit Taschenrechner"]);
    assert.deepEqual(probeVon(test), ["ohne Hilfsmittel"]);
  });
});
