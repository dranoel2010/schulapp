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
import { listMaterialTranscripts } from "@/lib/materials";
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

  /*
   * Was heute wörtlich an den Seiten steht.
   *
   * Über `listMaterialTranscripts()` und nicht über `material.pages`: dort
   * steht mit `transcriptLength` nur die LÄNGE, und mit ihr zu vergleichen
   * hieße, zwei gleich lange verschiedene Texte für unverändert zu halten — ein
   * Vorschlag, der 980 Zeichen durch 980 andere ersetzt, ginge dann ohne eine
   * Zeile in der Gegenüberstellung durch. Verglichen werden muss der Text, und
   * das ist die eine Tür, durch die er kommt.
   */
  const wortlaut = await listMaterialTranscripts(user.id, material.id);
  const amBlatt = new Map(
    wortlaut.map((page) => [page.pageId, page.transcript] as const),
  );

  const prefill = prefillFromProposal(
    {
      subjectId: material.subject.id,
      subjectName: material.subject.name,
      title: material.title,
      capturedOn: material.capturedOn,
      note: material.note,
      topics: material.topics.map((topic) => topic.title),
      pages: wortlaut,
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
      transcripts: proposal.transcripts,
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

  /*
   * Die vorbelegte Abschrift je Seite, aus derselben Rechnung wie alles andere.
   *
   * `prefillFromProposal()` hat sie schon zusammengeführt: sie nennt genau die
   * Seiten, über die der Vorschlag etwas sagt, und für jede davon den Text, der
   * beim Übernehmen geschrieben würde. Hier daneben noch einmal zu entscheiden,
   * was gilt, wären zwei Antworten auf die Frage, was gleich passiert — genau
   * das, was die Gegenüberstellung über dem Formular ausschließen soll.
   *
   * Eine Seite, die hier fehlt, behält ihre Abschrift; unten im Formular steht
   * sie deshalb mit `amBlatt` vorbelegt und nicht leer.
   */
  const prefillTranscripts = new Map(
    prefill.werte.transcripts.map(({ pageId, text }) => [pageId, text] as const),
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
            {/* Der Schlüssel trägt seit der Abschrift die Seite mit: „Abschrift“
                ist das einzige Feld, das MEHRMALS in dieser Liste stehen kann
                (ein Vorschlag darf zwölf Seiten neu beschriften), und zwei
                Zeilen mit demselben Schlüssel wären für React dieselbe Zeile.
                Aus demselben Grund steht die Seitenzahl auch im Text: „Abschrift
                → 1.240 Zeichen“ dreimal untereinander sagte nicht, welche Seite
                gemeint ist. Die Spalte ist dafür breiter als die 16, die für
                „Themen“ gereicht hat — und bei allen Zeilen gleich breit, sonst
                stünden die Pfeile versetzt. */}
            {prefill.aenderungen.map((change) => (
              <div
                key={`${change.feld}-${change.seite ?? ""}`}
                className="flex flex-col gap-0.5 sm:flex-row sm:gap-3"
              >
                <dt className="shrink-0 text-sm text-subtle sm:w-32">
                  {change.seite === undefined
                    ? change.feld
                    : `${change.feld}, Seite ${change.seite}`}
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

          {/* Der Satz steht nur da, wenn eine Abschrift dabei ist. Er nennt
              den Ort und nicht den Inhalt: die Abschrift ist zu lang, um über
              dem Formular zu stehen, und der Bildschirm soll nicht behaupten,
              er habe sie gezeigt. Gezählt werden die Seiten, zu denen der
              Vorschlag etwas sagt — nicht alle Seiten des Blattes. */}
          {prefillTranscripts.size > 0 ? (
            <p className="text-sm text-muted">
              {prefillTranscripts.size === 1
                ? "Dazu kommt diesmal die Abschrift einer Seite: was darauf steht, wörtlich. Sie steht unten im Formular, neben dem Bild dieser Seite."
                : `Dazu kommt diesmal die Abschrift von ${prefillTranscripts.size} Seiten: was darauf steht, wörtlich. Sie stehen unten im Formular — je Seite eine Zeile, die sich neben ihrem Bild aufklappen lässt.`}
            </p>
          ) : null}

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
         *
         * Den Preis dafür trägt der seltenere Fall: wer erst ins
         * Übernehmen-Formular tippt und DANN den Vorschlag ändert, verliert
         * seine Eingabe. Das ist die richtige Reihenfolge — die Grundlage hat
         * sich geändert, das Formular muss ihr folgen —, und `ProposalForm`
         * eine Datei weiter löst dasselbe Problem mit demselben Mittel.
         *
         * **Gebaut wird er mit `JSON.stringify` und nicht mit `join("\n")`.**
         * Bis zum 5.9.2026 stand hier ein Trennzeichen, das in einem der Werte
         * selbst vorkommen darf: die Notiz ist mehrzeilig — beide Formulare
         * bieten dafür ein <textarea rows={3}> an, `optionalText()` in
         * @/lib/inbox schneidet nur die Ränder ab, und der Auftrag des
         * Postboten schickt ausdrücklich mehrere Aussagen dorthin. Dann ist die
         * Kette nicht mehr eindeutig: eine Notiz „a\nb" ohne Thema ergibt
         * Zeichen für Zeichen denselben Schlüssel wie die Notiz „a" mit dem
         * Thema „b". Ändert jemand den Vorschlag von der einen Vorbelegung in
         * die andere, hält React das Formular für dasselbe und baut es nicht
         * neu — über dem Knopf steht dann die neue Notiz, geschrieben wird die
         * alte, und genau dagegen steht dieser Schlüssel. `JSON.stringify`
         * maskiert den Umbruch und die Anführungszeichen und hält die Werte
         * damit auseinander; die Themen stehen dafür als eigene Liste und nicht
         * mehr flach danebengelegt. Nebenbei unterscheidet es `null` von "" —
         * was der Absatz unten für einen späteren Ausbau ohnehin verlangt.
         *
         * **Die Abschriften stehen bewusst NICHT im Schlüssel**, obwohl sie
         * vorbelegte Werte sind. Zwei Gründe, und der zweite ist der
         * gewichtigere:
         *
         * - Sie brauchen ihn nicht. `MaterialForm` kopiert sie nicht in den
         *   Zustand; dort liegt nur, was jemand getippt hat, und ein
         *   unberührtes Feld liest bei jedem Rendern seine Vorbelegung. Ändert
         *   sich der Vorschlag unten, folgt es also von selbst — ohne dass
         *   dafür das ganze Formular neu aufgebaut werden müsste.
         * - Sie wären zu groß dafür. Zwölf Seiten mal 8000 Zeichen sind bis zu
         *   96 000, und ein Schlüssel wird als Zeichenkette in die Antwort des
         *   Servers geschrieben. Die Abschriften gingen damit ein zweites Mal
         *   durch die Leitung — für eine Vorsichtsmaßnahme, die nichts
         *   absichert, was nicht schon abgesichert wäre.
         *
         * Wer sie eines Tages doch hineinnimmt, muss NULL und leeren String
         * unterscheidbar halten — `JSON.stringify` tut das von selbst, ein
         * beiläufiges `text ?? ""` davor macht es zunichte. Es machte aus
         * „niemand hat gelesen“ und
         * „gelesen, nichts drauf“ denselben Schlüssel — und dann bliebe das
         * Formular genau bei der Änderung stehen, um die es geht.
         */}
        <MaterialForm
          key={JSON.stringify([
            prefill.werte.subjectId,
            prefill.werte.title,
            prefill.werte.capturedOn,
            prefill.werte.note,
            prefill.werte.topics,
          ])}
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
          /* Die Seiten des Blattes, vorbelegt mit der vorgeschlagenen
             Abschrift. `transcript` (was am Blatt steht) reist daneben mit;
             aus dem Unterschied zwischen beiden baut das Formular je Seite den
             Satz, was das Übernehmen dort ändern würde. Deshalb wird hier
             NICHT das eine mit dem anderen überschrieben.

             Sagt der Vorschlag zu einer Seite nichts, steht in beiden dasselbe
             — das Feld zeigt dann, was am Blatt steht, und das Übernehmen
             schreibt es unverändert zurück. */
          pages={material.pages.map((page) => {
            const transcript = amBlatt.get(page.id) ?? null;

            return {
              ...page,
              transcript,
              prefill: prefillTranscripts.get(page.id) ?? transcript,
            };
          })}
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
