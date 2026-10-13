import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aufgabeAus,
  BLATT_FORM,
  blattAuftrag,
  blattErgebnis,
  papierFuer,
} from "@/lib/arbeitsblatt/auftrag";
import {
  ABSCHRIFT_FRANZOESISCH,
  ABSCHRIFT_MATHE,
  UEBUNG_FRANZOESISCH,
  UEBUNG_MATHE,
} from "@/lib/arbeitsblatt/beispiel";
import type { Quelle } from "@/lib/arbeitsblatt/quelle";
import { inhaltSchema } from "@/lib/arbeitsblatt/schema";
import { antwortFormat } from "@/lib/claude/client";

const QUELLE: Quelle = {
  fach: "Mathematik",
  thema: "Quadratische Funktionen",
  blaetter: [
    {
      materialId: "8f0d3c1e-5b7a-4c2d-9e1f-0a1b2c3d4e5f",
      titel: "Scheitelpunktform, Übungen",
      datum: "2026-10-08",
      seiten: [ABSCHRIFT_MATHE],
    },
  ],
};

describe("Arbeitsblatt: Auftrag und Antwort (Plan H)", () => {
  it("die Form geht als JSON-Schema an die API, ohne Tupel", () => {
    const json = JSON.stringify(antwortFormat(BLATT_FORM));
    assert.ok(!json.includes("prefixItems"));
    assert.ok(json.includes("zitat"));
  });

  it("das Beispiel aus dem Prototyp wird ein gültiges Blatt mit Quelle", () => {
    const e = blattErgebnis(UEBUNG_MATHE, QUELLE, "kaestchen");
    assert.equal(e.art, "fertig");
    if (e.art !== "fertig") return;
    assert.equal(e.inhalt.aufgaben.length, 6);
    assert.equal(e.verworfen, 0);
    assert.deepEqual(
      e.inhalt.quellen.map((q) => [q.datum, q.titel]),
      [["2026-10-08", "Scheitelpunktform, Übungen"]],
    );
    assert.ok(inhaltSchema.safeParse(e.inhalt).success);
    // Umformung: Folgezeile mit leerer linker Seite bleibt erhalten
    const eq = e.inhalt.aufgaben[3].l[0];
    assert.equal(eq[0], "eq");
    assert.deepEqual((eq[1] as [string, string][])[1], ["", "{(x − 3)² − 9 + 11}"]);
  });

  it("Quellbindung: eine erfundene Aufgabe wird verworfen", () => {
    const erfunden = {
      ...UEBUNG_MATHE.aufgaben[0] as object,
      kurz: "Ableitung",
      zitat: "Die Ableitung von x² ist 2x.",
    };
    const e = blattErgebnis(
      { ...UEBUNG_MATHE, aufgaben: [...UEBUNG_MATHE.aufgaben, erfunden] },
      QUELLE,
      "kaestchen",
    );
    assert.equal(e.art, "fertig");
    if (e.art !== "fertig") return;
    assert.equal(e.verworfen, 1);
    assert.ok(!e.inhalt.aufgaben.some((a) => a.kurz === "Ableitung"));
  });

  it("unter fünf gebundenen Aufgaben gibt es kein Blatt", () => {
    const e = blattErgebnis(
      { ...UEBUNG_MATHE, aufgaben: UEBUNG_MATHE.aufgaben.slice(0, 4), grund: "" },
      QUELLE,
      "kaestchen",
    );
    assert.equal(e.art, "zu-wenig");
  });

  it("eine Aufgabe in falscher Form fällt einzeln weg", () => {
    assert.equal(aufgabeAus({ kurz: "x" }), null);
    assert.ok(aufgabeAus(UEBUNG_MATHE.aufgaben[1]));
  });

  it("ein Zitat über einen Zeilenumbruch hinweg ist trotzdem wörtlich", () => {
    const a = aufgabeAus({ ...(UEBUNG_MATHE.aufgaben[2] as object), zitat: "Gerade x = d.\nVerschiebung:" });
    assert.ok(a);
    const e = blattErgebnis(
      { ...UEBUNG_MATHE, aufgaben: [...UEBUNG_MATHE.aufgaben.slice(0, 4), { ...(UEBUNG_MATHE.aufgaben[2] as object), zitat: "Gerade x = d.\n  Verschiebung:" }] },
      QUELLE,
      "kaestchen",
    );
    assert.equal(e.art, "fertig");
  });

  it("Französisch: Linien und kursive Teile", () => {
    const e = blattErgebnis(
      UEBUNG_FRANZOESISCH,
      { ...QUELLE, fach: "Französisch", blaetter: [{ ...QUELLE.blaetter[0], seiten: [ABSCHRIFT_FRANZOESISCH] }] },
      papierFuer("Französisch"),
    );
    assert.equal(e.art, "fertig");
    if (e.art !== "fertig") return;
    assert.equal(e.inhalt.papier, "linien");
    assert.equal(e.inhalt.aufgaben[0].fr, true);
  });

  it("Papier: Kästchen zum Rechnen, Linien für Sprachen", () => {
    assert.equal(papierFuer("Mathematik"), "kaestchen");
    assert.equal(papierFuer("Physik"), "kaestchen");
    assert.equal(papierFuer("Französisch"), "linien");
    assert.equal(papierFuer("Deutsch"), "linien");
  });

  it("falsche Aufgaben vom letzten Blatt stehen im Auftrag", () => {
    const text = blattAuftrag({
      fach: "Mathematik",
      thema: "Quadratische Funktionen",
      papier: "kaestchen",
      zuletztFalsch: [{ kurz: "Ergänzen", q: "Bring x² + 8x + 10 in Scheitelpunktform." }],
    });
    assert.ok(text.includes("Bring x² + 8x + 10 in Scheitelpunktform."));
  });

  it("Probeklausur: Klausurformat über den ganzen Stoff, 45 Minuten; sonst nicht", () => {
    const vorab = { fach: "Geschichte", thema: "Probeklausur", papier: "linien" as const, zuletztFalsch: [] };
    const probe = blattAuftrag({ ...vorab, probe: true });
    assert.ok(probe.includes("Probeklausur, ein oder zwei Tage vor der Klausur"));
    assert.ok(probe.includes("über den ganzen Stoff aller Abschriften"));
    assert.ok(probe.includes("minuten ist 45"));
    assert.ok(!blattAuftrag(vorab).includes("Probeklausur, ein oder zwei Tage"));
  });
});
