import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
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

      {/* Der Weg zu den Themen steht zwischen Formular und Gefahrenzone.
          Nach dem Formular, weil die Themen kein Feld des Fachs sind, sondern
          eine eigene Liste, die daran hängt — sie hätten oben nur Platz
          weggenommen. Und davor, weil die Gefahrenzone bewusst zuletzt kommt:
          was dahinter stünde, würde nur noch von jemandem gefunden, der schon
          ans Löschen denkt. */}
      <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
        <h2 className="text-base font-semibold text-foreground">Themen</h2>
        <p className="mt-2 text-sm text-muted">
          Das Themen-Vokabular dieses Fachs — alles, was in seinen Klausuren
          drankam und auf seinen Blättern steht. Hier lassen sich doppelte
          Schreibweisen zusammenlegen und eigene Themen ergänzen.
        </p>
        <ButtonLink
          href={`/faecher/${subject.id}/themen`}
          variant="secondary"
          className="mt-3"
        >
          Themen pflegen
        </ButtonLink>
      </section>

      {/* Das PDF steht hinter den Themen und vor der Gefahrenzone.
          Hinter den Themen, weil beides am Fach hängt, das Pflegen aber vor
          dem Mitnehmen kommt: erst ordnet man, dann druckt man. Und davor aus
          demselben Grund, aus dem die Themen davor stehen — was hinter der
          Gefahrenzone stünde, fände nur noch, wer schon ans Löschen denkt. */}
      <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
        <h2 className="text-base font-semibold text-foreground">
          Blätter als PDF
        </h2>
        <p className="mt-2 text-sm text-muted">
          Alle abgeschriebenen Blätter dieses Fachs in einem Dokument, nach
          Thema geordnet und mit Foto — zum Lernen am Stück oder zum Ausdrucken.
          Blätter ohne Abschrift sind nicht dabei.
        </p>
        {/*
          Ein gewöhnlicher Download-Link und keine Server Action.

          `download` ist hier nicht nur Bequemlichkeit: next/link fängt einen
          Klick ausdrücklich NICHT ab, wenn am Anker dieses Attribut steht
          (link.js, Zeile 56). Ohne das versuchte der Router eine
          Client-Navigation auf eine Adresse, die kein RSC-Ergebnis liefert.

          `prefetch={false}` ist noch wichtiger. Next holt sichtbare Links von
          sich aus vor — und „vorholen" hieße hier: das PDF wird gebaut, sobald
          die Seite auf dem Bildschirm steht. Ein Dokument mit bis zu 40 MB
          Fotos, erzeugt für einen Knopf, den niemand gedrückt hat.
        */}
        <ButtonLink
          href={`/api/fach/${subject.id}/pdf`}
          variant="secondary"
          className="mt-3"
          prefetch={false}
          download
        >
          PDF erzeugen
        </ButtonLink>
      </section>

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
