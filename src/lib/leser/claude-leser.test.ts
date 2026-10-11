import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Der Leser der App — geprüft an seinem Quelltext, wie die Tür
 * (blatt-vorschlag.test.ts).
 *
 * Was er tut, braucht eine Datenbank und einen Sender und steht deshalb in
 * scripts/probe-claude-leser.mts. Hier steht, was ohne beides zu prüfen ist
 * und was sonst niemand vermisste: dass ein Modell, das nicht
 * vertrauenswürdige Blätter liest, auch aus der App heraus nur auf EINEM Weg
 * schreibt. Im Web MCP zeigt das die Werkzeugliste (tools.test.ts); ruft die
 * App das Modell selbst, gibt es keine Liste — dann sind diese Dateien die
 * Grenze.
 */

function quelle(...teile: string[]): string {
  return readFileSync(path.join(process.cwd(), ...teile), "utf8");
}

/** Ein Quelltext ohne Kommentare — ein Name im Kommentar ist kein Aufruf. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LESER = ohneKommentare(quelle("src", "lib", "leser", "claude-leser.ts"));
const LAEUFE = ohneKommentare(quelle("src", "lib", "leser", "laeufe.ts"));
const ABLAUF = ohneKommentare(quelle("src", "lib", "leser", "claude-ablauf.ts"));
const AUFTRAG = ohneKommentare(quelle("src", "lib", "leser", "claude-auftrag.ts"));
const TROCKEN = ohneKommentare(quelle("src", "lib", "leser", "claude-trocken.ts"));

/** Diese Namen schreiben in Blätter, Seiten oder Vorschläge — keiner gehört in den Leser. */
const SCHREIBWEGE = [
  "setMaterialTranscripts",
  "applyProposal",
  "createProposal",
  "updateProposal",
  "updateMaterial",
  "setMaterialTopics",
  "leserFestlegen",
  "markFiled",
  "autoFile",
  "deletePage",
  "deleteMaterial",
];

describe("der Leser der App schreibt nur durch die Tür", () => {
  it("ruft für einen Vorschlag genau blattVorschlagen und sonst keinen Schreibweg", () => {
    assert.match(LESER, /import \{ blattVorschlagen \} from "@\/lib\/blatt-vorschlag";/);
    assert.equal([...LESER.matchAll(/\bblattVorschlagen\(/g)].length, 1);

    for (const datei of [LESER, LAEUFE, ABLAUF, AUFTRAG, TROCKEN]) {
      for (const verboten of SCHREIBWEGE) {
        assert.doesNotMatch(datei, new RegExp(`\\b${verboten}\\b`), verboten);
      }
    }
  });

  it("schreibt selbst nur den Vermerk eines Laufs — in genau eine Tabelle", () => {
    // Der Leser fasst die Datenbank gar nicht an, nur über laeufe.ts …
    assert.doesNotMatch(LESER, /\bdb\./);
    assert.doesNotMatch(LESER, /from "@\/db"/);
    // … und dort wird nur in leser_laeufe geschrieben: angelegt (der Vermerk
    // in einem Zug, die Zeile „laeuft“ vor dem Aufruf, und seit der
    // Nachprüfung vom 11.10.2026 die Spur eines verworfenen Vorschlags von
    // außen) und ergänzt (das Ergebnis danach). Kein delete — ein Vermerk
    // verschwindet nur mit seinem Blatt.
    const inserts = [...LAEUFE.matchAll(/\.insert\((\w+)\)/g)].map((t) => t[1]);
    assert.deepEqual(inserts, ["leserLaeufe", "leserLaeufe", "leserLaeufe"]);
    const updates = [...LAEUFE.matchAll(/\.update\((\w+)\)/g)].map((t) => t[1]);
    assert.deepEqual(updates, ["leserLaeufe", "leserLaeufe"]);
    assert.doesNotMatch(LAEUFE, /\.delete\(/);
  });

  it("legt die Zeile des Laufs an, BEVOR er ruft — ein Neustart mitten im Strom hinterlässt eine Spur", () => {
    const beginn = LESER.indexOf("await laufBeginnen(");
    const aufruf = LESER.indexOf("await einordnenRufen(");
    const abschluss = LESER.indexOf("await laufAbschliessen(");
    assert.ok(beginn > 0 && aufruf > beginn && abschluss > aufruf, JSON.stringify({ beginn, aufruf, abschluss }));
    // Der alte Weg — ein Vermerk erst hinter dem Aufruf — ist nicht mehr da.
    assert.doesNotMatch(LESER, /\blaufVermerken\(/);
  });

  it("holt nichts aus harness/ und keinen Text von Docling", () => {
    for (const datei of [LESER, LAEUFE, ABLAUF, AUFTRAG, TROCKEN]) {
      // harness/ ist seit dem 11.10.2026 stillgelegt — der Code liegt für den
      // Notfall noch im Repo, gehört aber nicht zur App: im Bau-Kontext fehlt
      // er (.dockerignore), und der Typprüfer der App schließt ihn aus.
      assert.doesNotMatch(datei, /from "[^"]*harness/);
      // Doclings Rohtext geht nie an Claude (src/db/schema.ts an
      // `docling_text`) — der Leser schickt nur Fotos.
      assert.doesNotMatch(datei, /doclingText|docling_text|ersteSeiteDocling/);
    }
  });

  it("ruft das Modell nur über claudeRufen, mit dem Systemtext der Regeln", () => {
    assert.doesNotMatch(LESER, /new Anthropic|@anthropic-ai\/sdk/);
    const aufrufe = [...LESER.matchAll(/claudeRufen\(\s*\{([\s\S]*?)\}\s*,/g)].map((t) => t[1]);
    assert.equal(aufrufe.length, 2);
    for (const aufruf of aufrufe) {
      assert.match(aufruf ?? "", /system: ABSCHREIBER_SYSTEM/);
      // Frist und Grenze der Tokens aus derselben Seitenzahl — damit
      // max_tokens vor der Frist greift (@/lib/leser/claude-auftrag).
      assert.match(aufruf ?? "", /fristMs: fristFuer\(fotos\.length\)/);
      assert.match(aufruf ?? "", /maxTokens: maxTokensFuer\(fotos\.length\)/);
    }
  });
});

describe("der trockene Lauf für die Messung schreibt gar nichts", () => {
  it("geht weder durch die Tür noch in leser_laeufe, und fasst die Datenbank nicht selbst an", () => {
    assert.doesNotMatch(TROCKEN, /\bblattVorschlagen\b|@\/lib\/blatt-vorschlag/);
    assert.doesNotMatch(TROCKEN, /\blaufVermerken\b|\.\/laeufe"|@\/lib\/leser\/laeufe/);
    assert.doesNotMatch(TROCKEN, /from "@\/db"|\bdb\./);
    // Aus @/lib/materials nur diese drei, und alle drei lesen.
    const materials = /import \{([^}]*)\} from "@\/lib\/materials";/.exec(TROCKEN)?.[1] ?? "";
    assert.deepEqual(
      materials.split(",").map((name) => name.trim()).filter(Boolean).sort(),
      ["getMaterial", "listMaterialTranscripts", "readPageImage"],
    );
  });

  it("ruft dasselbe wie der Leser: claudeRufen mit dem Systemtext und den Antworten von dort", () => {
    assert.doesNotMatch(TROCKEN, /new Anthropic|@anthropic-ai\/sdk/);
    const aufrufe = [...TROCKEN.matchAll(/claudeRufen\(\s*\{([\s\S]*?)\}\s*,/g)].map((t) => t[1] ?? "");
    assert.equal(aufrufe.length, 2);
    for (const aufruf of aufrufe) {
      assert.match(aufruf, /system: ABSCHREIBER_SYSTEM/);
      assert.match(aufruf, /inhalt: abschreibInhalt\((einordnen|nachlese)Auftrag\(/);
      assert.match(aufruf, /schema: (EINORDNEN|NACHLESE)_ANTWORT/);
      assert.match(aufruf, /fristMs: fristFuer\(/);
      assert.match(aufruf, /maxTokens: maxTokensFuer\(/);
    }
    // Die gespeicherte Abschrift ist nur für die Ausgabe: sie steht in
    // keinem Aufruf.
    for (const aufruf of aufrufe) assert.doesNotMatch(aufruf, /gespeichert|transcript/i);
  });
});

describe("die Anstöße", () => {
  it("stößt am Ende JEDES Laufs der Zuteilung an — auch nach einem Fehler", () => {
    const zuteilung = ohneKommentare(quelle("src", "lib", "leser", "zuteilung.ts"));
    assert.match(
      zuteilung,
      /try \{\s*await zuteilen\(userId, deps\);\s*\} finally \{\s*claudeAnstossen\(userId\);\s*\}/,
    );
  });

  it("wartet beim Start der App nur auf das Laden des Moduls, nie auf einen Lauf", () => {
    const start = ohneKommentare(quelle("src", "instrumentation.ts"));
    assert.match(start, /process\.env\.NEXT_RUNTIME !== "nodejs"/);
    assert.equal([...start.matchAll(/\bawait\b/g)].length, 1);
    assert.match(start, /await import\("@\/lib\/leser\/zuteilung"\)/);
    assert.match(start, /^\s*leserBeimStart\(\);$/m);
    // Kein `export const runtime` und kein `maxDuration` (wirken unter
    // `next start` nicht).
    assert.doesNotMatch(start, /export const (runtime|maxDuration)/);
  });

  it("stößt den Knopf nach der Antwort an und kehrt sofort zurück — und nur, wenn er etwas tun kann", () => {
    const actions = ohneKommentare(quelle("src", "app", "(app)", "material", "actions.ts"));
    assert.match(actions, /after\(\(\) => claudeVonHandAnstossen\(user\.id, materialId, gesehen\)\);/);
    assert.match(actions, /if \(claudeConfigured\(\) && claudeKnopfMoeglich\(materialId\)\) \{/);
    assert.doesNotMatch(actions, /await claudeVonHand/);
  });
});
