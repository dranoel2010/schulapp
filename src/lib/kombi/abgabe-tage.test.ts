import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { abgabeTage, werktagAb } from "@/lib/kombi/abgabe-tage";

// Mittwoch, 14.10.2026: morgen ist Donnerstag
describe("abgabeTage", () => {
  it("nennt nächste Stunde, die zwei nächsten Schultage und den gewählten Tag, sortiert und ohne doppelte", () => {
    assert.deepEqual(abgabeTage({ naechsteStunde: "2026-10-16", morgen: "2026-10-15", gewaehlt: "2026-10-15" }), ["2026-10-15", "2026-10-16"]);
    assert.deepEqual(abgabeTage({ naechsteStunde: "2026-10-20", morgen: "2026-10-15", gewaehlt: "2026-10-22" }), [
      "2026-10-15",
      "2026-10-16",
      "2026-10-20",
      "2026-10-22",
    ]);
  });

  it("springt über das Wochenende", () => {
    // Freitag, 16.10.: morgen ist Samstag, also Montag und Dienstag
    assert.deepEqual(abgabeTage({ morgen: "2026-10-17" }), ["2026-10-19", "2026-10-20"]);
    assert.equal(werktagAb("2026-10-18"), "2026-10-19");
    assert.equal(werktagAb("2026-10-19"), "2026-10-19");
  });

  it("behält einen vergangenen Tag, damit er gewählt bleibt, und lässt Unsinn weg", () => {
    assert.deepEqual(abgabeTage({ morgen: "2026-10-15", gewaehlt: "2026-10-12" }), ["2026-10-12", "2026-10-15", "2026-10-16"]);
    assert.deepEqual(abgabeTage({ morgen: "2026-10-15", gewaehlt: "" }), ["2026-10-15", "2026-10-16"]);
  });
});
