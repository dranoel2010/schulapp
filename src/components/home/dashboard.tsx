import Link from "next/link";
import type { CSSProperties } from "react";

import { setBlockStatusAction } from "@/app/(app)/lernen/actions";
import { HomeworkCheck } from "@/components/homework/homework-check";
import { ButtonLink } from "@/components/ui/button";
import { subjectColor } from "@/lib/colors";
import { formatGerman } from "@/lib/dates";
import { dueLabel, dueTone, type DueTone } from "@/lib/due-label";
import { lessonRoom, planProgress, type HomeData } from "@/lib/home";
import { mergeDoubleLessons, periodTimes } from "@/lib/timetable";

/**
 * Die Startansicht am großen Bildschirm: alles auf einen Blick, in Karten
 * nebeneinander, ohne Scrollen. Am Handy übernimmt das Kachelmenü — dort wird
 * diese Ansicht von der Startseite ausgeblendet.
 *
 * Alle Zahlen kommen aus @/lib/home. Was es noch nicht gibt — die Noten —
 * bleibt als ehrliche Lücke stehen: kein erfundener Schnitt, und auch keine
 * erfundene Schulstunde, solange kein Stundenplan eingetragen ist.
 */

type Block = HomeData["todayBlocks"][number];
type Lesson = HomeData["todayLessons"][number];
type Task = HomeData["openHomework"][number];
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
 * So viele Aufgaben passen in die Karte, ohne dass sie wächst. Der Rest ist
 * einen Knopf entfernt — das Dashboard soll auf einen Bildschirm passen.
 */
const HOMEWORK_LIMIT = 4;

/** Die Farbregel steht bei `DueTone` in @/lib/due-label. */
const DUE_TONES: Record<DueTone, string> = {
  overdue: "text-warning",
  today: "text-muted",
  soon: "text-muted",
  later: "text-muted",
  done: "text-subtle",
};

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

/** Was in Phase 4 dazukommt. Bewusst ohne Zahlen und ohne Links. */
const ROADMAP = [
  {
    title: "Noten",
    text: "Eintragen, Schnitt pro Fach und insgesamt.",
    phase: "Phase 4",
  },
];

/**
 * Die Zeile unter dem Datum: erst, was noch offen ist, dann, was heute im
 * Lernplan steht. Beides gezählt, nichts geschätzt — und richtig gebeugt, denn
 * "1 offene Aufgaben" liest man einmal zu oft.
 */
function headlineFor(data: HomeData): string {
  const open = data.homeworkCounts.open;
  const blocks = data.todayBlocks.length;

  if (open === 0) {
    if (blocks === 0) {
      return "Alles abgehakt. Heute steht auch kein Lernblock an.";
    }

    return blocks === 1
      ? "Alles abgehakt. Heute nur noch der Lernblock."
      : `Alles abgehakt. Heute noch ${blocks} Lernblöcke.`;
  }

  const tasks = open === 1 ? "1 offene Aufgabe" : `${open} offene Aufgaben`;
  const learn =
    blocks === 0
      ? "kein Lernblock"
      : blocks === 1
        ? "ein Lernblock"
        : `${blocks} Lernblöcke`;

  return `${tasks}, ${learn} heute.`;
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
          <p className="mt-1 text-[14px] text-muted">{headlineFor(data)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <ButtonLink href="/hausaufgaben" variant="secondary">
            Hausaufgaben
          </ButtonLink>
          <ButtonLink href="/klausuren/neu">Klausur eintragen</ButtonLink>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1.15fr_1fr_1fr] gap-4">
        <div className="flex min-h-0 flex-col gap-4">
          <NextExamCard exam={data.nextExam} days={data.daysToNextExam} />
          <TodayCard data={data} />
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <HomeworkCard data={data} />
          <UpcomingCard exams={upcoming} total={data.upcoming.length} />
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <SubjectsCard count={data.subjectCount} />
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
 * Der heutige Tag: erst die Schulstunden mit ihrer Uhrzeit, danach die
 * Lernblöcke. Die Reihenfolge ergibt sich aus den Daten — eine Schulstunde hat
 * einen Beginn, ein Lernblock nur eine Dauer, also steht links bei ihm die
 * Dauer und keine erfundene Uhrzeit.
 *
 * Freistunden erscheinen hier bewusst nicht: die Karte beantwortet "was steht
 * heute an", und eine Freistunde steht nicht an. In der Tagesspur am Handy ist
 * sie dagegen sinnvoll, weil dort der Tagesablauf lückenlos zu sehen ist.
 */
function TodayCard({ data }: { data: HomeData }) {
  const blocks = data.todayBlocks;
  const times = periodTimes(data.periods);

  // Wie in der Tagesspur: eine Doppelstunde ist ein Termin, nicht zwei.
  const lessons = mergeDoubleLessons(data.todayLessons);
  const missedCount = data.missed.length;

  return (
    // Die Karte wächst mit ihrem Inhalt statt die Spalte auszufüllen: ein
    // Schultag hat selten mehr als acht Zeilen, gestreckt stünde sie zu zwei
    // Dritteln leer. Bleibt am Fuß der Spalte Platz, ist das ehrlicher als
    // eine Karte, die Fülle vortäuscht.
    <section className={cn(CARD, "flex min-h-0 flex-col")}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">Heute</h3>
        {blocks.length > 0 ? (
          <span className="shrink-0 text-[13px] tabular-nums text-muted">
            {data.todayDoneCount} von {blocks.length} erledigt
          </span>
        ) : null}
      </div>

      {lessons.length === 0 && blocks.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">
          Heute steht nichts an — weder eine Schulstunde noch ein Lernblock.
        </p>
      ) : (
        <ul className="mt-3 max-h-[40vh] min-h-0 space-y-2 overflow-y-auto">
          {lessons.map((block) => (
            <LessonRow
              key={block.lesson.id}
              lesson={block.lesson}
              startsAt={times.get(block.from)?.startsAt}
            />
          ))}

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

      {data.hasTimetable ? null : (
        <Link
          href="/stundenplan"
          className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline"
        >
          Stundenplan eintragen
        </Link>
      )}
    </section>
  );
}

/**
 * Eine Schulstunde in der Heute-Karte. Die leere erste Spalte ist der Platz,
 * den in den Lernblock-Zeilen darunter das Kästchen einnimmt — ohne sie
 * stünden Uhrzeiten und Dauern nicht auf derselben Linie.
 */
function LessonRow({
  lesson,
  startsAt,
}: {
  lesson: Lesson;
  startsAt?: string;
}) {
  const room = lessonRoom(lesson);

  return (
    <li
      style={
        { "--subject": subjectColor(lesson.subject.color).hex } as CSSProperties
      }
      className="flex items-center gap-2.5 py-0.5"
    >
      <span aria-hidden="true" className="size-[18px] shrink-0" />

      <span className="w-11 shrink-0 font-mono text-[12px] tabular-nums text-subtle">
        {startsAt}
      </span>

      <span
        aria-hidden="true"
        className="h-[22px] w-1.5 shrink-0 rounded-[3px] bg-[var(--subject)]"
      />

      <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
        {room ? `${lesson.subject.name} · ${room}` : lesson.subject.name}
      </span>
    </li>
  );
}

/**
 * Die offenen Aufgaben, die nächste Fälligkeit zuerst — abhakbar an Ort und
 * Stelle. Das Badge zieht mit, weil die Action die Startseite mit auffrischt.
 */
function HomeworkCard({ data }: { data: HomeData }) {
  const open = data.homeworkCounts.open;
  const items = data.openHomework.slice(0, HOMEWORK_LIMIT);

  return (
    <section className={cn(CARD, "flex min-h-0 flex-col")}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">
          Hausaufgaben
        </h3>
        <span
          className={cn(
            "shrink-0 font-mono text-[12px] tabular-nums",
            // Warnfarbe nur, wenn auch etwas offen ist — "nichts offen" in
            // Bernstein wäre ein Alarm ohne Anlass.
            open > 0 ? "text-warning" : "text-muted",
          )}
        >
          {open === 0 ? "nichts offen" : `${open} offen`}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">
          Nichts offen. Was aufgegeben wird, trägst du unter Hausaufgaben ein.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((item) => (
            <HomeworkRow key={item.id} item={item} today={data.today} />
          ))}
        </ul>
      )}

      {open > items.length ? (
        <p className="mt-2.5 text-[13px] text-subtle">
          und {open - items.length} weitere
        </p>
      ) : null}
    </section>
  );
}

/**
 * Eine Zeile des Widgets — ohne Fach, anders als auf der Hausaufgabenseite.
 * Hier zählt, was zu tun ist; wohin es gehört, steht dort, wo man es
 * bearbeitet. Der Titel ist bewusst kein Link: das Kästchen bringt sein
 * eigenes Formular mit, und ein Formular in einem Link wäre ungültiges HTML.
 */
function HomeworkRow({ item, today }: { item: Task; today: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <HomeworkCheck
        id={item.id}
        done={item.done}
        label={`${item.subject.name}: ${item.title}`}
        size="sm"
      />

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[14px]",
          item.done ? "text-subtle line-through" : "text-foreground",
        )}
      >
        {item.title}
      </span>

      <span
        className={cn(
          "shrink-0 font-mono text-[12px] tabular-nums",
          DUE_TONES[dueTone(item.dueDate, today, item.done)],
        )}
      >
        {dueLabel(item.dueDate, today)}
      </span>
    </li>
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
    <section className={cn(CARD, "flex min-h-0 flex-col")}>
      <h3 className="text-[15px] font-semibold text-foreground">
        Was noch kommt
      </h3>
      <p className="mt-1 text-[13px] text-muted">
        Dieser Bereich ist noch nicht gebaut. Bis dahin steht hier keine Zahl —
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
