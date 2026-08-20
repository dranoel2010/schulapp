import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { getExam } from "@/lib/exams";
import { listSubjects } from "@/lib/subjects";
import { suggestTopicsForExam } from "@/lib/subject-topics";

import { deleteExamAction, updateExamAction } from "../actions";
import { ExamDangerZone, ExamForm } from "../exam-form";

/**
 * Eine Prüfung antippen heißt: sie bearbeiten. Hier stehen ihre Daten —
 * Fach, Art, Titel, Datum, Themen, Lernplanung, Notizen — und ganz unten das
 * Löschen. Der Lernplan selbst gehört nicht hierher: was heute ansteht und was
 * abzuhaken ist, steht unter /lernen.
 */

export const metadata: Metadata = {
  title: "Klausur bearbeiten",
};

/** Die Art einer Prüfung in Worten, wie in der Erinnerungs-Route. */
const EXAM_KIND_LABELS: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "Mündliche Prüfung",
};

export default async function ExamPage({
  params,
}: PageProps<"/klausuren/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const detail = await getExam(user.id, id);
  if (!detail) {
    notFound();
  }

  const { exam, subject, topics, blocks } = detail;

  const active = await listSubjects(user.id);
  // Hängt die Prüfung an einem archivierten Fach, fehlte es sonst in der
  // Auswahl — und beim Speichern stünde plötzlich ein anderes Fach dort.
  const subjects = active.some((item) => item.id === subject.id)
    ? active
    : [subject, ...active];

  // Wie beim Anlegen für jedes Fach einmal, nur mit dem gespeicherten Termin:
  // umstellen kann man das Fach auch hier noch, und dann sollen die Chips schon
  // dastehen. Was das für ein im Formular verschobenes Datum heißt, steht bei
  // topicSuggestions in exam-form.tsx.
  const topicSuggestions = Object.fromEntries(
    await Promise.all(
      subjects.map(
        async (item) =>
          [
            item.id,
            await suggestTopicsForExam(user.id, item.id, exam.date),
          ] as const,
      ),
    ),
  );

  const color = subjectColor(subject.color).hex;
  const kindLabel = EXAM_KIND_LABELS[exam.kind] ?? "Prüfung";
  const label = exam.title ? `${subject.name} · ${exam.title}` : subject.name;

  return (
    <div className="space-y-6 md:max-w-3xl">
      <Link
        href="/klausuren"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 pr-2 text-sm text-muted transition-colors hover:text-foreground"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 6-6 6 6 6" />
        </svg>
        Alle Prüfungen
      </Link>

      <header
        style={{
          backgroundColor: `color-mix(in oklab, ${color} 8%, var(--surface))`,
        }}
        className="rounded-card border border-border p-5 sm:p-6"
      >
        <p className="flex items-center gap-2 text-sm text-muted">
          <span
            aria-hidden="true"
            style={{ backgroundColor: color }}
            className="size-2.5 shrink-0 rounded-full"
          />
          {subject.name}
        </p>

        <h1 className="mt-1.5 text-xl font-semibold text-foreground">
          {exam.title ?? kindLabel}
        </h1>

        <p className="mt-1 text-muted">
          {[exam.title ? kindLabel : null, formatGerman(exam.date)]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <p className="mt-4 text-sm text-muted">
          Änderungen an Datum, Themen oder Lernplanung verteilen den Lernplan
          neu. Was du schon abgehakt hast, bleibt erledigt.
        </p>

        <Link
          href="/lernen"
          className="-ml-1 mt-1 inline-flex min-h-11 items-center gap-1 px-1 text-sm text-accent transition-colors hover:text-accent-hover"
        >
          Lernplan ansehen
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      </header>

      <ExamForm
        action={updateExamAction.bind(null, exam.id)}
        subjects={subjects}
        today={todayInBerlin()}
        topicSuggestions={topicSuggestions}
        exam={exam}
        topics={topics.map((topic) => topic.title)}
        submitLabel="Änderungen speichern"
        cancelHref="/klausuren"
      />

      <ExamDangerZone
        examLabel={label}
        blockCount={blocks.length}
        deleteAction={deleteExamAction.bind(null, exam.id)}
      />
    </div>
  );
}
