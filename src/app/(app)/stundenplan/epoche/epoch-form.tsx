"use client";

import { useActionState, useMemo, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";

/**
 * Den Hauptunterricht in einem Zug auf ein anderes Fach umtragen.
 *
 * An einer Waldorfschule wechselt die Epoche alle paar Wochen: dieselben
 * Felder im Raster, ein anderes Fach. Von Hand sind das fünf bis acht Wege
 * durch dasselbe Formular, zehnmal im Schuljahr.
 *
 * **Angehakt wird jedes Mal neu, und das ist Absicht.** Die App könnte sich
 * merken, welche Felder „die Epoche" sind — dann wäre der Wechsel ein einziger
 * Knopf. Sie tut es nicht, weil dieses Gedächtnis nach dem ersten Wechsel eine
 * zweite Wahrheit neben dem Plan wäre und gepflegt werden müsste. Nicht jede
 * Stunde eines Fachs gehört zur Epoche: neben dem Hauptunterricht steht oft
 * noch eine Fachstunde desselben Fachs, und die bleibt stehen. Diese
 * Unterscheidung kann nur ein Mensch treffen, und sie steht hier mit Tag und
 * Uhrzeit vor ihm — abzulesen statt zu erinnern.
 *
 * Vorbelegt sind alle Stunden des alten Fachs. Das ist der häufige Fall; die
 * Ausnahmen hakt man ab.
 */

export type EpochSubject = {
  id: string;
  name: string;
  color: string;
  /** Ein zugemachtes Fach darf weichen, aber keines werden. */
  archived: boolean;
};

/**
 * Eine Stunde, fertig zum Zeichnen.
 *
 * Alles ist hier schon Text: Wochentag, Stundennummer und Uhrzeit rechnet die
 * Seite aus, nicht dieses Formular. Der Grund ist kein Geschmack — `@/lib/
 * timetable` hängt an der Datenbank, und ein Import von dort zöge `fs` und
 * `net` in das Browser-Bündel. Der Bau bricht daran ab.
 */
export type EpochLesson = {
  /** "3-1" für Mittwoch, 1. Stunde — der Wert des Hakens. */
  key: string;
  subjectId: string;
  /** "Mo" */
  weekday: string;
  /** "1." */
  period: string;
  /** "08:15–10:00", oder leer, wenn die Stunde keine Zeile im Raster hat. */
  time: string | null;
};

export type EpochFormState = {
  message?: string;
  notice?: string;
  errors?: { fromSubjectId?: string; toSubjectId?: string; slots?: string };
};

const EMPTY_STATE: EpochFormState = {};

export function EpochForm({
  action,
  subjects,
  lessons,
  defaultFromSubjectId,
}: {
  action: (
    state: EpochFormState,
    formData: FormData,
  ) => Promise<EpochFormState>;
  subjects: EpochSubject[];
  lessons: EpochLesson[];
  /** Das Fach, das die App für den laufenden Hauptunterricht hält. */
  defaultFromSubjectId: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  const [fromSubjectId, setFromSubjectId] = useState(
    defaultFromSubjectId ?? subjects[0]?.id ?? "",
  );

  // Welche Felder abgehakt sind, steht hier und nicht im DOM: beim Wechsel des
  // alten Fachs wird die Liste neu gefüllt, und ein `defaultChecked` würde
  // dann den alten Stand behalten.
  const betroffen = useMemo(
    () => lessons.filter((lesson) => lesson.subjectId === fromSubjectId),
    [lessons, fromSubjectId],
  );

  const [abgewaehlt, setAbgewaehlt] = useState<Set<string>>(new Set());

  // Ein Fachwechsel oben leert die Abwahl — die alten Haken meinten Felder,
  // die es in der neuen Liste gar nicht gibt.
  function waehleFach(id: string) {
    setFromSubjectId(id);
    setAbgewaehlt(new Set());
  }

  function schalte(key: string) {
    setAbgewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(key)) neu.delete(key);
      else neu.add(key);
      return neu;
    });
  }

  const gewaehlt = betroffen.filter((lesson) => !abgewaehlt.has(lesson.key));

  const alteFaecher = subjects.filter((subject) =>
    lessons.some((lesson) => lesson.subjectId === subject.id),
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.message ? (
        <p className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      <Field
        id="fromSubjectId"
        label="Welches Fach hat gerade Epoche?"
        error={state.errors?.fromSubjectId}
      >
        {(control) => (
          <Select
            {...control}
            name="fromSubjectId"
            value={fromSubjectId}
            onChange={(event) => waehleFach(event.target.value)}
          >
            {alteFaecher.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">Diese Stunden wandern mit</p>
        <p className="text-sm text-muted">
          Fachstunden, die stehen bleiben sollen, hier abwählen.
        </p>

        {betroffen.length === 0 ? (
          <p className="rounded-control border border-border bg-surface-muted px-3.5 py-3 text-sm text-muted">
            Dieses Fach steht in keiner Stunde.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-control border border-border">
            {betroffen.map((lesson) => {
              const key = lesson.key;
              const an = !abgewaehlt.has(key);

              return (
                <li key={key}>
                  <label className="flex cursor-pointer items-center gap-3 px-3.5 py-3 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      name="slots"
                      value={key}
                      checked={an}
                      onChange={() => schalte(key)}
                      className="size-4 shrink-0 accent-accent"
                    />
                    <span className="w-8 shrink-0 text-sm font-medium">
                      {lesson.weekday}
                    </span>
                    <span className="w-8 shrink-0 text-sm text-muted tabular-nums">
                      {lesson.period}
                    </span>
                    <span className="text-sm text-muted tabular-nums">
                      {lesson.time ?? "ohne Zeit"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {state.errors?.slots ? (
          <p className="text-sm text-danger">{state.errors.slots}</p>
        ) : null}
      </div>

      <Field
        id="toSubjectId"
        label="Welches Fach kommt jetzt?"
        error={state.errors?.toSubjectId}
      >
        {(control) => (
          <Select {...control} name="toSubjectId" defaultValue="">
            <option value="" disabled>
              Fach wählen
            </option>
            {subjects
              .filter(
                (subject) =>
                  subject.id !== fromSubjectId && !subject.archived,
              )
              .map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
          </Select>
        )}
      </Field>

      <div className="flex gap-3 pt-2">
        <Button
          type="submit"
          loading={pending}
          disabled={gewaehlt.length === 0}
          className="flex-1"
        >
          {gewaehlt.length === 1
            ? "1 Stunde umtragen"
            : `${gewaehlt.length} Stunden umtragen`}
        </Button>
        <ButtonLink href="/stundenplan" variant="secondary">
          Abbrechen
        </ButtonLink>
      </div>

      <p className="text-sm text-muted">
        Umgetragen wird nur der Stundenplan. Noten, Hausaufgaben und Blätter
        behalten ihr Fach —{" "}
        <span className="text-foreground">
          was du in der Mathe-Epoche gesammelt hast, bleibt bei Mathematik
        </span>
        .
      </p>
    </form>
  );
}
