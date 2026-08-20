import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Exam, Period, StudyBlock, Subject, Weekday } from "@/db/schema";
import type { TodayBlock } from "@/lib/exams";
import { dayLine, findNextLesson, type HomeData } from "@/lib/home";
import {
  DEFAULT_PERIODS,
  WEEKDAYS,
  type LessonWithSubject,
  type WeekPlan,
} from "@/lib/timetable";

/**
 * Feste Tage statt `new Date()`: der 14.9.2026 ist ein Montag, der 12.9. ein
 * Samstag. Von diesen beiden aus lassen sich alle Fälle abzählen.
 */
const MONDAY = "2026-09-14";
const SATURDAY = "2026-09-12";

const USER = "u1";

const STAMP = new Date("2026-09-01T08:00:00Z");

/** Nur die Fachspalten, die eine Stunde im Plan trägt. */
const SUBJECT: LessonWithSubject["subject"] = {
  id: "s-ma",
  name: "Mathematik",
  short: "Ma",
  color: "indigo",
  room: "A203",
  teacher: "Fr. Bergmann",
};

/** Das Raster, wie ensurePeriods es anlegt — hier auf `count` Zeilen gekürzt. */
function periodRows(count = 4): Period[] {
  return DEFAULT_PERIODS.slice(0, count).map((row) => ({
    id: `p${row.number}`,
    userId: USER,
    number: row.number,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  }));
}

function lesson(weekday: Weekday, period: number): LessonWithSubject {
  return {
    id: `l${weekday}-${period}`,
    userId: USER,
    subjectId: SUBJECT.id,
    weekday,
    period,
    room: null,
    note: null,
    createdAt: STAMP,
    subject: SUBJECT,
  };
}

/**
 * Ein Wochenplan, wie loadWeek ihn liefert: immer alle fünf Tage, auch die
 * leeren — genau darauf verlässt sich die Suche nach der nächsten Stunde.
 */
function week(
  lessons: LessonWithSubject[],
  periods: Period[] = periodRows(),
): WeekPlan {
  return {
    periods,
    days: WEEKDAYS.map((day) => ({
      weekday: day.value,
      lessons: lessons
        .filter((entry) => entry.weekday === day.value)
        .sort((a, b) => a.period - b.period),
    })),
  };
}

describe("findNextLesson", () => {
  it("nimmt die nächste Stunde, die heute noch kommt", () => {
    const plan = week([lesson(1, 1), lesson(1, 3)]);

    const next = findNextLesson(plan, MONDAY, "08:30");

    assert.equal(next?.startsAt, "09:55", "die erste Stunde läuft schon");
    assert.equal(next?.date, MONDAY);
    assert.equal(next?.isToday, true);
  });

  it("findet den einzigen Tag nächste Woche wieder", () => {
    // Nur montags Unterricht, und der Montag ist heute schon vorbei. Ohne die
    // siebte Runde stünde hier "keine nächste Stunde" — für immer.
    const next = findNextLesson(week([lesson(1, 1)]), MONDAY, "15:00");

    assert.equal(next?.date, "2026-09-21");
    assert.equal(next?.startsAt, "08:00");
    assert.equal(next?.isToday, false);
  });

  it("überspringt das Wochenende", () => {
    const next = findNextLesson(week([lesson(1, 2)]), SATURDAY, "10:00");

    assert.equal(next?.date, MONDAY);
    assert.equal(next?.startsAt, "08:50");
    assert.equal(next?.isToday, false);
  });

  it("hat ohne Plan nichts zu melden", () => {
    assert.equal(findNextLesson(week([]), MONDAY, "07:00"), null);
    assert.equal(findNextLesson(week([]), SATURDAY, "07:00"), null);
  });

  it("übergeht eine Stunde ohne Zeile im Raster", () => {
    // Das Raster hat vier Zeilen, die Stunde steht in der neunten: sie hat
    // keine Uhrzeit, und eine zu erfinden wäre schlimmer, als sie wegzulassen.
    const plan = week([lesson(1, 9), lesson(2, 2)]);

    const next = findNextLesson(plan, MONDAY, "07:00");

    assert.equal(next?.date, "2026-09-15", "der Dienstag ist der nächste");
    assert.equal(next?.startsAt, "08:50");
  });

  it("meldet nichts, wenn keine Stunde eine Uhrzeit hat", () => {
    assert.equal(findNextLesson(week([lesson(1, 9)]), MONDAY, "07:00"), null);
  });

  it("lässt eine Stunde fallen, die genau jetzt beginnt", () => {
    // Wer um 08:00 auf die Kachel schaut, sitzt schon drin — die Stunde, die
    // gerade anfängt, ist nicht mehr die nächste.
    const plan = week([lesson(1, 1), lesson(1, 2)]);

    const next = findNextLesson(plan, MONDAY, "08:00");

    assert.equal(next?.startsAt, "08:50");
  });
});

/** Ein Lernblock; für dayLine zählt allein, dass es ihn gibt. */
function block(id: string): TodayBlock {
  const subject: Subject = {
    id: SUBJECT.id,
    userId: USER,
    name: SUBJECT.name,
    short: SUBJECT.short,
    color: SUBJECT.color,
    teacher: SUBJECT.teacher,
    room: SUBJECT.room,
    weightWritten: 50,
    sortOrder: 0,
    archived: false,
    createdAt: STAMP,
  };

  const exam: Exam = {
    id: "e1",
    userId: USER,
    subjectId: SUBJECT.id,
    title: null,
    kind: "klausur",
    date: "2026-09-24",
    leadDays: 10,
    minutesPerDay: 45,
    notes: null,
    createdAt: STAMP,
  };

  const studyBlock: StudyBlock = {
    id,
    examId: exam.id,
    topicId: null,
    date: MONDAY,
    minutes: 45,
    kind: "learn",
    status: "open",
    sortOrder: 0,
    createdAt: STAMP,
  };

  return { ...studyBlock, exam, subject, topic: null };
}

function blocks(count: number): TodayBlock[] {
  return Array.from({ length: count }, (_, index) => block(`b${index + 1}`));
}

function homeData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    userName: "Leo",
    today: MONDAY,
    subjectCount: 3,
    todayBlocks: [],
    todayOpenMinutes: 0,
    todayDoneCount: 0,
    missed: [],
    nextExam: null,
    daysToNextExam: null,
    upcoming: [],
    periods: periodRows(),
    todayLessons: [],
    hasTimetable: false,
    nextLesson: null,
    todayHomework: [],
    openHomework: [],
    homeworkCounts: { open: 0, overdue: 0, dueToday: 0 },
    // Leerer Notenstand: dayLine und findNextLesson rechnen nicht mit ihm,
    // aber HomeData verlangt das Feld — und eine ausgedachte Zahl hätte in
    // einer Vorgabe nichts zu suchen, die von "nichts eingetragen" ausgeht.
    grades: {
      overall: null,
      gradeCount: 0,
      gradedSubjects: 0,
      latest: null,
      perSubject: [],
    },
    ...overrides,
  };
}

describe("dayLine", () => {
  it("zählt Stunden und Lernblöcke", () => {
    assert.equal(
      dayLine(
        homeData({
          hasTimetable: true,
          todayLessons: [lesson(1, 1), lesson(1, 2), lesson(1, 3)],
          todayBlocks: blocks(2),
        }),
      ),
      "3 Stunden, 2 Lernblöcke",
    );
  });

  it("beugt die Einzahl richtig", () => {
    assert.equal(
      dayLine(
        homeData({
          hasTimetable: true,
          todayLessons: [lesson(1, 1)],
          todayBlocks: blocks(1),
        }),
      ),
      "1 Stunde, 1 Lernblock",
    );
  });

  it("sagt am Wochenende Wochenende statt null Stunden", () => {
    assert.equal(
      dayLine(homeData({ today: SATURDAY, hasTimetable: true })),
      "Wochenende, kein Lernblock",
    );
  });

  it("lässt den Stundenteil weg, solange kein Plan eingetragen ist", () => {
    // "keine Stunde" klänge, als wüsste die App, dass heute wirklich keine ist.
    assert.equal(dayLine(homeData({ todayBlocks: blocks(1) })), "1 Lernblock");
    assert.equal(dayLine(homeData()), "kein Lernblock");
  });

  it("nennt einen freien Schultag beim Namen, wenn ein Plan steht", () => {
    assert.equal(
      dayLine(homeData({ hasTimetable: true })),
      "keine Stunde, kein Lernblock",
    );
  });
});
