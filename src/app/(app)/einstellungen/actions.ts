"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { moveOffFreeDays } from "@/lib/exams";
import { formErrors, type FieldErrors } from "@/lib/form-errors";
import {
  createFreePeriod,
  deleteFreePeriod,
  freeLabel,
  freePeriodInputSchema,
} from "@/lib/free-days";
import { revokeConnection } from "@/lib/oauth";
import { neuPlanen } from "@/recall/items";
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
 * Trennt die Verbindung zu einem Programm.
 *
 * Ab dem Zeitpunkt gilt sein Zugriffs-Token nicht mehr — nicht erst nach
 * Ablauf, sondern beim nächsten Aufruf. Beim Erneuern bekommt es
 * „invalid_grant", und die Claude-App fragt dann wieder nach Zustimmung: der
 * Nutzer sieht also, dass die Verbindung wirklich weg ist, statt sie
 * stillschweigend wiederzubekommen.
 *
 * Ohne Erfolg wird trotzdem nur aufgefrischt und nicht gemeldet. Es gibt genau
 * einen Fall, in dem `revokeConnection()` falsch zurückgibt — die Verbindung
 * ist schon getrennt —, und dafür ist die Liste, die danach ohne sie dasteht,
 * die richtige Antwort.
 */
export async function revokeConnectionAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const id = formData.get("id");
  if (typeof id !== "string") return;

  await revokeConnection(user.id, id);

  revalidatePath("/einstellungen");
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

type FreePeriodField = "kind" | "title" | "startsOn" | "endsOn";

export type FreePeriodState = {
  message?: string;
  errors?: FieldErrors<FreePeriodField>;
  /**
   * Was abgeschickt wurde, bei einem Fehler. Das Formular wird beim Abschicken
   * neu aufgebaut; was es danach noch zeigt, muss von hier kommen.
   */
  values?: { startsOn: string; endsOn: string };
  /** Steht nach dem Speichern drin und trägt die Bestätigung. */
  saved?: { label: string; movedExams: number };
};

/**
 * Ferien oder Klassenfahrt eintragen — und danach die Pläne von den freien
 * Tagen räumen: die Lernblöcke der Klausuren und die Termine im Abruf.
 */
export async function createFreePeriodAction(
  _state: FreePeriodState,
  formData: FormData,
): Promise<FreePeriodState> {
  const user = await requireUser();

  const parsed = freePeriodInputSchema.safeParse({
    kind: formData.get("kind"),
    title: formData.get("title") ?? "",
    startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"),
  });

  if (!parsed.success) {
    return {
      ...formErrors<FreePeriodField>(parsed.error.issues),
      values: {
        startsOn: String(formData.get("startsOn") ?? ""),
        endsOn: String(formData.get("endsOn") ?? ""),
      },
    };
  }

  await createFreePeriod(user.id, parsed.data);
  const movedExams = await replanAroundFreeDays(user.id);

  revalidatePath("/", "layout");

  return {
    saved: {
      label: freeLabel(parsed.data),
      movedExams,
    },
  };
}

/**
 * Einen Zeitraum wieder streichen. Die Lernblöcke wandern dabei nicht zurück —
 * ein Plan, der sich ohne Anlass bewegt, wäre schlimmer als ein freier Tag.
 * Der Abruf rechnet dagegen neu: seine Termine sind ohnehin nur ein Vorschlag
 * für den Abend.
 */
export async function deleteFreePeriodAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const id = formData.get("id");
  if (typeof id !== "string") return;

  if (await deleteFreePeriod(user.id, id)) {
    await replanRecall(user.id);
  }

  revalidatePath("/", "layout");
}

async function replanAroundFreeDays(userId: string): Promise<number> {
  const today = todayInBerlin();
  const moved = await moveOffFreeDays(userId, today);
  await replanRecall(userId);
  return moved;
}

/**
 * Der Abrufkern darf fehlen (scripts/abruf-rueckbau.sql) — dann bleibt es beim
 * Lernplan, und das Eintragen der Ferien scheitert nicht an einem Modul, das es
 * nicht mehr gibt.
 */
async function replanRecall(userId: string): Promise<void> {
  try {
    await neuPlanen(userId, todayInBerlin());
  } catch (error) {
    console.error("Abruf nicht neu geplant", error);
  }
}
