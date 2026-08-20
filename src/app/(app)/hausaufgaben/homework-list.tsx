import Link from "next/link";

import { HomeworkCheck } from "@/components/homework/homework-check";
import { dueLabel, dueTone, type DueTone } from "@/lib/due-label";
import type { HomeworkItem } from "@/lib/homework";

/**
 * Die Aufgabenliste — reine Anzeige, deshalb eine Server Component.
 *
 * Angefasst wird sie an zwei Stellen: das Kästchen hakt ab (es bringt seine
 * Action selbst mit), der Rest der Zeile führt zur Aufgabe. Beides darf
 * deshalb nicht ineinander stecken.
 *
 * Die Fachfarbe bleibt hier absichtlich weg — der Entwurf zeigt das Fach als
 * grauen Text neben dem Titel und sonst nichts. In einer Liste, in der fast
 * jede Zeile ein anderes Fach hat, führt eine Reihe bunter Punkte das Auge
 * nirgendwohin.
 *
 * Am Handy ist jede Aufgabe eine eigene Karte, ab md stehen sie als Zeilen in
 * einer gemeinsamen Karte — so die beiden Entwürfe.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Die Farbregel steht bei `DueTone` in @/lib/due-label. */
const TONE_CLASSES: Record<DueTone, string> = {
  overdue: "text-warning",
  today: "text-muted",
  soon: "text-muted",
  later: "text-muted",
  done: "text-subtle",
};

function HomeworkRow({ item, today }: { item: HomeworkItem; today: string }) {
  const tone = dueTone(item.dueDate, today, item.done);

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3",
        "transition-colors hover:border-border-strong",
        // Ab md wird aus der Karte eine Zeile: nur noch die untere Trennlinie
        // bleibt, die letzte fällt weg.
        "md:rounded-none md:border-x-0 md:border-t-0 md:last:border-b-0",
        "md:hover:border-border md:hover:bg-surface-muted",
      )}
    >
      <HomeworkCheck
        id={item.id}
        done={item.done}
        label={`${item.subject.name}: ${item.title}`}
      />

      <Link
        href={`/hausaufgaben/${item.id}`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-baseline md:gap-2.5">
          <span
            className={cn(
              "truncate text-[0.9375rem] md:min-w-0 md:flex-1",
              item.done ? "text-muted line-through" : "text-foreground",
            )}
          >
            {item.title}
          </span>
          <span className="truncate text-sm text-muted md:shrink-0">
            {item.subject.name}
          </span>
        </span>

        <span
          className={cn(
            "shrink-0 font-mono text-xs md:w-15 md:text-right",
            TONE_CLASSES[tone],
          )}
        >
          {dueLabel(item.dueDate, today)}
        </span>
      </Link>
    </li>
  );
}

export type HomeworkListProps = {
  items: HomeworkItem[];
  /** „YYYY-MM-DD“, kommt vom Server. */
  today: string;
};

export function HomeworkList({ items, today }: HomeworkListProps) {
  const open = items.filter((item) => !item.done).length;
  const done = items.length - open;

  // Die Zusammenfassung zählt, was zu sehen ist — nicht, was in der Datenbank
  // steht. „0 erledigt“ wäre eine Zahl ohne Aussage und bleibt weg.
  const summary =
    open === 0
      ? "Alles erledigt."
      : done === 0
        ? `${open} offen`
        : `${open} offen, ${done} erledigt`;

  return (
    <div>
      <ul className="space-y-2.5 md:space-y-0 md:overflow-hidden md:rounded-card md:border md:border-border md:bg-surface">
        {items.map((item) => (
          <HomeworkRow key={item.id} item={item} today={today} />
        ))}
      </ul>

      <p className="mt-3 text-sm text-subtle">{summary}</p>
    </div>
  );
}
