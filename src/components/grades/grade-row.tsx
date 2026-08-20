import Link from "next/link";

import { formatGerman } from "@/lib/dates";
import { gradeLabel } from "@/lib/grade-scale";
import type { GradeItem } from "@/lib/grades";

/**
 * Eine einzelne Note als Zeile — einmal für die Übersicht („Zuletzt
 * eingetragen“), einmal für die Fachseite.
 *
 * Beide führen auf /noten/<id>: eine Note antippen heißt, sie zu bearbeiten.
 * Was links steht, ist verschieden, weil der Zusammenhang ein anderer ist. In
 * der Übersicht kommt jede Zeile aus einem anderen Fach, also steht dort das
 * Fachkürzel; auf der Fachseite steht das Fach schon im Kopf, und interessant
 * ist stattdessen der Tag.
 *
 * Rechts steht in beiden Fällen das Notenkürzel („2+“) und keine Dezimalzahl:
 * so ist die Note zurückgegeben worden. Dezimal wird nur ein Schnitt.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Die Spalte `kind` ist Text. Geschrieben wird nur nach Prüfung; steht dort
 * trotzdem etwas anderes, zählt es wie in @/lib/grades als schriftlich —
 * lieber eine Zeile mit der falschen Beschriftung als eine leere Seite.
 */
export function kindLabel(kind: string): string {
  return kind === "muendlich" ? "mündlich" : "schriftlich";
}

/** Ohne Anlass trägt die Zeile die Art als Überschrift. */
function kindTitle(kind: string): string {
  return kind === "muendlich" ? "Mündliche Note" : "Schriftliche Note";
}

/** Ausgeschrieben liest sich das Gewicht besser als „×2“. */
const WEIGHT_WORDS: Record<number, string> = {
  2: "zählt doppelt",
  3: "zählt dreifach",
  4: "zählt vierfach",
  5: "zählt fünffach",
};

/**
 * Wie schwer die Note innerhalb ihrer Art wiegt — oder nichts.
 *
 * Ein Gewicht von 1 bleibt unerwähnt: es ist der Normalfall, und „zählt
 * einfach“ an jeder zweiten Zeile wäre Lärm ohne Aussage.
 */
export function weightLabel(weight: number): string | null {
  if (weight <= 1) return null;

  return WEIGHT_WORDS[weight] ?? `zählt ${weight}-fach`;
}

/** Rechts in beiden Zeilen: das Notenkürzel in Geist Mono. */
function GradeValue({
  value,
  className,
}: {
  value: number;
  className: string;
}) {
  return (
    <span className={cn("shrink-0 font-mono tabular-nums", className)}>
      {gradeLabel(value)}
    </span>
  );
}

/**
 * Eine Zeile in „Zuletzt eingetragen“: Fachkürzel · Anlass, rechts die Note.
 * Ohne Anlass steht dort die Art — sie ist das, was die App wirklich weiß.
 */
export function RecentGradeRow({ grade }: { grade: GradeItem }) {
  return (
    <li>
      <Link
        href={`/noten/${grade.id}`}
        className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-control px-2 text-[14px] transition-colors hover:bg-surface-muted"
      >
        <span className="min-w-0 truncate text-muted">
          {grade.subject.short} · {grade.title ?? kindLabel(grade.kind)}
        </span>

        <GradeValue value={grade.value} className="text-foreground" />
      </Link>
    </li>
  );
}

/**
 * Eine Zeile in der Notenliste eines Fachs: Tag, Anlass, darunter Art und
 * Gewicht. Fehlt der Anlass, rückt die Art nach oben und die zweite Zeile
 * bleibt weg oder trägt nur noch das Gewicht — doppelt steht die Art nirgends.
 */
export function SubjectGradeRow({ grade }: { grade: GradeItem }) {
  const weight = weightLabel(grade.weight);
  const meta = grade.title
    ? [kindLabel(grade.kind), weight].filter(Boolean).join(" · ")
    : weight;

  return (
    <li>
      <Link
        href={`/noten/${grade.id}`}
        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
      >
        <span className="w-[62px] shrink-0 font-mono text-[12px] tabular-nums text-subtle">
          {formatGerman(grade.date, "kurz")}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] text-foreground">
            {grade.title ?? kindTitle(grade.kind)}
          </span>
          {meta ? (
            <span className="mt-0.5 block truncate text-sm text-muted">
              {meta}
            </span>
          ) : null}
        </span>

        <GradeValue
          value={grade.value}
          className="text-[17px] text-foreground"
        />
      </Link>
    </li>
  );
}
