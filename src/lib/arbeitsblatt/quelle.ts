import { and, asc, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import {
  examTopics,
  exams,
  materialPages,
  materialTopics,
  materials,
  studyBlocks,
  subjectTopics,
  subjects,
} from "@/db/schema";
import { themaArt } from "@/lib/themen-art";

/**
 * Woraus ein Arbeitsblatt gebaut wird (Modell 23, Plan 3.6 und H): die
 * Abschriften der Blätter eines Themas — oder, bei einem Lernblock ohne
 * Fach-Thema, die aller Klausurthemen mit Fach-Thema.
 *
 * Nur lesen. Die Kette ist dieselbe wie beim Stoff einer Klausur
 * (`stoffZuKlausur` in @/recall/source): `subject_topics` ← `material_topics`
 * → `materials` → `material_pages.transcript`. Ein Thema, das in ein anderes
 * zusammengelegt wurde (`merged_into`), zählt mit seinen Blättern zum Ziel.
 */

/** Höchstens so viele Zeichen Abschrift gehen in einen Auftrag — die jüngsten zuerst. */
export const QUELLE_MAX_ZEICHEN = 40_000;

export type QuellBlatt = {
  materialId: string;
  titel: string;
  /** `materials.captured_on`, 'YYYY-MM-DD' */
  datum: string;
  /** Die Abschriften der Seiten in ihrer Reihenfolge, ohne leere */
  seiten: string[];
};

export type Quelle = {
  fach: string;
  /** Titel des Themas; beim Block ohne Fach-Thema „Gesamtwiederholung“ */
  thema: string;
  blaetter: QuellBlatt[];
};

/** Die Themen-ids, deren Blätter zu `topicId` gehören: das Thema und seine Aliase. */
async function themenMitAliasen(userId: string, topicId: string): Promise<string[]> {
  const zeilen = await db
    .select({ id: subjectTopics.id })
    .from(subjectTopics)
    .where(
      and(
        eq(subjectTopics.userId, userId),
        or(eq(subjectTopics.id, topicId), eq(subjectTopics.mergedInto, topicId)),
      ),
    );
  return zeilen.map((z) => z.id);
}

/** Die Blätter mit Abschrift zu diesen Themen, die jüngsten zuerst, gedeckelt. */
async function blaetterZu(userId: string, topicIds: string[]): Promise<QuellBlatt[]> {
  if (topicIds.length === 0) return [];
  const zeilen = await db
    .select({
      materialId: materials.id,
      titel: materials.title,
      datum: materials.capturedOn,
      transcript: materialPages.transcript,
    })
    .from(materialTopics)
    .innerJoin(materials, eq(materials.id, materialTopics.materialId))
    .innerJoin(materialPages, eq(materialPages.materialId, materials.id))
    .where(
      and(
        eq(materials.userId, userId),
        inArray(materialTopics.subjectTopicId, topicIds),
        isNotNull(materialPages.transcript),
        ne(materialPages.transcript, ""),
      ),
    )
    .orderBy(desc(materials.capturedOn), asc(materials.id), asc(materialPages.sortOrder));

  const blaetter = new Map<string, QuellBlatt>();
  let zeichen = 0;
  for (const z of zeilen) {
    if (!z.transcript) continue;
    const vorhanden = blaetter.get(z.materialId);
    if (!vorhanden && zeichen >= QUELLE_MAX_ZEICHEN) break;
    zeichen += z.transcript.length;
    if (vorhanden) {
      vorhanden.seiten.push(z.transcript);
    } else {
      blaetter.set(z.materialId, {
        materialId: z.materialId,
        titel: z.titel,
        datum: z.datum,
        seiten: [z.transcript],
      });
    }
  }
  return [...blaetter.values()];
}

/** Die Quelle eines Themas — oder null, wenn es das Thema nicht gibt. */
export async function quelleFuerThema(userId: string, topicId: string): Promise<Quelle | null> {
  const [thema] = await db
    .select({ title: subjectTopics.title, fach: subjects.name })
    .from(subjectTopics)
    .innerJoin(subjects, eq(subjects.id, subjectTopics.subjectId))
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, topicId)));
  if (!thema) return null;
  const ids = await themenMitAliasen(userId, topicId);
  return { fach: thema.fach, thema: thema.title, blaetter: await blaetterZu(userId, ids) };
}

export type BlockZiel = {
  blockId: string;
  examId: string;
  /** Das Fach-Thema des Blocks — null bei Gesamtwiederholung oder freiem Klausurthema */
  subjectTopicId: string | null;
  /** Anzeige: „Scheitelpunktform“ oder null für „Gesamtwiederholung“ */
  themaTitel: string | null;
  fach: string;
  klausurtag: string;
  /** `study_blocks.kind`: learn | review */
  kind: string;
  /** Alle Fach-Themen der Klausur (für die Quelle eines Blocks ohne Thema) */
  klausurThemen: { subjectTopicId: string; title: string; art: "abfragen" | "ueben" }[];
};

/** Was ein Lernblock zum Arbeitsblatt wissen muss. Null, wenn es ihn nicht gibt. */
export async function blockZiel(userId: string, blockId: string): Promise<BlockZiel | null> {
  const [block] = await db
    .select({
      blockId: studyBlocks.id,
      examId: studyBlocks.examId,
      topicId: studyBlocks.topicId,
      kind: studyBlocks.kind,
      fach: subjects.name,
      klausurtag: exams.date,
    })
    .from(studyBlocks)
    .innerJoin(exams, eq(exams.id, studyBlocks.examId))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .where(and(eq(studyBlocks.id, blockId), eq(exams.userId, userId)));
  if (!block) return null;

  const themen = await db
    .select({
      id: examTopics.id,
      title: examTopics.title,
      subjectTopicId: examTopics.subjectTopicId,
      stTitle: subjectTopics.title,
      stArt: subjectTopics.art,
    })
    .from(examTopics)
    .leftJoin(subjectTopics, eq(subjectTopics.id, examTopics.subjectTopicId))
    .where(eq(examTopics.examId, block.examId))
    .orderBy(asc(examTopics.sortOrder));

  const eigenes = block.topicId ? themen.find((t) => t.id === block.topicId) : undefined;
  return {
    blockId: block.blockId,
    examId: block.examId,
    subjectTopicId: eigenes?.subjectTopicId ?? null,
    themaTitel: eigenes?.title ?? null,
    fach: block.fach,
    klausurtag: block.klausurtag,
    kind: block.kind,
    klausurThemen: themen
      .filter((t) => t.subjectTopicId !== null && t.stTitle !== null)
      .map((t) => ({
        subjectTopicId: t.subjectTopicId!,
        title: t.stTitle!,
        art: themaArt({ title: t.stTitle!, art: t.stArt ?? null }, { name: block.fach }),
      })),
  };
}

/**
 * Ist dieser Block ein Arbeitsblatt (Zusatz, Kriterium 4)? Mit eigenem
 * Fach-Thema: wenn dessen Art `ueben` ist. Ohne (Gesamtwiederholung, freies
 * Klausurthema): wenn der Stoff der Klausur aus Übungsthemen besteht — jedes
 * verknüpfte Klausurthema ist `ueben`, und es gibt mindestens eins. Die
 * Probeklausur ist immer ein Blatt.
 */
export function blockAlsBlatt(ziel: BlockZiel): boolean {
  // Die Probeklausur ist immer ein Blatt, in jedem Fach (Antwort 4 vom 13.10.2026)
  if (ziel.kind === "probe") return true;
  if (ziel.subjectTopicId) {
    const t = ziel.klausurThemen.find((k) => k.subjectTopicId === ziel.subjectTopicId);
    return t?.art === "ueben";
  }
  return ziel.klausurThemen.length > 0 && ziel.klausurThemen.every((t) => t.art === "ueben");
}

/** Die Quelle eines Lernblocks: sein Thema, sonst alle Klausurthemen mit Fach-Thema. */
export async function quelleFuerBlock(userId: string, ziel: BlockZiel): Promise<Quelle> {
  if (ziel.subjectTopicId && ziel.kind !== "probe") {
    const q = await quelleFuerThema(userId, ziel.subjectTopicId);
    if (q) return q;
  }
  const ids = new Set<string>();
  for (const t of ziel.klausurThemen) {
    for (const id of await themenMitAliasen(userId, t.subjectTopicId)) ids.add(id);
  }
  return {
    fach: ziel.fach,
    thema: ziel.kind === "probe" ? "Probeklausur" : (ziel.themaTitel ?? "Gesamtwiederholung"),
    blaetter: await blaetterZu(userId, [...ids]),
  };
}

/** Alle Abschriften einer Quelle, flach — für die Quellbindung. */
export function abschriftenDer(quelle: Quelle): string[] {
  return quelle.blaetter.flatMap((b) => b.seiten);
}
