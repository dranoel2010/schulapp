import { addDays } from "@/lib/dates";
import { wd } from "@/lib/kombi/text";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Der Tag selbst oder der nächste Werktag danach (Samstag und Sonntag zählen nicht). */
export function werktagAb(tag: string): string {
  let d = tag;
  while (wd(d) === 0 || wd(d) === 6) d = addDays(d, 1);
  return d;
}

/**
 * Die Datums-Chips der Abgabe am Rechner (desktop.html `aufgabeForm`): die
 * nächste Stunde im Fach, der nächste Schultag, der Schultag danach und der
 * Tag, der schon im Feld steht (auch ein vergangener, damit er sichtbar
 * gewählt bleibt). Ohne doppelte, aufsteigend. Ferien kennt das Formular
 * nicht; die nächste Stunde überspringt sie schon auf dem Server.
 *
 * `morgen` ist der Rückfall des Formulars (heute + 1).
 */
export function abgabeTage({ naechsteStunde, morgen, gewaehlt }: { naechsteStunde?: string; morgen: string; gewaehlt?: string }): string[] {
  const erster = werktagAb(morgen);
  const zweiter = werktagAb(addDays(erster, 1));
  const tage = [naechsteStunde, erster, zweiter, gewaehlt].filter((d): d is string => !!d && ISO.test(d));
  return [...new Set(tage)].sort();
}
