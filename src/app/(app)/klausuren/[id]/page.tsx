import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MissedPrompt } from "@/components/study/missed-prompt";
import { ButtonLink } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import {
  daysBetween,
  formatCountdown,
  formatGerman,
  todayInBerlin,
} from "@/lib/dates";
import { getExam } from "@/lib/exams";
import { buildPlan } from "@/lib/study-plan";

import { catchUpMissedAction, skipMissedAction } from "./plan-actions";
import { StudyPlanView } from "./study-plan-view";

export const metadata: Metadata = {
  title: "Prüfung",
};

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

/** "In 5 Tagen", "Morgen", "Heute", "Vorbei". */
function countdownHeadline(today: string, examDate: string): string {
  const days = daysBetween(today, examDate);

  if (days === 0) return "Heute";
  if (days < 0) return "Vorbei";
  return capitalize(formatCountdown(today, examDate));
}

export default async function ExamPage({
  params,
}: PageProps<"/klausuren/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const detail = await getExam(user.id, id);
  if (!detail) {
    notFound();
  }

  const { exam, subject, topics, blocks } = detail;

  const today = todayInBerlin();
  const color = subjectColor(subject.color).hex;
  const daysLeft = daysBetween(today, exam.date);
  const kindLabel = EXAM_KIND_LABELS[exam.kind] ?? "Prüfung";

  // Der Plan wird hier nur gerechnet, nicht gespeichert — gebraucht werden
  // seine Warnungen. Gespeichert wird ausschließlich über generatePlanAction.
  const plan = buildPlan({
    examDate: exam.date,
    today,
    topics: topics.map((topic) => ({ id: topic.id, title: topic.title })),
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
  });

  // Liegen gebliebene Blöcke. Ist die Prüfung vorbei, fragt niemand mehr nach.
  const missed =
    daysLeft >= 0
      ? blocks.filter((block) => block.status === "open" && block.date < today)
      : [];
  const missedMinutes = missed.reduce((sum, block) => sum + block.minutes, 0);
  const missedDays = new Set(missed.map((block) => block.date)).size;
  const dateText = formatGerman(exam.date);

  return (
    <div className="space-y-6">
      <Link
        href="/klausuren"
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
        Alle Prüfungen
      </Link>

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
          {subject.name}
        </p>

        <h1 className="mt-1.5 text-xl font-semibold text-foreground">
          {exam.title ?? kindLabel}
        </h1>

        <p className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
          {countdownHeadline(today, exam.date)}
        </p>
        <p className="mt-1 text-muted">
          {[
            exam.title ? kindLabel : null,
            dateText,
            daysLeft < 0 ? formatCountdown(today, exam.date) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {missed.length > 0 ? (
        <MissedPrompt
          subjectName={subject.name}
          color={color}
          days={missedDays}
          minutes={missedMinutes}
          lastDate={missed[missed.length - 1].date}
          today={today}
          catchUp={catchUpMissedAction.bind(null, exam.id)}
          skip={skipMissedAction.bind(null, exam.id)}
        />
      ) : null}

      <StudyPlanView
        examId={exam.id}
        examDate={exam.date}
        today={today}
        color={color}
        topicCount={topics.length}
        blocks={blocks}
        warnings={plan.warnings}
        minutesPerDay={exam.minutesPerDay}
        leadDays={exam.leadDays}
      />

      <Card>
        <CardHeader>
          <CardTitle>Themen</CardTitle>
          <ButtonLink
            href={`/klausuren/${exam.id}/bearbeiten`}
            variant="secondary"
          >
            Bearbeiten
          </ButtonLink>
        </CardHeader>
        <CardContent>
          {topics.length === 0 ? (
            <p className="text-sm text-muted">
              Noch keine Themen eingetragen.
            </p>
          ) : (
            <ul className="space-y-2">
              {topics.map((topic) => (
                <li
                  key={topic.id}
                  className="flex items-baseline gap-2.5 text-[0.9375rem] text-foreground"
                >
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: color }}
                    className="size-1.5 shrink-0 -translate-y-0.5 rounded-full"
                  />
                  {topic.title}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {exam.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Notiz</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-[0.9375rem] text-muted">
              {exam.notes}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
