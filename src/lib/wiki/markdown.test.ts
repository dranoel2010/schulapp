import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  codeBlock,
  frontmatterBlock,
  inlineText,
  singleLine,
  yamlList,
  yamlText,
} from "@/lib/wiki/markdown";

/**
 * Feindlicher Text — dieselbe Liste für jede Prüfung hier.
 *
 * Jeder Eintrag ist ein Weg, auf dem ein abfotografiertes Blatt eine Datei
 * zerlegen könnte, und keiner davon ist ausgedacht: Umbruch, Frontmatter-Zaun,
 * Codezaun, Anführungszeichen, Rückstrich, Tabellentrenner, Steuerzeichen,
 * umgedrehte Leserichtung.
 */
const FEINDLICH = [
  "Zeile 1\nZeile 2",
  "Zeile 1\r\nZeile 2",
  "---",
  "vorher\n---\nnachher",
  "```",
  'Er sagte "hallo"',
  "C:\\Pfad\\zur\\Datei",
  "a | b | c",
  "Steuer\u0000zeichen\u0007",
  "\u202eumgedreht",
  "  viel   Leerraum  ",
  "# Überschrift",
  "[Link](https://example.invalid)",
  "<script>alert(1)</script>",
  "Aufgabe #wichtig",
  "*fett* _kursiv_ ~weg~",
];

/**
 * Wie viele „|" in dem Text NICHT maskiert sind.
 *
 * Ein `split("|")` reichte hier nicht: Es trennt auch am maskierten „\\|", und
 * genau das ist der Fall, den die Maskierung erlaubt. Deshalb wird Zeichen für
 * Zeichen gelesen und nach einem Rückstrich das nächste Zeichen übersprungen.
 */
function offeneTrenner(text: string): number {
  let anzahl = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === "|") anzahl += 1;
  }

  return anzahl;
}

describe("singleLine", () => {
  it("macht aus jedem Umbruch ein Leerzeichen", () => {
    assert.equal(singleLine("Zeile 1\nZeile 2"), "Zeile 1 Zeile 2");
    assert.equal(singleLine("Zeile 1\r\nZeile 2"), "Zeile 1 Zeile 2");
    assert.equal(singleLine("a\u2028b"), "a b");
  });

  it("zieht Leerraum zusammen und schneidet die Ränder ab", () => {
    assert.equal(singleLine("  viel   Leerraum  "), "viel Leerraum");
  });

  it("wirft Steuerzeichen heraus", () => {
    assert.equal(singleLine("Steuer\u0000zeichen"), "Steuer zeichen");
  });

  it("entfernt die unsichtbaren Zeichen ganz", () => {
    // U+202E dreht die Leserichtung um: ohne diese Zeile stünde im Vault ein
    // Titel, der etwas anderes zeigt, als in der Datei steht.
    assert.equal(singleLine("\u202eumgedreht"), "umgedreht");
    assert.equal(singleLine("a\u200bb"), "ab");
    assert.equal(singleLine("\ufeffMathematik"), "Mathematik");
  });

  it("lässt den Zusammenbinder in Emoji-Folgen stehen", () => {
    // U+200D hält „👨‍👩‍👧" zusammen und richtet keinen Schaden an.
    assert.equal(singleLine("👨\u200d👩\u200d👧"), "👨\u200d👩\u200d👧");
  });

  it("gibt für jeden feindlichen Text genau eine Zeile", () => {
    for (const text of FEINDLICH) {
      assert.equal(
        singleLine(text).split("\n").length,
        1,
        `mehrzeilig geblieben: ${JSON.stringify(text)}`,
      );
    }
  });
});

describe("inlineText", () => {
  it("maskiert, was in Markdown eine Bedeutung hat", () => {
    assert.equal(inlineText("*fett*"), "\\*fett\\*");
    assert.equal(inlineText("a | b"), "a \\| b");
    assert.equal(inlineText("<script>"), "\\<script\\>");
    assert.equal(inlineText("[Link](x)"), "\\[Link\\](x)");
    assert.equal(inlineText("Aufgabe #wichtig"), "Aufgabe \\#wichtig");
  });

  it("maskiert den Rückstrich zuerst und nicht zweimal", () => {
    assert.equal(inlineText("C:\\Pfad"), "C:\\\\Pfad");
  });

  it("lässt gewöhnlichen Text in Ruhe", () => {
    assert.equal(inlineText("Deutsch/Französisch"), "Deutsch/Französisch");
    assert.equal(inlineText("S. 42 Nr. 3–7"), "S. 42 Nr. 3–7");
  });

  it("kann keine Tabellenzeile zerlegen", () => {
    // Der Tabellentrenner ist der Fall, an dem es im MANIFEST auffiele: eine
    // Zeile mit einem „|" im Titel hätte plötzlich sechs Spalten statt drei.
    // Gezählt werden nur die UNMASKIERTEN — „\\|" ist in Markdown ein Zeichen
    // und keine Spaltengrenze.
    for (const text of FEINDLICH) {
      assert.equal(
        offeneTrenner(inlineText(text)),
        0,
        `offener Trenner in ${JSON.stringify(text)}`,
      );
    }
  });
});

describe("yamlText", () => {
  it("setzt jeden Wert in Anführungszeichen", () => {
    assert.equal(yamlText("Mathematik"), '"Mathematik"');
    // Ohne die Anführungszeichen läse ein YAML-Leser hier einen Wahrheitswert,
    // ein Nichts und ein Datum statt dreier Zeichenketten.
    assert.equal(yamlText("ja"), '"ja"');
    assert.equal(yamlText("null"), '"null"');
    assert.equal(yamlText("2026-09-01"), '"2026-09-01"');
  });

  it("maskiert Anführungszeichen und Rückstriche", () => {
    assert.equal(yamlText('Er sagte "hallo"'), '"Er sagte \\"hallo\\""');
    assert.equal(yamlText("C:\\Pfad"), '"C:\\\\Pfad"');
    assert.equal(yamlText('\\"'), '"\\\\\\""');
  });

  it("bleibt bei jedem feindlichen Text eine einzige Zeile", () => {
    for (const text of FEINDLICH) {
      assert.equal(
        yamlText(text).split("\n").length,
        1,
        `mehrzeilig: ${JSON.stringify(text)}`,
      );
    }
  });

  it("lässt kein Anführungszeichen unmaskiert stehen", () => {
    for (const text of FEINDLICH) {
      const wert = yamlText(text);
      const innen = wert.slice(1, -1);
      // Jedes " im Inneren muss von einer UNGERADEN Zahl Rückstriche
      // eingeleitet werden — sonst schließt es den Wert vorzeitig.
      for (let i = 0; i < innen.length; i += 1) {
        if (innen[i] !== '"') continue;

        let striche = 0;
        for (let j = i - 1; j >= 0 && innen[j] === "\\"; j -= 1) striche += 1;

        assert.equal(
          striche % 2,
          1,
          `offenes Anführungszeichen in ${JSON.stringify(text)}`,
        );
      }
    }
  });
});

describe("yamlList", () => {
  it("schreibt eine leere Liste als []", () => {
    assert.equal(yamlList([]), "[]");
  });

  it("setzt jeden Eintrag in Anführungszeichen", () => {
    assert.equal(yamlList(["a", "b"]), '["a", "b"]');
  });

  it("überlebt einen Umbruch in einem Eintrag", () => {
    assert.equal(yamlList(["Ableitungen\nsind wichtig"]), '["Ableitungen sind wichtig"]');
  });
});

describe("frontmatterBlock", () => {
  it("rahmt die Felder mit den beiden Zäunen ein", () => {
    assert.equal(
      frontmatterBlock([{ key: "typ", value: "blatt" }]),
      '---\ntyp: "blatt"\n---',
    );
  });

  it("lässt null und undefined ganz weg", () => {
    assert.equal(
      frontmatterBlock([
        { key: "a", value: null },
        { key: "b", value: undefined },
        { key: "c", value: "da" },
      ]),
      '---\nc: "da"\n---',
    );
  });

  it("behält den leeren String", () => {
    // Leer ist ein Wert: bei einer Abschrift heißt er „gelesen, es stand nichts
    // darauf". Wer ihn wie „nicht vorhanden" behandelt, verliert genau diesen
    // Unterschied.
    assert.equal(frontmatterBlock([{ key: "a", value: "" }]), '---\na: ""\n---');
  });

  it("schreibt Zahlen und Wahrheitswerte ohne Anführungszeichen", () => {
    assert.equal(
      frontmatterBlock([
        { key: "seiten", value: 3 },
        { key: "archiviert", value: false },
      ]),
      "---\nseiten: 3\narchiviert: false\n---",
    );
  });

  it("bleibt bei jedem feindlichen Wert genau drei Zeilen lang", () => {
    // Der eigentliche Test dieser Datei: Ein Titel mit einem Umbruch oder einem
    // „---" darin darf das Frontmatter nicht zerlegen. Drei Zeilen sind: Zaun,
    // ein Feld, Zaun — und der Rumpf beginnt erst danach.
    for (const text of FEINDLICH) {
      const block = frontmatterBlock([{ key: "titel", value: text }]);
      const zeilen = block.split("\n");

      assert.equal(zeilen.length, 3, `zerlegt: ${JSON.stringify(text)}`);
      assert.equal(zeilen[0], "---");
      assert.equal(zeilen[2], "---");
      assert.ok(zeilen[1].startsWith('titel: "'));
    }
  });
});

describe("codeBlock", () => {
  it("umschließt den Text mit drei Rückwärtsstrichen", () => {
    assert.equal(codeBlock("hallo"), "```\nhallo\n```");
  });

  it("macht den Zaun länger als die längste Folge im Text", () => {
    assert.equal(codeBlock("```"), "````\n```\n````");
    assert.equal(codeBlock("a ````` b"), "``````\na ````` b\n``````");
  });

  it("verändert den Text nicht", () => {
    // Eine Abschrift ist das, was auf dem Blatt steht. Wer hier maskiert oder
    // glättet, macht aus einer Quelle eine Nacherzählung.
    for (const text of FEINDLICH) {
      const block = codeBlock(text);
      const innen = block.split("\n").slice(1, -1).join("\n");
      assert.equal(innen, text);
    }
  });

  it("lässt sich von keiner Zeile im Text schließen", () => {
    for (const text of [...FEINDLICH, "```\nraus\n```", "``` ``` ```"]) {
      const zeilen = codeBlock(text).split("\n");
      const zaun = zeilen[0];

      assert.equal(zeilen[zeilen.length - 1], zaun);

      for (const zeile of zeilen.slice(1, -1)) {
        assert.notEqual(
          zeile.trimEnd(),
          zaun,
          `Zaun im Text getroffen: ${JSON.stringify(text)}`,
        );
        // Ein Codeblock endet auch an einer LÄNGEREN Zeile aus
        // Rückwärtsstrichen, nicht nur an einer gleich langen.
        assert.ok(
          !/^\s*`{3,}\s*$/.test(zeile) || zeile.trim().length < zaun.length,
          `schließende Zeile im Text: ${JSON.stringify(zeile)}`,
        );
      }
    }
  });
});
