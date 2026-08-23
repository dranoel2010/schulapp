"use client";

import {
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TopicItem } from "@/lib/subject-topics";
import { TOPIC_MAX_LENGTH, topicKey } from "@/lib/topics";

/**
 * Die Themen eines Blattes als Chips — das Feld und die Vorschläge darunter.
 *
 * Gebaut wurde es für das Formular eines Blattes (`material-form.tsx`) und
 * steht seit dem Eingangskorb hier: dort wird derselbe Griff gebraucht, wenn
 * ein Vorschlag übernommen wird, und zwar mit denselben Regeln. Zwei Fassungen
 * hießen, dass die eine irgendwann Dubletten anders faltet als die andere —
 * und dass am Blatt ein Thema landet, das dort nach der einen Regel gar nicht
 * hätte hinkommen dürfen.
 *
 * Beides sind Client-Komponenten und beide arbeiten ohne Server: was
 * ausgewählt ist, hängt als verstecktes Feld am Formular, das sie umgibt.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * So viele Chips stehen unter dem Feld, bevor „Alle zeigen“ kommt. Zwölf sind
 * zwei bis drei Zeilen — so viel überfliegt man noch.
 */
const SUGGESTION_LIMIT = 12;

/** Groß- und Kleinschreibung macht kein zweites Thema. */
function isKnown(topics: string[], title: string): boolean {
  const key = topicKey(title);
  return topics.some((topic) => topicKey(topic) === key);
}

export type TopicInputProps = {
  id: string;
  name: string;
  topics: string[];
  onTopicsChange: (topics: string[]) => void;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

/**
 * Die Themenliste eines Blattes.
 *
 * Ein Feld, ein Thema: eintippen, Enter (oder „Hinzufügen“), fertig. Jedes
 * bestätigte Thema hängt als verstecktes Feld am Formular, und das Eingabefeld
 * trägt denselben Namen — was beim Abschicken noch darin steht, zählt dadurch
 * mit, auch wenn das Enter vergessen wurde.
 *
 * Anders als bei einer Prüfung sind die Themen hier nicht nummeriert: aus
 * ihnen wird kein Lernplan, sie sind Schlagworte. Deshalb steht die Liste als
 * Chips da und nicht als geordnete Aufzählung.
 */
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
        <ul className="flex flex-wrap gap-2">
          {topics.map((topic) => (
            <li key={topic}>
              <input type="hidden" name={name} value={topic} />

              <span className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-pill border border-accent bg-accent-soft py-1 pl-3.5 pr-1 text-sm font-medium text-accent">
                <span className="min-w-0 truncate">{topic}</span>

                <button
                  type="button"
                  onClick={() =>
                    onTopicsChange(topics.filter((item) => item !== topic))
                  }
                  aria-label={`${topic} entfernen`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
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

/**
 * Das Vokabular des Fachs als antippbare Chips: antippen fügt hinzu, nochmal
 * antippen nimmt wieder weg.
 *
 * Verglichen wird über `topicKey()` und nicht über `===` — sonst zeigte ein
 * Chip „nicht gewählt“ für ein Thema, das mit anderer Schreibweise längst in
 * der Liste steht. Es ist dieselbe Faltung, mit der `normalizeTopics()` beim
 * Speichern Dubletten wegwirft.
 *
 * Hat das Fach kein Vokabular, steht hier gar nichts. Woher Themen kommen,
 * erklärt die Themenpflege am Fach.
 */
export function TopicSuggestions({
  suggestions,
  topics,
  onTopicsChange,
}: {
  suggestions: TopicItem[];
  topics: string[];
  onTopicsChange: (topics: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (suggestions.length === 0) return null;

  const chosen = new Set(topics.map(topicKey));
  const visible = showAll ? suggestions : suggestions.slice(0, SUGGESTION_LIMIT);

  function toggle(title: string) {
    const key = topicKey(title);

    onTopicsChange(
      chosen.has(key)
        ? topics.filter((topic) => topicKey(topic) !== key)
        : [...topics, title],
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap gap-2">
        {visible.map((topic) => {
          const isChosen = chosen.has(topicKey(topic.title));

          return (
            <button
              key={topic.id}
              type="button"
              aria-pressed={isChosen}
              onClick={() => toggle(topic.title)}
              className={cn(
                "inline-flex min-h-11 max-w-full items-center rounded-pill",
                "border px-3.5 py-1.5 text-left text-sm transition-colors",
                isChosen
                  ? "border-accent bg-accent-soft font-medium text-accent"
                  : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
              )}
            >
              {topic.title}
            </button>
          );
        })}
      </div>

      {!showAll && suggestions.length > SUGGESTION_LIMIT ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="inline-flex min-h-11 items-center text-sm text-accent transition-colors hover:text-accent-hover"
        >
          Alle zeigen
        </button>
      ) : null}
    </div>
  );
}