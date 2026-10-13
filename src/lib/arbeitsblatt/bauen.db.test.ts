import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { arbeitsblaetter, leserLaeufe, subjectTopics } from "@/db/schema";
import { blattFuerBlock } from "@/lib/arbeitsblatt/ablauf";
import { blattBauen } from "@/lib/arbeitsblatt/bauen";
import { ABSCHRIFT_MATHE, UEBUNG_MATHE } from "@/lib/arbeitsblatt/beispiel";
import { inhaltSchema } from "@/lib/arbeitsblatt/schema";
import { arbeitsblattFuer } from "@/lib/arbeitsblatt/stand";
import { grammatikThemen } from "@/lib/kombi/grammatik-themen";
import {
  blattMitAbschrift,
  fachMitThema,
  klausurMitBlock,
  senderMit,
} from "@/lib/arbeitsblatt/test-saat";

const TAG = "2026-10-12";
const T0 = new Date("2026-10-12T14:40:00.000Z");
const MIN = 60_000;

let nutzer = "";
let fach = "";
let thema = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const f = await fachMitThema(nutzer, "Mathematik", "Quadratische Funktionen", TAG);
  fach = f.subjectId;
  thema = f.topicId;
  await blattMitAbschrift(nutzer, fach, thema, "Scheitelpunktform, Übungen", "2026-10-08", ABSCHRIFT_MATHE);
});

describe("Arbeitsblatt bauen (gemockter Claude-Aufruf)", () => {
  it("baut aus der Abschrift ein Blatt, vermerkt den Lauf mit art='arbeitsblatt'", async () => {
    const zeile = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, TAG);
    const { senden, aufrufe } = senderMit(UEBUNG_MATHE);
    const e = await blattBauen(nutzer, zeile.id, { senden, jetzt: () => T0 });
    assert.equal(aufrufe(), 1);
    assert.ok(e.gebaut && e.status === "fertig");

    const [neu] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, zeile.id));
    assert.equal(neu.status, "fertig");
    assert.equal(neu.versuche, 1);
    const inhalt = inhaltSchema.parse(neu.inhalt);
    assert.equal(inhalt.aufgaben.length, 6);
    assert.equal(inhalt.papier, "kaestchen");
    assert.equal(inhalt.quellen[0].titel, "Scheitelpunktform, Übungen");

    const laeufe = await testDb.select().from(leserLaeufe).where(eq(leserLaeufe.arbeitsblattId, zeile.id));
    assert.equal(laeufe.length, 1);
    assert.equal(laeufe[0].art, "arbeitsblatt");
    assert.equal(laeufe[0].materialId, null);
    assert.equal(laeufe[0].ergebnis, "vorschlag");
    assert.ok(laeufe[0].kostenUsd !== null);

    // fertig ist Endstatus: kein zweiter Bau, kein Aufruf
    const zweiter = await blattBauen(nutzer, zeile.id, { senden, jetzt: () => T0 });
    assert.equal(zweiter.gebaut, false);
    assert.equal(aufrufe(), 1);
  });

  it("ein Lauf mit gesetztem material_id und art='arbeitsblatt' wird abgewiesen", async () => {
    const [m] = await testDb.select({ id: arbeitsblaetter.id }).from(arbeitsblaetter).limit(1);
    await assert.rejects(
      testDb.insert(leserLaeufe).values({
        userId: nutzer,
        art: "arbeitsblatt",
        arbeitsblattId: m.id,
        materialId: (await blattMitAbschrift(nutzer, fach, thema, "X", TAG, "x")),
        ergebnis: "vorschlag",
        grund: "",
      }),
    );
  });

  it("zu wenig gebundene Aufgaben: fehlgeschlagen; hängend wird per UPDATE neu angestoßen; dritter Versuch abgelehnt", async () => {
    const zeile = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, "2026-10-13");
    const erfunden = {
      ...UEBUNG_MATHE,
      aufgaben: UEBUNG_MATHE.aufgaben.map((a) => ({ ...(a as object), zitat: "Steht nirgends." })),
    };
    const { senden, aufrufe } = senderMit(erfunden);

    const e1 = await blattBauen(nutzer, zeile.id, { senden, jetzt: () => T0 });
    assert.ok(e1.gebaut && e1.status === "fehlgeschlagen");

    // Ein Bau „hängt“: laeuft mit abgelaufener Frist (Neustart des Containers)
    await testDb
      .update(arbeitsblaetter)
      .set({ status: "laeuft", fristBis: new Date(T0.getTime() - MIN) })
      .where(eq(arbeitsblaetter.id, zeile.id));
    const e2 = await blattBauen(nutzer, zeile.id, { senden, jetzt: () => T0 });
    assert.ok(e2.gebaut);
    const zeilen = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.subjectTopicId, thema));
    assert.equal(zeilen.filter((z) => z.tag === "2026-10-13").length, 1, "keine neue Zeile");
    assert.equal(zeilen.find((z) => z.id === zeile.id)?.versuche, 2);

    const e3 = await blattBauen(nutzer, zeile.id, { senden, jetzt: () => T0 });
    assert.equal(e3.gebaut, false);
    assert.equal(aufrufe(), 2);
  });

  it("ohne Abschrift: fehlgeschlagen ohne Aufruf", async () => {
    const leer = await fachMitThema(nutzer, "Physik", "Hebelgesetz", TAG);
    const zeile = await arbeitsblattFuer(nutzer, { subjectTopicId: leer.topicId }, TAG);
    const { senden, aufrufe } = senderMit(UEBUNG_MATHE);
    const e = await blattBauen(nutzer, zeile.id, { senden, jetzt: () => T0 });
    assert.ok(e.gebaut && e.status === "fehlgeschlagen");
    assert.equal(aufrufe(), 0);
  });

  it("ohne Schlüssel wird nichts gebaut und nichts geändert", async () => {
    const zeile = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, "2026-10-14");
    const e = await blattBauen(nutzer, zeile.id, { konfiguriert: false, jetzt: () => T0 });
    assert.equal(e.gebaut, false);
    const [z] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, zeile.id));
    assert.equal(z.status, "wartet");
    assert.equal(z.versuche, 0);
  });

  it("Blatt für einen Gesamtwiederholungs-Block ohne Fach-Thema wird angelegt und aus den Klausurthemen gebaut", async () => {
    const { blockId } = await klausurMitBlock(nutzer, fach, "2026-10-16", TAG, thema, false);
    const zeile = await blattFuerBlock(nutzer, blockId);
    assert.ok(zeile, "Mathe-Klausur: der Block ist ein Arbeitsblatt (Kriterium 4)");
    assert.equal(zeile.subjectTopicId, null);
    assert.equal(zeile.studyBlockId, blockId);
    const { senden } = senderMit(UEBUNG_MATHE);
    const e = await blattBauen(nutzer, zeile.id, { senden, jetzt: () => T0 });
    assert.ok(e.gebaut && e.status === "fertig");
  });

  it("ein Englisch-Grammatikthema bekommt den Auftrag auf Englisch (Antwort 5), Mathe keinen", async () => {
    const en = await fachMitThema(nutzer, "Englisch", "Simple past", TAG);
    await blattMitAbschrift(nutzer, en.subjectId, en.topicId, "Simple past", "2026-10-08", "Simple past: verb + ed. I played football.");
    const anfragen: string[] = [];
    const leer = { teil: "", minuten: 20, aufgaben: [], grund: "Test" };
    const { senden } = senderMit(leer);
    const mitschreiben: typeof senden = (anfrage, signal, begonnen) => {
      anfragen.push(JSON.stringify(anfrage));
      return senden(anfrage, signal, begonnen);
    };
    const zeile = await arbeitsblattFuer(nutzer, { subjectTopicId: en.topicId }, TAG);
    await blattBauen(nutzer, zeile.id, { senden: mitschreiben, jetzt: () => T0 });
    assert.equal(anfragen.length, 1);
    assert.ok(anfragen[0].includes("Sprache des Blatts: Englisch"));

    const ma = await arbeitsblattFuer(nutzer, { subjectTopicId: thema }, "2026-10-15");
    await blattBauen(nutzer, ma.id, { senden: mitschreiben, jetzt: () => T0 });
    assert.equal(anfragen.length, 2);
    assert.ok(!anfragen[1].includes("Sprache des Blatts"));
  });

  it("Zeile und Auftrag folgen einer Regel: von Hand auf üben ohne Stichwort ist kein Grammatikthema", async () => {
    const en = await fachMitThema(nutzer, "Englisch", "Unit 3 if-sentences", TAG);
    await testDb.update(subjectTopics).set({ art: "ueben" }).where(eq(subjectTopics.id, en.topicId));
    await blattMitAbschrift(nutzer, en.subjectId, en.topicId, "Unit 3", "2026-10-08", "If it rains, we stay at home.");
    const [gr] = await testDb
      .insert(subjectTopics)
      .values({ userId: nutzer, subjectId: en.subjectId, title: "Present perfect", matchKey: "present perfect", lastSeenAt: TAG })
      .returning({ id: subjectTopics.id });
    await blattMitAbschrift(nutzer, en.subjectId, gr.id, "Present perfect", "2026-10-08", "have + past participle");

    // Zeile: nur das Stichwort-Thema steht unter „Blatt Grammatik“
    const zeile = await grammatikThemen(nutzer, [{ id: en.subjectId, name: "Englisch" }]);
    assert.deepEqual(zeile.map((t) => t.name), ["Present perfect"]);

    // Auftrag: dasselbe Urteil
    const anfragen: string[] = [];
    const { senden } = senderMit({ teil: "", minuten: 20, aufgaben: [], grund: "Test" });
    const mitschreiben: typeof senden = (anfrage, signal, begonnen) => {
      anfragen.push(JSON.stringify(anfrage));
      return senden(anfrage, signal, begonnen);
    };
    const hand = await arbeitsblattFuer(nutzer, { subjectTopicId: en.topicId }, TAG);
    await blattBauen(nutzer, hand.id, { senden: mitschreiben, jetzt: () => T0 });
    const stich = await arbeitsblattFuer(nutzer, { subjectTopicId: gr.id }, TAG);
    await blattBauen(nutzer, stich.id, { senden: mitschreiben, jetzt: () => T0 });
    assert.equal(anfragen.length, 2);
    assert.ok(anfragen[0].includes("Sprache des Blatts: Englisch"));
    assert.ok(!anfragen[0].includes("Grammatikblatt"), "von Hand umgestellt: kein Grammatikblatt");
    assert.ok(anfragen[1].includes("Grammatikblatt"), "Stichwort: Grammatikblatt");

    // Stichwort, aber von Hand auf abfragen: weder in der Zeile noch Grammatikblatt
    await testDb.update(subjectTopics).set({ art: "abfragen" }).where(eq(subjectTopics.id, gr.id));
    assert.deepEqual(await grammatikThemen(nutzer, [{ id: en.subjectId, name: "Englisch" }]), []);
  });

  it("ein Block vor einer Klausur aus Wissensthemen ist kein Arbeitsblatt", async () => {
    const ge = await fachMitThema(nutzer, "Geschichte", "Industrialisierung", TAG);
    const { blockId } = await klausurMitBlock(nutzer, ge.subjectId, "2026-10-20", TAG, ge.topicId, true);
    assert.equal(await blattFuerBlock(nutzer, blockId), null);
  });
});
