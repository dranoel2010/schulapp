import { errorText } from "@/lib/calendar/error-text";
import { todayInBerlin } from "@/lib/dates";
import { moveOffFreeDays } from "@/lib/exams";
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
 * Gibt die Zahl der Klausuren zurück, deren Plan sich bewegt hat.
 */
export async function freieTageNachgezogen(userId: string, heute: string = todayInBerlin()): Promise<number> {
  const moved = await moveOffFreeDays(userId, heute);
  await abrufNeuGeplant(userId, heute);
  return moved;
}

/**
 * Der Abrufkern darf fehlen (scripts/abruf-rueckbau.sql) — dann bleibt es beim
 * Lernplan, und das Nachziehen scheitert nicht an einem Modul, das es nicht
 * mehr gibt.
 */
export async function abrufNeuGeplant(userId: string, heute: string = todayInBerlin()): Promise<void> {
  try {
    await neuPlanen(userId, heute);
  } catch (error) {
    console.error("Abruf nicht neu geplant", errorText(error));
  }
}
