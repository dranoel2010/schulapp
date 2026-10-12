"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/kombi/form";
import { AbbrechenKnopf, FertigBeiErfolg, useNachAktion } from "@/components/kombi/form/fertig";
import { Field } from "@/components/kombi/form";
import { Input } from "@/components/kombi/form";
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
    <form action={formAction} className="kf-form" noValidate>
      <FertigBeiErfolg marke={state.fertig} toast={subject ? "Gespeichert" : "Fach angelegt"} />
      {state.message ? (
        <p role="alert" className="kf-fehler">
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
        <legend className="kf-label">Farbe</legend>

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
                    "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
                    selected &&
                      "scale-110 ring-2 ring-ink ring-offset-2 ring-offset-bg",
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
          <p className="mt-1.5 text-[15px] text-error">{state.errors.color}</p>
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
            <p className="text-[15px] text-ink-2" aria-live="polite">
              <span className="font-[560] text-ink">
                {weightWritten}&nbsp;%
              </span>{" "}
              schriftlich ·{" "}
              <span className="font-[560] text-ink">
                {100 - weightWritten}&nbsp;%
              </span>{" "}
              mündlich
            </p>
          </div>
        )}
      </Field>

      <div className="foot">
        <AbbrechenKnopf />
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
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

/** Archivieren und Löschen — bewusst unten und getrennt. */
export function SubjectDangerZone({
  subjectName,
  archived,
  archiveAction,
  deleteAction,
}: SubjectDangerZoneProps) {
  const [confirming, setConfirming] = useState(false);
  const { zurueck, heim } = useNachAktion();

  return (
    <section>
      <h3 className="p-lab">{archived ? "Wieder mitmachen" : "Nicht mehr im Alltag"}</h3>
      <p className="p-sub">
        {archived
          ? `${subjectName} ist archiviert: es zählt nicht mehr im Schnitt und wird nirgends mehr vorgeschlagen. Alles, was daran hängt — Noten, Termine, Stunden und Blätter —, ist weiter da und sichtbar.`
          : `Archivieren blendet ${subjectName} aus dem Alltag aus — Noten, Termine und Blätter bleiben erhalten. Das ist der richtige Weg für ein abgewähltes Fach.`}
      </p>
      <form
        action={async () => {
          await archiveAction();
          zurueck(archived ? `${subjectName} wieder aufgenommen` : `${subjectName} archiviert`);
        }}
      >
        <SubmitButton variant="secondary">{archived ? "Fach wieder aktivieren" : "Fach archivieren"}</SubmitButton>
      </form>

      <h3 className="p-lab">Löschen</h3>
      {confirming ? (
        <div>
          {/* Die Aufzählung gibt sich als vollständig — dann muss sie es auch
              sein: mit den Klausuren gehen auch ihre Abruf-Bausteine, mit den
              Blättern ihre Aufnahmen (cascade über das Fach). */}
          <p className="p-sub" style={{ color: "var(--ink)" }}>
            {subjectName} wirklich löschen? Damit ist das Fach weg — und mit ihm
            sofort alle Klausuren samt Lernplan, alle Stundenplan-Einträge, alle
            Hausaufgaben, alle Noten und alle Blätter, die daran hängen. Mit den
            Klausuren gehen auch die Bausteine des Abrufs, die zu ihnen gebaut
            wurden, samt ihren Terminen. Mit den Blättern gehen auch ihre
            Aufnahmen, und ein zweites Mal abfotografieren lässt sich eine Tafel
            von letzter Woche nicht. Rückgängig geht das nicht. Wer nur ein
            abgewähltes Fach loswerden will, archiviert es: dann bleiben die
            Noten für den Schnitt vergangener Halbjahre da.
          </p>
          <div className="foot" style={{ marginTop: 12 }}>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Doch nicht
            </Button>
            <form
              style={{ flex: 1, display: "flex" }}
              action={async () => {
                await deleteAction();
                heim(`${subjectName} gelöscht`);
              }}
            >
              <SubmitButton variant="danger">Endgültig löschen</SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <Button type="button" variant="ghost" style={{ color: "var(--error)" }} onClick={() => setConfirming(true)}>
          Fach löschen
        </Button>
      )}
    </section>
  );
}
