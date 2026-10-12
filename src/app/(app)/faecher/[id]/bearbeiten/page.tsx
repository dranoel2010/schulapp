import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SeitenKopf } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { getSubject } from "@/lib/subjects";

import { deleteSubjectAction, setArchivedAction, updateSubjectAction } from "../../actions";
import { SubjectDangerZone, SubjectForm } from "../../subject-form";

/**
 * Fach bearbeiten (Plan 2.2, Zeile `fach`): Name, Kürzel, Farbe, Lehrer,
 * Raum, Gewichtung, darunter Archivieren und Löschen. Erreichbar über
 * „Fach bearbeiten“ auf der Fachseite.
 */

export const metadata: Metadata = {
  title: "Fach bearbeiten",
};

export default async function EditSubjectPage({ params }: PageProps<"/faecher/[id]/bearbeiten">) {
  const user = await requireUser();
  const { id } = await params;

  const subject = await getSubject(user.id, id);
  if (!subject) {
    notFound();
  }

  return (
    <>
      <SeitenKopf
        titel={`${subject.name} bearbeiten`}
        sub={subject.archived ? "Dieses Fach ist archiviert." : "Änderungen gelten überall, wo das Fach auftaucht."}
      />
      <div style={{ marginTop: 16 }}>
        <SubjectForm action={updateSubjectAction.bind(null, subject.id)} subject={subject} submitLabel="Speichern" />
      </div>
      <SubjectDangerZone
        subjectName={subject.name}
        archived={subject.archived}
        archiveAction={setArchivedAction.bind(null, subject.id, !subject.archived)}
        deleteAction={deleteSubjectAction.bind(null, subject.id)}
      />
    </>
  );
}
