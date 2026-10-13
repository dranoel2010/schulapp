import { istSchultag, jetzt, ladeKalender, nachSchulschluss } from "@/lib/tag";
import { addDays, isCalendarDate } from "@/lib/dates";
import { examTopicTitles, listExams } from "@/lib/exams";
import { homeworkForRange, listHomework } from "@/lib/homework";
import { weekdayOf } from "@/lib/timetable";

import {
  aufgabeDaten,
  heuteApp,
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
  stunden: (StundeDaten & { klausur: string | null })[];
  abgeben: AufgabeDaten[];
};

export type WocheDaten = {
  heute: string;
  /** Der gewählte Tag */
  tag: string;
  tage: WocheTag[];
  /** Fürs Bearbeiten: gibt es überhaupt Stunden? */
  hatStunden: boolean;
};

export async function wocheSeite(
  userId: string,
  params: Record<string, string>,
): Promise<WocheDaten> {
  const now = await jetzt();
  const heute = heuteApp(now);
  const [kal, kalender] = await Promise.all([schulKalender(userId, heute), ladeKalender(userId)]);

  let tag = params.tag && isCalendarDate(params.tag) ? params.tag : kal.naechsterSchultag(heute);
  const wdTag = weekdayOf(tag);
  if (wdTag === 6 || wdTag === 7) tag = kal.naechsterSchultag(tag);
  const montag = addDays(tag, 1 - weekdayOf(tag));
  const tage = [0, 1, 2, 3, 4].map((i) => addDays(montag, i));

  const [aufgaben, offen, klausuren, themen] = await Promise.all([
    homeworkForRange(userId, tage[0], tage[4]),
    listHomework(userId),
    listExams(userId, { includePast: true }),
    examTopicTitles(userId),
  ]);

  // Überfällige offene Aufgaben stehen am Tag, für den man packt: heute bis
  // Schulschluss, danach am nächsten Schultag — wie Morgenansicht und Überblick.
  const heuteSchule = istSchultag(kalender, heute);
  const packTag = heuteSchule && !nachSchulschluss(kalender, now) ? heute : kal.naechsterSchultag(heute);
  const ueberfaellig = offen
    .filter((a) => a.dueDate < packTag && a.dueDate <= heute && !(a.dueDate === heute && heuteSchule))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  return {
    heute,
    tag,
    hatStunden: kal.week.days.some((d) => d.lessons.length > 0),
    tage: tage.map((d) => {
      const stunden = kal.stundenAm(d);
      return {
        tag: d,
        frei: kal.frei(d),
        stunden: stunden.map((s) => {
          // Die Klausur steht in der ersten Stunde ihres Fachs an dem Tag.
          const erste = stunden.find((x) => x.fachId === s.fachId);
          const k = erste === s ? klausuren.find((x) => x.date === d && x.subjectId === s.fachId) : undefined;
          return { ...s, klausur: k ? klausurThema(k, themen.get(k.id) ?? []) : null };
        }),
        abgeben: [...(d === packTag ? ueberfaellig : []), ...aufgaben.filter((a) => a.dueDate === d)].map(aufgabeDaten),
      };
    }),
  };
}
