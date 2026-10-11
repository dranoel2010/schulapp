import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Die Tür für Vorschläge zu einem Blatt — geprüft an ihrem Quelltext.
 *
 * Was sie tut, braucht eine Datenbank und steht deshalb in der Probe
 * (scripts/probe-leser.mts: Abschnitt 8 über propose_sheet, Abschnitt 10
 * direkt, so wie der Leser der App sie ruft). Hier steht, was ohne Datenbank zu
 * prüfen ist und was kein anderer Test vermisste: dass die Tür nur auf EINEM
 * Weg schreibt. `tools.test.ts` hält für den Web MCP fest, dass ein Agent
 * nur `read_*` und `propose_*` hat; ruft die App das Modell selbst, gibt es
 * keine Werkzeugliste, die das zeigen könnte — dann ist diese Datei die
 * Grenze, und sie muss es bleiben.
 */

const QUELLE = readFileSync(
  path.join(process.cwd(), "src", "lib", "blatt-vorschlag.ts"),
  "utf8",
);

/** Ein Quelltext ohne Kommentare — ein Name im Kommentar ist kein Aufruf. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = ohneKommentare(QUELLE);

/** Was aus einem Modul geholt wird, je Modul. */
function importe(): Map<string, string[]> {
  const ergebnis = new Map<string, string[]>();
  for (const treffer of CODE.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const namen = treffer[1]
      .split(",")
      .map((name) => name.trim().replace(/^type\s+/, ""))
      .filter(Boolean);
    ergebnis.set(treffer[2], [...(ergebnis.get(treffer[2]) ?? []), ...namen]);
  }
  return ergebnis;
}

describe("die Tür blattVorschlagen", () => {
  it("holt sich genau das, was sie braucht — und keinen Weg in den Bestand", () => {
    assert.deepEqual(Object.fromEntries(importe()), {
      "@/lib/auto-file": ["autoFile", "AutoFileResult"],
      "@/lib/inbox": ["createProposal", "proposalInputSchema", "ProposalInput"],
      "@/lib/materials": ["getMaterial"],
      "@/lib/mcp/verwerfen": ["abschriftenSieben", "nurVerworfen", "Verworfen"],
    });
    // Und kein Import an der Liste vorbei.
    assert.doesNotMatch(CODE, /import\s+\*\s+as/);
    assert.doesNotMatch(CODE, /\bimport\s*\(/);
    assert.doesNotMatch(CODE, /\brequire\s*\(/);
  });

  it("schreibt nur einen Vorschlag, und zwar als „agent“", () => {
    const anlegen = [...CODE.matchAll(/createProposal\(([^)]*)\)/g)].map((t) => t[1]);
    assert.equal(anlegen.length, 1);
    assert.match(anlegen[0] ?? "", /"agent"\s*$/);
    // Kein `nurOhneVorschlag`: das ist das EINMAL der App für reine
    // Docling-Blätter und würde hier die nachgereichte Seite an einem Blatt
    // mit liegendem Menschen-Vorschlag blockieren.
    assert.doesNotMatch(CODE, /nurOhneVorschlag/);
  });

  it("schreibt nie selbst in Seiten oder Blätter — übernommen wird nur über autoFile", () => {
    for (const verboten of [
      "setMaterialTranscripts",
      "applyProposal",
      "updateMaterial",
      "setMaterialTopics",
      "leserFestlegen",
      "markFiled",
      "db.",
    ]) {
      assert.equal(CODE.includes(verboten), false, `${verboten} in der Tür`);
    }
  });

  it("ist die einzige Stelle, an der propose_sheet einen Vorschlag anlegt", () => {
    const run = ohneKommentare(
      readFileSync(path.join(process.cwd(), "src", "lib", "mcp", "run.ts"), "utf8"),
    );
    assert.match(run, /import \{ blattVorschlagen \} from "@\/lib\/blatt-vorschlag";/);
    assert.match(run, /await blattVorschlagen\(user\.id,/);
    // Kein zweiter Weg am Rand vorbei: run.ts legt keinen Blatt-Vorschlag
    // mehr selbst an und lässt nicht selbst einordnen.
    assert.doesNotMatch(run, /\bcreateProposal\(/);
    assert.doesNotMatch(run, /\bautoFile\(/);
    assert.doesNotMatch(run, /\babschriftenSieben\(/);
  });
});
