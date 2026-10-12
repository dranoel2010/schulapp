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
import { arbeitsblattDateiname, buildArbeitsblattPdf } from "@/lib/pdf/arbeitsblatt-document";

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

  it("Dateiname ohne verbotene Zeichen", () => {
    assert.equal(
      arbeitsblattDateiname({ fach: "Mathe", thema: "a/b: c", tag: "2026-10-12" }),
      "Arbeitsblatt Mathe a-b- c 2026-10-12.pdf",
    );
  });
});
