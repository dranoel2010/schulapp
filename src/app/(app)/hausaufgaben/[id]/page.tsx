import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { addDays, formatGerman } from "@/lib/dates";
import { appTag, jetzt } from "@/lib/tag";
import { getHomework } from "@/lib/homework";
import { freeDatesFrom } from "@/lib/free-days";
import { nextLessonPerSubject } from "@/lib/homework-faellig";
import { listSubjects } from "@/lib/subjects";
import { listLessons } from "@/lib/timetable";

import { deleteHomeworkAction, updateHomeworkAction } from "../actions";
import { HomeworkDangerZone, HomeworkForm } from "../homework-form";

/**
 * Eine Aufgabe antippen heißt: sie bearbeiten. Abgehakt wird sie in der Liste
 * — dort steht das Kästchen, hier stehen ihre Angaben und das Löschen.
 *
 * Anders als beim Anlegen zieht die Fälligkeit hier beim Fachwechsel nicht
 * mit: der Tag wurde einmal gewählt, und ein Fachwechsel beim Bearbeiten ist
 * meist eine Korrektur, kein neuer Anfang.
 */

export const metadata: Metadata = {
  title: "Aufgabe bearbeiten",
};

export default async function HomeworkPage({
  params,
}: PageProps<"/hausaufgaben/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const item = await getHomework(user.id, id);
  if (!item) {
    notFound();
  }

  const today = appTag(await jetzt());
  const [active, lessons, freeDays] = await Promise.all([
    listSubjects(user.id),
    listLessons(user.id),
    freeDatesFrom(user.id, today),
  ]);
  // Hängt die Aufgabe an einem archivierten Fach, fehlte es sonst in der
  // Auswahl — und beim Speichern stünde plötzlich ein anderes Fach dort.
  const subjects = active.some((subject) => subject.id === item.subject.id)
    ? active
    : [item.subject, ...active];

  return (
    <div className="kf-seite">
      <header className="">
        <p className="kf-ober">Aufgabe bearbeiten</p>
        <h2 className="p-title">{item.title}</h2>
        {/* am Rechner stehen Fach und Abgabe als Chips im Formular: dort ohne diese Zeile */}
        <p className="p-sub kf-handy">
          {`${item.subject.name} · ${item.done ? `erledigt, fällig war ${formatGerman(item.dueDate)}` : `fällig ${formatGerman(item.dueDate)}`}`}
        </p>
      </header>

      <HomeworkForm
        action={updateHomeworkAction.bind(null, item.id)}
        subjects={subjects}
        // Beim Bearbeiten zieht der Tag nicht mit (das Datum ist gewählt); am Rechner ist die nächste Stunde ein Chip
        dueSuggestions={nextLessonPerSubject(lessons, today, new Set(freeDays))}
        fallbackDueDate={addDays(today, 1)}
        item={item}
        submitLabel="Speichern"
      />

      <HomeworkDangerZone
        homeworkLabel={`${item.subject.name} · ${item.title}`}
        deleteAction={deleteHomeworkAction.bind(null, item.id)}
      />
    </div>
  );
}
