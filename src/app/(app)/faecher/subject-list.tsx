import Link from "next/link";
import type { CSSProperties } from "react";

import type { Subject } from "@/db/schema";
import { subjectColor } from "@/lib/colors";

/**
 * Die Fächerliste. Ganze Zeile ist Link zum Bearbeiten, damit man auf dem
 * Handy nicht ein winziges Stift-Symbol treffen muss.
 *
 * Archivierte Fächer stehen in einem eigenen, zugeklappten Block — das ist ein
 * <details>, damit der Umschalter auch ohne JavaScript funktioniert.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** "60 % schriftlich" — an den Rändern klingt der Satz sonst schief. */
function weightLabel(weightWritten: number): string {
  if (weightWritten >= 100) return "nur schriftlich";
  if (weightWritten <= 0) return "nur mündlich";
  return `${weightWritten} % schriftlich`;
}

function SubjectRow({ subject }: { subject: Subject }) {
  const color = subjectColor(subject.color);
  const meta = [subject.teacher, subject.room].filter(Boolean).join(" · ");

  return (
    <li>
      <Link
        href={`/faecher/${subject.id}`}
        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
      >
        <span
          aria-hidden="true"
          style={{ backgroundColor: color.hex }}
          className="size-3 shrink-0 rounded-full"
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {subject.name}
            </span>
            <span
              style={
                {
                  backgroundColor: `color-mix(in oklab, ${color.hex} 16%, var(--surface))`,
                  color: `color-mix(in oklab, ${color.hex} 72%, var(--foreground))`,
                } as CSSProperties
              }
              className="shrink-0 rounded-pill px-1.5 py-0.5 text-xs font-semibold"
            >
              {subject.short}
            </span>
          </span>

          {meta ? (
            <span className="mt-0.5 block truncate text-sm text-muted">
              {meta}
            </span>
          ) : null}
        </span>

        <span className="shrink-0 text-sm text-muted">
          {weightLabel(subject.weightWritten)}
        </span>

        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4 shrink-0 text-subtle"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </Link>
    </li>
  );
}

function SubjectRows({
  subjects,
  className,
}: {
  subjects: Subject[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "divide-y divide-border overflow-hidden rounded-card border border-border bg-surface",
        className,
      )}
    >
      {subjects.map((subject) => (
        <SubjectRow key={subject.id} subject={subject} />
      ))}
    </ul>
  );
}

export type SubjectListProps = {
  active: Subject[];
  archived: Subject[];
};

export function SubjectList({ active, archived }: SubjectListProps) {
  return (
    <div className="space-y-4">
      {active.length > 0 ? (
        <SubjectRows subjects={active} />
      ) : (
        <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Alle Fächer sind archiviert.
        </p>
      )}

      {archived.length > 0 ? (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
            Archiviert ({archived.length})
          </summary>

          <div className="mt-2">
            <SubjectRows subjects={archived} className="opacity-60" />
            <p className="mt-2 text-sm text-subtle">
              Archivierte Fächer tauchen sonst nirgends auf. Zum Zurückholen
              antippen.
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
