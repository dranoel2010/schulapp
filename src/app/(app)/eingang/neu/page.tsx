import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { formatGerman } from "@/lib/dates";
import { listMaterialCards } from "@/lib/materials";
import { REASON_MAX } from "@/lib/proposals";
import { listTopicsForSubjects } from "@/lib/subject-topics";

import { createProposalAction } from "../actions";
import { NewProposalForm, type ProposalMaterialOption } from "./proposal-form";

/**
 * Einen Vorschlag von Hand in den Korb legen.
 *
 * Der Weg, ohne den die Regel des Projekts gebrochen wäre: alles, was der
 * Agent kann, muss auch von Hand gehen. Ohne diese Seite ließe sich der
 * Eingangskorb ohne angeschlossenen Agenten weder ausprobieren noch benutzen.
 *
 * Vorgewählt ist das zuletzt aufgenommene Blatt, oder das aus `?blatt=…` —
 * damit führt ein Weg von einem Blatt hierher, ohne dass man es in einer
 * langen Liste wiedersuchen muss.
 *
 * Zur Wahl stehen die Blätter, die auch in der Ablage stehen: dieselbe
 * Obergrenze, dieselbe Sortierung. Wer ein älteres meint, findet es über die
 * Ablage und kommt mit `?blatt=` zurück.
 */

export const metadata: Metadata = {
  title: "Neuer Vorschlag",
};

/**
 * Ein Parameter kann mehrfach in der Adresse stehen; dann zählt der erste.
 * Alles Unbekannte fällt still auf das neueste Blatt zurück — eine Adresszeile
 * ist kein Formular, sie bekommt keine Fehlermeldung.
 */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewProposalPage({
  searchParams,
}: PageProps<"/eingang/neu">) {
  const user = await requireUser();
  const query = await searchParams;

  const cards = await listMaterialCards(user.id, { order: "aufnahme" });

  if (cards.length === 0) {
    return (
      <div className="space-y-6 md:max-w-3xl">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">
            Neuer Vorschlag
          </h1>
        </header>

        <EmptyState
          title="Zuerst ein Blatt"
          description="Jeder Vorschlag hängt an einem abfotografierten Blatt — er sagt, was daraus werden soll."
          action={<ButtonLink href="/material">Zur Ablage</ButtonLink>}
        />
      </div>
    );
  }

  const materials: ProposalMaterialOption[] = cards.map((card) => ({
    id: card.id,
    label: `${card.subject.short} · ${card.title} · ${formatGerman(card.capturedOn, "kurz")}`,
    subjectId: card.subject.id,
  }));

  // Für jedes Fach einmal, nicht für das gerade gewählte: im Formular wechselt
  // das Blatt und mit ihm das Fach, und für den Wechsel soll keine Abfrage
  // laufen. Gefragt wird nur nach den Fächern, in denen wirklich ein Blatt
  // liegt — die anderen kann das Formular gar nicht anzeigen.
  const subjectIds = [...new Set(cards.map((card) => card.subject.id))];
  const topicSuggestions = Object.fromEntries(
    await listTopicsForSubjects(user.id, subjectIds),
  );

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          Neuer Vorschlag
        </h1>
        <p className="text-sm text-muted">
          Notieren, was auf einem Blatt steht — ohne es gleich einzutragen.
          Entschieden wird später im Korb.
        </p>
      </header>

      <NewProposalForm
        action={createProposalAction}
        materials={materials}
        defaultMaterialId={firstValue(query.blatt)}
        topicSuggestions={topicSuggestions}
        reasonMax={REASON_MAX}
      />
    </div>
  );
}
