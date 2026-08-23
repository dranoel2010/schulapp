import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import {
  PROPOSAL_TOPIC_LIMIT,
  getProposal,
  prefillFromProposal,
} from "@/lib/inbox";
import { listTopicsForSubjects } from "@/lib/subject-topics";
import { listSubjects } from "@/lib/subjects";

import { MaterialForm } from "../../material-form";
import {
  confirmProposalAction,
  deleteProposalAction,
  updateProposalAction,
} from "../actions";
import { ProposalForm, SubmitButton } from "../proposal-form";
import { OriginBadge, arrivedLabel } from "../proposal-view";

/**
 * Ein Vorschlag: ansehen, ändern, übernehmen oder verwerfen.
 *
 * Die Seite ist von oben nach unten die Reihenfolge der Entscheidung. Erst das
 * Blatt — man muss sehen, worüber entschieden wird. Dann, woher der Vorschlag
 * kommt. Dann, was er ändern würde. Und erst ganz unten das Formular, mit dem
 * es wirklich passiert.
 *
 * **Geschrieben wird ausschließlich durch das Handformular.** Es ist genau
 * dasselbe `MaterialForm`, das auf der Seite eines Blattes steht, nur mit einer
 * anderen Aufschrift auf dem Knopf und mit den Werten des Vorschlags
 * vorbelegt. Das ist die Zusage aus KONZEPT.md: ein Vorschlag ändert nichts,
 * und Übernehmen heißt nicht „Vorschlag anwenden", sondern „ein Formular
 * absenden, das jemand gelesen und notfalls geändert hat". Ein eigenes,
 * kleineres Formular für die Bestätigung wäre eine zweite Tür in den Bestand
 * gewesen — genau die, die es nicht geben soll.
 *
 * Das „Vorschlag ändern" steckt in einem <details> auf dieser Seite und nicht
 * hinter einer eigenen Route. Wer einen Vorschlag ändert, tut das mit Blick auf
 * das Blatt und auf die Gegenüberstellung darüber; eine eigene Seite müsste
 * beides noch einmal zeigen (dann ist sie diese Seite mit einem anderen
 * Formular) oder darauf verzichten (dann schreibt man einen Vorschlag ins
 * Blaue). <details> ist außerdem die Geste, die diese App für „das braucht man
 * selten" schon führt — die Themenpflege klappt ihre Zeilen genauso auf, und es
 * funktioniert ohne eine Zeile JavaScript.
 */

export const metadata: Metadata = {
  title: "Vorschlag",
};

/** Das Dreieck vor dem <details>, das sich beim Aufklappen dreht. */
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

export default async function ProposalPage({
  params,
}: PageProps<"/material/eingang/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const found = await getProposal(user.id, id);
  if (!found) {
    notFound();
  }

  const { proposal, material } = found;

  // Eine Abfrage für alle Fächer, archivierte eingeschlossen. Aus ihr kommen
  // drei Dinge: der Name des vorgeschlagenen Fachs für die Gegenüberstellung,
  // die Auswahl im Handformular und die im Vorschlagsformular.
  const all = await listSubjects(user.id, { includeArchived: true });
  const active = all.filter((subject) => !subject.archived);
  const subjectNames = new Map(
    all.map((subject) => [subject.id, subject.name] as const),
  );

  const prefill = prefillFromProposal(
    {
      subjectId: material.subject.id,
      subjectName: material.subject.name,
      title: material.title,
      capturedOn: material.capturedOn,
      note: material.note,
      topics: material.topics.map((topic) => topic.title),
    },
    {
      subjectId: proposal.subjectId,
      subjectName:
        proposal.subjectId === null
          ? null
          : (subjectNames.get(proposal.subjectId) ?? null),
      title: proposal.title,
      capturedOn: proposal.capturedOn,
      note: proposal.note,
      topics: proposal.topics,
    },
  );

  /*
   * Die Auswahl des Handformulars muss beide Fächer enthalten, die hier
   * überhaupt in Frage kommen: das des Blattes und das vorgeschlagene. Aktive
   * stehen ohnehin drin; archivierte fehlten sonst, und dann stünde im
   * Auswahlfeld ein anderes Fach als das, was der Vorschlag vorbelegt hat —
   * abgeschickt würde damit ein Fachwechsel, den niemand gemeint hat.
   */
  const needed = new Set([material.subject.id, prefill.werte.subjectId]);
  const subjects = [
    ...all.filter((subject) => subject.archived && needed.has(subject.id)),
    ...active,
  ];

  // Eine Abfrage über alle Fächer und nicht Fach für Fach — genauso wie auf der
  // Seite des Blattes. Das Fach lässt sich im Formular umstellen, und dann
  // sollen die Chips des neuen Fachs schon dastehen.
  const topicsBySubject = await listTopicsForSubjects(
    user.id,
    subjects.map((subject) => subject.id),
  );
  const topicSuggestions = Object.fromEntries(
    subjects.map(
      (subject) => [subject.id, topicsBySubject.get(subject.id) ?? []] as const,
    ),
  );

  const today = todayInBerlin();
  const color = subjectColor(material.subject.color).hex;

  return (
    <div className="space-y-6 md:max-w-3xl">
      <Link
        href="/material/eingang"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 pr-2 text-sm text-muted transition-colors hover:text-foreground"
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
          <path d="m15 6-6 6 6 6" />
        </svg>
        Eingangskorb
      </Link>

      {/* Das Blatt, wie es JETZT dasteht. Es steht ganz oben und nicht unter
          dem Vorschlag: worüber entschieden wird, muss man zuerst sehen. Die
          Farbfläche und der Aufbau sind die der Blattseite — es ist dasselbe
          Blatt, es soll auch so aussehen. */}
      <header
        style={{
          backgroundColor: `color-mix(in oklab, ${color} 8%, var(--surface))`,
        }}
        className="rounded-card border border-border p-5 sm:p-6"
      >
        <p className="flex items-center gap-2 text-sm text-muted">
          <span
            aria-hidden="true"
            style={{ backgroundColor: color }}
            className="size-2.5 shrink-0 rounded-full"
          />
          {material.subject.name}
        </p>

        <h1 className="mt-1.5 text-xl font-semibold text-foreground">
          {material.title}
        </h1>

        <p className="mt-1 text-muted">{formatGerman(material.capturedOn)}</p>

        {material.topics.length > 0 ? (
          <p className="mt-2 text-sm text-subtle">
            {material.topics.map((topic) => topic.title).join(" · ")}
          </p>
        ) : null}

        {material.note ? (
          <p className="mt-2 whitespace-pre-line text-sm text-muted">
            {material.note}
          </p>
        ) : null}

        {/* Die Vorschauen und nicht die Vollbilder: hier wird nicht gelesen,
            hier wird wiedererkannt. Wer wirklich hineinsehen muss, ist einen
            Tipp entfernt — der Knopf darunter führt auf das Blatt, wo die
            Seiten in voller Größe stehen. Feste Maße an jedem Bild, sonst
            springt die Seite beim Laden und der Knopf, den man treffen wollte,
            ist woanders. */}
        {material.pages.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-3">
            {material.pages.map((page) => (
              <li key={page.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache */}
                <img
                  src={`/api/material/${page.id}/vorschau`}
                  /* Der Titel steht als Überschrift direkt darüber — ihn je
                     Seite noch einmal zu nennen, hieße ihn einem Vorleser bei
                     vier Seiten fünfmal hintereinander vorzusagen. Hier wird
                     nicht gelesen, sondern wiedererkannt; auf der Blattseite
                     selbst ist es umgekehrt, dort SIND die Bilder der Inhalt
                     und tragen ihre volle Beschriftung. */
                  alt=""
                  width={96}
                  height={128}
                  loading="lazy"
                  decoding="async"
                  className="h-32 w-24 rounded-control border border-border bg-surface object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4">
          <ButtonLink href={`/material/${material.id}`} variant="secondary">
            Blatt öffnen
          </ButtonLink>
        </div>
      </header>

      {/* Woher der Vorschlag kommt. Das ist keine Zierde, sondern die
          Begründung der ganzen Bauweise: ein Agentenvorschlag stammt aus dem
          Inhalt eines Blattes, also aus Text, den diese App nicht geschrieben
          hat. Wer nicht vertrauenswürdige Blätter liest und gleichzeitig
          schreiben darf, ist über das Blatt selbst angreifbar — deshalb
          schreibt der Agent nie, und deshalb steht hier, was man gerade vor
          sich hat. */}
      <section className="space-y-2 rounded-card border border-border bg-surface p-4 sm:p-5">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <OriginBadge origin={proposal.origin} />
          <span>{`angelegt ${arrivedLabel(proposal.createdAt, today)}`}</span>
        </p>

        {proposal.origin === "agent" ? (
          <p className="text-sm text-foreground">
            Dieser Vorschlag ist aus dem Inhalt eines Blattes abgeleitet — also
            aus etwas, das diese App nicht geschrieben hat, sondern jemand
            anderes auf Papier gedruckt oder an eine Tafel geschrieben hat. Lies
            ihn, bevor du ihn übernimmst. Genau dafür steht diese Seite zwischen
            dem Vorschlag und deinem Bestand.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Diesen Vorschlag hast du selbst angelegt. Geändert hat er am Blatt
            trotzdem nichts — auch er geht durch das Formular unten.
          </p>
        )}
      </section>

      {/* Die Gegenüberstellung. Gerechnet hat sie `prefillFromProposal()`, und
          zwar genau einmal: dieselbe Rechnung belegt unten das Formular vor.
          Zwei Rechnungen wären zwei Antworten auf die Frage, was gleich
          passiert. */}
      <section className="space-y-3 rounded-card border border-border bg-surface p-4 sm:p-5">
        <h2 className="text-base font-semibold text-foreground">
          Was sich dadurch ändert
        </h2>

        {prefill.aenderungen.length === 0 ? (
          /* Kein Fehler, sondern ein sinnvoller Ausgang: der Vorschlag sagt
             nichts, was am Blatt nicht schon so steht. Das kommt vor, wenn
             jemand von Hand bestätigt hat, was ohnehin dasteht, oder wenn ein
             Agent dasselbe zweimal vorschlägt. Ihn zu übernehmen schadet
             nichts, ändert aber auch nichts — verwerfen ist der kürzere Weg,
             und deshalb steht er im Satz. */
          <p className="text-sm text-muted">
            Nichts an den Angaben des Blattes. Dieser Vorschlag sagt nur, was
            dort schon so steht. Übernehmen tut trotzdem etwas: es hakt das
            Blatt ab und räumt alle weiteren Vorschläge dazu weg. Willst du nur
            diesen einen loswerden, verwirfst du ihn ganz unten — dann bleibt
            alles andere, wie es ist.
          </p>
        ) : (
          <dl className="space-y-2">
            {prefill.aenderungen.map((change) => (
              <div
                key={change.feld}
                className="flex flex-col gap-0.5 sm:flex-row sm:gap-3"
              >
                <dt className="shrink-0 text-sm text-subtle sm:w-16">
                  {change.feld}
                </dt>
                <dd className="min-w-0 flex-1 text-sm">
                  <span className="text-muted">{change.vorher}</span>
                  <span aria-hidden="true" className="px-1.5 text-subtle">
                    →
                  </span>
                  <span className="sr-only">wird zu</span>
                  <span className="font-medium text-foreground">
                    {change.nachher}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            Übernehmen
          </h2>
          <p className="text-sm text-muted">
            Das ist das Formular des Blattes, vorbelegt mit dem, was der
            Vorschlag sagt. Ändere darin, was nicht stimmt — geschrieben wird
            erst mit dem Knopf darunter, und geschrieben wird genau das, was
            hier steht.
          </p>
          {/* Zwei Dinge tut das Übernehmen zusätzlich, und beide stehen in
              keiner Zeile der Gegenüberstellung — die vergleicht nur die
              Angaben des Blattes. Ungesagt wären sie eine Überraschung: wer
              einen harmlosen Vorschlag übernimmt, verlöre dabei einen zweiten,
              der etwas zu sagen hatte. */}
          <p className="text-sm text-muted">
            Damit gilt das Blatt als durchgesehen, und weitere Vorschläge dazu
            fallen weg — sie gälten einem Stand, den es dann nicht mehr gibt.
          </p>
        </div>

        {/*
         * Der Schlüssel ist hier kein Detail, sondern der Unterschied zwischen
         * „was ich sehe, wird geschrieben" und stillem Datenverlust.
         *
         * Auf dieser Seite stehen zwei Formulare. Ändert man den Vorschlag im
         * unteren, frischt `updateProposalAction()` die Seite auf, und die
         * Gegenüberstellung darüber zeigt sofort die neuen Werte. `MaterialForm`
         * ist dabei aber dieselbe React-Instanz: Titel, Fach, Tag und Notiz
         * liegen dort in `useState(item.…)` und folgen einer geänderten Prop
         * nicht mehr — nachgezogen wird nur die Themenliste, und die hängt an
         * einem anderen Zeichen. Wer danach „Vorschlag übernehmen" drückte,
         * schriebe die ALTEN Werte, während über dem Knopf die neuen
         * angekündigt stehen; und weil das Übernehmen alle Vorschläge des
         * Blattes wegräumt, wäre die eben getippte Änderung danach nicht mehr
         * zu beschaffen.
         *
         * Der Schlüssel trägt genau die Werte, mit denen das Formular
         * vorbelegt wird. Ändert sich einer, baut React das Formular neu auf,
         * und es steht wieder das darin, was die Gegenüberstellung ankündigt.
         * Den Preis dafür trägt der seltenere Fall: wer erst ins
         * Übernehmen-Formular tippt und DANN den Vorschlag ändert, verliert
         * seine Eingabe. Das ist die richtige Reihenfolge — die Grundlage hat
         * sich geändert, das Formular muss ihr folgen —, und `ProposalForm`
         * eine Datei weiter löst dasselbe Problem mit demselben Mittel.
         */}
        <MaterialForm
          key={[
            prefill.werte.subjectId,
            prefill.werte.title,
            prefill.werte.capturedOn,
            prefill.werte.note ?? "",
            ...prefill.werte.topics,
          ].join("\n")}
          action={confirmProposalAction.bind(null, proposal.id)}
          subjects={subjects}
          topicSuggestions={topicSuggestions}
          item={{
            subjectId: prefill.werte.subjectId,
            title: prefill.werte.title,
            capturedOn: prefill.werte.capturedOn,
            note: prefill.werte.note,
            /*
             * `MaterialForm` verlangt hier `{ id, title }[]`, der Vorschlag
             * kennt aber nur Titel — ein vorgeschlagenes Thema hat im
             * Vokabular des Fachs noch gar keine Zeile, und genau deshalb
             * steht es in `material_proposal_topics` als freier Text (siehe
             * src/db/schema.ts). Es GIBT die id also nicht, die hier
             * hingehörte.
             *
             * Der Titel steht deshalb an ihrer Stelle, und das ist
             * nachgesehen und nicht gehofft: material-form.tsx liest aus
             * dieser Liste ausschließlich `.title`
             * (`item.topics.map((topic) => topic.title)`), rendert die Chips
             * mit dem Titel als React-Schlüssel und hängt für jeden ein
             * verstecktes Feld `name="themen"` mit dem Titel als Wert ans
             * Formular. Eine id verlässt das Formular nirgends; sie
             * aufzulösen ist Sache von `setMaterialTopics()`, und das kann
             * nur mit Titeln umgehen. Eine erfundene uuid wäre hier das
             * Schlechtere: sie sähe aus wie ein Verweis auf eine Zeile in
             * `subject_topics`, die es nicht gibt.
             *
             * Fängt `MaterialForm` eines Tages an, die id zu lesen, bricht
             * diese Stelle — dann gehört sie mitgeändert und nicht
             * nachgebessert.
             */
            topics: prefill.werte.topics.map((title) => ({
              id: title,
              title,
            })),
          }}
          today={today}
          submitLabel="Vorschlag übernehmen"
        />
      </section>

      {/* Ändern statt übernehmen — der seltene dritte Weg, deshalb zugeklappt.
          Er steht unter dem Übernehmen und nicht darüber: wer hierherkommt,
          will in neun von zehn Fällen entscheiden und nicht schreiben. */}
      <details className="group rounded-card border border-border bg-surface">
        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
          <Chevron />
          <span className="min-w-0 flex-1 font-medium text-foreground">
            Vorschlag ändern
          </span>
        </summary>

        <div className="space-y-3 border-t border-border p-4 sm:p-5">
          <p className="text-sm text-muted">
            Hier änderst du den <strong>Vorschlag</strong>, nicht das Blatt. Am
            Blatt steht danach immer noch, was jetzt dort steht — geschrieben
            wird es erst mit „Vorschlag übernehmen“ weiter oben.
          </p>

          <ProposalForm
            action={updateProposalAction.bind(null, proposal.id)}
            subjects={subjects}
            sheet={{
              subjectName: material.subject.name,
              title: material.title,
              capturedOn: material.capturedOn,
              note: material.note,
              topics: material.topics.map((topic) => topic.title),
            }}
            proposal={{
              subjectId: proposal.subjectId,
              title: proposal.title,
              capturedOn: proposal.capturedOn,
              note: proposal.note,
              topics: proposal.topics,
            }}
            today={today}
            topicLimit={PROPOSAL_TOPIC_LIMIT}
            submitLabel="Änderung speichern"
          />
        </div>
      </details>

      {/* Verwerfen — unten und leise, an derselben Stelle, an der auf der
          Blattseite das Löschen steht. Aber ohne dessen Zwischenschritt: dort
          wäre eine abfotografierte Tafel von letzter Woche weg und nicht
          wiederzubeschaffen, hier fällt ein Entwurf weg, den jederzeit jemand
          neu hinschreiben kann. Eine Rückfrage, die nichts schützt, erzieht
          nur dazu, Rückfragen wegzuklicken. */}
      <section className="space-y-2 rounded-card border border-border bg-surface p-4 sm:p-5">
        <form action={deleteProposalAction.bind(null, proposal.id)}>
          <SubmitButton
            variant="ghost"
            className="text-danger hover:bg-danger-soft hover:text-danger"
          >
            Vorschlag verwerfen
          </SubmitButton>
        </form>

        <p className="text-sm text-muted">
          Damit ist nur der Vorschlag weg. Das Blatt bleibt, wie es ist — jede
          Aufnahme, jedes Thema, jede Zeile. Verloren geht nichts, was du
          aufgeschrieben hättest.
        </p>
      </section>
    </div>
  );
}
