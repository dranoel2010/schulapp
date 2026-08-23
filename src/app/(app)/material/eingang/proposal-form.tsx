"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { formatGerman } from "@/lib/dates";
import type { ProposalFormState } from "@/lib/inbox";

/**
 * Ein Vorschlag von Hand: fünf Felder, und jedes darf leer bleiben.
 *
 * Dieses Formular ist der Beweis, den KONZEPT.md verlangt — alles, was ein
 * Agent später vorschlägt, muss vorher von Hand anzulegen und zu ändern sein.
 * Deshalb legt es dieselben fünf Angaben an, die ein Agent nennen könnte, und
 * durch dieselbe Prüfung (`proposalInputSchema`).
 *
 * **Leer heißt überall dasselbe: „dazu sage ich nichts, es bleibt, wie es am
 * Blatt steht."** Das ist die eine Regel, die der Nutzer kennen muss, und ohne
 * sie liest sich ein leeres Feld als „lösch das". Sie steht deshalb zweimal
 * auf dem Bildschirm: einmal als Satz über dem Formular und dann noch einmal
 * an jedem Feld, das nicht von selbst zeigt, was passiert.
 *
 * Und daneben steht, **was am Blatt jetzt steht** — sonst tippt man ins Blaue.
 * Wo das Feld einen `placeholder` kann (Titel, Notiz, Themen), steht der Wert
 * des Blattes genau dort: als graue Schrift IM leeren Feld. Das ist die
 * ruhigste mögliche Fassung, weil sie den Satz von oben gar nicht wiederholt,
 * sondern vorführt — was im Feld steht, solange man nichts tippt, ist das, was
 * am Blatt bleibt. Wo der Browser keinen `placeholder` anbietet, geht das
 * nicht: ein `<select>` hat keinen, und `<input type="date">` zeigt statt
 * dessen sein eigenes „TT.MM.JJJJ". Dort steht derselbe Wert deshalb
 * ausgeschrieben — beim Fach in der leeren Option, beim Tag im Hinweis unter
 * dem Feld. Fünf gleichlautende Hinweiszeilen unter fünf Feldern wären der
 * ruhigere Code und der unruhigere Bildschirm gewesen.
 *
 * Die Felder sind **unkontrolliert** (`defaultValue`), so wie das Umbenennen
 * in topic-list.tsx: was jemand getippt hat, soll nach einer abgelehnten
 * Eingabe noch dastehen, damit er es verbessern kann, statt es neu zu tippen.
 */

const EMPTY_STATE: ProposalFormState = {};

/**
 * Ein Knopf, der von selbst merkt, dass sein Formular gerade läuft.
 *
 * Er steht hier und nicht in einer eigenen Datei, aus demselben Grund, mit dem
 * material-form.tsx drei Bauteile zusammenhält: für sich allein wären es
 * fünfzehn Zeilen. Ausgeführt (`export`), weil ihn auch der Korb und die Seite
 * eines Vorschlags brauchen — beide sind Server Components und können
 * `useFormStatus()` nicht selbst aufrufen; ihre Formulare stünden sonst als
 * einzige der App ohne jede Rückmeldung da, während gespeichert wird.
 */
export function SubmitButton({
  children,
  variant = "secondary",
  className,
}: {
  children: ReactNode;
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      loading={pending}
      className={className}
    >
      {children}
    </Button>
  );
}

/** Für die Auswahl reicht, woran man ein Fach erkennt. */
export type ProposalFormSubject = { id: string; name: string };

/** Das Blatt, wie es jetzt dasteht — die Vergleichsgröße neben jedem Feld. */
export type ProposalFormSheet = {
  subjectName: string;
  title: string;
  capturedOn: string;
  note: string | null;
  topics: string[];
};

/** Ein vorhandener Vorschlag, wenn dieses Formular einen ändert. */
export type ProposalFormValues = {
  subjectId: string | null;
  title: string | null;
  capturedOn: string | null;
  note: string | null;
  topics: string[];
};

export type ProposalFormProps = {
  action: (
    state: ProposalFormState,
    formData: FormData,
  ) => Promise<ProposalFormState>;
  /** Nicht archivierte Fächer, dazu das des Blattes, falls archiviert. */
  subjects: ProposalFormSubject[];
  sheet: ProposalFormSheet;
  /**
   * Der Vorschlag, der geändert wird. Fehlt er, entsteht ein neuer und alle
   * Felder stehen leer — was hier genau das Richtige ist: ein frischer
   * Vorschlag schweigt zu allem, bis jemand etwas hineinschreibt.
   */
  proposal?: ProposalFormValues;
  /** Der heutige Kalendertag aus todayInBerlin(). */
  today: string;
  /**
   * `PROPOSAL_TOPIC_LIMIT`, vom Server durchgereicht.
   *
   * Die Zahl steht in @/lib/inbox, und das Modul bringt die Datenbank mit — in
   * einer Client-Komponente hat sie nichts zu suchen. Bliebe also, sie hier ein
   * zweites Mal hinzuschreiben (so wie material-form.tsx es mit der Titellänge
   * tut). Hier ist das schlechter: die Zahl steht nicht als stille Bremse an
   * einem Feld, sondern ausgeschrieben in einem Satz, und ein Satz, der eine
   * überholte Zahl nennt, ist schlimmer als gar keiner.
   */
  topicLimit: number;
  /** Was auf dem Knopf steht: anlegen oder speichern. */
  submitLabel: string;
};

export function ProposalForm({
  action,
  subjects,
  sheet,
  proposal,
  today,
  topicLimit,
  submitLabel,
}: ProposalFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  /**
   * Nach einem geglückten Speichern stehen die Felder wieder auf dem Stand des
   * Servers — und nicht mehr auf dem, was getippt wurde.
   *
   * Beides kann auseinandergehen, ohne dass irgendwo ein Fehler stünde:
   * `normalizeTopics()` wirft Leerzeilen und Dubletten weg, kürzt zu lange
   * Titel und deckelt bei `topicLimit`. Bliebe das Textfeld danach auf den
   * getippten Zeilen stehen, behauptete es Themen, die der Vorschlag nicht
   * hat — und der nächste Druck auf den Knopf schickte sie beliebig oft wieder
   * mit.
   *
   * Der Schlüssel steht am Kasten um die Felder und nicht am `<form>`: ein
   * neuer Schlüssel baut den Kasten neu auf, die Felder greifen ihr
   * `defaultValue` frisch ab, und die Meldung darüber bleibt stehen, weil sie
   * außerhalb hängt. Am Formular selbst hinge auch `useActionState` mit
   * daran — dann verschwände die Bestätigung im selben Moment, in dem sie
   * erscheint.
   *
   * Gezählt wird über `state.saves` UND die Werte vom Server, aus demselben
   * Grund wie in material-form.tsx: die Antwort der Action und der
   * nachgelieferte Stand kommen üblicherweise zusammen an, aber sie müssen
   * nicht. Nach einer abgelehnten Eingabe ändert sich keines von beiden — dann
   * bleibt stehen, was getippt wurde, und lässt sich verbessern.
   */
  const savedMark = [
    state.saves ?? 0,
    proposal?.subjectId ?? "",
    proposal?.title ?? "",
    proposal?.capturedOn ?? "",
    proposal?.note ?? "",
    ...(proposal?.topics ?? []),
  ].join("\n");

  const topicLines = (proposal?.topics ?? []).join("\n");

  const sheetTopics =
    sheet.topics.length > 0 ? sheet.topics.join("\n") : undefined;

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

      <p className="text-sm text-muted">
        Sag nur, was du sagen willst. Jedes Feld darf leer bleiben — leer heißt
        überall „dazu sage ich nichts“, und dann bleibt am Blatt stehen, was
        dort schon steht. Löschen kann ein Vorschlag nichts; was hier grau im
        Feld steht, ist der heutige Stand des Blattes.
      </p>

      {/* Der Schlüssel setzt die Felder nach dem Speichern auf den Stand des
          Servers zurück — ausführlich steht das oben an `savedMark`. */}
      <div key={savedMark} className="space-y-6">
        {/* Alle ids tragen „vorschlag-“ vor sich. Auf der Seite eines
            Vorschlags steht dieses Formular unter dem vollen Handformular des
            Blattes, und das führt Felder mit genau denselben Namen: title,
            subjectId, capturedOn, note, themen. Zweimal dieselbe id auf einer
            Seite hieße, dass ein Label auf das falsche Feld zeigt — angetippt
            springt der Finger dann in das Formular darüber. */}
        <Field
          id="vorschlag-title"
          label="Titel"
          optional
          error={state.errors?.title}
        >
          {(control) => (
            <Input
              {...control}
              name="title"
              defaultValue={proposal?.title ?? ""}
              placeholder={sheet.title}
              // Die Grenze selbst steht im Prüfschema in @/lib/inbox, und die
              // Zahl dort kommt aus @/lib/materials — ein Vorschlag darf nicht
              // annehmen, was das Blattformular später abweist. Hier ist sie
              // nur die Bremse im Feld.
              maxLength={80}
              autoComplete="off"
            />
          )}
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            id="vorschlag-subjectId"
            label="Fach"
            optional
            error={state.errors?.subjectId}
          >
            {(control) => (
              <Select
                {...control}
                name="subjectId"
                defaultValue={proposal?.subjectId ?? ""}
              >
                {/* Die leere Option ist keine Zierde: ohne sie stünde von
                    selbst ein Fach in der Auswahl, und der Vorschlag schlüge
                    einen Fachwechsel vor, den niemand gemeint hat. Sie steht
                    an erster Stelle und nennt das Fach des Blattes gleich mit
                    — ein „—" allein sagte nicht, worauf es hinausläuft. */}
                <option value="">
                  {`— Fach des Blattes bleibt (${sheet.subjectName})`}
                </option>

                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            id="vorschlag-capturedOn"
            label="Vom"
            optional
            hint={`Am Blatt steht: ${formatGerman(sheet.capturedOn)}`}
            error={state.errors?.capturedOn}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                name="capturedOn"
                defaultValue={proposal?.capturedOn ?? ""}
                // Ein Blatt aus der Zukunft gibt es nicht — dasselbe sagt das
                // Prüfschema, hier steht es nur schon im Feld.
                max={today}
              />
            )}
          </Field>
        </div>

        <Field
          id="vorschlag-themen"
          label="Themen"
          optional
          hint={
            sheet.topics.length > 0
              ? `Ein Thema je Zeile, höchstens ${topicLimit}. Leer heißt: die Themen des Blattes bleiben.`
              : `Ein Thema je Zeile, höchstens ${topicLimit}. Am Blatt hängt noch keines.`
          }
          error={state.errors?.topics}
        >
          {(control) => (
            /* Ein Textfeld mit einem Thema je Zeile und nicht das Chip-Feld
               des Blattes.

               Das Chip-Feld heißt in material-form.tsx `TopicInput`, ist dort
               nicht exportiert, und diese Datei darf material-form.tsx nicht
               anfassen. Bliebe, es hier nachzubauen — und genau das wäre der
               Fehler: eine zweite Fassung desselben Bedienfelds, die sich beim
               nächsten Umbau von der ersten entfernt, ohne dass es jemand
               merkt.

               Ein Textblock ist hier aber ohnehin das ehrlichere Feld. Ein
               Vorschlag ist ein Entwurf und keine Angabe am Blatt; er braucht
               nicht dieselbe Politur. Was man dabei wirklich tut, ist eine
               Liste hinschreiben oder von irgendwoher hineinkopieren, und
               genau das kann ein Textfeld ohne eine Zeile JavaScript — Chips
               dagegen entstehen erst durch Enter, und ein vergessenes Enter
               kostet dort ein Thema. Der Preis ist, dass die Zeilen ungeprüft
               dastehen, bis abgeschickt wird; zugeschnitten werden sie danach
               in `proposalInputSchema` mit derselben Rechnung, die auch beim
               Übernehmen greift. */
            <Textarea
              {...control}
              name="themen"
              rows={4}
              defaultValue={topicLines}
              placeholder={sheetTopics}
              spellCheck={false}
            />
          )}
        </Field>

        <Field
          id="vorschlag-note"
          label="Notiz"
          optional
          hint={
            sheet.note === null
              ? "Am Blatt steht noch keine Notiz — was hier steht, käme dazu."
              : undefined
          }
          error={state.errors?.note}
        >
          {(control) => (
            <Textarea
              {...control}
              name="note"
              rows={3}
              maxLength={500}
              defaultValue={proposal?.note ?? ""}
              placeholder={sheet.note ?? undefined}
            />
          )}
        </Field>
      </div>

      <div className="pt-2">
        <Button
          type="submit"
          variant="secondary"
          loading={pending}
          className="w-full sm:w-auto"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
