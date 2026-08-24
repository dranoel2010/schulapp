"use client";

import { useActionState } from "react";

import { Field } from "@/components/ui/field";

import { loginAction, type AuthFormState } from "../actions";

const INITIAL: AuthFormState = {};
const ERROR_ID = "login-error";

/**
 * Feld und Knopf tragen hier die Maße der Entwürfe: am Handy großzügig
 * (50px hoch, Radius 14px / 54px hoch, Radius 16px), ab mittlerer Breite
 * kompakter. Deshalb eigene Klassen statt Input und Button aus components/ui —
 * deren Radien und Höhen lassen sich per className nicht verlässlich
 * überschreiben, weil Tailwind die Reihenfolge im Stylesheet bestimmt.
 * 16px Schriftgröße bleibt Pflicht: kleiner zoomt Android beim Fokus hinein.
 */
const INPUT =
  "block min-h-[50px] w-full rounded-[14px] border border-border bg-surface px-4 text-base " +
  "text-foreground placeholder:text-subtle transition-colors hover:border-border-strong " +
  "aria-[invalid=true]:border-danger md:min-h-11 md:rounded-control md:px-3.5";

const SUBMIT =
  "inline-flex min-h-[54px] w-full select-none items-center justify-center gap-2 rounded-[16px] " +
  "bg-accent px-5 text-[17px] font-medium leading-none text-accent-foreground transition-colors " +
  "hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-55 " +
  "md:min-h-[46px] md:rounded-control md:text-[15px]";

/** Kleiner Kreisel, solange das Passwort geprüft wird. */
function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * `weiter` ist der Weg, der nach dem Anmelden gilt — gesetzt nur, wenn jemand
 * hierher geschickt wurde, statt selbst zu kommen. Er reist als verstecktes
 * Feld mit und nicht im Formular-Zustand: geprüft wird er ohnehin erst in der
 * Action, und dort steht die Regel dafür.
 */
export function LoginForm({ weiter }: { weiter?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      {weiter ? <input type="hidden" name="weiter" value={weiter} /> : null}
      <Field id="password" label="Passwort">
        {(control) => (
          <input
            {...control}
            className={INPUT}
            name="password"
            type="password"
            autoComplete="current-password"
            aria-describedby={state.error ? ERROR_ID : undefined}
            aria-invalid={state.error ? true : undefined}
            required
            autoFocus
          />
        )}
      </Field>

      {state.error ? (
        <p
          id={ERROR_ID}
          role="alert"
          className="rounded-[14px] bg-danger-soft px-4 py-3 text-sm text-danger md:rounded-control md:px-3.5 md:py-2.5"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className={SUBMIT}
      >
        {pending ? <Spinner /> : null}
        {pending ? "Wird geprüft …" : "Anmelden"}
      </button>

      <p className="text-center text-[13px] text-subtle">
        Die Anmeldung hält ein Jahr, dann fragt die App wieder.
      </p>
    </form>
  );
}
