"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";

import type { FreePeriodState } from "./actions";

type FreeDaysFormProps = {
  action: (
    state: FreePeriodState,
    formData: FormData,
  ) => Promise<FreePeriodState>;
};

const EMPTY_STATE: FreePeriodState = {};

/**
 * Ferien, Klassenfahrt oder einen einzelnen freien Tag eintragen.
 *
 * Das Ende ist mit dem Anfang vorbelegt, sobald der gewählt ist: ein einzelner
 * freier Tag braucht dann nur ein Datum, und bei einem Zeitraum öffnet der
 * Kalender für das Ende im richtigen Monat.
 */
export function FreeDaysForm({ action }: FreeDaysFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [startsOn, setStartsOn] = useState(state.values?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(state.values?.endsOn ?? "");

  // Nach dem Speichern leeren, sonst trägt ein zweiter Tipp denselben
  // Zeitraum doppelt ein. Bei einem Fehler kommen die Daten vom Server
  // zurück — das Formular selbst hat sie beim Abschicken vergessen.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setStartsOn(state.values?.startsOn ?? "");
    setEndsOn(state.values?.endsOn ?? "");
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.message ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="kind" label="Was ist es?" error={state.errors?.kind}>
          {(control) => (
            <Select {...control} name="kind" defaultValue="ferien">
              <option value="ferien">Ferien</option>
              <option value="klassenfahrt">Klassenfahrt</option>
              <option value="frei">Anderer freier Tag</option>
            </Select>
          )}
        </Field>

        <Field
          id="title"
          label="Name"
          optional
          hint="Zum Beispiel „Herbstferien“."
          error={state.errors?.title}
        >
          {(control) => <Input {...control} name="title" maxLength={60} />}
        </Field>

        <Field id="startsOn" label="Von" error={state.errors?.startsOn}>
          {(control) => (
            <Input
              {...control}
              type="date"
              name="startsOn"
              required
              value={startsOn}
              onChange={(event) => {
                const value = event.target.value;
                setStartsOn(value);
                if (!endsOn || endsOn < value) setEndsOn(value);
              }}
            />
          )}
        </Field>

        <Field
          id="endsOn"
          label="Bis einschließlich"
          error={state.errors?.endsOn}
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              name="endsOn"
              required
              min={startsOn || undefined}
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          )}
        </Field>
      </div>

      <Button type="submit" variant="secondary" loading={pending}>
        Eintragen
      </Button>

      {state.saved ? (
        <p role="status" className="text-sm text-success">
          {state.saved.label} eingetragen.{" "}
          {state.saved.movedExams === 0
            ? "Im Lernplan lag nichts auf diesen Tagen."
            : state.saved.movedExams === 1
              ? "Der Lernplan einer Prüfung ist auf die Tage davor und danach ausgewichen."
              : `Die Lernpläne von ${state.saved.movedExams} Prüfungen sind auf die Tage davor und danach ausgewichen.`}
        </p>
      ) : null}
    </form>
  );
}
