"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * Der Knopf, mit dem ein Mensch einem Agenten den Zugriff erlaubt.
 *
 * Zwei Knöpfe in einem Formular, unterschieden über den Wert des abgeschickten
 * Knopfes (`entscheidung`). Beide Wege enden in einer Umleitung zurück zum
 * Client — auch das Nein, denn ein Client muss erfahren, dass er abgelehnt
 * wurde, statt ins Leere zu warten.
 *
 * Alle Angaben des Ablaufs stehen als versteckte Felder darin und nicht in
 * der Adresse: eine Server Action hat keine Adresse, die man mitgeben könnte.
 * Geprüft werden sie in der Action noch einmal von Grund auf — ein verstecktes
 * Feld ist eine Eingabe wie jede andere.
 */

export type ConsentState = { message?: string };

const EMPTY_STATE: ConsentState = {};

export type ConsentFormProps = {
  action: (state: ConsentState, formData: FormData) => Promise<ConsentState>;
  /** Die Angaben des Ablaufs, wie sie in der Adresse standen. */
  fields: Record<string, string>;
};

export function ConsentForm({ action, fields }: ConsentFormProps) {
  const [state, formAction] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {state.message ? (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Buttons />
      </div>
    </form>
  );
}

/**
 * Erlauben steht links und trägt den Akzent, Ablehnen daneben in Grau. Beide
 * sperren, solange die Anfrage läuft: zweimal tippen stellte sonst zwei Codes
 * aus, von denen einer nie eingelöst wird.
 */
function Buttons() {
  const { pending } = useFormStatus();

  return (
    <>
      <Button
        type="submit"
        name="entscheidung"
        value="erlauben"
        loading={pending}
        className="flex-1"
      >
        Erlauben
      </Button>
      <Button
        type="submit"
        name="entscheidung"
        value="ablehnen"
        variant="secondary"
        disabled={pending}
      >
        Ablehnen
      </Button>
    </>
  );
}
