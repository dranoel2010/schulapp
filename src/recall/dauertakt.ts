import { addDays } from "@/lib/dates";
import { planeFaelligkeiten, type Betriebsart } from "@/recall/schedule";

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
 *    bleiben, wie sie sind. Steht in einem Fach mit Klausur vor der Klausur
 *    nichts mehr offen, rechnet `nachlegenPlan` die Termine bis dahin nach.
 *
 * 2. **Maß halten** (`tagesauswahl`): Von den heute fälligen Themen ohne
 *    Klausur und außerhalb der Epoche kommt höchstens eins auf die
 *    Startseite, das fälligste. Themen mit Klausur und Themen des
 *    Epochenfachs zählen nicht dazu: die einen gehören zum Lernplan, die
 *    anderen zum Hauptunterricht, der gerade läuft, und kommen alle. Steht
 *    heute ein offener Lernblock an, rutscht das begrenzte Thema hinter die
 *    übrigen. In Ferien gibt es nichts.
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

/** Ein Termin, den `nachlegenPlan()` neu anlegen will. */
export type NeuerTermin = { dueOn: string; mode: Betriebsart };

/**
 * Was ein Baustein ohne zählenden offenen Termin neu bekommt, damit er nie
 * aus dem Abfragen fällt (Antwort 6). Zählend heißt: nach dem Tag einer
 * Blattauswertung, wie in `dauertaktTermin()`.
 *
 * - **Ohne Klausur im Fach**: genau einen Termin im Dauertakt.
 * - **Mit Klausur im Fach**: Die Termine bis zur Klausur rechnet
 *   `planeFaelligkeiten()` wie in `neuPlanen()`, ab dem letzten Kontakt.
 *   Gebraucht wird das, wenn die Klausur erst eingetragen wurde, nachdem der
 *   Baustein seine Termine schon hinter sich hatte, oder sein einziger offener
 *   Termin (aus dem Dauertakt) nach der Klausur liegt. Ohne diese Regel
 *   schaltete ausgerechnet ein angekündigter Test das Abfragen ab.
 *   Erhaltungstermine nach der Klausur kommen nur dazu, wenn gar kein
 *   zählender Termin mehr offen ist; sonst stünden sie doppelt da.
 *
 * Steht vor der Klausur noch ein zählender Termin offen, plant weiter der
 * Lernplan, und es kommt nichts dazu.
 */
export function nachlegenPlan(
  b: Omit<BausteinStand, "klausur"> & { klausurtag: string | null; heute: string; sperrtage?: string[] },
): NeuerTermin[] {
  if (!b.klausurtag) {
    const tag = dauertaktTermin({ ...b, klausur: false });
    return tag ? [{ dueOn: tag, mode: "erhaltung" }] : [];
  }
  const klausurtag = b.klausurtag;
  const zaehlend = b.offen.filter((d) => !b.ausgewertet || d > b.ausgewertet);
  if (zaehlend.some((d) => d < klausurtag)) return [];
  const plan = planeFaelligkeiten({
    heute: b.heute,
    aufgenommenAm: spaeter(spaeter(b.aufgenommen, b.zuletzt), b.ausgewertet),
    klausurtag,
    sperrtage: b.sperrtage ?? [],
  });
  return plan.faelligkeiten
    .filter((f) => f.mode === "klausur" || zaehlend.length === 0)
    .map((f) => ({ dueOn: f.dueOn, mode: f.mode }));
}

export type AuswahlThema = {
  /** nächste Klausur des Fachs oder null */
  klausur: string | null;
  /** Thema des Epochenfachs (Hauptunterricht) */
  istEpoche: boolean;
  /** heute schon angefangen */
  angefangen: boolean;
};

export type AuswahlLage = {
  ferien: boolean;
  /** Themen ohne Klausur und außerhalb der Epoche, die heute schon beendet wurden */
  ohneKlausurBeendet: number;
  /** Steht heute ein offener Lernblock an? */
  lernblockOffen: boolean;
};

/**
 * Zählt ein Thema zur Grenze „höchstens eins am Tag“? Nur Themen ohne
 * Klausur und außerhalb der Epoche (Antwort 6). Die Epoche ist der Unterricht,
 * der gerade läuft: ihre Themen kommen wie die mit Klausur alle, auch ohne
 * Klausur, und nehmen Englisch oder Französisch den Platz nicht weg.
 */
export const zaehltZurGrenze = (t: { klausur: string | null; istEpoche: boolean }): boolean =>
  t.klausur === null && !t.istEpoche;

/**
 * Was von den fälligen Themen (schon sortiert, das fälligste zuerst) heute
 * auf die Startseite kommt. Themen mit Klausur und Themen der Epoche bleiben
 * alle. Von den übrigen bleibt höchstens eins je Tag; ein angefangenes behält
 * seinen Platz immer. Mit offenem Lernblock stehen sie hinter den anderen.
 */
export function tagesauswahl<T extends AuswahlThema>(sortiert: readonly T[], lage: AuswahlLage): T[] {
  if (lage.ferien) return [];
  let frei = Math.max(0, OHNE_KLAUSUR_JE_TAG - lage.ohneKlausurBeendet);
  for (const t of sortiert) if (zaehltZurGrenze(t) && t.angefangen) frei -= 1;
  const bleibt = sortiert.filter((t) => {
    if (!zaehltZurGrenze(t) || t.angefangen) return true;
    if (frei <= 0) return false;
    frei -= 1;
    return true;
  });
  if (!lage.lernblockOffen) return bleibt;
  const rang = (t: T) => (t.angefangen ? 0 : zaehltZurGrenze(t) ? 2 : 1);
  // Array.prototype.sort ist stabil: innerhalb eines Rangs bleibt die Folge
  return bleibt.slice().sort((a, b) => rang(a) - rang(b));
}

/**
 * Der erste Tag ab `tag`, der nicht frei ist: Ferien sind ganz frei, dort
 * kommt nichts („Nächstes Thema …“ nennt dann den ersten Tag danach). Beide
 * Enden eines Zeitraums zählen mit, wie bei `freePeriodOn()`.
 */
export function ersterSchultagAb(
  tag: string,
  zeitraeume: readonly { startsOn: string; endsOn: string }[],
): string {
  let d = tag;
  // Jeder Schritt springt hinter einen Zeitraum; mehr Schritte als Zeiträume braucht es nicht.
  for (let schritt = 0; schritt <= zeitraeume.length; schritt += 1) {
    const frei = zeitraeume.find((z) => z.startsOn <= d && d <= z.endsOn);
    if (!frei) return d;
    d = addDays(frei.endsOn, 1);
  }
  return d;
}

/**
 * Ein Thema, das zur Grenze „eins am Tag“ zählt, mit dem, was für die
 * Reihenfolge von `tagesauswahl()` zählt: je Baustein der früheste offene
 * Termin (wie `faelligHeute()`) und der Name („⟨Fach⟩ ⟨Thema⟩“).
 */
export type GrenzThema = { key: string; termine: readonly string[]; name: string };

/**
 * Der Tag, an dem `eigen` unter der Grenze „eins am Tag“ wirklich drankommt,
 * frühestens `ab` (der Tag nach dem heutigen Durchgang). Gerechnet wie die
 * Startseite an jedem Tag: von den fälligen Themen ohne Klausur kommt das
 * fälligste (ältester Termin, dann mehr fällige Fragen, dann alphabetisch);
 * es belegt den Tag, die übrigen warten auf den nächsten. Ferien sind frei
 * (`ersterSchultagAb`). So sagt „Wieder dran“ zwei Themen, deren Termine in
 * die Ferien fallen, nicht beiden denselben ersten Tag danach zu.
 */
export function tagUnterGrenze(
  eigen: GrenzThema,
  andere: readonly GrenzThema[],
  ab: string,
  zeitraeume: readonly { startsOn: string; endsOn: string }[],
): string {
  const erster = (t: GrenzThema) => t.termine.reduce((m, d) => (d < m ? d : m), t.termine[0]);
  const fragen = (t: GrenzThema, tag: string) => t.termine.filter((d) => d <= tag).length;
  const vor = (a: GrenzThema, b: GrenzThema, tag: string): number =>
    erster(a) < erster(b) ? -1 : erster(a) > erster(b) ? 1 : fragen(b, tag) - fragen(a, tag) || a.name.localeCompare(b.name, "de");

  if (eigen.termine.length === 0) return ersterSchultagAb(ab, zeitraeume);
  let wartend = andere.filter((t) => t.key !== eigen.key && t.termine.length > 0);
  let tag = ersterSchultagAb(ab, zeitraeume);
  // Jeder Tag mit fälligem Thema vergibt seinen Platz, an eins der anderen
  // oder an `eigen`. Mehr Tage als Themen braucht es also nicht; leere Tage
  // werden übersprungen und zählen nicht.
  const tage = wartend.length + 1;
  for (let vergeben = 0; vergeben < tage; ) {
    const faellig = [eigen, ...wartend].filter((t) => erster(t) <= tag);
    if (faellig.length === 0) {
      // bis zum nächsten Termin springen, der überhaupt etwas fällig macht
      const naechster = [eigen, ...wartend].map(erster).reduce((m, d) => (d < m ? d : m));
      tag = ersterSchultagAb(naechster, zeitraeume);
      continue;
    }
    vergeben += 1;
    const zuerst = faellig.slice().sort((a, b) => vor(a, b, tag))[0];
    if (zuerst === eigen) return tag;
    wartend = wartend.filter((t) => t !== zuerst);
    tag = ersterSchultagAb(addDays(tag, 1), zeitraeume);
  }
  return tag;
}
