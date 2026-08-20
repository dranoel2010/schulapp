import { count, eq } from "drizzle-orm";

import { db } from "@/db";
import { subjects, type Period } from "@/db/schema";
import { addDays, daysBetween, timeInBerlin } from "@/lib/dates";
import {
  blocksForDay,
  listExams,
  missedBlocks,
  type ExamListItem,
  type TodayBlock,
} from "@/lib/exams";
import {
  homeworkForRange,
  listHomework,
  openHomeworkCount,
  type HomeworkItem,
} from "@/lib/homework";
import {
  isSchoolDay,
  loadWeek,
  periodTimes,
  weekdayOf,
  type LessonWithSubject,
  type WeekPlan,
} from "@/lib/timetable";

/**
 * Alles, was die Startseite anzeigt — einmal geladen, von allen drei Ansichten
 * benutzt: dem Kachelmenü am Handy, der Tagesspur daneben und dem Dashboard am
 * großen Bildschirm. Alle zeigen dieselben Zahlen, nur anders angeordnet.
 *
 * Deshalb steht hier bewusst etwas mehr, als jede einzelne Ansicht braucht:
 * eine zweite Abfrage je Ansicht wäre teurer als ein paar Zeilen zu viel im
 * Ergebnis.
 */

/**
 * Die nächste Schulstunde, die noch kommt — heute oder am nächsten Schultag.
 *
 * Die Uhrzeit steht mit dabei, weil sie nicht an der Stunde hängt, sondern am
 * Stundenraster: das Raster darf sich ändern, ohne dass jede eingetragene
 * Stunde umzieht.
 */
export type NextLesson = {
  lesson: LessonWithSubject;
  /** Beginn als "HH:MM" aus dem Stundenraster */
  startsAt: string;
  /** Der Tag, an dem sie stattfindet — "YYYY-MM-DD" */
  date: string;
  /** Kommt sie heute noch? Sonst gehört der Wochentag in die Beschriftung. */
  isToday: boolean;
};

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
  /** Das Stundenraster: welche Stunde wann beginnt und wann sie endet */
  periods: Period[];
  /** Die heutigen Schulstunden, nach Stunde sortiert. Am Wochenende leer. */
  todayLessons: LessonWithSubject[];
  /** Steht überhaupt ein Stundenplan in der Datenbank? */
  hasTimetable: boolean;
  /** Die nächste Schulstunde, notfalls die erste des nächsten Schultags */
  nextLesson: NextLesson | null;
  /** Heute fällige Aufgaben, offene wie abgehakte */
  todayHomework: HomeworkItem[];
  /** Alle offenen Aufgaben, die früheste Fälligkeit zuerst */
  openHomework: HomeworkItem[];
  /** Offen insgesamt, davon überfällig und davon heute fällig */
  homeworkCounts: { open: number; overdue: number; dueToday: number };
};

export async function loadHomeData(
  userId: string,
  userName: string,
  today: string,
  /**
   * Die Uhrzeit als "HH:MM". Sie entscheidet allein darüber, welche
   * Schulstunde noch kommt. Sie steht als Vorgabe hier, damit die Startseite
   * sie nicht eigens ausrechnen muss und ein Test sie trotzdem setzen kann.
   */
  now: string = timeInBerlin(),
): Promise<HomeData> {
  const [
    subjectRows,
    exams,
    todayBlocks,
    missed,
    week,
    todayHomework,
    openHomework,
    homeworkCounts,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(subjects)
      .where(eq(subjects.userId, userId)),
    listExams(userId),
    blocksForDay(userId, today),
    missedBlocks(userId, today),
    // Die ganze Woche statt nur des heutigen Tages: bleibt heute keine Stunde
    // mehr übrig, zeigt die Kachel die erste des nächsten Schultags — und
    // welcher Tag das ist, weiß man erst, wenn man die Woche kennt.
    loadWeek(userId),
    homeworkForRange(userId, today, today),
    listHomework(userId),
    openHomeworkCount(userId, today),
  ]);

  const upcoming = exams.filter((exam) => exam.date >= today);
  const nextExam = upcoming[0] ?? null;
  const todayWeekday = weekdayOf(today);

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
    periods: week.periods,
    todayLessons:
      week.days.find((day) => day.weekday === todayWeekday)?.lessons ?? [],
    hasTimetable: week.days.some((day) => day.lessons.length > 0),
    nextLesson: findNextLesson(week, today, now),
    todayHomework,
    openHomework,
    homeworkCounts,
  };
}

/** Anteil erledigter Lernblöcke einer Prüfung, 0–100. */
export function planProgress(exam: ExamListItem): number {
  if (exam.totalBlocks === 0) return 0;
  return Math.round((exam.doneBlocks / exam.totalBlocks) * 100);
}

/**
 * Die Zeile unter dem Datum: "4 Stunden, 1 Lernblock". Kachelmenü und
 * Tagesspur zeigen dieselbe — es ist derselbe Tag, also dieselbe Auskunft.
 *
 * Am Wochenende steht dort "Wochenende" und keine Null: das ist die Antwort,
 * die man erwartet. Und solange gar kein Stundenplan eingetragen ist, fehlt
 * der Teil ganz — "keine Stunde" klänge, als wüsste die App, dass heute
 * wirklich keine ist.
 */
export function dayLine(data: HomeData): string {
  const parts: string[] = [];
  const lessons = data.todayLessons.length;

  if (!isSchoolDay(data.today)) {
    parts.push("Wochenende");
  } else if (data.hasTimetable) {
    parts.push(
      lessons === 0
        ? "keine Stunde"
        : lessons === 1
          ? "1 Stunde"
          : `${lessons} Stunden`,
    );
  }

  const blocks = data.todayBlocks.length;

  parts.push(
    blocks === 0
      ? "kein Lernblock"
      : blocks === 1
        ? "1 Lernblock"
        : `${blocks} Lernblöcke`,
  );

  return parts.join(", ");
}

/** Der Raum der Stunde; ohne eigenen Eintrag gilt der des Fachs. */
export function lessonRoom(lesson: LessonWithSubject): string | null {
  return lesson.room ?? lesson.subject.room ?? null;
}

/**
 * Die nächste Schulstunde, gerechnet ohne Datenbank und ohne Systemuhr.
 *
 * Zuerst zählt, was von heute noch übrig ist — eine Stunde, die schon begonnen
 * hat, kommt nicht mehr. Bleibt heute nichts, wandert die Suche Tag für Tag
 * weiter, bis ein Schultag mit Unterricht auftaucht.
 *
 * Die Runde geht bis einschließlich Tag sieben, also noch einmal über den
 * heutigen Wochentag. Das ist kein Versehen: heute sind die vergangenen
 * Stunden ausgeschlossen, in einer Woche nicht mehr. Wer nur montags
 * Unterricht hat, bekäme sonst am Montagnachmittag zu hören, es gebe keine
 * nächste Stunde.
 *
 * Exportiert allein für den Test — die Startseite bekommt das Ergebnis fertig
 * in `HomeData.nextLesson` und ruft die Funktion nicht selbst auf.
 */
export function findNextLesson(
  week: WeekPlan,
  today: string,
  now: string,
): NextLesson | null {
  const times = periodTimes(week.periods);

  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const date = addDays(today, ahead);
    const day = week.days.find((entry) => entry.weekday === weekdayOf(date));
    if (!day) continue;

    for (const lesson of day.lessons) {
      const startsAt = times.get(lesson.period)?.startsAt;

      // Eine Stunde ohne Zeile im Raster hat keine Uhrzeit. Sie trotzdem zu
      // zeigen hieße, eine zu erfinden.
      if (!startsAt) continue;
      if (ahead === 0 && startsAt <= now) continue;

      return { lesson, startsAt, date, isToday: ahead === 0 };
    }
  }

  return null;
}
