import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { Subject } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { addDays, formatGerman, todayInBerlin } from "@/lib/dates";
import { getMaterial } from "@/lib/materials";
import {
  getProposal,
  proposalHeadline,
  type HausaufgabePayload,
  type KlausurPayload,
  type ProposalItem,
  type ThemenPayload,
} from "@/lib/proposals";
import { listTopics, suggestTopicsForExam } from "@/lib/subject-topics";
import { listSubjects } from "@/lib/subjects";
import { listLessons, nextLessonPerSubject } from "@/lib/timetable";
import { topicKey } from "@/lib/topics";

import { ExamForm } from "../../klausuren/exam-form";
import { HomeworkForm } from "../../hausaufgaben/homework-form";
import {
  acceptExamAction,
  acceptHomeworkAction,
  acceptTopicsAction,
  discardProposalAction,
} from "../actions";
import { DiscardButton } from "../discard-button";
import { TopicsForm } from "./topics-form";

/**
 * Ein Vorschlag, und darunter das Formular, mit dem er übernommen wird.
 *
 * **Es ist das echte Formular.** Für eine Aufgabe steht hier dasselbe Bauteil
 * wie unter „Neue Aufgabe“, für einen Termin dasselbe wie unter „Neue
 * Klausur“, für Themen derselbe Griff wie auf der Seite des Blattes. Der
 * Vorschlag füllt es vor, mehr tut er nicht — geprüft und geschrieben wird mit
 * denselben Schemata, die auch für die Eingabe von Hand gelten. Ein Vorschlag
 * bekommt keine Abkürzung.
 *
 * Deshalb steht hier auch nichts von einem „Annehmen“ mit einem Tipp. Wer
 * bestätigt, hat vorher gelesen und darf alles ändern; genau dafür ist der
 * Umweg über den Korb da.
 *
 * Oben steht das Blatt mit seiner Vorschau und führt zu sich selbst: ob ein
 * Vorschlag stimmt, sieht man dem Papier an und nicht dem Satz darüber.
 */

export const metadata: Metadata = {
  title: "Vorschlag",
};

/** Wie ein Vorschlag hergekommen ist — ein Wort, nicht ein Abzeichen. */
const SOURCE_LABELS = {
  agent: "von einem Agenten vorgeschlagen",
  manuell: "von dir notiert",
} as const;

export default async function ProposalPage({
  params,
}: PageProps<"/eingang/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const proposal = await getProposal(user.id, id);
  if (!proposal) notFound();

  return (
    <div className="space-y-6 md:max-w-3xl">
      <ProposalHeader proposal={proposal} />

      {proposal.status === "offen" ? (
        <>
          <AcceptForm proposal={proposal} userId={user.id} />

          <section className="border-t border-border pt-5">
            <p className="mb-3 text-sm text-muted">
              Verworfen wird nichts gelöscht — der Vorschlag bleibt stehen und
              wird nur ruhig. Am Blatt selbst ändert sich dabei nichts.
            </p>
            <DiscardButton
              action={discardProposalAction.bind(null, proposal.id)}
              variant="danger"
              label="Vorschlag verwerfen"
            />
          </section>
        </>
      ) : (
        <p className="rounded-card border border-border bg-surface-muted px-4 py-3 text-sm text-muted">
          {proposal.status === "uebernommen"
            ? "Diesen Vorschlag hast du übernommen."
            : "Diesen Vorschlag hast du verworfen."}{" "}
          Entschieden wird nur einmal.
        </p>
      )}
    </div>
  );
}

/** Das Blatt, die Überschrift und der Satz des Agenten dazu. */
function ProposalHeader({ proposal }: { proposal: ProposalItem }) {
  const { material } = proposal;
  const color = subjectColor(material.subject.color);

  return (
    <header className="space-y-3">
      <h1 className="text-xl font-semibold text-foreground">
        {proposalHeadline(proposal.kind, proposal.payload)}
      </h1>

      <Link
        href={`/material/${material.id}`}
        className="flex items-center gap-3 rounded-card border border-border bg-surface p-3 transition-colors hover:bg-surface-muted"
      >
        {material.coverPageId ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache
          <img
            src={`/api/material/${material.coverPageId}/vorschau`}
            alt=""
            width={48}
            height={64}
            decoding="async"
            className="h-16 w-12 shrink-0 rounded-control border border-border bg-surface-muted object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="h-16 w-12 shrink-0 rounded-control border border-dashed border-border bg-surface-muted"
          />
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {material.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <span
              aria-hidden="true"
              style={{ backgroundColor: color.hex }}
              className="size-2.5 shrink-0 rounded-full"
            />
            <span className="truncate">
              {[
                material.subject.name,
                formatGerman(material.capturedOn, "kurz"),
                material.pageCount > 1 ? `${material.pageCount} Seiten` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <span className="mt-0.5 block text-sm text-subtle">
            Blatt ansehen
          </span>
        </span>
      </Link>

      {proposal.reason ? (
        <p className="text-sm text-muted">„{proposal.reason}“</p>
      ) : null}

      <p className="text-sm text-subtle">
        {SOURCE_LABELS[proposal.source]} ·{" "}
        {formatGerman(isoDay(proposal.createdAt), "kurz")}
      </p>
    </header>
  );
}

/**
 * Der Zeitpunkt als Kalendertag.
 *
 * `createdAt` ist ein Zeitstempel, angezeigt wird ein Tag — und `formatGerman`
 * nimmt ausschließlich Kalenderdaten entgegen. Gerechnet wird dabei in UTC,
 * wie überall in dieser App: eine Umrechnung nach Berlin bräuchte eine zweite
 * Regel, und ein Vorschlag von gestern Abend um 23:30 heißt hier so oder so
 * „gestern“ — nur eben nach der Regel, nach der auch alle anderen Daten
 * entstehen.
 */
function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Das Formular zur Art des Vorschlags. */
async function AcceptForm({
  proposal,
  userId,
}: {
  proposal: ProposalItem;
  userId: string;
}) {
  if (proposal.kind === "themen") {
    return <TopicsAccept proposal={proposal} userId={userId} />;
  }

  if (proposal.kind === "hausaufgabe") {
    return <HomeworkAccept proposal={proposal} userId={userId} />;
  }

  return <ExamAccept proposal={proposal} userId={userId} />;
}

/**
 * Themen übernehmen: das Blatt bekommt genau die Themen, die im Formular
 * stehen.
 *
 * Vorbelegt ist die **Vereinigung** aus dem, was schon am Blatt hängt, und dem
 * Vorschlag. `setMaterialTopics()` ersetzt die Menge, es fügt nicht hinzu —
 * stünde hier nur das Vorgeschlagene, nähme „Übernehmen“ dem Blatt still
 * seine bisherigen Themen weg.
 *
 * Verglichen wird beim Zusammenlegen über `topicKey()`, also über dieselbe
 * Faltung, mit der auch beim Speichern Dubletten wegfallen. Sonst stünde
 * „Kettenregel“ zweimal im Feld, einmal aus dem Blatt und einmal aus dem
 * Vorschlag, und der Nutzer müsste raten, welches davon wegkann.
 */
async function TopicsAccept({
  proposal,
  userId,
}: {
  proposal: ProposalItem;
  userId: string;
}) {
  const { titel } = proposal.payload as ThemenPayload;
  const subjectId = proposal.material.subject.id;

  const [material, suggestions] = await Promise.all([
    getMaterial(userId, proposal.material.id),
    listTopics(userId, subjectId),
  ]);

  const chosen: string[] = [];
  for (const title of [
    ...(material?.topics.map((topic) => topic.title) ?? []),
    ...titel,
  ]) {
    if (chosen.some((seen) => topicKey(seen) === topicKey(title))) continue;
    chosen.push(title);
  }

  return (
    <TopicsForm
      action={acceptTopicsAction.bind(null, proposal.id)}
      topics={chosen}
      suggestions={suggestions}
    />
  );
}

/**
 * Eine Aufgabe übernehmen — dasselbe Formular wie unter „Neue Aufgabe“.
 *
 * Das Fach kommt vom Blatt und steht trotzdem als Auswahl da: ein Blatt kann
 * im falschen Fach liegen, und dann soll die Aufgabe nicht mit hineinrutschen.
 *
 * Stand auf dem Blatt kein Tag, greift derselbe Vorschlag wie beim Eintragen
 * von Hand: die nächste Stunde in diesem Fach, sonst morgen.
 */
async function HomeworkAccept({
  proposal,
  userId,
}: {
  proposal: ProposalItem;
  userId: string;
}) {
  const payload = proposal.payload as HausaufgabePayload;
  const today = todayInBerlin();

  const [subjects, lessons] = await Promise.all([
    listSubjects(userId, { includeArchived: true }),
    listLessons(userId),
  ]);

  const dueSuggestions = nextLessonPerSubject(lessons, today);
  const fallbackDueDate = addDays(today, 1);
  const subjectId = proposal.material.subject.id;
  const options = subjectOptions(subjects, subjectId);

  return (
    <HomeworkForm
      action={acceptHomeworkAction.bind(null, proposal.id)}
      subjects={options}
      dueSuggestions={dueSuggestions}
      fallbackDueDate={fallbackDueDate}
      item={{
        subjectId,
        title: payload.titel,
        details: payload.notiz,
        dueDate:
          payload.faellig ?? dueSuggestions[subjectId] ?? fallbackDueDate,
      }}
      submitLabel="Übernehmen"
      cancelHref="/eingang"
    />
  );
}

/**
 * Einen Termin übernehmen — dasselbe Formular wie unter „Neue Klausur“, samt
 * Vorlauf, Tagesbudget und Themen. Aus dem Übernehmen entsteht deshalb auch
 * derselbe Lernplan.
 *
 * Vorlauf und Tagesbudget stehen nicht im Vorschlag: sie sind eine
 * Entscheidung über das eigene Lernen und nichts, was auf einem Blatt steht.
 * Das Formular setzt seine Vorgaben ein, so wie beim Eintragen von Hand.
 */
async function ExamAccept({
  proposal,
  userId,
}: {
  proposal: ProposalItem;
  userId: string;
}) {
  const payload = proposal.payload as KlausurPayload;
  const today = todayInBerlin();
  const subjectId = proposal.material.subject.id;

  const subjects = await listSubjects(userId, { includeArchived: true });
  const options = subjectOptions(subjects, subjectId);

  const topicSuggestions = Object.fromEntries(
    await Promise.all(
      options.map(
        async (subject) =>
          [
            subject.id,
            await suggestTopicsForExam(userId, subject.id, today),
          ] as const,
      ),
    ),
  );

  return (
    <ExamForm
      action={acceptExamAction.bind(null, proposal.id)}
      subjects={options}
      today={today}
      topicSuggestions={topicSuggestions}
      defaults={{
        subjectId,
        kind: payload.art,
        // Ein Termin, der inzwischen vorbei ist, steht so im Feld — das
        // Formular sagt dann selbst, dass der Tag schon war. Ihn hier still
        // auf heute zu schieben hieße, den Vorschlag zu verfälschen.
        date: payload.datum,
        title: payload.titel,
      }}
      topics={payload.themen}
      submitLabel="Übernehmen"
      cancelHref="/eingang"
    />
  );
}

/**
 * Die Fächer, die im Formular zur Wahl stehen: die aktiven, und dazu das Fach
 * des Blattes, auch wenn es abgewählt ist.
 *
 * Ohne den Zusatz fehlte ein abgewähltes Fach in der Auswahl, und das Formular
 * schriebe die Aufgabe oder die Prüfung still in ein anderes — in das erste
 * der Liste. Ein abgewähltes Fach soll den heutigen Alltag nicht mehr bewegen;
 * dass ein Blatt darin liegt, ist aber eine Tatsache und kein Alltag.
 *
 * Es steht vorn, weil das Formular sein erstes Fach vorbelegt, wenn die
 * gewünschte id fehlt — und weil es das Fach ist, um das es hier geht.
 */
function subjectOptions(subjects: Subject[], subjectId: string): Subject[] {
  const own = subjects.find((subject) => subject.id === subjectId);
  const active = subjects.filter((subject) => !subject.archived);

  if (!own || !own.archived) return active;

  return [own, ...active];
}
