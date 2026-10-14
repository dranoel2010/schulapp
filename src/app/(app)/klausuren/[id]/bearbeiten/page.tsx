import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { formatGerman } from "@/lib/dates";
import { getExam } from "@/lib/exams";
import { listSubjects } from "@/lib/subjects";
import { suggestTopicsForExam } from "@/lib/subject-topics";
import { appTag, jetzt } from "@/lib/tag";
import { anhangZuKlausur } from "@/recall/items";

import { deleteExamAction, updateExamAction } from "../../actions";
import { ExamDangerZone, ExamForm } from "../../exam-form";

/**
 * Eine Prüfung antippen heißt: sie bearbeiten. Hier stehen ihre Daten —
 * Fach, Art, Titel, Datum, Themen, Lernplanung, Notizen — und ganz unten das
 * Löschen. Der Lernplan selbst steht auf der Klausurseite `/klausuren/[id]`.
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
}: PageProps<"/klausuren/[id]/bearbeiten">) {
  const user = await requireUser();
  const { id } = await params;

  const detail = await getExam(user.id, id);
  if (!detail) {
    notFound();
  }

  const { exam, subject, topics, blocks } = detail;
  // App-Tag wie beim Speichern: bis 4 Uhr gilt der Vortag
  const heute = appTag(await jetzt());

  const active = await listSubjects(user.id);

  // Was am Löschen hängt — für den Warnsatz weiter unten. Die vierte Stelle,
  // an der die Schulapp den Abrufkern kennt (neben Navigation, Startseiten-
  // Kachel und der Zahl auf /abruf), und sie ist unvermeidlich: Ein Knopf, der
  // aufzählt, was verschwindet, muss die Bausteine kennen.
  const anhang = await anhangZuKlausur(user.id, id);
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

  const kindLabel = EXAM_KIND_LABELS[exam.kind] ?? "Prüfung";
  const label = exam.title ? `${subject.name} · ${exam.title}` : subject.name;

  return (
    <div className="kf-seite">

      <header>
        <h2 className="p-title">{`${subject.name} bearbeiten`}</h2>
        <p className="p-sub">
          {[exam.title ?? kindLabel, formatGerman(exam.date)].join(" · ")}. Änderungen an Datum, Themen oder Lernplanung
          verteilen den Lernplan neu; was du schon abgehakt hast, bleibt erledigt.
        </p>
      </header>

      <ExamForm
        action={updateExamAction.bind(null, exam.id)}
        subjects={subjects}
        today={heute}
        topicSuggestions={topicSuggestions}
        exam={exam}
        topics={topics.map((topic) => topic.title)}
        submitLabel="Speichern"
      />

      <ExamDangerZone
        examLabel={label}
        blockCount={blocks.length}
        bausteinCount={anhang.bausteine}
        offeneTermine={anhang.offeneTermine}
        deleteAction={deleteExamAction.bind(null, exam.id)}
      />
    </div>
  );
}
