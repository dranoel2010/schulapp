import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blattErgebnis, papierFuer } from "@/lib/arbeitsblatt/auftrag";
import {
  ABSCHRIFT_FRANZOESISCH,
  ABSCHRIFT_MATHE,
  UEBUNG_FRANZOESISCH,
  UEBUNG_MATHE,
} from "@/lib/arbeitsblatt/beispiel";
import type { ArbeitsblattInhalt } from "@/lib/arbeitsblatt/schema";
import { arbeitsblattDateiname, arbeitsblattMasse, blattArt, buildArbeitsblattPdf } from "@/lib/pdf/arbeitsblatt-document";

function inhalt(fach: string, antwort: typeof UEBUNG_MATHE, abschrift: string): ArbeitsblattInhalt {
  const e = blattErgebnis(
    antwort,
    {
      fach,
      thema: "Thema",
      blaetter: [{ materialId: "8f0d3c1e-5b7a-4c2d-9e1f-0a1b2c3d4e5f", titel: "Scheitelpunktform, Übungen", datum: "2026-10-08", seiten: [abschrift] }],
    },
    papierFuer(fach),
  );
  if (e.art !== "fertig") throw new Error("Beispiel ungültig");
  return e.inhalt;
}

/** Zählt die Seitenobjekte im PDF (unkomprimiert lesbar: /Type /Page). */
function seiten(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
}

describe("Arbeitsblatt als PDF (Plan H, ohne Datenbank)", () => {
  it("Mathematik: genau zwei Seiten A4, Schriften eingebettet", async () => {
    const pdf = await buildArbeitsblattPdf({
      fach: "Mathematik",
      thema: "Quadratische Funktionen",
      tag: "2026-10-12",
      inhalt: inhalt("Mathematik", UEBUNG_MATHE, ABSCHRIFT_MATHE),
    });
    const text = pdf.toString("latin1");
    assert.equal(text.slice(0, 5), "%PDF-");
    assert.equal(seiten(pdf), 2);
    assert.ok(/\/MediaBox \[0 0 595\.28 841\.89\]/.test(text));
    for (const name of ["SchibstedGrotesk-450", "SchibstedGrotesk-650", "Newsreader-Italic24", "DejaVuSans"]) {
      assert.ok(text.includes(name), `${name} eingebettet`);
    }
    assert.ok(text.includes("/FontFile2"), "TrueType-Daten eingebettet");
  });

  it("Französisch mit Lücken und Linien: zwei Seiten, kursiv eingebettet", async () => {
    const pdf = await buildArbeitsblattPdf({
      fach: "Französisch",
      thema: "Passé composé mit être",
      tag: "2026-10-12",
      inhalt: inhalt("Französisch", UEBUNG_FRANZOESISCH, ABSCHRIFT_FRANZOESISCH),
    });
    assert.equal(seiten(pdf), 2);
    assert.ok(pdf.toString("latin1").includes("SchibstedGrotesk-Italic450"));
  });

  it("acht lange Aufgaben bleiben auf zwei Seiten", async () => {
    const basis = inhalt("Mathematik", UEBUNG_MATHE, ABSCHRIFT_MATHE);
    const lang = { ...basis, aufgaben: [...basis.aufgaben, basis.aufgaben[5], basis.aufgaben[5]] };
    const pdf = await buildArbeitsblattPdf({ fach: "Mathematik", thema: "Quadratische Funktionen", tag: "2026-10-12", inhalt: lang });
    assert.equal(seiten(pdf), 2);
  });

  it("die Beispiele passen ohne Verkleinern", () => {
    for (const [fach, antwort, abschrift] of [
      ["Mathematik", UEBUNG_MATHE, ABSCHRIFT_MATHE],
      ["Französisch", UEBUNG_FRANZOESISCH, ABSCHRIFT_FRANZOESISCH],
    ] as const) {
      const m = arbeitsblattMasse({ fach, thema: "Thema", tag: "2026-10-12", inhalt: inhalt(fach, antwort, abschrift) });
      assert.equal(m.k, 1, fach);
      assert.ok(m.seite1 <= m.grenze, `${fach}: Seite 1 endet über dem Fuß`);
    }
  });

  // Befund der Abnahme: 8 Aufgaben je 40 mm mit zweizeiliger Frage liefen über die Seite.
  // Geprüft wird jetzt, wo die letzte Aufgabe endet — nicht nur die Seitenzahl.
  for (const [name, papier, platz, fach] of [
    ["acht Aufgaben je 40 mm Kästchen", "kaestchen", 40, "Mathematik"],
    ["acht Aufgaben je 120 mm Kästchen", "kaestchen", 120, "Mathematik"],
    ["acht Aufgaben je 6 Linien", "linien", 6, "Französisch"],
    ["acht Aufgaben je 14 Linien", "linien", 14, "Französisch"],
  ] as const) {
    it(`${name}: die letzte Aufgabe endet über der Fußlinie, mindestens fünf bleiben`, () => {
      const zitat = "Die Symmetrieachse ist die Gerade x = d.";
      const aufgabe = (i: number) => ({
        kurz: `Aufgabe ${i}`,
        q: "Gib die Symmetrieachse von {f(x) = −½(x − 5)² + 4} an. Ist die Parabel nach oben oder nach unten geöffnet, gestreckt oder gestaucht? Begründe deine Antwort mit einem ganzen Satz.",
        teile: ["{f(x) = (x − 4)² + 1}", "{g(x) = −(x + 3)² + 2}", "{h(x) = 2(x − 1)² − 5}"],
        platz,
        zitat,
        l: [{ art: "p" as const, text: "Die Symmetrieachse ist {x = 5}." }],
      });
      const e = blattErgebnis(
        { teil: "Scheitelpunktform und Symmetrie", minuten: 20, grund: "", aufgaben: Array.from({ length: 8 }, (_, i) => aufgabe(i + 1)) },
        {
          fach,
          thema: "Quadratische Funktionen",
          blaetter: [{ materialId: "8f0d3c1e-5b7a-4c2d-9e1f-0a1b2c3d4e5f", titel: "Scheitelpunktform, Übungen", datum: "2026-10-08", seiten: [ABSCHRIFT_MATHE] }],
        },
        papier,
      );
      assert.equal(e.art, "fertig");
      if (e.art !== "fertig") return;
      assert.ok(e.inhalt.aufgaben.length >= 5, `${e.inhalt.aufgaben.length} Aufgaben`);
      assert.equal(e.gekappt, 8 - e.inhalt.aufgaben.length);
      const m = arbeitsblattMasse({ fach, thema: "Quadratische Funktionen", tag: "2026-10-12", inhalt: e.inhalt });
      assert.equal(m.k, 1, "passt ohne Verkleinern");
      assert.ok(m.seite1 <= m.grenze, `Seite 1 endet bei ${(m.seite1 / (72 / 25.4)).toFixed(1)} mm, Fußlinie ${(m.grenze / (72 / 25.4)).toFixed(1)} mm (k ${m.k})`);
    });
  }

  it("Dateiname ohne verbotene Zeichen", () => {
    assert.equal(
      arbeitsblattDateiname({ fach: "Mathe", thema: "a/b: c", tag: "2026-10-12" }),
      "Arbeitsblatt Mathe a-b- c 2026-10-12.pdf",
    );
  });

  it("Probeklausur: Kopf, Titel und Dateiname sagen Probeklausur, sonst Arbeitsblatt", async () => {
    assert.equal(blattArt({}), "Arbeitsblatt");
    assert.equal(blattArt({ probe: false }), "Arbeitsblatt");
    assert.equal(blattArt({ probe: true }), "Probeklausur");
    assert.equal(
      arbeitsblattDateiname({ fach: "Mathematik", thema: "Quadratische Funktionen", tag: "2026-10-15", probe: true }),
      "Probeklausur Mathematik Quadratische Funktionen 2026-10-15.pdf",
    );
    // der Titel im PDF (UTF-16BE im Info-Wörterbuch) nennt die Art
    const daten = { fach: "Mathematik", thema: "Quadratische Funktionen", tag: "2026-10-15", inhalt: inhalt("Mathematik", UEBUNG_MATHE, ABSCHRIFT_MATHE) };
    const enthaelt = (pdf: Buffer, wort: string) => pdf.includes(Buffer.from(wort, "utf16le").swap16());
    assert.ok(enthaelt(await buildArbeitsblattPdf({ ...daten, probe: true }), "Probeklausur"));
    assert.ok(!enthaelt(await buildArbeitsblattPdf(daten), "Probeklausur"));
  });
});
