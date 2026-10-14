import { and, asc, eq, gte, lte, ne } from "drizzle-orm";

import { db } from "@/db";
import { examTopics, exams, studyBlocks, subjects } from "@/db/schema";
import { blockDatenLaden, type BlockDaten } from "@/lib/kombi/lernblock-daten";
import { istSchultag, jetzt, ladeKalender, nachSchulschluss } from "@/lib/tag";
import { addDays, isCalendarDate } from "@/lib/dates";
import { examTopicTitles, listExams } from "@/lib/exams";
import { homeworkForRange, listHomework } from "@/lib/homework";
import { weekdayOf } from "@/lib/timetable";

import {
  aufgabeDaten,
  heuteApp,
  kurzVon,
  schulKalender,
  type AufgabeDaten,
  type StundeDaten,
} from "./gemeinsam";
import { klausurThema } from "./klausur";

/**
 * Die Seite „Woche“ (Prototyp `PAGES.woche`, Z. 3052): fünf Tage Mo–Fr, je
 * Tag die Stunden mit Zeit, Fach und Raum, freie Tage, eine Klausur in der
 * Stunde und was am Tag abzugeben ist.
 */
export type WocheTag = {
  tag: string;
  frei: string | null;
  /** „aus IServ“ oder „von Hand eingetragen“, nur an einem freien Tag */
  freiHerkunft: string | null;
  stunden: (StundeDaten & { klausur: string | null })[];
  abgeben: AufgabeDaten[];
  /**
   * Der Lernplan aller Klausuren an diesem Tag, ohne Uhrzeit (Lernblöcke
   * haben keine). Am Rechner die Zeile „Lernen“ im Raster; die Tagesansicht
   * am Handy zeigt ihn nicht.
   */
  lernen: LernEintrag[];
};

/** Ein Planeintrag in der Woche: der Block und die Klausur, zu der er gehört. */
export type LernEintrag = {
  block: BlockDaten;
  /** Fachname („Mathematik“), wie ihn der Tisch im Kopf trägt */
  fach: string;
  /** Anzeigename („Mathe“) */
  kurz: string;
  /** Tag der Klausur, 'YYYY-MM-DD' */
  klausurDatum: string;
};

export type WocheDaten = {
  heute: string;
  /** Der gewählte Tag */
  tag: string;
  /** Montag der Woche, die ohne `?tag=` käme (am Rechner: „Diese Woche“) */
  dieseWoche: string;
  tage: WocheTag[];
  /** Fürs Bearbeiten: gibt es überhaupt Stunden? */
  hatStunden: boolean;
  /**
   * Die Stunden des Rasters mit Beginn und Ende, von der ersten bis zur
   * letzten, in der diese Woche Unterricht steht. Am Rechner die Zeitspalte
   * der Woche; leer, wenn die Woche keine Stunde hat (Ferien).
   */
  zeiten: { nr: number; von: string | null; bis: string | null }[];
};

export async function wocheSeite(
  userId: string,
  params: Record<string, string>,
): Promise<WocheDaten> {
  const now = await jetzt();
  const heute = heuteApp(now);
  const [kal, kalender] = await Promise.all([schulKalender(userId, heute), ladeKalender(userId)]);

  const montagVon = (t: string) => {
    const w = weekdayOf(t);
    const t2 = w === 6 || w === 7 ? kal.naechsterSchultag(t) : t;
    return { tag: t2, montag: addDays(t2, 1 - weekdayOf(t2)) };
  };
  const standard = montagVon(kal.naechsterSchultag(heute));
  const { tag, montag } = params.tag && isCalendarDate(params.tag) ? montagVon(params.tag) : standard;
  const tage = [0, 1, 2, 3, 4].map((i) => addDays(montag, i));

  const [aufgaben, offen, klausuren, themen, lernplan] = await Promise.all([
    homeworkForRange(userId, tage[0], tage[4]),
    listHomework(userId),
    listExams(userId, { includePast: true }),
    examTopicTitles(userId),
    lernplanDerWoche(userId, tage[0], tage[4]),
  ]);

  // Überfällige offene Aufgaben stehen am Tag, für den man packt: heute bis
  // Schulschluss, danach am nächsten Schultag — wie Morgenansicht und Überblick.
  const heuteSchule = istSchultag(kalender, heute);
  const packTag = heuteSchule && !nachSchulschluss(kalender, now) ? heute : kal.naechsterSchultag(heute);
  const ueberfaellig = offen
    .filter((a) => a.dueDate < packTag && a.dueDate <= heute && !(a.dueDate === heute && heuteSchule))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  const stundenJeTag = tage.map((d) => kal.stundenAm(d));
  const letzte = Math.max(0, ...stundenJeTag.flat().map((s) => s.bisNr));
  const raster = new Map(kal.week.periods.map((p) => [p.number, p]));
  const zeiten = Array.from({ length: letzte }, (_, i) => ({
    nr: i + 1,
    von: raster.get(i + 1)?.startsAt ?? null,
    bis: raster.get(i + 1)?.endsAt ?? null,
  }));

  return {
    heute,
    tag,
    dieseWoche: standard.montag,
    hatStunden: kal.week.days.some((d) => d.lessons.length > 0),
    zeiten,
    tage: tage.map((d, i) => {
      const stunden = stundenJeTag[i];
      return {
        tag: d,
        frei: kal.frei(d),
        freiHerkunft: kal.freiHerkunft(d),
        stunden: stunden.map((s) => {
          // Die Klausur steht in der ersten Stunde ihres Fachs an dem Tag.
          const erste = stunden.find((x) => x.fachId === s.fachId);
          const k = erste === s ? klausuren.find((x) => x.date === d && x.subjectId === s.fachId) : undefined;
          return { ...s, klausur: k ? klausurThema(k, themen.get(k.id) ?? []) : null };
        }),
        // Je Tag genau die Aufgaben dieses Fälligkeitstags (Prototyp a.due === d).
        // Eine überfällige Aufgabe aus einer früheren Woche steht einmal beim
        // Packtag; liegt ihr Tag in dieser Woche, steht sie nur dort.
        abgeben: [
          ...(d === packTag ? ueberfaellig.filter((a) => a.dueDate < tage[0]) : []),
          ...aufgaben.filter((a) => a.dueDate === d),
        ].map(aufgabeDaten),
        lernen: lernplan.filter((e) => e.block.tag === d),
      };
    }),
  };
}

/**
 * Die Planeinträge aller Klausuren von `von` bis `bis`, ohne gestrichene:
 * je Tag nach der Klausur, die zuerst kommt, dann in der Reihenfolge des
 * Plans. Ein Block nach seiner Klausur kommt nicht vor (der Plan endet am
 * Tag davor); falls doch, steht er trotzdem da, wo er liegt.
 */
export async function lernplanDerWoche(userId: string, von: string, bis: string): Promise<LernEintrag[]> {
  const zeilen = await db
    .select({ block: studyBlocks, topic: examTopics, fach: subjects.name, klausurDatum: exams.date })
    .from(studyBlocks)
    .innerJoin(exams, and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(and(gte(studyBlocks.date, von), lte(studyBlocks.date, bis), ne(studyBlocks.status, "skipped")))
    .orderBy(asc(studyBlocks.date), asc(exams.date), asc(exams.createdAt), asc(studyBlocks.sortOrder));
  const bloecke = await blockDatenLaden(
    userId,
    zeilen.map((z) => ({ ...z.block, topic: z.topic ?? null })),
  );
  return zeilen.map((z, i) => ({ block: bloecke[i], fach: z.fach, kurz: kurzVon(z.fach), klausurDatum: z.klausurDatum }));
}
