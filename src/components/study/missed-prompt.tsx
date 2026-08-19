"use client";

import { SubmitButton } from "@/components/study/block-item";
import { formatCountdown } from "@/lib/dates";

/**
 * Die Nachfrage bei liegen gebliebenen Lernblöcken.
 *
 * Sie steht oben auf der Startseite und auf der Detailseite der betroffenen
 * Prüfung — je Prüfung einmal, über alle betroffenen Tage zusammengefasst.
 * Bewusst kein Alarm: eine Frage, zwei Antworten, danach ist sie weg.
 */

export type MissedPromptProps = {
  subjectName: string;
  /** Farbe des Fachs als Hex-Wert */
  color: string;
  /** Wie viele Tage betroffen sind */
  days: number;
  /** Summe der Minuten, die auf diesen Tagen lagen */
  minutes: number;
  /** Der jüngste betroffene Tag — daraus wird "Gestern" */
  lastDate: string;
  /** Heute als "YYYY-MM-DD" */
  today: string;
  /** Verteilt die offenen Blöcke auf die verbleibenden Tage neu */
  catchUp: () => Promise<void>;
  /** Hakt die verpassten Blöcke ohne neuen Termin ab */
  skip: () => Promise<void>;
};

function capitalize(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

export function MissedPrompt({
  subjectName,
  color,
  days,
  minutes,
  lastDate,
  today,
  catchUp,
  skip,
}: MissedPromptProps) {
  const question =
    days <= 1
      ? `${capitalize(formatCountdown(today, lastDate))} waren ${minutes} min ${subjectName} geplant — nachholen oder streichen?`
      : `An ${days} Tagen sind ${minutes} min ${subjectName} liegen geblieben — nachholen oder streichen?`;

  return (
    <section
      aria-label="Offene Lernzeit"
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 8%, var(--surface))`,
      }}
      className="rounded-card border border-border p-4 sm:p-5"
    >
      <p className="flex gap-3 text-[0.9375rem] text-foreground">
        <span
          aria-hidden="true"
          style={{ backgroundColor: color }}
          className="mt-2 size-2.5 shrink-0 rounded-full"
        />
        <span>{question}</span>
      </p>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <form action={catchUp}>
          <SubmitButton>Nachholen</SubmitButton>
        </form>
        <form action={skip}>
          <SubmitButton variant="secondary">Streichen</SubmitButton>
        </form>
      </div>

      <p className="mt-2.5 text-sm text-subtle">
        Nachholen verteilt die Blöcke auf die Tage bis zur Prüfung neu.
        Streichen hakt sie ohne neuen Termin ab.
      </p>
    </section>
  );
}
