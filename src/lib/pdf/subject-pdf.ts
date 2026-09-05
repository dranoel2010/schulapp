import { todayInBerlin } from "@/lib/dates";
import {
  listMaterialsWithTranscripts,
  readPageImage,
  type MaterialTranscriptExport,
  type TranscriptCursor,
} from "@/lib/materials";
import { getSubject } from "@/lib/subjects";

import { pdfFileName } from "./filename";
import {
  buildSubjectPdf,
  type LoadPageImage,
  type PdfSheetEntry,
} from "./subject-document";

/**
 * Das Fach-PDF, von der Datenbank bis zu den Bytes.
 *
 * Die eine Tür zwischen dem Route Handler und dem Dokument. Der Handler holt
 * hier ein Ergebnis oder ein `null` und baut daraus eine Antwort; alles, was
 * gerechnet und geholt wird, steht hier oder in ./subject-document.
 *
 * ── Die Menge ───────────────────────────────────────────────────────────────
 *
 * Ein Fach kann mehr Blätter haben, als in ein PDF gehören, und ein Blatt bis
 * zu `MAX_PAGES` Seiten mit je bis zu `MAX_PAGE_BYTES`. Ohne eigene Grenzen
 * wären das im schlimmsten Fall 200 × 12 × 3 MB, also gut sieben Gigabyte
 * Bilddaten — in einem Container auf einem NAS, für ein Dokument, das ein
 * Mensch mit einem Knopfdruck auslöst. Die beiden Zahlen unten sind diese
 * Grenzen, und wenn eine greift, steht das IM Dokument.
 */

/**
 * So viele Blätter kommen höchstens in ein PDF.
 *
 * Ein Fach mit acht Wochenstunden bringt es in einem Schuljahr auf achtzig bis
 * hundertzwanzig Blätter; 150 deckt ein volles Jahr mit Luft ab. Als Vielfaches
 * von `TRANSCRIPT_EXPORT_LIMIT` (50) sind es genau drei Runden über den Cursor,
 * es bleibt also keine halbe Runde übrig.
 *
 * Die Zahl deckelt zugleich, wie viel Text auf einmal im Speicher liegt: 150
 * Blätter mal zwölf Seiten mal `MATERIAL_TRANSCRIPT_MAX` wären im schlimmsten
 * Fall 14,4 Millionen Zeichen. Der wirkliche Fall liegt weit darunter — eine
 * abgeschriebene Seite hat ein paar tausend Zeichen, nicht achttausend.
 *
 * Gezählt werden Blätter und nicht Seiten, weil die Gliederung des Dokuments
 * an Blättern hängt: ein halb abgedrucktes Blatt wäre schlimmer als ein
 * fehlendes.
 */
export const PDF_SHEET_LIMIT = 150;

/**
 * So viele Bytes Fotos kommen höchstens in ein PDF.
 *
 * Gerechnet mit der gemessenen Größe eines verkleinerten Vollbildes: 200 bis
 * 300 KB (siehe MAX_EDGE in @/lib/images). 40 MB sind damit rund 140 bis 200
 * Fotos — mehr, als ein Fach in einem Schuljahr zusammenbekommt. Trüge jede
 * Seite die erlaubten 3 MB, wären es dreizehn; auch dann bleibt das Dokument
 * benutzbar, es hat dann eben nur die ersten dreizehn Fotos und alle
 * Abschriften.
 *
 * **Eine Grenze in Bytes und nicht in Fotos.** Eine Anzahl wäre die einfachere
 * Zahl und die falsche: achtzig Fotos sind je nach Blatt 16 MB oder 240 MB,
 * und genau der zweite Fall ist der, gegen den die Grenze da ist.
 *
 * Der Speicherbedarf liegt knapp darüber: geprüft wird VOR dem Holen, ein
 * einzelnes Foto darf die Grenze also noch überschreiten. Zusammen mit dem
 * Dokument, in das die Bytes wandern, sind das gut 45 MB — der eine Punkt, an
 * dem dieses Vorhaben Speicher braucht.
 */
export const PDF_IMAGE_BYTES = 40_000_000;

/** Ein fertiges PDF samt dem Namen, unter dem es gespeichert werden soll. */
export type SubjectPdf = {
  bytes: Uint8Array<ArrayBuffer>;
  fileName: string;
};

/**
 * Erzeugt das PDF eines Fachs.
 *
 * `null` heißt „dieses Fach gibt es für diesen Nutzer nicht" — fremd und nicht
 * vorhanden fallen dabei zusammen, weil `getSubject()` nach `userId` filtert.
 * Die Tür macht daraus in beiden Fällen eine 404; ein 403 verriete, dass es
 * das Fach gibt.
 *
 * Ein Fach OHNE abgeschriebene Blätter gibt trotzdem ein PDF, kein `null`. Das
 * Dokument sagt dann in einem Satz, dass hier noch nichts abgeschrieben ist —
 * und das ist eine Antwort. Eine 404 an dieser Stelle wäre eine Unwahrheit:
 * das Fach gibt es sehr wohl.
 */
export async function renderSubjectPdf(
  userId: string,
  subjectId: string,
): Promise<SubjectPdf | null> {
  const subject = await getSubject(userId, subjectId);
  if (!subject) return null;

  const { sheets, atLimit } = await collectSheets(userId, subjectId);
  const today = todayInBerlin();

  const bytes = await buildSubjectPdf(
    {
      subject: { name: subject.name, color: subject.color },
      sheets: sheets.map(toEntry),
      today,
      cutOff: atLimit,
    },
    // **Das Vollbild und nicht die Lesefassung.** Beide liegen in derselben
    // Zeile, und die Lesefassung wäre mit rund 100 KB die sparsamere Wahl. Sie
    // ist es nicht: ein Foto steht im PDF bis zu 380 Punkt hoch, das sind 13,4
    // Zentimeter, und 1600 Pixel auf 13,4 Zentimeter sind gut 300 dpi —
    // Druckqualität. Die Lesefassung mit 1000 Pixeln käme dort auf 190 dpi. Sie
    // gibt es außerdem aus einem ganz anderen Grund (der Zeichengrenze eines
    // Werkzeugergebnisses, siehe READING_EDGE in @/lib/images); sie hier zu
    // benutzen, hieße zwei Entscheidungen aneinanderzubinden, die nichts
    // miteinander zu tun haben.
    //
    // Die Besitzprüfung steckt in `readPageImage()`: an `material_pages` hängt
    // keine userId, deshalb läuft dort ein Verbund auf `materials` mit
    // `eq(materials.userId, userId)`.
    imageLoader((pageId) => readPageImage(userId, pageId, "voll")),
  );

  return { bytes, fileName: pdfFileName(subject.name, today) };
}

/**
 * Dreht Runden über den Cursor, bis das Fach durch ist oder die Grenze greift.
 *
 * Genau die Schleife, die der Kommentar an `listMaterialsWithTranscripts()`
 * vorzeichnet: kein `offset`, sondern die Stelle, an der die vorige Runde
 * aufgehört hat. Ein `offset` verschöbe alles dahinter um eins, sobald während
 * des Exports ein Blatt hinzukommt — und ein Blatt käme doppelt oder gar nicht
 * heraus, irgendwo mitten im PDF.
 *
 * **`atLimit` heißt „am Anschlag" und nicht „es liegt noch etwas dahinter".**
 * Diese Unterscheidung ist dieselbe, die am Kommentar zu `LIST_LIMIT` steht:
 * eine Abfrage, die so viele Zeilen zurückgibt, wie gefragt wurde, kann nicht
 * wissen, ob dahinter noch etwas kommt. Das ehrlichere Vorgehen wäre, eine
 * weitere Runde nur zum Nachsehen zu drehen — fünfzig Blätter samt Text zu
 * holen und wegzuwerfen, um einen Satz auf Seite 1 genauer zu formulieren. Das
 * ist es nicht wert; stattdessen sagt der Satz im Dokument genau das, was hier
 * bekannt ist: dass die Grenze erreicht wurde und was das letzte Blatt darin
 * ist.
 *
 * `includeUnread` bleibt aus, also die Vorgabe. Ein Blatt, das niemand
 * abgeschrieben hat, hat für ein Dokument aus Text nichts beizusteuern; die
 * Begründung steht ausgeschrieben an der Auswahlschicht und gilt für das Wiki
 * genauso. Der Kopf des PDF schreibt hin, dass es so ist.
 */
async function collectSheets(
  userId: string,
  subjectId: string,
): Promise<{ sheets: MaterialTranscriptExport[]; atLimit: boolean }> {
  const sheets: MaterialTranscriptExport[] = [];
  let cursor: TranscriptCursor | null = null;

  while (sheets.length < PDF_SHEET_LIMIT) {
    const runde = await listMaterialsWithTranscripts(userId, subjectId, {
      after: cursor ?? undefined,
    });

    sheets.push(...runde.sheets);
    cursor = runde.next;

    if (cursor === null) break;
  }

  const atLimit = sheets.length >= PDF_SHEET_LIMIT;

  // Kann nur greifen, wenn `PDF_SHEET_LIMIT` einmal kein Vielfaches der
  // Rundengröße mehr ist. Dann lieber hier abschneiden als das Dokument über
  // seine eigene Grenze wachsen lassen.
  if (sheets.length > PDF_SHEET_LIMIT) sheets.length = PDF_SHEET_LIMIT;

  return { sheets, atLimit };
}

/** Woher ein Foto kommt — in der Tür `readPageImage()`, im Test eine Attrappe. */
export type ReadPageBytes = (
  pageId: string,
) => Promise<{ bytes: Uint8Array } | null>;

/**
 * Holt die Fotos, eines nach dem anderen, bis das Budget aufgebraucht ist.
 *
 * **Der Leser kommt als Argument herein und wird nicht importiert.** Sonst
 * wäre diese Funktion nur mit einer Datenbank zu prüfen — und was hier steht,
 * ist die eine Stelle, an der ein Speicher-Budget verwaltet wird. Genau so
 * etwas will man ohne Datenbank prüfen können: dass nach dem Erreichen der
 * Grenze wirklich nicht mehr geholt wird, dass ein WebP trotzdem zählt, und
 * dass ein verschwundenes Blatt kein Byte kostet.
 *
 * **Geprüft wird VOR dem Holen.** Ein einzelnes Foto darf die Grenze also noch
 * überschreiten — anders ginge es nicht, denn wie groß ein Foto ist, steht
 * nicht in der Zeile, die der Export liest, sondern erst in den Bytes selbst.
 * Der Höchststand liegt damit bei `PDF_IMAGE_BYTES` plus einem Foto, also bei
 * 40 MB plus höchstens `MAX_PAGE_BYTES`.
 *
 * Gezählt wird, was geholt wurde — auch ein Foto, das das Dokument hinterher
 * nicht einbetten kann, weil es ein WebP ist. Das ist richtig so: die Bytes
 * waren im Speicher, und darum geht es bei diesem Budget.
 */
export function imageLoader(
  read: ReadPageBytes,
  budget: number = PDF_IMAGE_BYTES,
): LoadPageImage {
  let spent = 0;

  return async (pageId) => {
    if (spent >= budget) return { kind: "budget" };

    const page = await read(pageId);
    if (!page) return { kind: "gone" };

    spent += page.bytes.byteLength;

    return { kind: "bytes", bytes: page.bytes };
  };
}

/**
 * Aus einem Blatt der Auswahlschicht wird ein Blatt des Dokuments.
 *
 * Fast dieselben Felder, und trotzdem eine Umsetzung: das Dokument soll den
 * Typ der Datenschicht nicht kennen. `MaterialTranscriptExport` trägt das Fach
 * an jedem einzelnen Blatt mit — in einem Fach-PDF ist das an jeder Zeile
 * dieselbe Angabe, und sie steht im Kopf. Und `topics` sind hier Titel und
 * keine Paare aus id und Titel; eine id kann ein PDF nicht drucken.
 */
function toEntry(sheet: MaterialTranscriptExport): PdfSheetEntry {
  return {
    id: sheet.id,
    title: sheet.title,
    capturedOn: sheet.capturedOn,
    note: sheet.note,
    topics: sheet.topics.map((topic) => topic.title),
    pages: sheet.pages.map((page) => ({
      pageId: page.pageId,
      transcript: page.transcript,
    })),
  };
}
