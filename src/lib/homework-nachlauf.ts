import { requestCalendarSync } from "@/lib/calendar/sync";

/**
 * Was nach jeder Änderung an einer Hausaufgabe passiert (Modell 23, Plan 3.9).
 *
 * Heute ist das der Google-Kalender-Abgleich. Er hing bisher an vier Stellen
 * in `hausaufgaben/actions.ts`; mit der Zeile und der Startseite kommen
 * Eintragen, Abhaken, Löschen, Ändern und beide Rückgängig-Wege dazu. Damit
 * keiner davon den Abgleich vergisst, rufen alle diese eine Funktion.
 *
 * `nachlauf.sync` und `abgleich.anstossen` sind Objekte und keine festen
 * Funktionen, damit ein Test den Aufruf beobachten kann (ESM-Importe lassen
 * sich nicht überschreiben). Beide führen zum selben Abgleich.
 */
export const nachlauf = {
  sync: (userId: string) => requestCalendarSync(userId),
};

export const abgleich: { anstossen: (userId: string) => void } = {
  anstossen: (userId) => nachlauf.sync(userId),
};

export function nachAufgabeGeschrieben(userId: string): void {
  abgleich.anstossen(userId);
}
