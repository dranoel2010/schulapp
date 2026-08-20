import type { CSSProperties } from "react";

/**
 * Der Balken zu einem Schnitt: dieselbe Zahl, nur zum Ansehen.
 *
 * Er steht überall dort, wo ein Schnitt mehr Platz hat als seine Ziffern
 * brauchen — in der Fachzeile der Tabelle und im Kopf der Fachseite. Gefärbt
 * ist er in der Fachfarbe, damit Zeile und Fach ohne zweites Hinsehen
 * zusammengehören.
 */

/**
 * Wie voll der Balken steht, 0–100.
 *
 * Die Regel ist `(6 − Schnitt) / 5 × 100`: eine 1,0 füllt ihn ganz, eine 6,0
 * gar nicht. Der Entwurf setzt seine Breiten von Hand (1,7 → 78 %); das sind
 * gerundete Werte derselben Rechnung, nur lässt sich eine Regel auch auf eine
 * 1,3 anwenden, die im Entwurf nicht vorkommt.
 *
 * Geklemmt wird, weil die beste Note eine 1+ ist: ein Schnitt von 0,7 ergäbe
 * 106 % und liefe über den Rand hinaus.
 */
export function averageShare(average: number): number {
  return Math.min(100, Math.max(0, ((6 - average) / 5) * 100));
}

export type AverageBarProps = {
  /** Der Schnitt als Note (2,17), nicht in Zehnteln. */
  average: number;
  /** Die Fachfarbe als Hex-Wert aus @/lib/colors. */
  color: string;
  /** Für Breite und Abstand am Ort, an dem der Balken steht. */
  className?: string;
};

/**
 * Für ein Vorleseprogramm ist der Balken nichts wert: die Zahl, die er zeigt,
 * steht als Text unmittelbar daneben. Er bleibt deshalb `aria-hidden`, statt
 * dieselbe Auskunft ein zweites Mal anzusagen.
 */
export function AverageBar({ average, color, className }: AverageBarProps) {
  return (
    <span
      aria-hidden="true"
      style={{ "--subject": color } as CSSProperties}
      className={[
        "block h-[5px] overflow-hidden rounded-[3px] bg-surface-muted",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        style={{ width: `${averageShare(average)}%` }}
        className="block h-full rounded-[3px] bg-[var(--subject)]"
      />
    </span>
  );
}
