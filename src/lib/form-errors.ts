import type { ZodIssue } from "zod";

/**
 * Was zod bemängelt hat, auf die zwei Plätze verteilt, die ein Formular dafür
 * hat.
 *
 * Reine Rechnung: keine Datenbank, kein Import aus Next, kein Wissen über ein
 * einzelnes Formular. Deshalb steht sie hier und nicht in einer der
 * `actions.ts` — sie beantwortet dieselbe Frage für jedes Formular der App,
 * und drei abgeschriebene Fassungen davon wären drei Gelegenheiten,
 * verschieden zu antworten. Genau das war sie eine Zeit lang: einmal für das
 * Blatt, einmal für den Vorschlag, einmal in der Ablage.
 *
 * Die zwei Plätze sind nicht Geschmack, sondern zwei verschiedene Aussagen:
 *
 * - Ein Fehler **mit** Pfad hängt an einem Feld. Er steht unter diesem Feld,
 *   direkt an der Stelle, an der etwas zu tun ist.
 * - Ein Fehler **ohne** Pfad hängt am ganzen Objekt — er entsteht aus einem
 *   `.refine()` über der ganzen Eingabe, etwa „ein Vorschlag, der nichts
 *   vorschlägt, ist keiner". Ihn unter irgendein Feld zu schreiben, hieße
 *   eines auszusuchen und zu behaupten, ausgerechnet dort fehle etwas; in
 *   Wahrheit fehlen alle. Also steht er über dem Formular.
 *
 * Je Platz gilt die **erste** Meldung. Unter ein Feld passt keine zweite, und
 * zwei Sätze übereinander über demselben Feld lesen sich als zwei Fehler, wo
 * einer ist. Aus demselben Grund steht über dem Formular die erste Meldung
 * ohne Pfad und nicht alle aneinandergereiht.
 *
 * Über das Feld entscheidet allein der **erste** Teil des Pfades, und tiefere
 * Teile werden bewusst ignoriert. Eine Meldung zu `themen[3]` steht damit
 * unter „Themen" — dort steht das Eingabefeld, in dem alle Themen zusammen
 * stehen, und ein eigenes Feld für den vierten Eintrag gibt es auf keinem
 * Bildschirm. Der Weg dahin ist kein Zufall: `path[0]` ist bei zod der
 * Feldname, die Nummer des Eintrags steht erst dahinter.
 *
 * Ist der erste Teil ausnahmsweise doch keine Zeichenkette — das geht nur,
 * wenn das Prüfschema an seiner Wurzel eine Liste ist —, dann gibt es kein
 * Feld, unter das die Meldung gehörte. Sie fällt dann nicht weg, sondern
 * landet über dem Formular: dort steht sie falsch platziert, aber sie steht.
 * Verschluckt wäre schlimmer.
 */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type FormErrors<K extends string> = {
  /** Der Satz über dem Formular. Fehlt, wenn jeder Fehler an einem Feld hängt. */
  message?: string;
  /** Je Feld die erste Meldung. */
  errors: FieldErrors<K>;
};

export function formErrors<K extends string>(
  issues: readonly Pick<ZodIssue, "path" | "message">[],
): FormErrors<K> {
  const errors: FieldErrors<K> = {};
  let message: string | undefined;

  for (const issue of issues) {
    const field = issue.path[0];

    if (typeof field !== "string") {
      message ??= issue.message;
      continue;
    }

    const key = field as K;
    if (!errors[key]) errors[key] = issue.message;
  }

  return { message, errors };
}
