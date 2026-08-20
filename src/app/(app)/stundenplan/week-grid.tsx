import Link from "next/link";

import { subjectColor } from "@/lib/colors";
import { addDays, germanShortParts } from "@/lib/dates";
import { WEEKDAYS, type WeekPlan } from "@/lib/timetable";

/**
 * Das Wochenraster: Mo–Fr in Spalten, die Stunden in Zeilen.
 *
 * Reine Anzeige, deshalb Server Component — jede Zelle ist nur ein Link auf
 * ihr Feld. Auch die leeren: ein freies Feld füllt man, indem man es antippt,
 * einen eigenen „Stunde eintragen“-Knopf gibt es bewusst nicht.
 *
 * Handy und Rechner zeigen dasselbe Raster, der Rechner hat mehr Platz und
 * zeigt deshalb zusätzlich den Raum und das Datum in der Kopfzeile.
 *
 * Doppelstunden bleiben hier zwei Felder. Zusammengefasst werden sie erst in
 * der Tagesansicht (`mergeDoubleLessons`); im Wochenraster stünde eine
 * Kachel über zwei Zeilen quer zu allen anderen.
 */

/** Eine Stunde mit ihrem Fach, so wie loadWeek sie liefert. */
type Lesson = WeekPlan["days"][number]["lessons"][number];

/**
 * Die Spaltenbreiten aus dem Entwurf: am Handy 26px für die Stundennummer und
 * 4px Abstand, am Rechner 54px und 8px. Die Zeile steht an drei Stellen
 * (Kopfzeile und Raster), deshalb einmal hier.
 */
const COLUMNS =
  "grid grid-cols-[26px_repeat(5,1fr)] gap-1 md:grid-cols-[54px_repeat(5,1fr)] md:gap-2";

export type WeekGridProps = {
  /** Alle fünf Tage, auch die leeren — sonst hätte das Raster mal drei Spalten. */
  days: WeekPlan["days"];
  /** So viele Stunden-Zeilen werden gezeichnet, immer beginnend bei 1. */
  rowCount: number;
  /** Der heutige Wochentag (1–5) oder null am Wochenende. */
  todayWeekday: number | null;
  /** Der Montag dieser Woche als "YYYY-MM-DD" — daraus entstehen die Datumsangaben. */
  monday: string;
};

export function WeekGrid({
  days,
  rowCount,
  todayWeekday,
  monday,
}: WeekGridProps) {
  const periods = Array.from({ length: rowCount }, (_, index) => index + 1);

  // Nachschlagen statt suchen: das Raster fragt bis zu 60-mal nach einem Feld.
  const byDay = new Map(
    days.map((day) => [
      day.weekday,
      new Map(day.lessons.map((lesson) => [lesson.period, lesson])),
    ]),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-card border-border bg-surface md:border md:p-4">
      <div className={`${COLUMNS} pb-1.5 md:pb-2`}>
        <span />
        {WEEKDAYS.map((day, index) => {
          const isToday = day.value === todayWeekday;

          return (
            <span
              key={day.value}
              className={`text-center text-[11px] md:text-left md:text-[13px] ${
                isToday
                  ? "font-semibold text-accent"
                  : "text-subtle md:text-muted"
              }`}
            >
              {day.short}
              {/* Erst ab md ist Platz für das Datum — am Handy bliebe vom
                  Tageskürzel sonst nichts übrig. Und auch dort nur "7.9.",
                  der Monatsname passte nicht in die Spalte. */}
              <span className="max-md:hidden">
                {" "}
                {germanShortParts(addDays(monday, index)).dayMonth}
              </span>
            </span>
          );
        })}
      </div>

      {/* Das Raster füllt die Resthöhe und teilt sie gleichmäßig auf (1fr).
          Die 40px Untergrenze sind für den Daumen: bei zehn Stunden auf einem
          kleinen Bildschirm wären die Zeilen sonst kaum noch zu treffen.
          Sie unterschreiten bewusst die 44px, die sonst überall für
          Tippflächen gelten — der ganze Plan soll ohne Scrollen auf den
          Bildschirm passen, und ein Feld, das man suchen muss, ist schlechter
          zu treffen als eines, das vier Pixel zu flach ist. */}
      <div className={`${COLUMNS} min-h-0 flex-1 auto-rows-[minmax(40px,1fr)]`}>
        {periods.map((period) => (
          <PeriodRow
            key={period}
            period={period}
            byDay={byDay}
            todayWeekday={todayWeekday}
          />
        ))}
      </div>
    </div>
  );
}

/** Eine Zeile: die Stundennummer und die fünf Felder daneben. */
function PeriodRow({
  period,
  byDay,
  todayWeekday,
}: {
  period: number;
  byDay: Map<number, Map<number, Lesson>>;
  todayWeekday: number | null;
}) {
  return (
    <>
      <span className="self-center pr-0.5 text-right font-mono text-[10px] tabular-nums text-subtle md:pr-1 md:text-[13px]">
        {period}
      </span>

      {WEEKDAYS.map((day) => (
        <Cell
          key={day.value}
          dayLong={day.long}
          weekday={day.value}
          period={period}
          lesson={byDay.get(day.value)?.get(period)}
          isToday={day.value === todayWeekday}
        />
      ))}
    </>
  );
}

function Cell({
  dayLong,
  weekday,
  period,
  lesson,
  isToday,
}: {
  dayLong: string;
  weekday: number;
  period: number;
  lesson: Lesson | undefined;
  isToday: boolean;
}) {
  const href = `/stundenplan/${weekday}/${period}`;

  if (!lesson) {
    return (
      <Link
        href={href}
        aria-label={`${dayLong}, ${period}. Stunde, frei`}
        className="rounded-lg bg-surface-muted/50 transition-colors hover:bg-surface-muted md:rounded-[10px] md:bg-transparent md:hover:bg-surface-muted"
      />
    );
  }

  // Der Raum der Stunde gewinnt, der des Fachs ist die Vorgabe.
  const room = lesson.room ?? lesson.subject.room;
  const color = subjectColor(lesson.subject.color);
  const label = [
    `${dayLong}, ${period}. Stunde`,
    lesson.subject.name,
    room ? `Raum ${room}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Link
      href={href}
      aria-label={label}
      style={{ color: color.hex }}
      className={`flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg bg-surface-muted px-1 py-1.5 text-center text-[10px] font-medium transition-colors hover:bg-border md:rounded-[10px] md:px-2.5 md:py-2 md:text-left md:text-[13px] ${
        isToday ? "outline-2 outline-accent" : ""
      }`}
    >
      <span className="truncate">{lesson.subject.short}</span>

      {/* Am Handy ist für den Raum kein Platz — dort steht er erst im
          Formular hinter der Zelle. */}
      {room ? (
        <span className="truncate text-[11px] font-normal text-muted max-md:hidden">
          {room}
        </span>
      ) : null}
    </Link>
  );
}
