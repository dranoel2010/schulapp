import { count, eq } from "drizzle-orm";

import { db } from "@/db";
import { subjects } from "@/db/schema";
import { daysBetween } from "@/lib/dates";
import {
  blocksForDay,
  listExams,
  missedBlocks,
  type ExamListItem,
  type TodayBlock,
} from "@/lib/exams";

/**
 * Alles, was die Startseite anzeigt — einmal geladen, von beiden Ansichten
 * benutzt: dem Kachelmenü am Handy und dem Dashboard am großen Bildschirm.
 * Beide zeigen dieselben Zahlen, nur anders angeordnet.
 */
export type HomeData = {
  userName: string;
  /** "YYYY-MM-DD" in Berliner Zeit */
  today: string;
  subjectCount: number;
  /** Alle Lernblöcke von heute, offene wie erledigte */
  todayBlocks: TodayBlock[];
  todayOpenMinutes: number;
  todayDoneCount: number;
  /** Offene Blöcke aus der Vergangenheit — Grundlage der Nachfrage */
  missed: TodayBlock[];
  /** Die nächste anstehende Prüfung samt Lernfortschritt */
  nextExam: ExamListItem | null;
  /** Tage bis zur nächsten Prüfung, 0 = heute */
  daysToNextExam: number | null;
  /** Kommende Prüfungen, die nächste zuerst */
  upcoming: ExamListItem[];
};

export async function loadHomeData(
  userId: string,
  userName: string,
  today: string,
): Promise<HomeData> {
  const [subjectRows, exams, todayBlocks, missed] = await Promise.all([
    db
      .select({ value: count() })
      .from(subjects)
      .where(eq(subjects.userId, userId)),
    listExams(userId),
    blocksForDay(userId, today),
    missedBlocks(userId, today),
  ]);

  const upcoming = exams.filter((exam) => exam.date >= today);
  const nextExam = upcoming[0] ?? null;

  return {
    userName,
    today,
    subjectCount: subjectRows[0]?.value ?? 0,
    todayBlocks,
    todayOpenMinutes: todayBlocks
      .filter((block) => block.status === "open")
      .reduce((sum, block) => sum + block.minutes, 0),
    todayDoneCount: todayBlocks.filter((block) => block.status === "done")
      .length,
    missed,
    nextExam,
    daysToNextExam: nextExam ? daysBetween(today, nextExam.date) : null,
    upcoming,
  };
}

/** Anteil erledigter Lernblöcke einer Prüfung, 0–100. */
export function planProgress(exam: ExamListItem): number {
  if (exam.totalBlocks === 0) return 0;
  return Math.round((exam.doneBlocks / exam.totalBlocks) * 100);
}
