import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { PROPOSAL_TOPIC_LIMIT } from "@/lib/inbox";
import { getMaterial } from "@/lib/materials";
import { listSubjects } from "@/lib/subjects";

import { createProposalAction } from "../actions";
import { ProposalForm } from "../proposal-form";
import { MaterialGlance } from "../proposal-view";

/**
 * Einen Vorschlag von Hand anlegen.
 *
 * Diese Seite ist der Grund, warum es die ganze Stufe schon ohne Agenten gibt:
 * KONZEPT.md verlangt, dass alles, was ein Agent später vorschlägt, vorher von
 * Hand anzulegen und zu ändern sein muss. Solange niemand hier einen Vorschlag
 * schreiben kann, ist die Bestätigungsseite eine Tür ohne Raum dahinter — und
 * ob sie trägt, merkte man erst, wenn zum ersten Mal ein Agent hindurchginge.
 *
 * Das Blatt steht in der Adresse (?blatt=…) und nicht im Formular. Ein
 * Vorschlag gehört zu genau einem Blatt, und welches das ist, ist keine
 * Angabe, die man beim Ausfüllen noch ändert — es ist die Frage, die man vorher
 * beantwortet hat, indem man im Korb auf die richtige Zeile getippt hat.
 *
 * Oben steht deshalb, um welches Blatt es geht, mit Bild. „Blatt vom 21.8."
 * heißen sie am Anfang alle; ohne die Vorschau schriebe man leicht am falschen
 * entlang.
 */

export const metadata: Metadata = {
  title: "Vorschlag anlegen",
};

/** Ein Parameter kann mehrfach in der Adresse stehen; dann zählt der erste. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewProposalPage({
  searchParams,
}: PageProps<"/material/eingang/neu">) {
  const user = await requireUser();
  const query = await searchParams;

  // Ohne Blatt gibt es hier nichts zu tun, und mit einem fremden oder
  // erfundenen erst recht nicht. Beides endet gleich: die Seite gibt es so
  // nicht. Ein leeres Formular mit einer Fehlermeldung wäre schlechter — es
  // sähe aus, als ließe sich der Vorschlag noch retten.
  const materialId = firstValue(query.blatt);
  const item = materialId ? await getMaterial(user.id, materialId) : null;

  if (!item) {
    notFound();
  }

  const active = await listSubjects(user.id);
  // Hängt das Blatt an einem archivierten Fach, fehlte es sonst in der
  // Auswahl. Dasselbe tut die Blattseite, und aus demselben Grund: das eigene
  // Fach eines Blattes muss vorschlagbar bleiben, sonst wäre der einzige Weg
  // zurück ein Vorschlag auf ein anderes.
  const subjects = active.some((subject) => subject.id === item.subject.id)
    ? active
    : [item.subject, ...active];

  return (
    <div className="space-y-6 md:max-w-3xl">
      <Link
        href="/material/eingang"
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
        Eingangskorb
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          Vorschlag anlegen
        </h1>
        <p className="text-sm text-muted">
          Ein Vorschlag schreibt nichts. Er legt sich neben das Blatt und
          wartet, bis jemand ihn übernimmt — und dann steht das volle Formular
          des Blattes da, vorbelegt und änderbar.
        </p>
      </header>

      <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-medium text-muted">
          Der Vorschlag gilt diesem Blatt
        </h2>

        <MaterialGlance item={item} />
      </section>

      <ProposalForm
        action={createProposalAction.bind(null, item.id)}
        subjects={subjects}
        sheet={{
          subjectName: item.subject.name,
          title: item.title,
          capturedOn: item.capturedOn,
          note: item.note,
          topics: item.topics.map((topic) => topic.title),
        }}
        today={todayInBerlin()}
        topicLimit={PROPOSAL_TOPIC_LIMIT}
        submitLabel="Vorschlag anlegen"
      />
    </div>
  );
}
