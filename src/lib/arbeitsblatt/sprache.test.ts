import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blattAuftrag, type BlattVorab } from "@/lib/arbeitsblatt/auftrag";
import { fachSprache, spracheAbsatz, spracheAusWort } from "@/lib/arbeitsblatt/sprache";
import { artAbgeleitet, grammatikBlatt } from "@/lib/themen-art";

/** Antwort 5 vom 13.10.2026: das Grammatikblatt richtet sich nach der Sprache des Fachs. */

const vorab = (over: Partial<BlattVorab> = {}): BlattVorab => ({
  fach: "Englisch",
  thema: "Simple past",
  papier: "linien",
  zuletztFalsch: [],
  ...over,
});

describe("Sprache des Arbeitsblatts", () => {
  it("erkennt die Sprache am Fachnamen", () => {
    assert.equal(fachSprache("Englisch"), "en");
    assert.equal(fachSprache("English"), "en");
    assert.equal(fachSprache("Französisch"), "fr");
    assert.equal(fachSprache("Franzoesisch"), "fr");
    assert.equal(fachSprache("Deutsch"), "de");
    assert.equal(fachSprache("Mathematik"), null);
    assert.equal(fachSprache("Geschichte"), null);
  });

  it("erkennt Sprachwörter der Zeile, auch Kürzel", () => {
    assert.equal(spracheAusWort("Englisch"), "en");
    assert.equal(spracheAusWort("französisch"), "fr");
    assert.equal(spracheAusWort("frz"), "fr");
    assert.equal(spracheAusWort("Deutsch"), "de");
    assert.equal(spracheAusWort("England"), null);
    assert.equal(spracheAusWort("grammatik"), null);
  });

  it("die Art bleibt wie vorher: Grammatik in Sprachfächern übt, Wissen fragt ab", () => {
    assert.equal(artAbgeleitet({ title: "Simple past tense" }, { name: "Englisch" }), "ueben");
    assert.equal(artAbgeleitet({ title: "Passé composé mit être" }, { name: "Französisch" }), "ueben");
    assert.equal(artAbgeleitet({ title: "Kommasetzung" }, { name: "Deutsch" }), "ueben");
    assert.equal(artAbgeleitet({ title: "Vokabeln Unit 3" }, { name: "Englisch" }), "abfragen");
    assert.equal(artAbgeleitet({ title: "Zeitform" }, { name: "Geschichte" }), "abfragen");
  });

  it("Englisch: Aufgaben auf Englisch, kurze deutsche Anweisung erlaubt, Teile kursiv", () => {
    const a = spracheAbsatz("en", { grammatik: true });
    assert.match(a, /Sprache des Blatts: Englisch\./);
    assert.match(a, /Aufgabenstellung \(q\) schreibst du auf Englisch/);
    assert.match(a, /Complete the sentences/);
    assert.match(a, /kurze Arbeitsanweisung auf Deutsch/);
    assert.match(a, /fr = true/);
    assert.match(a, /ins Englische übersetzt/);
  });

  it("Französisch: Aufgaben auf Französisch", () => {
    const a = spracheAbsatz("fr", { grammatik: true });
    assert.match(a, /Sprache des Blatts: Französisch\./);
    assert.match(a, /auf Französisch, wie im Schulbuch/);
    assert.match(a, /Complète les phrases/);
    assert.ok(!a.includes("Complete the sentences"));
  });

  it("Deutsch: alles auf Deutsch, nichts kursiv", () => {
    const a = spracheAbsatz("de", { grammatik: true });
    assert.match(a, /Sprache des Blatts: Deutsch\./);
    assert.match(a, /fr bleibt weg/);
    assert.ok(!a.includes("Arbeitsanweisung auf Deutsch in Klammern"));
  });
});

describe("Auftrag an Opus mit Sprache", () => {
  it("nennt die Sprache bei Englisch, Französisch und Deutsch", () => {
    assert.match(blattAuftrag(vorab({ sprache: "en" })), /Sprache des Blatts: Englisch/);
    assert.match(blattAuftrag(vorab({ fach: "Französisch", sprache: "fr" })), /Sprache des Blatts: Französisch/);
    const de = blattAuftrag(vorab({ fach: "Deutsch", thema: "Kommasetzung", sprache: "de" }));
    assert.match(de, /Sprache des Blatts: Deutsch/);
    // bei Deutsch gibt es keinen fremdsprachigen Text, also auch keinen Hinweis auf fr
    assert.ok(!de.includes("Fremdsprachiger Text"));
  });

  it("ohne Sprache (Mathematik) steht nichts dazu im Auftrag", () => {
    const ma = blattAuftrag(vorab({ fach: "Mathematik", thema: "Quadratische Funktionen", papier: "kaestchen" }));
    assert.ok(!ma.includes("Sprache des Blatts"));
  });

  it("die Sprache steht vor den Regeln, die Probeklausur davor", () => {
    const t = blattAuftrag(vorab({ sprache: "en", probe: true }));
    const probe = t.indexOf("Probeklausur");
    const sprache = t.indexOf("Sprache des Blatts");
    const regel = t.indexOf("1. Unter diesem Auftrag");
    assert.ok(probe > 0 && probe < sprache && sprache < regel);
  });

  it("keine Platzhalter bleiben im Auftrag stehen (Kästchen und Linien)", () => {
    for (const papier of ["kaestchen", "linien"] as const) {
      const t = blattAuftrag(vorab({ papier, sprache: papier === "linien" ? "en" : null }));
      assert.ok(!t.includes("${"), `kein \${…} im Auftrag (${papier})`);
    }
  });
});

describe("Sprache ohne Grammatik (Probeklausur, Texte, Wortschatz)", () => {
  it("grammatikBlatt: nur Stichwort im Titel und keine Probe", () => {
    assert.equal(grammatikBlatt("Simple past", false), true);
    assert.equal(grammatikBlatt("Simple past", true), false);
    assert.equal(grammatikBlatt("Vokabeln Unit 3", false), false);
    assert.equal(grammatikBlatt("Kurzgeschichte", false), false);
    assert.equal(grammatikBlatt("Kommasetzung", undefined), true);
  });

  it("Probeklausur in Englisch zu Vokabeln: Sprache ja, Grammatik nein", () => {
    const t = blattAuftrag(
      vorab({ thema: "Vokabeln Unit 3", probe: true, sprache: "en", grammatik: grammatikBlatt("Vokabeln Unit 3", true) }),
    );
    assert.match(t, /Sprache des Blatts: Englisch\./);
    assert.match(t, /Aufgabenstellung \(q\) schreibst du auf Englisch/);
    assert.ok(!t.includes("Grammatikblatt"));
    assert.ok(!t.includes("die Grammatik, die sie üben"));
    assert.ok(!t.includes("simple past"));
  });

  it("Probeklausur über ein Grammatikthema bleibt eine Probe, kein Grammatikblatt", () => {
    const t = blattAuftrag(vorab({ thema: "Klausur: Short stories", probe: true, sprache: "en", grammatik: true }));
    assert.ok(!t.includes("Grammatikblatt"));
    assert.match(t, /Probeklausur/);
  });

  it("Deutsch, von Hand auf Üben gestellt ohne Stichwort: keine Regel, keine Satzglieder", () => {
    const t = blattAuftrag(
      vorab({ fach: "Deutsch", thema: "Kurzgeschichte", sprache: "de", grammatik: grammatikBlatt("Kurzgeschichte", false) }),
    );
    assert.match(t, /Sprache des Blatts: Deutsch\./);
    assert.match(t, /fr bleibt weg/);
    assert.ok(!t.includes("die Regel, die sie üben"));
    assert.ok(!t.includes("Satzglieder"));
    assert.ok(!t.includes("Grammatikblatt"));
  });

  it("Französisch ohne Grammatik: Aufgaben auf Französisch, ohne Grammatik-Beispiel", () => {
    const a = spracheAbsatz("fr", { grammatik: false });
    assert.match(a, /auf Französisch, wie im Schulbuch/);
    assert.match(a, /Réponds aux questions/);
    assert.ok(!a.includes("passé composé"));
    assert.ok(!a.includes("Grammatik"));
  });

  it("ein Grammatikthema außerhalb einer Probe heißt weiter Grammatikblatt", () => {
    const t = blattAuftrag(vorab({ sprache: "en", grammatik: true }));
    assert.match(t, /Grammatikblatt für den Englischunterricht/);
  });
});
