import { and, count, eq } from "drizzle-orm";
import Link from "next/link";

import {
  catchUpMissedAction,
  setBlockStatusAction,
  skipMissedAction,
} from "@/app/(app)/klausuren/[id]/plan-actions";
import { BlockItem } from "@/components/study/block-item";
import { MissedPrompt } from "@/components/study/missed-prompt";
import { ButtonLink } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { subjects } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatCountdown, formatGerman, todayInBerlin } from "@/lib/dates";
import { blocksForDay, missedBlocks, upcomingExams } from "@/lib/exams";

/**
 * Der Server läuft je nach Hosting in UTC — ohne feste Zeitzone stünde nachts
 * die Uhrzeit von gestern auf der Startseite.
 */
const TIME_ZONE = "Europe/Berlin";

/** Wie viele Prüfungen unter "Als Nächstes" stehen. */
const UPCOMING_LIMIT = 4;

/** Was noch fehlt — steht so auch in KONZEPT.md. */
const ROADMAP = [
  {
    title: "Stundenplan und Hausaufgaben",
    text: "Der Wochenplan und was bis wann fällig ist.",
  },
  {
    title: "Noten",
    text: "Eintragen, Schnitt pro Fach und insgesamt.",
  },
];

const EXAM_KIND_LABELS: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "Mündliche Prüfung",
};

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 11) return "Guten Morgen";
  if (hour >= 18) return "Guten Abend";
  return "Hallo";
}

export default async function StartPage() {
  const user = await requireUser();
  const today = todayInBerlin();

  const [row] = await db
    .select({ value: count() })
    .from(subjects)
    .where(and(eq(subjects.userId, user.id), eq(subjects.archived, false)));

  const subjectCount = row?.value ?? 0;

  const [missed, todayBlocks, upcoming] = await Promise.all([
    missedBlocks(user.id, today),
    blocksForDay(user.id, today),
    upcomingExams(user.id, today, UPCOMING_LIMIT),
  ]);

  // Eine Nachfrage je Prüfung, über alle betroffenen Tage zusammengefasst.
  const missedByExam = new Map<
    string,
    {
      examId: string;
      subjectName: string;
      color: string;
      minutes: number;
      dates: Set<string>;
      lastDate: string;
    }
  >();

  for (const block of missed) {
    const entry = missedByExam.get(block.examId) ?? {
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

    missedByExam.set(block.examId, entry);
  }

  const openToday = todayBlocks.filter((block) => block.status === "open");
  const openMinutes = openToday.reduce((sum, block) => sum + block.minutes, 0);

  // Ohne Fächer gibt es nichts zu lernen. Sind alle Fächer archiviert, hängen
  // trotzdem noch Prüfungen daran — dann bleibt der Lernteil stehen.
  const showStudy =
    subjectCount > 0 ||
    missed.length > 0 ||
    todayBlocks.length > 0 ||
    upcoming.length > 0;

  // formatToParts statt toLocaleString: Deutsch hängt sonst „Uhr“ an die Zahl.
  const hour = Number(
    new Intl.DateTimeFormat("de-DE", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: TIME_ZONE,
    })
      .formatToParts(new Date())
      .find((part) => part.type === "hour")?.value,
  );
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greetingFor(hour)}, {firstName}
        </h1>
        <p className="mt-1 text-muted">{formatGerman(today)}</p>
      </div>

      {subjectCount === 0 ? (
        <EmptyState
          title="Noch keine Fächer"
          description="Ohne Fächer kann die App nichts einsortieren. Sobald sie stehen, hängen Klausuren, Stundenplan und Noten daran."
          action={
            <ButtonLink href="/faecher/neu" size="lg">
              Erstes Fach anlegen
            </ButtonLink>
          }
        />
      ) : null}

      {showStudy ? (
        <>
          {[...missedByExam.values()].map((entry) => (
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

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">
                Heute lernen
              </h2>
              {openMinutes > 0 ? (
                <span className="text-sm tabular-nums text-muted">
                  noch {openMinutes} min
                </span>
              ) : null}
            </div>

            {todayBlocks.length === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                Für heute steht nichts im Lernplan.
              </p>
            ) : (
              <>
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

                {openToday.length === 0 ? (
                  <p className="text-sm text-muted">
                    Für heute ist alles erledigt.
                  </p>
                ) : null}
              </>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">
                Als Nächstes
              </h2>
              {upcoming.length > 0 ? (
                <Link
                  href="/klausuren"
                  className="text-sm text-muted transition-colors hover:text-foreground"
                >
                  Alle Prüfungen
                </Link>
              ) : null}
            </div>

            {upcoming.length === 0 ? (
              <div className="rounded-card border border-dashed border-border px-4 py-6 text-center">
                <p className="mx-auto max-w-xs text-sm text-muted">
                  Keine Prüfung eingetragen. Sobald eine drinsteht, verteilt die
                  App die Themen auf die Tage davor.
                </p>
                <ButtonLink
                  href="/klausuren/neu"
                  variant="secondary"
                  className="mt-4"
                >
                  Prüfung eintragen
                </ButtonLink>
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                {upcoming.map((exam) => (
                  <li key={exam.id}>
                    <Link
                      href={`/klausuren/${exam.id}`}
                      className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          backgroundColor: subjectColor(exam.subject.color).hex,
                        }}
                        className="size-3 shrink-0 rounded-full"
                      />

                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {exam.title ??
                            EXAM_KIND_LABELS[exam.kind] ??
                            "Prüfung"}
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted">
                          {exam.subject.name} ·{" "}
                          {formatGerman(exam.date, "kurz")}
                        </span>
                      </span>

                      <span className="shrink-0 text-sm text-muted">
                        {formatCountdown(today, exam.date)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {subjectCount > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Fächer</CardTitle>
            <ButtonLink href="/faecher" variant="secondary">
              Ansehen
            </ButtonLink>
          </CardHeader>
          <CardContent>
            <p className="text-muted">
              <span className="text-2xl font-semibold text-foreground">
                {subjectCount}
              </span>{" "}
              {subjectCount === 1 ? "Fach angelegt" : "Fächer angelegt"}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ausblick</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Fertig sind Anmeldung, Fächer und die Lernphasen zu Klausuren. Das
            kommt noch:
          </p>
          <ol className="space-y-3">
            {ROADMAP.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-xs font-medium text-muted"
                >
                  {index + 1}
                </span>
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {step.title}
                  </span>
                  <span className="block text-sm text-muted">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
