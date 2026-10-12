import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import {
  arbeitsblaetter,
  exams,
  studyBlocks,
  subjects,
  subjectTopics,
} from "@/db/schema";
import {
  arbeitsblattFuer,
  auswerten,
  bauFehlgeschlagen,
  bauStarten,
  darfBauen,
  istHaengend,
  wertungSetzen,
  weiterNachfragen,
} from "@/lib/arbeitsblatt/stand";
import { protokollVomTag } from "@/lib/protokoll";

const TAG = "2026-10-12";
const T0 = new Date("2026-10-12T14:40:00.000Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

let nutzer = "";
let thema = "";
let block = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const [f] = await testDb
    .insert(subjects)
    .values({ userId: nutzer, name: "Mathematik", short: "M" })
    .returning({ id: subjects.id });
  const [t] = await testDb
    .insert(subjectTopics)
    .values({ userId: nutzer, subjectId: f.id, title: "Quadratische Funktionen", matchKey: "quadratische funktionen", lastSeenAt: TAG })
    .returning({ id: subjectTopics.id });
  thema = t.id;
  const [k] = await testDb
    .insert(exams)
    .values({ userId: nutzer, subjectId: f.id, date: "2026-10-16" })
    .returning({ id: exams.id });
  const [b] = await testDb
    .insert(studyBlocks)
    .values({ examId: k.id, date: TAG, minutes: 25, kind: "review" })
    .returning({ id: studyBlocks.id });
  block = b.id;
});

describe("Arbeitsblatt-Stand", () => {
  it("höchstens eins je Thema und Tag: zweimal anlegen gibt dieselbe Zeile", async () => {
    const a = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, TAG);
    const b = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, TAG);
    assert.equal(a.id, b.id);
    assert.equal(a.status, "wartet");
    const c = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, "2026-10-13");
    assert.notEqual(a.id, c.id);
  });

  it("ein Blatt für eine Gesamtwiederholung ohne Fach-Thema hängt nur am Block", async () => {
    const a = await arbeitsblattFuer(nutzer, { studyBlockId: block }, TAG);
    assert.equal(a.subjectTopicId, null);
    assert.equal(a.studyBlockId, block);
    const b = await arbeitsblattFuer(nutzer, { studyBlockId: block }, TAG);
    assert.equal(a.id, b.id);
  });

  it("Bau per UPDATE: hängend neu anstoßen, der dritte Versuch wird abgelehnt", async () => {
    const blatt = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, "2026-10-14");

    const erster = await bauStarten(nutzer, blatt.id, T0);
    assert.equal(erster?.status, "laeuft");
    assert.equal(erster?.versuche, 1);
    assert.ok(weiterNachfragen(erster!, plus(MIN)));

    // Während der Frist läuft kein zweiter Bau.
    assert.equal(await bauStarten(nutzer, blatt.id, plus(5 * MIN)), null);

    // Nach der Frist (Neustart des Containers) gilt er als hängend.
    assert.ok(istHaengend(erster!, plus(16 * MIN)));
    assert.ok(!weiterNachfragen(erster!, plus(16 * MIN)));
    const zweiter = await bauStarten(nutzer, blatt.id, plus(16 * MIN));
    assert.equal(zweiter?.id, blatt.id, "dieselbe Zeile, keine neue");
    assert.equal(zweiter?.versuche, 2);

    await bauFehlgeschlagen(nutzer, blatt.id);
    const [stand] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, blatt.id));
    assert.equal(stand.status, "fehlgeschlagen");
    assert.equal(darfBauen(stand, plus(20 * MIN)), false);
    assert.equal(await bauStarten(nutzer, blatt.id, plus(20 * MIN)), null);

    const zeilen = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.tag, "2026-10-14"));
    assert.equal(zeilen.length, 1);
  });

  it("Auswerten erst, wenn jede Aufgabe bewertet ist", async () => {
    const blatt = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, "2026-10-15");
    await wertungSetzen(nutzer, blatt.id, 1, true);
    await wertungSetzen(nutzer, blatt.id, 2, false);
    await assert.rejects(auswerten(nutzer, blatt.id, 3, T0, "2026-10-15"), /Aufgabe 3/);

    await wertungSetzen(nutzer, blatt.id, 3, true);
    await wertungSetzen(nutzer, blatt.id, 2, true); // umentschieden
    const ergebnis = await auswerten(nutzer, blatt.id, 3, T0, "2026-10-15");
    assert.equal(ergebnis.richtig, 3);

    const eintrag = (await protokollVomTag(nutzer, "2026-10-15")).find((e) => e.typ === "blatt_ausgewertet");
    assert.deepEqual(eintrag?.daten, { n: 3, richtig: 3 });
  });

  it("fremde Nutzer können nicht werten", async () => {
    const blatt = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, "2026-10-16");
    const fremd = await testNutzer("Fremd");
    await assert.rejects(wertungSetzen(fremd, blatt.id, 1, true), /nicht gefunden/);
  });
});
