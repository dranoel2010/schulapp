import type { Metadata } from "next";

import { ButtonLink } from "@/components/kombi/form";
import { EmptyState } from "@/components/kombi/form";
import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { listSubjects } from "@/lib/subjects";

import { createGradeAction } from "../actions";
import { GradeForm } from "../grade-form";

/**
 * Eine Note eintragen.
 *
 * Vorbelegt ist nur, was man nicht raten muss: der heutige Tag und — wenn man
 * über „?fach=…“ von einer Fachseite kommt — dieses Fach. Die Note selbst
 * bleibt leer.
 */

export const metadata: Metadata = {
  title: "Neue Note",
};

export default async function NewGradePage({
  searchParams,
}: PageProps<"/noten/neu">) {
  const user = await requireUser();
  const { fach } = await searchParams;

  // Archivierte kommen mit, aber nur zum Nachschlagen: sie stehen nicht zur
  // Auswahl, es sei denn, man kommt gerade von der Seite eines von ihnen.
  const all = await listSubjects(user.id, { includeArchived: true });
  const active = all.filter((subject) => !subject.archived);

  // „?fach=…“ setzt die Fachseite, damit sie „Note in diesem Fach“ anbieten
  // kann. Vorgewählt wird nur, was dem Nutzer auch gehört — eine fremde oder
  // erfundene id bliebe sonst im Feld stehen und ginge mit ab.
  const wanted =
    typeof fach === "string"
      ? all.find((subject) => subject.id === fach)
      : undefined;

  // Ein abgewähltes Fach fehlte sonst in der Auswahl, und beim Speichern stünde
  // plötzlich ein anderes da. Nachtragen soll man auch dort können: die alte
  // Note gab es ja.
  const subjects = wanted?.archived ? [wanted, ...active] : active;

  // Ohne Fach kein Formular — die Auswahl wäre leer und nichts ließe sich
  // speichern.
  if (subjects.length === 0) {
    return (
      <div className="kf-seite">
        <header className="space-y-1">
          <h2 className="p-title">Neue Note</h2>
        </header>

        <EmptyState
          title="Zuerst ein Fach"
          description="Jede Note gehört zu einem Fach. Leg eines an, dann geht es hier weiter."
          action={<ButtonLink href="/faecher/neu">Fach anlegen</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="kf-seite">
      <header className="space-y-1">
        <h2 className="p-title">Neue Note</h2>
        <p className="text-[15px] text-ink-2">
          Eingetragen ist sie für heute — das Datum kannst du ändern, wenn du
          sie nachträgst.
        </p>
      </header>

      <GradeForm
        action={createGradeAction}
        subjects={subjects}
        defaultDate={todayInBerlin()}
        defaultSubjectId={wanted?.id}
        submitLabel="Note eintragen"
      />
    </div>
  );
}
