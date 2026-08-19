"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { setupAction, type AuthFormState } from "../actions";

const INITIAL: AuthFormState = {};

export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <Field id="name" label="Dein Name" hint="So spricht die App dich an.">
        {(control) => (
          <Input
            {...control}
            name="name"
            type="text"
            autoComplete="name"
            // React leert das Formular nach dem Absenden — der Name kommt aus
            // der Antwort zurück, damit er nach einem Fehler stehen bleibt.
            defaultValue={state.name ?? ""}
            maxLength={60}
            required
            autoFocus
          />
        )}
      </Field>

      <Field id="password" label="Passwort" hint="Mindestens 8 Zeichen.">
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        )}
      </Field>

      <Field id="password-repeat" label="Passwort wiederholen">
        {(control) => (
          <Input
            {...control}
            name="passwordRepeat"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        )}
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" loading={pending} className="w-full">
        {pending ? "Wird angelegt …" : "Konto anlegen"}
      </Button>
    </form>
  );
}
