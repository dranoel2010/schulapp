import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { examTopics, exams, lessons, periods, studyBlocks, subjects } from "@/db/schema";

import { lernplanDerWoche, wocheSeite } from "./woche";

/**
 * Die Woche am Rechner (desktop.html `RENDER_woche`) zeigt je Tag den
 * Lernplan aller Klausuren, ohne Uhrzeit, und die Zeitspalte aus dem Raster.
 * Gestrichene Blöcke stehen nicht da, fremde Konten auch nicht.
 */

let nutzer = "";
let mathe = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Woche");
  const fremd = await testNutzer("Jemand anders");
  const [ma, de, fr] = await testDb
    .insert(subjects)
    .values([
      { userId: nutzer, name: "Mathematik", short: "M", sortOrder: 0 },
      { userId: nutzer, name: "Deutsch", short: "D", sortOrder: 1 },
      { userId: fremd, name: "Französisch", short: "F", sortOrder: 0 },
    ])
    .returning({ id: subjects.id });
  mathe = ma.id;
  await testDb.insert(periods).values([
    { userId: nutzer, number: 1, startsAt: "08:00", endsAt: "09:30" },
    { userId: nutzer, number: 2, startsAt: "09:50", endsAt: "11:20" },
    { userId: nutzer, number: 3, startsAt: "11:40", endsAt: "13:10" },
    { userId: nutzer, number: 4, startsAt: "13:30", endsAt: "14:15" },
  ]);
  // Montag bis Freitag Mathe in der 1. Stunde, Mittwoch Deutsch in der 3.
  await testDb.insert(lessons).values([
    ...[1, 2, 3, 4, 5].map((weekday) => ({ userId: nutzer, subjectId: ma.id, weekday, period: 1 })),
    { userId: nutzer, subjectId: de.id, weekday: 3, period: 3 },
  ]);

  const [kMa, kDe, kFremd] = await testDb
    .insert(exams)
    .values([
      { userId: nutzer, subjectId: ma.id, title: "Quadratische Funktionen", kind: "klausur", date: "2026-10-16" },
      { userId: nutzer, subjectId: de.id, title: "Gedichtanalyse", kind: "test", date: "2026-10-15" },
      { userId: fremd, subjectId: fr.id, title: "Passé composé", kind: "test", date: "2026-10-15" },
    ])
    .returning({ id: exams.id });
  const [scheitel] = await testDb
    .insert(examTopics)
    .values({ examId: kMa.id, title: "Scheitelpunktform", sortOrder: 0 })
    .returning({ id: examTopics.id });

  await testDb.insert(studyBlocks).values([
    { examId: kMa.id, topicId: scheitel.id, date: "2026-10-12", minutes: 25, kind: "learn", sortOrder: 0 },
    { examId: kMa.id, topicId: null, date: "2026-10-14", minutes: 25, kind: "review", sortOrder: 1 },
    { examId: kMa.id, topicId: null, date: "2026-10-15", minutes: 25, kind: "probe", sortOrder: 2, status: "done" },
    { examId: kMa.id, topicId: null, date: "2026-10-13", minutes: 25, kind: "review", sortOrder: 3, status: "skipped" },
    // Deutsch kommt früher dran: am Mittwoch steht es vor Mathe
    { examId: kDe.id, topicId: null, date: "2026-10-14", minutes: 20, kind: "review", sortOrder: 0 },
    { examId: kFremd.id, topicId: null, date: "2026-10-14", minutes: 30, kind: "review", sortOrder: 0 },
    // nächste Woche: nicht in dieser
    { examId: kMa.id, topicId: null, date: "2026-10-19", minutes: 25, kind: "review", sortOrder: 4 },
  ]);
});

describe("Woche: Lernplan je Tag", () => {
  it("lernplanDerWoche: nur eigene, ohne gestrichene, je Tag die frühere Klausur zuerst", async () => {
    const l = await lernplanDerWoche(nutzer, "2026-10-12", "2026-10-16");
    assert.deepEqual(
      l.map((e) => [e.block.tag, e.kurz, e.block.titel, e.block.status]),
      [
        ["2026-10-12", "Mathe", "Scheitelpunktform", "open"],
        ["2026-10-14", "Deutsch", "Wiederholung", "open"],
        ["2026-10-14", "Mathe", "Wiederholung", "open"],
        ["2026-10-15", "Mathe", "Probeklausur", "done"],
      ],
    );
    assert.equal(l[0].fach, "Mathematik");
    assert.equal(l[0].klausurDatum, "2026-10-16");
    assert.equal(l[0].block.minuten, 25);
  });

  it("wocheSeite: jeder Tag trägt seine Einträge, ohne Uhrzeit", async () => {
    const d = await wocheSeite(nutzer, { tag: "2026-10-14" });
    assert.deepEqual(
      d.tage.map((t) => [t.tag, t.lernen.length]),
      [
        ["2026-10-12", 1],
        ["2026-10-13", 0],
        ["2026-10-14", 2],
        ["2026-10-15", 1],
        ["2026-10-16", 0],
      ],
    );
    // ein Planeintrag hat keine Uhrzeit, nur Tag und Minuten
    const e = d.tage[0].lernen[0];
    assert.equal("von" in e.block || "uhrzeit" in e.block, false);
    assert.equal(e.block.examId.length > 0, true);
  });

  it("wocheSeite: die Zeitspalte reicht von der ersten bis zur letzten belegten Stunde", async () => {
    const d = await wocheSeite(nutzer, { tag: "2026-10-14" });
    assert.deepEqual(d.zeiten, [
      { nr: 1, von: "08:00", bis: "09:30" },
      { nr: 2, von: "09:50", bis: "11:20" },
      { nr: 3, von: "11:40", bis: "13:10" },
    ]);
    assert.deepEqual(
      d.tage[2].stunden.map((s) => [s.nr, s.fachId === mathe]),
      [
        [1, true],
        [3, false],
      ],
    );
  });

  it("die nächste Woche hat ihren eigenen Plan", async () => {
    const d = await wocheSeite(nutzer, { tag: "2026-10-19" });
    assert.equal(d.tage[0].tag, "2026-10-19");
    assert.deepEqual(
      d.tage.map((t) => t.lernen.length),
      [1, 0, 0, 0, 0],
    );
  });
});
