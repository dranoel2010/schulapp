import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { statusTexts } from "@/components/kombi/ablauf/status-texte";
import { appTagGrenzen, berlinZeitpunkt, blattFertig, blattStatus, laufGescheitert } from "@/lib/kombi/blaetter";

describe("Status eines Blatts (Plan 3.8)", () => {
  it("nicht eingeordnet: liest → einordnen, gescheitert → fehlgeschlagen, sonst im Korb", () => {
    assert.equal(blattStatus({ eingeordnet: false, ungelesen: 1, inArbeit: true, gescheitert: false }), "einordnen");
    assert.equal(blattStatus({ eingeordnet: false, ungelesen: 1, inArbeit: false, gescheitert: true }), "fehlgeschlagen");
    assert.equal(blattStatus({ eingeordnet: false, ungelesen: 1, inArbeit: false, gescheitert: false }), "im_korb");
  });

  it("eingeordnet: Abschrift da, läuft, fehlgeschlagen, sonst ohne Abschrift", () => {
    assert.equal(blattStatus({ eingeordnet: true, ungelesen: 0, inArbeit: false, gescheitert: true }), "abschrift_da");
    assert.equal(blattStatus({ eingeordnet: true, ungelesen: 1, inArbeit: true, gescheitert: true }), "abschrift_laeuft");
    assert.equal(blattStatus({ eingeordnet: true, ungelesen: 2, inArbeit: false, gescheitert: true }), "fehlgeschlagen");
    assert.equal(blattStatus({ eingeordnet: true, ungelesen: 2, inArbeit: false, gescheitert: false }), "eingeordnet");
  });

  it("ein Lauf ist gescheitert bei Abbruch, ohne Ergebnis, nicht fertig oder verwaist", () => {
    assert.equal(laufGescheitert(null), false);
    assert.equal(laufGescheitert({ ergebnis: "vorschlag", abbruch: null, fristRestMs: null }), false);
    assert.equal(laufGescheitert({ ergebnis: "nichts", abbruch: null, fristRestMs: null }), true);
    assert.equal(laufGescheitert({ ergebnis: "spaeter", abbruch: null, fristRestMs: null }), true);
    assert.equal(laufGescheitert({ ergebnis: "pause", abbruch: null, fristRestMs: null }), false);
    assert.equal(laufGescheitert({ ergebnis: "vorschlag", abbruch: "frist", fristRestMs: null }), true);
    assert.equal(laufGescheitert({ ergebnis: "laeuft", abbruch: null, fristRestMs: 60_000 }), false);
    assert.equal(laufGescheitert({ ergebnis: "laeuft", abbruch: null, fristRestMs: -1 }), true);
  });

  it("Endstände fragen nicht mehr nach", () => {
    assert.equal(blattFertig("einordnen"), false);
    assert.equal(blattFertig("abschrift_laeuft"), false);
    assert.equal(blattFertig("hochladen"), false);
    assert.equal(blattFertig("abschrift_da"), true);
    assert.equal(blattFertig("fehlgeschlagen"), true);
    assert.equal(blattFertig("im_korb"), true);
  });
});

describe("Zeilen der Blattliste (Prototyp statusTexts)", () => {
  const b = { fach: { id: "g", name: "Geschichte" }, titel: "Arbeiterbewegung", thema: "Industrialisierung in Deutschland" };
  it("wörtlich wie im Prototyp", () => {
    assert.deepEqual(statusTexts({ ...b, status: "einordnen" }), ["Wird eingeordnet …", "", ""]);
    assert.deepEqual(statusTexts({ ...b, status: "hochladen" }), ["Wird hochgeladen", "", ""]);
    assert.deepEqual(statusTexts({ ...b, status: "haengt" }), ["Hängt, wird erneut versucht", "", ""]);
    assert.deepEqual(statusTexts({ ...b, status: "im_korb" }), ["Liegt im Eingangskorb", "", ""]);
    assert.deepEqual(statusTexts({ ...b, status: "abschrift_laeuft" }), [
      "Geschichte",
      "Industrialisierung in Deutschland",
      "Arbeiterbewegung · Abschrift folgt",
    ]);
    assert.deepEqual(statusTexts({ ...b, status: "abschrift_da" })[2], "Arbeiterbewegung · Abschrift da");
    assert.deepEqual(statusTexts({ ...b, status: "fehlgeschlagen" })[2], "Arbeiterbewegung · Abschrift fehlgeschlagen");
  });
  it("der Titel fällt weg, wenn das Thema mit ihm beginnt", () => {
    assert.equal(
      statusTexts({ fach: { id: "b", name: "Biologie" }, titel: "Zellatmung", thema: "Zellatmung", status: "abschrift_da" })[2],
      "Abschrift da",
    );
  });
  it("ohne Fach steht „Ohne Fach“", () => {
    assert.equal(statusTexts({ fach: null, titel: "Blatt vom 12.10.", thema: "", status: "fehlgeschlagen" })[0], "Ohne Fach");
  });
});

describe("App-Tag in Berliner Zeit", () => {
  it("beginnt um 04:00 Berliner Zeit (Sommerzeit: 02:00 UTC)", () => {
    const [von, bis] = appTagGrenzen("2026-10-12");
    assert.equal(von.toISOString(), "2026-10-12T02:00:00.000Z");
    assert.equal(bis.toISOString(), "2026-10-13T02:00:00.000Z");
  });
  it("über die Zeitumstellung am 25.10.2026", () => {
    const [von, bis] = appTagGrenzen("2026-10-25");
    assert.equal(von.toISOString(), "2026-10-25T03:00:00.000Z");
    assert.equal(bis.toISOString(), "2026-10-26T03:00:00.000Z");
  });
  it("Schulschluss 13:10 im Winter ist 12:10 UTC", () => {
    assert.equal(berlinZeitpunkt("2026-12-07", 13, 10).toISOString(), "2026-12-07T12:10:00.000Z");
  });
});
