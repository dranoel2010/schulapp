import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { isCalendarDate } from "@/lib/dates";
import {
  homework,
  subjects,
  type Homework,
  type Subject,
} from "@/db/schema";

/**
 * Hausaufgaben — Datenzugriff und die Zahlen, die die Startseite zeigt.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche. Wie eine
 * Fälligkeit beschriftet und gefärbt wird, steht in @/lib/due-label — die
 * Liste ist flach und braucht deshalb keine Einteilung in Gruppen.
 *
 * Jede Abfrage filtert zusätzlich nach userId, auch dort, wo die id schon
 * eindeutig wäre. So kann kein fremder Datensatz durchrutschen, egal welche id
 * in der Adresszeile steht.
 *
 * Erledigt steht in der Datenbank als Zeitpunkt `doneAt` und nicht als
 * Ja/Nein; für die Anzeige wird daraus einmal an dieser Stelle ein `done`.
 */

/** Eine Hausaufgabe mit dem, was die Liste vom Fach braucht. */
export type HomeworkItem = Homework & {
  subject: Pick<Subject, "id" | "name" | "short" | "color">;
  /** Abgeleitet aus `doneAt` — leer heißt offen. */
  done: boolean;
};

/** Eine Hausaufgabe, so wie das Formular sie liefert. */
export type HomeworkInput = {
  subjectId: string;
  title: string;
  details?: string | null;
  dueDate: string;
};

/**
 * Das Prüfschema einer Hausaufgabe — hier und nicht in den Server Actions,
 * damit jede Tür dieselbe benutzt: das Formular, und später ein Tool.
 */
export const homeworkInputSchema = z.object({
  subjectId: z.uuid("Zu welchem Fach gehört die Aufgabe?"),
  title: z
    .string("Was ist aufgegeben?")
    .trim()
    .min(1, "Was ist aufgegeben?")
    .max(120, "Der Titel ist zu lang — höchstens 120 Zeichen."),
  dueDate: z
    .string("Wann ist die Aufgabe fällig?")
    .min(1, "Wann ist die Aufgabe fällig?")
    .refine(isCalendarDate, "Diesen Tag gibt es nicht."),
  // Leere Eingabe soll als NULL in der Datenbank landen, nicht als "".
  details: z
    .string()
    .trim()
    .max(2000, "Die Notiz ist zu lang — höchstens 2000 Zeichen.")
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eine kaputte id aus der Adresszeile würde Postgres sonst mit einem Typfehler
 * quittieren — hier wird daraus ein sauberes "gibt es nicht".
 */
function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function listHomework(
  userId: string,
  options?: { includeDone?: boolean },
): Promise<HomeworkItem[]> {
  const rows = await db
    .select({ homework, subject: subjectFields })
    .from(homework)
    .innerJoin(
      subjects,
      and(eq(subjects.id, homework.subjectId), eq(subjects.userId, userId)),
    )
    .where(
      options?.includeDone
        ? eq(homework.userId, userId)
        : and(eq(homework.userId, userId), sql`${homework.doneAt} is null`),
    )
    .orderBy(asc(homework.dueDate), asc(homework.createdAt));

  const items = rows.map(toItem);

  // Offenes zuerst nach Fälligkeit — das kommt schon so aus der Abfrage.
  // Erledigtes hängt hinten dran, das zuletzt Abgehakte zuerst: was gerade
  // fertig wurde, will man notfalls schnell wieder aufmachen.
  const open = items.filter((item) => !item.done);
  const done = items
    .filter((item) => item.done)
    .sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0));

  return [...open, ...done];
}

/**
 * Die Zahlen für die Kachel auf der Startseite — eine Abfrage statt drei.
 * `overdue` und `dueToday` sind Teilmengen von `open`.
 */
export async function openHomeworkCount(
  userId: string,
  today: string,
): Promise<{ open: number; overdue: number; dueToday: number }> {
  if (!isCalendarDate(today)) return { open: 0, overdue: 0, dueToday: 0 };

  const [row] = await db
    .select({
      open: sql<number>`cast(count(*) filter (where ${homework.doneAt} is null) as int)`,
      overdue: sql<number>`cast(count(*) filter (where ${homework.doneAt} is null and ${homework.dueDate} < ${today}::date) as int)`,
      dueToday: sql<number>`cast(count(*) filter (where ${homework.doneAt} is null and ${homework.dueDate} = ${today}::date) as int)`,
    })
    .from(homework)
    .where(eq(homework.userId, userId));

  return {
    open: Number(row?.open ?? 0),
    overdue: Number(row?.overdue ?? 0),
    dueToday: Number(row?.dueToday ?? 0),
  };
}

/**
 * Alles, was in diesem Zeitraum fällig ist — offen wie erledigt. Die Tagesspur
 * zeigt auch das Abgehakte, sonst sähe ein erledigter Tag leer aus.
 */
export async function homeworkForRange(
  userId: string,
  from: string,
  to: string,
): Promise<HomeworkItem[]> {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return [];

  const rows = await db
    .select({ homework, subject: subjectFields })
    .from(homework)
    .innerJoin(
      subjects,
      and(eq(subjects.id, homework.subjectId), eq(subjects.userId, userId)),
    )
    .where(
      and(
        eq(homework.userId, userId),
        gte(homework.dueDate, from),
        lte(homework.dueDate, to),
      ),
    )
    .orderBy(asc(homework.dueDate), asc(homework.createdAt));

  return rows.map(toItem);
}

export async function createHomework(
  userId: string,
  input: HomeworkInput,
): Promise<void> {
  const values = await checkedValues(userId, input);

  await db.insert(homework).values({ ...values, userId });
}

export async function updateHomework(
  userId: string,
  id: string,
  input: HomeworkInput,
): Promise<void> {
  if (!isId(id)) return;

  const values = await checkedValues(userId, input);

  await db
    .update(homework)
    .set(values)
    .where(and(eq(homework.userId, userId), eq(homework.id, id)));
}

/**
 * Abhaken und wieder aufmachen. Der Zeitpunkt ist der jetzige — daraus liest
 * die Startseite später ab, was heute geschafft wurde.
 */
export async function setHomeworkDone(
  userId: string,
  id: string,
  done: boolean,
): Promise<void> {
  if (!isId(id)) return;

  await db
    .update(homework)
    .set({ doneAt: done ? new Date() : null })
    .where(and(eq(homework.userId, userId), eq(homework.id, id)));
}

export async function deleteHomework(
  userId: string,
  id: string,
): Promise<void> {
  if (!isId(id)) return;

  await db
    .delete(homework)
    .where(and(eq(homework.userId, userId), eq(homework.id, id)));
}

export async function getHomework(
  userId: string,
  id: string,
): Promise<HomeworkItem | null> {
  if (!isId(id)) return null;

  const [row] = await db
    .select({ homework, subject: subjectFields })
    .from(homework)
    .innerJoin(
      subjects,
      and(eq(subjects.id, homework.subjectId), eq(subjects.userId, userId)),
    )
    .where(and(eq(homework.userId, userId), eq(homework.id, id)))
    .limit(1);

  return row ? toItem(row) : null;
}

/** Die Fachspalten, die eine Aufgabe in der Liste braucht — mehr wird nicht geladen. */
const subjectFields = {
  id: subjects.id,
  name: subjects.name,
  short: subjects.short,
  color: subjects.color,
};

type Row = {
  homework: Homework;
  subject: Pick<Subject, "id" | "name" | "short" | "color">;
};

function toItem(row: Row): HomeworkItem {
  return {
    ...row.homework,
    subject: row.subject,
    done: row.homework.doneAt !== null,
  };
}

/**
 * Gemeinsame Prüfung von Anlegen und Ändern: das Fach muss dem Nutzer gehören,
 * der Titel darf nicht leer und das Datum muss ein echter Tag sein. Leere
 * Beschreibungen landen als NULL in der Datenbank, nicht als "".
 */
async function checkedValues(
  userId: string,
  input: HomeworkInput,
): Promise<{
  subjectId: string;
  title: string;
  details: string | null;
  dueDate: string;
}> {
  if (!(await ownsSubject(userId, input.subjectId))) {
    throw new Error("Dieses Fach gibt es nicht.");
  }

  const title = input.title.trim();
  if (title.length === 0) {
    throw new Error("Was ist aufgegeben?");
  }

  if (!isCalendarDate(input.dueDate)) {
    throw new Error("Dieses Datum gibt es nicht.");
  }

  const details = input.details?.trim();

  return {
    subjectId: input.subjectId,
    title,
    details: details && details.length > 0 ? details : null,
    dueDate: input.dueDate,
  };
}

async function ownsSubject(userId: string, subjectId: string): Promise<boolean> {
  if (!isId(subjectId)) return false;

  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, subjectId)))
    .limit(1);

  return subject !== undefined;
}
