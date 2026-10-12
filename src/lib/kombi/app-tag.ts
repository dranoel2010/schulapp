import { berlinDay } from "@/lib/dates";

/**
 * Der App-Tag: der Berliner Kalendertag von „jetzt minus 4 Stunden“ (Plan
 * 3.1). Rein und ohne Datenbank, damit auch Client-Komponenten (die Zeile)
 * ihn rechnen können.
 */
export function appTagVon(now: Date): string {
  return berlinDay(new Date(now.getTime() - 4 * 3600_000));
}
