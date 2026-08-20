import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { addDays, todayInBerlin } from "@/lib/dates";
import { listSubjects } from "@/lib/subjects";
import {
  listLessons,
  nextLessonDate,
  type LessonWithSubject,
} from "@/lib/timetable";

import { createHomeworkAction } from "../actions";
import { HomeworkForm } from "../homework-form";

/**
 * Eine Aufgabe eintragen.
 *
 * Die Fälligkeit ist vorbelegt mit dem Tag der nächsten Stunde in diesem Fach.
 * Genau dafür hängen Stundenplan und Hausaufgaben in derselben Ausbaustufe
 * zusammen: „bis zur nächsten Stunde“ ist die Frist, die man tatsächlich
 * meint, wenn man aufschreibt, was aufgegeben wurde. Ohne Stunde im Plan
 * bleibt morgen.
 */

export const metadata: Metadata = {
  title: "Neue Aufgabe",
};

/**
 * Für jedes Fach der Tag seiner nächsten Stunde.
 *
 * nextLessonDate lässt den heutigen Tag bewusst aus: aufgegeben wird in der
 * Stunde, fällig ist es beim nächsten Mal. Fächer ohne Stunde im Plan tauchen
 * gar nicht erst auf — für sie greift der Rückfall im Formular.
 */
function nextLessonPerSubject(
  lessons: LessonWithSubject[],
  today: string,
): Record<string, string> {
  const weekdays = new Map<string, number[]>();

  for (const lesson of lessons) {
    const days = weekdays.get(lesson.subjectId);
    if (days) days.push(lesson.weekday);
    else weekdays.set(lesson.subjectId, [lesson.weekday]);
  }

  const dates: Record<string, string> = {};

  for (const [subjectId, days] of weekdays) {
    const date = nextLessonDate(today, days);
    if (date) dates[subjectId] = date;
  }

  return dates;
}

export default async function NewHomeworkPage() {
  const user = await requireUser();
  const today = todayInBerlin();

  const [subjects, lessons] = await Promise.all([
    listSubjects(user.id),
    listLessons(user.id),
  ]);

  // Ohne Fach kein Formular — die Auswahl wäre leer und nichts ließe sich
  // speichern.
  if (subjects.length === 0) {
    return (
      <div className="space-y-6 md:max-w-3xl">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">
            Neue Aufgabe
          </h1>
        </header>

        <EmptyState
          title="Zuerst ein Fach"
          description="Jede Aufgabe gehört zu einem Fach. Leg eines an, dann geht es hier weiter."
          action={<ButtonLink href="/faecher/neu">Fach anlegen</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Neue Aufgabe</h1>
        <p className="text-sm text-muted">
          Fällig ist sie vorgeschlagen zur nächsten Stunde in dem Fach — ändern
          kannst du das jederzeit.
        </p>
      </header>

      <HomeworkForm
        action={createHomeworkAction}
        subjects={subjects}
        dueSuggestions={nextLessonPerSubject(lessons, today)}
        fallbackDueDate={addDays(today, 1)}
        submitLabel="Aufgabe eintragen"
        cancelHref="/hausaufgaben"
      />
    </div>
  );
}
