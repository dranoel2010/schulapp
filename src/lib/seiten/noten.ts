import { gradeLabel, overallAverage } from "@/lib/grade-scale";
import { gradesBySubject, type SubjectGrades } from "@/lib/grades";

/**
 * Die Seiten „Noten“ und „Noten ⟨Fach⟩“ (Prototyp Z. 3123–3145). Gezeigt
 * werden nur Fächer mit Noten; der Gesamtschnitt zählt wie bisher nur Fächer,
 * die nicht archiviert sind. Abgewählte Fächer mit Noten stehen darunter.
 */

/** Notenreihe eines Fachs, älteste zuerst (Prototyp `noteLine`). */
const notenReihe = (e: SubjectGrades) =>
  e.grades
    .slice()
    .reverse()
    .map((g) => gradeLabel(g.value))
    .join(" · ");

export type NotenFach = { id: string; name: string; reihe: string; schnitt: number | null };

export type NotenDaten = {
  gesamt: number | null;
  faecher: NotenFach[];
  abgewaehlt: NotenFach[];
  /** Gibt es überhaupt ein Fach? (Leerzustand mit „Note eintragen“) */
  hatFaecher: boolean;
};

export async function notenSeite(userId: string): Promise<NotenDaten> {
  const alle = await gradesBySubject(userId);
  const mit = alle.filter((e) => e.grades.length > 0);
  const aktiv = mit.filter((e) => !e.subject.archived);
  const zeile = (e: SubjectGrades): NotenFach => ({
    id: e.subject.id,
    name: e.subject.name,
    reihe: notenReihe(e),
    schnitt: e.average,
  });
  return {
    gesamt: overallAverage(
      aktiv.map((e) => e.average).filter((x): x is number => x !== null),
    ),
    faecher: aktiv.map(zeile),
    abgewaehlt: mit.filter((e) => e.subject.archived).map(zeile),
    hatFaecher: alle.length > 0,
  };
}

export type NotenfachDaten = {
  id: string;
  name: string;
  noten: { id: string; label: string; titel: string | null; datum: string; art: "schriftlich" | "mündlich"; gewicht: number }[];
  schriftlich: number | null;
  muendlich: number | null;
  schnitt: number | null;
  /** Anteil schriftlich in Prozent */
  anteil: number;
};

export async function notenfachSeite(
  userId: string,
  params: Record<string, string>,
): Promise<NotenfachDaten | null> {
  const alle = await gradesBySubject(userId);
  const e = alle.find((x) => x.subject.id === params.id);
  if (!e) return null;
  return {
    id: e.subject.id,
    name: e.subject.name,
    // älteste zuerst, wie im Prototyp
    noten: e.grades.slice().reverse().map((g) => ({
      id: g.id,
      label: gradeLabel(g.value),
      titel: g.title,
      datum: g.date,
      art: g.kind === "muendlich" ? "mündlich" : "schriftlich",
      gewicht: g.weight,
    })),
    schriftlich: e.written,
    muendlich: e.oral,
    schnitt: e.average,
    anteil: Math.min(100, Math.max(0, e.subject.weightWritten)),
  };
}
