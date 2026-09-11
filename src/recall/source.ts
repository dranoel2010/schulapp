import { and, asc, desc, eq, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { materialPages, materials, subjects } from "@/db/schema";

/**
 * Die eine Andockstelle zur Schulapp.
 *
 * Der Abrufkern liest genau zwei Dinge aus dem Bestand: welche Heftseiten eine
 * Abschrift haben, und was darauf steht. Sonst nichts — kein Stundenplan, keine
 * Noten, keine Hausaufgaben. Diese Datei ist die Stelle, an der das steht, und
 * sie ist bewusst die einzige: Wird der Kern eines Tages herausgelöst, ist sie
 * die Datei, die neu geschrieben werden muss, und alle anderen unter
 * `src/recall/` bleiben, wie sie sind.
 *
 * Deshalb liest sie lesend und schreibt nie. Ein Abrufmodul, das am Bestand der
 * Schulapp etwas ändert, wäre kein Modul mehr, sondern ein zweiter Eigentümer
 * derselben Daten.
 *
 * ── Warum hier keine Funktion aus @/lib/materials aufgerufen wird ────────────
 *
 * Naheliegend wäre `listMaterialTranscripts()`. Sie tut fast das Richtige — nur
 * eben für ein einzelnes Blatt und mit einer Rückgabe, die der Ablage dient.
 * Sie hier zu benutzen hieße, den Kern an die Form einer fremden Rückgabe zu
 * binden: Ändert die Ablage ihre Felder, ändert sich das Abrufmodul mit, ohne
 * dass jemand es wollte. Zwei Abfragen auf dieselben Tabellen sind billiger als
 * eine geteilte Schnittstelle, die keiner der beiden gehört.
 */

export type AbschriftSeite = {
  pageId: string;
  sortOrder: number;
  transcript: string;
};

export type BlattMitAbschrift = {
  materialId: string;
  title: string;
  capturedOn: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  seiten: AbschriftSeite[];
};

/**
 * Alle Blätter, aus denen sich überhaupt Fragen bauen lassen.
 *
 * Das Kriterium ist die Abschrift und nicht das Foto: Eine Frage stützt sich
 * auf einen Wortlaut, den man zitieren kann (A5), und ein Bild ist kein
 * Wortlaut. Seiten ohne Abschrift fehlen deshalb, und Blätter, deren Seiten
 * alle ohne sind, tauchen gar nicht erst auf.
 *
 * Der leere String zählt dabei nicht als Abschrift. NULL heißt „diese Seite hat
 * noch niemand gelesen", der leere String heißt „gelesen, und es stand nichts
 * darauf" — für eine Frage taugt beides nicht, aber nur das erste lässt sich
 * durch Abschreiben beheben.
 */
export async function blaetterMitAbschrift(
  userId: string,
): Promise<BlattMitAbschrift[]> {
  const zeilen = await db
    .select({
      materialId: materials.id,
      title: materials.title,
      capturedOn: materials.capturedOn,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectColor: subjects.color,
      pageId: materialPages.id,
      sortOrder: materialPages.sortOrder,
      transcript: materialPages.transcript,
    })
    .from(materialPages)
    .innerJoin(materials, eq(materials.id, materialPages.materialId))
    .innerJoin(subjects, eq(subjects.id, materials.subjectId))
    .where(
      and(
        eq(materials.userId, userId),
        isNotNull(materialPages.transcript),
        ne(materialPages.transcript, ""),
      ),
    )
    .orderBy(desc(materials.capturedOn), asc(materialPages.sortOrder));

  const blaetter = new Map<string, BlattMitAbschrift>();

  for (const z of zeilen) {
    if (z.transcript === null) continue;

    const vorhanden = blaetter.get(z.materialId);
    const seite: AbschriftSeite = {
      pageId: z.pageId,
      sortOrder: z.sortOrder,
      transcript: z.transcript,
    };

    if (vorhanden) vorhanden.seiten.push(seite);
    else
      blaetter.set(z.materialId, {
        materialId: z.materialId,
        title: z.title,
        capturedOn: z.capturedOn,
        subjectId: z.subjectId,
        subjectName: z.subjectName,
        subjectColor: z.subjectColor,
        seiten: [seite],
      });
  }

  return [...blaetter.values()];
}

/** Ein einzelnes Blatt mit seinen abgeschriebenen Seiten, oder null. */
export async function blattMitAbschrift(
  userId: string,
  materialId: string,
): Promise<BlattMitAbschrift | null> {
  const alle = await blaetterMitAbschrift(userId);
  return alle.find((b) => b.materialId === materialId) ?? null;
}
