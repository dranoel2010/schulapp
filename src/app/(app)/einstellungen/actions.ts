"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";

/**
 * Einstellungen, die der Nutzer selbst dreht.
 *
 * Bisher nur die Uhrzeit der täglichen Erinnerung. Sie ist eine volle Stunde
 * in Berliner Zeit — welche Stunde gerade dran ist, entscheidet der stündliche
 * Lauf in /api/cron/reminders.
 *
 * Die Grenzen stehen absichtlich auch hier: eine "use server"-Datei darf nur
 * asynchrone Funktionen ausgeben, geteilte Konstanten gehen also nicht. Die
 * Auswahlliste in push-settings.tsx hat dieselben Werte.
 */

const FIRST_HOUR = 6;
const LAST_HOUR = 22;

const hourSchema = z.coerce
  .number()
  .int()
  .min(FIRST_HOUR)
  .max(LAST_HOUR);

export type ReminderTimeState = {
  /** Steht nach dem Speichern drin und trägt die Bestätigung. */
  savedHour?: number;
  error?: string;
};

export async function setReminderHourAction(
  _state: ReminderTimeState,
  formData: FormData,
): Promise<ReminderTimeState> {
  const user = await requireUser();

  const parsed = hourSchema.safeParse(formData.get("hour"));
  if (!parsed.success) {
    return { error: "Diese Uhrzeit gibt es in der Auswahl nicht." };
  }

  const hour = parsed.data;

  await db
    .update(users)
    .set({ reminderHour: hour })
    .where(eq(users.id, user.id));

  revalidatePath("/einstellungen");

  return { savedHour: hour };
}
