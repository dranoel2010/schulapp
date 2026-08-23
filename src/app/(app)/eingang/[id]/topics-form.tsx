"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { TopicInput, TopicSuggestions } from "@/components/material/topic-chips";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { TopicItem } from "@/lib/subject-topics";

/**
 * Das Formular, mit dem ein Themen-Vorschlag übernommen wird.
 *
 * Es zeigt **die ganze künftige Themenliste des Blattes** und nicht nur das
 * Vorgeschlagene: was schon am Blatt hängt, steht mit drin und ist ausgewählt.
 * Das ist keine Bequemlichkeit, sondern die Wahrheit über den Knopf.
 * `setMaterialTopics()` ersetzt die Menge, es fügt nicht hinzu — stünden hier
 * nur die drei neuen Themen, nähme „Übernehmen“ dem Blatt still die zwei
 * weg, die vorher daran hingen.
 *
 * Deshalb steht auch der Satz darunter, und zwar in dieser Richtung: er sagt,
 * was nach dem Tippen am Blatt steht, nicht was der Agent vorschlägt. Der
 * Vorschlag ist zu diesem Zeitpunkt schon Vergangenheit; entscheidend ist das,
 * was gleich gespeichert wird.
 *
 * Der Griff selbst ist derselbe wie auf der Seite des Blattes — dasselbe
 * Bauteil, dieselben Regeln fürs Falten von Dubletten.
 */

export type TopicsFormState = {
  message?: string;
  errors?: { topics?: string };
};

const EMPTY_STATE: TopicsFormState = {};

export type TopicsFormProps = {
  action: (
    state: TopicsFormState,
    formData: FormData,
  ) => Promise<TopicsFormState>;
  /** Was am Blatt hängen soll: das Vorhandene und das Vorgeschlagene zusammen. */
  topics: string[];
  /** Das Vokabular des Fachs, als antippbare Chips unter dem Feld. */
  suggestions: TopicItem[];
};

export function TopicsForm({ action, topics, suggestions }: TopicsFormProps) {
  const [chosen, setChosen] = useState(topics);
  const [state, formAction] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.message ? (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      <Field
        id="themen"
        label="Themen"
        hint="Danach stehen genau diese Themen am Blatt — was du hier wegnimmst, hängt nicht mehr daran."
        error={state.errors?.topics}
      >
        {(control) => (
          <div className="space-y-3">
            <TopicInput
              {...control}
              name="themen"
              topics={chosen}
              onTopicsChange={setChosen}
            />
            <TopicSuggestions
              suggestions={suggestions}
              topics={chosen}
              onTopicsChange={setChosen}
            />
          </div>
        )}
      </Field>

      <div className="flex gap-3 pt-2">
        <SubmitButton />
        <ButtonLink href="/eingang" variant="secondary">
          Abbrechen
        </ButtonLink>
      </div>
    </form>
  );
}

/**
 * Der Knopf merkt selbst, dass sein Formular läuft. `useActionState` gibt zwar
 * auch ein `pending` heraus, aber es säße dann im Elternteil und der Knopf
 * bekäme es durchgereicht — `useFormStatus` fragt an Ort und Stelle.
 */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending} className="flex-1">
      Übernehmen
    </Button>
  );
}
