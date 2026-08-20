import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { isCalendarDate } from "@/lib/dates";
import {
  grades,
  subjects,
  type Grade,
  type GradeKind,
  type Subject,
} from "@/db/schema";
import {
  isGradeValue,
  overallAverage,
  subjectAverage,
  weightedAverage,
  type GradeEntry,
} from "@/lib/grade-scale";

/**
 * Noten — Datenzugriff und die Schnitte, die Fachseite und Startseite zeigen.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche. Gerechnet wird
 * ausschließlich in @/lib/grade-scale. Welche Werte es gibt, wie sie heißen
 * und wie sich aus ihnen ein Schnitt bildet, weiß diese Datei nicht — sie lädt
 * Zeilen und reicht sie weiter. So bleibt die Rechnung prüfbar, ohne dass ein
 * Test eine Datenbank braucht.
 *
 * Der Wert einer Note steht in Zehnteln (7 = 1+, 10 = 1, 13 = 1−, … 60 = 6);
 * die Datenbank kennt nur diese Zahl. Wie schriftlich und mündlich zueinander
 * stehen, hängt am Fach (`subjects.weightWritten`) und nicht an der einzelnen
 * Note — deshalb wird ein Fachschnitt immer zusammen mit seinem Fach gebildet.
 *
 * Jede Abfrage filtert zusätzlich nach userId, auch dort, wo die id schon
 * eindeutig wäre. So kann kein fremder Datensatz durchrutschen, egal welche id
 * in der Adresszeile steht.
 */

/** Eine Note mit dem, was die Liste vom Fach braucht. */
export type GradeItem = Grade & {
  subject: Pick<Subject, "id" | "name" | "short" | "color">;
};

/** Eine Note, so wie das Formular sie liefert. */
export type GradeInput = {
  subjectId: string;
  value: number;
  kind: GradeKind;
  weight: number;
  date: string;
  title?: string | null;
};

/** Ein Fach mit seinen Noten und seinen Schnitten. */
export type SubjectGrades = {
  subject: Subject;
  /** Die jüngste zuerst */
  grades: GradeItem[];
  /** Fachschnitt nach der Gewichtung des Fachs; null ohne Noten */
  average: number | null;
  /** Die beiden Töpfe einzeln — die Fachseite zeigt sie nebeneinander */
  written: number | null;
  oral: number | null;
};

/** Die Zahlen für Kachel und Dashboard — in einem Rutsch geladen. */
export type GradeSummary = {
  /** Gesamtschnitt über die nicht archivierten Fächer mit Noten; null ohne Noten */
  overall: number | null;
  /** Wie viele Noten insgesamt eingetragen sind */
  gradeCount: number;
  /** Wie viele Fächer eine Note haben */
  gradedSubjects: number;
  /** Die zuletzt eingetragene Note; null, wenn es keine gibt */
  latest: GradeItem | null;
  /** Je Fach mit Noten der Schnitt, das beste Fach zuerst */
  perSubject: {
    subject: Pick<Subject, "id" | "name" | "short" | "color">;
    average: number;
    count: number;
  }[];
};

/** Mehr als das ist nicht zu vergeben — eine Grenze braucht es trotzdem. */
const MAX_WEIGHT = 5;

/** Länger als das wäre keine Überschrift mehr, sondern eine Notiz. */
const MAX_TITLE_LENGTH = 120;

/**
 * Das Prüfschema einer Note — hier und nicht in den Server Actions, damit jede
 * Tür dieselbe benutzt. MAX_WEIGHT stand vorher zweimal im Baum: einmal hier
 * für die Ausnahme, einmal dort für die Feldmeldung.
 */
export const gradeInputSchema = z.object({
  subjectId: z.uuid("Zu welchem Fach gehört die Note?"),
  // Die leere Vorauswahl kommt als "" an und wird beim Umwandeln zur 0 — auch
  // die liegt auf keiner Stufe der Skala. Beide Fälle bekommen dieselbe Frage
  // gestellt, denn beide Male fehlt schlicht die Note.
  value: z.coerce
    .number("Welche Note war es?")
    .refine(isGradeValue, "Welche Note war es?"),
  kind: z.enum(["schriftlich", "muendlich"], "Schriftlich oder mündlich?"),
  weight: z.coerce
    .number("Wie stark zählt die Note?")
    .int("Das Gewicht ist eine ganze Zahl.")
    .min(1, "Einfach zählt sie mindestens.")
    .max(MAX_WEIGHT, "Mehr als fünffach zählt keine Note."),
  date: z
    .string("Wann gab es die Note?")
    .min(1, "Wann gab es die Note?")
    .refine(isCalendarDate, "Diesen Tag gibt es nicht."),
  // Leere Eingabe soll als NULL in der Datenbank landen, nicht als "".
  title: z
    .string()
    .trim()
    .max(120, "Das ist zu lang — höchstens 120 Zeichen.")
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

/** Alle Noten, die jüngste zuerst. */
export async function listGrades(userId: string): Promise<GradeItem[]> {
  const rows = await db
    .select({ grade: grades, subject: subjectFields })
    .from(grades)
    .innerJoin(
      subjects,
      and(eq(subjects.id, grades.subjectId), eq(subjects.userId, userId)),
    )
    .where(eq(grades.userId, userId))
    .orderBy(desc(grades.date), desc(grades.createdAt));

  return rows.map(toItem);
}

export async function getGrade(
  userId: string,
  id: string,
): Promise<GradeItem | null> {
  if (!isId(id)) return null;

  const [row] = await db
    .select({ grade: grades, subject: subjectFields })
    .from(grades)
    .innerJoin(
      subjects,
      and(eq(subjects.id, grades.subjectId), eq(subjects.userId, userId)),
    )
    .where(and(eq(grades.userId, userId), eq(grades.id, id)))
    .limit(1);

  return row ? toItem(row) : null;
}

export async function createGrade(
  userId: string,
  input: GradeInput,
): Promise<void> {
  const values = await checkedValues(userId, input);

  await db.insert(grades).values({ ...values, userId });
}

export async function updateGrade(
  userId: string,
  id: string,
  input: GradeInput,
): Promise<void> {
  if (!isId(id)) return;

  const values = await checkedValues(userId, input);

  await db
    .update(grades)
    .set(values)
    .where(and(eq(grades.userId, userId), eq(grades.id, id)));
}

export async function deleteGrade(userId: string, id: string): Promise<void> {
  if (!isId(id)) return;

  await db
    .delete(grades)
    .where(and(eq(grades.userId, userId), eq(grades.id, id)));
}

/**
 * Alle Fächer mit ihren Noten. Nicht archivierte Fächer stehen immer drin,
 * auch ohne eine einzige Note — ein leeres Fach soll man ja gerade anklicken
 * können, um die erste Note einzutragen. Archivierte nur, solange noch Noten
 * an ihnen hängen: ein abgewähltes Fach ist aus dem Alltag heraus, seine alten
 * Noten sollen aber weiter zu sehen sein.
 *
 * Fächer und Noten kommen in je einer Abfrage; zugeordnet wird im Speicher.
 * Eine Abfrage pro Fach wäre bei einem Dutzend Fächern ein Dutzend Wege zur
 * Datenbank für dieselbe Seite.
 */
export async function gradesBySubject(
  userId: string,
): Promise<SubjectGrades[]> {
  const [subjectRows, gradeRows] = await Promise.all([
    db
      .select()
      .from(subjects)
      .where(eq(subjects.userId, userId))
      .orderBy(asc(subjects.sortOrder), asc(subjects.name)),
    db
      .select({ grade: grades, subject: subjectFields })
      .from(grades)
      .innerJoin(
        subjects,
        and(eq(subjects.id, grades.subjectId), eq(subjects.userId, userId)),
      )
      .where(eq(grades.userId, userId))
      .orderBy(desc(grades.date), desc(grades.createdAt)),
  ]);

  // Die Abfrage liefert schon in der richtigen Reihenfolge — beim Einsortieren
  // bleibt sie erhalten, jede Fachliste steht damit ohne zweites Sortieren
  // richtig herum.
  const bySubject = new Map<string, GradeItem[]>();
  for (const row of gradeRows) {
    const item = toItem(row);
    const list = bySubject.get(item.subjectId);
    if (list) {
      list.push(item);
    } else {
      bySubject.set(item.subjectId, [item]);
    }
  }

  return subjectRows
    .filter((subject) => !subject.archived || bySubject.has(subject.id))
    .map((subject) => {
      const items = bySubject.get(subject.id) ?? [];
      const entries = items.map(toEntry);

      return {
        subject,
        grades: items,
        average: subjectAverage(entries, subject.weightWritten),
        written: weightedAverage(
          entries.filter((entry) => entry.kind === "schriftlich"),
        ),
        oral: weightedAverage(
          entries.filter((entry) => entry.kind === "muendlich"),
        ),
      };
    });
}

/**
 * Die Zahlen für Kachel und Dashboard. Sie stehen auf demselben Fundament wie
 * die Fächerseite und kosten dieselben zwei Abfragen — zwei Wege durch die
 * Daten würden nur riskieren, dass an zwei Stellen zwei Schnitte stehen.
 *
 * Archivierte Fächer bleiben aus `overall` und `perSubject` heraus: ein
 * abgewähltes Fach soll den heutigen Schnitt weder drücken noch heben. Gezählt
 * werden ihre Noten trotzdem — eingetragen sind sie ja.
 */
export async function gradeSummary(userId: string): Promise<GradeSummary> {
  const bySubject = await gradesBySubject(userId);

  const perSubject: GradeSummary["perSubject"] = [];
  for (const entry of bySubject) {
    if (entry.subject.archived || entry.average === null) continue;

    perSubject.push({
      subject: {
        id: entry.subject.id,
        name: entry.subject.name,
        short: entry.subject.short,
        color: entry.subject.color,
      },
      average: entry.average,
      count: entry.grades.length,
    });
  }

  // 1,0 ist die beste Note und steht deshalb vorn; bei Gleichstand entscheidet
  // der Fachname, damit die Reihenfolge zwischen zwei Aufrufen nicht springt.
  perSubject.sort(
    (a, b) =>
      a.average - b.average || a.subject.name.localeCompare(b.subject.name, "de"),
  );

  // In jedem Fach steht die jüngste Note oben — es genügt, die Ersten
  // miteinander zu vergleichen.
  let latest: GradeItem | null = null;
  for (const entry of bySubject) {
    const first = entry.grades[0];
    if (first && (latest === null || isNewer(first, latest))) latest = first;
  }

  return {
    overall: overallAverage(perSubject.map((entry) => entry.average)),
    gradeCount: bySubject.reduce((sum, entry) => sum + entry.grades.length, 0),
    gradedSubjects: bySubject.filter((entry) => entry.grades.length > 0).length,
    latest,
    perSubject,
  };
}

/** Die Fachspalten, die eine Note in der Liste braucht — mehr wird nicht geladen. */
const subjectFields = {
  id: subjects.id,
  name: subjects.name,
  short: subjects.short,
  color: subjects.color,
};

type Row = {
  grade: Grade;
  subject: Pick<Subject, "id" | "name" | "short" | "color">;
};

function toItem(row: Row): GradeItem {
  return { ...row.grade, subject: row.subject };
}

/**
 * Aus einer Zeile wird das, was die Rechnung braucht — mehr als Wert, Gewicht
 * und Art sieht @/lib/grade-scale von einer Note nie.
 */
function toEntry(item: GradeItem): GradeEntry {
  return { value: item.value, weight: item.weight, kind: kindOf(item) };
}

function isGradeKind(value: string): value is GradeKind {
  return value === "schriftlich" || value === "muendlich";
}

/**
 * Die Spalte ist Text, damit die Datenbank keine Aufzählung pflegen muss.
 * Geschrieben wird nur nach Prüfung, ein anderer Wert könnte also nur von Hand
 * hineingeraten sein — er zählt dann als schriftlich, statt eine ganze Seite an
 * einer einzigen Zeile scheitern zu lassen.
 */
function kindOf(grade: Grade): GradeKind {
  return isGradeKind(grade.kind) ? grade.kind : "schriftlich";
}

/** Zuletzt eingetragen heißt: jüngerer Tag, bei gleichem Tag später erfasst. */
function isNewer(candidate: GradeItem, current: GradeItem): boolean {
  if (candidate.date !== current.date) return candidate.date > current.date;

  return candidate.createdAt.getTime() > current.createdAt.getTime();
}

/**
 * Gemeinsame Prüfung von Anlegen und Ändern: das Fach muss dem Nutzer gehören,
 * Note, Art, Gewicht und Datum müssen es überhaupt geben. Das Formular prüft
 * später noch einmal mit zod und beschriftet damit die einzelnen Felder — hier
 * geht es darum, dass nichts Unsinniges in die Datenbank gelangt, auch wenn es
 * an einem Formular vorbeikommt. Leere Titel landen als NULL, nicht als "".
 */
async function checkedValues(
  userId: string,
  input: GradeInput,
): Promise<{
  subjectId: string;
  value: number;
  kind: GradeKind;
  weight: number;
  date: string;
  title: string | null;
}> {
  // Ein archiviertes Fach ist ausdrücklich erlaubt: man trägt auch mal eine
  // alte Note nach, nachdem man das Fach schon abgewählt hat.
  if (!(await ownsSubject(userId, input.subjectId))) {
    throw new Error("Dieses Fach gibt es nicht.");
  }

  if (!isGradeValue(input.value)) {
    throw new Error("Diese Note gibt es nicht.");
  }

  if (!isGradeKind(input.kind)) {
    throw new Error("Diese Art von Note kennt die App nicht.");
  }

  if (
    !Number.isInteger(input.weight) ||
    input.weight < 1 ||
    input.weight > MAX_WEIGHT
  ) {
    throw new Error("Dieses Gewicht gibt es nicht.");
  }

  if (!isCalendarDate(input.date)) {
    throw new Error("Dieses Datum gibt es nicht.");
  }

  const title = input.title?.trim();
  if (title && title.length > MAX_TITLE_LENGTH) {
    throw new Error("Der Titel ist zu lang — höchstens 120 Zeichen.");
  }

  return {
    subjectId: input.subjectId,
    value: input.value,
    kind: input.kind,
    weight: input.weight,
    date: input.date,
    title: title && title.length > 0 ? title : null,
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
