import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { AverageBar } from "@/components/grades/average-bar";
import { RecentGradeRow } from "@/components/grades/grade-row";
import {
  TargetSentence,
  nextWholeTarget,
  toGradeEntries,
} from "@/components/grades/target-sentence";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { subjectColor } from "@/lib/colors";
import {
  formatAverage,
  neededForTarget,
  overallAverage,
  type TargetOutcome,
} from "@/lib/grade-scale";
import {
  gradesBySubject,
  type GradeItem,
  type SubjectGrades,
} from "@/lib/grades";

/**
 * Die Notenübersicht: der Schnitt und wie er zustande kommt.
 *
 * Eine Seite, zwei Anordnungen — am Handy die Liste aus Entwurf 1g, ab md die
 * Tabelle aus Entwurf 1e. Beide zeigen dieselben Zahlen aus derselben Abfrage;
 * umgeschaltet wird über CSS, wie überall in dieser App.
 *
 * Der Entwurf zeigt neben dem Schnitt einen Trend („▲ 0,2 seit Juli“). Den
 * gibt es nicht: die App hebt keinen Stand von Juli auf, gegen den sie rechnen
 * könnte. An seiner Stelle steht deshalb eine wahre Angabe — worauf der
 * Schnitt überhaupt beruht.
 *
 * Angetippt wird hier nichts bearbeitet: eine Fachzeile führt zu allen Noten
 * des Fachs, eine Zeile unter „Zuletzt eingetragen“ zu der einen Note.
 */

export const metadata: Metadata = {
  title: "Noten",
};

/** So viele Noten passen unter „Zuletzt eingetragen“ — so viele wie im Entwurf. */
const RECENT_LIMIT = 4;

/** Das Raster der Tabelle. Kopf und Zeilen müssen dieselben Spalten haben. */
const TABLE_COLUMNS = "grid grid-cols-[1fr_78px_78px_90px] gap-2.5";

/** Das Maß aus dem Entwurf: 18px Polster, eine Haarlinie, keine Schatten. */
const CARD = "rounded-card border border-border bg-surface p-[18px]";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Ein Fach mit Schnitt — nur solche zählen und nur solche werden verglichen. */
type GradedSubject = SubjectGrades & { average: number };

function hasAverage(entry: SubjectGrades): entry is GradedSubject {
  return entry.average !== null;
}

/**
 * Die jüngsten Noten über alle Fächer hinweg.
 *
 * Jede Fachliste kommt schon sortiert aus @/lib/grades; zusammengeworfen
 * müssen sie noch einmal geordnet werden. Die Regel ist dieselbe wie dort:
 * jüngerer Tag zuerst, bei gleichem Tag das später Erfasste.
 */
function recentGrades(bySubject: SubjectGrades[], limit: number): GradeItem[] {
  return bySubject
    .flatMap((entry) => entry.grades)
    .sort((a, b) =>
      a.date === b.date
        ? b.createdAt.getTime() - a.createdAt.getTime()
        : a.date < b.date
          ? 1
          : -1,
    )
    .slice(0, limit);
}

export default async function GradesPage() {
  const user = await requireUser();
  const bySubject = await gradesBySubject(user.id);

  // Archivierte Fächer zählen nicht in den Schnitt — ein abgewähltes Fach soll
  // ihn weder drücken noch heben. Ihre Noten bleiben trotzdem zu sehen: unten
  // im zugeklappten Kasten und, weil sie eingetragen wurden, auch unter
  // „Zuletzt eingetragen“.
  const active = bySubject.filter((entry) => !entry.subject.archived);
  const archived = bySubject.filter((entry) => entry.subject.archived);

  const graded = active.filter(hasAverage);
  const overall = overallAverage(graded.map((entry) => entry.average));

  // Neben dem Schnitt steht, worauf er beruht: die Noten der Fächer, die in
  // ihn eingegangen sind. Alle Noten zu zählen verspräche eine Rechnung, die
  // die Noten der abgewählten Fächer gar nicht kennt.
  const countedGrades = graded.reduce(
    (sum, entry) => sum + entry.grades.length,
    0,
  );
  const totalGrades = bySubject.reduce(
    (sum, entry) => sum + entry.grades.length,
    0,
  );

  // Das schlechteste Fach: dort lohnt die Frage nach dem Ziel. Bei Gleichstand
  // bleibt das erste stehen, damit die Auswahl zwischen zwei Aufrufen nicht
  // springt. Bei nur einem Fach mit Noten wäre „das schlechteste“ keine
  // Aussage — dann wird auch nichts hervorgehoben.
  const worst = graded.reduce<GradedSubject | null>(
    (current, entry) =>
      current === null || entry.average > current.average ? entry : current,
    null,
  );
  const worstId = graded.length > 1 && worst ? worst.subject.id : null;

  const target = worst ? nextWholeTarget(worst.average) : null;
  const outcome: TargetOutcome | null =
    worst && target !== null
      ? neededForTarget({
          entries: toGradeEntries(worst.grades),
          weightWritten: worst.subject.weightWritten,
          target,
          // Die Annahme, die im Satz steht: die nächste Note ist schriftlich
          // und zählt einfach. Ohne feste Annahme wäre die Auskunft nicht
          // nachzurechnen.
          next: { kind: "schriftlich", weight: 1 },
        })
      : null;

  const goal =
    worst && target !== null && outcome ? (
      <TargetSentence
        subjectName={worst.subject.name}
        target={target}
        kind="schriftlich"
        outcome={outcome}
      />
    ) : null;

  const recent = recentGrades(bySubject, RECENT_LIMIT);

  return (
    <div className="space-y-6 md:max-w-4xl">
      <header className="md:space-y-1">
        {/* Am Handy trägt die Kopfzeile der App den Namen des Bereichs, und
            der Entwurf beginnt dort sofort mit dem Schnitt. Die Überschrift
            bleibt trotzdem im Dokument — für Vorleseprogramme. */}
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-foreground max-md:sr-only">
          Noten
        </h1>

        {countedGrades > 0 ? (
          <div className="md:hidden">
            <p className="text-[13px] text-muted">Schnitt</p>
            <p className="flex items-end justify-between gap-3">
              <span className="text-[60px] font-semibold leading-[0.9] tracking-[-0.04em] tabular-nums text-foreground">
                {overall === null ? "—" : formatAverage(overall, 1)}
              </span>
              <span className="pb-2 text-[13px] text-muted">
                {countedGrades === 1
                  ? "aus 1 Note"
                  : `aus ${countedGrades} Noten`}
              </span>
            </p>
          </div>
        ) : null}

        <p className="hidden text-[14px] text-muted md:block">
          {overall === null
            ? "Noch kein Schnitt — sobald eine Note drinsteht, steht er hier."
            : `Schnitt ${formatAverage(overall, 1)} · schriftlich und mündlich gewichtet`}
        </p>
      </header>

      {bySubject.length === 0 ? (
        <EmptyState
          title="Zuerst die Fächer"
          description="Jede Note gehört zu einem Fach, und wie schriftlich und mündlich zählen, steht am Fach. Sobald deine Fächer stehen, kannst du Noten eintragen."
          action={<ButtonLink href="/faecher">Zu den Fächern</ButtonLink>}
        />
      ) : (
        <>
          {totalGrades === 0 ? (
            <EmptyState
              title="Noch keine Note"
              description="Trag deine erste Note ein — den Schnitt je Fach und insgesamt rechnet die App daraus selbst."
              action={<ButtonLink href="/noten/neu">Note eintragen</ButtonLink>}
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
                  <path d="M4 19.5h16" />
                  <path d="M7.25 16.5V8" />
                  <path d="M12 16.5V4.5" />
                  <path d="M16.75 16.5v-5.5" />
                </svg>
              }
            />
          ) : null}

          {/* Am Handy: die Liste aus Entwurf 1g. */}
          <div className="space-y-4 md:hidden">
            <SubjectRows items={active} worstId={worstId} />

            {goal ? (
              <p className="rounded-card bg-accent-soft p-3.5 text-[14px] leading-normal text-foreground">
                {goal}
              </p>
            ) : null}

            {archived.length > 0 ? (
              <ArchivedDetails count={archived.length}>
                <SubjectRows
                  items={archived}
                  worstId={null}
                  className="opacity-60"
                />
              </ArchivedDetails>
            ) : null}

            {/* Der Akzentknopf steht unten und über die ganze Breite: am Handy
                liegt er dort, wo der Daumen ohnehin ist. Ohne eine einzige
                Note führt schon der leere Zustand dorthin. */}
            {totalGrades > 0 ? (
              <ButtonLink href="/noten/neu" size="lg" className="w-full">
                + Note
              </ButtonLink>
            ) : null}
          </div>

          {/* Ab md: die Tabelle aus Entwurf 1e, rechts daneben Ziel und
              Zuletzt-Spalte. */}
          <div className="hidden space-y-4 md:block">
            <div className="grid grid-cols-[1.4fr_1fr] gap-4">
              <SubjectTable items={active} worstId={worstId} />

              <div className="flex flex-col gap-4">
                {goal ? (
                  <p className="rounded-card bg-accent-soft p-[18px] text-[15px] leading-normal text-foreground">
                    {goal}
                  </p>
                ) : null}

                {recent.length > 0 ? <RecentCard grades={recent} /> : null}
              </div>
            </div>

            {archived.length > 0 ? (
              <ArchivedDetails count={archived.length}>
                <SubjectTable
                  items={archived}
                  worstId={null}
                  className="opacity-60"
                />
              </ArchivedDetails>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Am Handy je Fach eine Zeile: farbiger Strich, Name, rechts der Schnitt.
 *
 * Der Entwurf setzt 30px hohe Zeilen mit 14px Abstand; hier sind es 44px hohe
 * Zeilen fast ohne Abstand. Das ist derselbe Rhythmus, aber ein Ziel, das man
 * mit dem Daumen trifft.
 *
 * Fächer ohne Note stehen mit einem Strich in der Liste und bleiben antippbar
 * — genau dort trägt man ja die erste Note ein.
 */
function SubjectRows({
  items,
  worstId,
  className,
}: {
  items: SubjectGrades[];
  worstId: string | null;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-0.5", className)}>
      {items.map((entry) => {
        const color = subjectColor(entry.subject.color);

        return (
          <li key={entry.subject.id}>
            <Link
              href={`/noten/fach/${entry.subject.id}`}
              style={{ "--subject": color.hex } as CSSProperties}
              className="-mx-2 flex min-h-11 items-center gap-3 rounded-control px-2 transition-colors hover:bg-surface-muted"
            >
              <span
                aria-hidden="true"
                className="h-[30px] w-1 shrink-0 rounded-[2px] bg-[var(--subject)]"
              />

              <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">
                {entry.subject.name}
              </span>

              <span
                className={cn(
                  "shrink-0 font-mono text-[17px] tabular-nums",
                  entry.average === null
                    ? "text-subtle"
                    : entry.subject.id === worstId
                      ? "text-warning"
                      : "text-foreground",
                )}
              >
                {entry.average === null ? "—" : formatAverage(entry.average)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Ab md dieselben Fächer als Tabelle: Fach, schriftlich, mündlich, Schnitt.
 *
 * Die beiden Töpfe stehen einzeln daneben, weil erst sie den Schnitt erklären
 * — eine 1,7 aus lauter mündlichen Noten ist etwas anderes als eine 1,7 aus
 * Klausuren. Der Schnitt steht mit zwei Nachkommastellen da: mit derselben
 * Zahl rechnet auch der Zielsatz, und beide dürfen sich nicht widersprechen.
 */
function SubjectTable({
  items,
  worstId,
  className,
}: {
  items: SubjectGrades[];
  worstId: string | null;
  className?: string;
}) {
  return (
    <div className={cn(CARD, className)}>
      <div
        className={cn(
          TABLE_COLUMNS,
          // Dieselben Ränder wie die Zeilen darunter, damit die Linien auf
          // einer Flucht liegen.
          "-mx-2 border-b border-border px-2 pb-2.5 text-[11px] uppercase tracking-[0.06em] text-subtle",
        )}
      >
        <span>Fach</span>
        <span>Schriftl.</span>
        <span>Mündl.</span>
        <span>Schnitt</span>
      </div>

      {items.map((entry) => {
        const color = subjectColor(entry.subject.color);
        const worst = entry.subject.id === worstId;

        return (
          <Link
            key={entry.subject.id}
            href={`/noten/fach/${entry.subject.id}`}
            style={{ "--subject": color.hex } as CSSProperties}
            className={cn(
              TABLE_COLUMNS,
              "-mx-2 items-center rounded-control border-b border-border px-2 py-3 text-[14px] transition-colors last:border-b-0 hover:bg-surface-muted",
            )}
          >
            <span className="flex min-w-0 items-center gap-2 text-foreground">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[3px] bg-[var(--subject)]"
              />
              <span className="truncate">{entry.subject.name}</span>
            </span>

            <PotValue average={entry.written} />
            <PotValue average={entry.oral} />

            <span>
              <span
                className={cn(
                  "block font-mono text-[16px] tabular-nums",
                  entry.average === null
                    ? "text-subtle"
                    : worst
                      ? "text-warning"
                      : "text-foreground",
                )}
              >
                {entry.average === null ? "—" : formatAverage(entry.average)}
              </span>

              {entry.average !== null ? (
                <AverageBar
                  average={entry.average}
                  color={color.hex}
                  className="mt-1.5 w-[70px]"
                />
              ) : null}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Ein leerer Topf ist keine 4 und keine 0 — dort steht ein Strich. */
function PotValue({ average }: { average: number | null }) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        average === null ? "text-subtle" : "text-muted",
      )}
    >
      {average === null ? "—" : formatAverage(average)}
    </span>
  );
}

/** Die vier jüngsten Noten und der Weg zur nächsten. */
function RecentCard({ grades }: { grades: GradeItem[] }) {
  return (
    <section className={cn(CARD, "flex flex-1 flex-col")}>
      <h2 className="text-[15px] font-semibold text-foreground">
        Zuletzt eingetragen
      </h2>

      <ul className="mt-1.5">
        {grades.map((grade) => (
          <RecentGradeRow key={grade.id} grade={grade} />
        ))}
      </ul>

      <div className="mt-auto pt-[18px]">
        <ButtonLink href="/noten/neu" className="w-full">
          + Note
        </ButtonLink>
      </div>
    </section>
  );
}

/**
 * Abgewählte Fächer stehen nicht zwischen den anderen: sie zählen nicht mehr
 * in den Schnitt. Weg sind sie trotzdem nicht — dieselbe zugeklappte Schublade
 * wie für vergangene Klausuren.
 */
function ArchivedDetails({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return (
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
        Abgewählt ({count})
      </summary>

      <div className="mt-2">{children}</div>
    </details>
  );
}
