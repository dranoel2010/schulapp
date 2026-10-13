import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { whText } from "@/lib/kombi/wiederholen-text";

describe("whText", () => {
  it("ein Wochentag bekommt den Schlusspunkt", () => {
    assert.equal(whText(true, "Dienstag"), "Für heute durch. Nächstes Thema Dienstag.");
    assert.equal(whText(false, "Dienstag"), "Heute ist nichts fällig. Nächstes Thema Dienstag.");
  });

  it("ein Datum endet schon auf einen Punkt, kein zweiter dahinter", () => {
    assert.equal(whText(true, "Samstag, 31.10."), "Für heute durch. Nächstes Thema Samstag, 31.10.");
  });

  it("ohne nächstes Thema nur der erste Satz", () => {
    assert.equal(whText(true, null), "Für heute durch.");
  });
});
