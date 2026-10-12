"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { subjects, subjectTopics } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { appTag, jetzt } from "@/lib/tag";
import { setArchived } from "@/lib/subjects";
import { themaArtSetzen, themaArtZuruecknehmen, type ArtUmstellung } from "@/lib/themen-art";

/**
 * Die Actions der Fachseite im Stapel: die Art eines Themas umstellen
 * (Prototyp `themaArtRow`, Z. 3203–3235; Protokoll `thema_art`, Rückgängig)
 * und ein archiviertes Fach wieder aufnehmen (Plan 2.2). Ohne Auffrischen der
 * Route — die Shell lädt nach (Plan 2.4).
 */

const id = z.uuid();
const art = z.enum(["abfragen", "ueben"]);

async function fachDesThemas(userId: string, topicId: string) {
  const [row] = await db
    .select({ name: subjects.name })
    .from(subjectTopics)
    .innerJoin(subjects, eq(subjects.id, subjectTopics.subjectId))
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, topicId)));
  return row ?? null;
}

export async function themaArtAction(
  topicId: string,
  neu: "abfragen" | "ueben",
): Promise<{ ok: boolean; umstellung?: ArtUmstellung }> {
  const user = await requireUser();
  if (!id.safeParse(topicId).success || !art.safeParse(neu).success) return { ok: false };
  const fach = await fachDesThemas(user.id, topicId);
  if (!fach) return { ok: false };
  const umstellung = await themaArtSetzen(user.id, topicId, neu, appTag(await jetzt()), fach);
  return { ok: true, umstellung };
}

export async function themaArtZurueckAction(
  topicId: string,
  umstellung: ArtUmstellung,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(topicId).success || !id.safeParse(umstellung.protokollId).success) return { ok: false };
  const vorher = umstellung.vorher === null ? null : art.safeParse(umstellung.vorher);
  if (vorher && !vorher.success) return { ok: false };
  await themaArtZuruecknehmen(user.id, topicId, { vorher: vorher ? vorher.data : null, protokollId: umstellung.protokollId });
  return { ok: true };
}

export async function wiederAufnehmenAction(subjectId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(subjectId).success) return { ok: false };
  await setArchived(user.id, subjectId, false);
  return { ok: true };
}
