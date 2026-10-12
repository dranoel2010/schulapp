import { requestCalendarSync } from "@/lib/calendar/sync";

/**
 * Was nach jeder geschriebenen Hausaufgabe passiert (Plan 3.9): der Google
 * Kalender wird angestoßen — nach Eintragen, Ändern, Abhaken, Löschen und
 * nach jedem Rückgängig. Eine Stelle für alle Wege, damit es keiner vergisst.
 *
 * `nachlauf.sync` ist das Interface für Tests (Spion statt echtem Abgleich).
 */
export const nachlauf = {
  sync: (userId: string) => requestCalendarSync(userId),
};

export function nachAufgabeGeschrieben(userId: string): void {
  nachlauf.sync(userId);
}
