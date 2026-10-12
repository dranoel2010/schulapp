import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { and, asc, eq, inArray } from "drizzle-orm";

import { arbeitsblaetter, studyBlocks } from "@/db/schema";
import {
  blattAuswerten,
  blattFuerBlock,
  blattFuerThema,
  blattStand,
  faelligeUebungsthemen,
  themaGehoert,
  vorabBlaetter,
  vorhandenesBlatt,
} from "@/lib/arbeitsblatt/ablauf";
import { blattErgebnis } from "@/lib/arbeitsblatt/auftrag";
import { ABSCHRIFT_MATHE, UEBUNG_MATHE } from "@/lib/arbeitsblatt/beispiel";
import { bauFehlgeschlagen, bauFertig, wertungSetzen } from "@/lib/arbeitsblatt/stand";
import {
  blattMitAbschrift,
  fachMitThema,
  frageMitTerminen,
  klausurMitBlock,
} from "@/lib/arbeitsblatt/test-saat";
import { protokollVomTag } from "@/lib/protokoll";
import { recallSchedule } from "@/recall/schema";

/** 16:40 Berliner Zeit an diesem Tag (Sommerzeit, UTC+2). */
const um = (tag: string, hhmm = "16:40") => new Date(`${tag}T${hhmm}:00+02:00`);

let nutzer = "";
let fach = "";
let thema = "";
let material = "";
const fragen: string[] = [];

async function termine() {
  return testDb
    .select({ id: recallSchedule.id, itemId: recallSchedule.itemId, dueOn: recallSchedule.dueOn, doneAt: recallSchedule.doneAt })
    .from(recallSchedule)
    .where(inArray(recallSchedule.itemId, fragen))
    .orderBy(asc(recallSchedule.dueOn), asc(recallSchedule.id));
}

async function fertigesBlatt(id: string) {
  const e = blattErgebnis(
    UEBUNG_MATHE,
    { fach: "Mathematik", thema: "Quadratische Funktionen", blaetter: [{ materialId: material, titel: "Scheitelpunktform, Übungen", datum: "2026-10-08", seiten: [ABSCHRIFT_MATHE] }] },
    "kaestchen",
  );
  if (e.art !== "fertig") throw new Error("Beispiel ungültig");
  await bauFertig(nutzer, id, e.inhalt, um("2026-10-12", "06:00"));
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const f = await fachMitThema(nutzer, "Mathematik", "Quadratische Funktionen", "2026-10-01");
  fach = f.subjectId;
  thema = f.topicId;
  material = await blattMitAbschrift(nutzer, fach, thema, "Scheitelpunktform, Übungen", "2026-10-08", ABSCHRIFT_MATHE);
  // Zwei Fragen am Thema: Termine 10.10. (überfällig), 12.10., 16.10. und 12.10., 19.10.
  fragen.push(await frageMitTerminen(nutzer, fach, thema, ["2026-10-10", "2026-10-12", "2026-10-16"]));
  fragen.push(await frageMitTerminen(nutzer, fach, thema, ["2026-10-12", "2026-10-19"]));
});

describe("Arbeitsblatt im Alltag (Plan H, Frage 3 a)", () => {
  it("Mathematik ist ein Übungsthema und am 12.10. fällig", async () => {
    const f = await faelligeUebungsthemen(nutzer, "2026-10-12");
    assert.deepEqual(f.map((t) => t.topicId), [thema]);
    assert.equal(f[0].dueOn, "2026-10-10");
  });

  it("Wertung, Auswertung: nur die heute fälligen Termine bekommen done_at, kein due_on ändert sich", async () => {
    const vorher = await termine();
    const zeile = await blattFuerThema(nutzer, thema, "2026-10-12");
    await fertigesBlatt(zeile.id);

    // Erst wenn jede Aufgabe bewertet ist (Kriterium 3)
    for (const nr of [1, 2, 3, 5, 6]) await wertungSetzen(nutzer, zeile.id, nr, true);
    await assert.rejects(blattAuswerten(nutzer, zeile.id, um("2026-10-12"), false));
    await wertungSetzen(nutzer, zeile.id, 4, false);

    const a = await blattAuswerten(nutzer, zeile.id, um("2026-10-12"), false);
    assert.equal(a.n, 6);
    assert.equal(a.richtig, 5);
    assert.deepEqual(a.falsch, [4]);
    assert.equal(a.termineErledigt, 3);
    assert.equal(a.wiederDran, "2026-10-16");

    const nachher = await termine();
    assert.deepEqual(nachher.map((t) => [t.id, t.dueOn]), vorher.map((t) => [t.id, t.dueOn]));
    for (const t of nachher) {
      assert.equal(t.doneAt !== null, t.dueOn <= "2026-10-12", `${t.dueOn}`);
    }
    const log = await protokollVomTag(nutzer, "2026-10-12");
    const e = log.find((x) => x.typ === "blatt_ausgewertet");
    assert.deepEqual(e?.daten, { n: 6, richtig: 5 });

    // nur einmal
    await assert.rejects(blattAuswerten(nutzer, zeile.id, um("2026-10-12"), false));
  });

  it("ausgewertet am 12.10., nächster Termin 16.10.: am 13.10. nicht fällig, am 16.10. wieder", async () => {
    assert.deepEqual(await faelligeUebungsthemen(nutzer, "2026-10-13"), []);
    assert.deepEqual(await faelligeUebungsthemen(nutzer, "2026-10-15"), []);
    const am16 = await faelligeUebungsthemen(nutzer, "2026-10-16");
    assert.deepEqual(am16.map((t) => [t.topicId, t.dueOn]), [[thema, "2026-10-16"]]);
  });

  it("vorab bauen: am 13. und 14.10. entsteht kein neues Blatt, für den 13.–15.10. nie", async () => {
    for (const tag of ["2026-10-13", "2026-10-14"]) {
      assert.deepEqual(await vorabBlaetter(nutzer, um(tag, "18:00")), []);
    }
    await vorabBlaetter(nutzer, um("2026-10-15", "18:00"));
    const zeilen = await testDb
      .select({ tag: arbeitsblaetter.tag })
      .from(arbeitsblaetter)
      .where(eq(arbeitsblaetter.subjectTopicId, thema));
    const tage = zeilen.map((z) => z.tag).sort();
    assert.ok(!tage.some((t) => t > "2026-10-12" && t < "2026-10-16"), tage.join(","));
    // am 15. abends wird für den Termin am 16. vorab gebaut
    assert.ok(tage.includes("2026-10-16"));
  });

  it("ein offenes Blatt gilt weiter: gedruckt am Montag, am Dienstag dasselbe Blatt", async () => {
    const t2 = await fachMitThema(nutzer, "Physik", "Gleichförmige Bewegung", "2026-10-01");
    await frageMitTerminen(nutzer, t2.subjectId, t2.topicId, ["2026-10-12", "2026-10-13"]);
    const mo = await blattFuerThema(nutzer, t2.topicId, "2026-10-12");
    const di = await blattFuerThema(nutzer, t2.topicId, "2026-10-13");
    assert.equal(mo.id, di.id);
  });

  it("fehlgeschlagen nach zwei Versuchen: das Thema baut heute nicht mehr; Stand nennt hatFragen", async () => {
    const t3 = await fachMitThema(nutzer, "Deutsch", "Kommasetzung", "2026-10-01");
    await frageMitTerminen(nutzer, t3.subjectId, t3.topicId, ["2026-10-12"]);
    assert.ok((await faelligeUebungsthemen(nutzer, "2026-10-12")).some((t) => t.topicId === t3.topicId));
    const z = await blattFuerThema(nutzer, t3.topicId, "2026-10-12");
    await testDb.update(arbeitsblaetter).set({ versuche: 2 }).where(eq(arbeitsblaetter.id, z.id));
    await bauFehlgeschlagen(nutzer, z.id);
    assert.ok(!(await faelligeUebungsthemen(nutzer, "2026-10-12")).some((t) => t.topicId === t3.topicId));
    const stand = await blattStand(nutzer, z.id, um("2026-10-12"));
    assert.equal(stand?.status, "fehlgeschlagen");
    assert.equal(stand?.weiter, false);
    assert.equal(stand?.hatFragen, true);
  });

  it("fremde Themen: themaGehoert sagt nein, blattStand nennt Titel und Fach nicht", async () => {
    const fremd = await testNutzer();
    const t = await fachMitThema(fremd, "Biologie", "Zellteilung", "2026-10-01");
    assert.equal(await themaGehoert(nutzer, t.topicId), false);
    assert.equal(await themaGehoert(fremd, t.topicId), true);
    // Eine Zeile mit fremdem Thema (wie sie vor der Prüfung entstehen konnte): kein Leck
    const [z] = await testDb
      .insert(arbeitsblaetter)
      .values({ userId: nutzer, subjectTopicId: t.topicId, tag: "2026-10-12" })
      .returning();
    const stand = await blattStand(nutzer, z.id, um("2026-10-12"));
    assert.equal(stand?.thema, "");
    assert.equal(stand?.fach, "");
  });

  it("ohne Schlüssel: vorhandenesBlatt legt nichts an", async () => {
    const t = await fachMitThema(nutzer, "Chemie", "Redoxreaktionen", "2026-10-01");
    await frageMitTerminen(nutzer, t.subjectId, t.topicId, ["2026-10-12"]);
    assert.equal(await vorhandenesBlatt(nutzer, { thema: t.topicId }, "2026-10-12"), null);
    const zeilen = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.subjectTopicId, t.topicId));
    assert.equal(zeilen.length, 0);
    const neu = await blattFuerThema(nutzer, t.topicId, "2026-10-12");
    assert.equal((await vorhandenesBlatt(nutzer, { thema: t.topicId }, "2026-10-12"))?.id, neu.id);
  });

  it("Blatt des heutigen Lernblocks beim Wiederholen ausgewertet: der Block ist erledigt (perWH)", async () => {
    const t4 = await fachMitThema(nutzer, "Mathematik II", "Potenzen", "2026-10-01");
    await blattMitAbschrift(nutzer, t4.subjectId, t4.topicId, "Potenzen", "2026-10-09", ABSCHRIFT_MATHE);
    const { blockId } = await klausurMitBlock(nutzer, t4.subjectId, "2026-10-16", "2026-10-12", t4.topicId, true);
    // WH-Blatt des Themas von heute, danach übernimmt der Block es
    const wh = await blattFuerThema(nutzer, t4.topicId, "2026-10-12");
    const bl = await blattFuerBlock(nutzer, blockId);
    assert.equal(bl?.id, wh.id);
    await fertigesBlatt(wh.id);
    for (let nr = 1; nr <= 6; nr += 1) await wertungSetzen(nutzer, wh.id, nr, true);
    const a = await blattAuswerten(nutzer, wh.id, um("2026-10-12"), false);
    assert.equal(a.blockErledigt, true);
    const [b] = await testDb.select().from(studyBlocks).where(and(eq(studyBlocks.id, blockId)));
    assert.equal(b.status, "done");
    const log = await protokollVomTag(nutzer, "2026-10-12");
    const e = log.find((x) => x.typ === "lernblock_erledigt" && x.ref === blockId);
    assert.deepEqual(e?.daten, { n: 0, perWH: true });
  });
});
