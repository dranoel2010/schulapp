import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { listSubjects } from "@/lib/subjects";
import {
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

/**
 * Welches Fach die App für den laufenden Hauptunterricht hält.
 *
 * Geraten wird über die erste Stunde: das Fach, das dort an den meisten Tagen
 * steht. Das ist nur eine Vorbelegung der Auswahl — trifft sie nicht zu, stellt
 * man sie in einem Griff um, und die Liste darunter füllt sich neu.
 */
function guessEpochSubject(lessons: EpochLesson[]): string | null {
  const zaehler = new Map<string, number>();

  for (const lesson of lessons) {
    // Die erste Stunde ist an einer Waldorfschule der Hauptunterricht.
    if (!lesson.period.startsWith("1.")) continue;
    zaehler.set(lesson.subjectId, (zaehler.get(lesson.subjectId) ?? 0) + 1);
  }

  let bestes: string | null = null;
  let meiste = 0;

  for (const [subjectId, anzahl] of zaehler) {
    if (anzahl > meiste) {
      meiste = anzahl;
      bestes = subjectId;
    }
  }

  return bestes;
}

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
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link
          href="/stundenplan"
          className="text-sm text-muted hover:text-foreground"
        >
          ← Stundenplan
        </Link>
        <h1 className="text-xl font-semibold text-foreground">
          Epoche wechseln
        </h1>
        <p className="text-sm text-muted">
          Trägt den Hauptunterricht in einem Zug auf ein anderes Fach um, statt
          jedes Feld einzeln anzutippen.
        </p>
      </div>

      {lessons.length === 0 ? (
        <p className="rounded-control border border-border bg-surface-muted px-3.5 py-3 text-sm text-muted">
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
          defaultFromSubjectId={guessEpochSubject(lessons)}
        />
      )}
    </div>
  );
}
