import { and, asc, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { materialPages, materialTopics, subjectTopics, subjects } from "@/db/schema";
import { artAbgeleitet, themaArt } from "@/lib/themen-art";
import { recallItems } from "@/recall/schema";

import type { ThemaMitArt } from "./art-text";

/**
 * Die Themen eines Fachs mit ihrer Art — für die Zeilen „Abfragen | Üben“
 * auf der Fachseite (Prototyp `themaArtRow`, Z. 3203–3241; Kriterium 5).
 *
 * Gezeigt werden die Themen, die geübt werden: mit mindestens einer Frage
 * oder mit einer von Hand gesetzten Art. Ein Thema, das nur als Wort auf
 * einem Blatt steht, hat keine Art, die etwas bewirkt.
 */

export type { ThemaMitArt } from "./art-text";

export async function themenMitArt(userId: string, subjectId: string): Promise<ThemaMitArt[]> {
  const [fach] = await db
    .select({ name: subjects.name })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, subjectId)));
  if (!fach) return [];

  const themen = await db
    .select({ id: subjectTopics.id, title: subjectTopics.title, art: subjectTopics.art })
    .from(subjectTopics)
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.subjectId, subjectId), isNull(subjectTopics.mergedInto)))
    .orderBy(asc(subjectTopics.title));
  if (themen.length === 0) return [];
  const ids = themen.map((t) => t.id);

  const fragen = await db
    .select({ topic: recallItems.subjectTopicId, n: count() })
    .from(recallItems)
    .where(and(eq(recallItems.userId, userId), isNull(recallItems.retiredAt), inArray(recallItems.subjectTopicId, ids)))
    .groupBy(recallItems.subjectTopicId);
  const nJe = new Map(fragen.map((f) => [f.topic, Number(f.n)]));

  const quellen = await db
    .selectDistinct({ topic: materialTopics.subjectTopicId })
    .from(materialTopics)
    .innerJoin(materialPages, eq(materialPages.materialId, materialTopics.materialId))
    .where(
      and(
        inArray(materialTopics.subjectTopicId, ids),
        isNotNull(materialPages.transcript),
        ne(materialPages.transcript, ""),
      ),
    );
  const mitQuelle = new Set(quellen.map((q) => q.topic));

  return themen
    .filter((t) => (nJe.get(t.id) ?? 0) > 0 || t.art !== null)
    .map((t) => ({
      id: t.id,
      title: t.title,
      art: themaArt({ title: t.title, art: t.art ?? null }, fach),
      abgeleitet: artAbgeleitet(t, fach),
      fragen: nJe.get(t.id) ?? 0,
      hatQuelle: mitQuelle.has(t.id),
    }));
}
