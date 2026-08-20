import type { GradeKind } from "@/db/schema";
import {
  BEST_GRADE,
  WORST_GRADE,
  formatAverage,
  gradeLabel,
  type GradeEntry,
  type TargetOutcome,
} from "@/lib/grade-scale";
import type { GradeItem } from "@/lib/grades";

/**
 * „Was brauche ich noch für eine 2?“ — die Frage aus dem Konzept, als Satz.
 *
 * Gerechnet wird sie in @/lib/grade-scale; hier wird sie nur formuliert. Die
 * Antwort ist nur so viel wert wie ihre Annahme, deshalb steht die Annahme im
 * Satz: welche Art die nächste Note hat und dass sie einfach zählt. Ohne das
 * ließe sich die Auskunft nicht nachrechnen — und eine Zahl, die man nicht
 * nachrechnen kann, ist in dieser App keine Auskunft.
 *
 * Alle drei Ausgänge bekommen einen eigenen Satz. „Nicht mehr zu schaffen“ ist
 * eine unangenehme Nachricht, aber die ehrlichste von dreien; sie zu
 * verschweigen hieße, jemanden auf ein Ziel hinlernen zu lassen, das mit einer
 * Note nicht mehr zu erreichen ist.
 */

/**
 * Die Ziele, nach denen gefragt wird.
 *
 * Eine 5 oder eine 6 steht nicht dabei: danach fragt niemand. Wer dort steht,
 * fragt nach der 4 — und die ist das letzte Ziel in der Liste.
 */
export const GRADE_TARGETS: readonly number[] = [1, 2, 3, 4];

/**
 * Das nächstbessere ganze Ziel zum aktuellen Schnitt: 2,7 → 2, 2,0 → 1.
 *
 * Ohne Noten gibt es keinen Schnitt und damit auch kein „nächstbesser“ — dann
 * ist die 2 die Vorgabe, das übliche Ziel. Nach oben wird geklemmt, weil die
 * Liste keine 5 anbietet: wer bei 5,4 steht, bekommt die 4 vorgeschlagen.
 */
export function nextWholeTarget(average: number | null): number {
  if (average === null) return 2;

  return Math.min(4, Math.max(1, Math.ceil(average) - 1));
}

/**
 * Aus Datenzeilen wird das, was @/lib/grade-scale von einer Note braucht.
 *
 * Die Spalte `kind` ist Text; ein unbekannter Wert zählt wie in @/lib/grades
 * als schriftlich, damit die Rechnung nicht an einer einzigen Zeile scheitert.
 */
export function toGradeEntries(grades: GradeItem[]): GradeEntry[] {
  return grades.map((grade) => ({
    value: grade.value,
    weight: grade.weight,
    kind: grade.kind === "muendlich" ? "muendlich" : "schriftlich",
  }));
}

export type TargetSentenceProps = {
  /**
   * Das Fach. Auf der Fachseite steht sein Name schon im Kopf — dort bleibt
   * er weg, sonst stünde er zweimal in drei Zeilen.
   */
  subjectName?: string;
  /** Zielschnitt als ganze Note, also 1 bis 4. */
  target: number;
  /** Die Art, mit der gerechnet wurde. */
  kind: GradeKind;
  outcome: TargetOutcome;
};

/** „schriftliche“ / „mündliche“ — der Satz braucht die gebeugte Form. */
function kindWord(kind: GradeKind): string {
  return kind === "muendlich" ? "mündliche" : "schriftliche";
}

export function TargetSentence({
  subjectName,
  target,
  kind,
  outcome,
}: TargetSentenceProps) {
  // Das Ziel steht mit Nachkommastelle da, weil es ein Schnitt ist und keine
  // einzelne Note: „2,0“ meint den Fachschnitt, „2“ läse sich wie eine Note.
  const goal = (
    <strong className="font-semibold">{formatAverage(target, 1)}</strong>
  );
  const where = subjectName ? ` in ${subjectName}` : "";
  const next = `als nächste ${kindWord(kind)} Note mit einfachem Gewicht`;

  if (outcome.status === "sicher") {
    return (
      <>
        Ein Schnitt von {goal} ist{where} nicht mehr zu verlieren — selbst eine{" "}
        {gradeLabel(WORST_GRADE)} {next} ändert daran nichts.
      </>
    );
  }

  if (outcome.status === "unmoeglich") {
    return (
      <>
        Ein Schnitt von {goal} ist{where} mit einer Note nicht mehr zu schaffen
        — nicht einmal eine {gradeLabel(BEST_GRADE)} {next} reicht dafür.
      </>
    );
  }

  return (
    <>
      Für einen Schnitt von {goal} reicht{where} eine{" "}
      <strong className="font-semibold">{gradeLabel(outcome.value)}</strong>{" "}
      {next}.
    </>
  );
}
