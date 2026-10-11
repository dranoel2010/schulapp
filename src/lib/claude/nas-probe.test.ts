import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CLAUDE_EFFORT,
  CLAUDE_MAX_TOKENS,
  CLAUDE_MODELL,
  CLAUDE_RUECKFALL_BETA,
} from "@/lib/claude/client";

/**
 * Die Probe auf dem NAS (scripts/nas-probe-claude.mjs) — geprüft an ihrem
 * Quelltext, denn laufen kann sie hier nicht: sie fragt die echte API.
 *
 * Sie läuft im App-Container, und das Bild enthält src/ nicht; importieren
 * kann sie die Werte des Aufrufs also nicht, sie stehen dort ein zweites Mal.
 * Eine zweite Fassung, die niemand vergleicht, läuft auseinander — und dann
 * prüfte die Probe ein Modell oder eine Beta-Kennung, die die App gar nicht
 * benutzt, und sagte „alles gut“ über einen Weg, den kein Blatt nimmt. Dieser
 * Test ist der Vergleich.
 */

const PROBE = readFileSync(path.join(process.cwd(), "scripts", "nas-probe-claude.mjs"), "utf8");
const CLIENT = readFileSync(path.join(process.cwd(), "src", "lib", "claude", "client.ts"), "utf8");

/** Der Wert einer Konstanten, wie sie in der Probe steht. */
function konstante(name: string): string | undefined {
  return new RegExp(`^const ${name} = "([^"]*)";$`, "m").exec(PROBE)?.[1];
}

describe("die Probe auf dem NAS", () => {
  it("fragt nach demselben Modell, Aufwand und derselben Beta-Kennung wie die App", () => {
    assert.equal(konstante("MODELL"), CLAUDE_MODELL);
    assert.equal(konstante("EFFORT"), CLAUDE_EFFORT);
    assert.equal(konstante("RUECKFALL_BETA"), CLAUDE_RUECKFALL_BETA);
  });

  it("verlangt so viele Ausgabe-Tokens, wie die App bestellt", () => {
    const zahl = /^const MAX_TOKENS = ([\d_]+);$/m.exec(PROBE)?.[1];
    assert.equal(Number(zahl?.replaceAll("_", "")), CLAUDE_MAX_TOKENS);
  });

  it("schickt den Schlüssel an dieselbe feste Adresse, ohne Zweitschlüssel", () => {
    const app = /^const API_ADRESSE = "([^"]*)";$/m.exec(CLIENT)?.[1];
    assert.ok(app);
    assert.equal(konstante("API_ADRESSE"), app);
    assert.match(PROBE, /baseURL: API_ADRESSE,/);
    assert.match(PROBE, /authToken: null,/);
  });

  it("stellt nur Fragen, die nichts kosten — keine Nachricht an das Modell", () => {
    assert.doesNotMatch(PROBE, /messages\.(create|stream|parse)\(/);
    assert.match(PROBE, /models\.retrieve\(MODELL\)/);
    assert.match(PROBE, /messages\.countTokens\(/);
  });

  it("gibt den Schlüssel nirgends aus — er geht nur an den Client", () => {
    // Jede Zeile, die den Wert anfasst, ist eine von diesen dreien: lesen,
    // prüfen, dem SDK geben. Eine vierte — etwa in einer Meldung — fiele hier auf.
    const erlaubt = [/^const schluessel = ausEingabe$/, /^if \(!schluessel\) \{$/, /^apiKey: schluessel,$/];
    const zeilen = PROBE.split("\n")
      .map((zeile) => zeile.trim())
      // Der Name des Schalters (`--schluessel-auf-stdin`) ist kein Zugriff.
      .filter((zeile) => /(?<![-\w])schluessel(?![-\w])/.test(zeile) && !zeile.startsWith("//"));
    assert.equal(zeilen.length, erlaubt.length, zeilen.join("\n"));
    for (const zeile of zeilen) {
      assert.ok(erlaubt.some((muster) => muster.test(zeile)), zeile);
    }
  });
});
