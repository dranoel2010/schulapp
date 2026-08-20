"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { subjectColor } from "@/lib/colors";

/**
 * Ein Feld im Wochenraster bearbeiten: welches Fach, welcher Raum, welche
 * Notiz. Angelegt und geändert wird mit demselben Formular — welches Feld
 * gemeint ist, steht in der Adresse und nicht im Formular.
 *
 * Der Raum bleibt am besten leer: dann gilt der Raum des Fachs, und ein Umzug
 * muss nur einmal eingetragen werden. Das Feld zeigt ihn deshalb als
 * Platzhalter statt als Vorbelegung.
 *
 * Die Zustandstypen stehen hier und nicht in actions.ts — eine
 * „use server“-Datei darf nur asynchrone Funktionen ausgeben.
 */

/** Das Fach, wie die Auswahl es braucht — mehr lädt die Seite nicht. */
export type LessonFormSubject = {
  id: string;
  name: string;
  /** Färbt den Punkt vor der Auswahl. */
  color: string;
  /** Steht als Platzhalter im Raumfeld — leer heißt: dieser Raum gilt. */
  room: string | null;
};

/** Fehler pro Feld, so wie das Formular sie erwartet. */
export type LessonFieldErrors = {
  subjectId?: string;
  room?: string;
  note?: string;
};

/** Rückgabe der Server Actions an useActionState. */
export type LessonFormState = {
  /** Hinweis über dem Formular, wenn es nicht an einem einzelnen Feld liegt. */
  message?: string;
  errors?: LessonFieldErrors;
};

const EMPTY_STATE: LessonFormState = {};

export type LessonFormProps = {
  action: (
    state: LessonFormState,
    formData: FormData,
  ) => Promise<LessonFormState>;
  /** Nicht archivierte Fächer, dazu das gesetzte auch dann, wenn es archiviert ist. */
  subjects: LessonFormSubject[];
  /** Der bisherige Inhalt des Feldes; fehlt, solange die Stunde frei ist. */
  lesson?: { subjectId: string; room: string | null; note: string | null };
  /** Leert das Feld wieder — gibt es nur, wenn etwas darin steht. */
  removeAction?: () => Promise<void>;
};

export function LessonForm({
  action,
  subjects,
  lesson,
  removeAction,
}: LessonFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  const [subjectId, setSubjectId] = useState(
    lesson?.subjectId ?? subjects[0]?.id ?? "",
  );
  const [room, setRoom] = useState(lesson?.room ?? "");
  const [note, setNote] = useState(lesson?.note ?? "");

  const subject = subjects.find((item) => item.id === subjectId);
  const color = subjectColor(subject?.color);

  return (
    <div className="space-y-6">
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
                    {subjects.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                </span>
              </span>
            )}
          </Field>

          <Field
            id="room"
            label="Raum"
            optional
            hint={
              subject?.room
                ? `Leer heißt: ${subject.room}, der Raum des Fachs.`
                : "Leer heißt: der Raum des Fachs."
            }
            error={state.errors?.room}
          >
            {(control) => (
              <Input
                {...control}
                name="room"
                value={room}
                onChange={(event) => setRoom(event.target.value)}
                placeholder={subject?.room ?? "A 214"}
                maxLength={20}
                autoComplete="off"
              />
            )}
          </Field>
        </div>

        <Field id="note" label="Notiz" optional error={state.errors?.note}>
          {(control) => (
            <Textarea
              {...control}
              name="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Nur alle zwei Wochen"
              maxLength={200}
              rows={3}
            />
          )}
        </Field>

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={pending} className="flex-1">
            Speichern
          </Button>
          <ButtonLink href="/stundenplan" variant="secondary">
            Abbrechen
          </ButtonLink>
        </div>
      </form>

      {/* Eigenes Formular, damit der Knopf nicht mitspeichert. Eine Rückfrage
          steht nicht davor: hier geht ein Feld verloren, kein Fach mit allem,
          was daran hängt — und wieder eintragen ist ein Antippen. */}
      {removeAction ? (
        <form action={removeAction} className="border-t border-border pt-4">
          <RemoveButton />
        </form>
      ) : null}
    </div>
  );
}

/** Knopf, der von selbst merkt, dass sein Formular gerade läuft. */
function RemoveButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="ghost"
      loading={pending}
      className="text-danger hover:bg-danger-soft hover:text-danger"
    >
      Stunde entfernen
    </Button>
  );
}
