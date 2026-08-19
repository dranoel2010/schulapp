import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getSubject } from "@/lib/subjects";

import {
  deleteSubjectAction,
  setArchivedAction,
  updateSubjectAction,
} from "../actions";
import { SubjectDangerZone, SubjectForm } from "../subject-form";

export const metadata: Metadata = {
  title: "Fach bearbeiten",
};

export default async function EditSubjectPage({
  params,
}: PageProps<"/faecher/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const subject = await getSubject(user.id, id);
  if (!subject) {
    notFound();
  }

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          {subject.name}
        </h1>
        <p className="text-sm text-muted">
          {subject.archived
            ? "Dieses Fach ist archiviert."
            : "Änderungen gelten überall, wo das Fach auftaucht."}
        </p>
      </header>

      <SubjectForm
        action={updateSubjectAction.bind(null, subject.id)}
        subject={subject}
        submitLabel="Änderungen speichern"
      />

      <SubjectDangerZone
        subjectName={subject.name}
        archived={subject.archived}
        archiveAction={setArchivedAction.bind(
          null,
          subject.id,
          !subject.archived,
        )}
        deleteAction={deleteSubjectAction.bind(null, subject.id)}
      />
    </div>
  );
}
