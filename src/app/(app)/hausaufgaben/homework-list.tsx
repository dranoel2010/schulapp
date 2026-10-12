"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import Link from "next/link";

import { HomeworkCheck } from "@/components/homework/homework-check";
import { dueLabel, dueTone, type DueTone } from "@/lib/due-label";
import type { HomeworkItem } from "@/lib/homework";

/**
 * Die Aufgabenliste mit lokalen Such- und Statusfiltern.
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
              "break-words text-[0.9375rem] font-medium md:min-w-0 md:flex-1",
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
            "shrink-0 rounded-pill bg-surface-muted px-2.5 py-1.5 text-xs font-medium",
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
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [query, setQuery] = useState("");
  const open = items.filter((item) => !item.done).length;
  const done = items.length - open;
  const search = query.trim().toLocaleLowerCase("de");
  const visible = items.filter((item) =>
    (filter === "all" || (filter === "done" ? item.done : !item.done)) &&
    `${item.title} ${item.subject.name}`.toLocaleLowerCase("de").includes(search),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex gap-1 rounded-control border border-border bg-surface p-1" role="group" aria-label="Aufgabenstatus">
          {([{ id: "all", label: "Alle", count: items.length }, { id: "open", label: "Offen", count: open }, { id: "done", label: "Erledigt", count: done }] as const).map((option) => (
            <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)} className={`min-h-11 rounded-[10px] px-3 text-sm transition-colors ${filter === option.id ? "bg-accent text-accent-foreground" : "text-muted hover:bg-surface-muted"}`}>
              {option.label} <span className="ml-1 text-xs opacity-75">{option.count}</span>
            </button>
          ))}
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="homework-search" className="mb-1.5 block text-xs font-medium text-muted">Aufgabe oder Fach suchen</label>
          <Input id="homework-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="z. B. Mathematik" />
        </div>
      </div>
      {visible.length > 0 ? (
        <ul className="space-y-2.5 md:space-y-0 md:overflow-hidden md:rounded-card md:border md:border-border md:bg-surface">
          {visible.map((item) => <HomeworkRow key={item.id} item={item} today={today} />)}
        </ul>
      ) : (
        <div className="rounded-card border border-border bg-surface p-8 text-center">
          <p className="font-medium">{filter === "open" && !query ? "Alles erledigt." : "Keine passenden Aufgaben."}</p>
          <button type="button" onClick={() => { setQuery(""); setFilter("all"); }} className="mt-3 min-h-11 text-sm font-medium text-accent">Alle Aufgaben anzeigen</button>
        </div>
      )}
      <p aria-live="polite" role="status" className="text-sm text-muted">{visible.length} angezeigt · {open} offen · {done} erledigt</p>
    </div>
  );
}
