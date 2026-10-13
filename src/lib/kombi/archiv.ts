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

/**
 * Was die Seite einer Klausur zum Planen zeigt. Ist sie vorbei (meist über
 * das Archiv erreicht), plant die App nichts mehr: kein Lernplan-Hinweis,
 * kein „Themen eintragen“, kein „Termine neu rechnen“. Ein Lernplan mit
 * Blöcken bleibt als Rückblick stehen („3 von 4 Blöcken erledigt“).
 */
export function klausurPlanAnsicht(k: { datum: string; heute: string; themen: number; bloecke: number }): {
  lernplan: boolean;
  termineNeu: boolean;
} {
  if (!klausurVorbei(k.datum, k.heute)) return { lernplan: true, termineNeu: true };
  return { lernplan: k.themen > 0 && k.bloecke > 0, termineNeu: false };
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

/**
 * Die Klausuren einer Liste (Seite „Klausuren“ und Seite eines Fachs): die
 * kommenden zuerst, die nächste oben; darunter die vergangenen bis Tag 14,
 * die jüngste zuerst. Was im Archiv steht, fällt heraus und wird gezählt.
 */
export function klausurListe<T extends { datum: string }>(
  zeilen: readonly T[],
  heute: string,
): { liste: (T & { vorbei: boolean })[]; archiv: number } {
  const auf = (a: { datum: string }, b: { datum: string }) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0);
  const mit = zeilen.map((z) => ({ ...z, vorbei: klausurVorbei(z.datum, heute) }));
  return {
    liste: [
      ...mit.filter((k) => !k.vorbei).sort(auf),
      ...mit.filter((k) => k.vorbei && !klausurImArchiv(k.datum, heute)).sort((a, b) => auf(b, a)),
    ],
    archiv: mit.filter((k) => klausurImArchiv(k.datum, heute)).length,
  };
}
