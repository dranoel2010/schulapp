"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { useDesktop } from "@/components/kombi/desktop/use-desktop";
import { Button, type ButtonProps } from "@/components/kombi/form";
import { AbbrechenKnopf, FehlerFokus, FertigBeiErfolg, useNachAktion } from "@/components/kombi/form/fertig";
import { Field } from "@/components/kombi/form";
import { Input, Select, Textarea } from "@/components/kombi/form";
import type { Homework, Subject } from "@/db/schema";
import { formatGerman } from "@/lib/dates";
import type { HomeworkInput } from "@/lib/homework";
import { abgabeTage } from "@/lib/kombi/abgabe-tage";
import { kurz, kurzVon } from "@/lib/kombi/text";

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
 *
 * Am Rechner (desktop.html `aufgabeForm`) steht die Aufgabe zuerst, darunter
 * das Fach als Chip-Reihe und die Abgabe als Datums-Chips; das Datumsfeld
 * kommt erst mit „Anderes Datum“, die Notiz erst mit „Notiz dazu“ (oder wenn
 * schon eine da ist). Auswahl und Datumsfeld bleiben dabei im Formular: die
 * Chips stellen sie wie eine Eingabe, so übersteht die Wahl auch das Queren
 * der Schwelle (desktop/entwurf.ts).
 */

/** Ein Feld so stellen, wie es eine Eingabe täte: React übernimmt es über onChange. */
function stellen(el: HTMLInputElement | HTMLSelectElement | null, wert: string): void {
  if (!el || el.value === wert) return;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, wert);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

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
  /** Gesetzt nach erfolgreichem Speichern: die Formularseite geht zurück (Plan 2.4). */
  fertig?: number;
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
   * Beim Anlegen die Vorbelegung; beim Bearbeiten zieht der Tag nicht mit
   * (dort gilt der gespeicherte), am Rechner ist er dann ein Datums-Chip.
   */
  dueSuggestions?: Record<string, string>;
  /** Wenn für das Fach keine Stunde im Plan steht: morgen. Kommt vom Server. */
  fallbackDueDate: string;
  /** Beim Bearbeiten die Vorbelegung, beim Anlegen leer. */
  item?: Pick<Homework, "subjectId" | "title" | "details" | "dueDate">;
  submitLabel: string;
  /** Früher das Ziel von „Abbrechen“; jetzt geht es eine Ebene zurück. */
  cancelHref?: string;
};

export function HomeworkForm({
  action,
  subjects,
  dueSuggestions = {},
  fallbackDueDate,
  item,
  submitLabel,
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

  const desktop = useDesktop();
  const fachRef = useRef<HTMLSelectElement>(null);
  const datumRef = useRef<HTMLInputElement>(null);
  const notizRef = useRef<HTMLTextAreaElement>(null);
  const [datumOffen, setDatumOffen] = useState(false);
  const [notizOffen, setNotizOffen] = useState(false);

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
      : "morgen, keine Stunde im Plan";

  const dueHint =
    [dayLabel(dueDate), suggestion].filter(Boolean).join(" · ") || undefined;

  return (
    <form action={formAction} className="kf-form" noValidate>
      <FertigBeiErfolg marke={state.fertig} toast={item ? "Gespeichert" : "Eingetragen"} />
      <FehlerFokus zustand={state} />
      {state.message ? (
        <p
          role="alert"
          className="kf-fehler"
        >
          {state.message}
        </p>
      ) : null}

      {desktop ? (
        <>
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
                data-fokus-start=""
              />
            )}
          </Field>

          <div className="kf-feld">
            <span className="kf-label" id="subjectId-chips">
              Fach
            </span>
            <div className="refile" role="group" aria-labelledby="subjectId-chips">
              {subjects.map((subject) => (
                <button
                  key={subject.id}
                  className="fp"
                  type="button"
                  aria-pressed={subject.id === subjectId}
                  onClick={() => stellen(fachRef.current, subject.id)}
                >
                  {kurzVon(subject.name)}
                </button>
              ))}
            </div>
            {/* die Auswahl bleibt das Feld des Formulars, die Chips stellen sie */}
            <div hidden>
              <select
                ref={fachRef}
                name="subjectId"
                value={subjectId}
                onChange={(event) => chooseSubject(event.target.value)}
                tabIndex={-1}
                aria-hidden="true"
              >
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
            {state.errors?.subjectId ? <p className="kf-fehler">{state.errors.subjectId}</p> : null}
          </div>

          <div className="kf-feld">
            <span className="kf-label" id="dueDate-chips">
              Abgabe
            </span>
            <div className="refile" role="group" aria-labelledby="dueDate-chips">
              {abgabeTage({ naechsteStunde: dueSuggestions[subjectId], morgen: fallbackDueDate, gewaehlt: dueDate }).map((tag) => (
                <button
                  key={tag}
                  className="fp"
                  type="button"
                  aria-pressed={!datumOffen && tag === dueDate}
                  onClick={() => {
                    setDatumOffen(false);
                    stellen(datumRef.current, tag);
                  }}
                >
                  {kurz(tag)}
                </button>
              ))}
              <button
                className="fp"
                type="button"
                aria-pressed={datumOffen}
                onClick={() => {
                  setDatumOffen(true);
                  requestAnimationFrame(() => datumRef.current?.focus());
                }}
              >
                Anderes Datum
              </button>
            </div>
          </div>
          <div hidden={!datumOffen && !state.errors?.dueDate}>
            <Field
              id="dueDate"
              label="Datum"
              hint={dueHint}
              error={state.errors?.dueDate}
            >
              {(control) => (
                <Input
                  {...control}
                  ref={datumRef}
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
          </div>

          {details || notizOffen || state.errors?.details ? null : (
            <button
              className="textbtn"
              type="button"
              onClick={() => {
                setNotizOffen(true);
                requestAnimationFrame(() => notizRef.current?.focus());
              }}
            >
              Notiz dazu
            </button>
          )}
          <div hidden={!details && !notizOffen && !state.errors?.details}>
            <Field
              id="details"
              label="Notiz"
              optional
              error={state.errors?.details}
            >
              {(control) => (
                <Textarea
                  {...control}
                  ref={notizRef}
                  name="details"
                  rows={3}
                  maxLength={2000}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                />
              )}
            </Field>
          </div>
        </>
      ) : (
        <>
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

        </>
      )}

      <div className="foot">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        <AbbrechenKnopf />
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
  const { zurueck } = useNachAktion();

  return (
    <section>
      {confirming ? (
        <div className="kf-gefahr">
          <p className="text-[15px] text-ink">
            {homeworkLabel} wirklich löschen? Rückgängig geht das nicht. Wenn du
            sie nur nicht mehr sehen willst: abgehakte Aufgaben verschwinden
            nach zwei Tagen von selbst aus der Liste, die Suche findet sie
            danach noch zwei Wochen.
          </p>
          <div className="flex flex-wrap gap-2">
            <form
              action={async () => {
                await deleteAction();
                zurueck("Gelöscht");
              }}
            >
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
          style={{ color: "var(--error)" }}
          onClick={() => setConfirming(true)}
        >
          Aufgabe löschen
        </Button>
      )}
    </section>
  );
}
