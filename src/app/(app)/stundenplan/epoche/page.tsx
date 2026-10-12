import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";
import { listSubjects } from "@/lib/subjects";
import {
  guessEpochSubject,
  loadWeek,
  periodLabel,
  periodTimes,
  slotKey,
  WEEKDAYS,
} from "@/lib/timetable";

import { switchEpochAction } from "../actions";
import { EpochForm, type EpochLesson } from "./epoch-form";

/**
 * Epochenwechsel — den Hauptunterricht auf ein anderes Fach umtragen.
 *
 * Die Seite ist für Waldorfschulen gebaut, wo der Hauptunterricht jeden Morgen
 * auf derselben Stunde liegt und alle paar Wochen das Fach wechselt. Ohne sie
 * wäre jeder Wechsel fünf bis acht Wege durch das Stundenformular.
 *
 * Sie führt kein eigenes Wissen darüber, was „die Epoche" ist — warum nicht,
 * steht am Formular und an `switchEpoch()` in @/lib/timetable.
 */

export const metadata: Metadata = {
  title: "Epoche wechseln",
};

export default async function EpochPage() {
  const user = await requireUser();

  const [week, subjects] = await Promise.all([
    loadWeek(user.id),
    // Auch archivierte: ein zugemachtes Fach kann im Plan stehen, und dann
    // muss es sich auch wieder herausnehmen lassen.
    listSubjects(user.id, { includeArchived: true }),
  ]);

  const times = periodTimes(week.periods);

  // Fertig zum Zeichnen: das Formular ist eine Client-Komponente und darf
  // nichts aus @/lib/timetable importieren — die Datei hängt an der Datenbank,
  // und der Bau zöge sonst `fs` und `net` in das Browser-Bündel.
  const lessons: EpochLesson[] = week.days.flatMap((day) =>
    day.lessons.map((lesson) => {
      const zeit = times.get(lesson.period);
      return {
        key: slotKey(day.weekday, lesson.period),
        subjectId: lesson.subject.id,
        weekday:
          WEEKDAYS.find((eintrag) => eintrag.value === day.weekday)?.short ??
          "?",
        period: periodLabel(lesson.period, lesson.period),
        time: zeit ? `${zeit.startsAt}–${zeit.endsAt}` : null,
      };
    }),
  );

  return (
    <div className="kf-seite">
      <div className="space-y-1">
        <h2 className="p-title">
          Epoche wechseln
        </h2>
        <p className="text-[15px] text-ink-2">
          Trägt den Hauptunterricht in einem Zug auf ein anderes Fach um, statt
          jedes Feld einzeln anzutippen.
        </p>
      </div>

      {lessons.length === 0 ? (
        <p className="p-sub">
          Im Wochenraster steht noch keine Stunde. Trag zuerst deinen
          Stundenplan ein.
        </p>
      ) : (
        <EpochForm
          action={switchEpochAction}
          subjects={subjects.map((subject) => ({
            id: subject.id,
            name: subject.name,
            color: subject.color,
            archived: subject.archived,
          }))}
          lessons={lessons}
          defaultFromSubjectId={guessEpochSubject(
            week.days.flatMap((day) =>
              day.lessons.map((lesson) => ({ period: lesson.period, subjectId: lesson.subject.id })),
            ),
          )}
        />
      )}
    </div>
  );
}
