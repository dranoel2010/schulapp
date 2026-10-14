import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blattDruckenText, blattZaehlerText } from "@/lib/arbeitsblatt/tisch-text";
import { probeHilfsmittel, probeMitTaschenrechner } from "@/lib/probe-hilfsmittel";

describe("Hilfsmittel der Probeklausur (Antwort vom 14.10.2026)", () => {
  it("Mathematik und Physik mit Taschenrechner, gleich wie geschrieben", () => {
    for (const fach of ["Mathematik", "Mathe", "mathe", "MATHEMATIK", "Physik", "physik", "Mathe LK", "Physik (Epoche)", " Mathematik "]) {
      assert.equal(probeHilfsmittel(fach), "mit Taschenrechner", fach);
    }
  });

  it("alle anderen Fächer ohne Hilfsmittel, auch ähnliche Namen", () => {
    for (const fach of ["Deutsch", "Geschichte", "Chemie", "Englisch", "Biologie", "Astrophysik", "Mathematiklehrer-Sprechstunde", "", null, undefined]) {
      assert.equal(probeHilfsmittel(fach), "ohne Hilfsmittel", String(fach));
    }
    assert.equal(probeMitTaschenrechner("Geschichte"), false);
  });
});

describe("Tisch beim Lernblock Probeklausur (Antwort vom 14.10.2026)", () => {
  const inhalt = { aufgaben: [1, 2, 3, 4, 5, 6], minuten: 45 };

  it("Zählwort und Knopf sagen Probeklausur", () => {
    assert.equal(blattZaehlerText({ probe: true, inhalt }, null, false), "Probeklausur · 45 Minuten");
    assert.equal(blattZaehlerText({ probe: true, inhalt }, "16:40", true), "Probeklausur · gedruckt um 16:40");
    assert.equal(blattZaehlerText({ probe: true, inhalt: null }, null, false), "Probeklausur");
    assert.equal(blattDruckenText({ probe: true }), "Probeklausur drucken");
  });

  it("ein Arbeitsblatt bleibt ein Arbeitsblatt", () => {
    assert.equal(blattZaehlerText({ probe: false, inhalt: { aufgaben: [1, 2, 3, 4, 5, 6], minuten: 25 } }, null, false), "Arbeitsblatt · 6 Aufgaben, etwa 25 Minuten");
    assert.equal(blattZaehlerText({ probe: false, inhalt }, "16:40", true), "Arbeitsblatt · gedruckt um 16:40");
    assert.equal(blattZaehlerText({ probe: false, inhalt: null }, null, false), "Arbeitsblatt");
    assert.equal(blattDruckenText({ probe: false }), "Arbeitsblatt drucken");
  });
});
