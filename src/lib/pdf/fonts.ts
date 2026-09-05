import { readFileSync } from "node:fs";
import { join } from "node:path";

import { covers, readFontCoverage, type FontCoverage } from "./font-coverage";

/**
 * Die Schriften des Fach-PDF: laden, in pdfkit einstellen, Text danach
 * zerlegen.
 *
 * **Geist ist die Schrift, DejaVu ist das Auffangnetz.** Das PDF soll aussehen
 * wie die App, also wird es in Geist gesetzt — derselben Schrift, die auf dem
 * Bildschirm steht. Nur die einzelnen Zeichen, die Geist nicht hat, kommen aus
 * DejaVu. Die Begründung samt Messung steht in assets/schriften/README.md;
 * hier steht, wie es gemacht wird.
 *
 * Gemessen am 5.9.2026 aus der cmap beider Dateien: Geist fehlen ∈ ⊂ α β γ Δ θ
 * σ ✓ ✗ — **und ⟨ ⟩**. Die beiden letzten sind U+27E8 und U+27E9, also genau
 * die Klammern, mit denen der Agent unsichere Stellen markiert (siehe
 * `UNCERTAIN_OPEN` in @/lib/transcripts). Sie kommen in fast jeder Abschrift
 * vor. Das Auffangnetz ist damit kein Sonderfall für Mathematik, sondern die
 * Regel — ohne diese Datei stünde in jedem PDF an jeder unsicheren Stelle ein
 * leeres Kästchen statt einer Klammer. Dieser Fund stand in der ersten Fassung
 * der README noch nicht; sie ist nachgezogen.
 *
 * ── Es gibt keinen fetten Schnitt, und das ist gemessen ──────────────────────
 *
 * assets/schriften/README.md ließ offen, ob pdfkit aus Geist-Variabel.ttf einen
 * fetten Schnitt ziehen kann. Am 5.9.2026 nachgemessen, und die Antwort ist
 * zweigeteilt:
 *
 *  • **Auswählen geht.** Die Datei trägt eine `fvar`-Achse `wght` (100–900) mit
 *    neun benannten Instanzen. `doc.font(datei, "Bold")` stellt sie ein, und
 *    die Maße ändern sich wirklich: „Hamburgefonstiv" wird bei 12pt 101,82
 *    Punkt breit statt 94,25, also gut 8 Prozent mehr.
 *
 *  • **Einbetten geht NICHT.** Beim `doc.end()` scheitert das ganze Dokument
 *    mit „First argument to DataView constructor must be an ArrayBuffer". Der
 *    Weg dorthin: eine Variationsinstanz teilt sich die Umrisse nicht mit der
 *    Grunddatei, fontkit muss sie also neu schreiben (`TTFSubset._addGlyph` →
 *    `TTFGlyphEncoder.encodeSimple`) und ruft dafür `new EncodeStream(zahl)`.
 *    In restructure 3.0.2 — der Fassung, die in diesem Baum unter fontkit 2.0.4
 *    liegt — nimmt dieser Aufbau einen PUFFER entgegen und keine Zahl.
 *    Betroffen sind alle neun Instanzen, auch „Regular"; es liegt an der
 *    Variation als solcher und nicht am fetten Schnitt.
 *
 * Statische Dateien haben das Problem nicht: ihre Umrisse werden beim
 * Ausdünnen unverändert übernommen. Geist-Regular und DejaVu gehen deshalb
 * anstandslos.
 *
 * **Also keine Fettung.** Die Hierarchie im Dokument entsteht über Größe, Farbe
 * und Abstand — was ohnehin näher an der Gestaltung dieser App liegt, die
 * Fettung sparsam einsetzt und Fächer über Farbe unterscheidet. Verworfen wurde
 * dabei auch die naheliegende Notlösung, magere Umrisse mit einer Kontur zu
 * umranden (`stroke` an `doc.text()`): das verdickt Rundungen anders als
 * Geraden und sieht bei 10 Punkt schmierig aus statt kräftig.
 *
 * Geist-Variabel.ttf bleibt trotzdem unter assets/ liegen. Sie kostet 169 KB,
 * und sobald fontkit in diesem Baum eine Fassung weiter ist, ist der fette
 * Schnitt eine Zeile weit entfernt. Der Test daneben schlägt an, sobald es so
 * weit ist.
 */

/** Wo die Dateien liegen — relativ zum Arbeitsverzeichnis des Servers. */
export const FONT_DIR = "assets/schriften";

/**
 * Welche der beiden Schriften gerade gebraucht wird.
 *
 * Zwei und nicht drei: einen fetten Schnitt gibt es nicht, der Grund steht
 * oben.
 */
export type FontRole = "regular" | "fallback";

/** Die beiden Dateien und was sie jeweils können. */
export type PdfFonts = {
  /** Geist, statisch — der ganze Fließtext. */
  readonly regular: Buffer;
  /** DejaVu Sans, das Auffangnetz. */
  readonly fallback: Buffer;
  /** Was Geist kann. */
  readonly geist: FontCoverage;
  /** Was DejaVu kann — genau 5918 Zeichen. */
  readonly dejavu: FontCoverage;
};

/**
 * Einmal geladen, dann behalten.
 *
 * Zusammen wiegen die beiden Dateien knapp 900 KB, und die cmap von DejaVu zu
 * lesen kostet ein paar Millisekunden. Beides bei jedem PDF neu zu tun, wäre
 * reine Verschwendung — der Prozess lebt, die Dateien ändern sich im Betrieb
 * nie.
 *
 * Fällt das Laden fehl, wird NICHTS gemerkt: der nächste Aufruf versucht es
 * wieder. Ein gemerkter Fehler überlebte sonst das Ausbessern eines
 * Container-Bindes und ließe die App bis zum Neustart ohne PDF.
 */
let cached: PdfFonts | null = null;

/**
 * Lädt die Schriftdateien.
 *
 * Gelesen wird aus `process.cwd()`, weil dort im Container die App liegt und
 * das Laufzeit-Bild `assets/` ausdrücklich übernimmt (Dockerfile, Zeile 202).
 * Ein Pfad relativ zu dieser Quelldatei ginge nicht: nach dem Bündeln liegt
 * diese Datei irgendwo unter `.next/server`, und von dort führt kein
 * verlässlicher Weg zurück.
 *
 * Fehlt eine Datei, nennt die Meldung SIE und nicht „eine Schrift". Im
 * Container liegen drei nebeneinander; wer nur liest, dass eine fehlt, muss
 * raten, welche beim Bauen des Bildes verlorenging.
 */
export function loadPdfFonts(): PdfFonts {
  if (cached) return cached;

  const regular = readFont("Geist-Regular.ttf");
  const fallback = readFont("DejaVuSans.ttf");

  cached = {
    regular,
    fallback,
    geist: readFontCoverage(regular, `${FONT_DIR}/Geist-Regular.ttf`),
    dejavu: readFontCoverage(fallback, `${FONT_DIR}/DejaVuSans.ttf`),
  };

  return cached;
}

function readFont(name: string): Buffer {
  const path = join(process.cwd(), FONT_DIR, name);

  try {
    return readFileSync(path);
  } catch (error) {
    const grund = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Die Schriftdatei ${FONT_DIR}/${name} lässt sich nicht öffnen (gesucht unter ${path}): ${grund}`,
    );
  }
}

/* -------------------------------------------------------------------------
   Die Schrift in pdfkit
   ------------------------------------------------------------------------- */

/**
 * Was `selectFont()` braucht — absichtlich nur diese eine Methode.
 *
 * Ein `PDFKit.PDFDocument` täte es auch, aber dann hinge diese Datei am vollen
 * Typ eines Dokuments, obwohl sie nur die Schrift umstellt.
 */
type FontTarget = {
  font(src: Buffer, size?: number): unknown;
};

/**
 * Stellt eine der beiden Schriften ein.
 *
 * pdfkit merkt sich eine einmal geladene Schrift unter ihrem PostScript-Namen
 * und gibt sie beim nächsten Aufruf ohne Umweg zurück. Die 900 KB werden also
 * einmal je Dokument gelesen und nicht bei jedem Wechsel mitten im Satz —
 * und Wechsel gibt es viele, weil jede ⟨spitze Klammer⟩ einer ist.
 */
export function selectFont(
  doc: FontTarget,
  fonts: PdfFonts,
  role: FontRole,
): void {
  doc.font(role === "fallback" ? fonts.fallback : fonts.regular);
}

/* -------------------------------------------------------------------------
   Text zerlegen
   ------------------------------------------------------------------------- */


/**
 * Zeichen ohne sichtbaren Umriss: Leerraum jeder Breite und die Steuerzeichen.
 *
 * ── Warum es diese Frage überhaupt gibt ──────────────────────────────────────
 *
 * Ein Zeilenumbruch steht in KEINER cmap — Schriften bilden Steuerzeichen nicht
 * ab, auch DejaVu nicht. Ohne diese Ausnahme wäre `\n` also ein Zeichen, „das
 * Geist nicht kann", und `splitByFont()` machte daraus ein eigenes Stück im
 * Auffangnetz. Aus „Zeile A\nZeile B" würden drei Stücke, von denen das
 * mittlere nur aus dem Umbruch besteht.
 *
 * Und genau daran ging der Umbruch verloren: pdfkit setzt die Stücke mit
 * `continued: true` aneinander, und ein fortgesetztes Stück, das nur einen
 * Zeilenumbruch enthält, verschwindet in seiner Umbruchrechnung — im PDF stand
 * an der Stelle ein Leerzeichen. Sichtbar wurde es erst am fertigen Dokument:
 * eine abgeschriebene Tafel lief als ein einziger Fließtext durch, statt Zeile
 * für Zeile zu stehen. Vier Zeilen einer Formelsammlung in einem Absatz sind
 * keine Formelsammlung mehr.
 *
 * Für `unprintable()` gilt dasselbe von der anderen Seite: ohne diese Ausnahme
 * meldete jede Abschrift mit einem Zeilenumbruch, es gebe ein Zeichen, das
 * keine der beiden Schriften drucken kann — und das Dokument schriebe unten
 * einen Satz darüber hin, gefolgt von nichts.
 *
 * Ein Leerzeichen ist nicht unsichtbar im selben Sinne — es hat sehr wohl einen
 * Glyphen, und beide Schriften haben ihn —, aber es hat keinen Umriss, und
 * seine Breite unterscheidet sich zwischen Geist und DejaVu kaum. Es hier
 * mitzunehmen spart in jedem deutschen Satz mit einem α ein halbes Dutzend
 * Schriftwechsel.
 */
function isInvisible(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;

  // Steuerzeichen: Zeilenumbruch, Wagenrücklauf, Tabulator und ihresgleichen.
  // Als Vergleich und nicht als Zeichenbereich in einem regulären Ausdruck —
  // dort stünden Steuerzeichen im Quelltext, und `no-control-regex` striche es
  // zu Recht an.
  if (codePoint < 0x20 || codePoint === 0x7f) return true;

  return /\s/u.test(character);
}

/** Ein Stück Text und die Schrift, mit der es gezeichnet werden muss. */
export type FontRun = {
  text: string;
  /** false heißt: Geist kann diese Zeichen nicht, sie kommen aus DejaVu. */
  readonly primary: boolean;
};

/**
 * Zerlegt Text in Stücke, die jeweils ganz in eine Schrift passen.
 *
 * Der übliche Fall ist ein einziges Stück — deutscher Fließtext liegt
 * vollständig in Geist. Erst ein α, ein ✓ oder eine ⟨Klammer⟩ spaltet den Text
 * auf.
 *
 * **Gelaufen wird über Codepoints und nicht über Indizes.** `for…of` auf einer
 * Zeichenkette liefert vollständige Codepoints; eine Schleife über `text[i]`
 * zerschnitte ein Zeichen jenseits von U+FFFF mitten im Ersatzzeichenpaar, und
 * aus einem Zeichen würden zwei kaputte Hälften in womöglich verschiedenen
 * Schriften.
 *
 * Zeichen, die KEINE der beiden Schriften kann, landen im Auffangnetz. Das ist
 * bewusst: dort werden sie zu einem leeren Kästchen, und ein Kästchen an der
 * richtigen Stelle ist ehrlicher als ein stillschweigend eingesetztes
 * Fragezeichen. Welche das waren, sagt `unprintable()` — das Dokument schreibt
 * sie am Ende hin, damit niemand rätselt.
 */
export function splitByFont(text: string, fonts: PdfFonts): FontRun[] {
  const runs: FontRun[] = [];
  let current = "";
  // Der Typ steht ausdrücklich da: unten liest `primary` diesen Wert, und
  // `currentPrimary` bekommt danach `primary` zugewiesen. TypeScript sieht
  // darin einen Kreis und gäbe ohne die Angabe TS7022.
  let currentPrimary: boolean = true;

  for (const character of text) {
    // Unsichtbare Zeichen bleiben im laufenden Stück und lösen KEINEN Wechsel
    // aus. Der Grund steht an `isInvisible()` — kurz: ein Zeilenumbruch steht
    // in keiner cmap, und ein Stück, das nur aus ihm besteht, verschwindet in
    // pdfkits Umbruchrechnung spurlos.
    const primary: boolean = isInvisible(character)
      ? currentPrimary
      : covers(fonts.geist, character.codePointAt(0) ?? 0);

    if (current.length > 0 && primary !== currentPrimary) {
      runs.push({ text: current, primary: currentPrimary });
      current = "";
    }

    currentPrimary = primary;
    current += character;
  }

  if (current.length > 0) {
    runs.push({ text: current, primary: currentPrimary });
  }

  return runs;
}

/**
 * Die Zeichen, die weder Geist noch DejaVu zeichnen kann — jedes einmal, in
 * der Reihenfolge ihres ersten Auftretens.
 *
 * Sie stehen im PDF als leeres Kästchen, und ohne diese Liste wüsste niemand,
 * dass überhaupt etwas fehlt. Auf einem Schulblatt kommt so etwas selten vor
 * (DejaVu deckt Latein, Griechisch, Kyrillisch, Mathematik, Pfeile, Haken und
 * sogar eine Handvoll Emoji ab), aber ein chinesisches Zeichen oder ein
 * neueres Emoji in einer Abschrift ist möglich — und ein Kästchen ohne
 * Erklärung sieht aus wie ein Fehler der App.
 */
export function unprintable(text: string, fonts: PdfFonts): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const character of text) {
    if (isInvisible(character)) continue;

    const codePoint = character.codePointAt(0) ?? 0;

    if (covers(fonts.geist, codePoint) || covers(fonts.dejavu, codePoint)) {
      continue;
    }

    if (seen.has(character)) continue;

    seen.add(character);
    found.push(character);
  }

  return found;
}
