import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { mitErneut } from "@/components/kombi/tisch/mit-erneut";

/**
 * Schlussrunde: „Keine Verbindung · Erneut“ auf dem Tisch des Lernblocks tat
 * nichts (leere Funktion). Jetzt stellt „Erneut“ dieselbe Anfrage noch einmal.
 */

const warten = () => new Promise((r) => setTimeout(r, 0));

describe("mitErneut", () => {
  it("Laden scheitert einmal, Erneut lädt die Fragen", async () => {
    let anfragen = 0;
    const fragen: string[][] = [];
    let erneut: (() => void) | null = null;
    mitErneut(
      () => {
        anfragen += 1;
        return anfragen === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(["Klausurfrage 5"]);
      },
      (r) => fragen.push(r),
      (e) => {
        erneut = e;
      },
    );
    await warten();
    assert.equal(anfragen, 1);
    assert.deepEqual(fragen, []);
    assert.ok(erneut, "der Fehlerweg bekommt eine Erneut-Funktion");
    (erneut as () => void)();
    await warten();
    assert.equal(anfragen, 2);
    assert.deepEqual(fragen, [["Klausurfrage 5"]]);
  });

  it("scheitert auch der zweite Versuch, gibt es wieder Erneut", async () => {
    let anfragen = 0;
    let fehler = 0;
    mitErneut(
      () => {
        anfragen += 1;
        return Promise.reject(new Error("offline"));
      },
      () => assert.fail("kein Erfolg erwartet"),
      (e) => {
        fehler += 1;
        if (fehler < 3) e();
      },
    );
    for (let i = 0; i < 5; i++) await warten();
    assert.equal(anfragen, 3);
    assert.equal(fehler, 3);
  });

  it("der Tisch des Lernblocks gibt keinem Erneut eine leere Funktion", () => {
    const code = readFileSync(join(process.cwd(), "src", "components", "kombi", "tisch", "lernblock-tisch.tsx"), "utf8");
    assert.doesNotMatch(code, /\(\) => \{\},\s*"Erneut"/);
    assert.match(code, /mitErneut\(\s*\(\) => lernblockTischAction\(blockId\)/);
    assert.match(code, /mitErneut\(\s*\(\) => lernblockBlattAction\(materialId\)/);
  });
});
