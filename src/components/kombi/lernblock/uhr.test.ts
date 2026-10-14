import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { appJetzt, appUhrStellen, blockLesen, blockVomServer, gelernt, gestartet, restMs } from "@/components/kombi/lernblock/uhr";
import type { BlockDaten } from "@/lib/kombi/lernblock-daten";

/**
 * Die Lernblock-Uhr im Gerät zählt mit der App-Uhr: der Server schreibt
 * `laeuft_seit` mit `jetzt()`, mit Testuhr also nicht mit der Uhr des Geräts.
 */

const MIN = 60_000;

afterEach(() => appUhrStellen(0));

function block(teil: Partial<BlockDaten> = {}): BlockDaten {
  return {
    id: "b1",
    minuten: 10,
    status: "open",
    laeuftSeit: null,
    pausiertSeit: null,
    pauseMs: 0,
    minutenGelernt: null,
    ...teil,
  } as BlockDaten;
}

describe("Lernblock-Uhr mit der App-Uhr", () => {
  it("appJetzt ist die Uhr des Geräts plus Versatz", () => {
    const vorher = Date.now();
    assert.ok(Math.abs(appJetzt() - vorher) < 1000);
    appUhrStellen(6.5 * 3600_000);
    assert.ok(Math.abs(appJetzt() - (Date.now() + 6.5 * 3600_000)) < 1000);
    appUhrStellen(Number.NaN);
    assert.ok(Math.abs(appJetzt() - (Date.now() + 6.5 * 3600_000)) < 1000);
  });

  it("ein Block vom Server mit Testuhr läuft im Gerät weiter, statt zu stehen oder abzulaufen", () => {
    // Testuhr Mi 14.10. 21:10, Gerät 14:43: Versatz gut sechs Stunden
    const versatz = 6 * 3600_000 + 27 * MIN;
    const start = new Date(Date.now() + versatz).toISOString();
    blockVomServer({ block: block({ laeuftSeit: start }), uhrVersatz: versatz });
    const b = blockLesen("b1")!;
    assert.equal(b.laeuftSeit, start);
    // gleich nach dem Start: knapp 10 Minuten übrig, nicht abgelaufen
    const rest = restMs(b, appJetzt());
    assert.ok(rest > 9 * MIN && rest <= 10 * MIN, String(rest));
    // drei Minuten später (App-Uhr): sieben übrig, drei gelernt
    const spaeter = Date.parse(start) + 3 * MIN;
    assert.equal(restMs(b, spaeter), 7 * MIN);
    assert.equal(gelernt(b, spaeter), 3);
    // mit der Uhr des Geräts allein stünde sie
    assert.equal(restMs(b, Date.now()), 10 * MIN);
  });

  it("optimistisch gestartet mit appJetzt passt zum Server", () => {
    appUhrStellen(-2 * 3600_000);
    const b = gestartet(block(), appJetzt());
    assert.ok(Math.abs(Date.parse(b.laeuftSeit!) - (Date.now() - 2 * 3600_000)) < 1000);
  });

  it("Tisch und Arbeitsblatt zählen nicht mit Date.now()", () => {
    for (const datei of [join("tisch", "lernblock-tisch.tsx"), join("tisch", "arbeitsblatt", "tisch-blatt.tsx"), join("home", "klausur-block.tsx")]) {
      const code = readFileSync(join(process.cwd(), "src", "components", "kombi", datei), "utf8");
      assert.doesNotMatch(code, /(gestartet|pausiert|fortgesetzt|gelernt|restMs)\([^)]*Date\.now\(\)/, datei);
      assert.doesNotMatch(code, /const jetztMs = Date\.now\(\)/, datei);
      assert.doesNotMatch(code, /blockMerken\(r\.block\)/, datei);
    }
  });
});
