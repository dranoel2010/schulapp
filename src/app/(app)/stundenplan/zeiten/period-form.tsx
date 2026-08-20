"use client";

import { useActionState, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Das Stundenraster als Liste: eine Zeile je Stunde, Beginn und Ende
 * änderbar. Hinzufügen und Entfernen passiert erst im Browser; gespeichert
 * wird das ganze Raster auf einmal, weil sich die Nummern sonst bei jedem
 * Schritt verschieben würden.
 *
 * Entfernt wird immer die letzte Stunde. Eine Stunde aus der Mitte
 * herauszunehmen würde alle darunter um eins nach oben ziehen — und damit
 * jede eingetragene Stunde des Wochenplans auf ein anderes Fach schieben.
 *
 * Die Zustandstypen stehen hier und nicht in actions.ts — eine
 * „use server“-Datei darf nur asynchrone Funktionen ausgeben.
 */

/**
 * Fehler je Zeile, nach Stundennummer (1-basiert). Anders als sonst gibt es
 * hier keine festen Feldnamen: die Felder heißen alle gleich, nur ihre Zeile
 * unterscheidet sie.
 */
export type PeriodFieldErrors = Record<number, string>;

/** Rückgabe der Server Action an useActionState. */
export type PeriodFormState = {
  /** Hinweis über dem Formular, wenn es nicht an einer einzelnen Zeile liegt. */
  message?: string;
  errors?: PeriodFieldErrors;
};

const EMPTY_STATE: PeriodFormState = {};

/**
 * Obergrenze und Untergrenze des Rasters. Dieselben Zahlen stehen noch einmal
 * in actions.ts — geprüft wird auf dem Server, hier werden nur die Knöpfe
 * gesperrt, und geteilte Konstanten kann eine „use server“-Datei nicht
 * ausgeben.
 */
const MAX_ROWS = 12;
const MIN_ROWS = 1;

/** Länge einer Stunde und der Pause danach, wenn eine neue vorgeschlagen wird. */
const LESSON_MINUTES = 45;
const BREAK_MINUTES = 5;

type Row = { startsAt: string; endsAt: string };

/** "08:45" + 50 → "09:35". Bleibt am Tagesende stehen statt umzuspringen. */
function addMinutes(time: string, minutes: number): string {
  const [hours, rest] = time.split(":").map(Number);
  const total = Math.min(hours * 60 + rest + minutes, 23 * 60 + 59);

  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

/**
 * Eine neue Stunde beginnt kurz nach der vorigen und dauert eine
 * Schulstunde — ein Vorschlag, damit niemand zwei leere Felder anstarrt.
 */
function suggestRow(previous: Row | undefined): Row {
  const startsAt = previous
    ? addMinutes(previous.endsAt, BREAK_MINUTES)
    : "08:00";

  return { startsAt, endsAt: addMinutes(startsAt, LESSON_MINUTES) };
}

export type PeriodFormProps = {
  action: (
    state: PeriodFormState,
    formData: FormData,
  ) => Promise<PeriodFormState>;
  /** Das gespeicherte Raster, aufsteigend nach Stundennummer. */
  rows: Row[];
};

export function PeriodForm({ action, rows: saved }: PeriodFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [rows, setRows] = useState<Row[]>(saved);

  function setRow(index: number, row: Row) {
    setRows(
      rows.map((current, position) => (position === index ? row : current)),
    );
  }

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

      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        <li className="grid grid-cols-[2rem_1fr_1fr] items-center gap-3 px-4 py-2 text-sm text-subtle">
          <span>Std</span>
          <span>Beginn</span>
          <span>Ende</span>
        </li>

        {rows.map((row, index) => {
          const number = index + 1;
          const error = state.errors?.[number];

          // Die Zeilennummer ist hier die Sache selbst — und hinzugefügt oder
          // entfernt wird nur am Ende, wo der Index nicht verrutscht.
          return (
            <li key={number} className="px-4 py-3">
              <div className="grid grid-cols-[2rem_1fr_1fr] items-center gap-3">
                <span className="font-mono text-sm tabular-nums text-subtle">
                  {number}.
                </span>

                <Input
                  type="time"
                  name="startsAt"
                  value={row.startsAt}
                  aria-label={`Beginn der ${number}. Stunde`}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) =>
                    setRow(index, { ...row, startsAt: event.target.value })
                  }
                />

                <Input
                  type="time"
                  name="endsAt"
                  value={row.endsAt}
                  aria-label={`Ende der ${number}. Stunde`}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) =>
                    setRow(index, { ...row, endsAt: event.target.value })
                  }
                />
              </div>

              {error ? (
                <p role="alert" className="mt-1.5 text-sm text-danger">
                  {error}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={rows.length >= MAX_ROWS}
            onClick={() =>
              setRows([...rows, suggestRow(rows[rows.length - 1])])
            }
          >
            Stunde hinzufügen
          </Button>

          <Button
            type="button"
            variant="ghost"
            disabled={rows.length <= MIN_ROWS}
            onClick={() => setRows(rows.slice(0, -1))}
          >
            Letzte entfernen
          </Button>
        </div>

        <p className="text-sm text-muted">
          Eine entfernte Stunde verschwindet aus dem Wochenraster. Was du dort
          eingetragen hast, bleibt gespeichert und ist wieder da, sobald die
          Stunde zurückkommt.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending} className="flex-1">
          Zeiten speichern
        </Button>
        <ButtonLink href="/stundenplan" variant="secondary">
          Abbrechen
        </ButtonLink>
      </div>
    </form>
  );
}
