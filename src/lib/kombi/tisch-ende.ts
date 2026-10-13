import { fragenText, type WhStand } from "@/lib/kombi/wiederholen-text";

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

/**
 * Ein Übungsthema ohne Blatt (kein Schlüssel, oder das Blatt von heute ist
 * schon ausgewertet). Über „Wiederholen“ kam es, weil Fragen fällig sind:
 * dann für heute Karten. Einzeln geöffnet („Blatt Grammatik …“) muss heute
 * nichts fällig sein: dann schließt der Tisch und ein Toast sagt es, kurz
 * genug für eine Zeile am Handy.
 */
export function ohneBlatt(
  einzeln: boolean,
  titel: string,
): { art: "karten" } | { art: "schliessen"; toast: string } {
  if (!einzeln) return { art: "karten" };
  return { art: "schliessen", toast: `Heute kein Blatt zu ${titel}.` };
}

/**
 * Das Themenende einer Kartenrunde. Ohne eine einzige Frage sitzt nichts:
 * kein „sitzt“, und das Thema gilt nicht als beendet (kein `thema_beendet`).
 */
export function kartenEnde(
  titel: string,
  n: number,
  ok: number,
): { kopf: string; zeile: string; beenden: boolean } {
  if (n === 0) return { kopf: "Heute nichts offen.", zeile: `Zu ${titel} gibt es heute keine Fragen.`, beenden: false };
  return {
    kopf: `${titel} sitzt.`,
    zeile: `${fragenText(n)}, ${ok === n ? "alle" : ok} beim ersten Mal.`,
    beenden: true,
  };
}
