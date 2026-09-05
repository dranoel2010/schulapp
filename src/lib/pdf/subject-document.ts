import PDFDocument from "pdfkit";

import { subjectColor } from "@/lib/colors";
import { formatGerman } from "@/lib/dates";
import { splitTranscript } from "@/lib/transcripts";

import {
  loadPdfFonts,
  selectFont,
  splitByFont,
  unprintable,
  type PdfFonts,
} from "./fonts";
import { readImageInfo } from "./image-info";

/**
 * Das Fach-PDF: ein Dokument je Fach, gegliedert nach Thema, jedes Blatt mit
 * Foto und Abschrift.
 *
 * ── Was das hier ist und was nicht ───────────────────────────────────────────
 *
 * Eine reine Abbildung des Bestands. Diese Datei rechnet nichts aus, was nicht
 * in der Datenbank steht, ruft kein Modell und weiß nichts, was nicht als
 * Argument hereinkommt. Sie bekommt Blätter und gibt Bytes zurück — deshalb
 * lässt sie sich ohne Datenbank prüfen, und deshalb kann der Test daneben ein
 * echtes PDF erzeugen und nachmessen.
 *
 * Die Daten holt `renderSubjectPdf()` in ./subject-pdf, und zwar aus
 * `listMaterialsWithTranscripts()` — derselben Auswahlschicht, aus der auch die
 * Wiki-Übergabe liest. Stünde in beiden Ausgaben Verschiedenes, wäre das ein
 * Fehler; die eine Quelle ist die einzige Zusage, die das verhindert.
 *
 * ── Die Fotos kommen einzeln, nicht auf einmal ───────────────────────────────
 *
 * `loadImage` ist eine Rückrufstelle und kein Feld in den Daten. Das ist die
 * ganze Speicherrechnung dieses Dokuments: 150 Blätter mit je bis zu 12 Seiten
 * wären bis zu 1800 Vollbilder, und die alle vorher zu laden hieße, sie alle
 * gleichzeitig im Speicher zu halten — im schlimmsten Fall 1800 mal
 * MAX_PAGE_BYTES, also gut fünf Gigabyte in einem Container auf einem NAS. So
 * lebt immer nur ein Foto zwischen zwei Zeichenvorgängen; was bleibt, ist das,
 * was pdfkit schon ins Dokument geschrieben hat, und dafür gibt es das Budget
 * in ./subject-pdf.
 *
 * Der Preis ist, dass das Bauen auf die Datenbank wartet. Das ist in Ordnung:
 * es ist ohnehin ein Vorgang, den ein Mensch mit einem Knopf auslöst und für
 * den er ein paar Sekunden wartet.
 *
 * ── Warum es aussieht, wie es aussieht ───────────────────────────────────────
 *
 * Dieselben Farben und dieselbe Schrift wie die App: die Werte unten stehen so
 * in src/app/globals.css, die Schrift ist Geist wie auf dem Bildschirm. Genommen
 * wird ausdrücklich die HELLE Palette, auch wenn der Nutzer die App dunkel
 * gestellt hat — ein PDF wird auf weißes Papier gedruckt, und ein dunkles Thema
 * hieße dort eine schwarze Seite mit weißer Schrift.
 *
 * **Ohne Fettung.** Es gibt in diesem Dokument nur einen Schnitt, und das ist
 * gemessen und nicht gespart: pdfkit kann die Instanzen der variablen
 * Geist-Datei zwar auswählen, aber nicht einbetten — die ganze Messung steht in
 * ./fonts. Die Hierarchie trägt deshalb dreierlei: die GRÖSSE (26 / 15 / 12,5 /
 * 10,5 / 9 Punkt), die FARBE (Themen stehen als einziger Text in der Farbe des
 * Fachs, Nebensachen in Grau) und der ABSTAND. Das liegt näher an dieser App
 * als eine Fettung es täte — auf dem Bildschirm unterscheidet sie Fächer auch
 * über Farbe und nicht über Gewicht.
 */

/* -------------------------------------------------------------------------
   Was hereinkommt
   ------------------------------------------------------------------------- */

/** Eine Seite eines Blattes, so wie sie im PDF steht. */
export type PdfPageEntry = {
  pageId: string;
  /**
   * Die Abschrift dieser Seite.
   *
   * Die drei Zustände bleiben drei, und genau das macht das Dokument sichtbar:
   * `null` heißt „diese Seite hat noch niemand gelesen", `""` heißt „gelesen,
   * und es stand nichts darauf". Beides steht im PDF als eigener Satz. Sie zu
   * einem „nichts da" zusammenzuziehen, wäre die eine Auskunft weg, für die
   * die Spalte in der Datenbank überhaupt NULL zulässt.
   */
  transcript: string | null;
};

/** Ein Blatt mit seinen Seiten. */
export type PdfSheetEntry = {
  /**
   * Die id des Blattes. Gedruckt wird sie nirgends — sie steht hier, weil ein
   * Blatt eine Identität hat und der Test daneben ohne sie nicht prüfen
   * könnte, dass die Gliederung kein Blatt doppelt hinstellt. Titel sind nicht
   * eindeutig: „Blatt vom 16.3." kann es zweimal geben.
   */
  id: string;
  title: string;
  capturedOn: string;
  note: string | null;
  topics: string[];
  pages: PdfPageEntry[];
};

/** Alles, was das Dokument braucht — und nichts darüber hinaus. */
export type SubjectPdfInput = {
  /**
   * Name und Farbschlüssel des Fachs, wie sie in der Ablage stehen.
   *
   * Ohne das Kürzel, obwohl `MaterialTranscriptExport` es mitbringt. Es gibt
   * hier keine Stelle, die zu eng für den vollen Namen wäre: die Fußzeile hat
   * die halbe Seitenbreite, das sind bei 8 Punkt gut sechzig Zeichen. Und wer
   * einen Stapel Ausdrucke sortiert, liest dort lieber „Geschichte" als „G".
   */
  subject: { name: string; color: string };
  /** Die Blätter, aufsteigend nach Schultag — so, wie die Auswahlschicht sie gibt. */
  sheets: PdfSheetEntry[];
  /** Der Tag, an dem das PDF entsteht; steht im Kopf. */
  today: string;
  /**
   * Die Grenze `PDF_SHEET_LIMIT` wurde erreicht — es kann also sein, dass
   * dahinter noch Blätter liegen. Der Kopf schreibt es hin; verschwiegen wäre
   * das Dokument eine stille Unwahrheit über das Fach.
   */
  cutOff: boolean;
};

/**
 * Ein Foto, oder der Grund, warum keins da ist.
 *
 * Der Grund reist als eigener Wert mit und ist keine Leerstelle. Ein fehlendes
 * Foto ohne Erklärung sähe im Ausdruck aus wie ein Fehler der App; mit
 * Erklärung ist es eine Auskunft.
 */
export type PdfImage =
  | { kind: "bytes"; bytes: Uint8Array }
  /** Das Budget für Fotos war erschöpft — gar nicht erst geholt. */
  | { kind: "budget" }
  /** Die Zeile war weg, als das Foto geholt wurde. */
  | { kind: "gone" };

/** Holt das Vollbild einer Seite — oder sagt, warum es keins gibt. */
export type LoadPageImage = (pageId: string) => Promise<PdfImage>;

/* -------------------------------------------------------------------------
   Maße und Farben
   ------------------------------------------------------------------------- */

/** A4 in Punkt: 595,28 × 841,89. */
const PAGE = { width: 595.28, height: 841.89 };

/** Ränder. Unten mehr, weil dort die Fußzeile mit der Seitenzahl steht. */
const MARGIN = { top: 54, right: 54, bottom: 66, left: 54 };

const LEFT = MARGIN.left;
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const CONTENT_BOTTOM = PAGE.height - MARGIN.bottom;

/**
 * Wie hoch ein Foto höchstens werden darf.
 *
 * Gerechnet für den häufigen Fall: ein hochkant abfotografiertes A4-Blatt
 * kommt mit 1200 × 1600 Pixeln an (MAX_EDGE in @/lib/images ist 1600). Bei
 * 380 Punkt Höhe wird es 285 Punkt breit — gut 10 × 13,4 Zentimeter auf dem
 * Papier, also etwa ein Viertel einer A4-Seite, und mit 1600 Pixeln auf 13,4
 * Zentimeter rund 300 dpi. Groß genug, um das Blatt wiederzuerkennen und eine
 * unsichere Stelle nachzusehen; klein genug, dass Foto und Abschrift zusammen
 * ungefähr eine Seite füllen und nicht drei.
 */
const PHOTO_MAX_HEIGHT = 380;

/**
 * Die helle Palette aus src/app/globals.css, Wert für Wert.
 *
 * Abgeschrieben und nicht importiert, weil dort CSS steht und hier
 * PDF-Anweisungen stehen: die Datei ist keine TypeScript-Quelle, und sie zur
 * Laufzeit auszulesen wäre ein Parser für ein Stylesheet, um fünf Farben zu
 * erfahren. Ändert jemand die Palette, ändert er sie hier mit — der Test
 * daneben kann das nicht merken, dieser Satz muss es tun.
 */
const INK = "#1c1917"; // --foreground
const MUTED = "#6d6762"; // --muted
const SUBTLE = "#857f78"; // --subtle
const LINE = "#e7e4e0"; // --border
const WARNING = "#b45309"; // --warning

/**
 * Schriftgrade — die eine Leiter, über die (mit der Farbe) die Hierarchie
 * läuft, weil es keine Fettung gibt.
 */
const SIZE = {
  subject: 26,
  topic: 15,
  sheet: 12.5,
  body: 10.5,
  meta: 9,
  small: 8.5,
  footer: 8,
};

/* -------------------------------------------------------------------------
   Das Dokument
   ------------------------------------------------------------------------- */

/**
 * Wie lange auf „das Dokument ist fertig" gewartet wird, bevor daraus ein
 * Fehler wird.
 *
 * ── Der Fehler, gegen den das steht ──────────────────────────────────────────
 *
 * Gemessen am 5.9.2026: ein PNG von 63 Bytes mit Alphakanal und sechs Bytes
 * Müll als Bilddaten kam heil durch `readImageInfo()`, `doc.image()` warf
 * NICHT, der Wurf fiel eine Ereignisschleife später aus einem zlib-Rückruf
 * heraus („UNCAUGHT: incorrect header check") — und danach sendete das
 * Dokument weder `end` noch `error`. Wörtlich: „nach 3s -> ended = false".
 * `await fertig` löste damit nie auf, und der Route Handler antwortete auf die
 * Anfrage überhaupt nicht mehr. Eine hängende Anfrage ist schlimmer als ein
 * Fehler: sie hält eine Verbindung, und niemand sieht einen Fehler.
 *
 * Genau dieser Weg ist inzwischen in ./image-info zugemauert. Diese Frist steht
 * trotzdem hier, und sie ist die wichtigere Hälfte der Reparatur: sie deckt die
 * Wege ab, die heute noch niemand kennt. Ein Dokument, das nicht fertig wird,
 * ist ab hier ein 500 und keine Anfrage, die nie zurückkommt.
 *
 * ── Warum eine Minute ────────────────────────────────────────────────────────
 *
 * Nachgemessen mit dem größten Dokument, das im Betrieb überhaupt entstehen
 * kann: 150 Blätter (PDF_SHEET_LIMIT) und ein erschöpftes Bilderbudget von
 * 40 MB, gefüllt mit dem teuersten Format, das pdfkit anfasst — Fotos von
 * 1200 × 1600 mit Alphakanal, die es auspacken und neu packen muss. Das
 * dauerte 2,5 Sekunden. Eine Minute lässt also auch einem viel langsameren
 * Rechner als diesem reichlich Luft und ist trotzdem eine Zeit, nach der
 * niemand mehr auf eine ehrliche Antwort wartet.
 */
const FINISH_DEADLINE_MS = 60_000;

/**
 * Wartet auf ein Versprechen, aber nicht ewig.
 *
 * Exportiert, weil der Test daneben sonst ein hängendes pdfkit bräuchte, um
 * die Frist zu prüfen — und ein Test, der einen Hänger braucht, hängt selbst,
 * wenn die Frist fehlt.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    // `Promise.race` hängt an BEIDE Versprechen einen Behandler. Deshalb wird
    // ein späterer Wurf aus `promise` nicht zur unbehandelten Ablehnung, auch
    // wenn die Frist längst gewonnen hat.
    return await Promise.race([promise, deadline]);
  } finally {
    // Ohne das liefe der Zeitgeber weiter und hielte die Ereignisschleife eine
    // Minute lang offen — im Test heißt das ein Lauf, der nicht endet.
    clearTimeout(timer);
  }
}

/**
 * Baut das PDF und gibt seine Bytes zurück.
 *
 * `Uint8Array<ArrayBuffer>` und nicht `Buffer`, aus demselben Grund wie bei
 * `readPageImage()` in @/lib/materials: `new Response(bytes)` verlangt seit
 * TypeScript 5.7 genau diesen Typ, und ein `Buffer` müsste in der Tür umgetypt
 * werden.
 */
export async function buildSubjectPdf(
  input: SubjectPdfInput,
  loadImage: LoadPageImage,
): Promise<Uint8Array<ArrayBuffer>> {
  const fonts = loadPdfFonts();
  const accent = subjectColor(input.subject.color).hex;

  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margins: MARGIN,
    // Die Fußzeile braucht „Seite 3 von 24", und wie viele es werden, weiß erst
    // die letzte Zeile. Mit `bufferPages` bleiben alle Seiten offen, bis
    // `end()` läuft; danach lässt sich jede noch einmal aufschlagen und
    // beschriften. Ohne das stünde dort „Seite 3" ohne die Gesamtzahl.
    bufferPages: true,
    // Die erste Seite entsteht unten von Hand, damit sie erst kommt, wenn die
    // Schrift eingestellt ist.
    autoFirstPage: false,
    lang: "de-DE",
    // Der Betrachter zeigt dann den Titel in der Fensterleiste statt des
    // Dateinamens.
    displayTitle: true,
    info: {
      Title: `${input.subject.name} — Blätter`,
      Creator: "Schulapp",
      CreationDate: new Date(),
    },
  });

  const chunks: Uint8Array[] = [];
  doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));

  const fertig = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  // Muss vor dem ersten Wort stehen. pdfkit fängt sonst mit Helvetica an —
  // einer der vierzehn Standardschriften, die gar nicht eingebettet werden und
  // deren Zeichenvorrat bei Latin-1 endet. Ein ⟨ oder ein α landete dort
  // wortlos als Kästchen, und zwar bevor das Auffangnetz überhaupt gefragt
  // würde.
  selectFont(doc, fonts, "regular");

  const state: DrawState = {
    doc,
    fonts,
    accent,
    missing: new Map<string, true>(),
    imagesSkippedForBudget: 0,
    imagesSkippedForFormat: 0,
  };

  doc.addPage();

  drawHeader(state, input);

  if (input.sheets.length === 0) {
    drawNotice(
      state,
      "In diesem Fach ist noch nichts abgeschrieben. Sobald ein Blatt eine Abschrift hat, steht es hier.",
    );
  }

  for (const group of groupByTopic(input.sheets)) {
    drawTopicHeading(state, group.title);

    for (const sheet of group.sheets) {
      await drawSheet(state, sheet, loadImage);
    }
  }

  drawClosing(state, input);
  drawFooters(state, input);

  doc.end();
  await withDeadline(
    fertig,
    FINISH_DEADLINE_MS,
    "Das Fach-PDF wurde nicht fertig — vermutlich ist pdfkit an einem Foto hängengeblieben.",
  );

  // Ein eigenes Uint8Array statt `Buffer.concat`: das kopiert genauso oft, und
  // der Typ passt ohne Umweg in eine `Response`.
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let at = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }

  return bytes;
}

/** Was beim Zeichnen mitgeschleppt wird. */
type DrawState = {
  doc: PDFKit.PDFDocument;
  fonts: PdfFonts;
  /** Die Farbe des Fachs, als Hex. */
  accent: string;
  /** Zeichen, die keine der beiden Schriften kann — Reihenfolge des Auftretens. */
  missing: Map<string, true>;
  imagesSkippedForBudget: number;
  imagesSkippedForFormat: number;
};

/* -------------------------------------------------------------------------
   Die Gliederung: Fach → Thema → Blatt
   ------------------------------------------------------------------------- */

type TopicGroup = {
  /** `null` heißt „Ohne Thema". */
  title: string | null;
  sheets: PdfSheetEntry[];
};

/**
 * Gliedert die Blätter nach Thema.
 *
 * **Ein Blatt steht genau einmal im Dokument, unter seinem ERSTEN Thema.** Ein
 * Blatt trägt beliebig viele Themen; es unter jedem einzelnen abzudrucken wäre
 * die naheliegende Lesart von „nach Thema gegliedert" und wäre falsch: bei
 * durchschnittlich zwei Themen je Blatt verdoppelte sich das Dokument samt
 * aller Fotos, und die Frage „habe ich das schon gelesen?" ließe sich beim
 * Durchblättern nicht mehr beantworten. Die übrigen Themen stehen am Blatt
 * selbst, also geht nichts verloren — nur die Wiederholung.
 *
 * Das erste und nicht das alphabetisch kleinste, weil die Reihenfolge der
 * Themen an einem Blatt die ist, in der ein Mensch sie eingetragen hat: das
 * wichtigste zuerst.
 *
 * **Die Gruppen stehen in der Reihenfolge ihres ersten Blattes**, und die
 * Blätter kommen aufsteigend nach Schultag herein. Das Dokument liest sich
 * damit von vorn nach hinten wie das Schuljahr — dafür sortiert
 * `listMaterialsWithTranscripts()` als einzige Liste des Projekts aufsteigend.
 * Alphabetisch wäre die Alternative und wäre eine Themenliste, kein Lernheft.
 *
 * „Ohne Thema" kommt zuletzt: es ist keine Gruppe, sondern der Rest.
 */
export function groupByTopic(sheets: PdfSheetEntry[]): TopicGroup[] {
  const byTitle = new Map<string, PdfSheetEntry[]>();
  const withoutTopic: PdfSheetEntry[] = [];

  for (const sheet of sheets) {
    const first = sheet.topics[0];

    if (first === undefined) {
      withoutTopic.push(sheet);
      continue;
    }

    const list = byTitle.get(first);

    if (list) {
      list.push(sheet);
    } else {
      // Eine Map hält die Einfügereihenfolge — das ist genau die Reihenfolge
      // des ersten Blattes je Thema, ohne dass etwas sortiert werden müsste.
      byTitle.set(first, [sheet]);
    }
  }

  const groups: TopicGroup[] = [...byTitle].map(([title, list]) => ({
    title,
    sheets: list,
  }));

  if (withoutTopic.length > 0) {
    groups.push({ title: null, sheets: withoutTopic });
  }

  return groups;
}

/* -------------------------------------------------------------------------
   Der Kopf
   ------------------------------------------------------------------------- */

function drawHeader(state: DrawState, input: SubjectPdfInput): void {
  const { doc } = state;

  // Der farbige Balken über dem Namen ist dasselbe Zeichen wie die Fächerfarbe
  // in der Ablage: man erkennt das Fach, bevor man den Namen liest.
  doc.roundedRect(LEFT, doc.y, 44, 5, 2.5).fill(state.accent);
  doc.y += 5 + 16;

  drawRich(state, input.subject.name, {
    size: SIZE.subject,
    color: INK,
    // Eine Spur enger, weil eine magere Schrift bei 26 Punkt sonst
    // auseinanderfällt. Ohne Fettung ist die Größe der einzige Träger dieser
    // Zeile, und sie soll als Block wirken.
    characterSpacing: -0.4,
  });

  doc.y += 6;

  drawRich(state, headerLine(input), { size: SIZE.meta, color: MUTED });

  doc.y += 10;
  rule(state, LINE);
  doc.y += 12;

  // Warum ein Blatt fehlen kann, obwohl es das Fach hat — das gehört auf die
  // erste Seite und nicht ans Ende. Wer ein PDF ausdruckt, liest Seite 1.
  drawRich(
    state,
    "Blätter ohne Abschrift stehen nicht in diesem PDF — sie hätten hier nichts zu lesen.",
    { size: SIZE.meta, color: SUBTLE },
  );

  doc.y += 12;

  if (input.cutOff) {
    const letzte = input.sheets[input.sheets.length - 1];

    // Der Wortlaut ist mit Bedacht vorsichtig. Bekannt ist nur, dass die Grenze
    // erreicht wurde — ob dahinter wirklich noch etwas liegt, sagt die Abfrage
    // nicht (die ganze Überlegung steht an `collectSheets()` in ./subject-pdf).
    // „Es fehlen Blätter" wäre deshalb womöglich eine Unwahrheit; „hier kann
    // etwas fehlen" ist es nie.
    drawNotice(
      state,
      letzte
        ? `Dieses PDF fasst höchstens ${input.sheets.length} Blätter, und so viele sind es geworden. Das letzte hier ist vom ${formatGerman(letzte.capturedOn)} — ob danach noch welche kommen, sagt dieses Dokument nicht.`
        : `Dieses PDF fasst höchstens ${input.sheets.length} Blätter, und so viele sind es geworden.`,
    );
  }
}

function headerLine(input: SubjectPdfInput): string {
  const count = input.sheets.length;
  const anzahl = count === 1 ? "1 Blatt" : `${count} Blätter`;

  const erstes = input.sheets[0];
  const letztes = input.sheets[input.sheets.length - 1];

  const erzeugt = `erzeugt am ${formatGerman(input.today)}`;

  if (!erstes || !letztes) return `${anzahl} · ${erzeugt}`;

  const zeitraum =
    erstes.capturedOn === letztes.capturedOn
      ? formatGerman(erstes.capturedOn)
      : `${formatGerman(erstes.capturedOn)} bis ${formatGerman(letztes.capturedOn)}`;

  return `${anzahl} · ${zeitraum} · ${erzeugt}`;
}

/* -------------------------------------------------------------------------
   Thema und Blatt
   ------------------------------------------------------------------------- */

function drawTopicHeading(state: DrawState, title: string | null): void {
  const { doc } = state;

  doc.y += 18;

  // Eine Überschrift, deren erstes Blatt auf der nächsten Seite anfängt, steht
  // allein am Fuß und sieht aus wie ein Versehen. 140 Punkt sind Überschrift
  // plus Blatttitel plus die erste Zeile darunter. Der Abstand oben wird beim
  // Umbruch mit verworfen — deshalb steht er davor und nicht danach.
  ensureSpace(state, 140);

  doc.roundedRect(LEFT, doc.y, 24, 3.5, 1.75).fill(state.accent);
  doc.y += 3.5 + 10;

  drawRich(state, title ?? "Ohne Thema", {
    size: SIZE.topic,
    // Themen sind der einzige Text im Dokument in der Farbe des Fachs. Ohne
    // Fettung ist das der stärkste Unterschied, den es hier gibt — und er
    // knüpft an das an, was die App auf dem Bildschirm tut.
    color: title === null ? MUTED : state.accent,
    characterSpacing: 0.4,
  });

  doc.y += 10;
}

async function drawSheet(
  state: DrawState,
  sheet: PdfSheetEntry,
  loadImage: LoadPageImage,
): Promise<void> {
  const { doc } = state;

  doc.y += 8;

  // Titel plus Datumszeile plus ein Anfang von dem, was folgt.
  ensureSpace(state, 82);

  drawRich(state, sheet.title, {
    size: SIZE.sheet,
    color: INK,
    characterSpacing: 0.15,
  });

  doc.y += 3;

  drawRich(state, sheetMeta(sheet), { size: SIZE.meta, color: MUTED });

  if (sheet.note) {
    doc.y += 4;
    drawRich(state, sheet.note, { size: SIZE.meta, color: SUBTLE });
  }

  doc.y += 10;

  for (const [index, page] of sheet.pages.entries()) {
    if (sheet.pages.length > 1) {
      drawRich(state, `Seite ${index + 1} von ${sheet.pages.length}`, {
        size: SIZE.small,
        color: SUBTLE,
      });
      doc.y += 5;
    }

    await drawPhoto(state, page, loadImage);
    drawTranscript(state, page);

    doc.y += 12;
  }

  doc.y += 4;
  rule(state, LINE);
}

function sheetMeta(sheet: PdfSheetEntry): string {
  const datum = formatGerman(sheet.capturedOn);

  // Das erste Thema steht schon als Überschrift darüber — hier stehen die
  // anderen, damit ein Blatt unter „Kettenregel" trotzdem verrät, dass es auch
  // zu „Ableitung" gehört.
  const weitere = sheet.topics.slice(1);

  return weitere.length > 0 ? `${datum} · auch: ${weitere.join(", ")}` : datum;
}

/* -------------------------------------------------------------------------
   Foto und Abschrift
   ------------------------------------------------------------------------- */

async function drawPhoto(
  state: DrawState,
  page: PdfPageEntry,
  loadImage: LoadPageImage,
): Promise<void> {
  const { doc } = state;
  const image = await loadImage(page.pageId);

  if (image.kind === "budget") {
    state.imagesSkippedForBudget += 1;
    // Knapp, weil dieser Satz ab dem Erschöpfen des Budgets an JEDER weiteren
    // Seite steht — bei fünfzig Blättern fünfzigmal. Was er bedeutet, steht
    // einmal ausführlich im Schlussblock.
    drawAside(state, "Foto weggelassen — die Grenze für Bilddaten ist erreicht.");
    return;
  }

  if (image.kind === "gone") {
    drawAside(state, "Das Foto dieser Seite gibt es nicht mehr.");
    return;
  }

  // Gelesen werden die Bytes und nicht die mime_type-Spalte — die ganze
  // Begründung steht in ./image-info. Kurz: pdfkit kann nur JPEG und PNG,
  // @/lib/images lässt beim Aufnehmen aber auch WebP durch; und ein PNG, das
  // absurde Maße behauptet oder dessen Bilddaten sich nicht auspacken lassen,
  // wird hier ebenfalls ausgesondert, weil pdfkit daran hängenbliebe, statt zu
  // werfen.
  const info = readImageInfo(image.bytes);

  if (!info) {
    state.imagesSkippedForFormat += 1;
    // Ein Satz für alle diese Fälle, weil `readImageInfo()` bewusst nur „geht
    // nicht" sagt und keinen Grund: der Nebensatz soll bei jedem von ihnen
    // wahr sein, und „weder JPEG noch PNG" wäre bei einem kaputten PNG gelogen.
    drawAside(
      state,
      "Foto weggelassen — diese Bilddaten lassen sich in kein PDF einbetten.",
    );
    return;
  }

  // Nie vergrößern: `Math.min(…, 1)`. Ein Foto, das kleiner ankommt als sein
  // Platz, würde sonst hochgerechnet und wäre unscharf statt bloß klein.
  const scale = Math.min(
    CONTENT_WIDTH / info.width,
    PHOTO_MAX_HEIGHT / info.height,
    1,
  );

  const width = info.width * scale;
  const height = info.height * scale;

  // pdfkit bricht Bilder NICHT um: ein `image()`, für das kein Platz mehr ist,
  // wird über den Seitenrand hinaus gezeichnet und ist zur Hälfte weg. Deshalb
  // wird hier von Hand umgebrochen, und deshalb musste die Höhe vorher aus dem
  // Bildkopf gelesen werden.
  ensureSpace(state, height + 10);

  const x = LEFT + (CONTENT_WIDTH - width) / 2;
  const y = doc.y;

  try {
    // `Buffer.from(buffer, offset, length)` legt eine SICHT auf dieselben Bytes
    // an und kopiert nichts — bei 250 KB je Foto und bis zu 40 MB je Dokument
    // wäre eine Kopie sonst der teuerste Handgriff hier.
    //
    // Nötig ist sie nur für den Typ: pdfkit nimmt zur Laufzeit jedes
    // `Uint8Array` entgegen (PDFImage.open, pdfkit.js Zeile 4901), aber
    // @types/pdfkit 0.17.6 kennt an dieser Stelle nur `Buffer`, `ArrayBuffer`
    // und `string`. Ein Umtypen wäre die Alternative und wäre eine Behauptung;
    // eine Buffer-Sicht ist eine, die auch stimmt.
    const bytes = Buffer.from(
      image.bytes.buffer,
      image.bytes.byteOffset,
      image.bytes.byteLength,
    );

    doc.image(bytes, x, y, { width, height });
  } catch {
    // Ein abgeschnittenes oder sonst beschädigtes JPEG kommt durch den
    // Bildkopf und scheitert erst beim Einbetten. Ein einziges solches Foto
    // darf nicht das ganze Fach-PDF kosten — die Abschriften sind der Zweck
    // des Dokuments, das Foto ist die Beigabe.
    //
    // **Dieser Fang gilt nur für das, was pdfkit SYNCHRON wirft**, und das ist
    // bei PNG längst nicht alles: ein PNG mit Alphakanal packt pdfkit über
    // einen zlib-Rückruf aus, der Wurf fällt eine Ereignisschleife später und
    // kommt hier nie an — gemessen am 5.9.2026, samt eines Dokuments, das
    // danach nie fertig wurde. Dagegen steht nicht dieser catch, sondern die
    // Prüfung in ./image-info oben und die Frist an `fertig`.
    state.imagesSkippedForFormat += 1;
    drawAside(state, "Foto weggelassen — es ließ sich nicht einbetten.");
    return;
  }

  // Eine Haarlinie um das Foto: ein abfotografiertes Blatt ist am Rand weiß,
  // und auf weißem Papier verschwände die Kante sonst.
  doc.rect(x, y, width, height).lineWidth(0.5).stroke(LINE);

  doc.y = y + height + 10;
  doc.x = LEFT;
}

function drawTranscript(state: DrawState, page: PdfPageEntry): void {
  if (page.transcript === null) {
    drawAside(state, "Diese Seite hat noch niemand gelesen.");
    return;
  }

  if (page.transcript.length === 0) {
    drawAside(state, "Gelesen — auf dieser Seite stand nichts.");
    return;
  }

  drawRich(state, page.transcript, {
    size: SIZE.body,
    color: INK,
    lineGap: 2.5,
    // Nur hier. Die ⟨spitzen Klammern⟩ markieren, was der Agent nicht sicher
    // lesen konnte; in einem Titel, den ein Mensch getippt hat, bedeuten sie
    // nichts.
    markUncertain: true,
  });
}

/* -------------------------------------------------------------------------
   Der Schluss
   ------------------------------------------------------------------------- */

function drawClosing(state: DrawState, input: SubjectPdfInput): void {
  const { doc } = state;

  const saetze: string[] = [];

  if (state.imagesSkippedForBudget > 0) {
    saetze.push(
      state.imagesSkippedForBudget === 1
        ? "Ein Foto fehlt, weil dieses PDF seine Grenze für Bilddaten erreicht hat."
        : `${state.imagesSkippedForBudget} Fotos fehlen, weil dieses PDF seine Grenze für Bilddaten erreicht hat.`,
    );
  }

  if (state.imagesSkippedForFormat > 0) {
    saetze.push(
      state.imagesSkippedForFormat === 1
        ? "Ein Foto ließ sich nicht einbetten; die Stelle ist im Dokument vermerkt."
        : `${state.imagesSkippedForFormat} Fotos ließen sich nicht einbetten; die Stellen sind im Dokument vermerkt.`,
    );
  }

  if (state.missing.size > 0) {
    // **Als Codepunkt und nicht als Zeichen.** Die Zeichen hier hinzuschreiben
    // wäre der naheliegende Weg und wäre nutzlos: es sind genau die, die keine
    // der beiden Schriften zeichnen kann — im Ausdruck stünden also drei
    // leere Kästchen, und der Satz sagte „hier fehlt etwas, und zwar etwas".
    // „U+6F22" ist druckbar, nachschlagbar und benennt das Zeichen eindeutig.
    //
    // Höchstens zwanzig, damit der Satz nicht selbst zur Tabelle wird.
    const codes = [...state.missing.keys()]
      .slice(0, 20)
      .map((zeichen) => `U+${(zeichen.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`)
      .join(", ");

    saetze.push(
      `Diese Zeichen kann keine der beiden Schriften drucken; sie stehen im Text als leeres Kästchen: ${codes}`,
    );
  }

  if (input.cutOff) {
    saetze.push(
      "Dieses PDF ist an seiner Grenze für Blätter angekommen — der Hinweis dazu steht auf der ersten Seite.",
    );
  }

  if (saetze.length === 0) return;

  doc.y += 20;
  ensureSpace(state, 80);

  drawRich(state, "Was in diesem PDF fehlt", {
    size: SIZE.sheet,
    color: MUTED,
    characterSpacing: 0.15,
  });

  doc.y += 8;

  for (const satz of saetze) {
    drawRich(state, satz, { size: SIZE.meta, color: MUTED });
    doc.y += 6;
  }
}

/**
 * Die Fußzeile auf jeder Seite — Fach links, „Seite 3 von 24" rechts.
 *
 * Läuft erst, wenn alles gezeichnet ist. Vorher ist die Gesamtzahl der Seiten
 * unbekannt, und „Seite 3" ohne das „von 24" ist beim Sortieren eines
 * Ausdrucks keine Hilfe.
 *
 * **`margins.bottom` wird kurz auf 0 gesetzt.** pdfkit legt eine neue Seite an,
 * sobald Text unter den unteren Rand geriete — und die Fußzeile steht genau
 * dort. Ohne diesen Griff hängte jede beschriftete Seite eine leere Seite an,
 * die ihrerseits eine Fußzeile bekäme: das Dokument wüchse, solange die
 * Schleife läuft.
 */
function drawFooters(state: DrawState, input: SubjectPdfInput): void {
  const { doc, fonts } = state;
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    const merken = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = PAGE.height - MARGIN.bottom + 24;

    doc
      .moveTo(LEFT, y - 10)
      .lineTo(LEFT + CONTENT_WIDTH, y - 10)
      .lineWidth(0.5)
      .stroke(LINE);

    selectFont(doc, fonts, "regular");
    doc.fontSize(SIZE.footer).fillColor(SUBTLE);

    doc.text(input.subject.name, LEFT, y, {
      width: CONTENT_WIDTH / 2,
      lineBreak: false,
    });

    doc.text(`Seite ${i + 1} von ${range.count}`, LEFT + CONTENT_WIDTH / 2, y, {
      width: CONTENT_WIDTH / 2,
      align: "right",
      lineBreak: false,
    });

    doc.page.margins.bottom = merken;
  }
}

/* -------------------------------------------------------------------------
   Werkzeug zum Zeichnen
   ------------------------------------------------------------------------- */

/** Bricht die Seite um, wenn das Nächste nicht mehr daraufpasst. */
function ensureSpace(state: DrawState, needed: number): void {
  if (state.doc.y + needed > CONTENT_BOTTOM) {
    state.doc.addPage();
  }
}

/** Eine Haarlinie über die ganze Breite. */
function rule(state: DrawState, color: string): void {
  const { doc } = state;

  doc
    .moveTo(LEFT, doc.y)
    .lineTo(LEFT + CONTENT_WIDTH, doc.y)
    .lineWidth(0.5)
    .stroke(color);

  doc.y += 1;
}

type RichOptions = {
  size: number;
  color: string;
  lineGap?: number;
  /** Laufweite. Trägt zusammen mit Größe und Farbe die Hierarchie. */
  characterSpacing?: number;
  /** Ab wo geschrieben wird; ohne Angabe der linke Rand. */
  x?: number;
  /** Die ⟨spitzen Klammern⟩ farbig hervorheben. Nur die Abschrift will das. */
  markUncertain?: boolean;
};

/**
 * Schreibt Text — und wechselt dabei die Schrift und die Farbe mitten im Satz.
 *
 * Zwei Zerlegungen liegen übereinander:
 *
 *  1. `splitTranscript()` aus @/lib/transcripts trennt die ⟨unsicheren Stellen⟩
 *     vom Rest. Die Klammern BLEIBEN im Text — sie gehören zur Abschrift, und
 *     das Feld auf dem Bildschirm zeigt denselben Wortlaut. Sichtbar gemacht
 *     werden sie über die Farbe: unsicher steht in der Warnfarbe der App, und
 *     zwar samt Klammern, damit man die Stelle im Ausdruck sieht, ohne sie zu
 *     suchen. Die eine Regel für diese beiden Zeichen steht in
 *     @/lib/transcripts und wird hier benutzt, nicht nachgebaut.
 *
 *  2. `splitByFont()` trennt danach, was Geist zeichnen kann, von dem, was ins
 *     Auffangnetz muss. Das ist kein Sonderfall: Geist kann ⟨ und ⟩ selbst
 *     nicht, jede unsichere Stelle wechselt also mindestens zweimal die
 *     Schrift.
 *
 * Zusammengesetzt wird das mit `continued: true`. pdfkit führt den Umbruch
 * dabei über alle Stücke hinweg weiter — ein Wort, das an einer Farbgrenze
 * steht, bricht also richtig um und nicht an der Grenze.
 */
function drawRich(state: DrawState, text: string, options: RichOptions): void {
  const { doc, fonts } = state;

  for (const character of unprintable(text, fonts)) {
    state.missing.set(character, true);
  }

  const x = options.x ?? LEFT;
  const width = CONTENT_WIDTH - (x - LEFT);

  // Die Schrift muss stehen, bevor unten `currentLineHeight()` gefragt wird —
  // sonst misst pdfkit die Zeilenhöhe der zuletzt eingestellten Schrift.
  selectFont(doc, fonts, "regular");
  doc.fontSize(options.size);

  const lineHeight = doc.currentLineHeight(true) + (options.lineGap ?? 0);

  for (const line of toLines(segmentsOf(state, text, options))) {
    // Eine leere Zeile bekommt ihre Höhe von Hand: `doc.text("")` zeichnet
    // nichts und rückt auch nichts vor. In einer abgeschriebenen Tafel trennt
    // die Leerzeile die Blöcke — sie wegzulassen klebte Überschrift und
    // Formel aneinander.
    if (line.length === 0) {
      doc.y += lineHeight;
      continue;
    }

    drawChain(state, line, x, width, options);
  }

  // Nach einer Kette steht `x` am Ende des letzten Wortes. Alles, was danach
  // kommt, finge sonst dort an statt am Rand.
  doc.x = LEFT;
}

/** Ein Stück Text, das am Stück in einer Schrift und einer Farbe steht. */
export type Segment = { text: string; primary: boolean; color: string };

/**
 * Zerlegt den Text zweifach: nach ⟨unsicheren Stellen⟩ und nach Schrift.
 *
 * In DIESER Reihenfolge, und das ist nicht beliebig. Eine unsichere Stelle darf
 * über einen Zeilenumbruch reichen — der Ausdruck in @/lib/transcripts schließt
 * nur die Klammern selbst aus, sonst alles. Wer erst in Zeilen zerlegte und
 * dann nach Klammern suchte, fände eine über zwei Zeilen gehende Markierung
 * nicht mehr und färbte sie nicht ein.
 */
function segmentsOf(
  state: DrawState,
  text: string,
  options: RichOptions,
): Segment[] {
  const parts = options.markUncertain
    ? splitTranscript(text)
    : [{ text, uncertain: false }];

  const segments: Segment[] = [];

  for (const part of parts) {
    for (const run of splitByFont(part.text, state.fonts)) {
      segments.push({
        text: run.text,
        primary: run.primary,
        color: part.uncertain ? WARNING : options.color,
      });
    }
  }

  return segments;
}

/**
 * Schneidet die Stücke an den Zeilenumbrüchen auseinander.
 *
 * ── Warum das sein muss ──────────────────────────────────────────────────────
 *
 * pdfkit setzt die Stücke einer Zeile mit `continued: true` aneinander und
 * merkt sich dabei, wo das fortgesetzte Stück angefangen hat. Ein WEICHER
 * Umbruch — die Zeile ist zu breit geworden — geht danach richtig an den linken
 * Rand zurück. Ein HARTER Umbruch mitten in einem fortgesetzten Stück tut das
 * nicht: die neue Zeile fängt dort an, wo das Stück begann.
 *
 * Sichtbar wurde das an einer abgeschriebenen Formelsammlung. „Potenzregel: …
 * ⟹ …" wechselt beim ⟹ die Schrift, weil Geist das Zeichen nicht hat; das
 * Stück danach beginnt also mitten in der Zeile. Der Zeilenumbruch hinter der
 * Potenzregel setzte die Produktregel daraufhin nicht an den Rand, sondern
 * eingerückt bis zur Mitte der Seite — und zwar nur diese eine, weil nur sie
 * hinter einem Schriftwechsel stand. Ein Ausdruck, in dem die Hälfte der Zeilen
 * treppenförmig einrückt.
 *
 * Deshalb wird hier von Hand in Zeilen zerlegt, und jede Zeile bekommt ihre
 * eigene Kette, die am linken Rand anfängt. Innerhalb einer Zeile bleibt
 * pdfkits Umbruch zuständig — der kann es.
 *
 * Ausgeführt, obwohl es niemand außerhalb dieser Datei aufruft: die Regel
 * „ein harter Umbruch beendet die Kette" ist die ganze Abhilfe für einen
 * Fehler, den man dem fertigen PDF nur ansieht, wenn man es aufschlägt. Der
 * Test daneben hält sie fest.
 */
export function toLines(segments: Segment[]): Segment[][] {
  const lines: Segment[][] = [[]];

  for (const segment of segments) {
    const stuecke = segment.text.split(/\r\n|\r|\n/);

    for (const [index, stueck] of stuecke.entries()) {
      if (index > 0) lines.push([]);
      if (stueck.length === 0) continue;

      lines[lines.length - 1]?.push({ ...segment, text: stueck });
    }
  }

  return lines;
}

/** Setzt eine einzelne Zeile aus ihren Stücken zusammen. */
function drawChain(
  state: DrawState,
  segments: Segment[],
  x: number,
  width: number,
  options: RichOptions,
): void {
  const { doc, fonts } = state;
  const y = doc.y;

  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;

    selectFont(doc, fonts, segment.primary ? "regular" : "fallback");
    doc.fillColor(segment.color);

    // Die Laufweite reist in den Optionen jedes Stücks mit und nicht als
    // Zustand des Dokuments: `characterSpacing` gibt es bei pdfkit nur als
    // Feld an `text()`, nicht als Methode — und bei einer fortgesetzten Kette
    // gelten die Optionen je Aufruf. Stünde sie nur am ersten, liefe der Rest
    // einer Überschrift ohne Spationierung.
    const common = {
      width,
      lineGap: options.lineGap ?? 0,
      characterSpacing: options.characterSpacing ?? 0,
      continued: !last,
    };

    if (index === 0) {
      doc.text(segment.text, x, y, common);
    } else {
      doc.text(segment.text, common);
    }
  }
}

/**
 * Ein Nebensatz mit hellem Balken davor — für alles, was das Dokument über
 * sich selbst sagt.
 *
 * Der Balken wird NACH dem Text gezeichnet, weil erst dann feststeht, wie hoch
 * er sein muss. Läuft der Text auf eine neue Seite über, bleibt er weg: ein
 * Balken, der die alte Seite bis unten und die neue gar nicht begleitet, wäre
 * verwirrender als keiner.
 */
function drawAside(state: DrawState, text: string): void {
  bar(state, text, MUTED, LINE, 2);
}

/** Ein Hinweis, der auffallen soll — Text und Balken in der Warnfarbe. */
function drawNotice(state: DrawState, text: string): void {
  bar(state, text, WARNING, WARNING, 2.5);
}

function bar(
  state: DrawState,
  text: string,
  textColor: string,
  barColor: string,
  barWidth: number,
): void {
  const { doc } = state;

  ensureSpace(state, 48);

  const seiteVorher = doc.bufferedPageRange().count;
  const y = doc.y;

  drawRich(state, text, {
    size: SIZE.meta,
    color: textColor,
    x: LEFT + 10,
    lineGap: 1.5,
  });

  if (doc.bufferedPageRange().count === seiteVorher) {
    doc.rect(LEFT, y, barWidth, doc.y - y).fill(barColor);
  }

  doc.y += 6;
}
