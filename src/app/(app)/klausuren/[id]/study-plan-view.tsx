import { BlockItem, SubmitButton } from "@/components/study/block-item";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ExamTopic, StudyBlock } from "@/db/schema";
import { daysBetween, formatGerman } from "@/lib/dates";
import type { PlanWarning } from "@/lib/study-plan";

import { generatePlanAction, setBlockStatusAction } from "./plan-actions";

/**
 * Der Lernplan einer Prüfung: Fortschritt, Hinweise und die Blöcke nach Tagen.
 *
 * Gestrichene Blöcke stehen nicht in der Liste — sie sind bewusst weg. Damit
 * sie trotzdem nicht spurlos verschwinden, nennt der Fortschritt ihre Zahl.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type PlanBlock = StudyBlock & { topic: ExamTopic | null };

export type StudyPlanViewProps = {
  examId: string;
  /** "YYYY-MM-DD" */
  examDate: string;
  /** "YYYY-MM-DD" */
  today: string;
  /** Farbe des Fachs als Hex-Wert */
  color: string;
  topicCount: number;
  /** Nach Datum und Reihenfolge sortiert */
  blocks: PlanBlock[];
  warnings: PlanWarning[];
  minutesPerDay: number;
  leadDays: number;
};

type DayGroup = { date: string; blocks: PlanBlock[]; minutes: number };

/** Die Blöcke kommen sortiert herein, ein Durchlauf reicht. */
function groupByDay(blocks: PlanBlock[]): DayGroup[] {
  const groups: DayGroup[] = [];

  for (const block of blocks) {
    const last = groups[groups.length - 1];

    if (last && last.date === block.date) {
      last.blocks.push(block);
      last.minutes += block.minutes;
    } else {
      groups.push({ date: block.date, blocks: [block], minutes: block.minutes });
    }
  }

  return groups;
}

/** Was der Plan-Generator zu melden hat, in Alltagssprache. */
function warningText(
  warnings: PlanWarning[],
  daysLeft: number,
): string | null {
  if (warnings.includes("tight")) {
    return "Bis zur Prüfung bleibt nur ein Lerntag. Der Plan bringt alle Themen an diesem Tag unter, zum Wiederholen reicht die Zeit nicht mehr.";
  }

  if (warnings.includes("no-days") && daysLeft === 0) {
    return "Die Prüfung ist heute — für einen verteilten Plan bleibt keine Zeit mehr.";
  }

  return null;
}

export function StudyPlanView({
  examId,
  examDate,
  today,
  color,
  topicCount,
  blocks,
  warnings,
  minutesPerDay,
  leadDays,
}: StudyPlanViewProps) {
  const daysLeft = daysBetween(today, examDate);
  const upcoming = daysLeft > 0;

  // Gestrichenes zählt nicht mehr zum Plan, taucht aber im Fortschritt auf.
  const planned = blocks.filter((block) => block.status !== "skipped");
  const done = planned.filter((block) => block.status === "done").length;
  const skipped = blocks.length - planned.length;
  const percent =
    planned.length > 0 ? Math.round((done / planned.length) * 100) : 0;

  const groups = groupByDay(planned);
  const hint =
    topicCount > 0 && daysLeft >= 0 ? warningText(warnings, daysLeft) : null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Lernplan</h2>

        {upcoming && planned.length > 0 ? (
          <form action={generatePlanAction.bind(null, examId)}>
            <SubmitButton variant="secondary">Plan neu berechnen</SubmitButton>
          </form>
        ) : null}
      </div>

      {hint ? (
        <p className="rounded-control bg-surface-muted px-3.5 py-3 text-sm text-muted">
          {hint}
        </p>
      ) : null}

      {planned.length > 0 ? (
        <div>
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">
              {done} von {planned.length}
            </span>{" "}
            {planned.length === 1 ? "Block" : "Blöcken"} erledigt
            {skipped > 0 ? ` · ${skipped} gestrichen` : ""}
          </p>

          {/* Die Zahl darüber sagt schon alles — der Balken ist reine Optik. */}
          <div
            aria-hidden="true"
            className="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-muted"
          >
            <div
              style={{ width: `${percent}%`, backgroundColor: color }}
              className="h-full rounded-pill"
            />
          </div>
        </div>
      ) : null}

      {topicCount === 0 ? (
        <EmptyState
          title="Ohne Themen kein Plan"
          description="Die App verteilt die Themen auf die Tage vor der Prüfung. Sobald du einträgst, was drankommt, steht der Plan."
          action={
            <ButtonLink href={`/klausuren/${examId}/bearbeiten`}>
              Themen eintragen
            </ButtonLink>
          }
        />
      ) : groups.length === 0 ? (
        skipped > 0 ? (
          // Ein neuer Plan bringt hier nichts: gestrichene Blöcke gelten als
          // erledigt und werden nicht noch einmal angelegt.
          <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            Alle Lernblöcke sind gestrichen. Kommt ein neues Thema dazu, plant
            die App wieder.
          </p>
        ) : upcoming ? (
          <EmptyState
            title="Noch kein Plan berechnet"
            description={`Die Themen stehen. Die App verteilt sie auf ${leadDays} Tage vor der Prüfung, ${minutesPerDay} Minuten am Tag.`}
            action={
              <form action={generatePlanAction.bind(null, examId)}>
                <SubmitButton>Lernplan erstellen</SubmitButton>
              </form>
            }
          />
        ) : (
          <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            Für diese Prüfung gibt es keinen Lernplan.
          </p>
        )
      ) : (
        <>
          <ol className="space-y-2">
            {groups.map((group) => {
              const isToday = group.date === today;
              const isPast = group.date < today;

              return (
                <li
                  key={group.date}
                  className={cn(
                    "overflow-hidden rounded-card border",
                    isToday
                      ? "border-accent/40 bg-accent-soft"
                      : "border-border bg-surface",
                    isPast && "opacity-60",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          isToday ? "text-accent" : "text-foreground",
                        )}
                      >
                        {formatGerman(group.date, "kurz")}
                      </span>
                      {isToday ? (
                        <span className="rounded-pill bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                          heute
                        </span>
                      ) : null}
                    </span>

                    <span className="text-sm tabular-nums text-muted">
                      {group.minutes} min
                    </span>
                  </div>

                  <ul className="divide-y divide-border">
                    {group.blocks.map((block) => (
                      <BlockItem
                        key={block.id}
                        topic={block.topic?.title ?? null}
                        minutes={block.minutes}
                        kind={block.kind === "review" ? "review" : "learn"}
                        done={block.status === "done"}
                        color={color}
                        toggle={setBlockStatusAction.bind(
                          null,
                          examId,
                          block.id,
                          block.status === "done" ? "open" : "done",
                        )}
                      />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>

          {upcoming ? (
            <p className="text-sm text-subtle">
              {minutesPerDay} min am Tag · {leadDays} Tage Vorlauf
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
