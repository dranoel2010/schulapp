import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Abnahmerunde 18: „Stoff der Klausur“ und „Stundenplan bearbeiten“ rechnen
 * wie die übrigen Seiten mit dem App-Tag (bis 4 Uhr gilt der Vortag) und der
 * App-Uhr (`jetzt()`, mit Testuhr die Testuhr), nicht mit dem Kalendertag.
 */

const SEITEN = ["src/app/(app)/abruf/klausur/page.tsx", "src/app/(app)/stundenplan/bearbeiten/page.tsx"];

describe("Seiten mit dem App-Tag", () => {
  for (const seite of SEITEN) {
    it(seite, () => {
      const text = readFileSync(join(process.cwd(), seite), "utf8");
      assert.match(text, /appTag\(await jetzt\(\)\)/);
      assert.doesNotMatch(text, /todayInBerlin\(/);
    });
  }
});
