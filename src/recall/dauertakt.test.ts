import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DAUERTAKT, dauertaktTermin, tagesauswahl, type BausteinStand } from "@/recall/dauertakt";

const stand = (s: Partial<BausteinStand> = {}): BausteinStand => ({
  klausur: false,
  offen: [],
  zuletzt: null,
  aufgenommen: "2026-09-01",
  ausgewertet: null,
  ...s,
});

describe("dauertaktTermin", () => {
  it("ohne offenen Termin: DAUERTAKT Tage nach dem letzten Kontakt", () => {
    assert.equal(DAUERTAKT, 14);
    assert.equal(dauertaktTermin(stand({ zuletzt: "2026-10-01" })), "2026-10-15");
  });

  it("nie erledigt: ab der Aufnahme", () => {
    assert.equal(dauertaktTermin(stand()), "2026-09-15");
  });

  it("mit offenem Termin: kein neuer", () => {
    assert.equal(dauertaktTermin(stand({ offen: ["2026-10-20"], zuletzt: "2026-10-01" })), null);
  });

  it("Fach mit Klausur: plant der Lernplan, kein Dauertakt", () => {
    assert.equal(dauertaktTermin(stand({ klausur: true })), null);
  });

  it("offene Termine bis zur Blattauswertung zählen nicht, der Takt läuft ab der Auswertung", () => {
    const s = stand({ offen: ["2026-10-02", "2026-10-05"], zuletzt: "2026-09-20", ausgewertet: "2026-10-05" });
    assert.equal(dauertaktTermin(s), "2026-10-19");
    assert.equal(dauertaktTermin({ ...s, offen: ["2026-10-06"] }), null);
  });

  it("darf in der Vergangenheit liegen (überfällig)", () => {
    assert.equal(dauertaktTermin(stand({ aufgenommen: "2026-05-01", zuletzt: "2026-06-01" })), "2026-06-15");
  });
});

type T = { name: string; klausur: string | null; angefangen: boolean };
const t = (name: string, klausur: string | null = null, angefangen = false): T => ({ name, klausur, angefangen });
const lage = { ferien: false, ohneKlausurBeendet: 0, lernblockOffen: false };
const namen = (l: T[]) => l.map((x) => x.name);

describe("tagesauswahl", () => {
  it("von den Themen ohne Klausur nur das fälligste, die mit Klausur alle", () => {
    const sortiert = [t("Vokabeln Unit 3"), t("Funktionen", "2026-10-20"), t("Passé composé"), t("Brüche", "2026-11-02")];
    assert.deepEqual(namen(tagesauswahl(sortiert, lage)), ["Vokabeln Unit 3", "Funktionen", "Brüche"]);
  });

  it("eins pro Tag: nach einem beendeten Thema ohne Klausur kommt keins mehr", () => {
    const sortiert = [t("Passé composé"), t("Funktionen", "2026-10-20")];
    assert.deepEqual(namen(tagesauswahl(sortiert, { ...lage, ohneKlausurBeendet: 1 })), ["Funktionen"]);
  });

  it("ein angefangenes Thema ohne Klausur bleibt und belegt den Platz", () => {
    const sortiert = [t("Vokabeln"), t("Passé composé", null, true)];
    assert.deepEqual(namen(tagesauswahl(sortiert, lage)), ["Passé composé"]);
    assert.deepEqual(namen(tagesauswahl(sortiert, { ...lage, ohneKlausurBeendet: 1 })), ["Passé composé"]);
  });

  it("Ferien: nichts", () => {
    assert.deepEqual(tagesauswahl([t("Vokabeln"), t("Funktionen", "2026-10-20")], { ...lage, ferien: true }), []);
  });

  it("mit offenem Lernblock rutscht das Thema ohne Klausur nach hinten", () => {
    const sortiert = [t("Vokabeln"), t("Funktionen", "2026-10-20"), t("Brüche", "2026-11-02")];
    assert.deepEqual(namen(tagesauswahl(sortiert, { ...lage, lernblockOffen: true })), ["Funktionen", "Brüche", "Vokabeln"]);
  });

  it("ohne Themen ohne Klausur bleibt die Folge unverändert", () => {
    const sortiert = [t("Funktionen", "2026-10-20"), t("Brüche", "2026-11-02")];
    assert.deepEqual(namen(tagesauswahl(sortiert, lage)), ["Funktionen", "Brüche"]);
  });
});
