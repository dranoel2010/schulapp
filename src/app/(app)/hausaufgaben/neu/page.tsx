import type { Metadata } from "next";

import { ButtonLink } from "@/components/kombi/form";
import { EmptyState } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { appTag, jetzt } from "@/lib/tag";
import { freeDatesFrom } from "@/lib/free-days";
import { listSubjects } from "@/lib/subjects";
import { nextLessonPerSubject } from "@/lib/homework-faellig";
import { listLessons } from "@/lib/timetable";

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

export default async function NewHomeworkPage() {
  const user = await requireUser();
  const today = appTag(await jetzt());

  const [subjects, lessons, freeDays] = await Promise.all([
    listSubjects(user.id),
    listLessons(user.id),
    freeDatesFrom(user.id, today),
  ]);

  // Ohne Fach kein Formular — die Auswahl wäre leer und nichts ließe sich
  // speichern.
  if (subjects.length === 0) {
    return (
      <div className="kf-seite">
        <header className="space-y-1">
          <p className="kf-ober">Hausaufgaben</p>
          <h2 className="p-title">
            Neue Aufgabe
          </h2>
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
    <div className="kf-seite">
      <header className="space-y-1">
        <p className="kf-ober">Hausaufgaben</p>
        <h2 className="p-title">Neue Aufgabe</h2>
        <p className="text-[15px] text-ink-2">
          Fällig zur nächsten Stunde im Fach. Das lässt sich ändern.
        </p>
      </header>

      <HomeworkForm
        action={createHomeworkAction}
        subjects={subjects}
        dueSuggestions={nextLessonPerSubject(lessons, today, new Set(freeDays))}
        fallbackDueDate={addDays(today, 1)}
        submitLabel="Aufgabe eintragen"
      />
    </div>
  );
}
