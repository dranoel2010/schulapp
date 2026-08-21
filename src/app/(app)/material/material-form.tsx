"use client";

import {
  useActionState,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { Subject } from "@/db/schema";
import { formatGerman } from "@/lib/dates";
import { formatBytes } from "@/lib/images";
import type {
  MaterialFormState,
  MaterialPageInfo,
  MaterialTopicRef,
} from "@/lib/materials";
import type { TopicItem } from "@/lib/subject-topics";
import { TOPIC_MAX_LENGTH, topicKey } from "@/lib/topics";

/**
 * Alles, was auf der Seite eines Blattes angefasst wird: die Seiten mit ihrem
 * Löschknopf, das Formular darunter und ganz unten das Löschen des Blattes.
 *
 * Drei Bauteile in einer Datei, weil sie zusammen eine Seite ergeben und jedes
 * für sich zu klein ist — so wie homework-form.tsx das Formular und seine
 * Gefahrenzone zusammenhält.
 *
 * Das Formular schickt ab und bleibt, wo es ist. Anders als bei Aufgaben und
 * Prüfungen gibt es hier kein „Abbrechen“ und keine Rückkehr zur Liste: die
 * Seite des Blattes ist der Ort, an dem man das Blatt ansieht, und das
 * Richtigstellen ist ein Nebenher. Deshalb steht nach dem Speichern eine
 * ruhige Bestätigung da statt einer Weiterleitung.
 *
 * Die Themen funktionieren wie die einer Prüfung (siehe topic-input.tsx unter
 * /klausuren): ein Feld, ein Thema, Enter bestätigt, darunter das Vokabular
 * des Fachs als antippbare Chips. Getippt wird selten; angetippt oft.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const EMPTY_STATE: MaterialFormState = {};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** „Mittwoch, 14. September“ — oder nichts, solange das Feld leer ist. */
function dayLabel(date: string): string | null {
  if (!ISO_DATE.test(date)) return null;

  try {
    return formatGerman(date);
  } catch {
    // Ein Datum wie 2026-02-31 kommt hier an, bevor zod es abfängt.
    return null;
  }
}

/** Knopf, der von selbst merkt, dass sein Formular gerade läuft. */
function SubmitButton({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: ButtonProps["variant"];
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} loading={pending}>
      {children}
    </Button>
  );
}

/* -------------------------------------------------------------------------
   Die Seiten
   ------------------------------------------------------------------------- */

/** Eine Seite mit der Action, die genau sie löscht. */
export type MaterialPageView = MaterialPageInfo & {
  deleteAction: () => Promise<void>;
};

export type MaterialPagesProps = {
  /** Die Seiten in ihrer Reihenfolge, wie sie aus der Datenschicht kommen. */
  pages: MaterialPageView[];
  /** Der Titel des Blattes — er steht in der Bildbeschreibung. */
  title: string;
};

/**
 * Die Seiten des Blattes, groß und untereinander.
 *
 * Feste Maße an jedem Bild, damit die Seite beim Laden nicht springt; die
 * Zahlen stehen in der Datenbank, weil der Browser sie beim Aufnehmen gezählt
 * hat. Ein gewöhnliches <img> und nicht next/image: die Bilder kommen aus
 * einem eigenen Route Handler, der die Sitzung prüft, und die Bildoptimierung
 * schickt keine Cookies mit.
 *
 * Der Löschknopf steht unter dem Bild und ist leise. Er fragt trotzdem nach —
 * eine abfotografierte Tafel ist eine Woche später nicht noch einmal
 * aufzunehmen.
 */
export function MaterialPages({ pages, title }: MaterialPagesProps) {
  return (
    <div className="space-y-6">
      {pages.map((page, index) => (
        <figure key={page.id} className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache */}
          <img
            src={`/api/material/${page.id}`}
            alt={`Seite ${index + 1} von ${title}`}
            width={page.width}
            height={page.height}
            loading="lazy"
            decoding="async"
            className="h-auto w-full rounded-card border border-border bg-surface-muted"
          />

          <figcaption className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-sm text-muted">
              {`Seite ${index + 1} von ${pages.length} · ${formatBytes(page.byteSize)}`}
            </span>

            {/* Die letzte Seite bekommt keinen Knopf: ein Blatt ohne Seite
                wäre ein Titel und sonst nichts. Wer es loswerden will, löscht
                das Blatt — das steht weiter unten und fragt anders. */}
            {pages.length > 1 ? (
              <PageDelete
                label={`Seite ${index + 1}`}
                deleteAction={page.deleteAction}
              />
            ) : (
              <span className="text-sm text-subtle">
                Die einzige Seite bleibt stehen.
              </span>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Löschen mit einem Zwischenschritt, klein genug für eine Bildunterschrift. */
function PageDelete({
  label,
  deleteAction,
}: {
  label: string;
  deleteAction: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="text-danger hover:bg-danger-soft hover:text-danger"
        onClick={() => setConfirming(true)}
      >
        {`${label} löschen`}
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-foreground">Wirklich? Das bleibt weg.</span>

      <form action={deleteAction}>
        <SubmitButton variant="danger">Ja, löschen</SubmitButton>
      </form>

      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Doch nicht
      </Button>
    </span>
  );
}

/* -------------------------------------------------------------------------
   Die Themen
   ------------------------------------------------------------------------- */

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

type TopicInputProps = {
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
function TopicInput({
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
function TopicSuggestions({
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

/* -------------------------------------------------------------------------
   Das Formular
   ------------------------------------------------------------------------- */

/** Für die Auswahl reicht, woran man ein Fach erkennt. */
export type MaterialFormSubject = Pick<Subject, "id" | "name">;

export type MaterialFormProps = {
  action: (
    state: MaterialFormState,
    formData: FormData,
  ) => Promise<MaterialFormState>;
  /** Nicht archivierte Fächer, dazu das eigene, falls es archiviert ist. */
  subjects: MaterialFormSubject[];
  /**
   * Je Fach sein Themen-Vokabular, auf dem Server vorgerechnet. Vorgerechnet,
   * weil sich das Fach im Formular ändern kann, während man tippt — eine
   * Abfrage pro Umschalten wäre der Preis dafür, dass die Chips immer exakt
   * zum Stand im Formular passen.
   */
  topicSuggestions: Record<string, TopicItem[]>;
  /** Das Blatt, wie es gespeichert ist. */
  item: {
    subjectId: string;
    title: string;
    capturedOn: string;
    note: string | null;
    topics: MaterialTopicRef[];
  };
  /** Der heutige Kalendertag aus todayInBerlin(). */
  today: string;
};

export function MaterialForm({
  action,
  subjects,
  topicSuggestions,
  item,
  today,
}: MaterialFormProps) {
  const savedTopics = item.topics.map((topic) => topic.title);

  const [subjectId, setSubjectId] = useState(item.subjectId);
  const [title, setTitle] = useState(item.title);
  const [capturedOn, setCapturedOn] = useState(item.capturedOn);
  const [note, setNote] = useState(item.note ?? "");
  const [topics, setTopics] = useState<string[]>(savedTopics);

  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  /**
   * Nach dem Speichern steht in der Themenzeile, was am Blatt hängt — und
   * nicht mehr das, was getippt wurde.
   *
   * Solange getippt wird, ist `topics` der Stand des Nutzers und muss es
   * bleiben: folgte das Formular bei jedem Rendern dem Server, verschwände ein
   * gerade angefangener Chip unter der Hand. Nachgezogen wird deshalb genau
   * dann, wenn sich einer von zwei Werten ändert; beide stehen zusammen in
   * `savedMark`.
   *
   * - `state.saves` geht hoch, sobald geschrieben wurde. Das ist der Fall, in
   *   dem am Blatt alles beim Alten bleibt und der Bildschirm trotzdem falsch
   *   steht: „Übungen“ trägt kein Fachwort und wird nicht angelegt — der Chip
   *   behauptete danach ein Thema, das die Datenbank nicht kennt, und ein
   *   zweites Speichern schickte ihn beliebig oft wieder mit.
   * - Die Titel am Blatt ändern sich, sobald `revalidatePath` einen neuen
   *   Stand nachgeliefert hat. Zwei getippte Titel, die auf dieselbe Vokabel
   *   fallen („Kettenregel“ und „Kettenregel Übungen“), stehen danach als ein
   *   Chip da statt als zwei; und ein anderswo umbenanntes Thema steht unter
   *   seinem neuen Namen.
   *
   * Üblicherweise kommen Antwort und neuer Stand im selben Rendern an. Kämen
   * sie getrennt, zieht jedes Zeichen für sich nach — deshalb ein Wert und
   * nicht zwei Bedingungen.
   *
   * Gesetzt wird mitten im Rendern, mit dem alten Wert daneben zum Vergleichen.
   * Das ist der Weg, den React für „State beim Wechsel einer Prop anpassen“
   * vorsieht: der angefangene Durchlauf wird verworfen und sofort neu
   * gerendert, ohne dass dazwischen der falsche Stand auf dem Bildschirm steht.
   */
  const savedMark = [state.saves ?? 0, ...savedTopics].join("\n");
  const [lastMark, setLastMark] = useState(savedMark);

  if (lastMark !== savedMark) {
    setLastMark(savedMark);
    setTopics(savedTopics);
  }

  /**
   * Wechselt das Fach, fällt die Themenliste weg — und zwar sichtbar.
   *
   * Die Themen gehören dem Vokabular des alten Fachs: „Kettenregel“ ist ein
   * Thema von Mathematik, und an einem Blatt in Physik stünde es als Fremdwort
   * da. Die Datenschicht löst die Paarungen beim Fachwechsel deshalb auf; das
   * hier ist dieselbe Entscheidung, nur eine Sekunde früher und auf dem
   * Bildschirm zu sehen. Zurückgeschaltet stehen sie wieder da, solange nicht
   * gespeichert wurde.
   */
  function chooseSubject(nextId: string) {
    setSubjectId(nextId);
    setTopics(nextId === item.subjectId ? savedTopics : []);
  }

  const subjectChanged = subjectId !== item.subjectId;

  const topicHint = subjectChanged
    ? "Das Fach ist gewechselt — die Themen des alten Fachs bleiben dort stehen, an diesem Blatt fallen sie weg."
    : "Wonach du dieses Blatt später suchen würdest. Angetippt geht schneller als getippt.";

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.message ? (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      {/* Ein Erfolg wird nur mitgeteilt (role="status") und nicht gemeldet —
          sonst unterbricht jede Kleinigkeit den Vorleser mitten im Satz. */}
      {!state.message && state.notice ? (
        <p
          role="status"
          className="rounded-control border border-border bg-surface-muted px-3.5 py-3 text-sm text-foreground"
        >
          {state.notice}
        </p>
      ) : null}

      <Field id="title" label="Titel" error={state.errors?.title}>
        {(control) => (
          <Input
            {...control}
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Arbeitsblatt Kurvendiskussion"
            // Die Grenze selbst steht im Prüfschema in @/lib/materials; hier
            // ist sie nur die Bremse im Feld. Der Wert steht als Zahl da, weil
            // @/lib/materials die Datenbank mitbringt und in einer Client-
            // Komponente nichts zu suchen hat.
            maxLength={80}
            autoComplete="off"
          />
        )}
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="subjectId" label="Fach" error={state.errors?.subjectId}>
          {(control) => (
            <Select
              {...control}
              name="subjectId"
              value={subjectId}
              onChange={(event) => chooseSubject(event.target.value)}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="capturedOn"
          label="Vom"
          hint={dayLabel(capturedOn) ?? undefined}
          error={state.errors?.capturedOn}
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              name="capturedOn"
              value={capturedOn}
              // Ein Blatt aus der Zukunft gibt es nicht — dasselbe sagt das
              // Prüfschema, hier steht es nur schon im Feld.
              max={today}
              onChange={(event) => setCapturedOn(event.target.value)}
            />
          )}
        </Field>
      </div>

      <Field
        id="themen"
        label="Themen"
        optional
        hint={topicHint}
        error={state.errors?.topics}
      >
        {(control) => (
          <>
            <TopicInput
              {...control}
              name="themen"
              topics={topics}
              onTopicsChange={setTopics}
            />

            {/* Das key am Fach setzt „Alle zeigen“ beim Fachwechsel zurück:
                aufgeklappt wurde die Liste des einen Fachs, nicht die des
                nächsten. */}
            <TopicSuggestions
              key={subjectId}
              suggestions={topicSuggestions[subjectId] ?? []}
              topics={topics}
              onTopicsChange={setTopics}
            />
          </>
        )}
      </Field>

      <Field
        id="note"
        label="Notiz"
        optional
        hint="Was auf dem Bild nicht steht: bis wann es gerechnet werden soll, wo die Lösung liegt."
        error={state.errors?.note}
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>

      <div className="pt-2">
        <Button type="submit" loading={pending} className="w-full sm:w-auto">
          Änderungen speichern
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------
   Das Löschen
   ------------------------------------------------------------------------- */

export type MaterialDangerZoneProps = {
  /** Wie das Blatt in der Ablage steht, z.B. „Mathematik · Arbeitsblatt 3“. */
  materialLabel: string;
  /** Wie viele Seiten mit weggehen — das gehört in die Frage. */
  pageCount: number;
  deleteAction: () => Promise<void>;
};

/** Löschen — bewusst unten, mit einem sichtbaren Zwischenschritt. */
export function MaterialDangerZone({
  materialLabel,
  pageCount,
  deleteAction,
}: MaterialDangerZoneProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      {confirming ? (
        <div className="space-y-3 rounded-control border border-danger/40 bg-danger-soft p-3.5">
          <p className="text-sm text-foreground">
            {materialLabel} wirklich löschen? Damit{" "}
            {pageCount === 1
              ? "ist auch die Aufnahme weg"
              : `sind auch die ${pageCount} Aufnahmen weg`}
            . Rückgängig geht das nicht, und ein zweites Mal abfotografieren
            lässt sich eine Tafel von letzter Woche nicht.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={deleteAction}>
              <SubmitButton variant="danger">
                Ja, endgültig löschen
              </SubmitButton>
            </form>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Doch nicht
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="text-danger hover:bg-danger-soft hover:text-danger"
          onClick={() => setConfirming(true)}
        >
          Blatt löschen
        </Button>
      )}
    </section>
  );
}
