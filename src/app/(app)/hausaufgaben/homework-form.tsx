"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, ButtonLink, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { Homework, Subject } from "@/db/schema";
import { formatGerman } from "@/lib/dates";
import type { HomeworkInput } from "@/lib/homework";

/**
 * Das Formular für eine Hausaufgabe — Anlegen und Bearbeiten teilen es sich.
 *
 * Vier Felder, mehr gibt das Datenmodell nicht her: Fach, Titel, fällig,
 * Notiz. Der Entwurf zeigt kein Formular; gebaut ist es deshalb wie die
 * bestehenden (siehe exam-form.tsx).
 *
 * Die Vorbelegung der Fälligkeit kommt aus dem Stundenplan und wird als
 * fertige Karte hereingereicht — dieses Bauteil rechnet nichts, es wählt nur
 * aus.
 */

/** Fehler pro Feld, so wie das Formular sie erwartet. */
export type HomeworkFieldErrors = Partial<Record<keyof HomeworkInput, string>>;

/**
 * Rückgabe der Server Actions an useActionState. Steht hier und nicht in
 * @/lib/homework, weil nur das Formular diese Form braucht — und nicht in
 * actions.ts, weil eine „use server“-Datei nur asynchrone Funktionen ausgeben
 * darf.
 */
export type HomeworkFormState = {
  /** Hinweis über dem Formular, wenn es nicht an einem einzelnen Feld liegt. */
  message?: string;
  errors?: HomeworkFieldErrors;
};

const EMPTY_STATE: HomeworkFormState = {};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** „Mittwoch, 14. September“ — oder nichts, solange das Feld leer ist. */
function dayLabel(date: string): string | null {
  if (!ISO_DATE.test(date)) return null;

  try {
    return formatGerman(date);
  } catch {
    // Ein Datum wie 2026-02-31 kommt hier an, bevor zod es abfängt.
    return null;
  }
}

/**
 * Für die Auswahl reicht der Name — die Liste zeigt weder Kürzel noch Farbe.
 * Der Entwurf lässt die Fachfarbe bei den Hausaufgaben bewusst weg.
 */
export type HomeworkFormSubject = Pick<Subject, "id" | "name">;

export type HomeworkFormProps = {
  action: (
    state: HomeworkFormState,
    formData: FormData,
  ) => Promise<HomeworkFormState>;
  /** Nicht archivierte Fächer, beim Bearbeiten zusätzlich das eigene. */
  subjects: HomeworkFormSubject[];
  /**
   * Je Fach der Tag seiner nächsten Stunde, aus dem Stundenplan gerechnet.
   * Beim Bearbeiten leer: dort gilt der Tag, der schon gespeichert ist.
   */
  dueSuggestions?: Record<string, string>;
  /** Wenn für das Fach keine Stunde im Plan steht: morgen. Kommt vom Server. */
  fallbackDueDate: string;
  /** Beim Bearbeiten die Vorbelegung, beim Anlegen leer. */
  item?: Pick<Homework, "subjectId" | "title" | "details" | "dueDate">;
  submitLabel: string;
  cancelHref: string;
};

export function HomeworkForm({
  action,
  subjects,
  dueSuggestions = {},
  fallbackDueDate,
  item,
  submitLabel,
  cancelHref,
}: HomeworkFormProps) {
  const firstSubjectId = item?.subjectId ?? subjects[0]?.id ?? "";

  const [subjectId, setSubjectId] = useState(firstSubjectId);
  const [title, setTitle] = useState(item?.title ?? "");
  const [details, setDetails] = useState(item?.details ?? "");
  const [dueDate, setDueDate] = useState(
    item?.dueDate ?? (dueSuggestions[firstSubjectId] ?? fallbackDueDate),
  );
  // Beim Bearbeiten steht das Datum fest — der Nutzer hat es einmal gewählt.
  // Beim Anlegen zieht es beim Fachwechsel mit, bis er es selbst anfasst.
  const [duePicked, setDuePicked] = useState(item !== undefined);

  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  function chooseSubject(nextId: string) {
    setSubjectId(nextId);

    if (!duePicked) {
      setDueDate(dueSuggestions[nextId] ?? fallbackDueDate);
    }
  }

  // Woher der vorgeschlagene Tag kommt, soll dastehen — sonst wirkt das Datum
  // im Feld wie geraten.
  const suggestion = duePicked
    ? null
    : dueSuggestions[subjectId]
      ? "nächste Stunde in diesem Fach"
      : "morgen — für dieses Fach steht keine Stunde im Plan";

  const dueHint =
    [dayLabel(dueDate), suggestion].filter(Boolean).join(" · ") || undefined;

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

      <Field id="subjectId" label="Fach" error={state.errors?.subjectId}>
        {(control) => (
          <Select
            {...control}
            name="subjectId"
            value={subjectId}
            onChange={(event) => chooseSubject(event.target.value)}
          >
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="title" label="Aufgabe" error={state.errors?.title}>
        {(control) => (
          <Input
            {...control}
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="S. 42 Nr. 3–7"
            maxLength={120}
            autoComplete="off"
          />
        )}
      </Field>

      <Field
        id="dueDate"
        label="Fällig"
        hint={dueHint}
        error={state.errors?.dueDate}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            name="dueDate"
            value={dueDate}
            // Kein min: was man vergessen hat einzutragen, trägt man auch
            // nachträglich ein — mit dem Tag, an dem es fällig war.
            onChange={(event) => {
              setDuePicked(true);
              setDueDate(event.target.value);
            }}
          />
        )}
      </Field>

      <Field
        id="details"
        label="Notiz"
        optional
        hint="Was im Titel keinen Platz hat: Umfang, Abgabeform, ein Hinweis aus der Stunde."
        error={state.errors?.details}
      >
        {(control) => (
          <Textarea
            {...control}
            name="details"
            rows={3}
            maxLength={2000}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
          />
        )}
      </Field>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={pending} className="flex-1">
          {submitLabel}
        </Button>
        <ButtonLink href={cancelHref} variant="secondary">
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

export type HomeworkDangerZoneProps = {
  /** Wie die Aufgabe in der Liste steht, z.B. „Mathematik · S. 42 Nr. 3–7“. */
  homeworkLabel: string;
  deleteAction: () => Promise<void>;
};

/** Löschen — bewusst unten, mit einem sichtbaren Zwischenschritt. */
export function HomeworkDangerZone({
  homeworkLabel,
  deleteAction,
}: HomeworkDangerZoneProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      {confirming ? (
        <div className="space-y-3 rounded-control border border-danger/40 bg-danger-soft p-3.5">
          <p className="text-sm text-foreground">
            {homeworkLabel} wirklich löschen? Rückgängig geht das nicht. Wenn du
            sie nur nicht mehr sehen willst: abgehakte Aufgaben verschwinden
            nach zwei Wochen von selbst aus der Liste.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={deleteAction}>
              <SubmitButton variant="danger">
                Ja, endgültig löschen
              </SubmitButton>
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
          Aufgabe löschen
        </Button>
      )}
    </section>
  );
}
