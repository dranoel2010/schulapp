import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  doclingZuAbschrift,
  ersteUeberschrift,
  titelAusErsterSeite,
} from "@/lib/leser/abschrift";

/** Doclings Markdown → Abschrift, nur mit erfundenen Texten. */

describe("doclingZuAbschrift", () => {
  it("dekodiert die Entities, die Docling schreibt", () => {
    assert.equal(
      doclingZuAbschrift("Lesen &amp; Schreiben, a &lt; b &gt; c, Peter&#39;s &quot;Heft&quot;"),
      `Lesen & Schreiben, a < b > c, Peter's "Heft"`,
    );
    assert.equal(doclingZuAbschrift("Caf&#xE9; und &#233;t&#233;"), "Café und été");
  });

  it("macht aus dem Bildplatzhalter ⟨Bild⟩ und lässt andere Kommentare weg", () => {
    assert.equal(
      doclingZuAbschrift("Oben\n\n<!-- image -->\n\nMitte <!-- formula-not-decoded --> unten"),
      "Oben\n\n⟨Bild⟩\n\nMitte  unten",
    );
  });

  it("lässt einen Kommentar, der als Text auf dem Blatt stand, als Text stehen", () => {
    assert.equal(
      doclingZuAbschrift("Schreibe &lt;!-- hier --&gt; hin"),
      "Schreibe <!-- hier --> hin",
    );
  });

  it("nimmt die Überschriftsmarken weg", () => {
    assert.equal(
      doclingZuAbschrift("# Der Hafen\n\n## Aufgabe eins\n\nText"),
      "Der Hafen\n\nAufgabe eins\n\nText",
    );
  });

  it("schreibt eine Tabelle Zeile für Zeile, ohne Trennzeile und Randpipes", () => {
    assert.equal(
      doclingZuAbschrift(
        "| Land | Hauptstadt |\n|---|:--:|\n|  Frankreich   | Paris |\n| Italien | Rom |",
      ),
      "Land | Hauptstadt\nFrankreich | Paris\nItalien | Rom",
    );
  });

  it("nimmt die Escapes vor Markdown-Zeichen weg", () => {
    assert.equal(
      doclingZuAbschrift("Name\\_Vorname, 3 \\* 4, \\# eins, a \\| b"),
      "Name_Vorname, 3 * 4, # eins, a | b",
    );
  });

  it("macht aus mehreren Leerzeilen eine und schneidet die Ränder", () => {
    assert.equal(
      doclingZuAbschrift("\n\n  Erste Zeile   \n\n\n\nZweite Zeile\t\n\n"),
      "Erste Zeile\n\nZweite Zeile",
    );
  });

  it("setzt keine ⟨⟩ um Wörter — Unsicherheit kennt Docling nicht", () => {
    const abschrift = doclingZuAbschrift("Der Kapitn stuert das Schif in den Hafn.");
    assert.equal(abschrift, "Der Kapitn stuert das Schif in den Hafn.");
    assert.ok(!abschrift.includes("⟨"));
  });

  it("ändert beim zweiten Durchlauf nichts mehr", () => {
    const markdown = [
      "## Handout Hafen",
      "",
      "Der Hafen &amp; die Stadt wachsen zusammen.",
      "",
      "<!-- image -->",
      "",
      "| Jahr | Schiffe |",
      "|---|---|",
      "| zweitausend | viele |",
      "",
      "",
      "",
      "- Container\\_Brücke",
    ].join("\n");

    const einmal = doclingZuAbschrift(markdown);
    assert.equal(doclingZuAbschrift(einmal), einmal);
  });
});

describe("ersteUeberschrift", () => {
  it("nimmt die erste von mehreren Überschriften", () => {
    assert.equal(
      ersteUeberschrift("Vorspann\n\n## Containerschifffahrt\n\n# Zweite", 80),
      "Containerschifffahrt",
    );
  });

  it("dekodiert und nimmt Escapes weg", () => {
    assert.equal(
      ersteUeberschrift("# Lesen &amp; Schreiben\\_Teil eins", 80),
      "Lesen & Schreiben_Teil eins",
    );
  });

  it("kürzt eine lange Überschrift an einer Wortgrenze, ohne Auslassungszeichen", () => {
    const lang = `# ${"Hafenwirtschaft ".repeat(8).trim()}`;
    assert.ok(lang.length > 120);

    const titel = ersteUeberschrift(lang, 80);
    assert.ok(titel !== null);
    assert.ok(titel.length <= 80);
    assert.ok(!titel.endsWith(" "));
    assert.ok(!titel.includes("…"));
    assert.ok(lang.startsWith(`# ${titel} `), "an einer Wortgrenze geschnitten");
  });

  it("schneidet hart, wenn es kein Leerzeichen gibt", () => {
    assert.equal(ersteUeberschrift(`# ${"x".repeat(100)}`, 80), "x".repeat(80));
  });

  it("gibt null ohne Überschrift oder mit einer leeren", () => {
    assert.equal(ersteUeberschrift("Nur Text\n\nUnd noch mehr", 80), null);
    assert.equal(ersteUeberschrift("#Kein Leerzeichen", 80), null);
    assert.equal(ersteUeberschrift("# <!-- image -->", 80), null);
  });
});

describe("titelAusErsterSeite", () => {
  const platzhalter = "Blatt vom 6.10.";
  const docling = { leser: "docling" as const, doclingText: "# Der Hafen\n\nText" };

  it("nimmt die Überschrift bei Platzhalter, Docling-Seite und Überschrift", () => {
    assert.equal(
      titelAusErsterSeite(platzhalter, platzhalter, docling, 80),
      "Der Hafen",
    );
  });

  it("lässt einen getippten Titel stehen", () => {
    assert.equal(titelAusErsterSeite("Mein Titel", platzhalter, docling, 80), null);
  });

  it("nimmt nichts von einer Seite, die Claude liest oder die von vorher ist", () => {
    assert.equal(
      titelAusErsterSeite(platzhalter, platzhalter, { ...docling, leser: "claude" }, 80),
      null,
    );
    assert.equal(
      titelAusErsterSeite(platzhalter, platzhalter, { ...docling, leser: null }, 80),
      null,
    );
    assert.equal(titelAusErsterSeite(platzhalter, platzhalter, null, 80), null);
  });

  it("gibt null, wenn Docling keine Überschrift gesehen hat", () => {
    assert.equal(
      titelAusErsterSeite(platzhalter, platzhalter, { leser: "docling", doclingText: "Nur Text" }, 80),
      null,
    );
    assert.equal(
      titelAusErsterSeite(platzhalter, platzhalter, { leser: "docling", doclingText: null }, 80),
      null,
    );
  });
});
