import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { laufAnzeige } from "@/lib/leser/claude-ablauf";

const LAUF = {
  art: "arbeitsblatt" as const,
  grund: "6 Aufgaben",
  kostenUsd: 0.31,
  abbruch: null,
  gemessen: true,
  fristRestMs: null,
  createdAt: new Date("2026-10-12T14:40:00Z"),
};

describe("Lauf-Anzeige kennt die Art „arbeitsblatt“ (Plan 3.6)", () => {
  it("ein gebautes Blatt heißt „Arbeitsblatt gebaut“", () => {
    assert.match(laufAnzeige({ ...LAUF, ergebnis: "vorschlag" }), /: Arbeitsblatt gebaut — 6 Aufgaben · /);
  });
  it("zu wenig Aufgaben heißt „kein Arbeitsblatt“", () => {
    assert.match(laufAnzeige({ ...LAUF, ergebnis: "kein-vorschlag", grund: "3 quellgebundene Aufgaben" }), /: kein Arbeitsblatt — 3 quellgebundene/);
  });
});
