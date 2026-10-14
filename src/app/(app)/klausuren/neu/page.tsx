import type { Metadata } from "next";

import { ButtonLink } from "@/components/kombi/form";
import { EmptyState } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { listSubjects } from "@/lib/subjects";
import { suggestTopicsForExam } from "@/lib/subject-topics";
import { appTag, jetzt } from "@/lib/tag";

import { createExamAction } from "../actions";
import { ExamForm } from "../exam-form";

export const metadata: Metadata = {
  title: "Neue Klausur",
};

export default async function NewExamPage() {
  const user = await requireUser();
  // App-Tag wie beim Speichern: bis 4 Uhr gilt der Vortag
  const today = appTag(await jetzt());
  const subjects = await listSubjects(user.id);

  // Ohne Fach kein Formular — die Auswahl wäre leer und nichts ließe sich
  // speichern.
  if (subjects.length === 0) {
    return (
      <div className="kf-seite">
        <header className="space-y-1">
          <h2 className="p-title">
            Neue Klausur
          </h2>
        </header>

        <EmptyState
          title="Zuerst ein Fach"
          description="Jede Prüfung gehört zu einem Fach. Leg eines an, dann geht es hier weiter."
          action={<ButtonLink href="/faecher/neu">Fach anlegen</ButtonLink>}
        />
      </div>
    );
  }

  // Für jedes Fach einmal, nicht für das gerade gewählte: im Formular wechselt
  // das Fach, und für den Wechsel soll keine Abfrage laufen. Als Termin gilt
  // heute — was das für weit verschobene Daten heißt, steht bei
  // topicSuggestions in exam-form.tsx.
  const topicSuggestions = Object.fromEntries(
    await Promise.all(
      subjects.map(
        async (subject) =>
          [
            subject.id,
            await suggestTopicsForExam(user.id, subject.id, today),
          ] as const,
      ),
    ),
  );

  return (
    <div className="kf-seite">
      <header className="space-y-1">
        <h2 className="p-title">Neue Klausur</h2>
        <p className="text-[15px] text-ink-2">
          Termin und Themen eintragen. Den Lernplan baut die App daraus.
        </p>
      </header>

      <ExamForm
        action={createExamAction}
        subjects={subjects}
        today={today}
        topicSuggestions={topicSuggestions}
        submitLabel="Klausur eintragen"
      />
    </div>
  );
}
