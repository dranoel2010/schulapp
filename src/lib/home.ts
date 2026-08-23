import { count, eq } from "drizzle-orm";

import { db } from "@/db";
import { subjects, type Period, type Subject } from "@/db/schema";
import { addDays, daysBetween, timeInBerlin } from "@/lib/dates";
import {
  blocksForDay,
  listExams,
  missedBlocks,
  type ExamListItem,
  type TodayBlock,
} from "@/lib/exams";
import { gradeSummary, type GradeSummary } from "@/lib/grades";
import {
  homeworkForRange,
  listHomework,
  openHomeworkCount,
  type HomeworkItem,
} from "@/lib/homework";
import { listMaterialCards, type MaterialCard } from "@/lib/materials";
import { countOpenProposals } from "@/lib/proposals";
import { listSubjects } from "@/lib/subjects";
import {
  isSchoolDay,
  loadWeek,
  periodTimes,
  weekdayOf,
  type LessonWithSubject,
  type WeekPlan,
} from "@/lib/timetable";

/**
 * Alles, was die Startseite anzeigt — einmal geladen, von allen vier Ansichten
 * benutzt: am Handy der Kameraseite, dem Kachelmenü und der Tagesspur, am
 * großen Bildschirm dem Dashboard. Alle zeigen dieselben Zahlen, nur anders
 * angeordnet.
 *
 * Deshalb steht hier bewusst etwas mehr, als jede einzelne Ansicht braucht:
 * eine zweite Abfrage je Ansicht wäre teurer als ein paar Zeilen zu viel im
 * Ergebnis.
 */

/**
 * So viele Blätter holt die Startseite mit.
 *
 * Sie zeigt sie an zwei Stellen: auf der Kamera-Seite als das, was zuletzt
 * aufgenommen wurde — dort stehen alle sechs —, und im Dashboard als kürzerer
 * Ausschnitt daraus. Die ganze Ablage liegt unter /material; die Startseite
 * lädt sie nicht, nur weil sie sechs Bilder braucht.
 *
 * Es ist eine Liste für beide, und sie ist nach dem Zeitpunkt der Aufnahme
 * sortiert. Der Dashboard-Ausschnitt zeigt damit dieselbe Reihe wie die
 * Kamera-Seite und nicht die der Ablage; das ist die Reihenfolge, die zu
 * „zuletzt aufgenommen" gehört, und zwei getrennte Abfragen für sechs Kacheln
 * wären es nicht wert.
 */
const RECENT_MATERIALS = 6;

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
  /**
   * Die aktiven Fächer, in der Reihenfolge der Fächerliste.
   *
   * Die Kacheln kommen mit `subjectCount` aus, die Kamera-Seite nicht: schlägt
   * der Stundenplan kein Fach vor, entscheidet der Nutzer dort selbst, und dazu
   * muss er die Namen lesen können. Die Liste steht deshalb hier und nicht in
   * der Seite — hier lädt sie neben den anderen Abfragen, dort hinge sie hinter
   * ihnen allen am kritischen Pfad von "/".
   *
   * Ihre Länge ist nicht `subjectCount`: der zählt auch die abgewählten Fächer
   * mit, hier stehen nur die, in die heute noch etwas hineingehört.
   */
  subjects: Subject[];
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
  /** Gesamtschnitt, Schnitt je Fach und die zuletzt eingetragene Note */
  grades: GradeSummary;
  /**
   * Die zuletzt aufgenommenen Blätter, das zuletzt fotografierte zuerst.
   *
   * Sortiert nach dem Zeitpunkt der Aufnahme und ausdrücklich nicht nach dem
   * Schultag. Die Ablage unter /material tut das andersherum, weil man dort
   * nach Unterricht sucht; hier ist die Reihe eine Bestätigung — das eben
   * ausgelöste Foto muss vorne stehen, auch wenn das Blatt von letzter Woche
   * ist und sechs Blätter mit jüngerem Schultag darauf warten.
   *
   * Ohne ihre Themen: die beiden Ansichten, die Blätter überhaupt zeigen —
   * Kamera-Seite und Dashboard —, zeigen keins davon. `MaterialCard` lässt das
   * Feld deshalb ganz weg, statt es leer zu liefern — leer hieße „dieses
   * Blatt hat kein Thema“, und das wäre in den allermeisten Fällen unwahr. So
   * spart die Startseite den Join über die Themen, und der Compiler hält fest,
   * dass hier niemand liest, was gar nicht geladen wurde.
   */
  materials: MaterialCard[];
  /**
   * Wie viele Vorschläge im Eingangskorb auf eine Antwort warten.
   *
   * Nur die Zahl und nicht die Vorschläge selbst: die Startseite zeigt keinen
   * einzigen davon. Sie sagt, dass etwas liegt, und führt hin — entschieden
   * wird im Korb, wo das Blatt danebensteht und das Formular darunter. Eine
   * Karte, die man von der Startseite aus wegtippen könnte, wäre genau die
   * Abkürzung, die es hier nicht geben soll.
   */
  openProposals: number;
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
    activeSubjects,
    exams,
    todayBlocks,
    missed,
    week,
    todayHomework,
    openHomework,
    homeworkCounts,
    grades,
    materials,
    openProposals,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(subjects)
      .where(eq(subjects.userId, userId)),
    listSubjects(userId),
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
    gradeSummary(userId),
    listMaterialCards(userId, { limit: RECENT_MATERIALS, order: "aufnahme" }),
    countOpenProposals(userId),
  ]);

  const upcoming = exams.filter((exam) => exam.date >= today);
  const nextExam = upcoming[0] ?? null;
  const todayWeekday = weekdayOf(today);

  return {
    userName,
    today,
    subjectCount: subjectRows[0]?.value ?? 0,
    subjects: activeSubjects,
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
    grades,
    materials,
    openProposals,
  };
}

/**
 * Wie viele Noten hinter dem angezeigten Schnitt stecken.
 *
 * Nicht `GradeSummary.gradeCount` nehmen: der zählt auch die Noten
 * archivierter Fächer mit, während `overall` und `perSubject` sie weglassen.
 * „Ø 2,3 aus 14 Noten“ verspräche dann eine Rechnung, die in Wahrheit nur elf
 * dieser Noten kennt. Neben dem Schnitt steht deshalb genau das, was in ihn
 * eingegangen ist: die Noten der Fächer aus `perSubject`.
 */
export function countedGrades(grades: GradeSummary): number {
  return grades.perSubject.reduce((sum, entry) => sum + entry.count, 0);
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

/** Nur die vier Spalten, die eine Aufnahme vom Fach braucht. */
function subjectRef(subject: LessonWithSubject["subject"]) {
  return {
    id: subject.id,
    name: subject.name,
    short: subject.short,
    color: subject.color,
  };
}

/**
 * Das Fach, das die Aufnahme vorschlägt: die Stunde, die gerade läuft, sonst
 * die, die heute als nächste kommt.
 *
 * Ein Blatt wird im Unterricht abfotografiert, also stimmt das Fach fast immer
 * mit der laufenden Stunde überein. In der Pause ist es die Stunde, die gleich
 * beginnt — man hält das Blatt aus der letzten Stunde in der Hand, aber getippt
 * wird meist erst, wenn man wieder sitzt.
 *
 * Was heute nicht mehr kommt, wird nicht vorgeschlagen: das Fach von morgen
 * wäre geraten. Ein leeres Feld verlangt eine Antwort und fällt auf; ein falsch
 * vorbelegtes rutscht unbemerkt durch und die Ablage füllt sich mit Blättern
 * unter dem falschen Fach.
 *
 * Aus demselben Grund bleibt ein abgewähltes Fach draußen, auch wenn seine
 * Stunde noch im Wochenraster steht.
 *
 * Die Uhrzeit steht als Vorgabe im Kopf, damit die Kamera-Seite sie nicht
 * eigens ausrechnen muss und ein Test sie trotzdem setzen kann — wie bei
 * `loadHomeData`. Im Browser darf sie nicht gezogen werden, dort stünde die
 * Gerätezeitzone gegen die der Datenbank.
 */
export function captureSubject(
  data: HomeData,
  now: string = timeInBerlin(),
): { id: string; name: string; short: string; color: string } | null {
  const times = periodTimes(data.periods);

  for (const lesson of data.todayLessons) {
    // Ein abgewähltes Fach schlägt die App nicht vor. Seine Stunden bleiben im
    // Wochenraster stehen (siehe `listLessons` in @/lib/timetable) — das ist
    // dort richtig, hier wäre es falsch: wer ein Fach zumacht, will kein
    // frisches Blatt mehr darin ablegen, und in der Ablage taucht es danach
    // unter keinem Fach-Chip mehr auf.
    if (lesson.subject.archived) continue;

    const period = times.get(lesson.period);

    // Eine Stunde ohne Zeile im Raster hat weder Beginn noch Ende. Ob sie
    // gerade läuft, lässt sich nicht sagen — also sagt die App es nicht.
    if (!period) continue;

    // Der Beginn zählt mit, das Ende nicht: um Punkt 08:00 sitzt man schon in
    // der Stunde, um Punkt 08:45 ist sie vorbei.
    if (period.startsAt <= now && now < period.endsAt) {
      return subjectRef(lesson.subject);
    }
  }

  const next = data.nextLesson;
  if (next && next.isToday && !next.lesson.subject.archived) {
    return subjectRef(next.lesson.subject);
  }

  return null;
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
