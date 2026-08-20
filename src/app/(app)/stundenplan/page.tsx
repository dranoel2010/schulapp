import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { addDays, todayInBerlin } from "@/lib/dates";
import { listSubjects } from "@/lib/subjects";
import {
  isDefaultPeriods,
  isoWeekNumber,
  loadWeek,
  weekdayOf,
} from "@/lib/timetable";

import { WeekGrid } from "./week-grid";

/**
 * Der Stundenplan als Wochenraster, Mo–Fr.
 *
 * Es gibt kein Blättern zwischen Wochen: der Plan ist fest und wiederholt
 * sich, die Kalenderwoche oben ist reine Beschriftung. Ein Feld antippen
 * heißt, es zu bearbeiten — deshalb führt auch jede leere Zelle irgendwohin
 * und es braucht keinen „Stunde eintragen“-Knopf.
 *
 * Die Uhrzeiten stehen bewusst nicht im Raster; sie sind unter
 * /stundenplan/zeiten einstellbar und tauchen erst in der Tagesansicht auf.
 */

export const metadata: Metadata = {
  title: "Stundenplan",
};

/**
 * So viele Zeilen zeichnet das Raster, solange nicht mehr belegt sind — so
 * viel Schule ist ein normaler Tag, und ein Plan, der bei der dritten Stunde
 * aufhört, sieht abgeschnitten aus. Es ist ein Wunsch, keine Zusage: ist das
 * eingestellte Stundenraster kürzer, sind es entsprechend weniger Zeilen.
 */
const MIN_ROWS = 6;

export default async function TimetablePage() {
  const user = await requireUser();
  const today = todayInBerlin();

  const [week, subjects] = await Promise.all([
    loadWeek(user.id),
    listSubjects(user.id),
  ]);

  const weekday = weekdayOf(today);
  // Am Wochenende leuchtet kein Tag: der Montag ist dann nicht „heute“,
  // sondern der übernächste Tag.
  const todayWeekday = weekday <= 5 ? weekday : null;
  const monday = addDays(today, 1 - weekday);

  const lastUsed = Math.max(
    0,
    ...week.days.flatMap((day) => day.lessons.map((lesson) => lesson.period)),
  );

  // Sechs Zeilen als Boden, darüber immer eine Zeile mehr als die letzte
  // belegte Stunde — die bleibt sichtbar und antippbar, damit man den Plan
  // nach unten verlängern kann. Über das eingestellte Raster hinaus wächst
  // er nicht: eine siebte Stunde gibt es erst, wenn sie unter
  // /stundenplan/zeiten eine Uhrzeit hat.
  const rowCount = Math.min(
    week.periods.length,
    Math.max(MIN_ROWS, lastUsed + 1),
  );

  const hasLessons = lastUsed > 0;
  const defaultPeriods = isDefaultPeriods(week.periods);

  // Sind alle Fächer archiviert, bleiben die eingetragenen Stunden trotzdem im
  // Plan stehen (siehe listLessons). Dann hier den leeren Zustand zu zeigen
  // hieße, einen Wochenplan zu verstecken, den es gibt.
  const isEmpty = subjects.length === 0 && !hasLessons;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 md:max-w-3xl">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Stundenplan</h1>
        <p className="text-sm text-muted">
          KW {isoWeekNumber(today)} · fester Wochenplan, Mo–Fr
        </p>
      </div>

      {isEmpty ? (
        <EmptyState
          title="Zuerst die Fächer"
          description="Jede Stunde im Plan gehört zu einem Fach. Sobald deine Fächer stehen, kannst du das Raster füllen."
          action={<ButtonLink href="/faecher">Zu den Fächern</ButtonLink>}
          icon={
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
              <path d="M3.5 9.5h17M9.5 9.5v10" />
            </svg>
          }
        />
      ) : (
        <>
          {hasLessons ? null : (
            <p className="text-sm text-muted">
              Noch ist alles frei. Tipp ein Feld an, um dort ein Fach
              einzutragen.
            </p>
          )}

          <WeekGrid
            days={week.days}
            rowCount={rowCount}
            todayWeekday={todayWeekday}
            monday={monday}
          />

          {/* Die Zeiten sind Nebensache, solange der Plan steht — deshalb ein
              leiser Link und kein Knopf. Steht dort aber noch die Vorgabe aus
              ensurePeriods, hat sie nie jemand bestätigt: der Zusatz sagt das,
              solange es so ist. Auf den Kacheln und in der Tagesspur bliebe
              derselbe Hinweis liegen, ohne je gelesen zu werden — hier führt
              er direkt dorthin, wo man ihn abstellt. */}
          <Link
            href="/stundenplan/zeiten"
            className="-mt-1 inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted transition-colors hover:text-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
            Stundenzeiten
            {defaultPeriods ? (
              <span className="text-subtle">
                · noch die Vorgabe, stell sie auf deine Schule um
              </span>
            ) : null}
          </Link>
        </>
      )}
    </div>
  );
}
