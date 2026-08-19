import type { ReactNode } from "react";

/**
 * Umschlag für ein Eingabefeld: Label darüber, Hilfetext und Fehler darunter.
 * Field verdrahtet id, htmlFor und aria-describedby selbst — deshalb bekommt
 * man das Eingabefeld als Funktion herein und reicht die Props durch:
 *
 *   <Field id="name" label="Name" hint="So steht es im Stundenplan"
 *          error={state.errors?.name}>
 *     {(control) => <Input {...control} name="name" defaultValue={fach.name} />}
 *   </Field>
 *
 * Die id muss stabil sein (meist einfach der Feldname), damit Label und Feld
 * auch nach einem erneuten Rendern zusammenbleiben.
 */

/** Diese Props gehören an das Eingabefeld — einfach durchreichen. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

export type FieldProps = {
  id: string;
  label: string;
  /** Erklärung unter dem Feld, wenn der Name allein nicht reicht. */
  hint?: string;
  /** Fehlermeldung; färbt das Feld rot und wird vorgelesen. */
  error?: string;
  /** Hängt ein leises „optional“ an das Label. */
  optional?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Field({
  id,
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-subtle">optional</span>
        ) : null}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}

      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
