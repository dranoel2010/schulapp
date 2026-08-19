import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatCountdown, formatGerman, todayInBerlin } from "@/lib/dates";
import { listExams, type ExamListItem } from "@/lib/exams";
import { listSubjects } from "@/lib/subjects";

/**
 * Die Übersicht: was ansteht, wie lange es noch dauert und wie weit der
 * Lernplan ist. Die nächste Prüfung steht groß oben, alles Weitere als Zeile
 * darunter. Vergangenes ist zugeklappt — es interessiert selten, ganz weg soll
 * es aber auch nicht sein.
 */

export const metadata: Metadata = {
  title: "Klausuren",
};

/** Kurzform für die Anzeige; im Formular heißt es "Mündliche Prüfung". */
const KIND_LABELS: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "mündlich",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Prüfung";
}

/** Wie weit der Lernplan ist. Ohne Plan gibt es nichts zu sagen. */
function progressLabel(exam: ExamListItem): string | null {
  if (exam.totalBlocks === 0) return null;
  if (exam.doneBlocks >= exam.totalBlocks) return "Lernplan durch";
  return `${exam.doneBlocks} von ${exam.totalBlocks} Lernblöcken`;
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 shrink-0 text-subtle"
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

/** Die nächste Prüfung — größer, mit Countdown als Überschrift. */
function NextExam({ exam, today }: { exam: ExamListItem; today: string }) {
  const color = subjectColor(exam.subject.color);
  const progress = progressLabel(exam);
  const percent =
    exam.totalBlocks > 0
      ? Math.round((exam.doneBlocks / exam.totalBlocks) * 100)
      : 0;

  return (
    <Link
      href={`/klausuren/${exam.id}`}
      style={
        {
          "--subject": color.hex,
          backgroundColor:
            "color-mix(in oklab, var(--subject) 7%, var(--surface))",
          borderColor: "color-mix(in oklab, var(--subject) 30%, var(--border))",
        } as CSSProperties
      }
      className="block rounded-card border p-4 shadow-soft transition-shadow hover:shadow-lift sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span
              aria-hidden="true"
              style={{ backgroundColor: color.hex }}
              className="size-3 shrink-0 rounded-full"
            />
            <span className="truncate font-semibold text-foreground">
              {exam.subject.name}
            </span>
            <span
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--subject) 18%, var(--surface))",
                color: "color-mix(in oklab, var(--subject) 72%, var(--foreground))",
              }}
              className="shrink-0 rounded-pill px-2 py-0.5 text-xs font-semibold"
            >
              {kindLabel(exam.kind)}
            </span>
          </p>

          {exam.title ? (
            <p className="mt-1 truncate text-sm text-muted">{exam.title}</p>
          ) : null}
        </div>

        <Chevron />
      </div>

      <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
        {formatCountdown(today, exam.date)}
      </p>
      <p className="mt-0.5 text-sm text-muted">{formatGerman(exam.date)}</p>

      {progress ? (
        <div className="mt-4 space-y-1.5">
          <span
            aria-hidden="true"
            className="block h-1.5 overflow-hidden rounded-pill bg-surface-muted"
          >
            <span
              style={{ width: `${percent}%`, backgroundColor: color.hex }}
              className="block h-full rounded-pill"
            />
          </span>
          <p className="text-sm text-muted">{progress}</p>
        </div>
      ) : exam.topicCount === 0 ? (
        <p className="mt-4 text-sm text-warning">
          Noch keine Themen — ohne die kann die App nichts verteilen.
        </p>
      ) : null}
    </Link>
  );
}

/** Alle weiteren Prüfungen als Zeile. Die ganze Zeile führt zur Detailseite. */
function ExamRow({ exam, today }: { exam: ExamListItem; today: string }) {
  const color = subjectColor(exam.subject.color);
  const progress = progressLabel(exam);
  const meta = [kindLabel(exam.kind), formatGerman(exam.date, "kurz"), progress]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <Link
        href={`/klausuren/${exam.id}`}
        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
      >
        <span
          aria-hidden="true"
          style={{ backgroundColor: color.hex }}
          className="size-3 shrink-0 rounded-full"
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {exam.subject.name}
            {exam.title ? (
              <span className="font-normal text-muted"> · {exam.title}</span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted">
            {meta}
          </span>
        </span>

        <span className="shrink-0 text-sm text-muted">
          {formatCountdown(today, exam.date)}
        </span>

        <Chevron />
      </Link>
    </li>
  );
}

function ExamRows({
  exams,
  today,
  className,
}: {
  exams: ExamListItem[];
  today: string;
  className?: string;
}) {
  return (
    <ul
      className={[
        "divide-y divide-border overflow-hidden rounded-card border border-border bg-surface",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {exams.map((exam) => (
        <ExamRow key={exam.id} exam={exam} today={today} />
      ))}
    </ul>
  );
}

export default async function ExamsPage() {
  const user = await requireUser();
  const today = todayInBerlin();

  const [exams, subjects] = await Promise.all([
    listExams(user.id, { includePast: true }),
    listSubjects(user.id),
  ]);

  const upcoming = exams.filter((exam) => exam.date >= today);
  const past = exams.filter((exam) => exam.date < today);
  const [next, ...later] = upcoming;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Klausuren</h1>
        {exams.length > 0 ? (
          <ButtonLink href="/klausuren/neu" variant="secondary">
            Klausur eintragen
          </ButtonLink>
        ) : null}
      </header>

      {exams.length === 0 ? (
        subjects.length === 0 ? (
          <EmptyState
            title="Zuerst die Fächer"
            description="Jede Prüfung gehört zu einem Fach. Sobald deine Fächer stehen, kannst du Termine eintragen."
            action={<ButtonLink href="/faecher">Zu den Fächern</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="Keine Prüfung eingetragen"
            description="Trag einen Termin mit seinen Themen ein — die App verteilt die Themen dann selbst auf die Lerntage davor."
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
                <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
                <path d="M3.5 9.5h17M8 3.5V6M16 3.5V6" />
                <path d="m9 14 2 2 4-4" />
              </svg>
            }
          />
        )
      ) : (
        <div className="space-y-4">
          {next ? (
            <NextExam exam={next} today={today} />
          ) : (
            <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
              Zurzeit steht nichts an.
            </p>
          )}

          {later.length > 0 ? <ExamRows exams={later} today={today} /> : null}

          {past.length > 0 ? (
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="size-4 transition-transform group-open:rotate-90"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
                Vorbei ({past.length})
              </summary>

              <div className="mt-2">
                <ExamRows exams={past} today={today} className="opacity-60" />
              </div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}
