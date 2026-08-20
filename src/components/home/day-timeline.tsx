import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { ButtonLink } from "@/components/ui/button";
import { subjectColor } from "@/lib/colors";
import { formatCountdown, formatGerman } from "@/lib/dates";
import { dayLine, lessonRoom, type HomeData } from "@/lib/home";
import {
  mergeDoubleLessons,
  periodLabel,
  periodTimes,
} from "@/lib/timetable";

/**
 * Die Kalenderseite des Kachelmenüs: der heutige Tag als senkrechte Spur.
 *
 * Links eine schmale Spalte, rechts an einer durchgehenden Linie die Einträge.
 * Die Maße stammen aus dem Entwurf und sind auf ein 390px breites Gerät
 * gerechnet, deshalb stehen hier feste Pixelwerte, wo es kein Token gibt.
 * Die Seite trägt ihre Ränder selbst (Kopf 20/22/12, Spur 4/22/28) — sie steckt
 * am Handy in der Wischhülle, die keinen eigenen Rand setzt.
 *
 * Die Spur kennt vier Arten von Zeilen: Schulstunde, Freistunde, Lernblock und
 * Abendnotiz. Sie stehen in dieser Reihenfolge, weil nur die Schulstunden eine
 * Uhrzeit haben — ein Lernblock hat eine Dauer, keinen Beginn, und eine
 * Hausaufgabe hat nur einen Tag. Erfundene Uhrzeiten stünden sonst überall.
 *
 * Doppelstunden werden hier zu einer Zeile zusammengefasst: im Tagesablauf ist
 * eine Doppelstunde Mathe ein Termin und nicht zwei. Im Wochenraster bleiben
 * sie getrennt, dort ist das Raster der Sinn der Ansicht.
 *
 * Die Spur scrollt für sich (overflow-y-auto). Dafür muss die Flex-Kette von
 * der Hülle bis hierher durchgehen, sonst wächst stattdessen die ganze Seite.
 */

type Block = HomeData["todayBlocks"][number];
type Lesson = HomeData["todayLessons"][number];
type Task = HomeData["todayHomework"][number];

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Art des Lernblocks in der Kopfzeile der hervorgehobenen Karte. */
const BLOCK_KIND_LABELS: Record<string, string> = {
  learn: "Lernblock",
  review: "Wiederholung",
};

/** Prüfungsart, falls die Prüfung keinen eigenen Titel trägt. */
const EXAM_KIND_LABELS: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "Mündliche Prüfung",
};

/**
 * Die drei Polsterungen aus dem Entwurf. Eine Karte hängt tiefer an der Linie
 * als eine schlichte Zeile, damit die Uhrzeit auf Höhe des Fachnamens steht
 * und nicht auf Höhe des Kartenrands.
 */
const ROW_PADDING = {
  card: { time: "pt-[14px]", body: "py-[10px] pl-[14px]" },
  free: { time: "pt-[6px]", body: "py-[6px] pl-[14px]" },
  note: { time: "pt-[10px]", body: "pt-[8px] pl-[14px]" },
} as const;

/**
 * Eine Zeile der Spur: zwei Spalten, links die Zeit, rechts der Eintrag an
 * der senkrechten Linie. Die Akzentvariante färbt Spalte und Linie, die
 * gestrichelte gehört der Freistunde und den Hinweisen.
 */
function Row({
  label,
  variant = "card",
  accent = false,
  dashed = false,
  children,
}: {
  /** Linke Spalte; leer bei Zeilen, die keine Zeit haben */
  label?: ReactNode;
  variant?: keyof typeof ROW_PADDING;
  accent?: boolean;
  dashed?: boolean;
  children: ReactNode;
}) {
  const padding = ROW_PADDING[variant];

  return (
    <li className="grid grid-cols-[50px_1fr] gap-[12px]">
      <span
        className={cn(
          "font-mono text-[13px] leading-none",
          padding.time,
          accent ? "font-medium text-accent" : "text-subtle",
        )}
      >
        {label}
      </span>

      <div
        className={cn(
          // min-w-0: ohne das darf die Spalte nicht unter die Breite ihres
          // Inhalts schrumpfen — eine lange Abgabe schöbe die Karte dann über
          // den Bildschirmrand, wo die Wischhülle sie abschneidet, statt dass
          // der Text abgekürzt wird.
          "min-w-0 border-l-2",
          padding.body,
          accent
            ? "border-accent"
            : dashed
              ? "border-dashed border-border"
              : "border-border",
        )}
      >
        {children}
      </div>
    </li>
  );
}

/**
 * Die Zeitspalte einer Schulstunde. Bei einer Doppelstunde steht das Ende
 * darunter — der Termin dauert dann bis dahin, und das ist die Angabe, nach
 * der man beim Blick auf den Tag sucht.
 */
function LessonTime({ start, end }: { start: string; end?: string }) {
  if (!end) return start;

  return (
    <>
      {start}
      <span className="mt-[3px] block opacity-70">–{end}</span>
    </>
  );
}

/**
 * Eine Schulstunde: Farbstreifen des Fachs, darunter Raum und Stunde.
 *
 * Steht für dieses Fach heute eine Abgabe an, tritt sie an die Stelle der
 * Stundenangabe. Das ist die Stelle, an der Stundenplan und Hausaufgaben
 * ineinandergreifen: die Erinnerung steht dort, wo sie gebraucht wird — in der
 * Stunde, in der abgegeben wird, und nicht in einer eigenen Liste.
 */
function LessonEntry({ lesson, detail }: { lesson: Lesson; detail: string }) {
  return (
    <div className="flex items-center gap-[10px] rounded-[14px] border border-border bg-surface px-[14px] py-[12px]">
      <span
        aria-hidden="true"
        style={
          { "--subject": subjectColor(lesson.subject.color).hex } as CSSProperties
        }
        className="h-[34px] w-[8px] shrink-0 rounded-[4px] bg-[var(--subject)]"
      />

      <div className="min-w-0">
        <p className="truncate text-[15px] font-medium leading-snug text-foreground">
          {lesson.subject.name}
        </p>
        {detail ? (
          <p className="truncate text-[13px] leading-snug text-muted">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Was rechts neben dem Fach steht: Thema, sonst die Art des Blocks. */
function detailFor(block: Block): string {
  if (!block.topic) return "Gesamtwiederholung";
  return block.kind === "review"
    ? `${block.topic.title} · wiederholen`
    : block.topic.title;
}

/** Prüfung und Countdown — das, was wir über den Block sicher wissen. */
function examLineFor(block: Block, today: string): string {
  const title = block.exam.title?.trim();
  const label = title || EXAM_KIND_LABELS[block.exam.kind] || "Prüfung";
  return `${label} · ${formatCountdown(today, block.exam.date)}`;
}

/**
 * Ein gewöhnlicher Eintrag: Farbbalken des Fachs, zwei Zeilen Text. Erledigte
 * Blöcke behalten die Form, sind aber gedämpft und durchgestrichen.
 */
function Entry({ block }: { block: Block }) {
  const done = block.status === "done";

  return (
    <div className="flex items-center gap-[10px] rounded-[14px] border border-border bg-surface px-[14px] py-[12px]">
      <span
        aria-hidden="true"
        style={
          {
            "--subject": subjectColor(block.subject.color).hex,
          } as CSSProperties
        }
        className={cn(
          "h-[34px] w-[8px] shrink-0 rounded-[4px] bg-[var(--subject)]",
          done && "opacity-40",
        )}
      />

      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-[15px] font-medium leading-snug",
            done ? "text-muted line-through" : "text-foreground",
          )}
        >
          {block.subject.name}
        </p>
        <p
          className={cn(
            "truncate text-[13px] leading-snug",
            done ? "text-subtle line-through" : "text-muted",
          )}
        >
          {detailFor(block)}
        </p>
      </div>
    </div>
  );
}

/**
 * Der hervorgehobene Eintrag: der nächste offene Lernblock des Tages. Nur
 * dieser eine trägt den Akzent — im Entwurf ist es ebenfalls genau einer, und
 * er beantwortet die Frage "womit fange ich an".
 */
function LearnCard({ block, today }: { block: Block; today: string }) {
  const kind = BLOCK_KIND_LABELS[block.kind] ?? "Lernblock";

  return (
    <div className="rounded-[14px] border border-accent bg-accent-soft p-[14px]">
      <p className="text-[12px] font-medium uppercase tracking-[0.04em] text-accent">
        {kind} · {block.minutes} min
      </p>

      <p className="mt-[6px] text-[16px] font-medium leading-snug">
        {block.topic
          ? `${block.subject.name} · ${block.topic.title}`
          : block.subject.name}
      </p>

      {/* Der Entwurf schreibt hier "Tag 3 von 10 vor der Klausur". Welcher
          Block der wievielte im Plan ist, geht aus den Tagesdaten nicht
          hervor — also steht hier der Countdown, den wir wirklich kennen. */}
      <p className="mt-[2px] text-[13px] leading-snug text-muted">
        {examLineFor(block, today)}
      </p>

      {/* In den Lernbereich, nicht auf die Klausur: hier will man loslegen
          und abhaken, nicht den Termin bearbeiten. */}
      <ButtonLink href="/lernen" className="mt-[12px] w-full">
        Öffnen
      </ButtonLink>
    </div>
  );
}

/** Der ruhige Satz für einen Tag, an dem die Spur sonst leer bliebe. */
function emptyLineFor(data: HomeData): string {
  if (!data.nextExam || data.daysToNextExam === null) {
    return "Heute steht kein Lernblock an — es ist auch keine Prüfung eingetragen.";
  }

  if (data.daysToNextExam === 0) {
    return `Heute steht kein Lernblock an — ${data.nextExam.subject.name} ist heute.`;
  }

  return `Heute steht kein Lernblock an. Nächste Prüfung: ${
    data.nextExam.subject.name
  } ${formatCountdown(data.today, data.nextExam.date)}.`;
}

/**
 * Teilt die heute fälligen Aufgaben danach auf, ob ihr Fach heute überhaupt
 * stattfindet. Was zu einer Stunde gehört, erscheint in deren Zeile; der Rest
 * bleibt als Abendnotiz übrig — er ist bis zum nächsten Mal zu erledigen und
 * hat auf dem heutigen Tag keinen festen Platz.
 */
function splitHomework(lessons: Lesson[], tasks: Task[]) {
  const taught = new Set(lessons.map((lesson) => lesson.subjectId));
  const bySubject = new Map<string, Task[]>();
  const loose: Task[] = [];

  for (const task of tasks) {
    if (!taught.has(task.subjectId)) {
      loose.push(task);
      continue;
    }

    const list = bySubject.get(task.subjectId) ?? [];
    list.push(task);
    bySubject.set(task.subjectId, list);
  }

  return { bySubject, loose };
}

export function DayTimeline({ data }: { data: HomeData }) {
  // Der erste offene Block ist der hervorgehobene: er beantwortet die Frage
  // "womit fange ich an". Der Knopf daran führt in den Lernbereich.
  const highlighted = data.todayBlocks.find((block) => block.status === "open");

  const times = periodTimes(data.periods);

  const { bySubject, loose } = splitHomework(
    data.todayLessons,
    data.todayHomework,
  );

  // Ein Fach kann heute zweimal stattfinden. Die Abgabe gehört dann in die
  // erste Stunde — dort wird sie eingesammelt, danach ist sie erledigt.
  const noted = new Set<string>();
  const lessonRows: ReactNode[] = [];
  let previousTo: number | null = null;

  for (const block of mergeDoubleLessons(data.todayLessons)) {
    // Eine Freistunde nur zwischen zwei belegten Stunden: vor der ersten und
    // nach der letzten ist keine Freistunde, sondern schlicht kein Unterricht.
    if (previousTo !== null && block.from > previousTo + 1) {
      const from = previousTo + 1;
      const free = block.from - from;

      lessonRows.push(
        <Row
          key={`frei-${from}`}
          variant="free"
          dashed
          label={times.get(from)?.startsAt}
        >
          <p className="text-[13px] leading-snug text-subtle">
            {free === 1 ? "Freistunde" : `${free} Freistunden`}
          </p>
        </Row>,
      );
    }

    previousTo = block.to;

    const room = lessonRoom(block.lesson);
    // Nur was noch offen ist: eine abgehakte Aufgabe ist keine Abgabe mehr,
    // die in der Stunde ansteht. Sie taucht weiter unten als erledigte Zeile
    // auf, hier wäre sie eine Mahnung ohne Anlass.
    const due = noted.has(block.lesson.subjectId)
      ? []
      : (bySubject.get(block.lesson.subjectId) ?? []).filter(
          (task) => !task.done,
        );
    if (due.length > 0) noted.add(block.lesson.subjectId);

    // Der Entwurf schreibt in die Zweitzeile "Raum · Lehrkraft". Eine heute
    // fällige Abgabe verdrängt die Lehrkraft — sie ist die Nachricht des
    // Tages, der Name des Lehrers ist es nicht. Ist am Fach keine Lehrkraft
    // hinterlegt, steht dort die Stunde, die ohnehin dazugehört.
    const detail = (
      due.length > 0
        ? [room, `Abgabe: ${due.map((task) => task.title).join(", ")}`]
        : [
            room,
            block.lesson.subject.teacher ?? periodLabel(block.from, block.to),
          ]
    )
      .filter(Boolean)
      .join(" · ");

    const start = times.get(block.from)?.startsAt;

    lessonRows.push(
      <Row
        key={block.lesson.id}
        label={
          start ? (
            <LessonTime
              start={start}
              end={
                block.to > block.from
                  ? times.get(block.to)?.endsAt
                  : undefined
              }
            />
          ) : undefined
        }
      >
        <LessonEntry lesson={block.lesson} detail={detail} />
      </Row>,
    );
  }

  const empty =
    lessonRows.length === 0 &&
    data.todayBlocks.length === 0 &&
    loose.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="px-[22px] pt-[20px] pb-[12px]">
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
          {formatGerman(data.today, "lang")}
        </h2>
        <p className="mt-[2px] text-[14px] leading-snug text-muted">
          {dayLine(data)}
        </p>
      </header>

      <ol className="flex min-h-0 flex-1 flex-col gap-[6px] overflow-y-auto overscroll-y-contain px-[22px] pt-[4px] pb-[28px]">
        {lessonRows}

        {data.todayBlocks.map((block) => {
          const accent = block.id === highlighted?.id;

          return (
            <Row key={block.id} label={`${block.minutes} min`} accent={accent}>
              {accent ? (
                <LearnCard block={block} today={data.today} />
              ) : (
                <Entry block={block} />
              )}
            </Row>
          );
        })}

        {/* Was heute fällig ist, aber zu keiner heutigen Stunde gehört: eine
            schlichte Zeile ohne Karte, weil dafür keine Uhrzeit feststeht. */}
        {loose.map((task) => (
          <Row key={task.id} variant="note" label="fällig">
            <p
              className={cn(
                "text-[14px] leading-snug",
                task.done ? "text-subtle line-through" : "text-muted",
              )}
            >
              {task.title} · {task.subject.name}
            </p>
          </Row>
        ))}

        {empty ? (
          <Row>
            <p className="text-[14px] leading-snug text-muted">
              {emptyLineFor(data)}
            </p>
          </Row>
        ) : null}

        {/* Kein erfundener Unterricht: solange kein Plan eingetragen ist,
            steht hier der Weg dorthin. Gestrichelte Linie wie die Freistunde. */}
        {data.hasTimetable ? null : (
          <Row variant="free" dashed>
            <p className="text-[13px] leading-snug text-subtle">
              Hier stehen auch deine Schulstunden, sobald ein Stundenplan
              eingetragen ist.{" "}
              <Link
                href="/stundenplan"
                className="font-medium text-accent hover:underline"
              >
                Plan eintragen
              </Link>
            </p>
          </Row>
        )}
      </ol>
    </section>
  );
}
