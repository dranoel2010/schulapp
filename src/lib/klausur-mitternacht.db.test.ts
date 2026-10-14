import { dbBereit, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { createExam, examInputSchemaAb, generatePlan, getExam, setTopics } from "@/lib/exams";
import { createSubject } from "@/lib/subjects";
import { appTag } from "@/lib/tag";

/**
 * Abnahmerunde 20: Zwischen 0 und 4 Uhr rechneten das Anlegen einer Klausur
 * (Kalendertag) und „Lernplan neu erstellen“ (App-Tag) mit verschiedenen
 * Tagen. Derselbe Plan landete auf verschiedenen Tagen, und nach „neu
 * erstellen“ waren die Blöcke am nächsten Nachmittag schon verpasst. Jetzt
 * rechnen beide mit dem App-Tag.
 */

const UM_0030 = new Date("2026-10-15T00:30:00+02:00");
let nutzer = "";
let fach = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("KlausurMitternacht");
  const f = await createSubject(nutzer, {
    name: "Deutsch",
    short: "De",
    color: "blue",
    teacher: null,
    room: null,
    weightWritten: 50,
  } as never);
  fach = f.id;
});

const tage = async (examId: string) =>
  ((await getExam(nutzer, examId))?.blocks ?? []).map((b) => `${b.date} ${b.kind} ${b.minutes}`).sort();

describe("Klausur um 00:30 anlegen", () => {
  it("der App-Tag ist Mittwoch, das Formular nimmt ihn an, den Dienstag nicht", () => {
    const heute = appTag(UM_0030);
    assert.equal(heute, "2026-10-14");
    const eingabe = { subjectId: fach, title: "", kind: "test", leadDays: 3, minutesPerDay: 20, notes: "" };
    assert.equal(examInputSchemaAb(heute).safeParse({ ...eingabe, date: "2026-10-14" }).success, true);
    assert.equal(examInputSchemaAb(heute).safeParse({ ...eingabe, date: "2026-10-13" }).success, false);
  });

  it("Anlegen und „Lernplan neu erstellen“ legen die Blöcke auf dieselben Tage", async () => {
    const heute = appTag(UM_0030);
    const k = await createExam(nutzer, { subjectId: fach, title: null, kind: "test", date: "2026-10-19", leadDays: 5, minutesPerDay: 20, notes: null });
    await setTopics(nutzer, k.id, ["Kurzgeschichte", "Erörterung"]);
    await generatePlan(nutzer, k.id, heute); // wie createExamAction
    const nachAnlegen = await tage(k.id);
    assert.ok(nachAnlegen.length > 0);
    await generatePlan(nutzer, k.id, heute); // wie lernplanNeuAction
    assert.deepEqual(await tage(k.id), nachAnlegen);
  });
});
