import { timeInBerlin } from "@/lib/dates";

/**
 * Ist ein Abruf bei IServ fällig?
 *
 * Reine Rechnung. Selten und höflich: Der Kalender-Cron läuft stündlich um
 * :15, IServ wird davon höchstens alle drei Stunden gefragt, und nur zwischen
 * 6 und 21 Uhr — das sind höchstens sechs Abrufe am Tag (06:15, 09:15, 12:15,
 * 15:15, 18:15, 21:15). Ein Abruf mit gültiger Session sind vier Anfragen
 * (eventsources, öffentlich, Klasse, Aufgaben), einer mit Anmeldung etwa
 * dreizehn.
 *
 * - „Erneut versuchen" in den Einstellungen ist immer fällig; die Sperre hebt
 *   die Action vorher auf.
 * - Blockiert heißt: nie, bis ein Mensch handelt.
 * - Der allererste Abruf ist zu JEDER Stunde fällig. Sonst bliebe ein Setup am
 *   Abend bis 06:15 ohne Stand, und jede Stunde dazwischen meldete der Cron
 *   „noch kein Stand".
 *   `iserv-einrichten.sh --neues-passwort` setzt `last_attempt_at` deshalb
 *   zurück: Der nächste Lauf ist wie ein allererster sofort fällig, und die
 *   Probe des Skripts prüft das neue Passwort gleich.
 * - Nie zweimal in einer Stunde (50 Minuten).
 * - Nach genau einem Fehlschlag eine schnelle Wiederholung in der nächsten
 *   Stunde; nach zweien wieder der 3-Stunden-Takt.
 * - Sonst nach 170 Minuten — die zehn Minuten Spielraum gleichen aus, dass der
 *   Cron nicht auf die Sekunde um :15 startet.
 *
 * Kein Abruf bei „Jetzt abgleichen" und keiner aus `after()`: Diese Läufe
 * lesen nur den gespeicherten Snapshot.
 */

export const ERSTE_STUNDE = 6;
export const LETZTE_STUNDE = 21;
export const MIN_ABSTAND_MS = 50 * 60_000;
export const TAKT_MS = 170 * 60_000;

export function faellig(input: {
  jetzt: Date;
  zustand: {
    blockedAt: Date | null;
    lastAttemptAt: Date | null;
    failuresInRow: number;
  } | null;
  anlass: "cron" | "hand";
}): boolean {
  if (input.anlass === "hand") return true;

  const zustand = input.zustand;
  if (zustand?.blockedAt) return false;
  if (!zustand?.lastAttemptAt) return true;

  const stunde = Number(timeInBerlin(input.jetzt).slice(0, 2));
  if (stunde < ERSTE_STUNDE || stunde > LETZTE_STUNDE) return false;

  const abstand = input.jetzt.getTime() - zustand.lastAttemptAt.getTime();
  if (abstand < MIN_ABSTAND_MS) return false;
  if (zustand.failuresInRow === 1) return true;

  return abstand >= TAKT_MS;
}
