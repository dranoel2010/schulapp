import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { themenLaufAktiv, themenLaufEnde, themenLaufStart } from "@/lib/kombi/themen-lauf";

describe("„Thema folgt“ hängt am Lauf von Jev (Plan 3.8)", () => {
  it("steht, solange der Lauf läuft, und fällt mit seinem Ende", () => {
    themenLaufStart("a", 1_000);
    assert.equal(themenLaufAktiv("a", 2_000), true);
    themenLaufEnde("a");
    assert.equal(themenLaufAktiv("a", 2_000), false);
  });
  it("ein Lauf, der nie zurückkommt, gilt nach der Frist als vorbei", () => {
    themenLaufStart("b", 0);
    assert.equal(themenLaufAktiv("b", 3 * 60_000 + 1), false);
    assert.equal(themenLaufAktiv("b", 0), false);
  });
});
