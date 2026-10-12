import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  GRADE_TARGETS,
  TargetSentence,
  nextWholeTarget,
  toGradeEntries,
} from "@/components/grades/target-sentence";
import { SeitenKopf } from "@/components/kombi/form";
import type { GradeKind } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatAverage, neededForTarget } from "@/lib/grade-scale";
import { gradesBySubject } from "@/lib/grades";

/**
 * „Was brauche ich für …?“ — der Zielrechner eines Fachs (Plan 2.2, Zeile
 * `notenfach`). Ziel und Art stehen in der Adresse (?ziel=2&art=schriftlich),
 * jede Wahl ist ein Link, und der Server rechnet neu. Gestaltung: Ziele als
 * Fachpillen `.fp`, die Art als Umschalter `.seg2`, die Antwort als Satz.
 */

export const metadata: Metadata = {
  title: "Was brauche ich?",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readTarget(raw: string | string[] | undefined, average: number | null): number {
  const value = Number(firstValue(raw));
  return GRADE_TARGETS.includes(value) ? value : nextWholeTarget(average);
}

function readKind(raw: string | string[] | undefined): GradeKind {
  return firstValue(raw) === "muendlich" ? "muendlich" : "schriftlich";
}

export default async function ZielPage({ params, searchParams }: PageProps<"/noten/fach/[id]/ziel">) {
  const user = await requireUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const bySubject = await gradesBySubject(user.id);
  const entry = bySubject.find((item) => item.subject.id === id);
  if (!entry) {
    notFound();
  }

  const { subject, grades, average } = entry;
  const writtenShare = Math.min(100, Math.max(0, subject.weightWritten));
  const target = readTarget(query.ziel, average);
  const kind = readKind(query.art);
  const outcome = neededForTarget({
    entries: toGradeEntries(grades),
    weightWritten: subject.weightWritten,
    target,
    // Das Gewicht der nächsten Note ist nicht wählbar: zwei Stellschrauben reichen.
    next: { kind, weight: 1 },
  });

  const linkTo = (nextTarget: number, nextKind: GradeKind) =>
    `/noten/fach/${subject.id}/ziel?ziel=${nextTarget}&art=${nextKind}`;

  return (
    <>
      <SeitenKopf
        titel="Was brauche ich?"
        sub={`${subject.name} · Schnitt ${average === null ? "noch keiner" : formatAverage(average, 1)} · schriftlich zählt ${writtenShare} %, mündlich ${100 - writtenShare} %`}
      />

      <h3 className="p-lab">Ziel</h3>
      <div className="refile" role="group" aria-label="Zielschnitt">
        {GRADE_TARGETS.map((value) => (
          <Link
            key={value}
            className="fp"
            href={linkTo(value, kind)}
            replace
            aria-pressed={value === target}
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            {formatAverage(value, 1)}
          </Link>
        ))}
      </div>

      <h3 className="p-lab">Die nächste Note ist</h3>
      <div className="seg2" role="group" aria-label="Art der nächsten Note">
        {(["schriftlich", "muendlich"] as const).map((k) => (
          <Link
            key={k}
            href={linkTo(target, k)}
            replace
            aria-pressed={k === kind}
            style={{ height: 44, padding: "0 16px", borderRadius: 999, display: "inline-flex", alignItems: "center", fontSize: 15, fontWeight: 560 }}
            className={k === kind ? "bg-sheet text-ink" : "text-ink-2"}
          >
            {k === "schriftlich" ? "schriftlich" : "mündlich"}
          </Link>
        ))}
      </div>

      <p style={{ fontSize: 17, lineHeight: 1.45, marginTop: 8 }}>
        <TargetSentence target={target} kind={kind} outcome={outcome} />
      </p>
    </>
  );
}
