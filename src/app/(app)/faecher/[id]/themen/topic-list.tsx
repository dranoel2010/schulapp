"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { TOPIC_MAX_LENGTH } from "@/lib/topics";

/**
 * Die Pflege des Themen-Vokabulars eines Fachs: die Liste und alles, was ein
 * Mensch von Hand daran tun kann.
 *
 * Der Grund für diese Ansicht ist eine Regel des ganzen Projekts — alles, was
 * die App später von selbst vorschlägt, muss hier auch von Hand gehen. Das
 * Zusammenlegen bleibt sogar auf Dauer dem Menschen vorbehalten: es ist die
 * einzige Geste dieser Seite, bei der etwas verloren gehen kann.
 *
 * Fünf Server Actions, aber nur drei Plätze für ihre Antwort: Umbenennen,
 * Zusammenlegen und Trennen teilen sich den Platz über der Liste, Anlegen und
 * Aufbauen melden sich bei ihrem eigenen Knopf. Über der Liste gilt die
 * jüngste Antwort — ohne diesen Vergleich bliebe der Fehler von vorhin über
 * einer Liste stehen, die inzwischen etwas ganz anderes zeigt.
 *
 * Jede Zeile klappt auf. Bei dreißig Themen wären drei offene Bedienfelder je
 * Zeile eine Wand; aufgeklappt wird mit <details>, damit das auch ohne
 * JavaScript funktioniert — so wie die Formulare darin.
 *
 * Die Zustandstypen stehen hier und nicht in actions.ts: eine „use server“-
 * Datei darf nur asynchrone Funktionen ausgeben.
 */

/** Antwort einer Server Action dieser Seite. */
export type TopicActionState = {
  /** Was schiefging — steht rot da. */
  message?: string;
  /** Was geklappt hat — steht ruhig da. */
  notice?: string;
  /**
   * Wann der Server geantwortet hat. Drei Formulare teilen sich einen Platz;
   * angezeigt wird die jüngste Antwort. `0` heißt: noch nichts gesagt.
   */
  answeredAt: number;
};

/** Alle fünf Actions haben dieselbe Form — `useActionState` verlangt sie so. */
export type TopicAction = (
  state: TopicActionState,
  formData: FormData,
) => Promise<TopicActionState>;

/**
 * Was `useActionState` zum Anhängen an ein <form> zurückgibt: die Action mit
 * dem Zustand davor schon im Gepäck. Die Zeilen unten bekommen diese Form und
 * nicht die Action selbst — sie sollen sich um keinen Zustand kümmern.
 */
type FormAction = (formData: FormData) => void;

/** Eine Schreibweise, die in ein Thema gelegt wurde. */
export type MergedTopic = {
  id: string;
  title: string;
};

/** Ein eigenständiges Thema mit den Schreibweisen, die darauf zeigen. */
export type TopicRow = MergedTopic & {
  /** In wie vielen Klausuren des Fachs es vorkommt, Schreibweisen mitgezählt. */
  examCount: number;
  /** An wie vielen Blättern des Fachs es hängt, Schreibweisen mitgezählt. */
  materialCount: number;
  merged: MergedTopic[];
};

export type TopicListProps = {
  /**
   * Die Themen in der Reihenfolge der Datenschicht: zuletzt gesehen zuerst,
   * bei Gleichstand nach Titel. Hier wird bewusst nicht noch einmal sortiert —
   * die Liste soll zwischen zwei Aufrufen an derselben Stelle stehen.
   */
  rows: TopicRow[];
  renameAction: TopicAction;
  mergeAction: TopicAction;
  unmergeAction: TopicAction;
  createAction: TopicAction;
  seedAction: TopicAction;
};

const EMPTY_STATE: TopicActionState = { answeredAt: 0 };

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Die jüngste von mehreren Antworten — siehe `answeredAt`. */
function newest(...states: TopicActionState[]): TopicActionState {
  return states.reduce((latest, state) =>
    state.answeredAt > latest.answeredAt ? state : latest,
  );
}

/**
 * Die leise Angabe hinter dem Titel: woran dieses Thema hängt.
 *
 * Beide Zahlen müssen dastehen. Seit der Kamera legen auch Blätter Themen an,
 * und ein Thema an zwölf Blättern nur nach seinen Klausuren zu beurteilen
 * hieße, es als „noch nirgends benutzt" neben die zu stellen, die es wirklich
 * sind — genau die Zeile, die man beim Aufräumen zusammenlegt. Zusammengelegt
 * würde damit stillschweigend auch die Zuordnung von zwölf Blättern verschoben.
 *
 * Die Angabe steht in einer Zeile neben dem Titel, deshalb ohne Präposition:
 * „3 Klausuren · 2 Blätter" statt eines Satzes. Was bei 0 steht, wird
 * weggelassen und nicht als Null hingeschrieben — ein Thema ohne Klausur hat
 * keine 0, es hat noch keine.
 *
 * Die Blattzahl ist ein Weg: sie führt in die Ablage, gefiltert auf genau
 * dieses Thema. Das ist die Antwort auf „was habe ich dazu?", und sie stand
 * bisher nur als Zahl da. Die Klausurzahl bleibt Text — es gibt keine Liste,
 * die auf „die Klausuren zu diesem Thema" gefiltert wäre, und ein Link, der
 * irgendwohin in die Nähe führt, ist schlechter als keiner.
 *
 * Verlinkt wird nur, was größer als 0 ist. „0 Blätter“ steht ohnehin nicht da
 * (siehe oben), und ein Weg zu einer leeren Liste wäre eine Sackgasse.
 *
 * Der Link steckt in einem <summary>, und das ist erlaubt: ein <summary> ist
 * kein <a>, verschachtelte Links entstehen hier also keine. Beim Antippen
 * gewinnt der Link — von zwei ineinanderliegenden bedienbaren Elementen führt
 * das innere seine Handlung aus —, die Zeile klappt darunter nicht zusätzlich
 * auf. Für die eingerückten Schreibweisen stellt sich die Frage gar nicht:
 * `AliasRow` zeigt überhaupt keine Zahlen, sondern nur, worauf sie zeigt.
 */
function UsageLabel({
  topicId,
  examCount,
  materialCount,
}: {
  topicId: string;
  examCount: number;
  materialCount: number;
}) {
  if (examCount === 0 && materialCount === 0) {
    return (
      <span className="shrink-0 text-sm text-muted">noch nirgends benutzt</span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted">
      {examCount > 0 ? (
        <span>{examCount === 1 ? "1 Klausur" : `${examCount} Klausuren`}</span>
      ) : null}

      {examCount > 0 && materialCount > 0 ? <span>·</span> : null}

      {materialCount > 0 ? (
        // Die Fingerfläche steht in der Zeile und nicht darüber hinaus:
        // min-h-11 in einer Zeile von min-h-16 macht sie nicht höher, ist aber
        // groß genug, um den Link neben dem Aufklappen zu treffen.
        <Link
          href={`/material?thema=${topicId}`}
          className="inline-flex min-h-11 items-center text-accent underline-offset-2 transition-colors hover:text-accent-hover hover:underline"
        >
          {materialCount === 1 ? "1 Blatt" : `${materialCount} Blätter`}
        </Link>
      ) : null}
    </span>
  );
}

/** Knopf, der von selbst merkt, dass sein Formular gerade läuft. */
function SubmitButton({
  children,
  variant = "secondary",
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

/**
 * Die Antwort einer Action. Ein Fehler wird gemeldet (`role="alert"`), ein
 * Erfolg nur mitgeteilt (`role="status"`) — sonst unterbricht jede
 * Kleinigkeit den Vorleser mitten im Satz.
 */
function Message({
  state,
  className,
}: {
  state: TopicActionState;
  className?: string;
}) {
  if (state.message) {
    return (
      <p
        role="alert"
        className={cn(
          "rounded-control border border-danger/40 bg-danger-soft px-3.5 py-3 text-sm text-danger",
          className,
        )}
      >
        {state.message}
      </p>
    );
  }

  if (state.notice) {
    return (
      <p
        role="status"
        className={cn(
          "rounded-control border border-border bg-surface-muted px-3.5 py-3 text-sm text-foreground",
          className,
        )}
      >
        {state.notice}
      </p>
    );
  }

  return null;
}

/** Das Dreieck vor einer Zeile, das sich beim Aufklappen dreht. */
function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-90"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

const SUMMARY =
  "flex min-h-16 cursor-pointer list-none items-center gap-3 py-3 pr-4 " +
  "transition-colors hover:bg-surface-muted [&::-webkit-details-marker]:hidden";

/** Das Feld zum Umbenennen — an der Zeile, die es meint. */
function RenameForm({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action: FormAction;
}) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />

      <Field id={`titel-${id}`} label="Titel" className="min-w-48 flex-1">
        {(control) => (
          <Input
            {...control}
            name="title"
            // Unkontrolliert mit Absicht: was der Nutzer getippt hat, soll
            // auch nach einer abgelehnten Umbenennung noch dastehen, damit er
            // es verbessern kann statt es neu zu tippen.
            defaultValue={title}
            maxLength={TOPIC_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>

      <SubmitButton>Umbenennen</SubmitButton>
    </form>
  );
}

/** Eine Zeile: ein eigenständiges Thema, darunter seine Schreibweisen. */
function TopicItemRow({
  topic,
  targets,
  renameAction,
  mergeAction,
  unmergeAction,
}: {
  topic: TopicRow;
  /** Die übrigen eigenständigen Themen des Fachs — mögliche Ziele. */
  targets: MergedTopic[];
  renameAction: FormAction;
  mergeAction: FormAction;
  unmergeAction: FormAction;
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <details className="group">
        <summary className={cn(SUMMARY, "pl-4")}>
          <Chevron />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {topic.title}
          </span>
          <UsageLabel
            topicId={topic.id}
            examCount={topic.examCount}
            materialCount={topic.materialCount}
          />
        </summary>

        <div className="space-y-5 border-t border-border px-4 py-4">
          <RenameForm
            id={topic.id}
            title={topic.title}
            action={renameAction}
          />

          {targets.length > 0 ? (
            <div className="space-y-2">
              <form action={mergeAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="fromId" value={topic.id} />

                <Field
                  id={`ziel-${topic.id}`}
                  label="Zusammenlegen mit"
                  className="min-w-48 flex-1"
                >
                  {(control) => (
                    <Select {...control} name="intoId" defaultValue="">
                      <option value="">Ziel wählen …</option>
                      {targets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <SubmitButton>Zusammenlegen</SubmitButton>
              </form>

              <p className="text-sm text-muted">
                „{topic.title}“ wandert unter das Ziel: der Titel bleibt als
                Schreibweise stehen und löst ab jetzt von selbst auf das Ziel
                auf. Die Klausuren und die Blätter, die daran hängen, zählen
                ab dann beim Ziel mit.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Zum Zusammenlegen braucht es ein zweites Thema in diesem Fach —
              noch gibt es keines.
            </p>
          )}
        </div>
      </details>

      {topic.merged.length > 0 ? (
        <ul>
          {topic.merged.map((alias) => (
            <AliasRow
              key={alias.id}
              alias={alias}
              parent={topic.title}
              renameAction={renameAction}
              unmergeAction={unmergeAction}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Eine zusammengelegte Schreibweise: eingerückt unter ihrem Ziel und als
 * solche benannt.
 *
 * Umbenennen gibt es hier, Zusammenlegen nicht. `renameTopic()` meint
 * ausdrücklich genau diese Zeile — wer eine Schreibweise umbenennt, hat sich
 * vertippt. `mergeTopics()` dagegen löst beide Seiten erst auf; ein
 * „Zusammenlegen“ an dieser Zeile träfe also das Ziel und zöge das ganze
 * Thema mit. Deshalb steht hier statt eines Auswahlfelds der Satz, wie es
 * geht: erst trennen.
 */
function AliasRow({
  alias,
  parent,
  renameAction,
  unmergeAction,
}: {
  alias: MergedTopic;
  /** Titel des Themas, auf das diese Schreibweise zeigt. */
  parent: string;
  renameAction: FormAction;
  unmergeAction: FormAction;
}) {
  return (
    <li className="border-t border-border">
      <details className="group">
        <summary className={cn(SUMMARY, "pl-10")}>
          <Chevron />
          <span className="min-w-0 flex-1 truncate text-muted">
            {alias.title}
          </span>
          <span className="shrink-0 rounded-pill bg-surface-muted px-2 py-0.5 text-xs text-muted">
            Schreibweise
          </span>
        </summary>

        <div className="space-y-5 border-t border-border py-4 pl-10 pr-4">
          <p className="text-sm text-muted">
            Zeigt auf „{parent}“. Die Klausuren und die Blätter, an denen
            diese Schreibweise hängt, zählen dort mit.
          </p>

          <RenameForm
            id={alias.id}
            title={alias.title}
            action={renameAction}
          />

          <div className="space-y-2">
            <form action={unmergeAction}>
              <input type="hidden" name="id" value={alias.id} />
              <SubmitButton>Trennen</SubmitButton>
            </form>

            <p className="text-sm text-muted">
              Trennen macht daraus wieder ein eigenes Thema. Zurückgenommen
              wird dieser eine Schritt — Schreibweisen, die dabei damals
              mitgekommen sind, bleiben bei „{parent}“.
            </p>
          </div>

          <p className="text-sm text-muted">
            Zusammenlegen gibt es an dieser Zeile nicht: eine Schreibweise löst
            dabei auf ihr Ziel auf, es zöge also „{parent}“ mit. Trenn sie erst
            ab.
          </p>
        </div>
      </details>
    </li>
  );
}

export function TopicList({
  rows,
  renameAction,
  mergeAction,
  unmergeAction,
  createAction,
  seedAction,
}: TopicListProps) {
  const [renameState, renameForm] = useActionState(renameAction, EMPTY_STATE);
  const [mergeState, mergeForm] = useActionState(mergeAction, EMPTY_STATE);
  const [unmergeState, unmergeForm] = useActionState(unmergeAction, EMPTY_STATE);
  const [createState, createForm] = useActionState(createAction, EMPTY_STATE);
  const [seedState, seedForm] = useActionState(seedAction, EMPTY_STATE);

  const listState = newest(renameState, mergeState, unmergeState);

  // Ziel einer Zusammenlegung kann nur ein eigenständiges Thema sein: eine
  // Schreibweise als Ziel würde beim Auflösen ohnehin bei deren Ziel landen,
  // stünde in der Auswahl aber wie ein eigenes Thema da.
  const targets: MergedTopic[] = rows.map(({ id, title }) => ({ id, title }));

  /**
   * Der Knopf für den Aufbau steht an zwei Stellen — im leeren Zustand ist er
   * der angebotene Weg, sonst unten in seinem eigenen Abschnitt. Gerendert
   * wird immer nur eine davon.
   */
  const seedBlock = (
    <div className="space-y-3">
      <form action={seedForm}>
        <SubmitButton>Vokabular aufbauen</SubmitButton>
      </form>
      <Message state={seedState} />
    </div>
  );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <Message state={listState} />

        {rows.length === 0 ? (
          <EmptyState
            title="Noch keine Themen"
            description="Themen entstehen aus den Themen deiner Klausuren und aus dem, was du an ein abfotografiertes Blatt schreibst. Der Knopf liest jede eingetragene Klausur — die aller Fächer, nicht nur die dieses einen — und legt daraus das Vokabular an."
            action={seedBlock}
          />
        ) : (
          <ul className="overflow-hidden rounded-card border border-border bg-surface">
            {rows.map((topic) => (
              <TopicItemRow
                key={topic.id}
                topic={topic}
                targets={targets.filter((target) => target.id !== topic.id)}
                renameAction={renameForm}
                mergeAction={mergeForm}
                unmergeAction={unmergeForm}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-card border border-border bg-surface p-4 sm:p-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            Thema von Hand anlegen
          </h2>
          <p className="text-sm text-muted">
            Ein Titel, ein Knopf. Was hier entsteht, unterscheidet sich in
            nichts von dem, was aus einer Klausur oder von einem Blatt kommt.
          </p>
        </div>

        <form action={createForm} className="flex flex-wrap items-end gap-2">
          <Field id="neues-thema" label="Titel" className="min-w-48 flex-1">
            {(control) => (
              <Input
                {...control}
                name="title"
                placeholder="Kettenregel"
                maxLength={TOPIC_MAX_LENGTH}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>

          <SubmitButton variant="primary">Anlegen</SubmitButton>
        </form>

        <Message state={createState} />
      </section>

      {rows.length > 0 ? (
        <section className="space-y-3 rounded-card border border-border bg-surface p-4 sm:p-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              Vokabular aus den Klausuren aufbauen
            </h2>
            <p className="text-sm text-muted">
              Liest jede eingetragene Klausur und legt daraus die fehlenden
              Themen an. Der Knopf betrifft <strong>alle Fächer</strong>, nicht
              nur dieses — er geht über den ganzen Bestand. Mehrmals drücken
              schadet nicht: was schon da ist, entsteht kein zweites Mal.
            </p>
          </div>

          {seedBlock}
        </section>
      ) : null}
    </div>
  );
}
