import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DAUERTAKT,
  dauertaktTermin,
  ersterSchultagAb,
  nachlegenPlan,
  tagesauswahl,
  tagUnterGrenze,
  zaehltZurGrenze,
  type BausteinStand,
} from "@/recall/dauertakt";

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

describe("nachlegenPlan", () => {
  const b = (x: Partial<Parameters<typeof nachlegenPlan>[0]> = {}) =>
    nachlegenPlan({ ...stand(), klausurtag: null, heute: "2026-10-12", ...x });

  it("ohne Klausur: genau ein Termin im Dauertakt", () => {
    assert.deepEqual(b({ zuletzt: "2026-10-01" }), [{ dueOn: "2026-10-15", mode: "erhaltung" }]);
    assert.deepEqual(b({ zuletzt: "2026-10-01", offen: ["2026-10-20"] }), []);
  });

  it("mit Klausur und ohne offenen Termin: Termine bis zur Klausur ab heute, dazu die Erhaltung", () => {
    const p = b({ zuletzt: "2026-10-04", klausurtag: "2026-11-30" });
    const vor = p.filter((t) => t.mode === "klausur");
    assert.equal(vor[0].dueOn, "2026-10-12");
    assert.ok(vor.length >= 4 && vor.every((t) => t.dueOn < "2026-11-30"));
    assert.ok(p.some((t) => t.mode === "erhaltung"));
  });

  it("mit Klausur und offenem Termin davor: nichts", () => {
    assert.deepEqual(b({ klausurtag: "2026-11-30", offen: ["2026-11-02"] }), []);
  });

  it("mit Klausur und offenem Termin nur dahinter: Termine davor, keine zweite Erhaltung", () => {
    const p = b({ zuletzt: "2026-10-08", klausurtag: "2026-10-19", offen: ["2026-10-22"] });
    assert.ok(p.length > 0);
    assert.ok(p.every((t) => t.mode === "klausur" && t.dueOn < "2026-10-19"));
  });

  it("ein offener Termin bis zur Blattauswertung zählt auch mit Klausur nicht", () => {
    const p = b({ klausurtag: "2026-11-30", offen: ["2026-09-05"], ausgewertet: "2026-09-20" });
    assert.ok(p.some((t) => t.mode === "klausur"));
  });

  it("Ferien sperren die Tage vor der Klausur", () => {
    const p = b({ zuletzt: "2026-10-10", klausurtag: "2026-11-30", sperrtage: ["2026-10-13"] });
    assert.ok(!p.some((t) => t.dueOn === "2026-10-13"));
  });
});

type T = { name: string; klausur: string | null; angefangen: boolean; istEpoche: boolean };
const t = (name: string, klausur: string | null = null, angefangen = false, istEpoche = false): T => ({
  name,
  klausur,
  angefangen,
  istEpoche,
});
const epoche = (name: string): T => t(name, null, false, true);
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

  it("die Epoche ohne Klausur zählt nicht zur Grenze: Epoche und Französisch kommen beide", () => {
    const sortiert = [epoche("Reformation"), t("Vokabeln"), epoche("Bauernkrieg"), t("Passé composé")];
    assert.deepEqual(namen(tagesauswahl(sortiert, lage)), ["Reformation", "Vokabeln", "Bauernkrieg"]);
  });

  it("eine beendete Epoche verbraucht den Platz nicht, ein beendetes Französisch schon", () => {
    const sortiert = [epoche("Reformation"), t("Vokabeln")];
    assert.deepEqual(namen(tagesauswahl(sortiert, { ...lage, ohneKlausurBeendet: 1 })), ["Reformation"]);
  });

  it("mit offenem Lernblock steht die Epoche bei den Klausurthemen, das begrenzte Thema hinten", () => {
    const sortiert = [t("Vokabeln"), epoche("Reformation"), t("Funktionen", "2026-10-20")];
    assert.deepEqual(namen(tagesauswahl(sortiert, { ...lage, lernblockOffen: true })), ["Reformation", "Funktionen", "Vokabeln"]);
  });
});

describe("zaehltZurGrenze", () => {
  it("nur ohne Klausur und außerhalb der Epoche", () => {
    assert.equal(zaehltZurGrenze({ klausur: null, istEpoche: false }), true);
    assert.equal(zaehltZurGrenze({ klausur: null, istEpoche: true }), false);
    assert.equal(zaehltZurGrenze({ klausur: "2026-10-20", istEpoche: false }), false);
  });
});

describe("ersterSchultagAb", () => {
  const herbst = { kind: "ferien", startsOn: "2026-10-19", endsOn: "2026-10-30" };
  const brueckentag = { kind: "frei", startsOn: "2026-10-31", endsOn: "2026-11-01" };
  it("ein Tag außerhalb der Ferien bleibt", () => {
    assert.equal(ersterSchultagAb("2026-10-18", [herbst]), "2026-10-18");
  });
  it("ein Tag in den Ferien rückt auf den ersten Tag danach, auch über zwei Zeiträume", () => {
    assert.equal(ersterSchultagAb("2026-10-27", [herbst]), "2026-10-31");
    assert.equal(ersterSchultagAb("2026-10-27", [herbst, brueckentag]), "2026-11-02");
  });
});

describe("tagUnterGrenze", () => {
  const FERIEN = [{ startsOn: "2026-10-19", endsOn: "2026-10-30" }];
  const en = { key: "en", termine: ["2026-10-27"], name: "Englisch Wortschatz" };
  const fr = { key: "fr", termine: ["2026-10-28"], name: "Französisch Vocabulaire" };

  it("allein: der eigene Termin, aus den Ferien auf den ersten Tag danach", () => {
    assert.equal(tagUnterGrenze(en, [], "2026-10-14", FERIEN), "2026-10-31");
    assert.equal(tagUnterGrenze(en, [], "2026-10-14", []), "2026-10-27");
  });

  it("zwei Themen mit Terminen in den Ferien: das zweite bekommt den Tag danach", () => {
    assert.equal(tagUnterGrenze(en, [fr], "2026-10-14", FERIEN), "2026-10-31");
    assert.equal(tagUnterGrenze(fr, [en], "2026-10-15", FERIEN), "2026-11-01");
  });

  it("ein drittes rückt weiter, ein späteres stört nicht", () => {
    const de = { key: "de", termine: ["2026-10-20"], name: "Deutsch Kommasetzung" };
    const spaet = { key: "sp", termine: ["2026-11-05"], name: "Spanisch" };
    assert.equal(tagUnterGrenze(fr, [en, de, spaet], "2026-10-15", FERIEN), "2026-11-02");
  });

  it("gleicher Termin: mehr fällige Fragen zuerst, dann alphabetisch", () => {
    const a = { key: "a", termine: ["2026-10-27"], name: "A" };
    const b = { key: "b", termine: ["2026-10-27", "2026-10-27"], name: "B" };
    assert.equal(tagUnterGrenze(a, [b], "2026-10-14", []), "2026-10-28");
    const c = { key: "c", termine: ["2026-10-27"], name: "C" };
    assert.equal(tagUnterGrenze(a, [c], "2026-10-14", []), "2026-10-27");
    assert.equal(tagUnterGrenze(c, [a], "2026-10-14", []), "2026-10-28");
  });

  it("ein überfälliges anderes Thema belegt morgen, das eigene kommt danach", () => {
    const alt = { key: "alt", termine: ["2026-10-10"], name: "Alt" };
    const eigen = { key: "e", termine: ["2026-10-14"], name: "Eigen" };
    assert.equal(tagUnterGrenze(eigen, [alt], "2026-10-14", []), "2026-10-15");
  });

  it("ein freier Platz vor dem eigenen Termin wird nicht vorgezogen", () => {
    const frueh = { key: "f", termine: ["2026-10-15"], name: "Früh" };
    assert.equal(tagUnterGrenze(en, [frueh], "2026-10-14", []), "2026-10-27");
  });
});
