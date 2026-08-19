"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { loginAction, type AuthFormState } from "../actions";

const INITIAL: AuthFormState = {};
const ERROR_ID = "login-error";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
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
          className="rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" loading={pending} className="w-full">
        {pending ? "Wird geprüft …" : "Anmelden"}
      </Button>
    </form>
  );
}
