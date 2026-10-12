"use client";

import { useActionState } from "react";

import { Field } from "@/components/kombi/form";

import { setupAction, type AuthFormState } from "../actions";

const INITIAL: AuthFormState = {};
const ERROR_ID = "setup-error";

/** Felder und Knopf wie überall in Modell 23 (Plan 2.3): Höhe 52, Radius 12, Fläche --raise. */
export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAction, INITIAL);

  return (
    <form action={formAction} className="kf-form">
      <Field id="name" label="Dein Name" hint="So spricht die App dich an.">
        {(control) => (
          <input
            {...control}
            className="kf-input"
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
          <input
            {...control}
            className="kf-input"
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
          <input
            {...control}
            className="kf-input"
            name="passwordRepeat"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        )}
      </Field>

      {/* Die Meldung gilt dem ganzen Formular — sie kann den Namen, das
          Passwort oder die Wiederholung betreffen. Deshalb hängt sie an
          keinem einzelnen Feld, sondern meldet sich als role="alert". */}
      {state.error ? (
        <p
          id={ERROR_ID}
          role="alert"
          className="kf-fehler"
        >
          {state.error}
        </p>
      ) : null}

      <div className="foot">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="btn primary solo-btn"
      >
        {pending ? "Wird angelegt …" : "Konto anlegen"}
      </button>
      </div>

      <p className="p-sub">
        Danach bleibst du ein Jahr lang angemeldet.
      </p>
    </form>
  );
}
