import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { addDays, formatGerman, todayInBerlin } from "@/lib/dates";
import { getHomework } from "@/lib/homework";
import { listSubjects } from "@/lib/subjects";

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

  const active = await listSubjects(user.id);
  // Hängt die Aufgabe an einem archivierten Fach, fehlte es sonst in der
  // Auswahl — und beim Speichern stünde plötzlich ein anderes Fach dort.
  const subjects = active.some((subject) => subject.id === item.subject.id)
    ? active
    : [item.subject, ...active];

  const today = todayInBerlin();

  return (
    <div className="kf-seite">
      <header className="">
        <h2 className="p-title">{item.title}</h2>
        <p className="p-sub">
          {`${item.subject.name} · ${item.done ? `erledigt, fällig war ${formatGerman(item.dueDate)}` : `fällig ${formatGerman(item.dueDate)}`}`}
        </p>
      </header>

      <HomeworkForm
        action={updateHomeworkAction.bind(null, item.id)}
        subjects={subjects}
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
