import { and, asc, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import {
  lessons,
  periods,
  subjects,
  type Lesson,
  type Period,
  type Subject,
  type Weekday,
} from "@/db/schema";
import { addDays, daysBetween, weekdayIndex } from "@/lib/dates";

/**
 * Stundenplan — das Raster, die Stunden darin und die Rechnung drumherum.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche. Der obere Teil
 * rechnet ohne Datenbank und ohne Systemuhr — "heute" kommt von außen,
 * dieselbe Eingabe ergibt immer dieselbe Ausgabe. Gerechnet wird über
 * @/lib/dates und damit über UTC-Mitternacht; sonst würde die Umstellung auf
 * Sommerzeit einen Wochentag verschieben.
 *
 * Jede Abfrage filtert zusätzlich nach userId, auch dort, wo die id schon
 * eindeutig wäre. So kann kein fremder Datensatz durchrutschen, egal welche id
 * in der Adresszeile steht.
 */

/** Eine Zeile des Stundenrasters, so wie das Formular sie liefert. */
export type PeriodRow = { number: number; startsAt: string; endsAt: string };

/**
 * Das Raster, mit dem ein neuer Plan startet: zehn Stunden mit den Pausen
 * eines typischen Gymnasiums — große Pause nach der 2., zweite große Pause
 * nach der 4., Mittagspause vor der 7. Stunde.
 *
 * Es ist nur die Vorgabe. Sobald es einmal in der Datenbank steht, gilt dort
 * das, was der Nutzer eingestellt hat (siehe `periods` in src/db/schema.ts).
 */
export const DEFAULT_PERIODS: readonly PeriodRow[] = [
  { number: 1, startsAt: "08:00", endsAt: "08:45" },
  { number: 2, startsAt: "08:50", endsAt: "09:35" },
  { number: 3, startsAt: "09:55", endsAt: "10:40" },
  { number: 4, startsAt: "10:45", endsAt: "11:30" },
  { number: 5, startsAt: "11:50", endsAt: "12:35" },
  { number: 6, startsAt: "12:40", endsAt: "13:25" },
  { number: 7, startsAt: "14:00", endsAt: "14:45" },
  { number: 8, startsAt: "14:50", endsAt: "15:35" },
  { number: 9, startsAt: "15:40", endsAt: "16:25" },
  { number: 10, startsAt: "16:30", endsAt: "17:15" },
];

/**
 * Die fünf Tage des Plans. Das Wochenende fehlt bewusst: ein Stundenplan mit
 * zwei leeren Spalten verschenkt auf dem Handy ein Drittel der Breite.
 */
export const WEEKDAYS: readonly {
  value: Weekday;
  short: string;
  long: string;
}[] = [
  { value: 1, short: "Mo", long: "Montag" },
  { value: 2, short: "Di", long: "Dienstag" },
  { value: 3, short: "Mi", long: "Mittwoch" },
  { value: 4, short: "Do", long: "Donnerstag" },
  { value: 5, short: "Fr", long: "Freitag" },
];

/**
 * Höher zählt keine Schule — fängt Unsinn ab, bevor er in der Datenbank steht.
 * Exportiert, damit Formular und Action nicht ihre eigene Zahl mitbringen.
 */
export const MAX_PERIOD = 12;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eine kaputte id aus der Adresszeile würde Postgres sonst mit einem Typfehler
 * quittieren — hier wird daraus ein sauberes "gibt es nicht".
 */
function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isPlanWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function isPeriodNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PERIOD;
}

/** 1 = Montag … 7 = Sonntag, gerechnet in UTC wie alles in @/lib/dates. */
export function weekdayOf(date: string): number {
  return weekdayIndex(date) + 1;
}

/** Schultag ist Montag bis Freitag — Ferien kennt die App (noch) nicht. */
export function isSchoolDay(date: string): boolean {
  return weekdayOf(date) <= 5;
}

/**
 * Die Kalenderwoche nach ISO 8601 — die Zahl über dem Stundenplan ("KW 37").
 *
 * Woche 1 ist die Woche mit dem ersten Donnerstag des Jahres. Deshalb wird
 * nicht das Datum selbst gezählt, sondern der Donnerstag seiner Woche: er
 * allein entscheidet, zu welchem Jahr die Woche gehört. Der 1. Januar kann so
 * in der 52. oder 53. Woche des Vorjahres liegen, der 29. Dezember schon in
 * der 1. des nächsten.
 */
export function isoWeekNumber(date: string): number {
  const thursday = addDays(date, 4 - weekdayOf(date));
  const firstOfYear = `${thursday.slice(0, 4)}-01-01`;

  return Math.floor(daysBetween(firstOfYear, thursday) / 7) + 1;
}

/**
 * Der nächste Tag **nach** `from`, an dem einer dieser Wochentage liegt.
 *
 * Grundlage für den Vorschlag "fällig zur nächsten Stunde": heute wurde die
 * Aufgabe aufgegeben, fällig ist sie beim nächsten Mal — also nie heute, auch
 * wenn das Fach heute stattfindet. Ohne Wochentage gibt es keinen Vorschlag.
 */
export function nextLessonDate(
  from: string,
  weekdays: number[],
): string | null {
  let best: number | null = null;

  for (const weekday of weekdays) {
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;

    const ahead = (weekday - weekdayOf(from) + 7) % 7;
    const days = ahead === 0 ? 7 : ahead;
    if (best === null || days < best) best = days;
  }

  return best === null ? null : addDays(from, best);
}

/** Ein Block im Plan: eine einzelne Stunde oder eine zusammengefasste Doppelstunde. */
export type LessonBlock<T> = { from: number; to: number; lesson: T };

/**
 * Fasst aufeinanderfolgende Stunden desselben Fachs zu einem Block zusammen.
 *
 * Im Modell ist eine Doppelstunde zwei Einträge (siehe `lessons` in
 * src/db/schema.ts) — im Plan soll sie als eine Kachel stehen. Eine Lücke im
 * Raster trennt, ein Fachwechsel trennt; drei Stunden am Stück ergeben einen
 * Block über drei.
 */
export function mergeDoubleLessons<
  T extends { period: number; subjectId: string },
>(lessons: T[]): LessonBlock<T>[] {
  const sorted = [...lessons].sort((a, b) => a.period - b.period);
  const blocks: LessonBlock<T>[] = [];

  for (const lesson of sorted) {
    const last = blocks[blocks.length - 1];

    if (
      last &&
      last.lesson.subjectId === lesson.subjectId &&
      last.to + 1 === lesson.period
    ) {
      last.to = lesson.period;
      continue;
    }

    blocks.push({ from: lesson.period, to: lesson.period, lesson });
  }

  return blocks;
}

/** "3. Stunde" oder "3.–4. Stunde" */
export function periodLabel(from: number, to: number): string {
  return from === to ? `${from}. Stunde` : `${from}.–${to}. Stunde`;
}

/**
 * Das Raster als Nachschlagekarte: Stundennummer → Zeile.
 *
 * Startseite, Dashboard und Tagesspur stellen alle dieselbe Frage — "wann
 * beginnt die dritte Stunde?" — und bauten sich dafür bisher jede ihre eigene
 * Karte. Eine Stunde ohne Zeile im Raster fehlt hier; sie hat keine Uhrzeit,
 * und eine zu erfinden wäre schlimmer, als keine zu zeigen.
 */
export function periodTimes<T extends { number: number }>(
  rows: readonly T[],
): Map<number, T> {
  return new Map(rows.map((row) => [row.number, row]));
}

/**
 * Steht im Raster noch unverändert die Vorgabe aus `DEFAULT_PERIODS`?
 *
 * `ensurePeriods` legt sie beim ersten Lesen an. Danach sieht das Raster aus
 * wie eine Angabe des Nutzers, ist aber geraten — deshalb fragen die
 * Stundenplan-Seiten hier nach, bevor sie die Zeiten als gesetzt hinstellen.
 * Verglichen werden nur die Uhrzeiten: die Nummern zieht `savePeriods` ohnehin
 * lückenlos auf 1…n.
 */
export function isDefaultPeriods(
  rows: readonly { startsAt: string; endsAt: string }[],
): boolean {
  return (
    rows.length === DEFAULT_PERIODS.length &&
    rows.every(
      (row, index) =>
        row.startsAt === DEFAULT_PERIODS[index].startsAt &&
        row.endsAt === DEFAULT_PERIODS[index].endsAt,
    )
  );
}

/**
 * Eine Stunde mit dem, was die Kachel vom Fach braucht. Der Raum kommt doppelt
 * vor: der der Stunde gewinnt, der des Fachs ist die Vorgabe.
 */
export type LessonWithSubject = Lesson & {
  subject: Pick<Subject, "id" | "name" | "short" | "color" | "room" | "teacher">;
};

/** Alles, was das Wochenraster zum Zeichnen braucht. */
export type WeekPlan = {
  periods: Period[];
  days: { weekday: Weekday; lessons: LessonWithSubject[] }[];
};

/**
 * Eine Stunde, so wie das Formular sie liefert. Welches Feld gemeint ist,
 * sagen Wochentag und Stunde — eine id steht nicht dabei, weil jedes Speichern
 * das Feld leert und neu füllt.
 */
export type LessonInput = {
  subjectId: string;
  weekday: number;
  period: number;
  room?: string | null;
  note?: string | null;
};

export async function listPeriods(userId: string): Promise<Period[]> {
  return db
    .select()
    .from(periods)
    .where(eq(periods.userId, userId))
    .orderBy(asc(periods.number));
}

/**
 * Das Raster dieses Nutzers, notfalls frisch aus `DEFAULT_PERIODS`.
 *
 * Ein leerer Stundenplan soll beim ersten Öffnen schon Zeiten zeigen, statt
 * erst eine Einrichtung zu verlangen. `onConflictDoNothing` deckt den Fall ab,
 * dass zwei Aufrufe gleichzeitig anlegen wollen — danach wird ohnehin gelesen,
 * was in der Datenbank steht.
 */
export async function ensurePeriods(userId: string): Promise<Period[]> {
  const existing = await listPeriods(userId);
  if (existing.length > 0) return existing;

  await db
    .insert(periods)
    .values(DEFAULT_PERIODS.map((row) => ({ ...row, userId })))
    .onConflictDoNothing();

  return listPeriods(userId);
}

/**
 * Ersetzt das Raster vollständig. Die Nummern werden dabei auf 1…n gezogen,
 * damit aus einer gelöschten Zeile keine Lücke im Plan wird.
 *
 * Eine leere Liste ändert nichts: ohne Raster gäbe es keinen Plan mehr, und
 * `ensurePeriods` würde beim nächsten Aufruf stillschweigend die Vorgabe
 * zurückholen — das sähe aus, als hätte das Speichern nicht funktioniert.
 */
/**
 * Wird geworfen, wenn das Raster unter eine Stunde gekürzt werden soll, in der
 * noch Unterricht steht. Trägt die betroffenen Nummern mit, damit die
 * Oberfläche sie benennen kann statt nur „geht nicht“ zu sagen.
 */
export class PeriodsInUseError extends Error {
  constructor(readonly numbers: number[]) {
    super("Diese Stunden stehen noch im Plan.");
    this.name = "PeriodsInUseError";
  }
}

export async function savePeriods(
  userId: string,
  rows: PeriodRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const values = rows.map((row, index) => {
    if (!TIME_PATTERN.test(row.startsAt) || !TIME_PATTERN.test(row.endsAt)) {
      throw new Error("Diese Uhrzeit gibt es nicht.");
    }

    return {
      userId,
      number: index + 1,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    };
  });

  if (values.length > MAX_PERIOD) {
    throw new Error(`Höchstens ${MAX_PERIOD} Stunden am Tag.`);
  }

  // Ein gekürztes Raster darf keine Stunde hinter sich lassen: sie wäre im
  // Wochenraster nicht mehr zu sehen und über /stundenplan/<tag>/<stunde>
  // nicht mehr zu erreichen — also auch nicht mehr zu löschen —, würde auf
  // der Startseite aber weiter mitgezählt. Lieber vorher nein sagen, als
  // ungefragt Unterricht zu löschen.
  const orphaned = await db
    .selectDistinct({ period: lessons.period })
    .from(lessons)
    .where(and(eq(lessons.userId, userId), gt(lessons.period, values.length)));

  if (orphaned.length > 0) {
    throw new PeriodsInUseError(
      orphaned.map((row) => row.period).sort((a, b) => a - b),
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(periods).where(eq(periods.userId, userId));
    await tx.insert(periods).values(values);
  });
}

/**
 * Der ganze Wochenplan, nach Wochentag und Stunde sortiert.
 *
 * Stunden abgewählter Fächer bleiben drin: eine eingetragene Stunde
 * verschwindet nicht, nur weil das Fach archiviert wurde — sonst hätte der
 * Plan plötzlich Löcher, die niemand eingetragen hat. Die Oberfläche kann sie
 * kennzeichnen, entfernen muss sie der Nutzer.
 */
export async function listLessons(
  userId: string,
): Promise<LessonWithSubject[]> {
  const rows = await db
    .select({ lesson: lessons, subject: subjectFields })
    .from(lessons)
    .innerJoin(
      subjects,
      and(eq(subjects.id, lessons.subjectId), eq(subjects.userId, userId)),
    )
    .where(eq(lessons.userId, userId))
    .orderBy(asc(lessons.weekday), asc(lessons.period));

  return rows.map((row) => ({ ...row.lesson, subject: row.subject }));
}

export async function lessonsForWeekday(
  userId: string,
  weekday: number,
): Promise<LessonWithSubject[]> {
  if (!isPlanWeekday(weekday)) return [];

  const rows = await db
    .select({ lesson: lessons, subject: subjectFields })
    .from(lessons)
    .innerJoin(
      subjects,
      and(eq(subjects.id, lessons.subjectId), eq(subjects.userId, userId)),
    )
    .where(and(eq(lessons.userId, userId), eq(lessons.weekday, weekday)))
    .orderBy(asc(lessons.period));

  return rows.map((row) => ({ ...row.lesson, subject: row.subject }));
}

/**
 * Raster und Stunden in einem Aufruf. `days` enthält immer alle fünf Tage,
 * auch die leeren — die Oberfläche zeichnet sonst mal fünf, mal drei Spalten.
 */
export async function loadWeek(userId: string): Promise<WeekPlan> {
  const [periodList, lessonList] = await Promise.all([
    ensurePeriods(userId),
    listLessons(userId),
  ]);

  return {
    periods: periodList,
    days: WEEKDAYS.map((day) => ({
      weekday: day.value,
      lessons: lessonList.filter((lesson) => lesson.weekday === day.value),
    })),
  };
}

/**
 * Legt eine Stunde an oder ändert sie.
 *
 * Ein Feld im Plan hat genau einen Inhalt — das sichert der eindeutige
 * Schlüssel `lessons_user_slot_key` zu. Wer ein belegtes Feld beschreibt, will
 * es ersetzen und nicht eine Fehlermeldung lesen: der bisherige Eintrag wird
 * deshalb vorher gelöscht, beides zusammen in einer Transaktion.
 */
export async function saveLesson(
  userId: string,
  input: LessonInput,
): Promise<void> {
  if (!isPlanWeekday(input.weekday) || !isPeriodNumber(input.period)) {
    throw new Error("Dieses Feld gibt es im Stundenplan nicht.");
  }

  if (!(await ownsSubject(userId, input.subjectId))) {
    throw new Error("Dieses Fach gibt es nicht.");
  }

  const values = {
    subjectId: input.subjectId,
    weekday: input.weekday,
    period: input.period,
    room: input.room ?? null,
    note: input.note ?? null,
  };

  await db.transaction(async (tx) => {
    await tx
      .delete(lessons)
      .where(
        and(
          eq(lessons.userId, userId),
          eq(lessons.weekday, values.weekday),
          eq(lessons.period, values.period),
        ),
      );
    await tx.insert(lessons).values({ ...values, userId });
  });
}

/** Ein Feld im Plan leeren, ohne dessen id zu kennen. */
export async function clearSlot(
  userId: string,
  weekday: number,
  period: number,
): Promise<void> {
  if (!isPlanWeekday(weekday) || !isPeriodNumber(period)) return;

  await db
    .delete(lessons)
    .where(
      and(
        eq(lessons.userId, userId),
        eq(lessons.weekday, weekday),
        eq(lessons.period, period),
      ),
    );
}

/** Die Fachspalten, die eine Stundenplan-Kachel braucht — mehr wird nicht geladen. */
const subjectFields = {
  id: subjects.id,
  name: subjects.name,
  short: subjects.short,
  color: subjects.color,
  room: subjects.room,
  /** Steht in der Tagesspur hinter dem Raum: "A203 · Fr. Bergmann". */
  teacher: subjects.teacher,
};

async function ownsSubject(userId: string, subjectId: string): Promise<boolean> {
  if (!isId(subjectId)) return false;

  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, subjectId)))
    .limit(1);

  return subject !== undefined;
}
