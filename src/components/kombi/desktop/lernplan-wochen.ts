import { addDays } from "@/lib/dates";
import { wd } from "@/lib/kombi/text";

/**
 * Die Wochen des Lernplan-Streifens am Rechner (lernplan-streifen.tsx), ohne
 * React, damit sie ohne Browser prüfbar sind (lernplan-wochen.test.ts).
 *
 * Der Plan beginnt mit dem Vorlauf (10 Tage) oft eine Woche vor der Klausur,
 * und die Probeklausur darf auf einem Wochenende liegen (Klausur am Montag:
 * Sonntag davor). Darum: ein Streifen je Woche vom ersten Eintrag bis zur
 * Woche der Klausur, je Woche Montag bis Freitag, Samstag und Sonntag nur,
 * wenn dort etwas liegt. So fällt kein Block aus dem Streifen.
 */

/** Montag der Woche eines Tages ('YYYY-MM-DD') */
export const montagVon = (tag: string): string => addDays(tag, -((wd(tag) + 6) % 7));

export function streifenWochen(blockTage: readonly string[], klausurTag: string): string[][] {
  const alle = [...blockTage, klausurTag].sort();
  const belegt = new Set(alle);
  const wochen: string[][] = [];
  const letzte = montagVon(klausurTag);
  for (let mo = montagVon(alle[0]); mo <= letzte; mo = addDays(mo, 7)) {
    const tage = [0, 1, 2, 3, 4].map((i) => addDays(mo, i));
    for (const i of [5, 6]) if (belegt.has(addDays(mo, i))) tage.push(addDays(mo, i));
    wochen.push(tage);
  }
  return wochen;
}
