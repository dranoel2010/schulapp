import { berlinDay } from "@/lib/dates";
import type { WhStand } from "@/lib/kombi/wiederholen-text";
import { wiederholenStand } from "@/recall/themen";

/**
 * Alles, was die Startseite braucht (Plan 3.2) — ein reines, serialisierbares
 * Objekt. `ladeTag()` läuft beim Server-Rendern von `/` (als Startwert für
 * die Shell) und sonst über `GET /api/tag/daten` (Plan 2.4, Punkt 1).
 *
 * Abschnitt A legt nur das Gerüst an: den App-Tag für die Datumszeile.
 * Abschnitt B ergänzt Ansicht, Aufgaben, Stunden, Klausur, Wiederholen und
 * die letzten Blätter (`src/lib/tag.ts`, Testuhr).
 */
export type TagDaten = {
  /** App-Tag 'YYYY-MM-DD', Wechsel um 04:00 Europe/Berlin */
  tag: string;
  /** Zeitpunkt der Berechnung, ISO */
  stand: string;
  /** Block „Wiederholen“ auf dem Überblick (Abschnitt E, V2 4.5) */
  wiederholen: WhStand;
};

/** Der App-Tag: der Berliner Kalendertag von „jetzt minus 4 Stunden“. */
export function appTagVon(now: Date): string {
  return berlinDay(new Date(now.getTime() - 4 * 3600_000));
}

export async function ladeTag(userId: string, now: Date): Promise<TagDaten> {
  const tag = appTagVon(now);
  return { tag, stand: now.toISOString(), wiederholen: await wiederholenStand(userId, tag) };
}
