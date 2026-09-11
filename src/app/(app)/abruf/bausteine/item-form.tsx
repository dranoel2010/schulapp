"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { splitTranscript } from "@/lib/transcripts";

import type { BausteinFormState } from "../actions";

/**
 * Einen Baustein von Hand anlegen.
 *
 * ── Warum von Hand, wo ein Agent das auch könnte ─────────────────────────────
 *
 * Weil es im Repo als Regel steht: alles, was die App später von selbst kann,
 * muss vorher von Hand gehen. Der Agent kommt in Stufe 1b und geht dann durch
 * dieselbe Tür (`createItem()`) wie dieses Formular — nicht durch eine zweite,
 * die jemand vergessen hat gleich streng zu machen.
 *
 * ── Warum die Abschrift danebensteht ─────────────────────────────────────────
 *
 * Weil A5 verlangt, dass die Frage aus dem Heft stammt, und weil das Zitat
 * wörtlich in der Abschrift stehen muss — sonst weist `createItem()` ab. Die
 * Stelle herauszukopieren ist deshalb der schnellste Weg, und die ⟨spitzen
 * Klammern⟩ bleiben dabei sichtbar: Sie markieren, was schon beim Abschreiben
 * unsicher war, und genau darauf darf keine Frage gebaut werden.
 */

const EMPTY_STATE: BausteinFormState = {};

export type SeitenWahl = {
  pageId: string;
  sortOrder: number;
  transcript: string;
};

export function ItemForm({
  action,
  subjectId,
  seiten,
  zurueckHref,
}: {
  action: (
    state: BausteinFormState,
    formData: FormData,
  ) => Promise<BausteinFormState>;
  subjectId: string;
  seiten: SeitenWahl[];
  zurueckHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [pageId, setPageId] = useState(seiten[0]?.pageId ?? "");
  // Nach einem angelegten Baustein leeren sich die Felder, die Seite bleibt:
  // meistens kommt der nächste Baustein aus derselben Stelle.
  const [runde, setRunde] = useState(0);

  const seite = seiten.find((s) => s.pageId === pageId) ?? seiten[0];
  const teile = seite ? splitTranscript(seite.transcript) : [];

  return (
    <form
      action={formAction}
      className="space-y-6"
      noValidate
      key={state.angelegt ? runde : undefined}
      onSubmit={() => {
        if (state.angelegt) setRunde((r) => r + 1);
      }}
    >
      {state.message ? (
        <p
          role="alert"
          className={
            state.angelegt
              ? "rounded-control border border-success/40 bg-surface-muted px-3.5 py-3 text-sm text-success"
              : "rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger"
          }
        >
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="subjectId" value={subjectId} />

      <Field
        id="pageId"
        label="Seite"
        hint="Die Seite, aus der die Frage stammt. Nur Seiten mit Abschrift stehen hier."
        error={state.errors?.pageId}
      >
        {(control) => (
          <Select
            {...control}
            name="pageId"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
          >
            {seiten.map((s) => (
              <option key={s.pageId} value={s.pageId}>
                Seite {s.sortOrder + 1}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {seite ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Was dasteht</p>
          <div className="max-h-64 overflow-y-auto rounded-control border border-border bg-surface-muted px-3.5 py-3 text-sm whitespace-pre-wrap text-foreground">
            {teile.map((teil, i) =>
              teil.uncertain ? (
                <mark
                  key={i}
                  className="rounded-sm bg-warning/20 px-0.5 text-foreground"
                  title="Beim Abschreiben unsicher — darauf lässt sich keine Frage bauen"
                >
                  {teil.text}
                </mark>
              ) : (
                <span key={i}>{teil.text}</span>
              ),
            )}
          </div>
          <p className="text-xs text-subtle">
            Hervorgehobenes war schon beim Abschreiben unsicher. Ein Zitat, das
            so etwas enthält, wird abgewiesen.
          </p>
        </div>
      ) : null}

      <Field
        id="sourceQuote"
        label="Zitat"
        hint="Die Stelle wörtlich aus dem Text oben — sie muss Zeichen für Zeichen darin vorkommen."
        error={state.errors?.sourceQuote}
      >
        {(control) => (
          <Textarea {...control} name="sourceQuote" rows={3} />
        )}
      </Field>

      <Field
        id="promptFree"
        label="Frage"
        hint="Offen gestellt, nicht zum Ankreuzen — so wie sie in der Klausur stünde."
        error={state.errors?.promptFree}
      >
        {(control) => <Input {...control} name="promptFree" />}
      </Field>

      <Field
        id="solution"
        label="Musterlösung"
        hint="Eine Sinneinheit je Zeile. Was in eigenen Worten dastehen muss, damit es zählt."
        error={state.errors?.solution}
      >
        {(control) => <Textarea {...control} name="solution" rows={4} />}
      </Field>

      <Field
        id="misconception"
        label="Womit man das verwechselt"
        hint="Ein bis zwei Sätze. Ohne sie wird der Baustein nicht ausgeliefert — dieser Teil ist der Unterschied zwischen halber und ganzer Wirkung."
        error={state.errors?.misconception}
      >
        {(control) => <Textarea {...control} name="misconception" rows={2} />}
      </Field>

      <Field
        id="materialKind"
        label="Art"
        hint="Entscheidet später, was miteinander gemischt werden darf — Begriffe werden vom Mischen schlechter, Anschauungen besser."
        error={state.errors?.materialKind}
      >
        {(control) => (
          <Select {...control} name="materialKind" defaultValue="begriff">
            <option value="begriff">Begriff oder Definition</option>
            <option value="anschauung">Anschauung, Beispiel, Bild</option>
            <option value="verfahren">Verfahren, Rechenweg</option>
            <option value="ereignis">Ereignis, Datum, Ablauf</option>
          </Select>
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          Baustein anlegen
        </Button>
        <Link
          href={zurueckHref}
          className="text-sm text-muted underline underline-offset-2"
        >
          Zurück
        </Link>
      </div>
    </form>
  );
}
