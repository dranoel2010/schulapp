import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  artAbgeleitet,
  gespeicherteArt,
  hatGrammatikStichwort,
  themaArt,
} from "@/lib/themen-art";

const MATHE = { name: "Mathematik" };
const GESCHICHTE = { name: "Geschichte" };
const FRANZ = { name: "Französisch" };
const DEUTSCH = { name: "Deutsch" };
const ENGLISCH = { name: "Englisch" };

describe("themaArt (Plan 3.6)", () => {
  it("Mathematik und Physik üben", () => {
    assert.equal(artAbgeleitet({ title: "Quadratische Funktionen" }, MATHE), "ueben");
    assert.equal(artAbgeleitet({ title: "Elektrischer Widerstand" }, { name: "Physik" }), "ueben");
  });

  it("Wissensfächer fragen ab", () => {
    assert.equal(artAbgeleitet({ title: "Industrialisierung in England" }, GESCHICHTE), "abfragen");
    assert.equal(artAbgeleitet({ title: "Zellatmung" }, { name: "Biologie" }), "abfragen");
  });

  it("Sprachen üben nur mit Grammatik-Stichwort", () => {
    assert.equal(artAbgeleitet({ title: "Passé composé mit être" }, FRANZ), "ueben");
    assert.equal(artAbgeleitet({ title: "Vokabeln Unit 3" }, ENGLISCH), "abfragen");
    assert.equal(artAbgeleitet({ title: "Simple past and present perfect" }, ENGLISCH), "ueben");
    assert.equal(artAbgeleitet({ title: "Konjunktiv II" }, DEUTSCH), "ueben");
    assert.equal(artAbgeleitet({ title: "Gedichtanalyse" }, DEUTSCH), "abfragen");
    // Grammatik-Wort in einem Wissensfach ändert nichts.
    assert.equal(artAbgeleitet({ title: "Zeit der Weimarer Republik" }, GESCHICHTE), "abfragen");
  });

  it("Stichwörter als ganzes Wort mit Endung, ohne Akzente", () => {
    assert.ok(hatGrammatikStichwort("Die Zeiten im Französischen"));
    assert.ok(hatGrammatikStichwort("passe compose"));
    assert.ok(hatGrammatikStichwort("Satzglieder bestimmen"));
    assert.ok(!hatGrammatikStichwort("Zeitungsartikel schreiben"));
    assert.ok(!hatGrammatikStichwort("Aktivitäten am Wochenende"));
  });

  it("der gespeicherte Wert gewinnt", () => {
    assert.equal(themaArt({ title: "Quadratische Funktionen", art: "abfragen" }, MATHE), "abfragen");
    assert.equal(themaArt({ title: "Quadratische Funktionen", art: null }, MATHE), "ueben");
  });

  it("gespeichert wird nur die Abweichung", () => {
    assert.equal(gespeicherteArt({ title: "Quadratische Funktionen" }, MATHE, "ueben"), null);
    assert.equal(gespeicherteArt({ title: "Quadratische Funktionen" }, MATHE, "abfragen"), "abfragen");
  });
});
