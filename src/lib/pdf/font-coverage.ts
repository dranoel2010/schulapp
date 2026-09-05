/**
 * Welche Zeichen eine Schriftdatei überhaupt zeichnen kann — aus ihrer
 * cmap-Tabelle gelesen, nicht geraten.
 *
 * **Warum das hier steht und nicht in einer Bibliothek.** pdfkit bringt für
 * das Einbetten `fontkit` mit, und `fontkit` beantwortet die Frage mit
 * `hasGlyphForCodePoint()`. Aber `fontkit` steht nicht in unserer
 * package.json — es ist eine Abhängigkeit einer Abhängigkeit. Aus einem
 * fremden Paket zu importieren, das man nicht selbst angefordert hat, ist
 * dieselbe Zusage, die die README unter assets/schriften/ schon einmal
 * abgelehnt hat: „eine Datei tief in einem fremden Paket ist keine Zusage".
 * Räumt pdfkit seine Abhängigkeiten um, fehlt dem PDF ohne Vorwarnung die
 * Auskunft darüber, welche Zeichen es drucken kann — und der Fehler zeigte
 * sich als leeres Kästchen im Ausdruck, nicht als Absturz beim Bauen.
 *
 * Die cmap ist außerdem kein Geheimnis: sie ist eine Tabelle mit zwei
 * Formaten, und beide stehen unten ausgeschrieben. Das ist weniger Code als
 * die Rechtfertigung, ihn nicht zu schreiben.
 *
 * **Was hier NICHT passiert.** Diese Datei zeichnet nichts, bettet nichts ein
 * und kennt pdfkit nicht. Sie beantwortet genau eine Frage — „kann diese
 * Schrift dieses Zeichen?" — und beantwortet sie für jede TrueType- oder
 * OpenType-Datei gleich. Deshalb lässt sie sich ohne PDF und ohne Datenbank
 * prüfen; der Test daneben tut das gegen die drei Dateien, die wirklich
 * mitgeliefert werden.
 *
 * Gemessen am 5.9.2026: Geist-Regular.ttf und Geist-Variabel.ttf führen je
 * eine Format-4-Tabelle unter (0,3) und (3,1), DejaVuSans.ttf zusätzlich
 * Format 12 unter (0,10) und (3,10). Format 6 kommt bei DejaVu unter (1,0)
 * vor — das ist die alte Macintosh-Tabelle, sie wird hier nie gewählt und
 * deshalb auch nicht gelesen.
 */

/** Ein zusammenhängender Bereich abgedeckter Codepoints, beide Enden dabei. */
type CoverageRange = { from: number; to: number };

/**
 * Was eine Schrift kann — als sortierte, zusammengefasste Bereiche.
 *
 * Bereiche und keine Menge einzelner Codepoints. Für die drei Dateien hier
 * machte das keinen Unterschied (DejaVu deckt gut 5900 Zeichen ab, das wäre
 * eine kleine Menge), aber Format 12 darf Gruppen über den ganzen
 * Unicode-Raum aufspannen: eine Schrift mit einer Gruppe 0x0000–0x10FFFF
 * bliese eine Menge auf 1,1 Millionen Einträge auf, für eine Frage, die eine
 * binäre Suche über eine Handvoll Bereiche in Mikrosekunden beantwortet.
 *
 * `label` reist mit, weil jede Fehlermeldung sagen muss, WELCHE Datei nicht
 * gelesen werden konnte — im Container liegen drei nebeneinander, und „die
 * Schrift fehlt" wäre dort keine Auskunft.
 */
export type FontCoverage = {
  readonly label: string;
  readonly ranges: readonly CoverageRange[];
};

/* sfnt-Kennungen am Dateianfang. */
const SFNT_TRUETYPE = 0x00010000;
const SFNT_TRUE = 0x74727565; // "true" — ältere Apple-Dateien
const SFNT_OTTO = 0x4f54544f; // "OTTO" — OpenType mit CFF-Umrissen
const SFNT_TTCF = 0x74746366; // "ttcf" — eine Sammlung mehrerer Schriften

const TAG_CMAP = 0x636d6170; // "cmap"

/**
 * Eine Notbremse gegen kaputte Dateien.
 *
 * Format 4 zählt Segmente über 16 Bit, jedes Segment darf bis zu 65536
 * Codepoints umfassen. In einer gültigen Datei überlappen sich Segmente
 * nicht — zusammen decken sie höchstens 65536 Codepoints ab, und die Schleife
 * unten läuft entsprechend oft. In einer beschädigten Datei können sie
 * einander überlappen, und dann wären 32767 Segmente mal 65536 Schritte gut
 * zwei Milliarden Durchläufe: der Server hinge, ohne abzustürzen, und niemand
 * wüsste warum. Zweihunderttausend ist das Dreifache dessen, was überhaupt
 * gültig sein kann.
 */
const MAX_STEPS = 200_000;

/**
 * Liest die cmap einer Schriftdatei.
 *
 * Wirft bei allem, was keine lesbare Schrift ist — und zwar mit dem Namen der
 * Datei im Text. Der Grund steht an `FontCoverage.label`: im Laufzeit-Bild
 * liegen drei Schriften nebeneinander, und die Meldung „Schrift kaputt" hilft
 * dort niemandem weiter.
 *
 * Kein stiller Rückfall auf „deckt nichts ab". Der wäre bequem und wäre der
 * schlimmste Ausgang: das PDF entstünde, jedes Zeichen fiele auf das
 * Auffangnetz zurück, und niemandem fiele auf, dass die halbe Gestaltung weg
 * ist. Lieber gar kein PDF und eine Meldung, die die Datei nennt.
 */
export function readFontCoverage(bytes: Uint8Array, label: string): FontCoverage {
  try {
    return { label, ranges: parse(bytes) };
  } catch (error) {
    const grund = error instanceof Error ? error.message : String(error);

    throw new Error(`Die Schrift ${label} lässt sich nicht lesen: ${grund}`);
  }
}

/**
 * Kann die Schrift dieses Zeichen zeichnen?
 *
 * Binäre Suche über die Bereiche. Wird für jedes Zeichen jeder Abschrift
 * aufgerufen — bei fünfzig Blättern mit je ein paar tausend Zeichen sind das
 * Hunderttausende Aufrufe, und eine lineare Suche über die 250 Bereiche von
 * DejaVu wäre dann zwar immer noch schnell genug, aber ohne Not.
 */
export function covers(coverage: FontCoverage, codePoint: number): boolean {
  const ranges = coverage.ranges;

  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (!range) break;

    if (codePoint < range.from) {
      high = middle - 1;
    } else if (codePoint > range.to) {
      low = middle + 1;
    } else {
      return true;
    }
  }

  return false;
}

/* -------------------------------------------------------------------------
   Das Lesen selbst
   ------------------------------------------------------------------------- */

function parse(bytes: Uint8Array): CoverageRange[] {
  if (bytes.byteLength < 12) {
    throw new Error("die Datei ist zu kurz für einen Tabellenkopf");
  }

  // Der DataView beginnt genau dort, wo die Datei beginnt — alle Offsets in
  // einer sfnt-Datei zählen vom Dateianfang, also passen sie ohne Umrechnung.
  // `byteOffset` und `byteLength` stehen ausdrücklich dabei: ein Uint8Array
  // kann ein Ausschnitt eines größeren Puffers sein, und ohne die beiden läse
  // der View am falschen Fleck.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const version = view.getUint32(0);

  if (version === SFNT_TTCF) {
    throw new Error(
      "es ist eine Schriftsammlung (ttcf); erwartet wird eine einzelne Schrift",
    );
  }

  if (
    version !== SFNT_TRUETYPE &&
    version !== SFNT_TRUE &&
    version !== SFNT_OTTO
  ) {
    throw new Error("kein TrueType und kein OpenType");
  }

  const tableCount = view.getUint16(4);
  let cmapAt = -1;

  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16;
    if (view.getUint32(record) === TAG_CMAP) {
      cmapAt = view.getUint32(record + 8);
      break;
    }
  }

  if (cmapAt < 0) {
    throw new Error("es gibt keine cmap-Tabelle");
  }

  return readCmap(view, cmapAt);
}

/**
 * Sucht sich unter den Untertabellen der cmap die beste aus.
 *
 * Die Reihenfolge ist die übliche: Format 12 kann den ganzen Unicode-Raum,
 * Format 4 nur die Grundebene (bis U+FFFF). Wo beides vorliegt — bei DejaVu
 * ist das so —, gewinnt Format 12, sonst fehlten alle Zeichen jenseits von
 * U+FFFF. Innerhalb desselben Formats hat die Windows-Kennung (3) Vorrang vor
 * der reinen Unicode-Kennung (0); das ist keine inhaltliche Entscheidung,
 * sondern die Reihenfolge, die jede Schriftbibliothek nimmt, und beide
 * Tabellen sagen in der Praxis dasselbe.
 *
 * Alles andere — Format 0, 2, 6, 13, 14 — wird übergangen. Format 6 liegt bei
 * DejaVu unter (1,0) und trägt nur die alte Macintosh-Zeichenordnung; sie zu
 * lesen brächte nichts, was die anderen Tabellen nicht besser hätten.
 */
function readCmap(view: DataView, cmapAt: number): CoverageRange[] {
  const subtableCount = view.getUint16(cmapAt + 2);

  let bestAt = -1;
  let bestScore = 0;
  let bestFormat = 0;

  for (let i = 0; i < subtableCount; i++) {
    const record = cmapAt + 4 + i * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const at = cmapAt + view.getUint32(record + 4);

    if (at + 4 > view.byteLength) continue;

    const format = view.getUint16(at);
    const score = rank(format, platform, encoding);

    if (score > bestScore) {
      bestScore = score;
      bestAt = at;
      bestFormat = format;
    }
  }

  if (bestAt < 0) {
    throw new Error(
      "die cmap trägt keine Untertabelle in Format 4 oder 12 — nur damit lässt sich sagen, welche Zeichen die Schrift kann",
    );
  }

  return bestFormat === 12
    ? merge(readFormat12(view, bestAt))
    : merge(readFormat4(view, bestAt));
}

function rank(format: number, platform: number, encoding: number): number {
  if (format === 12) {
    if (platform === 3 && encoding === 10) return 4;
    if (platform === 0) return 3;
    return 0;
  }

  if (format === 4) {
    if (platform === 3 && encoding === 1) return 2;
    if (platform === 0) return 1;
  }

  return 0;
}

/**
 * Format 4 — die Tabelle für die Grundebene, in Segmenten.
 *
 * Der Aufbau ist alt und eigenwillig: hinter dem Kopf stehen vier Felder je
 * Segment hintereinander weg (alle Endcodes, dann ein Füllwort, dann alle
 * Startcodes, dann alle Deltas, dann alle Bereichsverweise), und der
 * Bereichsverweis ist ein Abstand IN BYTES von seiner eigenen Position aus.
 * Genau deshalb wird `rangeOffsetBase + i * 2` unten noch einmal gebraucht:
 * der Verweis zeigt relativ zu sich selbst, nicht relativ zum Tabellenanfang.
 *
 * **Es wird Zeichen für Zeichen geprüft und nicht segmentweise übernommen.**
 * Das ist langsamer und dafür richtig: ein Segment ist kein lückenloser
 * Bereich. Bei `idRangeOffset != 0` steht je Zeichen ein eigener Glyph-Index
 * in der Tabelle dahinter, und der darf 0 sein — 0 heißt „kein Zeichen".
 * Selbst bei `idRangeOffset == 0` kann `(code + delta) % 65536` auf 0 fallen.
 * Wer Segmente pauschal übernähme, behauptete Zeichen, die die Schrift nicht
 * hat, und das Ergebnis wäre wieder ein leeres Kästchen im Ausdruck.
 *
 * Die Kosten sind gedeckelt: in einer gültigen Datei überlappen sich die
 * Segmente nicht, zusammen decken sie höchstens 65536 Codepoints ab.
 */
function readFormat4(view: DataView, at: number): CoverageRange[] {
  const segmentCountTwice = view.getUint16(at + 6);
  const segmentCount = segmentCountTwice >> 1;

  const endBase = at + 14;
  const startBase = endBase + segmentCountTwice + 2; // +2 für das Füllwort
  const deltaBase = startBase + segmentCountTwice;
  const rangeOffsetBase = deltaBase + segmentCountTwice;

  const ranges: CoverageRange[] = [];
  let steps = 0;

  for (let i = 0; i < segmentCount; i++) {
    const end = view.getUint16(endBase + i * 2);
    const start = view.getUint16(startBase + i * 2);

    // Ein verdrehtes Segment ist kaputt; es zu überspringen ist ehrlicher, als
    // rückwärts zu zählen.
    if (start > end) continue;

    const delta = view.getInt16(deltaBase + i * 2);
    const rangeOffset = view.getUint16(rangeOffsetBase + i * 2);

    let runFrom = -1;

    for (let code = start; code <= end; code++) {
      if (++steps > MAX_STEPS) {
        throw new Error("die cmap in Format 4 ist widersprüchlich aufgebaut");
      }

      let glyph: number;

      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const glyphAt = rangeOffsetBase + i * 2 + rangeOffset + (code - start) * 2;
        if (glyphAt + 2 > view.byteLength) break;

        const raw = view.getUint16(glyphAt);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }

      if (glyph !== 0) {
        if (runFrom < 0) runFrom = code;
      } else if (runFrom >= 0) {
        ranges.push({ from: runFrom, to: code - 1 });
        runFrom = -1;
      }
    }

    if (runFrom >= 0) ranges.push({ from: runFrom, to: end });
  }

  return ranges;
}

/**
 * Format 12 — Gruppen über den ganzen Unicode-Raum.
 *
 * Deutlich einfacher als Format 4: je Gruppe ein Anfang, ein Ende und der
 * Glyph, bei dem die Gruppe beginnt. Lücken innerhalb einer Gruppe gibt es
 * nicht, das Format kennt sie nicht.
 *
 * `startGlyphID === 0` wäre eine Gruppe, die beim „kein Zeichen"-Glyph
 * anfängt. In einer gültigen Datei kommt das nicht vor; käme es vor, wäre nur
 * das erste Zeichen der Gruppe betroffen, und deshalb steht hier keine
 * Sonderbehandlung dafür — sie kostete eine Verzweigung für einen Fall, den
 * niemand je sieht, und der Schaden wäre ein einziges Kästchen.
 */
function readFormat12(view: DataView, at: number): CoverageRange[] {
  const groupCount = view.getUint32(at + 12);

  if (at + 16 + groupCount * 12 > view.byteLength) {
    throw new Error("die cmap in Format 12 nennt mehr Gruppen, als die Datei trägt");
  }

  const ranges: CoverageRange[] = [];

  for (let i = 0; i < groupCount; i++) {
    const group = at + 16 + i * 12;
    const from = view.getUint32(group);
    const to = view.getUint32(group + 4);

    if (from > to) continue;

    ranges.push({ from, to });
  }

  return ranges;
}

/**
 * Sortiert die Bereiche und zieht zusammen, was aneinanderstößt.
 *
 * Nötig, weil die binäre Suche in `covers()` eine sortierte, überschneidungs-
 * freie Liste voraussetzt — und weil Format 4 Segmente in aufsteigender
 * Reihenfolge führt, aber ein Segment durch die Lücken oben in mehrere
 * Bereiche zerfallen kann.
 */
function merge(ranges: CoverageRange[]): CoverageRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: CoverageRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];

    // `+ 1`, damit 0x20–0x7E und 0x7F–0x80 zu einem Bereich werden statt zu
    // zweien: sie stoßen aneinander, auch wenn sie sich nicht überschneiden.
    if (last && range.from <= last.to + 1) {
      if (range.to > last.to) last.to = range.to;
      continue;
    }

    merged.push({ from: range.from, to: range.to });
  }

  return merged;
}
