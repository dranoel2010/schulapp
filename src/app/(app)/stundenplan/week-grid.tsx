"use client";

import Link from "next/link";
import { useState } from "react";
import { subjectColor } from "@/lib/colors";
import { addDays, germanShortParts } from "@/lib/dates";
import type { WeekPlan } from "@/lib/timetable";

type Weekday = WeekPlan["days"][number]["weekday"];
const WEEKDAYS: { value: Weekday; short: string; long: string }[] = [
  { value: 1, short: "Mo", long: "Montag" },
  { value: 2, short: "Di", long: "Dienstag" },
  { value: 3, short: "Mi", long: "Mittwoch" },
  { value: 4, short: "Do", long: "Donnerstag" },
  { value: 5, short: "Fr", long: "Freitag" },
];
type Lesson = WeekPlan["days"][number]["lessons"][number];
export type WeekGridProps = {
  days: WeekPlan["days"];
  rowCount: number;
  todayWeekday: number | null;
  monday: string;
  times: WeekPlan["periods"];
};

/** Am Handy lesbare Tageskarten; das vollständige Wochenraster bleibt umschaltbar. */
export function WeekGrid({ days, rowCount, todayWeekday, monday, times }: WeekGridProps) {
  const [selected, setSelected] = useState<Weekday>((todayWeekday ?? 1) as Weekday);
  const [mode, setMode] = useState<"day" | "week">("day");
  const slots = Array.from({ length: rowCount }, (_, index) => index + 1);
  const byDay = new Map(days.map((day) => [day.weekday, new Map(day.lessons.map((lesson) => [lesson.period, lesson]))]));
  const selectedDay = WEEKDAYS.find((day) => day.value === selected)!;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 md:hidden">
        <p className="text-sm font-medium">Deine Schulwoche</p>
        <div role="group" aria-label="Stundenplanansicht" className="flex gap-1 rounded-control border border-border bg-surface p-1">
          {(["day", "week"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`min-h-11 rounded-[10px] px-4 text-sm ${mode === value ? "bg-accent text-accent-foreground" : "text-muted"}`}>{value === "day" ? "Tag" : "Woche"}</button>)}
        </div>
      </div>
      <div className={`${mode === "day" ? "" : "hidden"} space-y-4 md:hidden`}>
        <div role="group" aria-label="Wochentag" className="grid grid-cols-5 gap-2">
          {WEEKDAYS.map((day, index) => <button key={day.value} type="button" aria-pressed={selected === day.value} aria-label={day.long} onClick={() => setSelected(day.value)} className={`flex min-h-16 flex-col items-center justify-center rounded-control border text-sm ${selected === day.value ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-muted"}`}><span className="font-semibold">{day.short}</span><span className="text-xs">{germanShortParts(addDays(monday, index)).dayMonth}</span></button>)}
        </div>
        <h2 className="text-base font-semibold">{selectedDay.long}{selected === todayWeekday ? " · Heute" : ""}</h2>
        <ol className="space-y-2">
          {slots.map((period) => {
            const lesson = byDay.get(selected)?.get(period);
            const time = times.find((entry) => entry.number === period);
            const room = lesson?.room ?? lesson?.subject.room;
            return <li key={period}><Link href={`/stundenplan/${selected}/${period}`} className="flex min-h-20 items-center gap-4 rounded-card border border-border bg-surface p-4 hover:border-accent">
              <span className="w-12 shrink-0 text-center"><span className="block text-sm font-semibold">{period}.</span><span className="text-[11px] tabular-nums text-muted">{time?.startsAt}</span></span>
              <span aria-hidden="true" className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: lesson ? subjectColor(lesson.subject.color).hex : "var(--border)" }} />
              <span className="min-w-0 flex-1"><span className="block break-words font-medium">{lesson?.subject.name ?? "Freie Stunde"}</span><span className="block text-xs text-muted">{lesson ? [room ? `Raum ${room}` : null, lesson.subject.teacher].filter(Boolean).join(" · ") : "Antippen zum Eintragen"}</span></span>
              <span aria-hidden="true" className="text-muted">{lesson ? "↗" : "+"}</span>
            </Link></li>;
          })}
        </ol>
      </div>
      <div className={`${mode === "week" ? "" : "hidden"} rounded-card border border-border bg-surface p-3 md:block md:p-5`}>
        <div className="grid grid-cols-[22px_repeat(5,minmax(0,1fr))] gap-1.5 md:grid-cols-[40px_repeat(5,minmax(0,1fr))] md:gap-3">
          <span />
          {WEEKDAYS.map((day) => <span key={day.value} className={`pb-3 text-center text-xs font-semibold ${day.value === todayWeekday ? "text-accent" : "text-muted"}`}>{day.short}</span>)}
          {slots.map((period) => <PeriodRow key={period} period={period} byDay={byDay} todayWeekday={todayWeekday} />)}
        </div>
        <p className="mt-4 text-xs text-muted">Ein Feld antippen, um eine Stunde einzutragen oder zu bearbeiten.</p>
      </div>
    </div>
  );
}

function PeriodRow({ period, byDay, todayWeekday }: { period: number; byDay: Map<number, Map<number, Lesson>>; todayWeekday: number | null }) {
  return <><span className="self-center text-center text-xs text-muted">{period}</span>{WEEKDAYS.map((day) => <Cell key={day.value} dayLong={day.long} weekday={day.value} period={period} lesson={byDay.get(day.value)?.get(period)} isToday={day.value === todayWeekday} />)}</>;
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
        className="flex min-h-14 items-center justify-center rounded-control border border-dashed border-border text-subtle transition-colors hover:bg-accent-soft"
      ><span aria-hidden="true" className="text-lg">+</span></Link>
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
      style={{ color: `color-mix(in oklab, ${color.hex} 65%, var(--foreground))`, backgroundColor: `color-mix(in oklab, ${color.hex} 10%, var(--surface))` }}
      className={`flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border border-border bg-surface-muted px-1 py-1.5 text-center text-xs font-medium transition-colors hover:bg-border md:rounded-[10px] md:px-2.5 md:py-2 md:text-left md:text-[13px] ${
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
