"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * „Verwerfen“ — der Knopf, der einen Vorschlag beiseitelegt.
 *
 * Er steht an zwei Stellen: klein in der Liste des Korbs und groß unter dem
 * Formular, das den Vorschlag übernehmen würde. Beide Male dasselbe Formular
 * mit derselben Server Action, deshalb dasselbe Bauteil.
 *
 * **Ohne Rückfrage, und das ist Absicht.** Verworfen wird nichts gelöscht: der
 * Vorschlag bleibt stehen, er wird nur ruhig, und vierzehn Tage lang steht er
 * weiter im Korb unter den entschiedenen. Am Bestand der App ändert ein
 * Verwerfen ohnehin nichts — es sagt nur, dass daraus nichts werden soll. Eine
 * Rückfrage vor einer folgenlosen Geste erzieht dazu, Rückfragen wegzuklicken.
 *
 * Eine eigene Client-Komponente allein wegen `useFormStatus`: der Knopf soll
 * sperren, solange seine Anfrage läuft. Ohne das lässt sich zweimal tippen, und
 * der zweite Tipp bekommt von `decideProposal()` zu Recht ein Nein — nur sieht
 * der Nutzer davon nichts als eine Seite, die kurz hängt.
 */

export type DiscardButtonProps = {
  action: () => Promise<void>;
  /** In der Liste steht weniger Platz zur Verfügung als unter dem Formular. */
  variant?: "ghost" | "danger";
  label?: string;
};

export function DiscardButton({
  action,
  variant = "ghost",
  label = "Verwerfen",
}: DiscardButtonProps) {
  return (
    <form action={action}>
      <Submit variant={variant} label={label} />
    </form>
  );
}

function Submit({
  variant,
  label,
}: {
  variant: "ghost" | "danger";
  label: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      loading={pending}
      className={
        variant === "ghost"
          ? "text-muted hover:bg-danger-soft hover:text-danger"
          : undefined
      }
    >
      {label}
    </Button>
  );
}
