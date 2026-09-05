/**
 * Wie die Datei heißt, die aus einem Fach-PDF wird.
 *
 * Reine Rechnung über eine Zeichenkette — kein Header, keine `Response`, kein
 * Next. Die Grenze ist dieselbe, die page-image-response.ts für sich zieht:
 * @/lib kennt keinen HTTP-Header. Der `Content-Disposition` wird deshalb neben
 * der Route zusammengesetzt; WIE der Name lautet und was von ihm übrig bleibt,
 * wenn nur ASCII erlaubt ist, steht hier — weil es Fälle sind, die man prüfen
 * können muss, und der Test daneben tut das.
 */

/**
 * Zeichen, die in einem Dateinamen nichts verloren haben.
 *
 * `/` und `\` trennen Verzeichnisse, `:` ist unter Windows der Laufwerks-
 * trenner und war unter alten Macs der Verzeichnistrenner, `* ? " < > |` sind
 * unter Windows verboten.
 *
 * Sie fallen ersatzlos weg statt zu einem Unterstrich zu werden: „Deutsch/
 * Geschichte" soll „DeutschGeschichte" heißen und nicht „Deutsch_Geschichte",
 * denn der Unterstrich behauptete ein Zeichen, das im Fachnamen nie stand.
 *
 * Steuerzeichen stehen ausdrücklich NICHT in dieser Liste, und das ist kein
 * Versehen. Zeilenumbruch, Wagenrücklauf und Tabulator fängt die
 * Leerraum-Zusammenfassung unten ab; alles Übrige kann den Header nicht
 * zerreißen, weil `asciiFileName()` jedes Zeichen außerhalb des druckbaren
 * Bereichs ersetzt und die UTF-8-Fassung in Prozentschreibweise reist. Ein
 * Zeichenbereich mit Steuerzeichen im Quelltext wäre also ein dritter Schutz
 * für etwas, das schon zweifach geschützt ist — und `no-control-regex` würde
 * ihn zu Recht anstreichen.
 */
const FORBIDDEN = /[/\\:*?"<>|]/g;

/** Die Unicode-Trennzeichen, die beim Zerlegen von é oder à übrig bleiben. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Alles außerhalb der druckbaren ASCII-Zeichen. */
const NON_ASCII = /[^ -~]/g;

/**
 * Der Name der Datei: Fach, Datum, Endung.
 *
 * **Warum das Datum mit hineingehört.** Ein Fach-PDF ist eine Momentaufnahme:
 * kommt morgen ein Blatt dazu oder wird eine Abschrift richtiggestellt, ist es
 * ein anderes Dokument mit demselben Fach. Ohne Datum lägen zwei Stände als
 * „Mathematik.pdf" und „Mathematik (1).pdf" im Download-Ordner, und welches
 * das neuere ist, wüsste niemand.
 *
 * **In ISO-Schreibweise und nicht deutsch.** Das ist die eine Stelle im
 * Projekt, an der ein Datum nicht für einen Menschen gesetzt wird, sondern für
 * eine Dateiliste: „2026-09-05" sortiert sich richtig, „5.9.2026" sortiert
 * September vor Mai. Im Dokument selbst steht das Datum deutsch, wie überall.
 *
 * Ein Fach ohne brauchbaren Namen — nur Leerzeichen, nur Schrägstriche —
 * bekommt „Fach". Ein leerer Dateiname wäre für den Browser kein Name, und
 * dann hieße die Datei wieder wie der letzte Teil der Adresse, also „pdf".
 */
export function pdfFileName(subjectName: string, isoDate: string): string {
  const sauber = subjectName
    .replace(FORBIDDEN, "")
    // Mehrere Leerzeichen zu einem, Ränder weg — sonst hieße die Datei
    // „Mathe   2026-09-05.pdf". Fängt zugleich Zeilenumbruch und Tabulator ab.
    .replace(/\s+/g, " ")
    .trim();

  const name = sauber.length > 0 ? sauber : "Fach";

  return `${name} ${isoDate}.pdf`;
}

/**
 * Umlaute und Akzente ersetzt: die Fassung für Betrachter, die nur ASCII
 * verstehen.
 *
 * `Content-Disposition` trägt den Dateinamen zweimal — einmal als `filename=`
 * in reinem ASCII und einmal als `filename*=UTF-8''…` in Prozentschreibweise
 * (RFC 6266). Der zweite gewinnt in jedem Browser dieses Jahrzehnts; der erste
 * ist die Rückfallebene, und er darf nach der Norm nur ASCII enthalten. Ein
 * „Französisch" ohne Behandlung würde dort zu „Franz_sisch" oder schlimmer.
 *
 * **ä→ae und nicht ä→a.** Das ist die deutsche Ersatzschreibweise und der
 * Grund, warum hier eine eigene Tabelle steht statt nur `normalize("NFD")`:
 * die Unicode-Zerlegung macht aus ä ein a mit einem Trennzeichen, und wer das
 * Trennzeichen wegwirft, bekommt „Franzosisch" und „Mathe fur alle". Für
 * Akzente, die im Deutschen keine Ersatzschreibweise haben, ist die Zerlegung
 * dagegen genau richtig: „Café" wird „Cafe".
 *
 * Was danach immer noch außerhalb von ASCII liegt — ein kyrillischer Buchstabe,
 * ein Emoji im Fachnamen — wird zu einem Unterstrich. Hier ist er richtig, wo
 * er bei den verbotenen Zeichen oben falsch war: dort verschwand ein Zeichen,
 * das nie da war; hier steht eines, das da war und sich nicht schreiben lässt.
 */
export function asciiFileName(name: string): string {
  return name
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(NON_ASCII, "_");
}
