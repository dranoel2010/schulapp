import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OCR_RAHMEN, ocrState } from "@/lib/jev";
import { doclingZuAbschrift } from "@/lib/leser/abschrift";
import { REGEL_VERSION } from "@/lib/leser/regel";
import {
  ZWEITER_VERSUCH_MS,
  leserWaehlen,
  nochGesperrt,
  type DoclingAusgang,
  type JevEinstufung,
} from "@/lib/leser/zuteilung";

/**
 * Wer eine Seite liest — die Entscheidung samt aller Rückfälle auf Claude,
 * mit einem nachgemachten Jev und ohne Datenbank. Der Weg durch die
 * Datenbank steht in scripts/probe-leser.mts.
 */

const DRUCK = [
  "## Handout Hafen",
  "",
  Array.from({ length: 80 }, (_, i) =>
    ["Hafen", "Schiff", "Container", "Brücke", "Ladung"][i % 5],
  ).join(" "),
  "",
  "<!-- image -->",
].join("\n");

function ok(markdown: string): DoclingAusgang {
  return { art: "ok", ergebnis: { markdown, seconds: 4.2, status: "success" } };
}

/** Ein Jev zum Nachzählen: wie oft gefragt, und mit welchem Text. */
function jevMit(antwort: number | null | Error, konfiguriert = true) {
  const fragen: string[] = [];
  const jev: JevEinstufung = {
    konfiguriert,
    async frage(state) {
      fragen.push(state);
      if (antwort instanceof Error) throw antwort;
      return antwort;
    },
  };
  return { jev, fragen };
}

describe("leserWaehlen", () => {
  for (const grund of ["aus", "docling-fehlt", "docling-pause"] as const) {
    it(`gibt die Seite Claude, wenn Docling nicht gefragt wurde (${grund})`, async () => {
      const { jev, fragen } = jevMit(0.99);
      const wahl = await leserWaehlen({ art: "nicht-gefragt", grund }, jev);

      assert.equal(wahl.leser, "claude");
      assert.equal(wahl.grund.grund, grund);
      assert.equal(wahl.grund.regel, REGEL_VERSION);
      assert.equal(wahl.grund.woerter, null);
      assert.equal(wahl.abschrift, null);
      assert.equal(wahl.doclingText, null);
      assert.equal(fragen.length, 0, "Jev wird nicht gefragt");
    });
  }

  it("unterscheidet den Ausfall von Docling vom Fehler an einer Seite", async () => {
    const { jev, fragen } = jevMit(0.99);

    const ausfall = await leserWaehlen({ art: "fehler", ausfall: true }, jev);
    assert.equal(ausfall.leser, "claude");
    assert.equal(ausfall.grund.grund, "docling-ausfall");

    const fehler = await leserWaehlen({ art: "fehler", ausfall: false }, jev);
    assert.equal(fehler.leser, "claude");
    assert.equal(fehler.grund.grund, "docling-fehler");

    assert.equal(fragen.length, 0);
  });

  const regelFaelle: [string, DoclingAusgang, string][] = [
    [
      "kein Erfolg",
      { art: "ok", ergebnis: { markdown: DRUCK, seconds: 1, status: "failure" } },
      "nicht-erfolg",
    ],
    ["leer", ok(""), "leer"],
    ["zu wenig Wörter", ok("# Kurz\n\nNur ein paar Wörter hier."), "zu-wenig-woerter"],
    ["Formel", ok(`${DRUCK}\n\nf(x) = x`), "formel"],
  ];

  for (const [name, ausgang, grund] of regelFaelle) {
    it(`fragt Jev nicht, wenn die Regel scheitert (${name})`, async () => {
      const { jev, fragen } = jevMit(0.99);
      const wahl = await leserWaehlen(ausgang, jev);

      assert.equal(wahl.leser, "claude");
      assert.equal(wahl.grund.grund, grund);
      assert.equal(wahl.abschrift, null);
      assert.equal(fragen.length, 0, "der OCR-Text geht an kein Modell");
      if (ausgang.art === "ok") {
        assert.equal(wahl.doclingText, ausgang.ergebnis.markdown, "der Rohtext bleibt");
      }
    });
  }

  it("gibt die Seite Claude, wenn sie zu lang wäre", async () => {
    const lang = Array.from({ length: 1700 }, () => "Container").join(" ");
    assert.ok(lang.length > 8000);
    const { jev, fragen } = jevMit(0.99);

    const wahl = await leserWaehlen(ok(lang), jev);
    assert.equal(wahl.leser, "claude");
    assert.equal(wahl.grund.grund, "zu-lang");
    assert.equal(fragen.length, 0);
  });

  it("gibt die Seite Claude, wenn Jev nicht eingerichtet ist", async () => {
    const { jev, fragen } = jevMit(0.99, false);
    const wahl = await leserWaehlen(ok(DRUCK), jev);

    assert.equal(wahl.leser, "claude");
    assert.equal(wahl.grund.grund, "jev-fehlt");
    assert.equal(fragen.length, 0);
  });

  it("gibt die Seite Claude, wenn Jev wirft oder nichts sagt", async () => {
    const wirft = await leserWaehlen(ok(DRUCK), jevMit(new Error("503")).jev);
    assert.equal(wirft.leser, "claude");
    assert.equal(wirft.grund.grund, "jev-fehler");
    assert.equal(wirft.grund.jev, null);

    const stumm = await leserWaehlen(ok(DRUCK), jevMit(null).jev);
    assert.equal(stumm.leser, "claude");
    assert.equal(stumm.grund.grund, "jev-fehler");
  });

  it("gibt die Seite Claude, wenn Jev knapp unter der Schwelle bleibt", async () => {
    const wahl = await leserWaehlen(ok(DRUCK), jevMit(0.49).jev);

    assert.equal(wahl.leser, "claude");
    assert.equal(wahl.grund.grund, "jev-unsicher");
    assert.equal(wahl.grund.jev, 0.49);
    assert.equal(wahl.abschrift, null);
    assert.equal(wahl.doclingText, DRUCK);
  });

  it("lässt Docling allein lesen ab der Schwelle", async () => {
    const wahl = await leserWaehlen(ok(DRUCK), jevMit(0.5).jev);

    assert.equal(wahl.leser, "docling");
    assert.equal(wahl.abschrift, doclingZuAbschrift(DRUCK));
    assert.equal(wahl.doclingText, DRUCK);
    assert.deepEqual(wahl.grund, {
      regel: REGEL_VERSION,
      grund: "sauber",
      woerter: 82,
      formel: null,
      zeichen: doclingZuAbschrift(DRUCK).length,
      jev: 0.5,
      sekunden: 4.2,
    });
  });

  it("fragt Jev mit genau dem Text der Messung", async () => {
    const { jev, fragen } = jevMit(0.9);
    await leserWaehlen(ok(DRUCK), jev);

    assert.deepEqual(fragen, [ocrState(DRUCK)]);
    assert.ok(fragen[0]?.startsWith(`${OCR_RAHMEN}\n\n`));
    assert.ok(!fragen[0]?.includes("<!--"), "ohne HTML-Kommentare");
  });
});

describe("nochGesperrt", () => {
  // Eine Seite, deren Zuteilung abbrach und die nicht einmal für Claude
  // festgehalten werden konnte, ruht — aber nicht für immer: sonst hinge sie
  // bis zum nächsten Neustart auf „offen“, und der Postbote ließe ihr Blatt
  // liegen. Und nicht gar nicht: sonst liefe jeder read_inbox alle 15 s in
  // denselben Fehler und rechnete Docling von vorn.
  const jetzt = 1_000_000_000;

  it("sperrt nichts, das nie gescheitert ist", () => {
    assert.equal(nochGesperrt(undefined, jetzt), false);
  });

  it("sperrt gleich nach dem Fehlschlag und kurz vor dem Ende der Ruhe", () => {
    assert.equal(nochGesperrt(jetzt, jetzt), true);
    assert.equal(nochGesperrt(jetzt - ZWEITER_VERSUCH_MS + 1, jetzt), true);
  });

  it("gibt die Seite nach zehn Minuten wieder frei", () => {
    assert.equal(ZWEITER_VERSUCH_MS, 10 * 60_000);
    assert.equal(nochGesperrt(jetzt - ZWEITER_VERSUCH_MS, jetzt), false);
  });
});
