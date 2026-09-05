import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asciiFileName, pdfFileName } from "@/lib/pdf/filename";

describe("pdfFileName", () => {
  it("nennt Fach und Datum", () => {
    assert.equal(pdfFileName("Mathematik", "2026-09-05"), "Mathematik 2026-09-05.pdf");
  });

  it("lässt Umlaute stehen", () => {
    // Der Dateiname selbst darf Umlaute tragen; erst der ASCII-Rückfall im
    // Header ersetzt sie.
    assert.equal(pdfFileName("Französisch", "2026-09-05"), "Französisch 2026-09-05.pdf");
  });

  it("wirft Zeichen weg, die in keinem Dateinamen stehen dürfen", () => {
    assert.equal(
      pdfFileName("Deutsch/Geschichte", "2026-01-02"),
      "DeutschGeschichte 2026-01-02.pdf",
    );
    assert.equal(pdfFileName('A:B*C?D"E<F>G|H\\I', "2026-01-02"), "ABCDEFGHI 2026-01-02.pdf");
  });

  it("zieht Leerraum zusammen und schneidet die Ränder ab", () => {
    assert.equal(pdfFileName("  Mathe   Leistung  ", "2026-01-02"), "Mathe Leistung 2026-01-02.pdf");
  });

  it("macht aus Zeilenumbruch und Tabulator ein Leerzeichen", () => {
    // Im Header wäre ein Umbruch eine zweite Kopfzeile. Hier fällt er zusammen
    // mit der Leerraum-Behandlung weg, ohne dass ein eigener Zeichenbereich
    // nötig wäre.
    assert.equal(pdfFileName("Ma\nthe\tII", "2026-01-02"), "Ma the II 2026-01-02.pdf");
  });

  it("hat immer einen Namen, auch wenn nichts übrig bleibt", () => {
    // Ein leerer Dateiname wäre für den Browser kein Name — die Datei hieße
    // dann wieder wie das letzte Stück der Adresse, also „pdf".
    assert.equal(pdfFileName("///", "2026-01-02"), "Fach 2026-01-02.pdf");
    assert.equal(pdfFileName("   ", "2026-01-02"), "Fach 2026-01-02.pdf");
    assert.equal(pdfFileName("", "2026-01-02"), "Fach 2026-01-02.pdf");
  });
});

describe("asciiFileName", () => {
  it("schreibt Umlaute deutsch aus", () => {
    // ä→ae und nicht ä→a: „Franzosisch" wäre die Alternative, und die käme
    // aus einer reinen Unicode-Zerlegung heraus.
    assert.equal(asciiFileName("Französisch"), "Franzoesisch");
    assert.equal(asciiFileName("Größe Maß"), "Groesse Mass");
    assert.equal(asciiFileName("Ökologie Übung Ärger"), "Oekologie Uebung Aerger");
  });

  it("zerlegt Akzente, für die es keine Ersatzschreibweise gibt", () => {
    assert.equal(asciiFileName("Café à Paris"), "Cafe a Paris");
  });

  it("ersetzt, was sich gar nicht schreiben lässt", () => {
    // Hier ist der Unterstrich richtig: es stand ein Zeichen da, und es lässt
    // sich nicht in ASCII schreiben. Bei den verbotenen Zeichen in
    // `pdfFileName()` wäre er falsch gewesen — dort stand nie eins.
    assert.equal(asciiFileName("Mathe 中"), "Mathe _");
  });

  it("lässt kein Anführungszeichen und keinen Umbruch durch", () => {
    // Der ASCII-Name steht im Header in Anführungszeichen. Ein zweites
    // Anführungszeichen darin schlösse den Wert vorzeitig — es kann aber gar
    // keins geben, weil `pdfFileName()` es schon wegwirft.
    const name = pdfFileName('Mathe"; x="y', "2026-01-02");

    assert.equal(asciiFileName(name).includes('"'), false);
    assert.equal(asciiFileName(name).includes("\n"), false);
  });

  it("lässt einen gewöhnlichen Namen unberührt", () => {
    assert.equal(asciiFileName("Mathematik 2026-09-05.pdf"), "Mathematik 2026-09-05.pdf");
  });
});
