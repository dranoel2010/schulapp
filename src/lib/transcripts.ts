import type { NewPageTranscript } from "@/lib/materials";

/**
 * Die Abschrift auf dem Bildschirm: die ⟨spitzen Klammern⟩ finden, die
 * Vorschau kürzen, die Felder des Formulars benennen und wieder auslesen.
 *
 * Reine Rechnung — keine Datenbank, kein React, kein Next. Genau wie
 * @/lib/topics liegt das aus einem einzigen Grund hier und nicht in
 * @/lib/materials: material-form.tsx ist eine Client-Komponente, und ein
 * Import aus einem Modul mit Datenbankzugriff zöge die Datenbank ins
 * Browser-Bundle. `NewPageTranscript` kommt trotzdem von dort, aber als
 * `import type` — ein Typ steht nach dem Übersetzen nirgends mehr und schleppt
 * deshalb auch nichts mit.
 *
 * **Die Grenze steht hier nicht.** Sie heißt `MATERIAL_TRANSCRIPT_MAX`, steht
 * in @/lib/materials neben dem Prüfschema, das sie durchsetzt, und wird von
 * dort importiert, wo geprüft wird. Sie hier ein zweites Mal hinzuschreiben
 * wäre die zweite Wahrheit über dieselbe Zahl — und die eine Stelle, die sie im
 * Browser braucht (das `maxLength` am Textfeld), ist ohnehin nur eine Bremse
 * und keine Prüfung.
 */

/**
 * Die Klammern, mit denen der Agent kennzeichnet, dass er sich nicht sicher
 * war.
 *
 * Sie sind reiner Text und bleiben es. Gespeichert wird die Abschrift Zeichen
 * für Zeichen so, wie sie ankommt, samt Klammern; wer sie beim Übernehmen
 * stehen lässt, hat sich dafür entschieden. Die App entfernt sie nirgends von
 * selbst — täte sie es, stünde am Blatt eine Behauptung, für die niemand
 * geradesteht.
 *
 * Es sind U+27E8 und U+27E9 (MATHEMATICAL LEFT/RIGHT ANGLE BRACKET) und
 * ausdrücklich nicht < und >: die stehen auf Arbeitsblättern in Mathematik und
 * Physik in fast jeder zweiten Zeile, und dann wäre jede Ungleichung eine
 * unsichere Stelle. Dieselben beiden Zeichen nennt der Auftrag des Postboten
 * in harness/auftrag.mts und die Beschreibung von `propose_sheet` in
 * @/lib/mcp/tools.ts — sie stehen dort ausgeschrieben, damit ein Modell sie
 * abtippen kann, und hier als Konstante, damit die Anzeige sie findet.
 */
export const UNCERTAIN_OPEN = "⟨";
export const UNCERTAIN_CLOSE = "⟩";

/**
 * Eine geschlossene Klammer samt Inhalt.
 *
 * Die Zeichenklasse schließt beide Klammern aus. Das hat zwei Folgen, und
 * beide sind gewollt: eine geöffnete Klammer ohne Gegenstück gilt gar nicht
 * als Markierung (geraten wird hier nichts), und der Ausdruck läuft linear —
 * er kann an keiner Eingabe hängen bleiben.
 *
 * Als Quelltext und nicht als fertiger Ausdruck, weil ein Ausdruck mit `g`
 * seinen `lastIndex` mitschleppt. Ein einziger, im Modul liegender Ausdruck
 * gäbe beim zweiten Aufruf ein anderes Ergebnis als beim ersten — und hier
 * ruft jede Taste in jedem offenen Feld neu.
 */
const UNCERTAIN_SOURCE = "\\u27E8[^\\u27E8\\u27E9]*\\u27E9";

/** Ein Stück Abschrift und ob es in Klammern stand. */
export type TranscriptPart = {
  text: string;
  /** Stand dieses Stück in ⟨spitzen Klammern⟩? Die Klammern gehören dazu. */
  uncertain: boolean;
};

/**
 * Zerlegt eine Abschrift in sichere und unsichere Stücke — zum Hervorheben.
 *
 * **Die Klammern bleiben im Text.** Sie werden nicht abgeschnitten, obwohl das
 * hübscher aussähe: das Feld darunter zeigt denselben Text unverändert, und
 * wer eine Stelle sucht, sucht nach der Klammer. Ein Ausschnitt ohne Klammern
 * wäre im Feld nicht wiederzufinden.
 *
 * Aneinandergehängt ergeben die Stücke wieder genau die Eingabe — daran hängt,
 * dass die Hervorhebung nichts verfälscht, und genau das prüft der Test.
 */
export function splitTranscript(text: string): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  const pattern = new RegExp(UNCERTAIN_SOURCE, "g");

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index), uncertain: false });
    }

    parts.push({ text: match[0], uncertain: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), uncertain: false });
  }

  return parts;
}

/**
 * Nur die unsicheren Stellen, in ihrer Reihenfolge — für die Liste über dem
 * Feld und für die Zahl an der zugeklappten Zeile.
 */
export function uncertainSpans(text: string): string[] {
  return text.match(new RegExp(UNCERTAIN_SOURCE, "g")) ?? [];
}

/**
 * Liegt dieses Zitat in einer unsicheren Stelle — auch ohne Klammer darin?
 *
 * ── Die Lücke, die das schließt ──────────────────────────────────────────────
 *
 * `zitat.includes("⟨")` fängt nur den halben Fall. Der andere ist der
 * naheliegendere: Wer mit der Maus INNERHALB der Markierung zieht oder ein Wort
 * darin doppelklickt, erwischt den Inhalt ohne die Klammern. Das Zitat steht
 * dann wörtlich in der Abschrift, enthält kein einziges Klammerzeichen — und
 * besteht ausschließlich aus Text, der beim Abschreiben ausdrücklich als
 * unsicher markiert war. Die Oberfläche verspricht dabei das Gegenteil
 * („Hervorgehobenes … wird abgewiesen"), und ab dem Eingangskorb steht das
 * Zitat als schlichter Text ohne Markierung: Danach kann niemand mehr sehen,
 * dass diese Stelle eine Vermutung war. Am 12.9.2026 von einer Abnahme
 * gefunden, mit dem Text aus dem eigenen Saatgut nachgerechnet.
 *
 * ── Warum „alle Vorkommen" und nicht „irgendeins" ────────────────────────────
 *
 * Dasselbe Stück Text kann zweimal auf der Seite stehen: einmal in einer
 * Markierung, einmal sauber. Abgewiesen wird nur, wenn ALLE Vorkommen in einer
 * Markierung liegen — dann gibt es keine saubere Lesart. Läge auch nur eines
 * daneben, wäre die Abweisung eine Falle: Der Schüler markiert eine Zeile, die
 * gar nicht hervorgehoben ist, und bekommt einen Fehler über eine Stelle, die
 * er nie angefasst hat.
 *
 * Diese Funktion gehört hierher und nicht in den Abrufkern, aus demselben Grund
 * wie `UNCERTAIN_OPEN`: Die ⟨spitzen Klammern⟩ sind eine Abmachung der
 * Abschrift. Wer sie ändert, ändert diese Prüfung mit.
 */
export function onlyInUncertainSpans(text: string, quote: string): boolean {
  if (quote === "") return false;

  const markiert: [number, number][] = [];
  const muster = new RegExp(UNCERTAIN_SOURCE, "g");
  for (let treffer = muster.exec(text); treffer; treffer = muster.exec(text)) {
    markiert.push([treffer.index, treffer.index + treffer[0].length]);
  }

  if (markiert.length === 0) return false;

  let gefunden = false;
  for (let von = text.indexOf(quote); von !== -1; von = text.indexOf(quote, von + 1)) {
    gefunden = true;
    const bis = von + quote.length;
    // Überschneidung zweier Bereiche: der eine fängt an, bevor der andere
    // aufhört, und umgekehrt. Ein Zitat, das nur bis an die Klammer STÖSST,
    // überschneidet sich nicht — dort ist der Text sicher.
    const beruehrt = markiert.some(([ms, me]) => von < me && ms < bis);
    if (!beruehrt) return false;
  }

  return gefunden;
}

/**
 * Die erste Zeile, gekürzt — das, was an einer zugeklappten Seite steht.
 *
 * Die erste Zeile und nicht die ersten achtzig Zeichen: auf einem Blatt steht
 * oben die Überschrift, und die ist genau das, woran man eine Seite
 * wiedererkennt. Achtzig Zeichen quer über einen Absatz wären dagegen ein
 * Satzfragment, das über die Seite nichts sagt.
 */
export function transcriptPreview(text: string, max = 80): string {
  const [first = ""] = text.trim().split(/\r?\n/, 1);

  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/* -------------------------------------------------------------------------
   Die Felder im Formular
   ------------------------------------------------------------------------- */

/**
 * Wie das Textfeld einer Seite im Formular heißt.
 *
 * Die id der Seite steckt IM Namen und nicht in einem zweiten, versteckten
 * Feld daneben. Ein Paar aus zwei Feldern hinge daran, dass beide in derselben
 * Reihenfolge ankommen; ein Name, der die Seite nennt, kann gar nicht erst der
 * falschen zugeordnet werden.
 *
 * Gebaut und gelesen wird er ausschließlich hier. Das Formular ist eine
 * Client-Komponente, die Server Actions liegen auf der anderen Seite der
 * Leitung — stünde der Doppelpunkt an zwei Stellen im Quelltext, käme ein
 * Tippfehler an einer davon als „der Nutzer hat nichts eingegeben" an, und
 * zwar still.
 */
export function transcriptFieldName(pageId: string): string {
  return `abschrift:${pageId}`;
}

/**
 * Die id, unter der das Textfeld einer Seite auf der Seite ansprechbar ist —
 * für `<label for>` und für den Sprung aus der Leseansicht dorthin.
 *
 * Ein Bindestrich statt des Doppelpunkts, weil diese Zeichenkette in einem
 * Anker steht (`#abschrift-<id>`): `:` ist in einer Fragmentkennung erlaubt,
 * in einem CSS-Selektor aber ein Sonderzeichen, und wer eines Tages
 * `document.querySelector("#" + …)` schreibt, stünde vor einem Fehler, den
 * niemand sucht.
 */
export function transcriptFieldId(pageId: string): string {
  return `abschrift-${pageId}`;
}

/**
 * Das versteckte Feld, in dem das Formular mitschickt, WORAUF sich das
 * Textfeld daneben bezieht.
 *
 * Ohne dieses Feld schreibt ein Bildschirm, der vor einer fremden Änderung
 * gerendert wurde, die frische Abschrift mit dem leeren String zu. Der Ablauf
 * ist gemessen und nicht ausgedacht: die Seite trägt beim Rendern NULL, das
 * Feld steht deshalb leer und ist zugeklappt; dann schreibt der Postbote 1240
 * Zeichen hinein; dann drückt jemand am alten Bildschirm auf „Speichern". Das
 * leere Feld kommt mit, `known` ist inzwischen `true` — und daraus wird „"",
 * gelesen, es stand nichts darauf". Die 1240 Zeichen sind weg, ohne Meldung,
 * hinter einer zugeklappten Zeile. Erreichbar ist das über ein zweites Gerät,
 * einen zweiten Tab und über den Service Worker, der eine tagealte Seite aus
 * dem PAGE_CACHE aufschlagen kann (public/sw.js).
 *
 * Ein eigenes Feld je Seite und kein einzelnes für das ganze Blatt: die Seiten
 * werden einzeln geschrieben, und eine fremde Änderung an Seite 3 darf nicht
 * die Eingabe an Seite 7 verwerfen.
 */
export function transcriptBaselineFieldName(pageId: string): string {
  return `abschrift-stand:${pageId}`;
}

/**
 * Der Stand einer Seite, auf ein paar Zeichen eingedampft — „n" für NULL,
 * sonst „t" und die Zeichenzahl.
 *
 * **Die Zahl und nicht der Text.** Der Wortlaut wäre die genauere Auskunft und
 * ginge damit ein zweites Mal durch die Leitung: zwölf Seiten mal 8000 Zeichen
 * sind 96 000, einmal im HTML und noch einmal im Absenden. Genau diesen Preis
 * lehnt die Datei nebenan schon für den `key` des Übernehmen-Formulars ab
 * (siehe eingang/[id]/page.tsx), und die Detailseite bekommt den Volltext aus
 * demselben Grund gar nicht erst — `MaterialPageInfo` in @/lib/materials trägt
 * bewusst nur `transcriptLength`.
 *
 * Gezählt wird deshalb auf BEIDEN Seiten mit derselben Zahl: `length()` aus
 * Postgres. Würde hier im Browser `text.length` gerechnet, zählte JavaScript
 * für Zeichen außerhalb der Grundebene anders (`"𝄞".length` ist 2) — und die
 * Seite gälte als fremd geändert, obwohl niemand sie angefasst hat.
 *
 * Was die Zahl NICHT erkennt: eine Abschrift, die durch eine andere mit exakt
 * gleich vielen Zeichen ersetzt wurde. Dort gilt weiter die Regel dieses
 * Formulars, die auch für Titel und Notiz gilt — der letzte Druck gewinnt. Das
 * ist der Rest, den ein „n"/„t"-Zeichen offen lässt; der teure Fall, in dem
 * eine ganze Abschrift gegen nichts getauscht wird, ist es nicht.
 */
export function transcriptBaseline(length: number | null): string {
  return length === null ? "n" : `t${length}`;
}

/** Eine Seite, so wie das Auslesen des Formulars sie braucht. */
export type TranscriptTarget = {
  pageId: string;
  /**
   * Steht an dieser Seite schon eine Abschrift — und sei es die leere?
   *
   * Das ist genau die Frage, an der NULL und leerer String
   * auseinandergehalten werden, und sie entscheidet über ein leeres Feld:
   * `false` heißt „diese Seite hat noch niemand gelesen", und ein leeres Feld
   * lässt es dabei. `true` heißt „hier steht schon etwas oder der Vorschlag
   * bringt etwas mit", und dann heißt das leere Feld „gelesen, und es stand
   * nichts darauf".
   */
  known: boolean;
  /**
   * Der Stand, den die Seite JETZT hat — `transcriptBaseline()` über die
   * Zeichenzahl aus der Datenbank.
   *
   * Weggelassen heißt „ich prüfe das nicht": dann wird geschrieben, was
   * ankommt, so wie vor dem 5.9.2026. Angegeben heißt „vergleich es mit dem,
   * worauf sich das Formular beruft" — stimmen die beiden nicht überein, hat
   * zwischen Anzeigen und Absenden jemand anders an dieser Seite geschrieben,
   * und dann wird sie nicht angefasst.
   *
   * Optional und nicht Pflicht, weil es zwei Aufrufer gibt und nur einer den
   * Vergleich heute führt. `confirmProposalAction` im Eingangskorb rechnet
   * seinen `known` aus zwei Quellen (Bestand ODER Vorschlag) und braucht
   * deshalb einen eigenen Satz Zeilen; das Formular schickt die Stände dort
   * bereits mit.
   */
  baseline?: string;
};

/**
 * Was das Formular über die Abschriften eines Blattes sagt — die eine
 * Auslegung, an die sich beide Server Actions halten.
 *
 * **Gelaufen wird über die Seiten des BLATTES und nicht über die Feldnamen,
 * die ankommen.** Der Unterschied ist keine Feinheit: zwischen dem Anzeigen
 * des Formulars und dem Abschicken kann eine Seite gelöscht worden sein (auf
 * der Blattseite steht der Knopf dafür direkt daneben), und ein Formular kann
 * ohnehin schicken, was es will — eine Server Action ist eine Adresse wie jede
 * andere. So kommt nur an die Reihe, was es wirklich gibt; alles andere wird
 * nicht abgewiesen, sondern schlicht nicht gefragt.
 *
 * Drei Fälle je Seite, und der dritte ist der, an dem die ganze Unterscheidung
 * hängt:
 *
 * - Das Feld ist nicht dabei → die Seite wird nicht angefasst. Sie behält, was
 *   an ihr steht.
 * - Das Feld ist dabei und trägt Text → dieser Text wird geschrieben.
 * - Das Feld ist dabei und LEER → der leere String wird nur geschrieben, wenn
 *   diese Seite schon eine Abschrift hat oder der Vorschlag eine zu ihr
 *   mitbringt (`known`). Sonst bleibt sie NULL. Ohne diese Bedingung machte
 *   jedes Speichern eines Blattes aus zwölf ungelesenen Seiten zwölf
 *   „gelesen, und es stand nichts darauf" — der Postbote sähe danach keine
 *   Arbeit mehr, und niemand hätte je hingesehen.
 *
 * Und über allen dreien ein vierter Fall, seit dem 5.9.2026: das Feld bezieht
 * sich auf einen Stand, den es nicht mehr gibt. Trägt die Seite in
 * `TranscriptTarget.baseline` ihren heutigen Stand und schickt das Formular
 * einen anderen mit, hat zwischen Anzeigen und Absenden jemand anders an ihr
 * geschrieben — dann wird sie ausgelassen und über `outdatedTranscriptPages()`
 * gemeldet. Warum es diesen Fall gibt, steht an
 * `transcriptBaselineFieldName()`.
 *
 * Geschnitten wird an den Rändern, weil `transcriptSchema` in @/lib/materials
 * es auch tut: eine Seite, auf der nur Leerzeichen und Zeilenumbrüche stehen,
 * ist eine leere Seite. Was ZWISCHEN den Zeilen steht, bleibt unangetastet —
 * die Gliederung eines Tafelanschriebs ist Teil der Abschrift.
 */
export function transcriptsFromForm(
  formData: FormData,
  pages: readonly TranscriptTarget[],
): NewPageTranscript[] {
  return readForm(formData, pages).entries;
}

/**
 * Welche Seiten das Formular ausgelassen hat, WEIL inzwischen jemand anders an
 * ihnen geschrieben hat — in der Reihenfolge der Seiten.
 *
 * Zwei Fragen an dieselbe Rechnung und nicht zwei Rechnungen: was geschrieben
 * wird und was ausgelassen wurde, entscheidet `readForm()` in einem Zug.
 * Stünde die Auslassung hier ein zweites Mal ausgerechnet, wären es zwei
 * Antworten auf dieselbe Frage — und die falsche stünde auf dem Bildschirm,
 * während die richtige in die Datenbank ginge. Dass der Aufrufer die Seiten
 * damit zweimal durchläuft, kostet bei höchstens zwölf Feldern nichts.
 *
 * **Diese Seiten müssen dem Nutzer gesagt werden.** Still zu übergehen, was
 * nicht geschrieben wurde, wäre derselbe Fehler mit umgekehrtem Vorzeichen: er
 * hat etwas getippt, es steht nach dem Auffrischen nicht da, und niemand hat
 * ihm gesagt warum. Der Satz dafür steht in `updateMaterialAction`.
 */
export function outdatedTranscriptPages(
  formData: FormData,
  pages: readonly TranscriptTarget[],
): string[] {
  return readForm(formData, pages).outdated;
}

/** Was ein Durchlauf über die Seiten des Blattes ergibt. */
type FormReading = {
  entries: NewPageTranscript[];
  outdated: string[];
};

/**
 * Bezieht sich das Feld dieser Seite noch auf den Stand, der jetzt in der
 * Datenbank steht?
 *
 * Drei Antworten, und die dritte ist die für den Bildschirm, den es schon vor
 * dieser Prüfung gab:
 *
 * - Der Aufrufer gibt keinen Stand an → es gibt nichts zu vergleichen.
 * - Das Formular schickt einen Stand mit → er muss auf den heutigen passen.
 * - Das Formular schickt KEINEN Stand mit (eine Seite aus dem Cache des
 *   Service Workers, ein Aufruf ohne Browser) → dann wenigstens der teure
 *   Teilfall: eine Seite, an der Text steht, wird von einem LEEREN Feld nicht
 *   auf „gelesen, nichts darauf" gesetzt. Alles andere bleibt beim alten
 *   Verhalten — wer die Abschrift wirklich ersetzen will, tippt etwas hinein,
 *   und dann gewinnt wie überall in diesem Formular der letzte Druck.
 */
function isOutdated(
  formData: FormData,
  page: TranscriptTarget,
  text: string,
): boolean {
  if (page.baseline === undefined) return false;

  const sent = formData.get(transcriptBaselineFieldName(page.pageId));
  if (typeof sent === "string") return sent !== page.baseline;

  const leer =
    page.baseline === transcriptBaseline(null) ||
    page.baseline === transcriptBaseline(0);

  return text === "" && !leer;
}

/** Der eine Durchlauf, aus dem beide Fragen ihre Antwort nehmen. */
function readForm(
  formData: FormData,
  pages: readonly TranscriptTarget[],
): FormReading {
  const entries: NewPageTranscript[] = [];
  const outdated: string[] = [];

  for (const page of pages) {
    const value = formData.get(transcriptFieldName(page.pageId));

    // Nicht dabei — oder eine Datei, die jemand unter diesem Namen
    // untergeschoben hat. Beides heißt hier dasselbe: nichts anfassen.
    if (typeof value !== "string") continue;

    const text = value.trim();
    if (text === "" && !page.known) continue;

    // Erst hier und nicht vorher: eine Seite, die ohnehin nicht angefasst
    // würde, ist nicht „überholt" — sonst stünde am Bildschirm, an einer
    // ungelesenen Seite habe jemand anders geschrieben, obwohl an ihr nach wie
    // vor nichts steht.
    if (isOutdated(formData, page, text)) {
      outdated.push(page.pageId);
      continue;
    }

    entries.push({ pageId: page.pageId, text });
  }

  return { entries, outdated };
}
