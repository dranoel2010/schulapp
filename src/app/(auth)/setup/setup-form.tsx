"use client";

import { useActionState } from "react";

import { Field } from "@/components/ui/field";

import { setupAction, type AuthFormState } from "../actions";

const INITIAL: AuthFormState = {};
const ERROR_ID = "setup-error";

/**
 * Dieselben Maße wie beim Anmelden: am Handy großzügig, ab mittlerer Breite
 * kompakter. Eigene Klassen statt Input und Button aus components/ui, weil
 * sich Höhe und Radius dort per className nicht verlässlich überschreiben
 * lassen. 16px Schriftgröße bleibt Pflicht, sonst zoomt Android beim Fokus.
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

/** Kleiner Kreisel, solange das Konto angelegt wird. */
function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      <Field id="name" label="Dein Name" hint="So spricht die App dich an.">
        {(control) => (
          <input
            {...control}
            className={INPUT}
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
            className={INPUT}
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
            className={INPUT}
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
        {pending ? "Wird angelegt …" : "Konto anlegen"}
      </button>

      <p className="text-center text-[13px] text-subtle">
        Danach bleibst du ein Jahr lang angemeldet.
      </p>
    </form>
  );
}
