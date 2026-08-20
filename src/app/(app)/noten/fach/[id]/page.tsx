import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { AverageBar } from "@/components/grades/average-bar";
import { SubjectGradeRow } from "@/components/grades/grade-row";
import {
  GRADE_TARGETS,
  TargetSentence,
  nextWholeTarget,
  toGradeEntries,
} from "@/components/grades/target-sentence";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { GradeKind } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import { formatAverage, neededForTarget } from "@/lib/grade-scale";
import { gradesBySubject } from "@/lib/grades";

/**
 * Ein Fach mit allen seinen Noten — und der Frage, was noch geht.
 *
 * Der Entwurf zeigt diese Seite nicht; er zeigt nur Schnitte je Fach. Die
 * Liste der einzelnen Noten braucht es trotzdem, sonst ließe sich eine Note
 * nie wieder ändern. Aufgebaut ist sie wie die anderen Detailseiten: Weg
 * zurück, Kopf mit den Zahlen, darunter die Liste.
 *
 * Der Zielrechner kommt ohne eine Zeile Client-Code aus. Ziel und Art stehen
 * in der Adresse (?ziel=2&art=schriftlich), jede Wahl ist ein Link, und der
 * Server rechnet neu — dieselbe Antwort ist damit auch verschickbar und
 * lesbar, ohne dass irgendwo ein Zustand mitgeführt werden muss.
 */

export const metadata: Metadata = {
  title: "Noten",
};

/** Die Wahlmöglichkeiten im Zielrechner sehen aus wie Chips und sind Links. */
const CHIP =
  "inline-flex min-h-11 items-center rounded-pill border px-3.5 font-mono text-[14px] tabular-nums transition-colors";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Ein Parameter kann mehrfach in der Adresse stehen; dann zählt der erste.
 * Alles Unbekannte fällt still auf die Vorgabe zurück — eine Adresszeile ist
 * kein Formular, sie bekommt keine Fehlermeldung.
 */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readTarget(
  raw: string | string[] | undefined,
  average: number | null,
): number {
  const value = Number(firstValue(raw));

  return GRADE_TARGETS.includes(value) ? value : nextWholeTarget(average);
}

function readKind(raw: string | string[] | undefined): GradeKind {
  return firstValue(raw) === "muendlich" ? "muendlich" : "schriftlich";
}

export default async function SubjectGradesPage({
  params,
  searchParams,
}: PageProps<"/noten/fach/[id]">) {
  const user = await requireUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);

  // Dieselbe Abfrage wie die Übersicht: Fach, Noten und beide Töpfe kommen
  // fertig gerechnet aus @/lib/grades, damit hier und dort dieselbe Zahl
  // steht. Ein abgewähltes Fach ohne eine einzige Note ist nicht dabei — es
  // hätte auf einer Notenseite auch nichts zu zeigen.
  const bySubject = await gradesBySubject(user.id);
  const entry = bySubject.find((item) => item.subject.id === id);
  if (!entry) {
    notFound();
  }

  const { subject, grades, average, written, oral } = entry;
  const color = subjectColor(subject.color);

  const writtenShare = Math.min(100, Math.max(0, subject.weightWritten));
  const oralShare = 100 - writtenShare;

  const target = readTarget(query.ziel, average);
  const kind = readKind(query.art);
  const outcome = neededForTarget({
    entries: toGradeEntries(grades),
    weightWritten: subject.weightWritten,
    target,
    // Das Gewicht ist nicht wählbar: eine Frage nach dem Ziel hat schon zwei
    // Stellschrauben, und die dritte beantwortet niemand ehrlich im Voraus.
    next: { kind, weight: 1 },
  });

  /** Die Adresse dieser Seite mit anderer Wahl — beide Werte bleiben stehen. */
  const linkTo = (nextTarget: number, nextKind: GradeKind) =>
    `/noten/fach/${subject.id}?ziel=${nextTarget}&art=${nextKind}`;

  return (
    <div className="space-y-6 md:max-w-3xl">
      <Link
        href="/noten"
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
        Alle Fächer
      </Link>

      <header
        style={
          {
            "--subject": color.hex,
            backgroundColor:
              "color-mix(in oklab, var(--subject) 7%, var(--surface))",
            borderColor:
              "color-mix(in oklab, var(--subject) 30%, var(--border))",
          } as CSSProperties
        }
        className="rounded-card border p-5 sm:p-6"
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full bg-[var(--subject)]"
          />
          <h1 className="min-w-0 truncate font-semibold text-foreground">
            {subject.name}
          </h1>
          {subject.archived ? (
            <span className="shrink-0 rounded-pill bg-surface-muted px-2 py-0.5 text-xs text-muted">
              abgewählt
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <p className="text-[13px] text-muted">Schnitt</p>
            <p className="mt-1 text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">
              {average === null ? "—" : formatAverage(average)}
            </p>
          </div>

          <dl className="flex gap-6">
            <Pot label="Schriftlich" average={written} />
            <Pot label="Mündlich" average={oral} />
          </dl>
        </div>

        {average !== null ? (
          <AverageBar average={average} color={color.hex} className="mt-4" />
        ) : null}

        <p className="mt-3 text-[13px] text-muted">
          {`schriftlich zählt ${writtenShare}\u00a0%, mündlich ${oralShare}\u00a0%`}
        </p>

        {/* Ein leerer Topf zählt nicht als 0 und nicht als 4, sondern gar
            nicht — dann ist der Fachschnitt der Schnitt des anderen Topfes.
            Das gehört dazugesagt, sonst sieht die Gewichtung oben nach einer
            Rechnung aus, die gar nicht stattgefunden hat. */}
        {grades.length > 0 && written === null && writtenShare > 0 ? (
          <p className="mt-1 text-[13px] text-muted">
            Schriftlich zählt noch nicht mit — es gibt noch keine schriftliche
            Note.
          </p>
        ) : null}
        {grades.length > 0 && oral === null && oralShare > 0 ? (
          <p className="mt-1 text-[13px] text-muted">
            Mündlich zählt noch nicht mit — es gibt noch keine mündliche Note.
          </p>
        ) : null}
      </header>

      <section className="rounded-card border border-border bg-surface p-[18px]">
        <h2 className="text-[15px] font-semibold text-foreground">
          Was brauche ich noch?
        </h2>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">Ziel</span>
          {GRADE_TARGETS.map((value) => {
            const chosen = value === target;

            return (
              <Link
                key={value}
                href={linkTo(value, kind)}
                aria-current={chosen ? "true" : undefined}
                className={cn(
                  CHIP,
                  chosen
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-border text-muted hover:bg-surface-muted hover:text-foreground",
                )}
              >
                {formatAverage(value, 1)}
              </Link>
            );
          })}
        </div>

        {/* Die Antwort hängt an der Art: dasselbe Ziel braucht schriftlich
            eine andere Note als mündlich, sobald die beiden Töpfe verschieden
            schwer wiegen. Ein Link schaltet um, mehr braucht es nicht. */}
        <p className="mt-3">
          <Link
            href={linkTo(
              target,
              kind === "schriftlich" ? "muendlich" : "schriftlich",
            )}
            className="inline-flex min-h-11 items-center text-[14px] font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {kind === "schriftlich"
              ? "Stattdessen mit einer mündlichen Note rechnen"
              : "Stattdessen mit einer schriftlichen Note rechnen"}
          </Link>
        </p>

        <p className="mt-3 rounded-card bg-accent-soft p-3.5 text-[14px] leading-normal text-foreground">
          <TargetSentence target={target} kind={kind} outcome={outcome} />
        </p>
      </section>

      {grades.length === 0 ? (
        <EmptyState
          title="Noch keine Note"
          description={`In ${subject.name} steht noch nichts. Die erste Note macht aus der Gewichtung oben einen Schnitt.`}
          action={
            <ButtonLink href={`/noten/neu?fach=${subject.id}`}>
              Note eintragen
            </ButtonLink>
          }
        />
      ) : (
        <>
          {/* Die jüngste zuerst — so kommt die Liste aus @/lib/grades. */}
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {grades.map((grade) => (
              <SubjectGradeRow key={grade.id} grade={grade} />
            ))}
          </ul>

          <ButtonLink
            href={`/noten/neu?fach=${subject.id}`}
            size="lg"
            className="w-full sm:w-auto"
          >
            + Note in diesem Fach
          </ButtonLink>
        </>
      )}
    </div>
  );
}

/**
 * Einer der beiden Töpfe im Kopf. Ohne Note steht dort ein Strich: ein
 * fehlender Topf hat keinen schlechten Schnitt, er hat gar keinen.
 */
function Pot({ label, average }: { label: string; average: number | null }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-mono text-[17px] tabular-nums",
          average === null ? "text-subtle" : "text-foreground",
        )}
      >
        {average === null ? "—" : formatAverage(average)}
      </dd>
    </div>
  );
}
