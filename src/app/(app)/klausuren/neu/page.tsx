import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { listSubjects } from "@/lib/subjects";

import { createExamAction } from "../actions";
import { ExamForm } from "../exam-form";

export const metadata: Metadata = {
  title: "Neue Klausur",
};

export default async function NewExamPage() {
  const user = await requireUser();
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
        today={todayInBerlin()}
        submitLabel="Klausur eintragen"
        cancelHref="/klausuren"
      />
    </div>
  );
}
