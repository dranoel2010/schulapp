"use client";

import { useActionState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

import { loginAction, type AuthFormState } from "../actions";

const INITIAL: AuthFormState = {};
const ERROR_ID = "login-error";

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
        <p
          id={ERROR_ID}
          role="alert"
          className="rounded-[14px] bg-danger-soft px-4 py-3 text-sm text-danger md:rounded-control md:px-3.5 md:py-2.5"
        >
          {state.error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="w-full"
        size="lg"
        loading={pending}
      >
        {pending ? "Wird geprüft …" : "Anmelden"}
      </Button>

      <p className="text-center text-[13px] text-subtle">
        Die Anmeldung hält ein Jahr, dann fragt die App wieder.
      </p>
    </form>
  );
}
