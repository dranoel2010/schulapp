import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { listSubjects } from "@/lib/subjects";
import { suggestTopicsForExam } from "@/lib/subject-topics";

import { createExamAction } from "../actions";
import { ExamForm } from "../exam-form";

export const metadata: Metadata = {
  title: "Neue Klausur",
};

export default async function NewExamPage() {
  const user = await requireUser();
  const today = todayInBerlin();
  const subjects = await listSubjects(user.id);

  // Ohne Fach kein Formular — die Auswahl wäre leer und nichts ließe sich
  // speichern.
  if (subjects.length === 0) {
    return (
      <div className="space-y-6 md:max-w-3xl">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">
            Neue Klausur
          </h1>
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
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Neue Klausur</h1>
        <p className="text-sm text-muted">
          Termin und Themen eintragen — den Lernplan baut die App daraus selbst.
        </p>
      </header>

      <ExamForm
        action={createExamAction}
        subjects={subjects}
        today={today}
        topicSuggestions={topicSuggestions}
        submitLabel="Klausur eintragen"
        cancelHref="/klausuren"
      />
    </div>
  );
}
