import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { getExam } from "@/lib/exams";
import { listSubjects } from "@/lib/subjects";

import { deleteExamAction, updateExamAction } from "../../actions";
import { ExamDangerZone, ExamForm } from "../../exam-form";

export const metadata: Metadata = {
  title: "Klausur bearbeiten",
};

export default async function EditExamPage({
  params,
}: PageProps<"/klausuren/[id]/bearbeiten">) {
  const user = await requireUser();
  const { id } = await params;

  const detail = await getExam(user.id, id);
  if (!detail) {
    notFound();
  }

  const active = await listSubjects(user.id);
  // Hängt die Prüfung an einem archivierten Fach, fehlte es sonst in der
  // Auswahl — und beim Speichern stünde plötzlich ein anderes Fach dort.
  const subjects = active.some((subject) => subject.id === detail.subject.id)
    ? active
    : [detail.subject, ...active];

  const label = detail.exam.title
    ? `${detail.subject.name} · ${detail.exam.title}`
    : detail.subject.name;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">{label}</h1>
        <p className="text-sm text-muted">
          Änderungen an Datum, Themen oder Lernplanung verteilen den Lernplan
          neu.
        </p>
      </header>

      <ExamForm
        action={updateExamAction.bind(null, detail.exam.id)}
        subjects={subjects}
        today={todayInBerlin()}
        exam={detail.exam}
        topics={detail.topics.map((topic) => topic.title)}
        submitLabel="Änderungen speichern"
        cancelHref={`/klausuren/${detail.exam.id}`}
      />

      <ExamDangerZone
        examLabel={label}
        blockCount={detail.blocks.length}
        deleteAction={deleteExamAction.bind(null, detail.exam.id)}
      />
    </div>
  );
}
