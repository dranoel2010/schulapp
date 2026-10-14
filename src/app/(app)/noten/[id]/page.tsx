import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { formatGerman } from "@/lib/dates";
import { appTag, jetzt } from "@/lib/tag";
import { gradeLabel } from "@/lib/grade-scale";
import { getGrade } from "@/lib/grades";
import { listSubjects } from "@/lib/subjects";

import { deleteGradeAction, updateGradeAction } from "../actions";
import { GradeDangerZone, GradeForm } from "../grade-form";

/**
 * Eine Note antippen heißt: sie bearbeiten. Hier stehen ihre Angaben — Fach,
 * Wert, Art, Gewicht, Tag, Anlass — und ganz unten das Löschen.
 *
 * Zurück geht es nicht in die große Liste, sondern in das Fach: von dort kommt
 * man, und dort steht der Schnitt, den die Änderung gerade verschoben hat.
 */

export const metadata: Metadata = {
  title: "Note bearbeiten",
};

/** Die Art in Worten, wie im Formular. */
const KIND_LABELS: Record<string, string> = {
  schriftlich: "Schriftlich",
  muendlich: "Mündlich",
};

/** Das Gewicht in Worten, wie im Formular — „2“ allein sagte hier nichts. */
const WEIGHT_LABELS: Record<number, string> = {
  1: "zählt einfach",
  2: "zählt doppelt",
  3: "zählt dreifach",
  4: "zählt vierfach",
  5: "zählt fünffach",
};

export default async function GradePage({ params }: PageProps<"/noten/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const item = await getGrade(user.id, id);
  if (!item) {
    notFound();
  }

  const active = await listSubjects(user.id);
  // Hängt die Note an einem archivierten Fach, fehlte es sonst in der Auswahl —
  // und beim Speichern stünde plötzlich ein anderes Fach dort.
  const subjects = active.some((subject) => subject.id === item.subject.id)
    ? active
    : [item.subject, ...active];

  const label = gradeLabel(item.value);
  const kindLabel = KIND_LABELS[item.kind] ?? "Schriftlich";
  const weightLabel =
    WEIGHT_LABELS[item.weight] ?? `zählt ${item.weight}-fach`;

  return (
    <div className="kf-seite">
      <header>
        <h2 className="p-title">{`${label} in ${item.subject.name}`}</h2>
        <p className="p-sub">
          {[item.title, formatGerman(item.date), kindLabel, weightLabel].filter(Boolean).join(" · ")}
        </p>
      </header>

      <GradeForm
        action={updateGradeAction.bind(null, item.id)}
        subjects={subjects}
        // Beim Bearbeiten gilt der gespeicherte Tag; heute ist nur der Rückfall,
        // falls das Feld leer geräumt wird.
        defaultDate={appTag(await jetzt())}
        item={item}
        submitLabel="Speichern"
      />

      <GradeDangerZone
        gradeLabel={[item.subject.name, label, item.title]
          .filter(Boolean)
          .join(" · ")}
        deleteAction={deleteGradeAction.bind(null, item.id)}
      />
    </div>
  );
}
