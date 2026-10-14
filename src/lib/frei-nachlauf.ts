import { errorText } from "@/lib/calendar/error-text";
import { moveOffFreeDays } from "@/lib/exams";
import { appTag } from "@/lib/tag";
import { neuPlanen } from "@/recall/items";

/**
 * Nachdem freie Tage dazugekommen sind oder sich verschoben haben: die Pläne
 * von ihnen wegräumen — die offenen Lernblöcke der Klausuren
 * (`moveOffFreeDays`) und die Termine im Abruf (`neuPlanen`).
 *
 * Gerufen vom Ferienabgleich mit IServ (@/lib/iserv/abruf), sobald er eine
 * Zeile in `free_periods` angelegt, geändert oder entfernt hat. Frei heißt
 * ganz frei: An einem freien Tag steht danach kein Lernblock und kein Abruf.
 *
 * `heute` ist der App-Tag (Wechsel um 4 Uhr, wie überall in Modell 23), nicht
 * der Kalendertag: um 01:30 gehört der Abend noch zum Vortag.
 *
 * Gibt die Zahl der Klausuren zurück, deren Plan sich bewegt hat.
 */
export async function freieTageNachgezogen(userId: string, heute: string = appTag(new Date())): Promise<number> {
  const moved = await moveOffFreeDays(userId, heute);
  await abrufNeuGeplant(userId, heute);
  return moved;
}

/**
 * Der Abrufkern darf fehlen (scripts/abruf-rueckbau.sql) — dann bleibt es beim
 * Lernplan, und das Nachziehen scheitert nicht an einem Modul, das es nicht
 * mehr gibt.
 */
export async function abrufNeuGeplant(userId: string, heute: string = appTag(new Date())): Promise<void> {
  try {
    await neuPlanen(userId, heute);
  } catch (error) {
    console.error("Abruf nicht neu geplant", errorText(error));
  }
}
