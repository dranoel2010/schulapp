"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, ButtonLink, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { Exam, ExamKind, Subject } from "@/db/schema";
import { subjectColor } from "@/lib/colors";
import { addDays, formatGerman } from "@/lib/dates";
import type { ExamInput } from "@/lib/exams";

import { TopicInput } from "./topic-input";

/**
 * Das Formular für eine Prüfung — Anlegen und Bearbeiten teilen es sich.
 *
 * Herzstück ist die Themenliste: aus ihr baut die App den Lernplan. Alles,
 * was man selten anfasst, steckt im zugeklappten Bereich „Lernplanung“, damit
 * das Formular beim ersten Blick aus vier Feldern besteht.
 *
 * „heute“ kommt als Eigenschaft vom Server. Im Browser stünde sonst die
 * Zeitzone des Geräts gegen die der Datenbank.
 */

/** Fehler pro Feld, so wie das Formular sie erwartet. */
export type ExamFieldErrors = Partial<Record<keyof ExamInput, string>>;

/**
 * Rückgabe der Server Actions an useActionState. Steht hier und nicht in
 * @/lib/exams, weil nur das Formular diese Form braucht.
 */
export type ExamFormState = {
  /** Hinweis über dem Formular, wenn es nicht an einem einzelnen Feld liegt. */
  message?: string;
  errors?: ExamFieldErrors;
};

const EMPTY_STATE: ExamFormState = {};

const KINDS: { value: ExamKind; label: string }[] = [
  { value: "klausur", label: "Klausur" },
  { value: "test", label: "Test" },
  { value: "referat", label: "Referat" },
  { value: "muendlich", label: "Mündliche Prüfung" },
];

/** Die Vorgaben aus dem Konzept: zehn Tage Vorlauf, 45 Minuten am Tag. */
const DEFAULT_LEAD_DAYS = 10;
const DEFAULT_MINUTES_PER_DAY = 45;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Mittwoch, 14. September" — oder nichts, solange das Feld leer ist. */
function dayLabel(date: string): string | null {
  if (!ISO_DATE.test(date)) return null;

  try {
    return formatGerman(date);
  } catch {
    return null;
  }
}

/**
 * Der erste Lerntag, wie ihn der Plan später rechnet — reine Vorschau, damit
 * man sieht, was Vorlauf und Datum zusammen bedeuten.
 */
function planStart(date: string, leadDays: string): { iso: string; label: string } | null {
  if (!ISO_DATE.test(date)) return null;

  const lead = Number(leadDays);
  if (!Number.isInteger(lead) || lead < 1 || lead > 60) return null;

  try {
    const iso = addDays(date, -lead);
    return { iso, label: formatGerman(iso) };
  } catch {
    // Ein Datum wie 2026-02-31 kommt hier an, bevor zod es abfängt.
    return null;
  }
}

/** Für die Auswahl reicht, woran man ein Fach erkennt. */
export type ExamFormSubject = Pick<Subject, "id" | "name" | "short" | "color">;

export type ExamFormProps = {
  action: (state: ExamFormState, formData: FormData) => Promise<ExamFormState>;
  /** Nicht archivierte Fächer, beim Bearbeiten zusätzlich das eigene. */
  subjects: ExamFormSubject[];
  /** "YYYY-MM-DD", kommt vom Server. */
  today: string;
  /** Beim Bearbeiten die Vorbelegung, beim Anlegen leer. */
  exam?: Exam;
  /** Die Themen der Prüfung in ihrer Reihenfolge. */
  topics?: string[];
  submitLabel: string;
  cancelHref: string;
};

export function ExamForm({
  action,
  subjects,
  today,
  exam,
  topics: savedTopics = [],
  submitLabel,
  cancelHref,
}: ExamFormProps) {
  const [subjectId, setSubjectId] = useState(
    exam?.subjectId ?? subjects[0]?.id ?? "",
  );
  const [kind, setKind] = useState<string>(exam?.kind ?? "klausur");
  const [date, setDate] = useState(exam?.date ?? "");
  const [title, setTitle] = useState(exam?.title ?? "");
  const [topics, setTopics] = useState<string[]>(savedTopics);
  const [leadDays, setLeadDays] = useState(
    String(exam?.leadDays ?? DEFAULT_LEAD_DAYS),
  );
  const [minutesPerDay, setMinutesPerDay] = useState(
    String(exam?.minutesPerDay ?? DEFAULT_MINUTES_PER_DAY),
  );
  const [notes, setNotes] = useState(exam?.notes ?? "");
  // Wer die Planung schon einmal angepasst hat, sieht sie gleich offen.
  const [planOpen, setPlanOpen] = useState(
    exam !== undefined &&
      (exam.leadDays !== DEFAULT_LEAD_DAYS ||
        exam.minutesPerDay !== DEFAULT_MINUTES_PER_DAY),
  );

  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  const color = subjectColor(
    subjects.find((subject) => subject.id === subjectId)?.color,
  );

  // Ein Fehler aus der Lernplanung steht auch zugeklappt in der Titelzeile —
  // eine Meldung, die niemand sieht, ist keine.
  const planError = state.errors?.leadDays ?? state.errors?.minutesPerDay;
  const start = planStart(date, leadDays);

  // Eine Prüfung, die schon war, behält ihr Datum — sonst läge der eigene Wert
  // außerhalb dessen, was der Kalender zulässt.
  const earliest = exam && exam.date < today ? exam.date : today;

  // Der Plan hängt an Datum, Themen, Vorlauf und Tagesbudget. Ändert sich davon
  // etwas, wird er beim Speichern neu verteilt — das soll vorher klar sein.
  const planChanges =
    exam !== undefined &&
    (date !== exam.date ||
      leadDays !== String(exam.leadDays) ||
      minutesPerDay !== String(exam.minutesPerDay) ||
      topics.join("\n") !== savedTopics.join("\n"));

  const footnote = exam
    ? planChanges
      ? "Der Lernplan wird beim Speichern neu verteilt. Was du schon abgehakt hast, bleibt erledigt."
      : null
    : "Nach dem Speichern verteilt die App die Themen auf die Tage vor der Prüfung.";

  const topicHint =
    topics.length === 0
      ? "Aus jedem Thema werden zwei Lernblöcke: einmal durcharbeiten, einmal wiederholen. Vier bis zehn Themen funktionieren gut."
      : `${topics.length} ${topics.length === 1 ? "Thema" : "Themen"} — daraus baut die App den Lernplan. Vier bis zehn funktionieren gut.`;

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="subjectId" label="Fach" error={state.errors?.subjectId}>
          {(control) => (
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                style={{ backgroundColor: color.hex }}
                className="size-3 shrink-0 rounded-full"
              />
              <span className="min-w-0 flex-1">
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
              </span>
            </span>
          )}
        </Field>

        <Field id="kind" label="Art" error={state.errors?.kind}>
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
      </div>

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
            min={earliest}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </Field>

      <Field
        id="title"
        label="Titel"
        optional
        hint="Meist reicht das Fach. Ein Titel hilft, wenn im selben Fach mehrere Prüfungen anstehen."
        error={state.errors?.title}
      >
        {(control) => (
          <Input
            {...control}
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Analysis"
            maxLength={80}
            autoComplete="off"
          />
        )}
      </Field>

      <Field id="topics" label="Themen" hint={topicHint}>
        {(control) => (
          <TopicInput
            {...control}
            name="topics"
            topics={topics}
            onTopicsChange={setTopics}
          />
        )}
      </Field>

      <details
        open={planOpen}
        onToggle={(event) => setPlanOpen(event.currentTarget.open)}
        className="group overflow-hidden rounded-card border border-border bg-surface"
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-1.5 px-4 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          Lernplanung
          <span
            className={
              planError
                ? "ml-auto pl-3 text-right font-normal text-danger"
                : "ml-auto pl-3 text-right font-normal text-muted"
            }
          >
            {planError ?? `${leadDays || "?"} Tage · ${minutesPerDay || "?"} Min.`}
          </span>
        </summary>

        <div className="space-y-4 border-t border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="leadDays"
              label="Vorlauf in Tagen"
              hint="So viele Tage vor der Prüfung fängt die Lernphase an."
              error={state.errors?.leadDays}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  name="leadDays"
                  min={1}
                  max={60}
                  value={leadDays}
                  onChange={(event) => setLeadDays(event.target.value)}
                />
              )}
            </Field>

            <Field
              id="minutesPerDay"
              label="Minuten pro Tag"
              hint="Das Tagesbudget. Liegen mehrere Blöcke auf einem Tag, teilen sie es sich."
              error={state.errors?.minutesPerDay}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  name="minutesPerDay"
                  min={10}
                  max={240}
                  step={5}
                  value={minutesPerDay}
                  onChange={(event) => setMinutesPerDay(event.target.value)}
                />
              )}
            </Field>
          </div>

          {start ? (
            <p className="text-sm text-muted">
              {start.iso < today
                ? `Rechnerisch ginge es am ${start.label} los — das ist vorbei, geplant wird ab heute.`
                : `Die Lernphase beginnt am ${start.label}.`}
            </p>
          ) : null}
        </div>
      </details>

      <Field
        id="notes"
        label="Notizen"
        optional
        hint="Erlaubte Hilfsmittel, Raum, Umfang — was sonst noch wichtig ist."
        error={state.errors?.notes}
      >
        {(control) => (
          <Textarea
            {...control}
            name="notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        )}
      </Field>

      <div className="space-y-3 pt-2">
        <div className="flex gap-3">
          <Button type="submit" loading={pending} className="flex-1">
            {submitLabel}
          </Button>
          <ButtonLink href={cancelHref} variant="secondary">
            Abbrechen
          </ButtonLink>
        </div>

        {footnote ? <p className="text-sm text-muted">{footnote}</p> : null}
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

export type ExamDangerZoneProps = {
  /** Wie die Prüfung in der Liste heißt, z.B. "Mathematik · Analysis". */
  examLabel: string;
  /** Wie viele Lernblöcke mit gelöscht werden. */
  blockCount: number;
  deleteAction: () => Promise<void>;
};

/** Löschen — bewusst unten, mit einem sichtbaren Zwischenschritt. */
export function ExamDangerZone({
  examLabel,
  blockCount,
  deleteAction,
}: ExamDangerZoneProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      {confirming ? (
        <div className="space-y-3 rounded-control border border-danger/40 bg-danger-soft p-3.5">
          <p className="text-sm text-foreground">
            {examLabel} wirklich löschen? Der Termin geht weg, die Themen und
            {blockCount > 0
              ? ` der ganze Lernplan mit ${blockCount} ${blockCount === 1 ? "Lernblock" : "Lernblöcken"}`
              : " der Lernplan"}{" "}
            auch. Rückgängig geht das nicht.
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
          Prüfung löschen
        </Button>
      )}
    </section>
  );
}
