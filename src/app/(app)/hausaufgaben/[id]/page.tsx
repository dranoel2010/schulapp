import type { Metadata } from "next";
import Link from "next/link";
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
    <div className="space-y-6 md:max-w-3xl">
      <Link
        href="/hausaufgaben"
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
        Alle Aufgaben
      </Link>

      <header className="rounded-card border border-border bg-surface p-5 sm:p-6">
        <p className="text-sm text-muted">{item.subject.name}</p>

        <h1 className="mt-1.5 text-xl font-semibold text-foreground">
          {item.title}
        </h1>

        <p className="mt-1 text-muted">
          {item.done
            ? `Erledigt · fällig war ${formatGerman(item.dueDate)}`
            : `Fällig ${formatGerman(item.dueDate)}`}
        </p>
      </header>

      <HomeworkForm
        action={updateHomeworkAction.bind(null, item.id)}
        subjects={subjects}
        fallbackDueDate={addDays(today, 1)}
        item={item}
        submitLabel="Änderungen speichern"
        cancelHref="/hausaufgaben"
      />

      <HomeworkDangerZone
        homeworkLabel={`${item.subject.name} · ${item.title}`}
        deleteAction={deleteHomeworkAction.bind(null, item.id)}
      />
    </div>
  );
}
