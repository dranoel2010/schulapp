import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

/**
 * Abnahme 15: sichtbare Texte stehen ohne Gedankenstrich („—“).
 *
 * Geprüft wird jede Zeichenkette, jedes Stück einer Vorlage und jeder
 * JSX-Text in src/app, src/components, src/lib und src/recall, nicht aber
 * Kommentare. Zeitspannen mit Halbgeviertstrich („08:00 – 09:30“) betrifft
 * das nicht.
 *
 * Ausgenommen ist, was nur ein Modell liest und kein Mensch in der App sieht:
 * Aufträge und Werkzeugbeschreibungen für Claude, Zeilen für das Protokoll
 * des Containers (console.*) und Beschreibungen in `.describe()`. Dazu die
 * Dokumente für den Vault: Ändert sich dort ein Zeichen, liefert die nächste
 * Übergabe jedes Blatt neu (siehe „lässt den Altbestand Zeichen für Zeichen“).
 */

const WURZEL = path.resolve(import.meta.dirname, "..", "..");
const ORDNER = ["src/app", "src/components", "src/lib", "src/recall"];

/** Dateien, die ein Modell liest (Auftrag, Werkzeuge, Anleitung im Vault), und die Vault-Dokumente. */
const NUR_FUER_MODELLE = [
  "src/lib/mcp/",
  "src/lib/abschrift-regeln.ts",
  "src/lib/arbeitsblatt/auftrag.ts",
  "src/lib/fragenlauf-auftrag.ts",
  "src/lib/klausur-stoff.ts",
  "src/lib/leser/claude-auftrag.ts",
  "src/lib/wiki/manifest.ts",
  "src/lib/wiki/documents.ts",
];

function dateien(): string[] {
  const liste: string[] = [];
  const gehe = (ordner: string) => {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      const p = path.join(ordner, e.name);
      if (e.isDirectory()) gehe(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) liste.push(p);
    }
  };
  for (const o of ORDNER) gehe(path.join(WURZEL, o));
  return liste;
}

/** Steht der Knoten in den Argumenten von console.* oder .describe()? */
function ausgenommen(knoten: ts.Node): boolean {
  for (let p: ts.Node | undefined = knoten.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
      const ziel = p.expression;
      if (ts.isIdentifier(ziel.expression) && ziel.expression.text === "console") return true;
      if (ziel.name.text === "describe") return true;
    }
  }
  return false;
}

/**
 * „—“ immer, „–“ als Gedankenstrich mit Leerzeichen davor und danach
 * (Runde 20: „gelesen (Docling) – von niemandem“). Ein Bereich ohne
 * Leerzeichen („3–5“) und eine Zeitspanne zwischen zwei Zahlen
 * („08:00 – 09:30“, „Sa. 24. 10. – Sa. 7. 11.“) sind kein Gedankenstrich,
 * ebenso ein Strich allein als leerer Wert.
 */
export function hatStrich(text: string): boolean {
  if (text.includes("—")) return true;
  // allein: Platzhalter für einen leeren Wert („–“) oder die Spanne zwischen
  // zwei eingesetzten Werten (`${von} – ${bis}`)
  if (text.trim() === "–") return false;
  const ohneSpannen = text.replace(/(\d\.?)\s+–\s+/g, "$1");
  return /(^|\s)–(\s|$)/.test(ohneSpannen);
}

function fundeIn(datei: string): string[] {
  const quelle = fs.readFileSync(datei, "utf8");
  if (!quelle.includes("—") && !quelle.includes("–")) return [];
  const sf = ts.createSourceFile(
    datei,
    quelle,
    ts.ScriptTarget.Latest,
    true,
    datei.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const funde: string[] = [];
  const besuche = (n: ts.Node) => {
    const text =
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isJsxText(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
        ? n.text
        : null;
    if (text !== null && hatStrich(text) && !ausgenommen(n)) {
      const zeile = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      funde.push(`${path.relative(WURZEL, datei)}:${zeile}  ${text.replace(/\s+/g, " ").trim().slice(0, 90)}`);
    }
    ts.forEachChild(n, besuche);
  };
  besuche(sf);
  return funde;
}

describe("Gedankenstriche", () => {
  it("kein Gedankenstrich in Texten, die ein Mensch in der App sieht", () => {
    const funde = dateien()
      .filter((d) => !NUR_FUER_MODELLE.some((a) => path.relative(WURZEL, d).startsWith(a)))
      .flatMap(fundeIn);
    assert.deepEqual(funde, [], `Gedankenstriche in sichtbaren Texten:\n${funde.join("\n")}`);
  });

  it("ein Halbgeviertstrich mit Leerzeichen ist ein Gedankenstrich, ein Bereich nicht", () => {
    assert.equal(hatStrich("Maschinell gelesen (Docling) – von niemandem gegengelesen."), true);
    assert.equal(hatStrich(" · Quelle maschinell gelesen (Docling) – Zitat am Foto prüfen"), true);
    assert.equal(hatStrich("– am Anfang"), true);
    assert.equal(hatStrich("Seiten 3–5"), false);
    assert.equal(hatStrich("08:00 – 09:30"), false);
    assert.equal(hatStrich("Herbstferien_Sa. 24. 10. – Sa. 7. 11. 2026"), false);
    assert.equal(hatStrich(" – "), false);
    assert.equal(hatStrich("–"), false);
    assert.equal(hatStrich("Kein Strich"), false);
  });

  it("die Prüfung findet einen Gedankenstrich in JSX-Text und Vorlagen", () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "gedankenstrich-"));
    const probe = path.join(ordner, "probe.tsx");
    fs.writeFileSync(
      probe,
      'export const a = <p>Hier — dort</p>;\nexport const b = (x: string) => `${x} — y`;\nexport const c = "gelesen – geprüft";\nexport const d = "3–5 und 08:00 – 09:30";\nconsole.info("Protokoll — bleibt");\n// Kommentar — bleibt\n',
    );
    try {
      assert.equal(fundeIn(probe).length, 3);
    } finally {
      fs.rmSync(ordner, { recursive: true });
    }
  });
});
