import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { arbeitsblaetter, examTopics, exams, materialPages, materials, studyBlocks, subjectTopics, subjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { klausurAnswer } from "@/components/kombi/zeile/suche";
import { bloeckeAlsBlatt } from "@/lib/arbeitsblatt/quelle";
import { BLATT_VOLL, MAX_PAGES } from "@/lib/images";
import { blattAnlegen, seiteAnhaengen } from "@/lib/kombi/blatt-aufnahme";
import { zeilenVorrat } from "@/lib/kombi/zeilen-vorrat";
import { klausurSeite } from "@/lib/seiten/klausur";
import { berlinZeitpunkt } from "@/lib/tag";

/**
 * Abnahmerunde 19: „Lernblock mit Arbeitsblatt“ kommt aus der Art des Themas
 * (Prototyp `blockAlsBlatt` über `istUeben`), nicht aus einer schon
 * angelegten Zeile in `arbeitsblaetter`. Ein Block in drei Tagen heißt so wie
 * einer von heute; nur ein fehlgeschlagenes Blatt nimmt den Zusatz zurück.
 * Dazu: ein volles Blatt lehnt mit `voll` ab, damit die Kamera ein neues anlegt.
 */

let nutzer = "";
let klausur = "";
let heute = "";
let spaeter = "";
let geschichte = "";
const JETZT = berlinZeitpunkt("2026-10-09", "16:40");

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("AlsBlatt");
  const [ma] = await testDb.insert(subjects).values({ userId: nutzer, name: "Mathematik", short: "M" }).returning({ id: subjects.id });
  const [ge] = await testDb.insert(subjects).values({ userId: nutzer, name: "Geschichte", short: "G" }).returning({ id: subjects.id });
  const [k] = await testDb.insert(exams).values({ userId: nutzer, subjectId: ma.id, date: "2026-10-16", title: "Quadratische Funktionen" }).returning({ id: exams.id });
  klausur = k.id;
  const [t] = await testDb
    .insert(subjectTopics)
    .values({ userId: nutzer, subjectId: ma.id, title: "Quadratische Funktionen", matchKey: "quadratische funktionen", lastSeenAt: "2026-10-09" })
    .returning({ id: subjectTopics.id });
  const [et] = await testDb.insert(examTopics).values({ examId: k.id, title: "Scheitelpunktform", sortOrder: 0, subjectTopicId: t.id }).returning({ id: examTopics.id });
  const bl = await testDb
    .insert(studyBlocks)
    .values([
      { examId: k.id, topicId: et.id, date: "2026-10-09", minutes: 25, kind: "learn", sortOrder: 0 },
      { examId: k.id, topicId: et.id, date: "2026-10-12", minutes: 25, kind: "learn", sortOrder: 0 },
    ])
    .returning({ id: studyBlocks.id });
  heute = bl[0].id;
  spaeter = bl[1].id;

  // Geschichte: ein Thema zum Abfragen, kein Blatt
  const [g] = await testDb.insert(exams).values({ userId: nutzer, subjectId: ge.id, date: "2026-10-15", title: "Industrialisierung" }).returning({ id: exams.id });
  const [gt] = await testDb
    .insert(subjectTopics)
    .values({ userId: nutzer, subjectId: ge.id, title: "Industrialisierung", matchKey: "industrialisierung", lastSeenAt: "2026-10-09" })
    .returning({ id: subjectTopics.id });
  const [get] = await testDb.insert(examTopics).values({ examId: g.id, title: "Industrialisierung", sortOrder: 0, subjectTopicId: gt.id }).returning({ id: examTopics.id });
  const [gb] = await testDb.insert(studyBlocks).values({ examId: g.id, topicId: get.id, date: "2026-10-12", minutes: 20, kind: "learn", sortOrder: 0 }).returning({ id: studyBlocks.id });
  geschichte = gb.id;
});

describe("Lernblock mit Arbeitsblatt nach der Art des Themas", () => {
  it("bloeckeAlsBlatt: Übungsthema ja, auch ohne angelegtes Blatt; Abfragethema nein", async () => {
    const zeilen = await testDb.select().from(studyBlocks);
    const ids = await bloeckeAlsBlatt(nutzer, zeilen);
    assert.ok(ids.has(heute));
    assert.ok(ids.has(spaeter));
    assert.ok(!ids.has(geschichte));
  });

  it("Klausurseite: der Block in drei Tagen trägt den Zusatz wie der von heute", async () => {
    const s = await klausurSeite(nutzer, { id: klausur });
    assert.ok(s);
    assert.deepEqual(
      s.bloecke.map((b) => b.alsBlatt),
      [true, true],
    );
  });

  it("Zeile auf „mathe klausur“: „Lernblock mit Arbeitsblatt, 25 Minuten“", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    const k = v.klausuren.find((x) => x.id === klausur);
    assert.ok(k);
    const a = klausurAnswer(v, k);
    assert.deepEqual(
      a.zeilen.map((z) => z.em),
      ["Lernblock mit Arbeitsblatt, 25 Minuten", "Lernblock mit Arbeitsblatt, 25 Minuten"].map((x) => x.replace(" ", a.zeilen[0].em.includes(" ") ? " " : " ")),
    );
  });

  it("ein fehlgeschlagenes Blatt nimmt den Zusatz in der Zeile zurück", async () => {
    await testDb.insert(arbeitsblaetter).values({ userId: nutzer, studyBlockId: spaeter, tag: "2026-10-12", status: "fehlgeschlagen" });
    const v = await zeilenVorrat(nutzer, JETZT);
    const k = v.klausuren.find((x) => x.id === klausur)!;
    assert.deepEqual(k.plan.map((p) => p.alsBlatt), [true, false]);
  });
});

describe("Volles Blatt", () => {
  it("die dreizehnte Seite: 409 mit voll und dem Satz, das Blatt behält zwölf", async () => {
    const SEITE = { mimeType: "image/jpeg", width: 10, height: 14, image: new Uint8Array([1]), reading: new Uint8Array([1]), thumb: new Uint8Array([1]) };
    const a = await blattAnlegen(nutzer, JETZT, SEITE);
    assert.ok(a.ok);
    for (let i = 1; i < MAX_PAGES; i++) assert.ok((await seiteAnhaengen(nutzer, JETZT, a.id, SEITE, { folge: true })).ok);
    const r = await seiteAnhaengen(nutzer, JETZT, a.id, SEITE);
    assert.deepEqual(r, { ok: false, status: 409, message: BLATT_VOLL, voll: true });
    const seiten = await testDb.select({ id: materialPages.id }).from(materialPages).where(eq(materialPages.materialId, a.id));
    assert.equal(seiten.length, MAX_PAGES);
    assert.ok((await testDb.select().from(materials).where(eq(materials.id, a.id))).length);
  });
});
