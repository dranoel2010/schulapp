"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { revokeTokens } from "@/lib/oauth";
import { isThemePreference, THEME_COOKIE, THEME_MAX_AGE } from "@/lib/theme";

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

/**
 * Hell, dunkel oder dem Gerät überlassen.
 *
 * Die Wahl landet in einem Cookie, nicht in der Datenbank — dann liest der
 * Server sie beim Ausliefern und die Seite erscheint sofort richtig. Und sie
 * gilt pro Gerät: das Handy darf abends dunkel sein, der Laptop hell bleiben.
 *
 * revalidatePath mit "layout" ist nötig, weil das data-theme im Wurzel-Layout
 * hängt — ohne das bliebe die alte Farbe stehen, bis etwas anderes die Seite
 * neu rendert.
 */
export async function setThemeAction(formData: FormData): Promise<void> {
  await requireUser();

  const value = formData.get("theme");
  if (!isThemePreference(value)) return;

  const store = await cookies();
  store.set(THEME_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: THEME_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath("/", "layout");
}

/**
 * Nimmt allen Agenten den Zugriff wieder ab.
 *
 * Gelöscht werden die Token, nicht der Client: der bleibt angemeldet und darf
 * jederzeit wieder fragen — aber er muss dann wieder durch die Zustimmung.
 * Genau das ist der Widerruf, der auf der Zustimmungsseite versprochen wird.
 *
 * Ein Zugriffstoken gilt danach noch bis zu einer Stunde? Nein: geprüft wird
 * bei jedem Aufruf gegen die Tabelle, und die Zeile ist weg. Der Widerruf
 * greift mit dem nächsten Aufruf.
 */
export async function revokeAgentAccessAction(): Promise<void> {
  const user = await requireUser();

  await revokeTokens(user.id);

  revalidatePath("/einstellungen");
}
