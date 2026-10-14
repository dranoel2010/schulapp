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

function fundeIn(datei: string): string[] {
  const quelle = fs.readFileSync(datei, "utf8");
  if (!quelle.includes("—")) return [];
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
    if (text?.includes("—") && !ausgenommen(n)) {
      const zeile = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      funde.push(`${path.relative(WURZEL, datei)}:${zeile}  ${text.replace(/\s+/g, " ").trim().slice(0, 90)}`);
    }
    ts.forEachChild(n, besuche);
  };
  besuche(sf);
  return funde;
}

describe("Gedankenstriche", () => {
  it("kein „—“ in Texten, die ein Mensch in der App sieht", () => {
    const funde = dateien()
      .filter((d) => !NUR_FUER_MODELLE.some((a) => path.relative(WURZEL, d).startsWith(a)))
      .flatMap(fundeIn);
    assert.deepEqual(funde, [], `Gedankenstriche in sichtbaren Texten:\n${funde.join("\n")}`);
  });

  it("die Prüfung findet einen Gedankenstrich in JSX-Text und Vorlagen", () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "gedankenstrich-"));
    const probe = path.join(ordner, "probe.tsx");
    fs.writeFileSync(
      probe,
      'export const a = <p>Hier — dort</p>;\nexport const b = (x: string) => `${x} — y`;\nconsole.info("Protokoll — bleibt");\n// Kommentar — bleibt\n',
    );
    try {
      assert.equal(fundeIn(probe).length, 2);
    } finally {
      fs.rmSync(ordner, { recursive: true });
    }
  });
});
