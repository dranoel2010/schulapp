import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  artAbgeleitet,
  gespeicherteArt,
  hatGrammatikStichwort,
  istGrammatikThema,
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

  it("Grammatik ohne das Wort Grammatik: if-sentences, conditional, tenses, subjonctif, passé composé, Konjunktiv", () => {
    for (const titel of [
      "Unit 3 if-sentences",
      "If sentences type 1",
      "Conditionals",
      "Tenses revision",
      "Le subjonctif",
      "Passé composé mit être",
      "Konjunktiv II",
      "Gerund or infinitive",
      "The passive",
      "Modal verbs",
      "Les pronoms relatifs",
      "Adjektive und Adverbien",
      "Präteritum und Perfekt",
    ])
      assert.ok(hatGrammatikStichwort(titel), titel);
    for (const titel of ["Vokabeln Unit 3", "Romeo and Juliet", "Kurzgeschichte", "Le Petit Prince", "Gedichtanalyse", "Presentation skills", "D'accord ou pas"])
      assert.ok(!hatGrammatikStichwort(titel), titel);
    assert.equal(artAbgeleitet({ title: "Unit 3 if-sentences" }, { name: "Englisch" }), "ueben");
    assert.ok(istGrammatikThema({ title: "Unit 3 if-sentences", art: null }, { name: "Englisch" }));
  });

  it("„Futur“ trifft kein englisches „future“", () => {
    assert.ok(!hatGrammatikStichwort("My future job"));
    assert.ok(!hatGrammatikStichwort("My future job", ENGLISCH));
    assert.equal(artAbgeleitet({ title: "My future job" }, ENGLISCH), "abfragen");
    assert.ok(!istGrammatikThema({ title: "Talking about the future", art: null }, ENGLISCH));
    // die französischen Zeiten in jedem Sprachfach
    for (const titel of ["Le futur simple", "Futur proche", "Le futur composé", "Futur antérieur"])
      assert.ok(hatGrammatikStichwort(titel), titel);
    assert.equal(artAbgeleitet({ title: "Futur simple" }, FRANZ), "ueben");
    // das nackte Wort nur in Französisch und Deutsch
    assert.ok(!hatGrammatikStichwort("Le futur"));
    assert.ok(hatGrammatikStichwort("Le futur", FRANZ));
    assert.ok(hatGrammatikStichwort("Futur I und II", DEUTSCH));
    assert.ok(!hatGrammatikStichwort("Futur I und II", ENGLISCH));
    assert.equal(artAbgeleitet({ title: "Futur II" }, DEUTSCH), "ueben");
    assert.ok(!hatGrammatikStichwort("Future plans", FRANZ));
    // will-future und going-to-future bleiben Englisch-Grammatik
    assert.equal(artAbgeleitet({ title: "will-future and going-to-future" }, ENGLISCH), "ueben");
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
