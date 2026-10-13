import { and, eq, inArray, isNotNull, isNull, min, ne } from "drizzle-orm";

import { db } from "@/db";
import { materialPages, materialTopics, materials, subjectTopics } from "@/db/schema";
import { fachSprache } from "@/lib/arbeitsblatt/sprache";
import { grammatikFolge, type VorratGrammatik } from "@/lib/kombi/vorrat";
import { istGrammatikThema } from "@/lib/themen-art";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * Die Grammatikthemen für „Blatt Grammatik …“ in der Zeile (Antwort 5 vom
 * 13.10.2026). Nur lesen.
 *
 * Ein Grammatikthema ist ein Fach-Thema in Deutsch, Englisch oder
 * Französisch mit Grammatik-Stichwort im Titel, dessen geltende Art `ueben`
 * ist (`istGrammatikThema`, dieselbe Regel wie im Auftrag an Opus). Ein von
 * Hand auf „üben“ gestelltes Thema ohne Stichwort gehört nicht dazu. Mit
 * dabei ist es nur, wenn es mindestens ein Blatt mit Abschrift hat, denn ohne
 * Abschrift gibt es kein Arbeitsblatt. Zusammengelegte Themen zählen zu ihrem Ziel.
 *
 * Fällig heißt: der älteste offene Termin einer Frage des Themas oder seiner
 * Aliase; die Folge regelt `grammatikFolge`.
 */
export async function grammatikThemen(
  userId: string,
  faecher: readonly { id: string; name: string }[],
): Promise<VorratGrammatik[]> {
  const sprachFaecher = new Map(
    faecher.flatMap((f) => {
      const s = fachSprache(f.name);
      return s ? [[f.id, { name: f.name, sprache: s }] as const] : [];
    }),
  );
  if (sprachFaecher.size === 0) return [];

  const themen = await db
    .select({
      id: subjectTopics.id,
      subjectId: subjectTopics.subjectId,
      title: subjectTopics.title,
      art: subjectTopics.art,
      lastSeenAt: subjectTopics.lastSeenAt,
      mergedInto: subjectTopics.mergedInto,
    })
    .from(subjectTopics)
    .where(and(eq(subjectTopics.userId, userId), inArray(subjectTopics.subjectId, [...sprachFaecher.keys()])));
  if (themen.length === 0) return [];

  // Alias → Ziel (eine Stufe genügt: zusammengelegt wird immer ins eigenständige Thema)
  const ziel = new Map(themen.map((t) => [t.id, t.mergedInto ?? t.id]));
  const ids = themen.map((t) => t.id);

  const mitAbschrift = await db
    .selectDistinct({ id: materialTopics.subjectTopicId })
    .from(materialTopics)
    .innerJoin(materials, eq(materials.id, materialTopics.materialId))
    .innerJoin(materialPages, eq(materialPages.materialId, materials.id))
    .where(
      and(
        eq(materials.userId, userId),
        inArray(materialTopics.subjectTopicId, ids),
        isNotNull(materialPages.transcript),
        ne(materialPages.transcript, ""),
      ),
    );
  const belegt = new Set(mitAbschrift.map((z) => ziel.get(z.id) ?? z.id));
  if (belegt.size === 0) return [];

  const termine = await db
    .select({ topicId: recallItems.subjectTopicId, faellig: min(recallSchedule.dueOn) })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .where(and(eq(recallItems.userId, userId), isNull(recallSchedule.doneAt), inArray(recallItems.subjectTopicId, ids)))
    .groupBy(recallItems.subjectTopicId);
  const faellig = new Map<string, string>();
  for (const t of termine) {
    if (!t.topicId || !t.faellig) continue;
    const z = ziel.get(t.topicId) ?? t.topicId;
    const alt = faellig.get(z);
    if (!alt || t.faellig < alt) faellig.set(z, t.faellig);
  }

  const liste: VorratGrammatik[] = [];
  for (const t of themen) {
    if (t.mergedInto || !belegt.has(t.id)) continue;
    const fach = sprachFaecher.get(t.subjectId);
    if (!fach || !istGrammatikThema(t, { name: fach.name })) continue;
    liste.push({
      id: t.id,
      fachId: t.subjectId,
      name: t.title,
      sprache: fach.sprache,
      faellig: faellig.get(t.id) ?? null,
      zuletzt: t.lastSeenAt,
    });
  }
  return liste.sort(grammatikFolge);
}
