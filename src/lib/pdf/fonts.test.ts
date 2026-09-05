import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import PDFDocument from "pdfkit";

import {
  FONT_DIR,
  loadPdfFonts,
  selectFont,
  splitByFont,
  unprintable,
} from "@/lib/pdf/fonts";

const fonts = loadPdfFonts();

/** Aneinandergehängt muss aus den Stücken wieder genau die Eingabe werden. */
function zusammen(text: string): string {
  return splitByFont(text, fonts)
    .map((run) => run.text)
    .join("");
}

/**
 * Ein Dokument, das ein bisschen Text setzt und dabei die Schrift einbettet;
 * zurück kommt seine Größe.
 *
 * Muss asynchron sein: pdfkit ist ein Strom und schiebt seine Bytes erst nach
 * dem `end()` in den nächsten Durchlauf der Ereignisschleife. Wer gleich nach
 * `end()` nachzählt, zählt null — und ein Test, der auf „größer als null"
 * prüft, schlüge dann an, ohne dass irgendetwas kaputt wäre.
 *
 * Das Einbetten selbst geschieht IN `end()` und wirft dort, wenn es scheitert
 * — die Ausnahme kommt in dieser Funktion an und macht aus dem Versprechen
 * eine Ablehnung.
 */
async function setze(
  waehle: (doc: PDFKit.PDFDocument) => void,
): Promise<number> {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks: Uint8Array[] = [];

  doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));

  const fertig = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  doc.addPage();
  waehle(doc);
  doc.fontSize(12).text("Hallo Welt — Größe α ⟨unsicher⟩ 1234");
  doc.end();

  await fertig;

  return chunks.reduce((summe, chunk) => summe + chunk.byteLength, 0);
}

describe("splitByFont", () => {
  it("lässt deutschen Fließtext in einem Stück", () => {
    // Der übliche Fall, und er soll billig bleiben: eine Abschrift ohne
    // Sonderzeichen darf nicht in fünfzig Stücke zerfallen, von denen jedes
    // einen eigenen `text()`-Aufruf mit eigenem Schriftwechsel kostet.
    const runs = splitByFont(
      "Die Ableitung von f(x) = x² ist 2x. Größe, Maß und Fuß.",
      fonts,
    );

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.primary, true);
  });

  it("schaltet für α auf das Auffangnetz um und wieder zurück", () => {
    // Das Leerzeichen HINTER dem α bleibt im Auffangnetz — Leerraum löst
    // keinen Wechsel aus, er bleibt, wo er steht. Sichtbar ist das nicht (ein
    // Leerzeichen hat keinen Umriss, und die Breiten der beiden Schriften
    // unterscheiden sich dort kaum); gewollt ist es, weil dieselbe Regel den
    // Zeilenumbruch rettet.
    const runs = splitByFont("Winkel α beträgt", fonts);

    assert.deepEqual(
      runs.map((run) => [run.text, run.primary]),
      [
        ["Winkel ", true],
        ["α ", false],
        ["beträgt", true],
      ],
    );
  });

  it("fasst benachbarte Ausweich-Zeichen zu einem Stück zusammen", () => {
    const runs = splitByFont("αβγ", fonts);

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.primary, false);
  });

  it("holt die ⟨spitzen Klammern⟩ aus dem Auffangnetz", () => {
    // Der Fall, für den es das Auffangnetz überhaupt braucht: Geist kann
    // U+27E8 und U+27E9 nicht, und die stehen in fast jeder Abschrift.
    const runs = splitByFont("steht ⟨vielleicht⟩ da", fonts);

    assert.deepEqual(
      runs.map((run) => [run.text, run.primary]),
      [
        ["steht ", true],
        ["⟨", false],
        ["vielleicht", true],
        ["⟩ ", false],
        ["da", true],
      ],
    );
  });

  it("zerschneidet kein Zeichen jenseits von U+FFFF", () => {
    // 𝄞 ist in JavaScript zwei Einheiten lang. Eine Schleife über `text[i]`
    // machte daraus zwei halbe Zeichen, womöglich in zwei verschiedenen
    // Schriften — und im PDF stünde Unsinn statt eines Kästchens.
    const runs = splitByFont("a𝄞b", fonts);

    assert.deepEqual(
      runs.map((run) => run.text),
      ["a", "𝄞", "b"],
    );
  });

  it("zerteilt an einem Zeilenumbruch NICHT", () => {
    /*
     * Der Fehler, der einmal drinsteckte: ein Zeilenumbruch steht in keiner
     * cmap, galt damit als „Zeichen, das Geist nicht kann" und bekam ein
     * eigenes Stück im Auffangnetz. pdfkit setzt die Stücke mit
     * `continued: true` aneinander — und ein fortgesetztes Stück, das nur aus
     * einem Umbruch besteht, verschwindet dort spurlos. Im PDF stand statt des
     * Umbruchs ein Leerzeichen, und eine abgeschriebene Formelsammlung lief
     * als ein einziger Fließtext durch.
     */
    const runs = splitByFont("Zeile A\nZeile B", fonts);

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.text, "Zeile A\nZeile B");
  });

  it("lässt einen Umbruch in dem Stück, in dem er steht", () => {
    // Der Umbruch hinter dem α bleibt beim α — er löst keinen Wechsel aus, und
    // er erzwingt auch keinen zurück.
    assert.deepEqual(
      splitByFont("α\nA", fonts).map((run) => [run.text, run.primary]),
      [
        ["α\n", false],
        ["A", true],
      ],
    );
  });

  it("verfälscht den Text nicht", () => {
    for (const text of [
      "",
      "α",
      "Ganz gewöhnlich.",
      "f(x) = ∫ ⟨etwas⟩ dx ≈ 3,14 · α² ✓",
      "Zeilen\numbruch\tund Tabulator",
      "😀 mitten im Satz 漢",
    ]) {
      assert.equal(zusammen(text), text, `verfälscht: ${JSON.stringify(text)}`);
    }
  });
});

describe("unprintable", () => {
  it("findet nichts, solange eine der beiden Schriften kann", () => {
    assert.deepEqual(unprintable("αβγ ⟨unsicher⟩ ✓ ≈ Größe", fonts), []);
  });

  it("nennt jedes Zeichen einmal, in der Reihenfolge des Auftretens", () => {
    assert.deepEqual(unprintable("漢 und 中 und noch mal 漢", fonts), ["漢", "中"]);
  });

  it("erfasst auch Zeichen jenseits von U+FFFF", () => {
    assert.deepEqual(unprintable("Note 𝄞 hier", fonts), ["𝄞"]);
  });

  it("meldet Leerraum nicht als undruckbar", () => {
    // Ein Zeilenumbruch steht in keiner cmap. Ohne die Ausnahme meldete jede
    // Abschrift mit mehr als einer Zeile ein undruckbares Zeichen — und das
    // Dokument schriebe unten einen Satz darüber hin, gefolgt von nichts.
    assert.deepEqual(unprintable("A\nB\tC\r\nD E", fonts), []);
  });
});

describe("selectFont", () => {
  it("bettet Geist und DejaVu ein, ohne zu scheitern", async () => {
    assert.ok((await setze((doc) => selectFont(doc, fonts, "regular"))) > 0);
    assert.ok((await setze((doc) => selectFont(doc, fonts, "fallback"))) > 0);
  });

  it("wechselt wirklich die Schrift", () => {
    // Wäre der Wechsel wirkungslos, stünde später an jeder ausgewichenen
    // Stelle ein Kästchen — und zwar unauffällig, weil das PDF trotzdem
    // entstünde.
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.addPage();

    selectFont(doc, fonts, "regular");
    doc.fontSize(12);
    const geist = doc.widthOfString("Hamburgefonstiv");

    selectFont(doc, fonts, "fallback");
    doc.fontSize(12);
    const dejavu = doc.widthOfString("Hamburgefonstiv");

    assert.notEqual(geist, dejavu);

    selectFont(doc, fonts, "regular");
    doc.fontSize(12);
    assert.equal(doc.widthOfString("Hamburgefonstiv"), geist);

    doc.end();
  });

  it("zeichnet α in DejaVu mit einer Breite größer null", () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.addPage();

    selectFont(doc, fonts, "fallback");
    doc.fontSize(12);

    assert.ok(doc.widthOfString("α") > 0);
    doc.end();
  });
});

describe("die variable Geist-Datei", () => {
  const variabel = readFileSync(join(process.cwd(), FONT_DIR, "Geist-Variabel.ttf"));

  it("lässt sich auswählen und ist wirklich fetter", () => {
    // Der eine Teil, der geht: die `fvar`-Achse `wght` mit neun benannten
    // Instanzen. Gemessen am 5.9.2026: 94,25 gegen 101,82 Punkt bei 12pt.
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.addPage();

    selectFont(doc, fonts, "regular");
    doc.fontSize(12);
    const mager = doc.widthOfString("Hamburgefonstiv");

    doc.font(variabel, "Bold").fontSize(12);
    const fett = doc.widthOfString("Hamburgefonstiv");

    assert.ok(fett > mager, `${fett} ist nicht breiter als ${mager}`);
  });

  it("lässt sich NICHT einbetten — deshalb gibt es im PDF keine Fettung", async () => {
    /*
     * Der Grund, warum die Hierarchie im Fach-PDF über Größe, Farbe und
     * Abstand läuft und nicht über das Gewicht.
     *
     * Eine Variationsinstanz teilt ihre Umrisse nicht mit der Grunddatei;
     * fontkit muss sie beim Ausdünnen neu schreiben und ruft dafür
     * `new EncodeStream(zahl)`. In restructure 3.0.2 — der Fassung unter
     * fontkit 2.0.4 in diesem Baum — nimmt dieser Aufbau einen Puffer entgegen
     * und keine Zahl. Das ganze Dokument scheitert dann beim `end()`.
     *
     * **Fällt dieser Test, ist das eine gute Nachricht.** Dann kann fontkit
     * variable Schriften einbetten, und der fette Schnitt ist in ./fonts eine
     * Zeile weit entfernt: ein `bold`-Feld an `PdfFonts`, eine dritte Rolle in
     * `selectFont()` und `doc.font(fonts.bold, "Bold")`. Zu beachten ist dann
     * die zweite Falle, die dabei schon gemessen wurde: pdfkit vergleicht eine
     * neu geladene Schrift über `head.checkSumAdjustment` und die
     * Namenstabelle mit der schon gemerkten desselben PostScript-Namens
     * (`isEqualFont`, pdfkit.js Zeile 3685). Eine variable Datei und ihre
     * Instanzen sind darin gleich — wer Regular UND Bold aus derselben Datei
     * zieht, bekommt zweimal denselben Schnitt, ohne dass etwas scheitert. Das
     * statische Geist-Regular zuerst zu laden löst das, weil zwei Dateien
     * verschiedene Prüfsummen haben.
     */
    await assert.rejects(
      setze((doc) => doc.font(variabel, "Bold")),
      /DataView/,
      "Die variable Schrift lässt sich auf einmal einbetten — siehe den Kommentar hier",
    );
  });

  it("scheitert bei jeder Instanz, nicht nur beim fetten Schnitt", async () => {
    // Auch „Regular" geht nicht. Es liegt also an der Variation als solcher;
    // eine andere Achsenstellung zu wählen wäre kein Ausweg.
    for (const instanz of ["Regular", "SemiBold", "Black"]) {
      await assert.rejects(
        setze((doc) => doc.font(variabel, instanz)),
        /DataView/,
      );
    }
  });
});
