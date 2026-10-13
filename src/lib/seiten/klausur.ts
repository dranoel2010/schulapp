import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { materialPages, materialTopics, materials, subjectTopics } from "@/db/schema";
import { daysBetween } from "@/lib/dates";
import { getExam, listExams, mitProbe } from "@/lib/exams";
import { freeDatesFrom } from "@/lib/free-days";
import { gradeLabel } from "@/lib/grade-scale";
import { gradesBySubject } from "@/lib/grades";
import { appTag, jetzt } from "@/lib/tag";
import { blattStaende, blockDaten, type BlockDaten } from "@/lib/kombi/lernblock-daten";
import { buildPlan, type PlanWarning } from "@/lib/study-plan";
import { lessonsForWeekday, weekdayOf } from "@/lib/timetable";

/**
 * Die Klausurseite (Prototyp `PAGES.klausur`, Z. 3112) mit dem ganzen Lernplan,
 * den bisher `/lernen` zeigte (Plan 1.1 Ausnahme, Abschnitt F): alle Blöcke
 * aller Tage, Fortschritt, Minuten am Tag und Vorlauf, Warnungen, Leerzustand
 * und verpasste Blöcke. Dazu die Noten des Fachs und die Blätter zum Thema.
 */

export const ART_NAMEN: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "Mündliche Prüfung",
};

/** Was die Klausur abfragt: ihr Titel, sonst ihre Themen, sonst die Art (Fach- und Woche-Seite). */
export function klausurThema(
  exam: { title: string | null; kind: string },
  themen: readonly string[],
): string {
  if (exam.title) return exam.title;
  if (themen.length) return themen.join(", ");
  return ART_NAMEN[exam.kind] ?? "Klausur";
}

export type KlausurZeile = { id: string; fach: string; datum: string; thema: string };

export type KlausurSeite = {
  id: string;
  fach: string;
  fachId: string;
  datum: string;
  /** App-Tag, an dem die Seite geladen wurde */
  heute: string;
  /** „Klausur“, „Test“ … */
  art: string;
  /** Die Zeile unter dem Datum: Titel der Klausur, sonst ihre Themen */
  thema: string | null;
  /** Erste Stunde des Fachs am Klausurtag, falls im Stundenplan */
  stunde: number | null;
  themen: number;
  /** Alle Blöcke ohne die gestrichenen, nach Tag und Reihenfolge */
  bloecke: BlockDaten[];
  erledigt: number;
  gestrichen: number;
  minutenProTag: number;
  vorlauf: number;
  /** Wortlaut wie bisher auf /lernen (`warningText`) */
  warnung: string | null;
  /** Offene Blöcke aus der Vergangenheit: „Nachholen“ oder „Auslassen“ */
  verpasst: { anzahl: number; minuten: number; tag: string } | null;
  /** „2 · 3+ · 2−“ in der Reihenfolge des Eintragens; null ohne Noten */
  noten: string | null;
  /** `deckblatt`: ID der ersten Seite für die Vorschau (`/api/material/<seite>/vorschau`) */
  blaetter: { id: string; titel: string; datum: string; thema: string; deckblatt: string | null }[];
};

/** Was der Plan-Generator zu melden hat, in Alltagssprache (wie bisher auf /lernen). */
export function warnungText(warnings: PlanWarning[], tageBis: number): string | null {
  if (warnings.includes("tight")) {
    return "Bis zur Prüfung bleibt nur ein Lerntag. Der Plan bringt alle Themen an diesem Tag unter, zum Wiederholen reicht die Zeit nicht mehr.";
  }
  if (warnings.includes("no-days") && tageBis === 0) {
    return "Die Prüfung ist heute — für einen verteilten Plan bleibt keine Zeit mehr.";
  }
  return null;
}

export async function klausurSeite(
  userId: string,
  params: Record<string, string>,
): Promise<KlausurSeite | null> {
  const id = params.id ?? "";
  const detail = await getExam(userId, id);
  if (!detail) return null;
  const { exam, subject, topics, blocks } = detail;
  const heute = appTag(await jetzt());

  const geplant = blocks.filter((b) => b.status !== "skipped");
  const [staende, freieTage, noten, stunden, blaetter] = await Promise.all([
    blattStaende(userId, geplant.map((b) => b.id)),
    freeDatesFrom(userId, heute),
    gradesBySubject(userId),
    lessonsForWeekday(userId, weekdayOf(exam.date)),
    blaetterZurKlausur(userId, topics.map((t) => t.subjectTopicId).filter((x): x is string => x !== null)),
  ]);

  // Der Plan wird hier nur gerechnet, nicht gespeichert — gebraucht werden
  // seine Warnungen (wie bisher auf /lernen).
  const plan = buildPlan({
    examDate: exam.date,
    today: heute,
    topics: topics.map((t) => ({ id: t.id, title: t.title })),
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
    excludedDates: freieTage,
    probe: mitProbe(exam.kind),
  });
  const tageBis = daysBetween(heute, exam.date);

  const verpassteBloecke = geplant.filter((b) => b.status === "open" && b.date < heute);
  const fachNoten = noten.find((n) => n.subject.id === subject.id);
  const stunde = stunden
    .filter((l) => l.subjectId === subject.id)
    .reduce<number | null>((min, l) => (min === null || l.period < min ? l.period : min), null);

  return {
    id: exam.id,
    fach: subject.name,
    fachId: subject.id,
    datum: exam.date,
    heute,
    art: ART_NAMEN[exam.kind] ?? "Prüfung",
    thema: exam.title ?? (topics.length ? topics.map((t) => t.title).join(", ") : null),
    stunde,
    themen: topics.length,
    bloecke: geplant.map((b) => blockDaten(b, staende.get(b.id) ?? null)),
    erledigt: geplant.filter((b) => b.status === "done").length,
    gestrichen: blocks.length - geplant.length,
    minutenProTag: exam.minutesPerDay,
    vorlauf: exam.leadDays,
    warnung: topics.length > 0 && tageBis >= 0 ? warnungText(plan.warnings, tageBis) : null,
    verpasst:
      verpassteBloecke.length && exam.date >= heute
        ? {
            anzahl: verpassteBloecke.length,
            minuten: verpassteBloecke.reduce((s, b) => s + b.minutes, 0),
            tag: verpassteBloecke[verpassteBloecke.length - 1].date,
          }
        : null,
    noten: fachNoten && fachNoten.grades.length
      ? [...fachNoten.grades].reverse().map((g) => gradeLabel(g.value)).join(" · ")
      : null,
    blaetter,
  };
}

/** Die Blätter an den Themen der Klausur, das jüngste zuerst (Prototyp `blattSort`). */
async function blaetterZurKlausur(
  userId: string,
  vokabeln: string[],
): Promise<KlausurSeite["blaetter"]> {
  if (vokabeln.length === 0) return [];
  const zeilen = await db
    .select({
      id: materials.id,
      titel: materials.title,
      datum: materials.capturedOn,
      thema: subjectTopics.title,
    })
    .from(materials)
    .innerJoin(materialTopics, eq(materialTopics.materialId, materials.id))
    .innerJoin(subjectTopics, eq(subjectTopics.id, materialTopics.subjectTopicId))
    .where(and(eq(materials.userId, userId), inArray(materialTopics.subjectTopicId, vokabeln)))
    .orderBy(desc(materials.capturedOn), desc(materials.createdAt), asc(subjectTopics.title));
  const ids = [...new Set(zeilen.map((z) => z.id))];
  const seiten = ids.length
    ? await db
        .select({ id: materialPages.id, materialId: materialPages.materialId })
        .from(materialPages)
        .where(inArray(materialPages.materialId, ids))
        .orderBy(asc(materialPages.sortOrder))
    : [];
  const deckblatt = new Map<string, string>();
  for (const s of seiten) if (!deckblatt.has(s.materialId)) deckblatt.set(s.materialId, s.id);

  const gesehen = new Set<string>();
  const out: KlausurSeite["blaetter"] = [];
  for (const z of zeilen) {
    if (gesehen.has(z.id)) continue;
    gesehen.add(z.id);
    out.push({ id: z.id, titel: z.titel ?? "Blatt", datum: z.datum, thema: z.thema, deckblatt: deckblatt.get(z.id) ?? null });
  }
  return out;
}

// ── Klausuren (Liste) ────────────────────────────────────────────────────────

export type KlausurenSeite = {
  klausuren: { id: string; fach: string; datum: string; thema: string }[];
};

/**
 * Alle Klausuren in einer sortierten Liste, vergangene eingeschlossen — wie im
 * Prototyp (Z. 3106), ohne eigenen Abschnitt „Vorbei“ (Plan 2.2, Frage 11).
 */
export async function klausurenSeite(userId: string): Promise<KlausurenSeite> {
  const liste = await listExams(userId, { includePast: true });
  return {
    klausuren: liste
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((k) => ({
        id: k.id,
        fach: k.subject.name,
        datum: k.date,
        thema: k.title ?? ART_NAMEN[k.kind] ?? "Prüfung",
      })),
  };
}
