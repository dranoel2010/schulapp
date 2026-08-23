"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { TopicInput, TopicSuggestions } from "@/components/material/topic-chips";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { ProposalKind } from "@/db/schema";
import type { TopicItem } from "@/lib/subject-topics";

/**
 * Ein Vorschlag von Hand.
 *
 * **Warum es diese Seite gibt.** Die Regel des Projekts lautet: alles, was der
 * Agent kann, muss auch von Hand gehen. Ohne diese Seite hinge der ganze
 * Eingangskorb daran, dass ein Agent angeschlossen ist — man könnte ihn nicht
 * ausprobieren, nicht verstehen und nach einem Abschalten nicht mehr benutzen.
 *
 * Nützlich ist sie unabhängig davon: im Unterricht bleiben zwei Sekunden für
 * das Foto. Dass auf dem Blatt eine Aufgabe steht, weiß man in dem Moment und
 * hat es abends vergessen. Ein Vorschlag kostet nichts und ändert nichts, bis
 * man ihn übernimmt — er ist genau der richtige Zettel dafür.
 *
 * **Ein Formular und nicht drei.** Die Art steht als Auswahl obenan, und
 * darunter erscheinen genau die Felder, die zu ihr gehören. Drei Seiten für
 * drei Arten wären dreimal dasselbe Blatt und dieselbe Begründung darüber.
 * Die Felder der anderen Arten stehen dabei nicht bloß versteckt herum,
 * sondern sind gar nicht erst da: ein verstecktes Feld schickt trotzdem mit,
 * und im Vorschlag stünde dann, was zu einer anderen Art gehört.
 */

export type NewProposalState = {
  /** Hinweis über dem Formular, wenn es nicht an einem einzelnen Feld liegt. */
  message?: string;
  errors?: {
    materialId?: string;
    kind?: string;
    /** Alles, was am Inhalt liegt — die Felder wechseln mit der Art. */
    payload?: string;
  };
};

const EMPTY_STATE: NewProposalState = {};

/** Ein Blatt, wie es in der Auswahl steht. */
export type ProposalMaterialOption = {
  id: string;
  /** „Ma · Blatt vom 21.8.“ */
  label: string;
  subjectId: string;
};

const KIND_OPTIONS: { value: ProposalKind; label: string; hint: string }[] = [
  {
    value: "themen",
    label: "Themen",
    hint: "Worum es auf dem Blatt geht. Übernommen hängen sie am Blatt.",
  },
  {
    value: "hausaufgabe",
    label: "Hausaufgabe",
    hint: "Was auf dem Blatt aufgegeben ist. Das Fach kommt vom Blatt.",
  },
  {
    value: "klausur",
    label: "Termin",
    hint: "Eine Prüfung, die auf dem Blatt angekündigt ist.",
  },
];

const EXAM_KIND_OPTIONS = [
  { value: "klausur", label: "Klausur" },
  { value: "test", label: "Test" },
  { value: "referat", label: "Referat" },
  { value: "muendlich", label: "Mündliche Prüfung" },
];

export type NewProposalFormProps = {
  action: (
    state: NewProposalState,
    formData: FormData,
  ) => Promise<NewProposalState>;
  materials: ProposalMaterialOption[];
  /** Das vorgewählte Blatt, wenn man von einem Blatt hierherkam. */
  defaultMaterialId?: string;
  /** Je Fach sein Vokabular, auf dem Server einmal vorgerechnet. */
  topicSuggestions: Record<string, TopicItem[]>;
  /**
   * `REASON_MAX` aus @/lib/proposals — als Prop und nicht als Import.
   *
   * Diese Datei läuft im Browser, und @/lib/proposals fasst die Datenbank an;
   * ein Wert von dort zöge sie ins Bundle. Die Zahl noch einmal hinzuschreiben
   * wäre die zweite Stelle, an der sie steht — also reicht sie der Server
   * herein, so wie er auch `fallbackDueDate` hereinreicht.
   */
  reasonMax: number;
};

export function NewProposalForm({
  action,
  materials,
  defaultMaterialId,
  topicSuggestions,
  reasonMax,
}: NewProposalFormProps) {
  const [materialId, setMaterialId] = useState(
    defaultMaterialId && materials.some((item) => item.id === defaultMaterialId)
      ? defaultMaterialId
      : (materials[0]?.id ?? ""),
  );
  const [kind, setKind] = useState<ProposalKind>("themen");
  const [topics, setTopics] = useState<string[]>([]);
  const [examTopics, setExamTopics] = useState<string[]>([]);

  const [state, formAction] = useActionState(action, EMPTY_STATE);

  const subjectId =
    materials.find((item) => item.id === materialId)?.subjectId ?? "";
  const suggestions = topicSuggestions[subjectId] ?? [];
  const kindHint = KIND_OPTIONS.find((item) => item.value === kind)?.hint;

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
        id="materialId"
        label="Blatt"
        hint="Jeder Vorschlag hängt an einem Blatt — er sagt, was daraus werden soll."
        error={state.errors?.materialId}
      >
        {(control) => (
          <Select
            {...control}
            name="materialId"
            value={materialId}
            onChange={(event) => setMaterialId(event.target.value)}
          >
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="kind" label="Art" hint={kindHint} error={state.errors?.kind}>
        {(control) => (
          <Select
            {...control}
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as ProposalKind)}
          >
            {KIND_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {kind === "themen" ? (
        <Field id="themen" label="Themen" error={state.errors?.payload}>
          {(control) => (
            <div className="space-y-3">
              <TopicInput
                {...control}
                name="themen"
                topics={topics}
                onTopicsChange={setTopics}
              />
              <TopicSuggestions
                suggestions={suggestions}
                topics={topics}
                onTopicsChange={setTopics}
              />
            </div>
          )}
        </Field>
      ) : null}

      {kind === "hausaufgabe" ? (
        <>
          <Field id="titel" label="Aufgabe" error={state.errors?.payload}>
            {(control) => (
              <Input
                {...control}
                name="titel"
                placeholder="S. 42 Nr. 3–7"
                maxLength={120}
                autoComplete="off"
              />
            )}
          </Field>

          <Field
            id="faellig"
            label="Fällig"
            optional
            hint="Leer lassen, wenn auf dem Blatt kein Tag steht — beim Übernehmen wird die nächste Stunde des Fachs vorgeschlagen."
          >
            {(control) => <Input {...control} type="date" name="faellig" />}
          </Field>

          <Field id="notiz" label="Notiz" optional>
            {(control) => (
              <Textarea {...control} name="notiz" rows={3} maxLength={2000} />
            )}
          </Field>
        </>
      ) : null}

      {kind === "klausur" ? (
        <>
          <Field id="datum" label="Wann" error={state.errors?.payload}>
            {(control) => <Input {...control} type="date" name="datum" />}
          </Field>

          <Field id="art" label="Was für eine Prüfung">
            {(control) => (
              <Select {...control} name="art" defaultValue="klausur">
                {EXAM_KIND_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            id="klausurTitel"
            label="Titel"
            optional
            hint="Nur wenn das Fach allein zu wenig sagt, z.B. „Analysis“."
          >
            {(control) => (
              <Input
                {...control}
                name="klausurTitel"
                maxLength={80}
                autoComplete="off"
              />
            )}
          </Field>

          <Field id="klausurThemen" label="Themen" optional>
            {(control) => (
              <div className="space-y-3">
                <TopicInput
                  {...control}
                  name="klausurThemen"
                  topics={examTopics}
                  onTopicsChange={setExamTopics}
                />
                <TopicSuggestions
                  suggestions={suggestions}
                  topics={examTopics}
                  onTopicsChange={setExamTopics}
                />
              </div>
            )}
          </Field>
        </>
      ) : null}

      <Field
        id="reason"
        label="Warum"
        optional
        hint="Ein Satz für später: woran du das festgemacht hast."
      >
        {(control) => (
          <Input
            {...control}
            name="reason"
            maxLength={reasonMax}
            autoComplete="off"
          />
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

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending} className="flex-1">
      In den Korb legen
    </Button>
  );
}
