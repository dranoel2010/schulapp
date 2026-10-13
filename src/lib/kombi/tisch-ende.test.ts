import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { endeHinweis, knopfNachSchliessen } from "@/lib/kombi/tisch-ende";
import type { WhStand } from "@/lib/kombi/wiederholen-text";

/** Ein einzeln geöffnetes Grammatikblatt (Antwort 5) sagt nichts über die fälligen Themen. */

const durch: WhStand = { kind: "text", text: "Für heute durch.", ok: true };
const knopf: WhStand = { kind: "knopf", n: 1, sub: "Englisch, Simple past" };

describe("Tisch: Ende und Knopf", () => {
  it("Wiederholen wie bisher: der Tisch setzt den Knopf vorab", () => {
    assert.deepEqual(knopfNachSchliessen(false, durch), durch);
    assert.deepEqual(knopfNachSchliessen(false, knopf), knopf);
  });

  it("einzelnes Blatt: weder „Für heute durch.“ noch das eine Thema landet auf dem Knopf", () => {
    assert.equal(knopfNachSchliessen(true, durch), null);
    assert.equal(knopfNachSchliessen(true, knopf), null);
  });

  it("„Alle Themen für heute durch.“ nur nach dem letzten fälligen Thema", () => {
    assert.equal(endeHinweis(false, 0), "Alle Themen für heute durch.");
    assert.equal(endeHinweis(false, 2), null);
    assert.equal(endeHinweis(true, 0), null);
  });
});
