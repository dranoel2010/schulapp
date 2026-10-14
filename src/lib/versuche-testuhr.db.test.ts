import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { examTopics, exams, studyBlocks, subjects, subjectTopics } from "@/db/schema";
import { ersteVersucheImBlock, fragenFuerLernblock } from "@/lib/lernblock";
import { berlinZeitpunkt } from "@/lib/tag";
import { recallAttempts, recallItems, recallSchedule } from "@/recall/schema";
import { urteilFesthalten, versuchFesthalten } from "@/recall/sessions";
import { fragenZumThema, themaSchluessel, versucheDesTages } from "@/recall/themen";

/**
 * Die Versuche eines App-Tags kommen aus `answered_at` (App-Uhr), nicht aus
 * `created_at` (Uhr der Datenbank). Mit Testuhr auf Fr 16.10. und der
 * Datenbank am Mi 14.10. gilt ein Versuch von 18:05 als heute.
 */

const HEUTE = "2026-10-16";
const UHR = berlinZeitpunkt(HEUTE, "18:05");
const DB_UHR = new Date("2026-10-14T12:43:00.000Z");

let nutzer = "";
let fach = "";
let thema = "";
let block = "";
let sass = "";
let daneben = "";

async function frage(text: string): Promise<{ id: string; alt: string }> {
  const [f] = await testDb
    .insert(recallItems)
    .values({ userId: nutzer, subjectId: fach, subjectTopicId: thema, promptFree: text, solution: "Lösung", misconception: "Verwechslung", sourceQuote: "Zitat", sourceLength: 5 })
    .returning({ id: recallItems.id });
  const termine = await testDb
    .insert(recallSchedule)
    .values([
      { itemId: f.id, dueOn: "2026-10-15" },
      { itemId: f.id, dueOn: HEUTE },
    ])
    .returning({ id: recallSchedule.id, dueOn: recallSchedule.dueOn });
  return { id: f.id, alt: termine.find((t) => t.dueOn === "2026-10-15")!.id };
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Versuche Testuhr");
  const [f] = await testDb.insert(subjects).values({ userId: nutzer, name: "Mathematik", short: "M" }).returning({ id: subjects.id });
  fach = f.id;
  const [t] = await testDb
    .insert(subjectTopics)
    .values({ userId: nutzer, subjectId: fach, title: "Scheitelpunktform", matchKey: "scheitelpunktform", lastSeenAt: "2026-10-12" })
    .returning({ id: subjectTopics.id });
  thema = t.id;
  const [k] = await testDb.insert(exams).values({ userId: nutzer, subjectId: fach, date: "2026-10-22" }).returning({ id: exams.id });
  await testDb.insert(examTopics).values({ examId: k.id, title: "Scheitelpunktform", sortOrder: 0, subjectTopicId: thema });
  const [b] = await testDb.insert(studyBlocks).values({ examId: k.id, date: HEUTE, minutes: 25 }).returning({ id: studyBlocks.id });
  block = b.id;

  const a = await frage("Scheitel?");
  const d = await frage("Streckung?");
  sass = a.id;
  daneben = d.id;
  for (const [x, richtig] of [[a, true], [d, false]] as const) {
    const v = await versuchFesthalten(nutzer, { scheduleId: x.alt, itemId: x.id, answerText: "x" }, HEUTE, UHR);
    assert.ok(v.ok);
    await urteilFesthalten(nutzer, v.attemptId, richtig, UHR);
  }
  // die Datenbank steht auf einem anderen Tag als die Testuhr
  await testDb.update(recallAttempts).set({ createdAt: DB_UHR }).where(eq(recallAttempts.userId, nutzer));
});

describe("Versuche des App-Tags nach der App-Uhr", () => {
  it("versucheDesTages findet den Versuch über answered_at", async () => {
    const versuche = await versucheDesTages(nutzer, HEUTE);
    assert.deepEqual(versuche.map((v) => [v.itemId, v.correct]), [
      [sass, true],
      [daneben, false],
    ]);
    assert.ok(versuche.every((v) => v.answeredAt.getTime() === UHR.getTime()));
    // der Tag von created_at ist nicht der App-Tag
    assert.deepEqual(await versucheDesTages(nutzer, "2026-10-14"), []);
  });

  it("Wiederholen: was saß, kommt am selben Abend nicht noch einmal", async () => {
    const fragen = await fragenZumThema(nutzer, HEUTE, themaSchluessel(fach, thema));
    assert.deepEqual(fragen.map((f) => f.itemId), [daneben]);
  });

  it("Lernblock: was saß, fehlt, und das Ende zählt die ersten Versuche", async () => {
    const fragen = await fragenFuerLernblock(nutzer, block, HEUTE);
    assert.deepEqual(fragen.map((f) => f.itemId), [daneben]);
    assert.deepEqual(await ersteVersucheImBlock(nutzer, block, HEUTE), { [sass]: true, [daneben]: false });
  });
});
