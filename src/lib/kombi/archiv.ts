import { daysBetween } from "@/lib/dates";
import { ERLEDIGT_LISTE_TAGE } from "@/lib/kombi/vorrat";

/**
 * Das Archiv (Antwort 11 vom 13.10.2026): Vergangenes kommt nach zwei Wochen
 * ins Archiv, gelöscht wird nichts.
 *
 * - Eine Klausur steht nach ihrem Tag noch bis einschließlich Tag 14 in der
 *   Liste „Klausuren“ (unten, blasser), ab Tag 15 im Archiv. Gezählt wird in
 *   App-Tagen (`appTag`: Berliner Kalendertag, Wechsel um 04:00).
 * - Eine erledigte Hausaufgabe steht wie bisher zwei Tage unter „Erledigt“
 *   (`ERLEDIGT_LISTE_TAGE`, gerechnet ab dem Abhaken), danach im Archiv.
 *   Die Zeile findet sie noch zwei Wochen (`ERLEDIGT_SUCHE_TAGE`), danach
 *   steht sie nur noch im Archiv.
 *
 * Rein, ohne Datenbank: Server, Client und Tests rechnen gleich.
 */

/** So viele Tage nach dem Klausurtag steht eine Klausur noch in der Liste. */
export const KLAUSUR_LISTE_TAGE = 14;

/** Liegt der Klausurtag vor dem heutigen App-Tag? */
export function klausurVorbei(datum: string, heute: string): boolean {
  return datum < heute;
}

/** Gehört die Klausur ins Archiv? Ab Tag 15 nach dem Klausurtag. */
export function klausurImArchiv(datum: string, heute: string): boolean {
  return daysBetween(datum, heute) > KLAUSUR_LISTE_TAGE;
}

/**
 * Gehört die Aufgabe ins Archiv? Erledigt und vor mehr als zwei Tagen
 * abgehakt. Ohne Zeitpunkt des Abhakens (alte Daten) gilt sie als archiviert,
 * sonst stünde sie für immer unter „Erledigt“.
 */
export function aufgabeImArchiv(a: { done: boolean; doneAt: string | null }, jetztMs: number): boolean {
  if (!a.done) return false;
  if (!a.doneAt) return true;
  return new Date(a.doneAt).getTime() < jetztMs - ERLEDIGT_LISTE_TAGE * 864e5;
}
