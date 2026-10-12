import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ButtonLink } from "@/components/kombi/form";
import { EmptyState } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { listSubjects } from "@/lib/subjects";
import {
  WEEKDAYS,
  ensurePeriods,
  lessonsForWeekday,
  periodLabel,
} from "@/lib/timetable";

import { deleteLessonAction, saveLessonAction } from "../../actions";
import { LessonForm, type LessonFormSubject } from "./lesson-form";

/**
 * Ein Feld des Wochenrasters antippen heißt: es bearbeiten. Eine Ansicht
 * dazwischen gibt es nicht — in einem Feld stehen ein Fach, ein Raum und
 * vielleicht eine Notiz, das ist das Formular selbst.
 *
 * Welches Feld gemeint ist, steht in der Adresse: /stundenplan/<tag>/<stunde>,
 * Tag 1–5 für Montag bis Freitag. Alles andere gibt es nicht.
 */

export const metadata: Metadata = {
  title: "Stunde bearbeiten",
};

/**
 * Nur eine reine Ziffernfolge zählt. Number(" 3 ") wäre 3 und "+3" auch —
 * damit gäbe es für dasselbe Feld beliebig viele Adressen.
 */
function parseNumber(value: string): number | null {
  return /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

export default async function LessonPage({
  params,
}: PageProps<"/stundenplan/[tag]/[stunde]">) {
  const user = await requireUser();
  const { tag, stunde } = await params;

  const weekday = parseNumber(tag);
  const period = parseNumber(stunde);

  // Tag 6, Stunde 99 oder "abc": dafür gibt es kein Feld im Plan.
  if (weekday === null || period === null || weekday > WEEKDAYS.length) {
    notFound();
  }

  const day = WEEKDAYS[weekday - 1];

  const [periods, active, dayLessons] = await Promise.all([
    ensurePeriods(user.id),
    listSubjects(user.id),
    lessonsForWeekday(user.id, weekday),
  ]);

  // Die Stunde muss es im eingestellten Raster geben, sonst hätte sie keine
  // Uhrzeit und stünde in keinem Wochenraster.
  if (period > periods.length) {
    notFound();
  }

  const lesson = dayLessons.find((entry) => entry.period === period) ?? null;
  const time = periods.find((entry) => entry.number === period);

  const subjects: LessonFormSubject[] = active.map((subject) => ({
    id: subject.id,
    name: subject.name,
    color: subject.color,
    room: subject.room,
  }));

  // Steht hier ein archiviertes Fach, fehlte es sonst in der Auswahl — und
  // beim Speichern stünde plötzlich ein anderes Fach in der Stunde.
  if (lesson && !subjects.some((subject) => subject.id === lesson.subject.id)) {
    subjects.unshift(lesson.subject);
  }

  return (
    <div className="kf-seite">

      <div className="space-y-1">
        <h2 className="p-title">
          {day.long}, {periodLabel(period, period)}
        </h2>

        {time ? (
          <p className="text-[15px] text-ink-2">
            <span className="tabular-nums">
              {time.startsAt} – {time.endsAt}
            </span>{" "}
            ·{" "}
            <Link
              href="/stundenplan/zeiten"
              className="kf-inline text-accent"
            >
              Zeiten ändern
            </Link>
          </p>
        ) : null}
      </div>

      {subjects.length === 0 ? (
        <EmptyState
          title="Zuerst die Fächer"
          description="Eine Stunde ohne Fach gibt es nicht. Leg deine Fächer an, dann kannst du sie hier eintragen."
          action={<ButtonLink href="/faecher">Zu den Fächern</ButtonLink>}
        />
      ) : (
        <LessonForm
          action={saveLessonAction.bind(null, weekday, period)}
          subjects={subjects}
          lesson={
            lesson
              ? {
                  subjectId: lesson.subjectId,
                  room: lesson.room,
                  note: lesson.note,
                }
              : undefined
          }
          removeAction={
            lesson
              ? deleteLessonAction.bind(null, weekday, period)
              : undefined
          }
        />
      )}
    </div>
  );
}
