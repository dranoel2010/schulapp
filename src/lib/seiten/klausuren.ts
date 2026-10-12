import { daysBetween } from "@/lib/dates";
import {
  examTopicTitles,
  getExam,
  listExams,
  missedBlocks,
} from "@/lib/exams";
import { freeDatesFrom } from "@/lib/free-days";
import { gradesBySubject } from "@/lib/grades";
import { gradeLabel } from "@/lib/grade-scale";
import { blockAngefangen, blockZustand } from "@/lib/lernblock";
import { listMaterials } from "@/lib/materials";
import { buildPlan, type PlanWarning } from "@/lib/study-plan";

import { blattZeile, type BlattZeile } from "./ablage";
import { heuteApp, schulKalender } from "./gemeinsam";

/**
 * Die Seiten „Klausuren“ und „Klausur“ (Prototyp Z. 3106–3121). Die
 * Klausurseite trägt zusätzlich den Lernplan mit allem, was bisher unter
 * /lernen stand (Plan 1.1, Ausnahme Lernplan; Abschnitt F): jeder Block jedes
 * Tages, Fortschritt, Warnungen, Leerzustand und die verpassten Blöcke.
 */

const ART: Record<string, string> = {
  klausur: "Klausur",
  test: "Test",
  referat: "Referat",
  muendlich: "Mündliche Prüfung",
};

/** Was die Klausur abfragt: ihr Titel, sonst ihre Themen, sonst die Art. */
export function klausurThema(
  exam: { title: string | null; kind: string },
  themen: readonly string[],
): string {
  if (exam.title) return exam.title;
  if (themen.length) return themen.join(", ");
  return ART[exam.kind] ?? "Klausur";
}

export type KlausurZeile = { id: string; fach: string; datum: string; thema: string };

export type KlausurenDaten = { klausuren: KlausurZeile[] };

export async function klausurenSeite(userId: string): Promise<KlausurenDaten> {
  const [liste, themen] = await Promise.all([
    listExams(userId, { includePast: true }),
    examTopicTitles(userId),
  ]);
  return {
    // Wie im Prototyp eine Liste, nach Datum sortiert, vergangene mit darin (Plan 2.2)
    klausuren: liste
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((k) => ({
        id: k.id,
        fach: k.subject.name,
        datum: k.date,
        thema: klausurThema(k, themen.get(k.id) ?? []),
      })),
  };
}

export type PlanZeile = {
  id: string;
  tag: string;
  /** Zeile fett: Thema, „Wiederholung“ oder „Gesamtwiederholung“ */
  titel: string;
  /**
   * Unterzeile vor den Minuten (Prototyp `planRows`): beim Lernblock
   * „Lernblock“, bei einer Wiederholung ihr Umfang, damit mehrere
   * Wiederholungen untereinander zu unterscheiden sind.
   */
  unter: string;
  minuten: number;
  erledigt: boolean;
  /** Läuft oder pausiert: ein Tipp öffnet die Uhr statt abzuhaken */
  angefangen: boolean;
  zustand: "ruhe" | "laeuft" | "pausiert" | "erledigt";
};

export type KlausurDaten = {
  id: string;
  heute: string;
  fachId: string;
  fach: string;
  datum: string;
  thema: string;
  /** Erste Stunde des Fachs am Klausurtag, sonst null */
  stunde: number | null;
  themenZahl: number;
  plan: PlanZeile[];
  fortschritt: { erledigt: number; geplant: number; gestrichen: number };
  minutenAmTag: number;
  vorlauf: number;
  warnung: string | null;
  /** Ohne Plan, aber mit Themen und vor der Klausur: „Lernplan erstellen“ */
  ohnePlan: boolean;
  verpasst: { tage: number; minuten: number; letzter: string } | null;
  noten: string | null;
  blaetter: BlattZeile[];
};

/** Wortlaut wie bisher auf /lernen (`warningText`). */
function warnungText(warnings: PlanWarning[], tageBis: number): string | null {
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
): Promise<KlausurDaten | null> {
  const id = params.id ?? "";
  const detail = await getExam(userId, id);
  if (!detail) return null;
  const heute = heuteApp();
  const { exam, subject, topics, blocks } = detail;

  const [kal, verpasst, noten, freie, blaetter] = await Promise.all([
    schulKalender(userId, heute),
    missedBlocks(userId, heute),
    gradesBySubject(userId),
    freeDatesFrom(userId, heute),
    listMaterials(userId, { subjectId: subject.id }),
  ]);

  const geplant = blocks.filter((b) => b.status !== "skipped");
  const plan = buildPlan({
    examDate: exam.date,
    today: heute,
    topics: topics.map((t) => ({ id: t.id, title: t.title })),
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
    excludedDates: freie,
  });
  const tageBis = daysBetween(heute, exam.date);

  const meineVerpassten = verpasst.filter((b) => b.examId === exam.id);
  const ersteStunde = kal.stundenAm(exam.date).find((s) => s.fachId === subject.id);

  const themenIds = new Set(
    topics.map((t) => t.subjectTopicId).filter((x): x is string => !!x),
  );
  const fachNoten = noten.find((n) => n.subject.id === subject.id);

  return {
    id: exam.id,
    heute,
    fachId: subject.id,
    fach: subject.name,
    datum: exam.date,
    thema: klausurThema(exam, topics.map((t) => t.title)),
    stunde: ersteStunde?.nr ?? null,
    themenZahl: topics.length,
    plan: geplant.map((b) => ({
      id: b.id,
      tag: b.date,
      titel:
        b.kind === "review"
          ? "Wiederholung"
          : (b.topic?.title ?? "Gesamtwiederholung"),
      unter:
        b.kind === "review"
          ? (b.topic?.title ??
            (topics.length > 0 ? `Alles bis ${topics[topics.length - 1].title}` : "Alle Themen"))
          : "Lernblock",
      minuten: b.minutes,
      erledigt: b.status === "done",
      angefangen: b.status !== "done" && blockAngefangen(b),
      zustand: blockZustand(b),
    })),
    fortschritt: {
      erledigt: geplant.filter((b) => b.status === "done").length,
      geplant: geplant.length,
      gestrichen: blocks.length - geplant.length,
    },
    minutenAmTag: exam.minutesPerDay,
    vorlauf: exam.leadDays,
    warnung: topics.length > 0 && tageBis >= 0 ? warnungText(plan.warnings, tageBis) : null,
    ohnePlan: topics.length > 0 && geplant.length === 0 && blocks.length === 0 && tageBis > 0,
    verpasst: meineVerpassten.length
      ? {
          tage: new Set(meineVerpassten.map((b) => b.date)).size,
          minuten: meineVerpassten.reduce((s, b) => s + b.minutes, 0),
          letzter: meineVerpassten.reduce((m, b) => (b.date > m ? b.date : m), meineVerpassten[0].date),
        }
      : null,
    noten:
      fachNoten && fachNoten.grades.length
        ? fachNoten.grades
            .slice()
            .reverse()
            .map((g) => gradeLabel(g.value))
            .join(" · ")
        : null,
    blaetter: blaetter
      .filter((b) => b.topics.some((t) => themenIds.has(t.id)))
      .map(blattZeile),
  };
}

