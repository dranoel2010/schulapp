import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_WOERTER,
  REGEL_VERSION,
  RUHE_MS,
  appVorschlagFaellig,
  formelVerdacht,
  leserBeimAnlegen,
  leserRegelAus,
  vorpruefen,
  woerterAus,
  type KorbblattZahlen,
} from "@/lib/leser/regel";

/**
 * Die feste Regel, wer eine Seite liest — nur mit erfundenen Texten. Echte
 * Schülerseiten gehören nie ins Repo; die Messung an ihnen lief außerhalb.
 */

const WORTSCHATZ = [
  "Hafen",
  "Brücke",
  "Schiff",
  "Container",
  "Kran",
  "Ladung",
  "Kapitän",
  "Route",
  "Handel",
  "Küste",
  "Lager",
  "Fracht",
];

/** `anzahl` Wörter aus reinen Buchstaben, ohne jedes Formelzeichen. */
function woerter(anzahl: number): string {
  return Array.from(
    { length: anzahl },
    (_, i) => WORTSCHATZ[i % WORTSCHATZ.length],
  ).join(" ");
}

function docling(markdown: string, status = "success") {
  return { markdown, seconds: 2.5, status };
}

describe("woerterAus", () => {
  it("zählt Markup und HTML-Kommentare nicht als Wörter", () => {
    assert.deepEqual(
      woerterAus("## Hafen\n\n<!-- image -->\n\n| Kran | Schiff |\n|---|---|"),
      ["Hafen", "Kran", "Schiff"],
    );
  });

  it("nimmt das französische Elisionspräfix ab", () => {
    assert.deepEqual(woerterAus("l'eau qu'elle d’abord"), [
      "eau",
      "elle",
      "abord",
    ]);
  });

  it("lässt Zahlen und Wörter unter drei Buchstaben fallen", () => {
    assert.deepEqual(woerterAus("Am 12. Mai um 8 Uhr da: B12"), [
      "Mai",
      "Uhr",
    ]);
  });

  it("behält den Inhalt zwischen Dollarzeichen", () => {
    assert.deepEqual(woerterAus("vorher $Tangente$ danach"), [
      "vorher",
      "Tangente",
      "danach",
    ]);
  });
});

describe("formelVerdacht", () => {
  const faelle: [string, string][] = [
    ["Preis in $ angeben", "dollar"],
    ["<!-- formula-not-decoded -->", "formula-not-decoded"],
    ["\\frac{a}{b}", "latex"],
    ["a = b", "gleich"],
    ["x ≤ y", "kleiner-gleich"],
    ["x ≥ y", "groesser-gleich"],
    ["√ zwei", "wurzel"],
    ["e ^ x", "hoch"],
    ["Fläche in m²", "quadrat"],
    ["Volumen in m³", "kubik"],
    ["Löse x3 auf", "buchstabe-ziffer"],
    ["Ausstoß von CO2", "buchstabe-ziffer"],
    ["Die Funktion f(x) steigt", "funktion"],
    ["Die Ableitung f'(x) fällt", "strich"],
    ["Gesucht ist f'", "strich"],
    ["Gesucht ist f’\nund mehr", "strich"],
  ];

  for (const [text, name] of faelle) {
    it(`erkennt „${text.replace(/\n/g, "⏎")}“ als ${name}`, () => {
      assert.equal(formelVerdacht(text), name);
    });
  }

  it("schlägt bei gewöhnlichem Text nicht an", () => {
    assert.equal(formelVerdacht("l'eau est froide"), null);
    assert.equal(formelVerdacht("I don't know"), null);
    assert.equal(formelVerdacht("Seite 3"), null);
    assert.equal(formelVerdacht("Das steht (siehe unten) im Heft."), null);
    assert.equal(formelVerdacht(woerter(200)), null);
  });

  it("nennt das erste Muster in der festen Reihenfolge", () => {
    assert.equal(formelVerdacht("f(x) = x²"), "gleich");
  });
});

describe("vorpruefen", () => {
  it("schickt eine Seite ohne Erfolg an Claude, auch mit Text", () => {
    const ergebnis = vorpruefen(docling(woerter(100), "partial_success"), 8000);
    assert.equal(ergebnis.ok, false);
    assert.ok(!ergebnis.ok);
    assert.equal(ergebnis.grund, "nicht-erfolg");
    assert.equal(ergebnis.merkmale.woerter, 100, "gemessen wird trotzdem");
  });

  it("schickt eine leere Seite an Claude", () => {
    const ergebnis = vorpruefen(docling("  \n "), 8000);
    assert.ok(!ergebnis.ok);
    assert.equal(ergebnis.grund, "leer");
    assert.equal(ergebnis.merkmale.zeichen, null);
  });

  it(`verlangt ${MIN_WOERTER} Wörter: 59 reichen nicht`, () => {
    const ergebnis = vorpruefen(docling(woerter(59)), 8000);
    assert.ok(!ergebnis.ok);
    assert.equal(ergebnis.grund, "zu-wenig-woerter");
    assert.equal(ergebnis.merkmale.woerter, 59);
  });

  it("lässt 60 saubere Wörter durch und liefert die Abschrift", () => {
    const markdown = woerter(60);
    const ergebnis = vorpruefen(docling(markdown), 8000);
    assert.ok(ergebnis.ok);
    assert.equal(ergebnis.abschrift, markdown);
    assert.deepEqual(ergebnis.merkmale, {
      woerter: 60,
      formel: null,
      zeichen: markdown.length,
    });
  });

  it("schickt eine Formelseite an Claude, auch mit vielen Wörtern", () => {
    const ergebnis = vorpruefen(docling(`${woerter(200)}\n\na = b`), 8000);
    assert.ok(!ergebnis.ok);
    assert.equal(ergebnis.grund, "formel");
    assert.equal(ergebnis.merkmale.formel, "gleich");
  });

  it("prüft die Wortzahl vor der Formel", () => {
    const ergebnis = vorpruefen(docling(`${woerter(10)} a = b`), 8000);
    assert.ok(!ergebnis.ok);
    assert.equal(ergebnis.grund, "zu-wenig-woerter");
    assert.equal(ergebnis.merkmale.formel, "gleich", "gemessen wird trotzdem");
  });

  it("schickt eine Seite an Claude, deren Abschrift zu lang wäre", () => {
    const markdown = woerter(100);
    const ergebnis = vorpruefen(docling(markdown), markdown.length - 1);
    assert.ok(!ergebnis.ok);
    assert.equal(ergebnis.grund, "zu-lang");
    assert.equal(ergebnis.merkmale.zeichen, markdown.length);
  });

  it("misst die Länge an der Abschrift, nicht am Markdown", () => {
    const markdown = `## ${woerter(60)}`;
    const ergebnis = vorpruefen(docling(markdown), markdown.length - 3);
    assert.ok(ergebnis.ok, "ohne die drei Zeichen „## “ passt sie");
  });
});

describe("die Notbremse", () => {
  it("greift bei „aus“, gleich wie geschrieben", () => {
    assert.equal(leserRegelAus({ LESER_REGEL: "aus" }), true);
    assert.equal(leserRegelAus({ LESER_REGEL: " AUS " }), true);
  });

  it("greift sonst nicht", () => {
    assert.equal(leserRegelAus({}), false);
    assert.equal(leserRegelAus({ LESER_REGEL: "" }), false);
    assert.equal(leserRegelAus({ LESER_REGEL: "an" }), false);
    assert.equal(leserRegelAus({ LESER_REGEL: "ausschalten" }), false);
  });

  it("lässt eine neue Seite offen, solange sie nicht gezogen ist", () => {
    assert.deepEqual(leserBeimAnlegen({}), { leser: "offen", leserGrund: null });
  });

  it("gibt eine neue Seite gleich Claude, wenn sie gezogen ist", () => {
    assert.deepEqual(leserBeimAnlegen({ LESER_REGEL: "aus" }), {
      leser: "claude",
      leserGrund: {
        regel: REGEL_VERSION,
        grund: "aus",
        woerter: null,
        formel: null,
        zeichen: null,
        jev: null,
        sekunden: null,
      },
    });
  });
});

describe("appVorschlagFaellig", () => {
  const fertig: KorbblattZahlen = {
    eingeordnet: false,
    vorschlaege: 0,
    offen: 0,
    ungelesen: 0,
    maschinell: 2,
    seitLetzterSeiteMs: 60_000,
  };

  it("ist für ein ruhiges, ganz von Docling gelesenes Blatt fällig", () => {
    assert.deepEqual(appVorschlagFaellig(fertig, RUHE_MS), { art: "jetzt" });
    assert.deepEqual(
      appVorschlagFaellig({ ...fertig, seitLetzterSeiteMs: RUHE_MS }, RUHE_MS),
      { art: "jetzt" },
    );
  });

  it("wartet, solange die jüngste Seite frisch ist — bis kurz nach der Ruhe", () => {
    assert.deepEqual(
      appVorschlagFaellig({ ...fertig, seitLetzterSeiteMs: 10_000 }, RUHE_MS),
      { art: "warten", ms: 10_500 },
    );
  });

  const nie: [string, Partial<KorbblattZahlen>][] = [
    ["eingeordnet", { eingeordnet: true }],
    ["mit liegendem Vorschlag", { vorschlaege: 1 }],
    ["mit offener Seite", { offen: 1 }],
    ["mit ungelesener Seite (Claude kommt noch)", { ungelesen: 1 }],
    ["ohne eine einzige Docling-Seite", { maschinell: 0 }],
  ];

  for (const [name, abweichung] of nie) {
    it(`ist nie fällig: ${name}`, () => {
      assert.equal(
        appVorschlagFaellig({ ...fertig, ...abweichung }, RUHE_MS).art,
        "nein",
      );
    });
  }
});
