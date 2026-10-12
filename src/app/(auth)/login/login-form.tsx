"use client";

import { useActionState } from "react";

import { Field, Input } from "@/components/kombi/form";

import { loginAction, type AuthFormState } from "../actions";

/**
 * Das Anmeldeformular: ein Feld, ein Knopf. Bei falschem Passwort steht der
 * Fehler in `--error` unter dem Feld und wird vorgelesen.
 */

const INITIAL: AuthFormState = {};
const ERROR_ID = "login-error";

export function LoginForm({ weiter }: { weiter?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="kf-form">
      {weiter ? <input type="hidden" name="weiter" value={weiter} /> : null}
      <Field id="password" label="Passwort">
        {(control) => (
          <Input
            {...control}
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
        <p id={ERROR_ID} role="alert" className="kf-fehler">
          {state.error}
        </p>
      ) : null}

      <div className="foot">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="btn primary solo-btn">
          {pending ? "Wird geprüft …" : "Anmelden"}
        </button>
      </div>

      <p className="p-sub">Die Anmeldung hält ein Jahr, dann fragt die App wieder.</p>
    </form>
  );
}
