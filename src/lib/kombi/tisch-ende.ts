import type { WhStand } from "@/lib/kombi/wiederholen-text";

/**
 * Was der Tisch am Ende sagt und beim Schließen auf den Knopf „Wiederholen“
 * setzt. Rein, ohne DOM.
 *
 * `einzeln`: der Tisch kam über „Blatt Grammatik …“ (Antwort 5) mit genau
 * einem Thema, das heute nicht fällig sein muss. Dann weiß er nichts über die
 * fälligen Themen: Er sagt nicht „Alle Themen für heute durch.“ und
 * überschreibt den Knopf nicht, dort gilt der Stand vom Server.
 */

/** Der Stand, den der Tisch beim Schließen vorab setzt, oder null: dann gilt der Stand vom Server. */
export function knopfNachSchliessen(einzeln: boolean, neu: WhStand): WhStand | null {
  return einzeln ? null : neu;
}

/** Der Satz unter dem letzten Thema, oder null. */
export function endeHinweis(einzeln: boolean, rest: number): string | null {
  if (rest > 0 || einzeln) return null;
  return "Alle Themen für heute durch.";
}
