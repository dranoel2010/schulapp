import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { covers, readFontCoverage } from "@/lib/pdf/font-coverage";

/**
 * Geprüft wird gegen die drei Dateien, die wirklich mitgeliefert werden.
 *
 * Eine erfundene Schrift wäre der bequemere Prüfstein und der falsche: die
 * Frage, um die es hier geht, lautet nicht „liest der Code eine cmap", sondern
 * „kann Geist das α auf einem Physikblatt". Diese Tests halten damit zugleich
 * die Tabelle in assets/schriften/README.md fest — läge dort etwas anderes als
 * in den Dateien, wäre das Netz aus Schrift und Auffangnetz falsch gespannt,
 * und im Ausdruck stünde ein leeres Kästchen.
 *
 * Die Dateien liegen im Projekt und werden nur gelesen; es braucht keine
 * Datenbank und keinen Server dafür.
 */

const DIR = join(process.cwd(), "assets", "schriften");

function lade(name: string) {
  return readFontCoverage(readFileSync(join(DIR, name)), name);
}

const geist = lade("Geist-Regular.ttf");
const geistVariabel = lade("Geist-Variabel.ttf");
const dejavu = lade("DejaVuSans.ttf");

/** Kann die Schrift jedes einzelne Zeichen dieser Zeichenkette? */
function kannAlle(coverage: ReturnType<typeof lade>, zeichen: string): string[] {
  return [...zeichen].filter(
    (character) => !covers(coverage, character.codePointAt(0) ?? 0),
  );
}

describe("readFontCoverage — was Geist kann", () => {
  it("kann Deutsch samt Anführungszeichen, Halbgeviertstrich und Zeichen", () => {
    assert.deepEqual(kannAlle(geist, "äöüÄÖÜß„“”–—…§€%&"), []);
  });

  it("kann Französisch", () => {
    assert.deepEqual(kannAlle(geist, "àâçéèêîôûÿœ«»"), []);
  });

  it("kann Hoch- und Tiefzahlen, Brüche und Koordinaten", () => {
    assert.deepEqual(kannAlle(geist, "⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉½⅓¼¾⅔°′″"), []);
  });

  it("kann den Teil der Mathematik, der in der README steht", () => {
    assert.deepEqual(kannAlle(geist, "≈≤≥∞π√∑→±×÷≠∫λμΩ"), []);
  });
});

describe("readFontCoverage — was Geist NICHT kann", () => {
  it("hat keine griechischen Kleinbuchstaben und keine Mengenzeichen", () => {
    // Die Liste aus assets/schriften/README.md, Zeichen für Zeichen. Jedes
    // einzelne muss fehlen — stünde hier nur „mindestens eins fehlt", ginge
    // ein stiller Zugewinn durch, ohne dass die README nachzöge.
    for (const zeichen of "∈⊂αβγΔθσ✓✗") {
      assert.equal(
        covers(geist, zeichen.codePointAt(0) ?? 0),
        false,
        `Geist kann „${zeichen}" auf einmal doch — die README stimmt nicht mehr`,
      );
    }
  });

  it("hat die ⟨spitzen Klammern⟩ der unsicheren Stellen nicht", () => {
    // Der wichtigste Fall überhaupt, und in der ersten Fassung der README
    // stand er nicht: U+27E8 und U+27E9 sind die Zeichen, mit denen der Agent
    // markiert, was er nicht sicher lesen konnte. Sie stehen in fast jeder
    // Abschrift. Ohne Auffangnetz stünde dort im Ausdruck ein Kästchen.
    assert.equal(covers(geist, 0x27e8), false);
    assert.equal(covers(geist, 0x27e9), false);
    assert.equal(covers(dejavu, 0x27e8), true);
    assert.equal(covers(dejavu, 0x27e9), true);
  });
});

describe("readFontCoverage — das Auffangnetz", () => {
  it("DejaVu kann alles, was Geist fehlt", () => {
    assert.deepEqual(kannAlle(dejavu, "∈⊂αβγΔθσ✓✗⟨⟩"), []);
  });

  it("DejaVu kann auch alles, was Geist kann", () => {
    assert.deepEqual(
      kannAlle(dejavu, "äöüßàçé⁰₉½°′″≈≤≥∞π√∑→±×÷≠∫λμΩ"),
      [],
    );
  });

  it("kennt seine Grenzen — es gibt Zeichen für keine der beiden", () => {
    // 漢 (U+6F22) steht für alles Chinesische, Japanische und Koreanische:
    // DejaVu hat davon nichts. 𝄞 (U+1D11E) und 🧠 (U+1F9E0) liegen jenseits
    // von U+FFFF und prüfen zugleich, dass Suche und Zerlegung mit Codepoints
    // über der Grundebene umgehen können.
    for (const zeichen of ["漢", "𝄞", "🧠"]) {
      const codePoint = zeichen.codePointAt(0) ?? 0;

      assert.equal(covers(geist, codePoint), false, `Geist kann ${zeichen}`);
      assert.equal(covers(dejavu, codePoint), false, `DejaVu kann ${zeichen}`);
    }
  });

  it("deckt genau die 5918 Zeichen ab, die in der README stehen", () => {
    // Die Zahl stammt aus der Messung am 5.9.2026, die in
    // assets/schriften/README.md steht („Nur DejaVu Sans hat mit 5918 Zeichen
    // wirklich alles"). Sie hier nachzurechnen ist der eine Prüfstein dafür,
    // dass dieser Leser die cmap wirklich vollständig auswertet — ein Fehler
    // im Format 12 oder im Zusammenziehen der Bereiche verschöbe sie sofort.
    const abgedeckt = dejavu.ranges.reduce(
      (summe, bereich) => summe + (bereich.to - bereich.from + 1),
      0,
    );

    assert.equal(abgedeckt, 5918);
  });

  it("liest auch Zeichen jenseits von U+FFFF — DejaVu hat ein paar Emoji", () => {
    // Geist führt nur eine Tabelle in Format 4, die endet bei U+FFFF. DejaVu
    // führt zusätzlich Format 12, und `readCmap()` muss sich dafür
    // entscheiden: täte es das nicht, fehlten hier gut 250 Zeichen, ohne dass
    // irgendetwas scheiterte.
    assert.equal(covers(dejavu, 0x1f600), true); // 😀
  });
});

describe("readFontCoverage — die variable Datei", () => {
  it("deckt dasselbe ab wie die statische, bis auf zwei unsichtbare Zeichen", () => {
    // Darauf beruht, dass `PdfFonts` nur EINE Geist-Deckung führt und sie für
    // beide Schnitte benutzt. Fällt diese Zusage, muss dort eine zweite
    // Deckung her — sonst zeichnete der fette Schnitt Kästchen, wo der
    // magere Zeichen hätte.
    const nurStatisch: number[] = [];
    const nurVariabel: number[] = [];

    for (let codePoint = 0x20; codePoint <= 0xffff; codePoint++) {
      const a = covers(geist, codePoint);
      const b = covers(geistVariabel, codePoint);

      if (a && !b) nurStatisch.push(codePoint);
      if (b && !a) nurVariabel.push(codePoint);
    }

    assert.deepEqual(nurStatisch, []);
    // U+2028 LINE SEPARATOR und U+2029 PARAGRAPH SEPARATOR.
    assert.deepEqual(nurVariabel, [0x2028, 0x2029]);
  });
});

describe("readFontCoverage — die Bereiche selbst", () => {
  it("liefert sortierte, nicht überlappende Bereiche", () => {
    // Die binäre Suche in `covers()` setzt genau das voraus. Wäre die Liste
    // unsortiert, fände sie einzelne Zeichen nicht — und zwar unauffällig,
    // weil die meisten trotzdem gefunden würden.
    for (const coverage of [geist, dejavu]) {
      let vorher = -2;

      for (const bereich of coverage.ranges) {
        assert.ok(
          bereich.from > vorher + 1,
          `${coverage.label}: Bereich ab ${bereich.from} stößt an den vorigen`,
        );
        assert.ok(bereich.to >= bereich.from);
        vorher = bereich.to;
      }
    }
  });

  it("hält das Leerzeichen für abgedeckt und U+0000 nicht", () => {
    assert.equal(covers(geist, 0x20), true);
    assert.equal(covers(geist, 0x00), false);
  });
});

describe("readFontCoverage — kaputte Eingaben", () => {
  it("nennt in der Meldung, WELCHE Datei nicht zu lesen war", () => {
    // Im Laufzeit-Bild liegen drei Schriften nebeneinander. „Schrift kaputt"
    // wäre dort keine Auskunft.
    assert.throws(
      () => readFontCoverage(new Uint8Array([1, 2, 3, 4]), "assets/x/Kaputt.ttf"),
      /assets\/x\/Kaputt\.ttf/,
    );
  });

  it("weist zurück, was gar keine Schrift ist", () => {
    const nichtSchrift = new Uint8Array(64);
    nichtSchrift.set([0x89, 0x50, 0x4e, 0x47]); // ein PNG-Anfang

    assert.throws(
      () => readFontCoverage(nichtSchrift, "Bild.png"),
      /kein TrueType und kein OpenType/,
    );
  });

  it("weist eine Schriftsammlung mit eigener Meldung zurück", () => {
    const sammlung = new Uint8Array(64);
    sammlung.set([0x74, 0x74, 0x63, 0x66]); // "ttcf"

    assert.throws(
      () => readFontCoverage(sammlung, "Sammlung.ttc"),
      /Schriftsammlung/,
    );
  });

  it("gibt niemals still eine leere Deckung zurück", () => {
    // Der schlimmste denkbare Ausgang: das PDF entstünde, jedes Zeichen fiele
    // auf DejaVu zurück, und niemandem fiele auf, dass die Gestaltung weg ist.
    assert.throws(() => readFontCoverage(new Uint8Array(0), "Leer.ttf"));
  });
});
