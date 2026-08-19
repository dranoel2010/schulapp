import type { Metadata } from "next";

import { BlockItem } from "@/components/study/block-item";
import { MissedPrompt } from "@/components/study/missed-prompt";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatCountdown, formatGerman, todayInBerlin } from "@/lib/dates";
import {
  blocksForDay,
  getExam,
  listExams,
  missedBlocks,
  type ExamDetail,
  type ExamListItem,
  type TodayBlock,
} from "@/lib/exams";
import { buildPlan } from "@/lib/study-plan";

import {
  catchUpMissedAction,
  setBlockStatusAction,
  skipMissedAction,
} from "./actions";
import { StudyPlanView } from "./study-plan-view";

/**
 * Der Lernbereich: hier wird gelernt, nicht verwaltet.
 *
 * Von oben nach unten: was der Tag bringt, die Nachfrage nach liegen
 * gebliebener Lernzeit, die heutigen Blöcke über alle Prüfungen hinweg und
 * darunter je anstehender Prüfung der volle Lernplan.
 *
 * Bearbeiten, Löschen, Archivieren und Themenpflege stehen nebenan unter
 * /klausuren. Der einzige Weg dorthin ist der Hinweis bei fehlenden Themen —
 * ohne Themen kann die App nichts verteilen, und das lässt sich nur dort
 * beheben.
 */

export const metadata: Metadata = {
  title: "Lernen",
};

// `export const dynamic = "force-dynamic"` steht schon im Layout der Gruppe
// (src/app/(app)/layout.tsx) und gilt damit auch hier — hier wäre es doppelt.

/** Wie in der Erinnerungs-Route: die Art einer Prüfung in Worten. */
const EXAM_KIND_LABELS: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "Mündliche Prüfung",
};

function capitalize(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

/** Eine Nachfrage je Prüfung, über alle betroffenen Tage zusammengefasst. */
type MissedEntry = {
  examId: string;
  subjectName: string;
  color: string;
  minutes: number;
  dates: Set<string>;
  lastDate: string;
};

function groupMissed(blocks: TodayBlock[]): MissedEntry[] {
  const byExam = new Map<string, MissedEntry>();

  for (const block of blocks) {
    const entry = byExam.get(block.examId) ?? {
      examId: block.examId,
      subjectName: block.subject.name,
      color: subjectColor(block.subject.color).hex,
      minutes: 0,
      dates: new Set<string>(),
      lastDate: block.date,
    };

    entry.minutes += block.minutes;
    entry.dates.add(block.date);
    if (block.date > entry.lastDate) entry.lastDate = block.date;

    byExam.set(block.examId, entry);
  }

  return [...byExam.values()];
}

/**
 * Die Zeile unter der Überschrift. Sie nennt die offenen Minuten von heute —
 * gibt es nichts zu tun, sagt sie ruhig, warum.
 */
function daySummary(
  todayBlocks: TodayBlock[],
  openMinutes: number,
  nextExam: ExamListItem | undefined,
  today: string,
): string {
  if (todayBlocks.length === 0) {
    if (!nextExam) {
      return "Noch keine Prüfung eingetragen — deshalb steht hier auch kein Lernplan.";
    }

    return `Heute steht nichts im Lernplan. ${nextExam.subject.name} ist ${formatCountdown(today, nextExam.date)}.`;
  }

  if (openMinutes === 0) {
    return "Für heute ist alles abgehakt.";
  }

  const open = todayBlocks.filter((block) => block.status === "open").length;

  return `${openMinutes} Minuten offen — ${
    open === 1 ? "1 Lernblock" : `${open} Lernblöcke`
  } für heute.`;
}

/** Kopfzeile eines Prüfungsabschnitts: Fach, Countdown, Datum. */
function ExamHeading({ detail, today }: { detail: ExamDetail; today: string }) {
  const { exam, subject } = detail;
  const color = subjectColor(subject.color).hex;
  const kindLabel = EXAM_KIND_LABELS[exam.kind] ?? "Prüfung";

  return (
    <header
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 8%, var(--surface))`,
      }}
      className="rounded-card border border-border p-4 sm:p-5"
    >
      <p className="flex items-center gap-2 text-sm text-muted">
        <span
          aria-hidden="true"
          style={{ backgroundColor: color }}
          className="size-2.5 shrink-0 rounded-full"
        />
        {subject.name}
      </p>

      <h2 className="mt-1.5 text-lg font-semibold text-foreground">
        {exam.title ?? kindLabel}
      </h2>

      <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
        {capitalize(formatCountdown(today, exam.date))}
      </p>
      <p className="mt-0.5 text-muted">
        {[exam.title ? kindLabel : null, formatGerman(exam.date)]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </header>
  );
}

export default async function LearnPage() {
  const user = await requireUser();
  const today = todayInBerlin();

  // listExams liefert ohne includePast nur die anstehenden Prüfungen, die
  // nächste zuerst — genau die Reihenfolge der Abschnitte weiter unten.
  const [exams, todayBlocks, missed] = await Promise.all([
    listExams(user.id),
    blocksForDay(user.id, today),
    missedBlocks(user.id, today),
  ]);

  // Themen und Blöcke jeder Prüfung — einmal geladen, danach nur noch gelesen.
  const details = (
    await Promise.all(exams.map((exam) => getExam(user.id, exam.id)))
  ).filter((detail): detail is ExamDetail => detail !== null);

  const openMinutes = todayBlocks
    .filter((block) => block.status === "open")
    .reduce((sum, block) => sum + block.minutes, 0);

  const missedEntries = groupMissed(missed);

  return (
    <div className="space-y-6 md:max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Lernen</h1>
        <p className="mt-1 text-muted">
          {daySummary(todayBlocks, openMinutes, exams[0], today)}
        </p>
      </header>

      {missedEntries.length > 0 ? (
        <div className="space-y-4">
          {missedEntries.map((entry) => (
            <MissedPrompt
              key={entry.examId}
              subjectName={entry.subjectName}
              color={entry.color}
              days={entry.dates.size}
              minutes={entry.minutes}
              lastDate={entry.lastDate}
              today={today}
              catchUp={catchUpMissedAction.bind(null, entry.examId)}
              skip={skipMissedAction.bind(null, entry.examId)}
            />
          ))}
        </div>
      ) : null}

      {details.length === 0 ? (
        <EmptyState
          title="Nichts zu lernen"
          description="Der Lernplan entsteht aus einer eingetragenen Klausur: Termin und Themen rein, den Rest verteilt die App auf die Tage davor."
          action={
            <ButtonLink href="/klausuren/neu">Klausur eintragen</ButtonLink>
          }
          icon={
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9a3 3 0 0 1 3 3 3 3 0 0 1 3-3h3.5A1.5 1.5 0 0 1 20 5.5v11a1.5 1.5 0 0 1-1.5 1.5H15a3 3 0 0 0-3 3 3 3 0 0 0-3-3H5.5A1.5 1.5 0 0 1 4 16.5Z" />
              <path d="M12 7v13" />
            </svg>
          }
        />
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">Heute</h2>
              {openMinutes > 0 ? (
                <span className="text-sm tabular-nums text-muted">
                  {openMinutes} min offen
                </span>
              ) : null}
            </div>

            {todayBlocks.length === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                Für heute ist kein Lernblock geplant.
              </p>
            ) : (
              <>
                {openMinutes === 0 ? (
                  <p className="text-sm text-success">
                    Alles geschafft — was du zurücknehmen willst, tippst du
                    einfach wieder an.
                  </p>
                ) : null}

                <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                  {todayBlocks.map((block) => (
                    <BlockItem
                      key={block.id}
                      topic={block.topic?.title ?? null}
                      minutes={block.minutes}
                      kind={block.kind === "review" ? "review" : "learn"}
                      done={block.status === "done"}
                      color={subjectColor(block.subject.color).hex}
                      subjectName={block.subject.name}
                      toggle={setBlockStatusAction.bind(
                        null,
                        block.examId,
                        block.id,
                        block.status === "done" ? "open" : "done",
                      )}
                    />
                  ))}
                </ul>
              </>
            )}
          </section>

          <div className="space-y-8 pt-2">
            {details.map((detail) => {
              const { exam, subject, topics, blocks } = detail;

              // Der Plan wird hier nur gerechnet, nicht gespeichert — gebraucht
              // werden seine Warnungen. Gespeichert wird ausschließlich über
              // generatePlanAction.
              const plan = buildPlan({
                examDate: exam.date,
                today,
                topics: topics.map((topic) => ({
                  id: topic.id,
                  title: topic.title,
                })),
                leadDays: exam.leadDays,
                minutesPerDay: exam.minutesPerDay,
              });

              return (
                <section key={exam.id} className="space-y-4">
                  <ExamHeading detail={detail} today={today} />

                  <StudyPlanView
                    examId={exam.id}
                    examDate={exam.date}
                    today={today}
                    color={subjectColor(subject.color).hex}
                    topicCount={topics.length}
                    blocks={blocks}
                    warnings={plan.warnings}
                    minutesPerDay={exam.minutesPerDay}
                    leadDays={exam.leadDays}
                  />
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
