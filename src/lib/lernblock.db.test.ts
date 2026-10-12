import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import {
  examTopics,
  exams,
  studyBlocks,
  subjects,
  subjectTopics,
} from "@/db/schema";
import {
  blockBeenden,
  blockErledigt,
  blockFortsetzen,
  blockPausieren,
  blockRest,
  blockStarten,
  fragenFuerLernblock,
} from "@/lib/lernblock";
import { protokollVomTag } from "@/lib/protokoll";
import { recallItems, recallSchedule } from "@/recall/schema";

const TAG = "2026-10-12";
const T0 = new Date("2026-10-12T14:40:00.000Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

let nutzer = "";
let fach = "";
let klausur = "";

async function neuerBlock(): Promise<string> {
  const [b] = await testDb
    .insert(studyBlocks)
    .values({ examId: klausur, date: TAG, minutes: 25 })
    .returning({ id: studyBlocks.id });
  return b.id;
}

async function thema(titel: string): Promise<string> {
  const [t] = await testDb
    .insert(subjectTopics)
    .values({ userId: nutzer, subjectId: fach, title: titel, matchKey: titel.toLowerCase(), lastSeenAt: TAG })
    .returning({ id: subjectTopics.id });
  return t.id;
}

async function frage(text: string, subjectTopicId: string | null, examId: string | null) {
  const [f] = await testDb
    .insert(recallItems)
    .values({
      userId: nutzer,
      subjectId: fach,
      subjectTopicId,
      examId,
      promptFree: text,
      solution: "Lösung",
      misconception: "Verwechslung",
      sourceQuote: "Zitat",
      sourceLength: 5,
    })
    .returning({ id: recallItems.id });
  await testDb.insert(recallSchedule).values({ itemId: f.id, dueOn: "2026-10-10" });
  return f.id;
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const [f] = await testDb
    .insert(subjects)
    .values({ userId: nutzer, name: "Mathematik", short: "M" })
    .returning({ id: subjects.id });
  fach = f.id;
  const [k] = await testDb
    .insert(exams)
    .values({ userId: nutzer, subjectId: fach, date: "2026-10-16" })
    .returning({ id: exams.id });
  klausur = k.id;
});

describe("Lernblock gegen die Datenbank", () => {
  it("Starten, Pausieren, Fortsetzen: die Uhr steht am Block", async () => {
    const id = await neuerBlock();
    let b = await blockStarten(nutzer, id, T0, TAG);
    assert.equal(b.laeuftSeit?.getTime(), T0.getTime());

    b = await blockPausieren(nutzer, id, plus(5 * MIN), TAG);
    b = await blockFortsetzen(nutzer, id, plus(15 * MIN), TAG);
    assert.equal(b.pauseMs, 10 * MIN);
    assert.equal(blockRest(b, plus(17 * MIN)), 18 * MIN);

    // Neuladen: derselbe Stand aus der Datenbank.
    const [frisch] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, id));
    assert.equal(blockRest(frisch, plus(17 * MIN)), 18 * MIN);

    const typen = (await protokollVomTag(nutzer, TAG)).filter((e) => e.ref === id).map((e) => e.typ);
    assert.deepEqual(typen, ["lernblock_gestartet", "lernblock_pausiert", "lernblock_fortgesetzt"]);
  });

  it("Beenden unter einer Minute: Ruhe und keine Spur im Protokoll", async () => {
    const id = await neuerBlock();
    await blockStarten(nutzer, id, T0, TAG);
    const ende = await blockBeenden(nutzer, id, plus(40_000), TAG);
    assert.deepEqual(ende, { art: "zurueck" });
    const [b] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, id));
    assert.equal(b.laeuftSeit, null);
    assert.equal((await protokollVomTag(nutzer, TAG)).filter((e) => e.ref === id).length, 0);
  });

  it("Beenden nach 23 Minuten fragt, Erledigt zählt die Minuten", async () => {
    const id = await neuerBlock();
    await blockStarten(nutzer, id, T0, TAG);
    const ende = await blockBeenden(nutzer, id, plus(23 * MIN + 5_000), TAG);
    assert.deepEqual(ende, { art: "frage", minuten: 23 });
    const { block } = await blockErledigt(nutzer, id, 23, TAG);
    assert.equal(block.status, "done");
    assert.equal(block.minutenGelernt, 23);
    const eintrag = (await protokollVomTag(nutzer, TAG)).find((e) => e.ref === id && e.typ === "lernblock_erledigt");
    assert.deepEqual(eintrag?.daten, { n: 23, perWH: false });
  });

  it("fremde Blöcke bleiben zu", async () => {
    const id = await neuerBlock();
    const fremd = await testNutzer("Fremd");
    await assert.rejects(blockStarten(fremd, id, T0, TAG), /nicht gefunden/);
  });

  it("fragenFuerLernblock filtert auf die Klausurthemen, in deren Reihenfolge", async () => {
    const scheitel = await thema("Scheitelpunktform");
    const pq = await thema("pq-Formel");
    const fremdThema = await thema("Lineare Funktionen");
    await testDb.insert(examTopics).values([
      { examId: klausur, title: "pq-Formel", sortOrder: 1, subjectTopicId: pq },
      { examId: klausur, title: "Scheitelpunktform", sortOrder: 0, subjectTopicId: scheitel },
    ]);
    const f1 = await frage("pq?", pq, null);
    const f2 = await frage("Scheitel?", scheitel, null);
    await frage("linear?", fremdThema, null);
    const f4 = await frage("Klausur ohne Thema?", null, klausur);

    const id = await neuerBlock();
    const fragen = await fragenFuerLernblock(nutzer, id, TAG);
    assert.deepEqual(
      fragen.map((f) => f.itemId),
      [f2, f1, f4],
    );
  });
});
