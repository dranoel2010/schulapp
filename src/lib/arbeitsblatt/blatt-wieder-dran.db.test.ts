import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { and, asc, inArray, isNull } from "drizzle-orm";

import { exams } from "@/db/schema";
import { blattAuswerten, blattFuerThema } from "@/lib/arbeitsblatt/ablauf";
import { blattErgebnis } from "@/lib/arbeitsblatt/auftrag";
import { ABSCHRIFT_MATHE, UEBUNG_MATHE } from "@/lib/arbeitsblatt/beispiel";
import { bauFertig, wertungSetzen } from "@/lib/arbeitsblatt/stand";
import { blattMitAbschrift, fachMitThema, frageMitTerminen } from "@/lib/arbeitsblatt/test-saat";
import { dauertaktNachlegen } from "@/recall/nachlegen";
import { recallSchedule } from "@/recall/schema";

/**
 * Abnahmerunde 20: Schließt die Auswertung eines Arbeitsblatts beim
 * Wiederholen die letzten offenen Termine des Themas, fehlte „Wieder dran“
 * auf dem Endbildschirm (null). Der Tag wurde gelesen, bevor der nächste
 * Termin nachgelegt war. Jetzt nennt das Blatt den Tag, den das Nachlegen
 * danach anlegt, wie die Karten (`naechsterTerminThema()`).
 */

const HEUTE = "2026-10-14";
const um = (tag: string, hhmm = "16:41") => new Date(`${tag}T${hhmm}:00+02:00`);

let nutzer = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("BlattWiederDran");
});

/** Thema mit Fragen, deren Termine alle bis heute liegen; Blatt gebaut, alles „Richtig“, ausgewertet. */
async function blattGanzAusgewertet(fachName: string, klausurtag: string | null) {
  const f = await fachMitThema(nutzer, fachName, "Quadratische Funktionen", "2026-10-01");
  if (klausurtag) await testDb.insert(exams).values({ userId: nutzer, subjectId: f.subjectId, date: klausurtag });
  const material = await blattMitAbschrift(nutzer, f.subjectId, f.topicId, "Scheitelpunktform, Übungen", "2026-10-08", ABSCHRIFT_MATHE);
  const frage = await frageMitTerminen(nutzer, f.subjectId, f.topicId, ["2026-10-12", HEUTE]);

  const zeile = await blattFuerThema(nutzer, f.topicId, HEUTE);
  const e = blattErgebnis(
    UEBUNG_MATHE,
    { fach: fachName, thema: "Quadratische Funktionen", blaetter: [{ materialId: material, titel: "Scheitelpunktform, Übungen", datum: "2026-10-08", seiten: [ABSCHRIFT_MATHE] }] },
    "kaestchen",
  );
  if (e.art !== "fertig") throw new Error("Beispiel ungültig");
  await bauFertig(nutzer, zeile.id, e.inhalt, um(HEUTE, "06:00"));
  for (let nr = 1; nr <= UEBUNG_MATHE.aufgaben.length; nr += 1) await wertungSetzen(nutzer, zeile.id, nr, true);

  const a = await blattAuswerten(nutzer, zeile.id, um(HEUTE), false);
  const offen = () =>
    testDb
      .select({ dueOn: recallSchedule.dueOn })
      .from(recallSchedule)
      .where(and(inArray(recallSchedule.itemId, [frage]), isNull(recallSchedule.doneAt)))
      .orderBy(asc(recallSchedule.dueOn));
  const offenNachAuswertung = (await offen()).length;

  // Was das Nachlegen beim nächsten Lesen (Startseite, Zeile, Tisch) anlegt
  await dauertaktNachlegen(nutzer, HEUTE);
  const nachgelegt = (await offen())[0]?.dueOn ?? null;
  return { a, offenNachAuswertung, nachgelegt };
}

describe("„Wieder dran“ nach einem Arbeitsblatt, das die letzten Termine schließt", () => {
  it("ohne Klausur: der Tag aus dem Dauertakt", async () => {
    const r = await blattGanzAusgewertet("Mathematik", null);
    assert.equal(r.a.termineErledigt, 2);
    assert.equal(r.offenNachAuswertung, 0);
    assert.equal(r.nachgelegt, "2026-10-28");
    assert.equal(r.a.wiederDran, r.nachgelegt);
  });

  it("mit Klausur im Fach: der erste Termin des Lernplans", async () => {
    const r = await blattGanzAusgewertet("Physik", "2026-10-20");
    assert.equal(r.offenNachAuswertung, 0);
    assert.ok(r.nachgelegt !== null && r.nachgelegt > HEUTE, `${r.nachgelegt}`);
    assert.equal(r.a.wiederDran, r.nachgelegt);
  });
});
