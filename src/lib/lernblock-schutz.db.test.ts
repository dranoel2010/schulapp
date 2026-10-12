import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { examTopics, exams, freePeriods, studyBlocks, subjects } from "@/db/schema";
import { catchUpMissed, generatePlan, moveOffFreeDays, setTopics } from "@/lib/exams";
import { blockFortsetzen, blockPausieren, blockStarten } from "@/lib/lernblock";

/**
 * Plan 3.5 / Abschnitt F: Ein angefangener Block (die Uhr lief schon)
 * übersteht jedes Neuplanen — Klausur speichern (`generatePlan`), Ferien
 * darüberlegen (`moveOffFreeDays`), Nachholen (`catchUpMissed`) und ein
 * gestrichenes Thema (`setTopics`). Block, Tag und Uhrstand bleiben stehen.
 */

const HEUTE = "2026-10-12";
const T0 = new Date("2026-10-12T14:40:00.000Z");
const MIN = 60_000;

let nutzer = "";
let klausur = "";

async function blockStand(id: string) {
  const [b] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, id));
  return b;
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const [f] = await testDb
    .insert(subjects)
    .values({ userId: nutzer, name: "Mathematik", short: "M" })
    .returning({ id: subjects.id });
  const [k] = await testDb
    .insert(exams)
    .values({ userId: nutzer, subjectId: f.id, date: "2026-10-23", leadDays: 10, minutesPerDay: 45 })
    .returning({ id: exams.id });
  klausur = k.id;
  await setTopics(nutzer, klausur, ["Scheitelpunktform", "Nullstellen"]);
  await generatePlan(nutzer, klausur, HEUTE);
});

describe("Angefangene Lernblöcke überstehen jedes Neuplanen", () => {
  let id = "";
  let vorher: Awaited<ReturnType<typeof blockStand>>;

  it("Block mit Thema „Scheitelpunktform“ wird gestartet, pausiert, fortgesetzt", async () => {
    const [thema] = await testDb
      .select()
      .from(examTopics)
      .where(and(eq(examTopics.examId, klausur), eq(examTopics.title, "Scheitelpunktform")));
    const [b] = await testDb
      .select()
      .from(studyBlocks)
      .where(and(eq(studyBlocks.examId, klausur), eq(studyBlocks.topicId, thema.id)))
      .limit(1);
    assert.ok(b, "der Plan hat einen Block zum Thema");
    id = b.id;
    await blockStarten(nutzer, id, T0, HEUTE);
    await blockPausieren(nutzer, id, new Date(T0.getTime() + 3 * MIN), HEUTE);
    await blockFortsetzen(nutzer, id, new Date(T0.getTime() + 5 * MIN), HEUTE);
    vorher = await blockStand(id);
    assert.equal(vorher.pauseMs, 2 * MIN);
    assert.equal(vorher.laeuftSeit?.getTime(), T0.getTime());
  });

  const unveraendert = async () => {
    const jetzt = await blockStand(id);
    assert.ok(jetzt, "der Block steht noch");
    assert.equal(jetzt.date, vorher.date);
    assert.equal(jetzt.status, "open");
    assert.equal(jetzt.laeuftSeit?.getTime(), vorher.laeuftSeit?.getTime());
    assert.equal(jetzt.pauseMs, vorher.pauseMs);
    assert.equal(jetzt.topicId, vorher.topicId);
  };

  it("Klausur speichern: generatePlan löscht und verlegt ihn nicht", async () => {
    await generatePlan(nutzer, klausur, HEUTE);
    await unveraendert();
  });

  it("Ferien darüber: moveOffFreeDays lässt ihn liegen, andere Blöcke weichen", async () => {
    await testDb.insert(freePeriods).values({ userId: nutzer, startsOn: vorher.date, endsOn: vorher.date });
    await moveOffFreeDays(nutzer, HEUTE);
    await unveraendert();
    const andere = await testDb
      .select()
      .from(studyBlocks)
      .where(and(eq(studyBlocks.examId, klausur), eq(studyBlocks.date, vorher.date)));
    assert.deepEqual(
      andere.map((b) => b.id),
      [id],
      "am freien Tag liegt nur noch der angefangene Block",
    );
  });

  it("Nachholen: catchUpMissed verlegt ihn nicht", async () => {
    await catchUpMissed(nutzer, klausur, "2026-10-20");
    await unveraendert();
  });

  it("Thema gestrichen: setTopics hält das Thema, solange der Block angefangen ist", async () => {
    await setTopics(nutzer, klausur, ["Nullstellen"]);
    await unveraendert();
    const themen = await testDb.select().from(examTopics).where(eq(examTopics.examId, klausur));
    assert.ok(themen.some((t) => t.title === "Scheitelpunktform"));
  });

  it("Ohne angefangenen Block fällt das Thema wie bisher weg", async () => {
    await testDb.update(studyBlocks).set({ status: "done" }).where(eq(studyBlocks.id, id));
    await testDb
      .update(studyBlocks)
      .set({ laeuftSeit: null, pauseMs: 0 })
      .where(eq(studyBlocks.id, id));
    await setTopics(nutzer, klausur, ["Nullstellen"]);
    const themen = await testDb.select().from(examTopics).where(eq(examTopics.examId, klausur));
    assert.deepEqual(
      themen.map((t) => t.title),
      ["Nullstellen"],
    );
  });
});
