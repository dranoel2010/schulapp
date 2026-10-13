import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { and, eq, isNull } from "drizzle-orm";

import { exams, freePeriods, lessons, studyBlocks, subjectTopics, subjects } from "@/db/schema";
import { protokollieren } from "@/lib/protokoll";
import { DAUERTAKT } from "@/recall/dauertakt";
import { dauertaktNachlegen } from "@/recall/nachlegen";
import { recallItems, recallSchedule } from "@/recall/schema";
import { berlinStunde, faelligeThemen, naechsterTerminUeberhaupt, wiederholenStand } from "@/recall/themen";
import { addDays } from "@/lib/dates";

/**
 * Wiederholen ohne Klausur (Antwort 6): Themen ohne Klausur bekommen von
 * selbst ihren nächsten Termin, kommen nach dem fälligsten zuerst auf die
 * Startseite, höchstens eins am Tag, in Ferien keins, und Themen mit Klausur
 * zählen dabei nicht mit.
 */

const MO = "2026-10-12";

async function fach(nutzer: string, name: string, short: string) {
  const [z] = await testDb.insert(subjects).values({ userId: nutzer, name, short }).returning({ id: subjects.id });
  return z.id;
}

async function thema(nutzer: string, subjectId: string, title: string) {
  const [z] = await testDb
    .insert(subjectTopics)
    .values({ userId: nutzer, subjectId, title, matchKey: title.toLowerCase(), origin: "blatt", lastSeenAt: MO, art: "abfragen" })
    .returning({ id: subjectTopics.id });
  return z.id;
}

/** Eine Frage, aufgenommen am 1.9., mit erledigten (`erledigt`) und offenen (`offen`) Terminen. */
async function frage(
  nutzer: string,
  subjectId: string,
  topicId: string | null,
  erledigt: string[],
  offen: string[] = [],
  extra: Partial<typeof recallItems.$inferInsert> = {},
) {
  const [i] = await testDb
    .insert(recallItems)
    .values({
      userId: nutzer,
      subjectId,
      subjectTopicId: topicId,
      promptFree: "Frage",
      solution: "Lösung",
      misconception: "Verwechslung",
      sourceQuote: "Zitat",
      sourceLength: 6,
      createdAt: berlinStunde("2026-09-01", 17),
      ...extra,
    })
    .returning({ id: recallItems.id });
  const zeilen = [
    ...erledigt.map((d) => ({ dueOn: d, doneAt: berlinStunde(d, 18) })),
    ...offen.map((d) => ({ dueOn: d, doneAt: null })),
  ];
  if (zeilen.length) {
    await testDb
      .insert(recallSchedule)
      .values(zeilen.map((z, k) => ({ itemId: i.id, dueOn: z.dueOn, doneAt: z.doneAt, round: k + 1, sortOrder: k })));
  }
  return i.id;
}

const offeneTermine = async (itemId: string) =>
  testDb
    .select({ dueOn: recallSchedule.dueOn, mode: recallSchedule.mode, round: recallSchedule.round })
    .from(recallSchedule)
    .where(and(eq(recallSchedule.itemId, itemId), isNull(recallSchedule.doneAt)));

describe("dauertaktNachlegen", () => {
  let n = "";
  let fr = "";
  let ma = "";
  before(async () => {
    await dbBereit();
    n = await testNutzer("Dauertakt");
    fr = await fach(n, "Französisch", "F");
    ma = await fach(n, "Mathematik", "M");
    await testDb.insert(exams).values({ userId: n, subjectId: ma, kind: "klausur", date: "2026-10-20", title: "Probe" });
  });

  it("legt nach dem letzten erledigten Termin genau einen neuen an, und nur einmal", async () => {
    const tFr = await thema(n, fr, "Vokabeln");
    const id = await frage(n, fr, tFr, ["2026-09-04", "2026-09-07", "2026-09-10", "2026-09-13"]);
    assert.equal(await dauertaktNachlegen(n, MO), 1);
    assert.deepEqual(await offeneTermine(id), [{ dueOn: addDays("2026-09-13", DAUERTAKT), mode: "erhaltung", round: 5 }]);
    assert.equal(await dauertaktNachlegen(n, MO), 0, "ein zweiter Aufruf schreibt nichts");
    assert.equal((await offeneTermine(id)).length, 1);
  });

  it("lässt Fächer mit Klausur, offene Termine, zurückgezogene und Messfragen in Ruhe", async () => {
    const mitKlausur = await frage(n, ma, null, ["2026-09-04"]);
    const nochOffen = await frage(n, fr, null, ["2026-09-04"], ["2026-10-14"]);
    const zurueck = await frage(n, fr, null, ["2026-09-04"], [], { retiredAt: new Date() });
    const messung = await frage(n, fr, null, [], [], { role: "messung" });
    await dauertaktNachlegen(n, MO);
    assert.equal((await offeneTermine(mitKlausur)).length, 0);
    assert.deepEqual((await offeneTermine(nochOffen)).map((t) => t.dueOn), ["2026-10-14"]);
    assert.equal((await offeneTermine(zurueck)).length, 0);
    assert.equal((await offeneTermine(messung)).length, 0);
  });

  it("gleichzeitige Aufrufe legen keinen Termin doppelt an", async () => {
    const g = await testNutzer("Gleichzeitig");
    const sp = await fach(g, "Englisch", "E");
    const ids = [
      await frage(g, sp, null, ["2026-09-20"]),
      await frage(g, sp, null, ["2026-09-21"]),
    ];
    const ergebnis = await Promise.all([1, 2, 3].map(() => dauertaktNachlegen(g, MO)));
    assert.equal(ergebnis.reduce((a, b) => a + b, 0), 2);
    for (const id of ids) assert.equal((await offeneTermine(id)).length, 1);
  });
});

describe("Themen ohne Klausur auf der Startseite", () => {
  let n = "";
  let fr = "";
  let en = "";
  let ma = "";
  let tFr = "";
  let klausur = "";
  before(async () => {
    await dbBereit();
    n = await testNutzer("Auswahl");
    fr = await fach(n, "Französisch", "F");
    en = await fach(n, "Englisch", "E");
    ma = await fach(n, "Mathematik", "M");
    tFr = await thema(n, fr, "Passé composé");
    const tEn = await thema(n, en, "Irregular verbs");
    const tMa = await thema(n, ma, "Brüche");
    const [k] = await testDb
      .insert(exams)
      .values({ userId: n, subjectId: ma, kind: "klausur", date: "2026-10-20", title: "Probe" })
      .returning({ id: exams.id });
    klausur = k.id;
    // Französisch zuletzt am 10.9., Englisch am 20.9.: beide liefen aus, Französisch ist fälliger
    await frage(n, fr, tFr, ["2026-09-10"]);
    await frage(n, en, tEn, ["2026-09-20"]);
    await frage(n, ma, tMa, [], [MO]);
    await dauertaktNachlegen(n, MO);
  });

  it("das fälligste Thema ohne Klausur kommt, eins am Tag, die Themen mit Klausur alle", async () => {
    const t = await faelligeThemen(n, MO);
    assert.deepEqual(
      t.map((x) => x.titel),
      ["Passé composé", "Brüche"],
    );
    assert.equal(t[0].klausur, null);
    assert.equal(t[1].klausur, "2026-10-20");
    assert.deepEqual(await wiederholenStand(n, MO), { kind: "knopf", n: 2, sub: "Zuerst Französisch · Passé composé" });
  });

  it("ein Fach ausdrücklich geöffnet: alles, was dort fällig ist", async () => {
    assert.deepEqual((await faelligeThemen(n, MO, { subjectId: en })).map((x) => x.titel), ["Irregular verbs"]);
  });

  it("mit offenem Lernblock heute rutscht das Thema ohne Klausur hinter die Klausur", async () => {
    const [b] = await testDb.insert(studyBlocks).values({ examId: klausur, date: MO, minutes: 25 }).returning({ id: studyBlocks.id });
    assert.deepEqual((await faelligeThemen(n, MO)).map((x) => x.titel), ["Brüche", "Passé composé"]);
    await testDb.update(studyBlocks).set({ status: "done" }).where(eq(studyBlocks.id, b.id));
    assert.deepEqual((await faelligeThemen(n, MO)).map((x) => x.titel), ["Passé composé", "Brüche"]);
  });

  it("nach einem beendeten Thema ohne Klausur kommt heute kein zweites, morgen das nächste", async () => {
    await protokollieren(n, MO, "thema_beendet", tFr, { n: 1 });
    assert.deepEqual((await faelligeThemen(n, MO)).map((x) => x.titel), ["Brüche"]);
    // Morgen ist wieder Platz für genau eins ohne Klausur
    const morgen = (await faelligeThemen(n, addDays(MO, 1))).filter((x) => x.klausur === null);
    assert.equal(morgen.length, 1);
  });

  it("Ferien sind ganz frei", async () => {
    const f = await testNutzer("Ferien");
    const sp = await fach(f, "Französisch", "F");
    await frage(f, sp, await thema(f, sp, "Vokabeln"), ["2026-09-10"]);
    await dauertaktNachlegen(f, MO);
    assert.equal((await faelligeThemen(f, MO)).length, 1);
    await testDb.insert(freePeriods).values({ userId: f, kind: "ferien", startsOn: MO, endsOn: "2026-10-23" });
    assert.deepEqual(await faelligeThemen(f, MO), []);
    assert.deepEqual(await wiederholenStand(f, MO), { kind: "ferien" });
  });

  it("Themen mit Klausur kommen nicht doppelt und belegen nicht den Platz", async () => {
    const m = await testNutzer("Doppelt");
    const sp = await fach(m, "Englisch", "E");
    const ma2 = await fach(m, "Mathematik", "M");
    await testDb.insert(exams).values({ userId: m, subjectId: ma2, kind: "test", date: "2026-10-15", title: "Probe" });
    const tm = await thema(m, ma2, "Gleichungen");
    await frage(m, ma2, tm, [], [MO]);
    await frage(m, ma2, tm, [], [MO]);
    await frage(m, sp, await thema(m, sp, "Vokabeln"), ["2026-09-10"]);
    await dauertaktNachlegen(m, MO);
    const t = await faelligeThemen(m, MO);
    assert.deepEqual(t.map((x) => x.titel), ["Vokabeln", "Gleichungen"]);
    assert.equal(new Set(t.map((x) => x.key)).size, t.length);
    // auch nach dem Beenden des Klausurthemas bleibt der Platz für Englisch
    await protokollieren(m, MO, "thema_beendet", tm, { n: 2 });
    assert.deepEqual((await faelligeThemen(m, MO)).map((x) => x.titel), ["Vokabeln"]);
  });
});

describe("die Epoche zählt nicht zur Grenze", () => {
  it("Epoche ohne Klausur und Französisch erscheinen beide", async () => {
    const e = await testNutzer("Epoche");
    const ge = await fach(e, "Geschichte", "Ge");
    const sp = await fach(e, "Französisch", "F");
    // Geschichte in der ersten Stunde Mo bis Fr: das Epochenfach, ohne Klausur
    await testDb.insert(lessons).values([1, 2, 3, 4, 5].map((weekday) => ({ userId: e, subjectId: ge, weekday, period: 1 })));
    const tGe = await thema(e, ge, "Reformation");
    const tGe2 = await thema(e, ge, "Bauernkrieg");
    for (let k = 0; k < 5; k++) await frage(e, ge, tGe, [], [MO]);
    await frage(e, ge, tGe2, [], [MO]);
    await frage(e, sp, await thema(e, sp, "Vokabeln"), [], ["2026-10-08"]);
    const t = await faelligeThemen(e, MO);
    assert.deepEqual(t.map((x) => x.titel), ["Vokabeln", "Reformation", "Bauernkrieg"]);
    assert.equal(t[1].istEpoche, true);
    assert.deepEqual(await wiederholenStand(e, MO), { kind: "knopf", n: 3, sub: "Zuerst Französisch · Vokabeln" });
    // Ein beendetes Epochenthema verbraucht den Platz für Französisch nicht
    await protokollieren(e, MO, "thema_beendet", tGe2, { n: 1 });
    assert.deepEqual((await faelligeThemen(e, MO)).map((x) => x.titel), ["Vokabeln", "Reformation"]);
  });

  it("das Epochenfach ohne Klausur bekommt weiter den Dauertakt", async () => {
    const e = await testNutzer("Epoche Takt");
    const ge = await fach(e, "Geschichte", "Ge");
    await testDb.insert(lessons).values([1, 2, 3, 4, 5].map((weekday) => ({ userId: e, subjectId: ge, weekday, period: 1 })));
    const id = await frage(e, ge, await thema(e, ge, "Reformation"), ["2026-09-10"]);
    assert.equal(await dauertaktNachlegen(e, MO), 1);
    assert.deepEqual((await offeneTermine(id)).map((t) => t.dueOn), [addDays("2026-09-10", DAUERTAKT)]);
  });
});

describe("„Nächstes Thema“ zählt zurückgehaltene Themen mit", () => {
  it("ein Thema ohne Klausur beendet, ein zweites zurückgehalten: morgen", async () => {
    const z = await testNutzer("Zurück");
    const sp = await fach(z, "Französisch", "F");
    const en = await fach(z, "Englisch", "E");
    const tFr = await thema(z, sp, "Vokabeln");
    await frage(z, sp, tFr, [], ["2026-10-08"]);
    await frage(z, en, await thema(z, en, "Irregular verbs"), [], ["2026-10-10"]);
    await frage(z, en, await thema(z, en, "Reported speech"), [], ["2026-10-22"]);
    assert.deepEqual((await faelligeThemen(z, MO)).map((x) => x.titel), ["Vokabeln"]);
    await protokollieren(z, MO, "thema_beendet", tFr, { n: 1 });
    assert.deepEqual(await faelligeThemen(z, MO), []);
    assert.equal(await naechsterTerminUeberhaupt(z, MO), "2026-10-13");
    assert.deepEqual(await wiederholenStand(z, MO), {
      kind: "text",
      text: "Für heute durch. Nächstes Thema Dienstag.",
      ok: true,
    });
    // und tatsächlich steht morgen wieder ein Thema im Knopf
    assert.equal((await faelligeThemen(z, "2026-10-13")).length, 1);
  });

  it("morgen beginnen Ferien: der erste Tag danach", async () => {
    const z = await testNutzer("Zurück Ferien");
    const sp = await fach(z, "Französisch", "F");
    const en = await fach(z, "Englisch", "E");
    const tFr = await thema(z, sp, "Vokabeln");
    await frage(z, sp, tFr, [], ["2026-10-08"]);
    await frage(z, en, await thema(z, en, "Irregular verbs"), [], ["2026-10-10"]);
    await testDb.insert(freePeriods).values({ userId: z, kind: "ferien", startsOn: "2026-10-18", endsOn: "2026-10-30" });
    await protokollieren(z, "2026-10-17", "thema_beendet", tFr, { n: 1 });
    assert.equal(await naechsterTerminUeberhaupt(z, "2026-10-17"), "2026-10-31");
    assert.deepEqual(await wiederholenStand(z, "2026-10-17"), {
      kind: "text",
      text: "Für heute durch. Nächstes Thema Samstag, 31.10.",
      ok: true,
    });
  });

  it("ein Termin in den Ferien rückt auf den ersten Tag danach", async () => {
    const z = await testNutzer("Termin Ferien");
    const sp = await fach(z, "Französisch", "F");
    await frage(z, sp, await thema(z, sp, "Vokabeln"), [], ["2026-10-27"]);
    await testDb.insert(freePeriods).values({ userId: z, kind: "ferien", startsOn: "2026-10-19", endsOn: "2026-10-30" });
    assert.equal(await naechsterTerminUeberhaupt(z, MO), "2026-10-31");
  });

  it("ohne Zurückgehaltene gilt weiter der nächste Termin", async () => {
    const z = await testNutzer("Nichts zurück");
    const sp = await fach(z, "Französisch", "F");
    const tFr = await thema(z, sp, "Vokabeln");
    await frage(z, sp, tFr, [], [MO]);
    await frage(z, sp, await thema(z, sp, "Grammatik"), [], ["2026-10-22"]);
    await protokollieren(z, MO, "thema_beendet", tFr, { n: 1 });
    assert.equal(await naechsterTerminUeberhaupt(z, MO), "2026-10-22");
  });
});
