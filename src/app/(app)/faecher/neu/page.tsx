import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";

import { createSubjectAction } from "../actions";
import { SubjectForm } from "../subject-form";

export const metadata: Metadata = {
  title: "Neues Fach",
};

export default async function NewSubjectPage() {
  await requireUser();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Neues Fach</h1>
        <p className="text-sm text-muted">
          Kürzel und Farbe tauchen später als Kachel im Stundenplan wieder auf.
        </p>
      </header>

      <SubjectForm action={createSubjectAction} submitLabel="Fach anlegen" />
    </div>
  );
}
