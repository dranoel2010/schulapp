import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { freePeriods, type FreePeriod } from "@/db/schema";
import { addDays, daysBetween, isCalendarDate, weekdayIndex } from "@/lib/dates";

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
 * Woher sie kommen: Bis zum 12.10.2026 nur von Hand. Seitdem legt der Abruf
 * bei IServ Ferien und unterrichtsfreie Tage selbst an (@/lib/iserv/ferien,
 * Spalte `quelle = 'iserv'`); die Seite zum Eintragen gibt es seit Modell 23
 * nicht mehr. Von Hand eingetragene Zeilen (`quelle` leer) bleiben gültig und
 * werden vom Abgleich nie angefasst. Wo die App einen freien Tag zeigt, sagt
 * sie mit `freiQuelleText()`, woher er kommt.
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

/** Woher ein freier Zeitraum kommt, als kurzer Zusatz: „aus IServ“ oder „von Hand eingetragen“. */
export function freiQuelleText(period: { quelle?: string | null }): string {
  return period.quelle === "iserv" ? "aus IServ" : "von Hand eingetragen";
}

/**
 * Die Zeilen, die als Balken in den Google Kalender gehen — dieselben Ferien
 * genau einmal.
 *
 * Bis zum 12.10.2026 trug der Mensch die Ferien von Hand ein; seitdem legt
 * der Abgleich mit IServ sie selbst an (@/lib/iserv/ferien) und fasst eine
 * von Hand eingetragene Zeile nie an. Stehen dieselben Herbstferien also
 * einmal von Hand und einmal aus IServ da, bleiben in der App beide (Lernplan
 * und Abruf nehmen ohnehin die Vereinigung der Tage), in Google aber nur
 * eine:
 *
 *   1. Eine von Hand eingetragene Ferien- oder Frei-Zeile, deren Tage eine
 *      IServ-Zeile abdeckt, fällt weg — IServ hat den lesbaren Namen und die
 *      richtigen Tage. Bei gleichen Tagen gewinnt IServ.
 *   2. Eine IServ-Zeile, deren Tage eine (übrig gebliebene) von Hand
 *      eingetragene Ferien- oder Frei-Zeile abdeckt, fällt weg.
 *
 * „Abdecken“ zählt Samstag und Sonntag am Rand nicht mit: Von Hand standen
 * Herbstferien oft Montag bis Sonntag da, IServ meldet Samstag bis Samstag —
 * das sind dieselben Ferien, und die Seite, auf der man die alte Hand-Zeile
 * löschen könnte, gibt es seit Modell 23 nicht mehr. Ein Wochenende am Rand
 * ist ohnehin schulfrei; es fehlt im Kalender also kein Schultag.
 *
 * Eine Klassenfahrt bleibt immer stehen und verdeckt nichts. Überschneiden
 * sich zwei Zeilen an Werktagen nur teilweise, bleiben beide: Sonst fehlten
 * Tage im Kalender.
 */
export function fuerKalender<
  T extends Pick<FreePeriod, "id" | "kind" | "startsOn" | "endsOn"> & { quelle?: string | null },
>(periods: readonly T[]): T[] {
  const ferienArtig = (p: T) => p.kind === "ferien" || p.kind === "frei";
  const deckt = (aussen: T, innen: T) => {
    const kern = ohneWochenendeAmRand(innen.startsOn, innen.endsOn);
    return aussen.startsOn <= kern.startsOn && kern.endsOn <= aussen.endsOn;
  };

  const iserv = periods.filter((p) => p.quelle === "iserv");
  const hand = periods.filter(
    (p) => p.quelle !== "iserv" && !(ferienArtig(p) && iserv.some((i) => deckt(i, p))),
  );
  const handFerien = hand.filter(ferienArtig);
  const iservBleibt = new Set(
    iserv.filter((i) => !handFerien.some((h) => deckt(h, i))).map((i) => i.id),
  );
  const handBleibt = new Set(hand.map((h) => h.id));

  return periods.filter((p) => (p.quelle === "iserv" ? iservBleibt.has(p.id) : handBleibt.has(p.id)));
}

/**
 * Der Zeitraum ohne Samstage und Sonntage am Anfang und am Ende. Liegt er
 * ganz am Wochenende, bleibt er, wie er ist.
 */
function ohneWochenendeAmRand(startsOn: string, endsOn: string): { startsOn: string; endsOn: string } {
  let von = startsOn;
  let bis = endsOn;
  while (von <= bis && weekdayIndex(von) >= 5) von = addDays(von, 1);
  while (bis >= von && weekdayIndex(bis) >= 5) bis = addDays(bis, -1);
  return von <= bis ? { startsOn: von, endsOn: bis } : { startsOn, endsOn };
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
      .max(60, "Der Name ist zu lang. Höchstens 60 Zeichen.")
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

/**
 * ALLE Zeiträume, auch die vergangenen, der früheste zuerst — für den Google
 * Kalender (@/lib/calendar/sources).
 *
 * Es gibt sie neben `listFreePeriods()`, weil die zweite Frage eine andere
 * ist. Die Einstellungen und der Lernplan wollen wissen, was noch kommt; der
 * Abgleich mit Google will wissen, was es gibt. Nähme er die gefilterte Liste,
 * sähen die Herbstferien am Tag nach ihrem Ende aus wie gelöscht, und die App
 * nähme sie aus dem Kalender — eine Abwesenheit, die keine ist.
 */
export async function listAllFreePeriods(userId: string): Promise<FreePeriod[]> {
  return db
    .select()
    .from(freePeriods)
    .where(eq(freePeriods.userId, userId))
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
