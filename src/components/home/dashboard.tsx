import Link from "next/link";
import type { CSSProperties } from "react";

import { setBlockStatusAction } from "@/app/(app)/lernen/actions";
import { ButtonLink } from "@/components/ui/button";
import { subjectColor } from "@/lib/colors";
import { formatGerman } from "@/lib/dates";
import { planProgress, type HomeData } from "@/lib/home";

/**
 * Die Startansicht am großen Bildschirm: alles auf einen Blick, in Karten
 * nebeneinander, ohne Scrollen. Am Handy übernimmt das Kachelmenü — dort wird
 * diese Ansicht von der Startseite ausgeblendet.
 *
 * Alle Zahlen kommen aus @/lib/home. Was es noch nicht gibt — Stundenplan,
 * Hausaufgaben, Noten — bleibt als ehrliche Lücke stehen: keine erfundenen
 * Stunden, keine erfundenen Aufgaben, kein erfundener Schnitt.
 */

type Block = HomeData["todayBlocks"][number];
type Exam = NonNullable<HomeData["nextExam"]>;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Das Maß aus dem Entwurf: 18px Polster, eine Haarlinie, keine Schatten. */
const CARD = "rounded-card border border-border bg-surface p-[18px]";
const CARD_LINK = cn(CARD, "block transition-colors hover:border-border-strong");

/** So viele Termine passen in die Spalte, ohne dass die Seite wächst. */
const UPCOMING_LIMIT = 5;

/**
 * Die Überschrift der Countdown-Karte richtet sich nach der Art der Prüfung —
 * ein Referat als "Klausur" zu beschriften wäre schon eine kleine Unwahrheit.
 */
const NEXT_EXAM_LABELS: Record<string, string> = {
  klausur: "Nächste Klausur",
  test: "Nächster Test",
  referat: "Nächstes Referat",
  muendlich: "Nächste mündliche Prüfung",
};

/** Was in Phase 3 und 4 dazukommt. Bewusst ohne Zahlen und ohne Links. */
const ROADMAP = [
  {
    title: "Stundenplan",
    text: "Die Woche mit Fächern, Räumen und Zeiten.",
    phase: "Phase 3",
  },
  {
    title: "Hausaufgaben",
    text: "Was bis wann fällig ist.",
    phase: "Phase 3",
  },
  {
    title: "Noten",
    text: "Eintragen, Schnitt pro Fach und insgesamt.",
    phase: "Phase 4",
  },
];

/** Eine Zeile unter dem Datum — nur das, was wirklich in den Daten steht. */
function summaryFor(data: HomeData): string {
  const parts: string[] = [];

  if (data.todayOpenMinutes > 0) {
    parts.push(`${data.todayOpenMinutes} min Lernzeit offen`);
  } else if (data.todayBlocks.length > 0) {
    parts.push("Lernplan für heute erledigt");
  } else {
    parts.push("heute nichts im Lernplan");
  }

  if (data.nextExam && data.daysToNextExam !== null) {
    const days = data.daysToNextExam;
    parts.push(
      days === 0
        ? `${data.nextExam.subject.name} heute`
        : days === 1
          ? `${data.nextExam.subject.name} morgen`
          : `${data.nextExam.subject.name} in ${days} Tagen`,
    );
  } else {
    parts.push("keine Prüfung eingetragen");
  }

  return parts.join(" · ");
}

export function HomeDashboard({ data }: { data: HomeData }) {
  const upcoming = data.upcoming.slice(0, UPCOMING_LIMIT);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            {formatGerman(data.today, "lang")}
          </h2>
          <p className="mt-1 text-[14px] text-muted">{summaryFor(data)}</p>
        </div>

        <ButtonLink href="/klausuren/neu" className="shrink-0">
          Klausur eintragen
        </ButtonLink>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1.15fr_1fr_1fr] gap-4">
        <div className="flex min-h-0 flex-col gap-4">
          <NextExamCard exam={data.nextExam} days={data.daysToNextExam} />
          <TodayCard
            blocks={data.todayBlocks}
            doneCount={data.todayDoneCount}
            missedCount={data.missed.length}
          />
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <UpcomingCard exams={upcoming} total={data.upcoming.length} />
          <SubjectsCard count={data.subjectCount} />
        </div>

        <div className="flex min-h-0 flex-col">
          <RoadmapCard />
        </div>
      </div>
    </div>
  );
}

/** Tage bis zur nächsten Prüfung, groß, mit dem Stand des Lernplans. */
function NextExamCard({
  exam,
  days,
}: {
  exam: Exam | null;
  days: number | null;
}) {
  if (!exam || days === null) {
    return (
      <section className={CARD}>
        <p className="text-[13px] text-muted">Nächste Prüfung</p>
        <p className="mt-2 text-[15px] text-foreground">
          Keine Prüfung eingetragen.
        </p>
        <p className="mt-1 text-[13px] text-muted">
          Hier stehen sonst die Tage bis zur nächsten Prüfung und wie weit der
          Lernplan dafür ist.
        </p>
        <Link
          href="/klausuren/neu"
          className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline"
        >
          Prüfung eintragen
        </Link>
      </section>
    );
  }

  const progress = planProgress(exam);

  return (
    // Die Karte zeigt den Stand des Lernplans — also führt sie in den
    // Lernbereich und nicht auf die Klausur, wo der Termin verwaltet wird.
    <Link href="/lernen" className={CARD_LINK}>
      <p className="text-[13px] text-muted">
        {NEXT_EXAM_LABELS[exam.kind] ?? "Nächste Prüfung"}
      </p>

      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">
          {days === 0 ? "heute" : days}
        </span>
        <span className="min-w-0 truncate text-[15px] text-muted">
          {days === 0
            ? exam.subject.name
            : `${days === 1 ? "Tag" : "Tage"} · ${exam.subject.name}`}
        </span>
      </p>

      <div
        role="progressbar"
        aria-label="Lernfortschritt"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="mt-2 text-[13px] text-muted">
        {exam.totalBlocks === 0
          ? "Lernplan: noch keine Blöcke geplant"
          : `Lernplan: ${exam.doneBlocks} von ${exam.totalBlocks} Blöcken erledigt`}
      </p>
    </Link>
  );
}

/**
 * Die Lernblöcke von heute. Der Entwurf zeigt hier auch Schulstunden mit
 * Uhrzeit — die gibt es nicht. Lernblöcke haben nur eine Dauer, also steht
 * links die Dauer und keine erfundene Uhrzeit.
 */
function TodayCard({
  blocks,
  doneCount,
  missedCount,
}: {
  blocks: Block[];
  doneCount: number;
  missedCount: number;
}) {
  return (
    <section className={cn(CARD, "flex min-h-0 flex-1 flex-col")}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">Heute</h3>
        {blocks.length > 0 ? (
          <span className="shrink-0 text-[13px] tabular-nums text-muted">
            {doneCount} von {blocks.length} erledigt
          </span>
        ) : null}
      </div>

      {blocks.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">
          Für heute steht nichts im Lernplan.
        </p>
      ) : (
        <ul className="mt-3 max-h-[40vh] min-h-0 flex-1 space-y-2 overflow-y-auto">
          {blocks.map((block) => (
            <BlockRow key={block.id} block={block} />
          ))}
        </ul>
      )}

      {missedCount > 0 ? (
        <p className="mt-3 border-t border-border pt-2.5 text-[13px] text-warning">
          Aus den Tagen davor {missedCount === 1 ? "ist" : "sind"} noch{" "}
          {missedCount} {missedCount === 1 ? "Block" : "Blöcke"} offen.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Eine Zeile der Heute-Karte. Sie ist abhakbar — das war auf der alten
 * Startseite so und bleibt es: den heutigen Block erledigt man dort, wo man ihn
 * sieht, nicht erst nach einem Umweg über den Lernbereich.
 */
function BlockRow({ block }: { block: Block }) {
  const done = block.status === "done";
  const title = block.topic?.title ?? "Gesamtwiederholung";

  return (
    <li
      style={
        { "--subject": subjectColor(block.subject.color).hex } as CSSProperties
      }
    >
      <form
        action={setBlockStatusAction.bind(
          null,
          block.examId,
          block.id,
          done ? "open" : "done",
        )}
      >
        <button
          type="submit"
          aria-label={
            done
              ? `${block.subject.name}: ${title} wieder offen setzen`
              : `${block.subject.name}: ${title} als erledigt abhaken`
          }
          className={cn(
            "flex w-full items-center gap-2.5 rounded-control py-0.5 text-left transition-colors",
            "hover:bg-surface-muted focus-visible:bg-surface-muted",
            done && "opacity-55",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] text-[11px] leading-none",
              done
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border-strong text-transparent",
            )}
          >
            ✓
          </span>

          <span className="w-11 shrink-0 font-mono text-[12px] tabular-nums text-subtle">
            {block.minutes} min
          </span>

          <span
            aria-hidden="true"
            className="h-[22px] w-1.5 shrink-0 rounded-[3px] bg-[var(--subject)]"
          />

          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[14px]",
              done && "text-subtle line-through",
            )}
          >
            <span className={done ? undefined : "font-medium text-accent"}>
              {block.subject.name}
            </span>{" "}
            <span className={done ? undefined : "text-muted"}>{title}</span>
          </span>
        </button>
      </form>
    </li>
  );
}

/** Die kommenden Prüfungen, die nächste zuerst. */
function UpcomingCard({ exams, total }: { exams: Exam[]; total: number }) {
  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">Termine</h3>
        {total > 0 ? (
          <Link
            href="/klausuren"
            className="shrink-0 text-[13px] text-muted transition-colors hover:text-foreground"
          >
            Alle
          </Link>
        ) : null}
      </div>

      {exams.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">
          Keine Prüfung eingetragen. Sobald eine drinsteht, verteilt die App die
          Themen auf die Tage davor.
        </p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {exams.map((exam) => (
            <li
              key={exam.id}
              style={
                { "--subject": subjectColor(exam.subject.color).hex } as CSSProperties
              }
            >
              <Link
                href={`/klausuren/${exam.id}`}
                className="-mx-2 flex items-center gap-2.5 rounded-control px-2 py-1.5 transition-colors hover:bg-surface-muted"
              >
                <span className="w-[62px] shrink-0 text-[14px] tabular-nums text-muted">
                  {formatGerman(exam.date, "kurz")}
                </span>
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full bg-[var(--subject)]"
                />
                <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
                  {exam.subject.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {total > exams.length ? (
        <p className="mt-2 text-[13px] text-subtle">
          und {total - exams.length} weitere
        </p>
      ) : null}
    </section>
  );
}

function SubjectsCard({ count }: { count: number }) {
  return (
    <Link href="/faecher" className={CARD_LINK}>
      <p className="text-[13px] text-muted">Fächer</p>

      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-[32px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">
          {count}
        </span>
        <span className="text-[15px] text-muted">
          {count === 1 ? "Fach angelegt" : "Fächer angelegt"}
        </span>
      </p>

      <p className="mt-3 text-[13px] font-medium text-accent">
        {count === 0 ? "Fächer anlegen" : "Alle Fächer ansehen"}
      </p>
    </Link>
  );
}

/**
 * Die ehrliche Lücke. Der Entwurf hat hier einen Notenschnitt mit Balken —
 * Noten gibt es noch nicht, also steht hier auch keine Zahl.
 */
function RoadmapCard() {
  return (
    <section className={cn(CARD, "flex min-h-0 flex-1 flex-col")}>
      <h3 className="text-[15px] font-semibold text-foreground">
        Was noch kommt
      </h3>
      <p className="mt-1 text-[13px] text-muted">
        Diese Bereiche sind noch nicht gebaut. Bis dahin steht hier keine Zahl —
        lieber eine Lücke als eine erfundene Angabe.
      </p>

      <ul className="mt-4 space-y-2">
        {ROADMAP.map((item) => (
          <li
            key={item.title}
            className="rounded-control border border-dashed border-border px-3 py-2.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-medium text-foreground">
                {item.title}
              </span>
              <span className="shrink-0 text-[12px] text-subtle">
                {item.phase}
              </span>
            </div>
            <p className="mt-0.5 text-[13px] text-muted">{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
