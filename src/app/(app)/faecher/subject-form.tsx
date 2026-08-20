"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, ButtonLink, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Subject } from "@/db/schema";
import {
  SUBJECT_COLORS,
  subjectColor,
  type SubjectColorKey,
} from "@/lib/colors";
import type { SubjectFormState } from "@/lib/subjects";

const EMPTY_STATE: SubjectFormState = {};

/** Farbe für ein frisch angelegtes Fach — Grau wäre als Vorschlag zu unauffällig. */
const DEFAULT_COLOR: SubjectColorKey = "blue";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * "Mathematik" wird zu "Ma", "Politik/Wirtschaft" zu "PW". Nur ein Vorschlag:
 * sobald der Nutzer selbst tippt, hält sich die Automatik raus.
 */
function suggestShort(name: string): string {
  const words = name.trim().split(/[\s/\-_.]+/).filter(Boolean);
  if (words.length === 0) return "";

  if (words.length === 1) {
    const word = words[0];
    return (word.slice(0, 1).toUpperCase() + word.slice(1, 2).toLowerCase()).slice(0, 4);
  }

  return words
    .slice(0, 4)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join("");
}

export type SubjectFormProps = {
  action: (
    state: SubjectFormState,
    formData: FormData,
  ) => Promise<SubjectFormState>;
  /** Beim Bearbeiten die Vorbelegung, beim Anlegen leer. */
  subject?: Subject;
  submitLabel: string;
};

export function SubjectForm({ action, subject, submitLabel }: SubjectFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  const [name, setName] = useState(subject?.name ?? "");
  const [short, setShort] = useState(subject?.short ?? "");
  // Ein vorhandenes Fach hat sein Kürzel schon — da wird nichts überschrieben.
  const [shortEdited, setShortEdited] = useState(Boolean(subject));
  const [color, setColor] = useState<SubjectColorKey>(
    subject ? subjectColor(subject.color).key : DEFAULT_COLOR,
  );
  const [teacher, setTeacher] = useState(subject?.teacher ?? "");
  const [room, setRoom] = useState(subject?.room ?? "");
  const [weightWritten, setWeightWritten] = useState(
    subject?.weightWritten ?? 50,
  );

  const hex = subjectColor(color).hex;

  function handleName(value: string) {
    setName(value);
    if (!shortEdited) setShort(suggestShort(value));
  }

  function handleShort(value: string) {
    setShort(value);
    // Leert der Nutzer das Feld, darf der Vorschlag wieder übernehmen.
    setShortEdited(value.trim().length > 0);
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

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field id="name" label="Fach" error={state.errors?.name}>
          {(control) => (
            <Input
              {...control}
              name="name"
              value={name}
              onChange={(event) => handleName(event.target.value)}
              placeholder="Mathematik"
              maxLength={60}
              autoComplete="off"
              autoFocus={!subject}
              enterKeyHint="next"
            />
          )}
        </Field>

        <Field
          id="short"
          label="Kürzel"
          hint="Steht später in der Stundenplan-Kachel."
          error={state.errors?.short}
        >
          {(control) => (
            <Input
              {...control}
              name="short"
              value={short}
              onChange={(event) => handleShort(event.target.value)}
              placeholder="Ma"
              maxLength={4}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-foreground">Farbe</legend>

        <div className="mt-2 flex flex-wrap gap-0.5">
          {SUBJECT_COLORS.map((option) => {
            const selected = option.key === color;

            return (
              <label
                key={option.key}
                className="flex size-11 cursor-pointer items-center justify-center rounded-full"
              >
                <input
                  type="radio"
                  name="color"
                  value={option.key}
                  checked={selected}
                  onChange={() => setColor(option.key)}
                  className="peer sr-only"
                />
                <span
                  style={{ backgroundColor: option.hex }}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-transform",
                    "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                    selected &&
                      "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-surface",
                  )}
                >
                  {selected ? (
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="size-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 13 4 4 10-10" />
                    </svg>
                  ) : null}
                </span>
                <span className="sr-only">{option.label}</span>
              </label>
            );
          })}
        </div>

        {state.errors?.color ? (
          <p className="mt-1.5 text-sm text-danger">{state.errors.color}</p>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="teacher"
          label="Lehrkraft"
          optional
          error={state.errors?.teacher}
        >
          {(control) => (
            <Input
              {...control}
              name="teacher"
              value={teacher}
              onChange={(event) => setTeacher(event.target.value)}
              placeholder="Frau Berger"
              maxLength={60}
              autoComplete="off"
            />
          )}
        </Field>

        <Field id="room" label="Raum" optional error={state.errors?.room}>
          {(control) => (
            <Input
              {...control}
              name="room"
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              placeholder="A 214"
              maxLength={20}
              autoComplete="off"
            />
          )}
        </Field>
      </div>

      <Field
        id="weightWritten"
        label="Gewichtung"
        error={state.errors?.weightWritten}
      >
        {(control) => (
          <div className="space-y-1">
            <input
              {...control}
              type="range"
              name="weightWritten"
              min={0}
              max={100}
              step={5}
              value={weightWritten}
              onChange={(event) => setWeightWritten(Number(event.target.value))}
              style={{ accentColor: hex }}
              className="h-11 w-full cursor-pointer"
            />
            <p className="text-sm text-muted" aria-live="polite">
              <span className="font-medium text-foreground">
                {weightWritten}&nbsp;%
              </span>{" "}
              schriftlich ·{" "}
              <span className="font-medium text-foreground">
                {100 - weightWritten}&nbsp;%
              </span>{" "}
              mündlich
            </p>
          </div>
        )}
      </Field>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending} className="flex-1">
          {submitLabel}
        </Button>
        <ButtonLink href="/faecher" variant="secondary">
          Abbrechen
        </ButtonLink>
      </div>
    </form>
  );
}

/** Knopf, der von selbst merkt, dass sein Formular gerade läuft. */
function SubmitButton({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: ButtonProps["variant"];
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} loading={pending}>
      {children}
    </Button>
  );
}

export type SubjectDangerZoneProps = {
  subjectName: string;
  archived: boolean;
  archiveAction: () => Promise<void>;
  deleteAction: () => Promise<void>;
};

/** Archivieren und Löschen — bewusst unten und optisch getrennt. */
export function SubjectDangerZone({
  subjectName,
  archived,
  archiveAction,
  deleteAction,
}: SubjectDangerZoneProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-5">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">
          {archived ? "Wieder mitmachen" : "Nicht mehr im Alltag"}
        </h2>
        <p className="text-sm text-muted">
          {archived
            ? `${subjectName} ist archiviert und taucht nirgends mehr auf. Alles, was daran hängt, ist aber noch da.`
            : `Archivieren blendet ${subjectName} aus dem Alltag aus — Noten und Termine bleiben erhalten. Das ist der richtige Weg für ein abgewähltes Fach.`}
        </p>
        <form action={archiveAction}>
          <SubmitButton variant="secondary">
            {archived ? "Fach wieder aktivieren" : "Fach archivieren"}
          </SubmitButton>
        </form>
      </div>

      <hr className="border-border" />

      {confirming ? (
        <div className="space-y-3 rounded-control border border-danger/40 bg-danger-soft p-3.5">
          <p className="text-sm text-foreground">
            {subjectName} wirklich löschen? Damit ist das Fach weg — und mit ihm
            sofort alle Klausuren samt Lernplan, alle Stundenplan-Einträge und
            alle Hausaufgaben, die daran hängen. Noten kommen später dazu und
            gingen dann genauso mit. Rückgängig geht das nicht.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={deleteAction}>
              <SubmitButton variant="danger">Ja, endgültig löschen</SubmitButton>
            </form>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Doch nicht
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="text-danger hover:bg-danger-soft hover:text-danger"
          onClick={() => setConfirming(true)}
        >
          Fach löschen
        </Button>
      )}
    </section>
  );
}
