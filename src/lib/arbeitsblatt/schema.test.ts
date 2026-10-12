import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inhaltSchema,
  quellbindung,
  zitatGebunden,
  type Aufgabe,
} from "@/lib/arbeitsblatt/schema";

const ABSCHRIFT =
  "Scheitelpunktform: f(x) = a(x − d)² + e. Übung 1: Lies den Scheitelpunkt ab. ⟨unleserlich⟩ Übung 2: Verschiebe die Normalparabel.";

function aufgabe(zitat: string, kurz = "Aufgabe"): Aufgabe {
  return {
    kurz,
    q: "Lies den Scheitelpunkt ab.",
    platz: 15,
    zitat,
    l: [["p", "{S(4 | 1)}"]],
  };
}

describe("Arbeitsblatt: Quellbindung (Plan 3.6, H)", () => {
  it("ein wörtliches Zitat ist gebunden", () => {
    assert.ok(zitatGebunden("Lies den Scheitelpunkt ab", [ABSCHRIFT]));
  });

  it("eine erfundene Aufgabe wird verworfen", () => {
    assert.ok(!zitatGebunden("Berechne die Ableitung", [ABSCHRIFT]));
  });

  it("ein Zitat nur aus ⟨⟩ oder mit ⟨ ist nicht gebunden", () => {
    assert.ok(!zitatGebunden("unleserlich", [ABSCHRIFT]));
    assert.ok(!zitatGebunden("⟨unleserlich⟩", [ABSCHRIFT]));
    assert.ok(!zitatGebunden("  ", [ABSCHRIFT]));
  });

  it("unter 5 gültigen Aufgaben reicht es nicht", () => {
    const vier = [1, 2, 3, 4].map((i) => aufgabe("Lies den Scheitelpunkt ab", `A${i}`));
    const r = quellbindung([...vier, aufgabe("erfunden")], [ABSCHRIFT]);
    assert.equal(r.gueltig.length, 4);
    assert.equal(r.verworfen.length, 1);
    assert.equal(r.reicht, false);
  });

  it("5 bis 8 gültige reichen, mehr werden gekappt", () => {
    const neun = Array.from({ length: 9 }, (_, i) => aufgabe("Verschiebe die Normalparabel", `A${i}`));
    const r = quellbindung(neun, [ABSCHRIFT]);
    assert.equal(r.gueltig.length, 8);
    assert.equal(r.reicht, true);
  });

  it("das Inhaltsschema nimmt die Form aus dem Prototyp", () => {
    const inhalt = {
      teil: "Scheitelpunktform",
      minuten: 20,
      papier: "kaestchen",
      quellen: [{ materialId: "8f0d3c1e-5b7a-4c2d-9e1f-0a1b2c3d4e5f", datum: "2026-10-08", zitat: "Scheitelpunktform, Übungen" }],
      aufgaben: Array.from({ length: 6 }, (_, i) => ({
        kurz: `Aufgabe ${i + 1}`,
        q: "Lies den Scheitelpunkt ab.",
        teile: ["{f(x) = (x − 4)² + 1}"],
        platz: 15,
        zitat: "Lies den Scheitelpunkt ab",
        l: [
          ["teile", ["{S(4 | 1)}, nach oben geöffnet"]],
          ["eq", [["{f(x)}", "{(x + 2)² − 3}"]]],
          ["erg", "{S(−2 | −3)}"],
          ["hint", "Das Vorzeichen dreht sich um."],
        ],
      })),
    };
    assert.ok(inhaltSchema.safeParse(inhalt).success);
    assert.ok(!inhaltSchema.safeParse({ ...inhalt, aufgaben: inhalt.aufgaben.slice(0, 4) }).success);
  });
});
