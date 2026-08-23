import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  exams,
  examTopics,
  studyBlocks,
  subjects,
  type Exam,
  type ExamTopic,
  type StudyBlock,
  type Subject,
} from "@/db/schema";
import { isCalendarDate, todayInBerlin } from "@/lib/dates";
import { normalizeTopics, topicKey } from "@/lib/topics";
import {
  buildPlan,
  replanOpen,
  type Plan,
  type PlanKind,
  type PlanTopic,
} from "@/lib/study-plan";

/**
 * Klausuren, Themen und Lernblöcke — Validierung und Datenzugriff.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche. Der Lernplan
 * selbst wird in @/lib/study-plan gerechnet, hier wird er nur gespeichert.
 *
 * Jede Abfrage filtert zusätzlich nach userId, auch dort, wo die examId schon
 * eindeutig wäre. So kann kein fremder Datensatz durchrutschen, egal welche id
 * in der Adresszeile steht.
 *
 * Datumsfelder sind reine Kalenderdaten als Zeichenkette ("2026-09-14"). Sie
 * lassen sich als Zeichenketten vergleichen und sortieren; gerechnet wird
 * ausschließlich in @/lib/dates.
 */

/**
 * Die vier Arten von Prüfung. Exportiert, weil das Prüfschema der Klausuren
 * nicht die einzige Tür ist, durch die eine Art hereinkommt: der Eingangskorb
 * nimmt sie in einem Vorschlag entgegen (@/lib/proposals). Zwei Listen wären
 * zwei Stellen, an denen die App an einer Tür annimmt, was sie an einer
 * anderen ablehnt.
 */
export const EXAM_KINDS = ["klausur", "test", "referat", "muendlich"] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eine kaputte id aus der Adresszeile würde Postgres sonst mit einem Typfehler
 * quittieren — hier wird daraus ein sauberes "gibt es nicht".
 */
function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Leere Eingabe soll als NULL in der Datenbank landen, nicht als "". */
function optionalText(maxLength: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(maxLength, tooLong)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null));
}

export const examInputSchema = z.object({
  subjectId: z.uuid("Zu welchem Fach gehört die Prüfung?"),
  title: optionalText(80, "Der Titel ist zu lang — höchstens 80 Zeichen."),
  kind: z.enum(EXAM_KINDS, "Diese Art von Prüfung kennt die App nicht."),
  date: z
    .string("Wann ist die Prüfung?")
    .trim()
    .refine(isCalendarDate, "Dieses Datum gibt es nicht.")
    // Der Vergangenheits-Test greift nur, wenn das Datum überhaupt lesbar ist —
    // sonst stünden zwei Meldungen an einem Feld.
    .refine(
      (value) => !isCalendarDate(value) || value >= todayInBerlin(),
      "Dieser Tag ist schon vorbei.",
    ),
  leadDays: z.coerce
    .number("Die Vorlaufzeit ist keine Zahl.")
    .int("Die Vorlaufzeit muss eine ganze Zahl sein.")
    .min(1, "Mindestens ein Lerntag.")
    .max(60, "Höchstens 60 Tage Vorlauf."),
  minutesPerDay: z.coerce
    .number("Die Lernzeit ist keine Zahl.")
    .int("Die Lernzeit muss eine ganze Zahl sein.")
    .min(10, "Mindestens 10 Minuten pro Tag.")
    .max(240, "Höchstens 240 Minuten pro Tag."),
  notes: optionalText(2000, "Die Notiz ist zu lang — höchstens 2000 Zeichen."),
});

export type ExamInput = z.infer<typeof examInputSchema>;

/** Eine Prüfung in der Liste, mit Fach und Fortschritt. */
export type ExamListItem = Exam & {
  subject: Subject;
  topicCount: number;
  openBlocks: number;
  doneBlocks: number;
  /** Geplante Blöcke ohne die gestrichenen */
  totalBlocks: number;
};

/** Alles, was die Detailseite einer Prüfung braucht. */
export type ExamDetail = {
  exam: Exam;
  subject: Subject;
  topics: ExamTopic[];
  blocks: (StudyBlock & { topic: ExamTopic | null })[];
};

/** Ein Lernblock mit allem, was für die Anzeige an einem Tag nötig ist. */
export type TodayBlock = StudyBlock & {
  exam: Exam;
  subject: Subject;
  topic: ExamTopic | null;
};

/**
 * Ein Zählwert pro Prüfung, aufgeschlüsselt nach Zustand der Lernblöcke.
 * `total` zählt ohne die gestrichenen — genau wie die Detailseite, sonst
 * stünde in der Liste eine andere Zahl als auf der Prüfung selbst.
 */
type BlockCounts = { total: number; open: number; done: number };

export async function listExams(
  userId: string,
  options?: { includePast?: boolean },
): Promise<ExamListItem[]> {
  const today = todayInBerlin();

  const rows = await db
    .select({ exam: exams, subject: subjects })
    .from(exams)
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .where(
      options?.includePast
        ? eq(exams.userId, userId)
        : and(eq(exams.userId, userId), gte(exams.date, today)),
    )
    .orderBy(asc(exams.date));

  const examIds = rows.map((row) => row.exam.id);
  const [topicCounts, blockCounts] = await Promise.all([
    countTopics(examIds),
    countBlocks(examIds),
  ]);

  const items = rows.map((row): ExamListItem => {
    const counts = blockCounts.get(row.exam.id) ?? { total: 0, open: 0, done: 0 };
    return {
      ...row.exam,
      subject: row.subject,
      topicCount: topicCounts.get(row.exam.id) ?? 0,
      openBlocks: counts.open,
      doneBlocks: counts.done,
      totalBlocks: counts.total,
    };
  });

  // Kommende zuerst, die nächste oben. Vergangene hängen hinten dran, die
  // zuletzt geschriebene zuerst — die interessiert am ehesten.
  const upcoming = items.filter((item) => item.date >= today);
  const past = items
    .filter((item) => item.date < today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return [...upcoming, ...past];
}

export async function getExam(
  userId: string,
  examId: string,
): Promise<ExamDetail | null> {
  if (!isId(examId)) return null;

  const [row] = await db
    .select({ exam: exams, subject: subjects })
    .from(exams)
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .where(and(eq(exams.userId, userId), eq(exams.id, examId)))
    .limit(1);

  if (!row) return null;

  const [topics, blockRows] = await Promise.all([
    db
      .select()
      .from(examTopics)
      .where(eq(examTopics.examId, examId))
      .orderBy(asc(examTopics.sortOrder), asc(examTopics.title)),
    db
      .select({ block: studyBlocks, topic: examTopics })
      .from(studyBlocks)
      .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
      .where(eq(studyBlocks.examId, examId))
      .orderBy(asc(studyBlocks.date), asc(studyBlocks.sortOrder)),
  ]);

  return {
    exam: row.exam,
    subject: row.subject,
    topics,
    blocks: blockRows.map((entry) => ({
      ...entry.block,
      topic: entry.topic ?? null,
    })),
  };
}

export async function createExam(
  userId: string,
  input: ExamInput,
): Promise<Exam> {
  if (!(await ownsSubject(userId, input.subjectId))) {
    throw new Error("Dieses Fach gibt es nicht.");
  }

  const [exam] = await db
    .insert(exams)
    .values({ ...input, userId })
    .returning();

  if (!exam) {
    throw new Error("Die Prüfung konnte nicht gespeichert werden.");
  }

  return exam;
}

export async function updateExam(
  userId: string,
  examId: string,
  input: ExamInput,
): Promise<void> {
  if (!isId(examId)) return;
  if (!(await ownsSubject(userId, input.subjectId))) {
    throw new Error("Dieses Fach gibt es nicht.");
  }

  await db
    .update(exams)
    .set(input)
    .where(and(eq(exams.userId, userId), eq(exams.id, examId)));
}

export async function deleteExam(
  userId: string,
  examId: string,
): Promise<void> {
  if (!isId(examId)) return;

  await db
    .delete(exams)
    .where(and(eq(exams.userId, userId), eq(exams.id, examId)));
}

/**
 * Ersetzt die Themenliste einer Prüfung.
 *
 * Unveränderte Themen behalten ihre id — daran hängen die Lernblöcke. Deshalb
 * wird nach Titel verglichen und nur angelegt, was wirklich neu ist, und nur
 * gelöscht, was wirklich weg ist.
 */
export async function setTopics(
  userId: string,
  examId: string,
  titles: string[],
): Promise<void> {
  const exam = await findExam(userId, examId);
  if (!exam) return;

  // Zuschneiden nach denselben Regeln wie im Formular: getrimmt, gekürzt,
  // ohne Dubletten, gedeckelt. Vorher galten Länge und Anzahl nur auf dem Weg
  // übers Formular — ein direkter Aufruf kam ungebremst durch.
  const wanted = normalizeTopics(titles);

  const existing = await db
    .select()
    .from(examTopics)
    .where(eq(examTopics.examId, examId));

  const keptIds = new Set<string>();
  const updates: { id: string; title: string; sortOrder: number }[] = [];
  const inserts: { examId: string; title: string; sortOrder: number }[] = [];

  wanted.forEach((title, index) => {
    const match = existing.find(
      (topic) =>
        !keptIds.has(topic.id) &&
        topicKey(topic.title) === topicKey(title),
    );

    if (!match) {
      inserts.push({ examId, title, sortOrder: index });
      return;
    }

    keptIds.add(match.id);
    if (match.title !== title || match.sortOrder !== index) {
      updates.push({ id: match.id, title, sortOrder: index });
    }
  });

  const removed = existing
    .filter((topic) => !keptIds.has(topic.id))
    .map((topic) => topic.id);

  if (updates.length === 0 && inserts.length === 0 && removed.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    for (const update of updates) {
      await tx
        .update(examTopics)
        .set({ title: update.title, sortOrder: update.sortOrder })
        .where(eq(examTopics.id, update.id));
    }

    if (removed.length > 0) {
      await tx.delete(examTopics).where(inArray(examTopics.id, removed));
    }

    if (inserts.length > 0) {
      await tx.insert(examTopics).values(inserts);
    }
  });
}

/**
 * Rechnet den Lernplan neu und speichert ihn.
 *
 * Erledigte und gestrichene Blöcke bleiben unangetastet — sie sind die
 * Geschichte der Lernphase. Geplant wird nur, was davon noch übrig ist.
 */
/**
 * Minuten, die an einem Tag schon durch erledigte Blöcke dieser Prüfung
 * verbraucht sind. Gestrichene zählen nicht mit — die geben ihre Zeit wieder
 * frei.
 */
function occupiedMinutes(blocks: StudyBlock[]): Record<string, number> {
  const byDay: Record<string, number> = {};
  for (const block of blocks) {
    if (block.status !== "done") continue;
    byDay[block.date] = (byDay[block.date] ?? 0) + block.minutes;
  }
  return byDay;
}

/**
 * Alles, was an einem Tag schon vergeben ist: die erledigten Blöcke dieser
 * Prüfung — und was an dem Tag für **andere** Prüfungen geplant oder erledigt
 * ist.
 *
 * Der zweite Teil hat lange gefehlt, und es war ein Fehler mit Folgen. Jede
 * Prüfung plante für sich, und drei Klausuren mit überlappenden Lernphasen
 * legten drei Blöcke auf denselben Dienstag: 135 Minuten an einem Tag, den
 * niemand als überfüllt erkannt hat. Wer mehr Klausuren einträgt, bekam so
 * einen unrealistischeren Plan — Erfassen wurde bestraft.
 *
 * Bei den anderen Prüfungen zählen offene Blöcke mit, nicht nur erledigte: ein
 * geplanter Dienstag ist belegt, auch wenn er noch vor einem liegt.
 * Gestrichene zählen nirgends — die geben ihre Zeit wieder frei.
 *
 * Wer zuerst geplant wird, belegt die Tage; die nächste Prüfung bekommt, was
 * übrig bleibt. Das ist Absicht und keine Nachlässigkeit: ein gemeinsames
 * Neuverteilen aller Pläne würde einen Plan, an dem schon abgehakt wurde,
 * unter dem Nutzer wegziehen, sobald er die nächste Klausur einträgt.
 */
async function occupiedAcrossExams(
  userId: string,
  examId: string,
  ownBlocks: StudyBlock[],
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      date: studyBlocks.date,
      minutes: sql<number>`cast(sum(${studyBlocks.minutes}) as int)`,
    })
    .from(studyBlocks)
    .innerJoin(
      exams,
      and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)),
    )
    .where(
      and(ne(studyBlocks.examId, examId), ne(studyBlocks.status, "skipped")),
    )
    .groupBy(studyBlocks.date);

  const byDay = occupiedMinutes(ownBlocks);

  for (const row of rows) {
    byDay[row.date] = (byDay[row.date] ?? 0) + Number(row.minutes);
  }

  return byDay;
}

export async function generatePlan(
  userId: string,
  examId: string,
  today: string,
): Promise<Plan> {
  const exam = await findExam(userId, examId);
  if (!exam) {
    throw new Error("Diese Prüfung gibt es nicht.");
  }

  const [topics, blocks] = await Promise.all([
    db
      .select()
      .from(examTopics)
      .where(eq(examTopics.examId, examId))
      .orderBy(asc(examTopics.sortOrder), asc(examTopics.title)),
    db.select().from(studyBlocks).where(eq(studyBlocks.examId, examId)),
  ]);

  const planTopics: PlanTopic[] = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
  }));

  const occupied = await occupiedAcrossExams(userId, examId, blocks);

  const plan = buildPlan({
    examDate: exam.date,
    today,
    topics: planTopics,
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
    occupied,
  });

  const settled = blocks.filter((block) => block.status !== "open");

  if (settled.length === 0) {
    // Nichts angefangen: der alte Plan darf komplett weichen.
    await db.transaction(async (tx) => {
      await tx.delete(studyBlocks).where(eq(studyBlocks.examId, examId));
      if (plan.blocks.length > 0) {
        await tx.insert(studyBlocks).values(
          plan.blocks.map((block) => ({
            examId,
            topicId: block.topicId,
            date: block.date,
            minutes: block.minutes,
            kind: block.kind,
            sortOrder: block.sortOrder,
            status: "open",
          })),
        );
      }
    });

    return plan;
  }

  // Jeder erledigte oder gestrichene Block deckt einen Posten des neuen Plans
  // schon ab. Was übrig bleibt, wird auf die Tage ab heute verteilt.
  const remaining = [...plan.blocks];
  for (const block of settled) {
    const index = remaining.findIndex(
      (entry) =>
        entry.topicId === block.topicId && entry.kind === toPlanKind(block.kind),
    );
    if (index >= 0) remaining.splice(index, 1);
  }

  const scheduled = replanOpen({
    examDate: exam.date,
    today,
    topics: planTopics,
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
    occupied,
    open: remaining.map((block, index) => ({
      id: String(index),
      topicId: block.topicId,
      kind: block.kind,
    })),
  });

  const placed = new Map(scheduled.map((entry) => [entry.id, entry]));
  const rows = remaining.flatMap((block, index) => {
    const slot = placed.get(String(index));
    if (!slot) return [];
    return [
      {
        examId,
        topicId: block.topicId,
        date: slot.date,
        minutes: slot.minutes,
        kind: block.kind,
        sortOrder: slot.sortOrder,
        status: "open",
      },
    ];
  });

  await db.transaction(async (tx) => {
    await tx
      .delete(studyBlocks)
      .where(
        and(eq(studyBlocks.examId, examId), eq(studyBlocks.status, "open")),
      );
    if (rows.length > 0) {
      await tx.insert(studyBlocks).values(rows);
    }
  });

  return plan;
}

export async function setBlockStatus(
  userId: string,
  blockId: string,
  status: "open" | "done" | "skipped",
): Promise<void> {
  if (!isId(blockId)) return;

  await db
    .update(studyBlocks)
    .set({ status })
    .where(and(eq(studyBlocks.id, blockId), inArray(studyBlocks.examId, ownExamIds(userId))));
}

/**
 * Nachholen: alle offenen Blöcke — die verpassten und die noch anstehenden —
 * werden auf die verbleibenden Tage neu verteilt. Erledigtes und Gestrichenes
 * bleibt, wo es ist.
 */
export async function catchUpMissed(
  userId: string,
  examId: string,
  today: string,
): Promise<void> {
  const exam = await findExam(userId, examId);
  if (!exam) return;
  if (!isCalendarDate(today)) return;

  const [topics, all] = await Promise.all([
    db
      .select()
      .from(examTopics)
      .where(eq(examTopics.examId, examId))
      .orderBy(asc(examTopics.sortOrder), asc(examTopics.title)),
    db
      .select()
      .from(studyBlocks)
      .where(eq(studyBlocks.examId, examId))
      .orderBy(asc(studyBlocks.date), asc(studyBlocks.sortOrder)),
  ]);

  // Die erledigten brauchen wir nicht zum Verschieben, aber um zu wissen,
  // an welchen Tagen schon Lernzeit verbraucht ist.
  const open = all.filter((block) => block.status === "open");
  if (open.length === 0) return;

  const occupied = await occupiedAcrossExams(userId, examId, all);

  const scheduled = replanOpen({
    examDate: exam.date,
    today,
    topics: topics.map((topic) => ({ id: topic.id, title: topic.title })),
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
    occupied,
    open: open.map((block) => ({
      id: block.id,
      topicId: block.topicId,
      kind: toPlanKind(block.kind),
    })),
  });

  const placed = new Map(scheduled.map((entry) => [entry.id, entry]));

  await db.transaction(async (tx) => {
    for (const block of open) {
      const slot = placed.get(block.id);

      if (slot) {
        await tx
          .update(studyBlocks)
          .set({
            date: slot.date,
            minutes: slot.minutes,
            sortOrder: slot.sortOrder,
          })
          .where(
            and(eq(studyBlocks.id, block.id), eq(studyBlocks.examId, examId)),
          );
        continue;
      }

      // Kein Platz mehr gefunden: der Block rutscht auf heute, statt in der
      // Vergangenheit hängen zu bleiben und morgen wieder nachzufragen.
      if (block.date < today) {
        await tx
          .update(studyBlocks)
          .set({ date: today })
          .where(
            and(eq(studyBlocks.id, block.id), eq(studyBlocks.examId, examId)),
          );
      }
    }
  });
}

/** Streichen: die verpassten Blöcke werden abgehakt, ohne neuen Termin. */
export async function skipMissed(
  userId: string,
  examId: string,
  today: string,
): Promise<void> {
  const exam = await findExam(userId, examId);
  if (!exam) return;
  if (!isCalendarDate(today)) return;

  await db
    .update(studyBlocks)
    .set({ status: "skipped" })
    .where(
      and(
        eq(studyBlocks.examId, examId),
        eq(studyBlocks.status, "open"),
        lt(studyBlocks.date, today),
      ),
    );
}

/**
 * Was an einem Tag ansteht. Gestrichene Blöcke bleiben draußen, erledigte nicht
 * — sonst würde ein Häkchen den Block aus der Liste werfen.
 */
export async function blocksForDay(
  userId: string,
  day: string,
): Promise<TodayBlock[]> {
  if (!isCalendarDate(day)) return [];

  const rows = await db
    .select({
      block: studyBlocks,
      exam: exams,
      subject: subjects,
      topic: examTopics,
    })
    .from(studyBlocks)
    .innerJoin(
      exams,
      and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)),
    )
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(and(eq(studyBlocks.date, day), ne(studyBlocks.status, "skipped")))
    .orderBy(asc(exams.date), asc(studyBlocks.sortOrder));

  return rows.map((row) => ({
    ...row.block,
    exam: row.exam,
    subject: row.subject,
    topic: row.topic ?? null,
  }));
}

/**
 * Offene Blöcke aus der Vergangenheit — die Grundlage für die Nachfrage
 * "gestern nicht geschafft". Prüfungen, die schon vorbei sind, fragen nicht
 * mehr nach.
 */
export async function missedBlocks(
  userId: string,
  today: string,
): Promise<TodayBlock[]> {
  if (!isCalendarDate(today)) return [];

  const rows = await db
    .select({
      block: studyBlocks,
      exam: exams,
      subject: subjects,
      topic: examTopics,
    })
    .from(studyBlocks)
    .innerJoin(
      exams,
      and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)),
    )
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(
      and(
        eq(studyBlocks.status, "open"),
        lt(studyBlocks.date, today),
        gte(exams.date, today),
      ),
    )
    .orderBy(asc(exams.date), asc(studyBlocks.date), asc(studyBlocks.sortOrder));

  return rows.map((row) => ({
    ...row.block,
    exam: row.exam,
    subject: row.subject,
    topic: row.topic ?? null,
  }));
}

export async function upcomingExams(
  userId: string,
  today: string,
  limit = 5,
): Promise<(Exam & { subject: Subject })[]> {
  if (!isCalendarDate(today)) return [];

  const rows = await db
    .select({ exam: exams, subject: subjects })
    .from(exams)
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .where(and(eq(exams.userId, userId), gte(exams.date, today)))
    .orderBy(asc(exams.date))
    .limit(limit);

  return rows.map((row) => ({ ...row.exam, subject: row.subject }));
}

/** Prüfung samt Besitzprüfung — jede schreibende Funktion geht hier durch. */
async function findExam(userId: string, examId: string): Promise<Exam | null> {
  if (!isId(examId)) return null;

  const [exam] = await db
    .select()
    .from(exams)
    .where(and(eq(exams.userId, userId), eq(exams.id, examId)))
    .limit(1);

  return exam ?? null;
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

/** Unterabfrage: alle Prüfungen dieses Nutzers. */
function ownExamIds(userId: string) {
  return db.select({ id: exams.id }).from(exams).where(eq(exams.userId, userId));
}

function toPlanKind(kind: string): PlanKind {
  return kind === "review" ? "review" : "learn";
}

async function countTopics(examIds: string[]): Promise<Map<string, number>> {
  if (examIds.length === 0) return new Map();

  const rows = await db
    .select({
      examId: examTopics.examId,
      total: sql<number>`cast(count(*) as int)`,
    })
    .from(examTopics)
    .where(inArray(examTopics.examId, examIds))
    .groupBy(examTopics.examId);

  return new Map(rows.map((row) => [row.examId, Number(row.total)]));
}

async function countBlocks(examIds: string[]): Promise<Map<string, BlockCounts>> {
  if (examIds.length === 0) return new Map();

  const rows = await db
    .select({
      examId: studyBlocks.examId,
      total: sql<number>`cast(count(*) filter (where ${studyBlocks.status} <> 'skipped') as int)`,
      open: sql<number>`cast(count(*) filter (where ${studyBlocks.status} = 'open') as int)`,
      done: sql<number>`cast(count(*) filter (where ${studyBlocks.status} = 'done') as int)`,
    })
    .from(studyBlocks)
    .where(inArray(studyBlocks.examId, examIds))
    .groupBy(studyBlocks.examId);

  return new Map(
    rows.map((row) => [
      row.examId,
      {
        total: Number(row.total),
        open: Number(row.open),
        done: Number(row.done),
      },
    ]),
  );
}
