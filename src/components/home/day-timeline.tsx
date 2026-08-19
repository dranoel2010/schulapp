import type { CSSProperties, ReactNode } from "react";

import { ButtonLink } from "@/components/ui/button";
import { subjectColor } from "@/lib/colors";
import { formatCountdown, formatGerman } from "@/lib/dates";
import type { HomeData } from "@/lib/home";

/**
 * Die Kalenderseite des Kachelmenüs: der heutige Tag als senkrechte Spur.
 *
 * Links eine schmale Spalte, rechts an einer durchgehenden Linie die Einträge.
 * Die Maße stammen aus dem Entwurf und sind auf ein 390px breites Gerät
 * gerechnet, deshalb stehen hier feste Pixelwerte, wo es kein Token gibt.
 * Die Seite trägt ihre Ränder selbst (Kopf 20/22/12, Spur 4/22/28) — sie steckt
 * am Handy in der Wischhülle, die keinen eigenen Rand setzt.
 *
 * Ehrlichkeit vor Vollständigkeit: der Entwurf zeigt in der Spur auch
 * Schulstunden mit Uhrzeit, Raum und Lehrername. Den Stundenplan gibt es noch
 * nicht, also steht dort nichts Erfundenes, sondern am Ende der Spur ein
 * ruhiger Hinweis. Und weil unsere Lernblöcke keine Uhrzeit haben, sondern nur
 * eine Dauer, steht in der linken Spalte die Dauer — gleiche Schrift, gleiche
 * Größe, gleiche Farbe wie die Uhrzeiten im Entwurf.
 *
 * Die Spur scrollt für sich (overflow-y-auto). Dafür muss die Flex-Kette von
 * der Hülle bis hierher durchgehen, sonst wächst stattdessen die ganze Seite.
 */

type Block = HomeData["todayBlocks"][number];

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
 * Eine Zeile der Spur: zwei Spalten, links die Dauer, rechts der Eintrag an
 * der senkrechten Linie. Die Akzentvariante färbt Spalte und Linie, die
 * gestrichelte Variante gehört dem Hinweis am Ende.
 */
function Row({
  label,
  accent = false,
  dashed = false,
  children,
}: {
  /** Linke Spalte; leer bei Zeilen, die keine Dauer haben */
  label?: string;
  accent?: boolean;
  dashed?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[50px_1fr] gap-[12px]">
      <span
        className={cn(
          "pt-[14px] font-mono text-[13px] leading-none",
          accent ? "font-medium text-accent" : "text-subtle",
        )}
      >
        {label}
      </span>

      <div
        className={cn(
          "border-l-2 py-[10px] pl-[14px]",
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

      <ButtonLink
        href={`/klausuren/${block.examId}`}
        className="mt-[12px] w-full"
      >
        Öffnen
      </ButtonLink>
    </div>
  );
}

/** Eine Zeile unter dem Datum — nur Zahlen, die wirklich in den Daten stehen. */
function summaryFor(data: HomeData): string {
  if (data.todayBlocks.length === 0) return "heute nichts im Lernplan";

  const parts = [
    data.todayBlocks.length === 1
      ? "1 Lernblock"
      : `${data.todayBlocks.length} Lernblöcke`,
  ];

  if (data.todayOpenMinutes > 0) {
    parts.push(`${data.todayOpenMinutes} Minuten offen`);
  } else {
    parts.push("alles geschafft");
  }

  return parts.join(" · ");
}

/** Der ruhige Satz für einen Tag ohne Lernblock. */
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

export function DayTimeline({ data }: { data: HomeData }) {
  // Der erste offene Block ist der hervorgehobene — dieselbe Regel wie beim
  // "Lernen"-Ziel im Kachelmenü, damit beide Seiten auf dasselbe zeigen.
  const highlighted = data.todayBlocks.find((block) => block.status === "open");

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="px-[22px] pt-[20px] pb-[12px]">
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
          {formatGerman(data.today, "lang")}
        </h2>
        <p className="mt-[2px] text-[14px] leading-snug text-muted">
          {summaryFor(data)}
        </p>
      </header>

      <ol className="flex min-h-0 flex-1 flex-col gap-[6px] overflow-y-auto overscroll-y-contain px-[22px] pt-[4px] pb-[28px]">
        {data.todayBlocks.length === 0 ? (
          <Row>
            <p className="text-[14px] leading-snug text-muted">
              {emptyLineFor(data)}
            </p>
          </Row>
        ) : (
          data.todayBlocks.map((block) => {
            const accent = block.id === highlighted?.id;

            return (
              <Row
                key={block.id}
                label={`${block.minutes} min`}
                accent={accent}
              >
                {accent ? (
                  <LearnCard block={block} today={data.today} />
                ) : (
                  <Entry block={block} />
                )}
              </Row>
            );
          })
        )}

        {/* Kein erfundener Unterricht: nur der Hinweis, dass hier später mehr
            steht. Gestrichelte Linie wie die Freistunde im Entwurf. */}
        <Row dashed>
          <p className="text-[13px] leading-snug text-subtle">
            Hier stehen später auch deine Schulstunden — den Stundenplan gibt es
            noch nicht.
          </p>
        </Row>
      </ol>
    </section>
  );
}
