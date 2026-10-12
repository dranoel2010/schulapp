import Link from "next/link";

import { addDays, germanShortParts } from "@/lib/dates";
import { WEEKDAYS, type WeekPlan } from "@/lib/timetable";

/**
 * Das Wochenraster zum Bearbeiten: Mo–Fr in Spalten, die Stunden in Zeilen.
 * Jede Zelle — auch eine leere — führt in ihr Formular; einen eigenen
 * „Stunde eintragen“-Knopf gibt es bewusst nicht.
 *
 * Gestaltung von Modell 23: Fläche `--raise`, Radius 12 wie die Felder,
 * Schrift in `--ink`, heute mit einer 2px-Linie in `--ink`. Fachfarben zeigt
 * die App nirgends mehr (Plan, Frage 8). Jede Zelle ist mindestens 44px hoch.
 *
 * Doppelstunden bleiben hier zwei Felder; zusammengefasst werden sie erst in
 * der Woche.
 */

type Lesson = WeekPlan["days"][number]["lessons"][number];

const SPALTEN = "grid grid-cols-[22px_repeat(5,minmax(0,1fr))] gap-1";

export type WeekGridProps = {
  days: WeekPlan["days"];
  rowCount: number;
  todayWeekday: number | null;
  monday: string;
};

export function WeekGrid({ days, rowCount, todayWeekday, monday }: WeekGridProps) {
  const periods = Array.from({ length: rowCount }, (_, index) => index + 1);
  const byDay = new Map(
    days.map((day) => [day.weekday, new Map(day.lessons.map((lesson) => [lesson.period, lesson]))]),
  );

  return (
    <div>
      <div className={`${SPALTEN} pb-1.5`}>
        <span />
        {WEEKDAYS.map((day, index) => (
          <span
            key={day.value}
            className="text-center text-[13px]"
            style={{
              color: day.value === todayWeekday ? "var(--ink)" : "var(--ink-3)",
              fontWeight: day.value === todayWeekday ? 650 : 560,
            }}
          >
            {day.short}
            <span className="block text-[11px]" style={{ fontWeight: 450 }}>
              {germanShortParts(addDays(monday, index)).dayMonth}
            </span>
          </span>
        ))}
      </div>

      <div className={`${SPALTEN} auto-rows-[minmax(44px,auto)]`}>
        {periods.map((period) => (
          <PeriodRow key={period} period={period} byDay={byDay} todayWeekday={todayWeekday} />
        ))}
      </div>
    </div>
  );
}

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
      <span className="self-center text-right text-[13px] tabular-nums" style={{ color: "var(--ink-3)" }}>
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
  const rahmen = isToday ? "inset 0 0 0 2px var(--ink)" : undefined;

  if (!lesson) {
    return (
      <Link
        href={href}
        aria-label={`${dayLong}, ${period}. Stunde, frei`}
        className="rounded-[12px] transition-opacity active:opacity-60"
        style={{ background: "var(--quiet)", boxShadow: rahmen }}
      />
    );
  }

  const room = lesson.room ?? lesson.subject.room;
  const label = [`${dayLong}, ${period}. Stunde`, lesson.subject.name, room ? `Raum ${room}` : null]
    .filter(Boolean)
    .join(", ");

  return (
    <Link
      href={href}
      aria-label={label}
      className="flex min-w-0 flex-col justify-center overflow-hidden rounded-[12px] px-1 py-1.5 text-center transition-opacity active:opacity-60"
      style={{ background: "var(--raise)", color: "var(--ink)", boxShadow: rahmen }}
    >
      <span className="truncate text-[15px]" style={{ fontWeight: 650 }}>
        {lesson.subject.short}
      </span>
      {room ? (
        <span className="truncate text-[11px]" style={{ color: "var(--ink-2)" }}>
          {room}
        </span>
      ) : null}
    </Link>
  );
}
