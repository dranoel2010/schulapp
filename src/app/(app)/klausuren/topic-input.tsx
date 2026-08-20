"use client";

import {
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TOPIC_MAX_LENGTH } from "@/lib/topics";

/**
 * Die Themenliste einer Prüfung.
 *
 * Ein Feld, ein Thema: eintippen, Enter (oder „Hinzufügen“), fertig. Darüber
 * stehen die bestätigten Themen nummeriert — in genau der Reihenfolge, in der
 * die App sie später auf die Lerntage verteilt.
 *
 * Jedes bestätigte Thema hängt als verstecktes Feld am Formular. Das
 * Eingabefeld trägt denselben Namen: was beim Abschicken noch darin steht,
 * zählt dadurch mit, auch wenn das Enter vergessen wurde.
 */

export type TopicInputProps = {
  id: string;
  name: string;
  topics: string[];
  onTopicsChange: (topics: string[]) => void;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

/** Groß- und Kleinschreibung macht kein zweites Thema. */
function isKnown(topics: string[], title: string): boolean {
  const key = title.toLocaleLowerCase("de");
  return topics.some((topic) => topic.toLocaleLowerCase("de") === key);
}

export function TopicInput({
  id,
  name,
  topics,
  onTopicsChange,
  ...control
}: TopicInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /** Nimmt auch mehrere Zeilen auf einmal — das hilft beim Einfügen. */
  function add(text: string) {
    const next = [...topics];

    for (const line of text.split(/[\r\n]+/)) {
      const title = line.trim().slice(0, TOPIC_MAX_LENGTH);
      if (!title || isKnown(next, title)) continue;
      next.push(title);
    }

    setDraft("");
    if (next.length !== topics.length) onTopicsChange(next);
    inputRef.current?.focus();
  }

  function remove(index: number) {
    onTopicsChange(topics.filter((_, position) => position !== index));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Ohne das schickt Enter das ganze Formular ab.
    event.preventDefault();
    add(draft);
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    // Eine kopierte Liste wird zu mehreren Themen, nicht zu einer langen Zeile.
    event.preventDefault();
    add(`${draft}${text}`);
  }

  return (
    <div className="space-y-2">
      {topics.length > 0 ? (
        <ol className="divide-y divide-border overflow-hidden rounded-control border border-border bg-surface">
          {topics.map((topic, index) => (
            <li key={topic} className="flex items-center gap-3 py-1 pl-3.5 pr-1">
              <input type="hidden" name={name} value={topic} />

              <span
                aria-hidden="true"
                className="shrink-0 text-sm tabular-nums text-subtle"
              >
                {index + 1}.
              </span>

              <span className="min-w-0 flex-1 py-2 text-base text-foreground">
                {topic}
              </span>

              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`${topic} entfernen`}
                className="flex size-11 shrink-0 items-center justify-center rounded-control text-subtle transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex gap-2">
        <Input
          {...control}
          ref={inputRef}
          id={id}
          name={name}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={topics.length === 0 ? "Kurvendiskussion" : "Nächstes Thema"}
          maxLength={TOPIC_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          className="flex-1"
        />

        <Button
          type="button"
          variant="secondary"
          onClick={() => add(draft)}
          disabled={draft.trim().length === 0}
        >
          Hinzufügen
        </Button>
      </div>
    </div>
  );
}
