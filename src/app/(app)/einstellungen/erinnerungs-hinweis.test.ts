import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { erinnerungsHinweis } from "./erinnerungs-hinweis";

/** Abnahmerunde 17: der Satz für Entwickler steht nicht in der gebauten App. */
describe("Hinweis unter den Erinnerungen", () => {
  const gebaut = { status: "off", hasWorker: true, entwicklung: false, installiert: false };

  it("in der gebauten App höchstens der Rat zur installierten App", () => {
    assert.equal(erinnerungsHinweis(gebaut), "Am zuverlässigsten in der installierten App.");
    assert.equal(erinnerungsHinweis({ ...gebaut, status: "on" }), "Am zuverlässigsten in der installierten App.");
    assert.equal(erinnerungsHinweis({ ...gebaut, installiert: true }), null);
  });

  it("in der Entwicklung oder ohne Dienst im Hintergrund der Satz dazu", () => {
    assert.match(erinnerungsHinweis({ ...gebaut, entwicklung: true }) ?? "", /Entwicklung/);
    assert.match(erinnerungsHinweis({ ...gebaut, hasWorker: false }) ?? "", /gebauten App/);
  });

  it("nichts, solange geprüft wird, der Browser es nicht kann oder die Schlüssel fehlen", () => {
    assert.equal(erinnerungsHinweis({ ...gebaut, status: "checking" }), null);
    assert.equal(erinnerungsHinweis({ ...gebaut, status: "unsupported" }), null);
    assert.equal(erinnerungsHinweis({ ...gebaut, status: "unconfigured", hasWorker: false }), null);
  });
});
