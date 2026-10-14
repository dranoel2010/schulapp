import type { Metadata } from "next";

import { SeitenKopf } from "@/components/kombi/form";
import { TextLine } from "@/components/kombi/seiten/zeilen";
import { requireUser } from "@/lib/auth";
import { addDays, formatGerman } from "@/lib/dates";
import { freeLabel, listFreePeriods } from "@/lib/free-days";
import { listSubjects } from "@/lib/subjects";
import { appTag, jetzt } from "@/lib/tag";
import { isDefaultPeriods, isoWeekNumber, loadWeek, weekdayOf } from "@/lib/timetable";

import { WeekGrid } from "../week-grid";

/**
 * Den Stundenplan bearbeiten (Plan 2.2, Zeile `woche`): das Wochenraster Mo–Fr
 * zum Antippen, jedes Feld führt in sein Formular. Darunter die Stundenzeiten
 * und „Epoche wechseln“. Erreichbar aus der Woche und aus den Einstellungen.
 *
 * Der Plan ist fest und wiederholt sich; die Kalenderwoche oben ist reine
 * Beschriftung.
 */

export const metadata: Metadata = {
  title: "Stundenplan bearbeiten",
};

/** So viele Zeilen zeichnet das Raster mindestens — so viel Schule ist ein normaler Tag. */
const MIN_ROWS = 6;

export default async function TimetableEditPage() {
  const user = await requireUser();
  // App-Tag wie die übrigen Seiten: bis 4 Uhr gilt noch der Vortag
  const today = appTag(await jetzt());

  const [week, subjects, freePeriods] = await Promise.all([
    loadWeek(user.id),
    listSubjects(user.id),
    listFreePeriods(user.id, today),
  ]);

  const weekday = weekdayOf(today);
  const todayWeekday = weekday <= 5 ? weekday : null;
  const monday = addDays(today, 1 - weekday);
  const shownMonday = weekday <= 5 ? monday : addDays(monday, 7);
  const shownFriday = addDays(shownMonday, 4);
  const freeThisWeek = freePeriods.filter(
    (period) => period.startsOn <= shownFriday && period.endsOn >= shownMonday,
  );

  const lastUsed = Math.max(
    0,
    ...week.days.flatMap((day) => day.lessons.map((lesson) => lesson.period)),
  );
  const rowCount = Math.min(week.periods.length, Math.max(MIN_ROWS, lastUsed + 1));
  const hasLessons = lastUsed > 0;
  const defaultPeriods = isDefaultPeriods(week.periods);
  const isEmpty = subjects.length === 0 && !hasLessons;

  return (
    <>
      <SeitenKopf titel="Stundenplan bearbeiten" sub={`KW ${isoWeekNumber(today)} · fester Wochenplan, Mo–Fr`} />

      {isEmpty ? (
        <>
          <p className="empty">Jede Stunde gehört zu einem Fach. Sobald deine Fächer stehen, kannst du das Raster füllen.</p>
          <TextLine href="/faecher/neu">Fach anlegen</TextLine>
        </>
      ) : (
        <>
          {freeThisWeek.map((period) => (
            <p key={period.id} className="p-sub">
              {`${freeLabel(period)}: ${
                period.startsOn === period.endsOn
                  ? formatGerman(period.startsOn, "kurz")
                  : `${formatGerman(period.startsOn, "kurz")} bis ${formatGerman(period.endsOn, "kurz")}`
              }. Kein Unterricht.`}
            </p>
          ))}

          {hasLessons ? null : <p className="p-sub">Noch ist alles frei. Tipp ein Feld an, um dort ein Fach einzutragen.</p>}

          <div style={{ marginTop: 14 }}>
            <WeekGrid days={week.days} rowCount={rowCount} todayWeekday={todayWeekday} monday={monday} />
          </div>

          <div style={{ height: 16 }} />
          <TextLine href="/stundenplan/zeiten">
            {defaultPeriods ? "Stundenzeiten · noch die Vorgabe" : "Stundenzeiten"}
          </TextLine>
          <TextLine href="/stundenplan/epoche">Epoche wechseln</TextLine>
        </>
      )}
    </>
  );
}
