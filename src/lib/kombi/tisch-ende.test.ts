import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { endeHinweis, kartenEnde, knopfNachSchliessen, ohneBlatt } from "@/lib/kombi/tisch-ende";
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

  it("einzeln, kein Blatt: der Tisch schließt mit Toast statt auf Karten zu fallen", () => {
    assert.deepEqual(ohneBlatt(true, "Present perfect"), {
      art: "schliessen",
      toast: "Heute kein Blatt zu Present perfect.",
    });
    assert.deepEqual(ohneBlatt(false, "Present perfect"), { art: "karten" });
  });

  it("keine Fragen: kein „sitzt“ und kein beenden", () => {
    const e = kartenEnde("Simple past", 0, 0);
    assert.equal(e.beenden, false);
    assert.ok(!e.kopf.includes("sitzt") && !e.zeile.includes("sitzt"));
    assert.ok(!e.zeile.includes("0 Fragen"));
    assert.equal(e.zeile, "Zu Simple past gibt es heute keine Fragen.");
  });

  it("mit Fragen wie bisher: sitzt, gezählt, beendet", () => {
    assert.deepEqual(kartenEnde("Simple past", 3, 3), {
      kopf: "Simple past sitzt.",
      zeile: "3 Fragen, alle beim ersten Mal.",
      beenden: true,
    });
    assert.equal(kartenEnde("Simple past", 1, 0).zeile, "1 Frage, 0 beim ersten Mal.");
  });
});
