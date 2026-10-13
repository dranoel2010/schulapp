import { jetzt } from "@/lib/tag";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { arbeitsblaetter } from "@/db/schema";
import { listExams, examTopicTitles } from "@/lib/exams";
import { listHomework } from "@/lib/homework";
import { klausurListe } from "@/lib/kombi/archiv";
import { dm, weekdayOrDate, lang } from "@/lib/kombi/text";
import { listMaterials } from "@/lib/materials";
import { listTopics } from "@/lib/subject-topics";
import { getSubject, listSubjects } from "@/lib/subjects";
import { artAbgeleitet, themaArt } from "@/lib/themen-art";
import { recallItems } from "@/recall/schema";

import { blaetterImKorb, blattZeile, type BlattZeile } from "./ablage";
import { aufgabeDaten, heuteApp, schulKalender, type AufgabeDaten, type SchulKalender } from "./gemeinsam";
import { klausurThema, type KlausurZeile } from "./klausur";

/**
 * Die Seiten „Fächer“ und „Fach“ (Prototyp Z. 3175–3193). Archivierte Fächer
 * stehen getrennt (Plan 2.2: zugeklappte Zeile „Archiviert · n“); das Fach
 * zeigt Offenes, Klausuren, Themen mit ihrer Art (`themaArtRow`, Z. 3203)
 * und Blätter.
 */

export type FachZeile = { id: string; name: string; sub: string };

export type FaecherDaten = { faecher: FachZeile[]; archiviert: FachZeile[] };

function fachSub(kal: SchulKalender, heute: string, id: string, voll: boolean): string {
  if (id === kal.epoche) {
    if (!kal.epocheSeit) return "Hauptunterricht";
    return voll ? `Hauptunterricht · Epoche seit ${lang(kal.epocheSeit)}` : `Hauptunterricht, Epoche seit ${dm(kal.epocheSeit)}`;
  }
  const nl = kal.naechsteStunde(id, heute);
  if (!nl) return "Gerade nicht im Stundenplan";
  return `Nächste Stunde ${voll ? lang(nl) : weekdayOrDate(nl, heute)}`;
}

export async function faecherSeite(userId: string): Promise<FaecherDaten> {
  const heute = heuteApp(await jetzt());
  const [faecher, kal] = await Promise.all([
    listSubjects(userId, { includeArchived: true }),
    schulKalender(userId, heute),
  ]);
  return {
    faecher: faecher
      .filter((f) => !f.archived)
      .map((f) => ({ id: f.id, name: f.name, sub: fachSub(kal, heute, f.id, false) })),
    archiviert: faecher
      .filter((f) => f.archived)
      .map((f) => ({ id: f.id, name: f.name, sub: fachSub(kal, heute, f.id, false) })),
  };
}

export type ThemaZeile = {
  id: string;
  name: string;
  art: "abfragen" | "ueben";
  abgeleitet: "abfragen" | "ueben";
  fragen: number;
  /** Ein fertiges Arbeitsblatt liegt vor */
  blatt: boolean;
};

export type FachDaten = {
  id: string;
  heute: string;
  name: string;
  archiviert: boolean;
  istEpoche: boolean;
  sub: string;
  offen: AufgabeDaten[];
  klausuren: KlausurZeile[];
  themen: ThemaZeile[];
  blaetter: BlattZeile[];
};

export async function fachSeite(
  userId: string,
  params: Record<string, string>,
  jetztZeit?: Date,
): Promise<FachDaten | null> {
  const fach = await getSubject(userId, params.id ?? "");
  if (!fach) return null;
  const heute = heuteApp(jetztZeit ?? (await jetzt()));

  const [kal, aufgaben, klausuren, titel, themen, blaetter, imKorb] = await Promise.all([
    schulKalender(userId, heute),
    listHomework(userId),
    listExams(userId, { includePast: true, heute }),
    examTopicTitles(userId),
    listTopics(userId, fach.id),
    listMaterials(userId, { subjectId: fach.id }),
    blaetterImKorb(userId),
  ]);

  const themenIds = themen.map((t) => t.id);
  const [fragen, fertig] = themenIds.length
    ? await Promise.all([
        db
          .select({ id: recallItems.subjectTopicId, n: sql<number>`cast(count(*) as int)` })
          .from(recallItems)
          .where(
            and(
              eq(recallItems.userId, userId),
              inArray(recallItems.subjectTopicId, themenIds),
              isNull(recallItems.retiredAt),
            ),
          )
          .groupBy(recallItems.subjectTopicId),
        db
          .selectDistinct({ id: arbeitsblaetter.subjectTopicId })
          .from(arbeitsblaetter)
          .where(
            and(
              eq(arbeitsblaetter.userId, userId),
              inArray(arbeitsblaetter.subjectTopicId, themenIds),
              eq(arbeitsblaetter.status, "fertig"),
            ),
          ),
      ])
    : [[], []];
  const fragenZahl = new Map(fragen.map((f) => [f.id, Number(f.n)] as const));
  const mitBlatt = new Set(fertig.map((f) => f.id));

  return {
    id: fach.id,
    heute,
    name: fach.name,
    archiviert: fach.archived,
    istEpoche: fach.id === kal.epoche,
    sub: fach.archived ? "Archiviert" : fachSub(kal, heute, fach.id, true),
    offen: aufgaben.filter((a) => a.subjectId === fach.id && !a.done).map(aufgabeDaten),
    // wie die Liste „Klausuren“ (Antwort 11): kommende zuerst, vergangene bis
    // Tag 14 unten und blasser, danach nur noch im Archiv
    klausuren: klausurListe(
      klausuren
        .filter((k) => k.subjectId === fach.id)
        .map((k) => ({ id: k.id, fach: fach.name, datum: k.date, thema: klausurThema(k, titel.get(k.id) ?? []) })),
      heute,
    ).liste,
    themen: themen.map((t) => ({
      id: t.id,
      name: t.title,
      art: themaArt(t, fach),
      abgeleitet: artAbgeleitet(t, fach),
      fragen: fragenZahl.get(t.id) ?? 0,
      blatt: mitBlatt.has(t.id),
    })),
    // Nicht eingeordnete Blätter tragen ein geratenes Fach (Plan 3.8)
    blaetter: blaetter.filter((b) => !imKorb.has(b.id)).map(blattZeile),
  };
}
