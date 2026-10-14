import { examTopicTitles, listExams } from "@/lib/exams";
import { listHomework } from "@/lib/homework";
import { aufgabeImArchiv, klausurImArchiv } from "@/lib/kombi/archiv";
import { appTag, jetzt } from "@/lib/tag";

import { aufgabeDaten, type AufgabeDaten } from "./gemeinsam";
import { klausurThema } from "./klausur";

/**
 * Das Archiv (Antwort 11 vom 13.10.2026): was aus den Listen „Klausuren“ und
 * „Hausaufgaben“ gefallen ist. Klausuren ab Tag 15 nach dem Klausurtag,
 * erledigte Aufgaben zwei Tage nach dem Abhaken. Gelöscht wird nichts; eine
 * Aufgabe lässt sich hier wieder öffnen und steht dann wieder in ihrer Liste.
 *
 * Klausuren zuerst, weil es wenige sind; die jüngste oben, in beiden Gruppen.
 */
export type ArchivSeite = {
  heute: string;
  klausuren: { id: string; fach: string; datum: string; thema: string }[];
  aufgaben: AufgabeDaten[];
};

export async function archivSeite(userId: string, jetztZeit?: Date): Promise<ArchivSeite> {
  const now = jetztZeit ?? (await jetzt());
  const heute = appTag(now);
  const [exams, liste, themen] = await Promise.all([
    listExams(userId, { includePast: true, heute }),
    listHomework(userId, { includeDone: true }),
    examTopicTitles(userId),
  ]);
  return {
    heute,
    klausuren: exams
      .filter((k) => klausurImArchiv(k.date, heute))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .map((k) => ({ id: k.id, fach: k.subject.name, datum: k.date, thema: klausurThema(k, themen.get(k.id) ?? []) })),
    aufgaben: liste
      .map(aufgabeDaten)
      .filter((a) => aufgabeImArchiv(a, now.getTime()))
      .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
  };
}
