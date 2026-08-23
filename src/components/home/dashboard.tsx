import Link from "next/link";
import type { CSSProperties } from "react";

import { setBlockStatusAction } from "@/app/(app)/lernen/actions";
import { AverageBar } from "@/components/grades/average-bar";
import { HomeworkCheck } from "@/components/homework/homework-check";
import { ButtonLink } from "@/components/ui/button";
import { subjectColor } from "@/lib/colors";
import { formatGerman } from "@/lib/dates";
import { dueLabel, dueTone, type DueTone } from "@/lib/due-label";
import { formatAverage } from "@/lib/grade-scale";
import {
  countedGrades,
  lessonRoom,
  planProgress,
  type HomeData,
} from "@/lib/home";
import { mergeDoubleLessons, periodTimes } from "@/lib/timetable";

/**
 * Die Startansicht am großen Bildschirm: alles auf einen Blick, in Karten
 * nebeneinander, ohne Scrollen. Am Handy übernimmt das Kachelmenü — dort wird
 * diese Ansicht von der Startseite ausgeblendet.
 *
 * Alle Zahlen kommen aus @/lib/home, und gezeigt wird nur, was dort auch
 * steht: keine erfundene Schulstunde, solange kein Stundenplan eingetragen
 * ist, und neben dem Notenschnitt keine Bewegung — die App hebt keinen alten
 * Stand auf, gegen den sie rechnen könnte.
 */

type Block = HomeData["todayBlocks"][number];
type Lesson = HomeData["todayLessons"][number];
type Task = HomeData["openHomework"][number];
type Exam = NonNullable<HomeData["nextExam"]>;
type SubjectAverage = HomeData["grades"]["perSubject"][number];
type Sheet = HomeData["materials"][number];

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

/**
 * So viele Fächer passen unter den Schnitt, ohne dass die Spalte wächst — so
 * viele zeigt auch der Entwurf. Der Rest steht auf der Notenseite.
 */
const SUBJECT_AVERAGE_LIMIT = 5;

/**
 * So viele Blätter passen in die dritte Spalte, ohne sie über den Bildschirm
 * zu schieben — dort stehen schon die Fächer und der Schnitt. Die Ablage
 * selbst ist einen Klick entfernt.
 */
const MATERIAL_LIMIT = 3;

/**
 * Das Vorschaubild in der Karte: hochkant, so wie ein Blatt liegt, und
 * kleiner als in der Ablage — hier steht es neben zwei Zeilen Text und nicht
 * in einer Liste, die nur aus Blättern besteht. Die Maße stehen am `<img>` und
 * noch einmal als Klasse: sie halten den Platz frei, bevor das Bild da ist,
 * sonst rutscht die ganze Spalte beim Laden.
 */
const COVER_WIDTH = 36;
const COVER_HEIGHT = 48;

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
          <MaterialCard sheets={data.materials} waiting={data.openProposals} />
          <AverageCard grades={data.grades} />
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
 * Die zuletzt aufgenommenen Blätter — und zwar wirklich die zuletzt
 * aufgenommenen: @/lib/home sortiert diese Liste nach dem Zeitpunkt der
 * Aufnahme und nicht nach dem Schultag, von dem ein Blatt stammt.
 *
 * Am Handy liegt die Kamera eine Wischgeste neben dem Kachelmenü; am großen
 * Bildschirm gibt es diese Geste nicht, und ohne diese Karte wäre die Ablage
 * dort allein über die Seitenspalte zu finden. Aufgenommen wird hier trotzdem
 * nichts — dafür braucht es eine Kamera, und die steckt im Handy.
 *
 * Vorne steht das Vorschaubild, wie in der Ablage selbst: ein abfotografiertes
 * Blatt erkennt man am Bild wieder und nicht am Titel, denn „Blatt vom 21.8.“
 * heißen sie am Anfang alle.
 *
 * Wie viele Blätter insgesamt in der Ablage liegen, steht hier bewusst nicht:
 * die Startseite lädt nur die letzten paar, sie kennt die Gesamtzahl gar nicht.
 * Eine Zahl, die niemand gezählt hat, gehört nicht auf den Bildschirm.
 *
 * **Der Eingangskorb steht in dieser Karte und bekommt keine eigene.** Was
 * dort liegt, ist ein Vorschlag zu einem Blatt — dieselbe Sache, einen Schritt
 * weiter. Und er steht nur da, wenn wirklich etwas wartet: eine Zeile „0
 * Vorschläge“ wäre eine tägliche Meldung darüber, dass nichts passiert ist.
 *
 * Verlinkt und nicht entschieden: von hier führt ein Weg in den Korb, und
 * dort steht das Blatt daneben und das Formular darunter. Ein „Übernehmen“ auf
 * der Startseite wäre genau die Abkürzung, die es nicht geben soll.
 */
function MaterialCard({
  sheets,
  waiting,
}: {
  sheets: Sheet[];
  waiting: number;
}) {
  const shown = sheets.slice(0, MATERIAL_LIMIT);

  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">Material</h3>
        {shown.length > 0 ? (
          <Link
            href="/material"
            className="shrink-0 text-[13px] text-muted transition-colors hover:text-foreground"
          >
            Alle
          </Link>
        ) : null}
      </div>

      {waiting > 0 ? (
        <Link
          href="/eingang"
          className="mt-3 flex items-center justify-between gap-2 rounded-control bg-accent-soft px-3 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-border"
        >
          <span className="truncate">
            {waiting === 1
              ? "Ein Vorschlag im Eingangskorb"
              : `${waiting} Vorschläge im Eingangskorb`}
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}

      {shown.length === 0 ? (
        <>
          <p className="mt-3 text-[14px] text-muted">
            Noch kein Blatt aufgenommen. Fotografiert wird am Handy, auf der
            Kamera-Seite neben den Kacheln.
          </p>
          <Link
            href="/material"
            className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline"
          >
            Zur Ablage
          </Link>
        </>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {shown.map((sheet) => (
            <MaterialRow key={sheet.id} sheet={sheet} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Eine Zeile der Material-Karte. Das Datum bleibt weg — es steckt bei den
 * meisten Blättern schon im Titel, und es wäre hier auch das falsche: die
 * Liste folgt dem Zeitpunkt der Aufnahme, `capturedOn` ist dagegen der
 * Schultag. Ein Datum, das nicht der Reihenfolge folgt, in der es steht,
 * liest sich als Widerspruch — ohne Datum sagt die Reihenfolge schlicht, dass
 * oben das zuletzt aufgenommene Blatt steht.
 */
function MaterialRow({ sheet }: { sheet: Sheet }) {
  const color = subjectColor(sheet.subject.color);

  return (
    <li>
      <Link
        href={`/material/${sheet.id}`}
        className="-mx-2 flex items-center gap-2.5 rounded-control px-2 py-1 transition-colors hover:bg-surface-muted"
      >
        {sheet.coverPageId ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/image fragt ohne Session-Cookie an und legt das Blatt in einen öffentlichen Cache
          <img
            src={`/api/material/${sheet.coverPageId}/vorschau`}
            /* Der Titel steht direkt daneben — das Bild noch einmal zu
               beschreiben, hieße jede Zeile doppelt vorzulesen. */
            alt=""
            width={COVER_WIDTH}
            height={COVER_HEIGHT}
            loading="lazy"
            decoding="async"
            className="h-12 w-9 shrink-0 rounded-control border border-border bg-surface-muted object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="h-12 w-9 shrink-0 rounded-control border border-dashed border-border bg-surface-muted"
          />
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-foreground">
            {sheet.title}
          </span>

          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
            <span
              aria-hidden="true"
              style={{ backgroundColor: color.hex }}
              className="size-2 shrink-0 rounded-full"
            />
            <span className="min-w-0 truncate">{sheet.subject.name}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Der Notenschnitt: die große Zahl, darunter die Fächer mit ihrem Schnitt und
 * einem Balken in der Fachfarbe. Die ganze Karte führt auf die Notenseite.
 *
 * Ohne Note steht dort keine Zahl, sondern ein Satz und der Weg dorthin —
 * dieselbe Antwort, die auch die Countdown-Karte ohne Prüfung gibt.
 */
function AverageCard({ grades }: { grades: HomeData["grades"] }) {
  const overall = grades.overall;

  if (overall === null) {
    return (
      <section className={CARD}>
        <h3 className="text-[15px] font-semibold text-foreground">Schnitt</h3>
        <p className="mt-2 text-[15px] text-foreground">
          Noch keine Note eingetragen.
        </p>
        <p className="mt-1 text-[13px] text-muted">
          Sobald eine drinsteht, stehen hier der Gesamtschnitt und der Schnitt
          jedes Fachs.
        </p>
        <Link
          href="/noten"
          className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline"
        >
          Note eintragen
        </Link>
      </section>
    );
  }

  const shown = grades.perSubject.slice(0, SUBJECT_AVERAGE_LIMIT);
  const count = countedGrades(grades);

  return (
    <Link href="/noten" className={CARD_LINK}>
      <h3 className="text-[15px] font-semibold text-foreground">Schnitt</h3>

      <p className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">
          {formatAverage(overall, 1)}
        </span>
        {/* Hier steht im Entwurf „+0,2 seit Juli“ in Grün. Einen Stand von
            Juli hebt die App nicht auf, sie kennt also keine Bewegung — statt
            einer erfundenen steht hier die wahre Angabe, worauf der Schnitt
            überhaupt beruht. */}
        <span className="text-[13px] text-muted">
          {count === 1 ? "aus 1 Note" : `aus ${count} Noten`}
        </span>
      </p>

      <ul className="mt-4 space-y-3">
        {shown.map((entry) => (
          <SubjectBar key={entry.subject.id} entry={entry} />
        ))}
      </ul>

      {grades.perSubject.length > shown.length ? (
        <p className="mt-2.5 text-[13px] text-subtle">
          und {grades.perSubject.length - shown.length} weitere
        </p>
      ) : null}
    </Link>
  );
}

/**
 * Ein Fach in der Schnitt-Karte: Name links, Schnitt rechts, darunter der
 * Balken. Eine Nachkommastelle wie bei der großen Zahl darüber — die zweite
 * Stelle entscheidet auf einen Blick nichts und steht auf der Notenseite.
 */
function SubjectBar({ entry }: { entry: SubjectAverage }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="min-w-0 truncate text-foreground">
          {entry.subject.name}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-muted">
          {formatAverage(entry.average, 1)}
        </span>
      </div>

      {/* Derselbe Balken wie auf der Notenseite — samt der Regel, wie voll er
          steht. Sie stünde sonst zweimal im Projekt und könnte auseinander-
          laufen. */}
      <AverageBar
        average={entry.average}
        color={subjectColor(entry.subject.color).hex}
        className="mt-[5px]"
      />
    </li>
  );
}
