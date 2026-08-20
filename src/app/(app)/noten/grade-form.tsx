"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, ButtonLink, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { Grade, GradeKind, Subject } from "@/db/schema";
import { formatGerman } from "@/lib/dates";
import { GRADE_STEPS } from "@/lib/grade-scale";
import type { GradeInput } from "@/lib/grades";

/**
 * Das Formular für eine Note — Anlegen und Bearbeiten teilen es sich.
 *
 * Sechs Felder, mehr gibt das Datenmodell nicht her: Fach, Note, Art, Gewicht,
 * Datum, Anlass. Der Entwurf zeigt kein Formular; gebaut ist es deshalb wie die
 * bestehenden (siehe homework-form.tsx).
 *
 * Der heutige Tag kommt als Eigenschaft vom Server. Im Browser stünde sonst die
 * Zeitzone des Geräts gegen die der Datenbank — und im Zweifel eine Note von
 * gestern im Feld.
 */

/** Fehler pro Feld, so wie das Formular sie erwartet. */
export type GradeFieldErrors = Partial<Record<keyof GradeInput, string>>;

/**
 * Rückgabe der Server Actions an useActionState. Steht hier und nicht in
 * @/lib/grades, weil nur das Formular diese Form braucht — und nicht in
 * actions.ts, weil eine „use server“-Datei nur asynchrone Funktionen ausgeben
 * darf.
 */
export type GradeFormState = {
  /** Hinweis über dem Formular, wenn es nicht an einem einzelnen Feld liegt. */
  message?: string;
  errors?: GradeFieldErrors;
};

const EMPTY_STATE: GradeFormState = {};

const KINDS: { value: GradeKind; label: string }[] = [
  { value: "schriftlich", label: "Schriftlich" },
  { value: "muendlich", label: "Mündlich" },
];

/**
 * Das Gewicht in Worten. „2“ allein ließe offen, ob die Note doppelt zählt oder
 * die zweite ihrer Art ist.
 */
const WEIGHTS: { value: number; label: string }[] = [
  { value: 1, label: "zählt einfach" },
  { value: 2, label: "zählt doppelt" },
  { value: 3, label: "zählt dreifach" },
  { value: 4, label: "zählt vierfach" },
  { value: 5, label: "zählt fünffach" },
];

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
 * Für die Auswahl reicht der Name — Kürzel und Farbe stehen in der Liste, im
 * Formular wählt man ein Fach und keine Kachel.
 */
export type GradeFormSubject = Pick<Subject, "id" | "name">;

export type GradeFormProps = {
  action: (
    state: GradeFormState,
    formData: FormData,
  ) => Promise<GradeFormState>;
  /** Nicht archivierte Fächer, beim Bearbeiten zusätzlich das eigene. */
  subjects: GradeFormSubject[];
  /** „YYYY-MM-DD“, kommt vom Server. Beim Anlegen der heutige Tag. */
  defaultDate: string;
  /** Beim Anlegen aus „?fach=…“ vorgewählt; sonst steht das erste Fach oben. */
  defaultSubjectId?: string;
  /** Beim Bearbeiten die Vorbelegung, beim Anlegen leer. */
  item?: Pick<
    Grade,
    "subjectId" | "value" | "kind" | "weight" | "date" | "title"
  >;
  submitLabel: string;
  cancelHref: string;
};

export function GradeForm({
  action,
  subjects,
  defaultDate,
  defaultSubjectId,
  item,
  submitLabel,
  cancelHref,
}: GradeFormProps) {
  const [subjectId, setSubjectId] = useState(
    item?.subjectId ?? defaultSubjectId ?? subjects[0]?.id ?? "",
  );
  // Leer beim Anlegen: eine Vorgabe wäre geraten, und eine geratene Note ist
  // schlimmer als ein leeres Feld.
  const [value, setValue] = useState(item ? String(item.value) : "");
  const [kind, setKind] = useState<string>(item?.kind ?? "schriftlich");
  const [weight, setWeight] = useState(String(item?.weight ?? 1));
  const [date, setDate] = useState(item?.date ?? defaultDate);
  const [title, setTitle] = useState(item?.title ?? "");

  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

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
            onChange={(event) => setSubjectId(event.target.value)}
          >
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="value" label="Note" error={state.errors?.value}>
        {(control) => (
          <Select
            {...control}
            name="value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="">Note wählen</option>
            {GRADE_STEPS.map((step) => (
              <option key={step.value} value={step.value}>
                {step.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        id="kind"
        label="Art"
        hint="Wie stark schriftlich und mündlich zueinander zählen, steht am Fach — nicht an der einzelnen Note."
        error={state.errors?.kind}
      >
        {(control) => (
          <Select
            {...control}
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        id="weight"
        label="Gewicht"
        hint="Das Gewicht wirkt nur innerhalb seiner Art: eine Klausur gegen einen Test, nicht gegen eine mündliche Note."
        error={state.errors?.weight}
      >
        {(control) => (
          <Select
            {...control}
            name="weight"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          >
            {WEIGHTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        id="date"
        label="Datum"
        hint={dayLabel(date) ?? undefined}
        error={state.errors?.date}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            name="date"
            value={date}
            // Kein max: eine Note von letzter Woche trägt man nach, und der
            // Kalender darf einem den Tag dann nicht verwehren.
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </Field>

      <Field
        id="title"
        label="Wofür"
        optional
        hint="Das Fach steht schon daneben — hier steht der Anlass."
        error={state.errors?.title}
      >
        {(control) => (
          <Input
            {...control}
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="2. Klausur"
            maxLength={120}
            autoComplete="off"
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

export type GradeDangerZoneProps = {
  /** Wie die Note in der Liste steht, z.B. „Mathematik · 2− · 2. Klausur“. */
  gradeLabel: string;
  deleteAction: () => Promise<void>;
};

/** Löschen — bewusst unten, mit einem sichtbaren Zwischenschritt. */
export function GradeDangerZone({
  gradeLabel,
  deleteAction,
}: GradeDangerZoneProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      {confirming ? (
        <div className="space-y-3 rounded-control border border-danger/40 bg-danger-soft p-3.5">
          <p className="text-sm text-foreground">
            {gradeLabel} wirklich löschen? Rückgängig geht das nicht, und der
            Schnitt im Fach rechnet sich sofort ohne sie.
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
          Note löschen
        </Button>
      )}
    </section>
  );
}
