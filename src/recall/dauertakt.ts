import { addDays } from "@/lib/dates";

/**
 * Wiederholen ohne Klausur (Antwort 6 vom 13.10.2026, „ganz wichtig“):
 * Englisch, Französisch und jedes andere Fach ohne anstehende Klausur oder
 * Epoche werden trotzdem regelmäßig abgefragt, weil jederzeit ein
 * Überraschungstest kommen kann.
 *
 * Bisher plante `planeFaelligkeiten()` ohne Klausur genau vier Termine im
 * Grundtakt und nach einer Klausur drei Erhaltungstermine. Danach hatte ein
 * Thema keinen offenen Termin mehr und verschwand von der Startseite. Diese
 * Datei regelt zweierlei, beides als reine Rechnung (keine Datenbank, keine
 * Uhr), damit die Tests nicht an einem bestimmten Tag hängen:
 *
 * 1. **Der Dauertakt** (`dauertaktTermin`): Hat ein Baustein in einem Fach
 *    ohne anstehende Klausur keinen offenen Termin mehr, bekommt er genau
 *    einen neuen, `DAUERTAKT` Tage nach dem letzten Kontakt. So läuft die
 *    Wiederholung ohne Ende weiter, ohne dass ein Plan bis ans Ende der Zeit
 *    vorausgeschrieben wird. Geplante Termine (`createItem`, `neuPlanen`)
 *    bleiben, wie sie sind.
 *
 * 2. **Maß halten** (`tagesauswahl`): Von den heute fälligen Themen ohne
 *    Klausur kommt höchstens eins auf die Startseite, das fälligste. Themen
 *    mit Klausur zählen nicht dazu, sie gehören zum Lernplan. Steht heute ein
 *    offener Lernblock an, rutscht das Thema ohne Klausur hinter die Themen
 *    mit Klausur. In Ferien gibt es nichts.
 */

/**
 * Abstand in Tagen zwischen zwei Wiederholungen eines Bausteins ohne
 * Klausur. Eine Setzung wie die Konstanten in @/recall/schedule: kürzer als
 * der Erhaltungstakt nach einer Klausur (21 Tage), weil ein Überraschungstest
 * keinen Vorlauf hat, und länger als der Grundtakt vor einer Klausur
 * (3 Tage), weil kein Ziel da ist, auf das hin verdichtet wird.
 */
export const DAUERTAKT = 14;

/** Wie viele Themen ohne Klausur höchstens an einem Tag drankommen. */
export const OHNE_KLAUSUR_JE_TAG = 1;

export type BausteinStand = {
  /** Steht im Fach eine Klausur oder ein Test an? Dann plant der Lernplan. */
  klausur: boolean;
  /** Fälligkeitstage der offenen Termine */
  offen: readonly string[];
  /** App-Tag des zuletzt erledigten Termins */
  zuletzt: string | null;
  /** App-Tag der Aufnahme */
  aufgenommen: string;
  /** App-Tag der jüngsten Auswertung eines Arbeitsblatts zum Thema */
  ausgewertet: string | null;
};

const spaeter = (a: string, b: string | null) => (b && b > a ? b : a);

/**
 * Der Tag, an dem ein Baustein ohne Klausur wieder drankommt — oder `null`,
 * wenn er keinen neuen Termin braucht (Klausur im Fach, oder noch ein
 * offener Termin). Ein offener Termin bis zum Tag einer Blattauswertung zählt
 * nicht: Ihn übergeht das Lesen ohnehin (`gruppiert()` in @/recall/themen).
 * Der Tag darf in der Vergangenheit liegen; dann ist der Baustein überfällig
 * und steht beim fälligsten zuerst weiter vorn.
 */
export function dauertaktTermin(b: BausteinStand): string | null {
  if (b.klausur) return null;
  const zaehlt = b.offen.some((d) => !b.ausgewertet || d > b.ausgewertet);
  if (zaehlt) return null;
  const letzter = spaeter(spaeter(b.aufgenommen, b.zuletzt), b.ausgewertet);
  return addDays(letzter, DAUERTAKT);
}

export type AuswahlThema = {
  /** nächste Klausur des Fachs oder null */
  klausur: string | null;
  /** heute schon angefangen */
  angefangen: boolean;
};

export type AuswahlLage = {
  ferien: boolean;
  /** Themen ohne Klausur, die heute schon beendet wurden */
  ohneKlausurBeendet: number;
  /** Steht heute ein offener Lernblock an? */
  lernblockOffen: boolean;
};

/**
 * Was von den fälligen Themen (schon sortiert, das fälligste zuerst) heute
 * auf die Startseite kommt. Themen mit Klausur bleiben alle. Von denen ohne
 * Klausur bleibt höchstens eins je Tag; ein angefangenes behält seinen Platz
 * immer. Mit offenem Lernblock stehen sie hinter den Themen mit Klausur.
 */
export function tagesauswahl<T extends AuswahlThema>(sortiert: readonly T[], lage: AuswahlLage): T[] {
  if (lage.ferien) return [];
  let frei = Math.max(0, OHNE_KLAUSUR_JE_TAG - lage.ohneKlausurBeendet);
  for (const t of sortiert) if (t.klausur === null && t.angefangen) frei -= 1;
  const bleibt = sortiert.filter((t) => {
    if (t.klausur !== null || t.angefangen) return true;
    if (frei <= 0) return false;
    frei -= 1;
    return true;
  });
  if (!lage.lernblockOffen) return bleibt;
  const rang = (t: T) => (t.angefangen ? 0 : t.klausur !== null ? 1 : 2);
  // Array.prototype.sort ist stabil: innerhalb eines Rangs bleibt die Folge
  return bleibt.slice().sort((a, b) => rang(a) - rang(b));
}
