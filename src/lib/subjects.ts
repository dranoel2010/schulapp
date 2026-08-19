import { and, asc, eq, max } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { subjects, type Subject } from "@/db/schema";
import { SUBJECT_COLOR_KEYS } from "@/lib/colors";

/**
 * Fächer — Validierung und Datenzugriff an einer Stelle.
 *
 * Jede Abfrage filtert zusätzlich nach userId. Es gibt zwar nur einen Nutzer,
 * aber sobald Noten und Klausuren dazukommen, ist das die Gewohnheit, die
 * verhindert, dass fremde Daten durchrutschen.
 */

/** Leere Eingabe soll als NULL in der Datenbank landen, nicht als "". */
function optionalText(maxLength: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(maxLength, tooLong)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null));
}

export const subjectInputSchema = z.object({
  name: z
    .string("Wie heißt das Fach?")
    .trim()
    .min(1, "Wie heißt das Fach?")
    .max(60, "Der Name ist zu lang — höchstens 60 Zeichen."),
  short: z
    .string("Ein Kürzel fehlt noch.")
    .trim()
    .min(1, "Ein Kürzel fehlt noch.")
    .max(4, "Höchstens 4 Zeichen, sonst passt es in keine Stundenplan-Kachel."),
  color: z.enum(SUBJECT_COLOR_KEYS, "Diese Farbe kennt die App nicht."),
  teacher: optionalText(60, "Höchstens 60 Zeichen."),
  room: optionalText(20, "Höchstens 20 Zeichen."),
  weightWritten: z.coerce
    .number("Die Gewichtung ist keine Zahl.")
    .int("Die Gewichtung muss eine ganze Zahl sein.")
    .min(0, "Die Gewichtung liegt zwischen 0 und 100.")
    .max(100, "Die Gewichtung liegt zwischen 0 und 100."),
});

export type SubjectInput = z.infer<typeof subjectInputSchema>;

/** Fehler pro Feld, so wie das Formular sie erwartet. */
export type SubjectFieldErrors = Partial<Record<keyof SubjectInput, string>>;

/** Rückgabe der Server Actions an useActionState. */
export type SubjectFormState = {
  /** Hinweis über dem Formular, wenn es nicht an einem einzelnen Feld liegt. */
  message?: string;
  errors?: SubjectFieldErrors;
};

/**
 * Eine kaputte id aus der Adresszeile würde Postgres sonst mit einem
 * Typfehler quittieren — hier wird daraus ein sauberes "gibt es nicht".
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function listSubjects(
  userId: string,
  options?: { includeArchived?: boolean },
): Promise<Subject[]> {
  const where = options?.includeArchived
    ? eq(subjects.userId, userId)
    : and(eq(subjects.userId, userId), eq(subjects.archived, false));

  return db
    .select()
    .from(subjects)
    .where(where)
    .orderBy(asc(subjects.sortOrder), asc(subjects.name));
}

export async function getSubject(
  userId: string,
  id: string,
): Promise<Subject | null> {
  if (!isId(id)) return null;

  const [subject] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, id)))
    .limit(1);

  return subject ?? null;
}

export async function createSubject(
  userId: string,
  input: SubjectInput,
): Promise<Subject> {
  const [subject] = await db
    .insert(subjects)
    .values({ ...input, userId, sortOrder: await nextSortOrder(userId) })
    .returning();

  if (!subject) {
    throw new Error("Das Fach konnte nicht gespeichert werden.");
  }

  return subject;
}

export async function updateSubject(
  userId: string,
  id: string,
  input: SubjectInput,
): Promise<void> {
  if (!isId(id)) return;

  await db
    .update(subjects)
    .set(input)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, id)));
}

export async function deleteSubject(
  userId: string,
  id: string,
): Promise<void> {
  if (!isId(id)) return;

  await db
    .delete(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, id)));
}

export async function setArchived(
  userId: string,
  id: string,
  archived: boolean,
): Promise<void> {
  if (!isId(id)) return;

  await db
    .update(subjects)
    .set({ archived })
    .where(and(eq(subjects.userId, userId), eq(subjects.id, id)));
}

/** Neue Fächer hängen sich hinten an die Liste an. */
async function nextSortOrder(userId: string): Promise<number> {
  const [row] = await db
    .select({ highest: max(subjects.sortOrder) })
    .from(subjects)
    .where(eq(subjects.userId, userId));

  const highest = row?.highest;
  return highest === null || highest === undefined ? 0 : Number(highest) + 1;
}
