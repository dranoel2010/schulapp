import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { freePeriods, type FreePeriod } from "@/db/schema";
import { addDays, daysBetween, isCalendarDate } from "@/lib/dates";

/**
 * Freie Tage — Ferien, Klassenfahrt und was sonst ohne Schule ist.
 *
 * Bis zum 4.10.2026 kannte die App keinen davon: jeder Tag von Montag bis
 * Freitag war ein Schultag, und der Lernplan legte Blöcke mitten in die
 * Klassenfahrt. Die Stellen, die solche Tage auslassen können, gab es schon —
 * `excludedDates` im Lernplan, `sperrtage` im Abruf —, nur gefüllt hat sie
 * niemand. Diese Datei füllt sie.
 *
 * Frei heißt ganz frei: kein Unterricht, keine Lernblöcke, kein Abruf, keine
 * Erinnerung. Eine Unterscheidung „Ferien, aber gelernt wird trotzdem" gibt es
 * bewusst nicht.
 *
 * Eingetragen wird von Hand. Sechs Ferien und eine Klassenfahrt im Jahr sind
 * schneller getippt, als eine Online-Quelle für das richtige Bundesland
 * eingebunden und aktuell gehalten ist.
 */

export const FREE_KINDS = ["ferien", "klassenfahrt", "frei"] as const;
export type FreeKind = (typeof FREE_KINDS)[number];

export const FREE_KIND_LABELS: Record<FreeKind, string> = {
  ferien: "Ferien",
  klassenfahrt: "Klassenfahrt",
  frei: "Schulfrei",
};

/**
 * Sommerferien sind sechs Wochen lang. Was über ein Vierteljahr geht, ist ein
 * Tippfehler im Jahr — und der würde sonst den Lernplan bis 2062 leerräumen.
 */
export const MAX_FREE_DAYS = 90;

/** Nur das, was die Rechnung braucht — Tests müssen keine Zeile bauen. */
export type FreeRange = Pick<FreePeriod, "kind" | "title" | "startsOn" | "endsOn">;

/** Der Name, unter dem der Zeitraum angezeigt wird: "Herbstferien", sonst die Art. */
export function freeLabel(period: {
  kind: string;
  title?: string | null;
}): string {
  if (period.title) return period.title;
  return FREE_KIND_LABELS[period.kind as FreeKind] ?? "Schulfrei";
}

/** Der Zeitraum, in den der Tag fällt — beide Enden zählen mit. */
export function freePeriodOn<T extends FreeRange>(
  periods: readonly T[],
  date: string,
): T | null {
  return (
    periods.find(
      (period) => period.startsOn <= date && date <= period.endsOn,
    ) ?? null
  );
}

/**
 * Alle freien Tage als Liste "YYYY-MM-DD" — die Form, die `excludedDates` und
 * `sperrtage` verlangen. Mit `from` fällt weg, was davor liegt.
 */
export function freeDates(
  periods: readonly FreeRange[],
  from?: string,
): string[] {
  const dates = new Set<string>();

  for (const period of periods) {
    const start =
      from !== undefined && period.startsOn < from ? from : period.startsOn;
    const span = daysBetween(start, period.endsOn);

    for (let offset = 0; offset <= span; offset += 1) {
      dates.add(addDays(start, offset));
    }
  }

  return [...dates].sort();
}

/** Das Prüfschema, so wie das Formular den Zeitraum liefert. */
export const freePeriodInputSchema = z
  .object({
    kind: z.enum(FREE_KINDS, "Was für freie Tage sind es?"),
    title: z
      .string()
      .trim()
      .max(60, "Der Name ist zu lang — höchstens 60 Zeichen.")
      .transform((value) => (value === "" ? null : value))
      .nullish(),
    startsOn: z
      .string("Ab wann ist frei?")
      .min(1, "Ab wann ist frei?")
      .refine(isCalendarDate, "Diesen Tag gibt es nicht."),
    endsOn: z
      .string("Bis wann ist frei?")
      .min(1, "Bis wann ist frei?")
      .refine(isCalendarDate, "Diesen Tag gibt es nicht."),
  })
  .refine((input) => input.startsOn <= input.endsOn, {
    path: ["endsOn"],
    message: "Das Ende liegt vor dem Anfang.",
  })
  .refine(
    (input) => daysBetween(input.startsOn, input.endsOn) < MAX_FREE_DAYS,
    {
      path: ["endsOn"],
      message: `Länger als ${MAX_FREE_DAYS} Tage? Das sieht nach einem Tippfehler im Jahr aus.`,
    },
  );

export type FreePeriodInput = z.infer<typeof freePeriodInputSchema>;

/** Alle Zeiträume, die heute oder später noch gelten, der früheste zuerst. */
export async function listFreePeriods(
  userId: string,
  today: string,
): Promise<FreePeriod[]> {
  return db
    .select()
    .from(freePeriods)
    .where(and(eq(freePeriods.userId, userId), gte(freePeriods.endsOn, today)))
    .orderBy(asc(freePeriods.startsOn));
}

/** Der Zeitraum, in den heute fällt, oder nichts. */
export async function freePeriodToday(
  userId: string,
  today: string,
): Promise<FreePeriod | null> {
  return freePeriodOn(await listFreePeriods(userId, today), today);
}

/** Die freien Tage ab `from` — für Lernplan und Abruf. */
export async function freeDatesFrom(
  userId: string,
  from: string,
): Promise<string[]> {
  return freeDates(await listFreePeriods(userId, from), from);
}

export async function createFreePeriod(
  userId: string,
  input: FreePeriodInput,
): Promise<void> {
  await db.insert(freePeriods).values({
    userId,
    kind: input.kind,
    title: input.title ?? null,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
  });
}

/** Falsch zurück, wenn es den Zeitraum (für diesen Nutzer) nicht gibt. */
export async function deleteFreePeriod(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;

  const removed = await db
    .delete(freePeriods)
    .where(and(eq(freePeriods.id, id), eq(freePeriods.userId, userId)))
    .returning({ id: freePeriods.id });

  return removed.length > 0;
}
