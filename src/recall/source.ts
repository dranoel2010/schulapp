import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { istId } from "@/recall/ids";

import { db } from "@/db";
import {
  examTopics,
  exams,
  materialPages,
  materialTopics,
  materials,
  subjects,
} from "@/db/schema";

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

/**
 * Ein Klausurthema und was dazu im Heft liegt.
 *
 * `verknuepft: false` heißt: Das Thema steht auf der Klausur nur als freier
 * Text und hängt an keiner Vokabel des Fachs. Von dort führt kein Weg zu
 * Blättern — nicht weil nichts da wäre, sondern weil niemand die Verbindung
 * hergestellt hat. Das muss die Oberfläche sagen können, sonst sieht ein
 * unverknüpftes Thema wie ein Thema ohne Stoff aus, und der Nutzer sucht den
 * Fehler bei seinen Blättern.
 */
export type KlausurThema = {
  examTopicId: string;
  title: string;
  /** Die Vokabel des Fachs dahinter — null, wenn das Thema freier Text ist */
  subjectTopicId: string | null;
  verknuepft: boolean;
  /** Die Seiten mit Abschrift, die über dieses Thema erreichbar sind */
  seiten: AbschriftSeite[];
};

export type KlausurStoff = {
  examId: string;
  klausurtag: string;
  kind: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  themen: KlausurThema[];
  /** Seiten über alle Themen, jede nur einmal — das ist der Vorrat für Fragen */
  seitenGesamt: AbschriftSeite[];
  zeichenGesamt: number;
};

/**
 * Der Stoff einer Klausur: von ihren Themen zu den Seiten, die daran hängen.
 *
 * ── Warum diese Richtung die richtige ist ────────────────────────────────────
 *
 * Man lernt für eine Klausur, nicht für einen Stapel. Die Klausur sagt, WAS
 * geprüft wird — ihre Themen sind der Schlüssel —, und darüber sind genau die
 * Blätter erreichbar, die dazugehören. Der umgekehrte Weg („wähle ein Blatt")
 * verlangt vom Schüler, selbst zu wissen, welches Blatt zu welchem Thema
 * gehört; das weiß die App längst.
 *
 * Die Kette bestand schon vollständig, bevor der Abrufkern existierte:
 * `exam_topics.subject_topic_id` → `subject_topics` ← `material_topics` →
 * `materials` → `material_pages.transcript`. Hier wird sie nur zum ersten Mal
 * in dieser Richtung gelesen.
 *
 * ── Zwei Fallen, die in den Daten liegen und nicht im Code ───────────────────
 *
 * Erstens: Ein Klausurthema ohne `subject_topic_id` ist freier Text. Es kommt
 * mit `verknuepft: false` zurück und ohne Seiten — nicht verschwiegen, sondern
 * benannt, damit die Oberfläche „dieses Thema ist mit keinem Blatt verbunden"
 * sagen kann statt „kein Stoff da".
 *
 * Zweitens: Hängt ein Thema im falschen Fach, findet diese Abfrage es nicht,
 * obwohl der Stoff existiert. Am 11.9.2026 in den echten Daten gemessen:
 * „El Niño", „Smart Cities", „Containerschifffahrt" und „Standortwahl" standen
 * unter Mathematik statt Geografie. Deshalb gibt `seitenGesamt` die Zahl her,
 * mit der man das sofort sieht — eine Geografie-Klausur mit null Seiten ist
 * kein leeres Heft, sondern ein falsch einsortiertes Thema.
 */
export async function stoffZuKlausur(
  userId: string,
  examId: string,
): Promise<KlausurStoff | null> {
  // Eine fehlgeformte id ist dasselbe wie eine, die es nicht gibt. Ohne diese
  // Zeile wirft Postgres — siehe @/recall/ids.
  if (!istId(examId)) return null;

  const [klausur] = await db
    .select({
      examId: exams.id,
      klausurtag: exams.date,
      kind: exams.kind,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectColor: subjects.color,
    })
    .from(exams)
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .where(and(eq(exams.id, examId), eq(exams.userId, userId)))
    .limit(1);

  if (!klausur) return null;

  const themenZeilen = await db
    .select({
      examTopicId: examTopics.id,
      title: examTopics.title,
      sortOrder: examTopics.sortOrder,
      subjectTopicId: examTopics.subjectTopicId,
    })
    .from(examTopics)
    .where(eq(examTopics.examId, examId))
    .orderBy(asc(examTopics.sortOrder));

  // Die Seiten je Vokabel in EINER Abfrage, nicht je Thema eine: Eine Klausur
  // mit zwölf Themen wären sonst zwölf Abfragen für dasselbe Ergebnis.
  const vokabeln = themenZeilen
    .map((t) => t.subjectTopicId)
    .filter((id): id is string => id !== null);

  const seitenJeVokabel = new Map<string, AbschriftSeite[]>();

  if (vokabeln.length > 0) {
    const zeilen = await db
      .select({
        subjectTopicId: materialTopics.subjectTopicId,
        pageId: materialPages.id,
        sortOrder: materialPages.sortOrder,
        transcript: materialPages.transcript,
      })
      .from(materialTopics)
      .innerJoin(materials, eq(materials.id, materialTopics.materialId))
      .innerJoin(materialPages, eq(materialPages.materialId, materials.id))
      .where(
        and(
          eq(materials.userId, userId),
          inArray(materialTopics.subjectTopicId, vokabeln),
          isNotNull(materialPages.transcript),
          ne(materialPages.transcript, ""),
        ),
      )
      .orderBy(asc(materialPages.sortOrder));

    for (const z of zeilen) {
      if (z.transcript === null) continue;
      const liste = seitenJeVokabel.get(z.subjectTopicId) ?? [];
      liste.push({
        pageId: z.pageId,
        sortOrder: z.sortOrder,
        transcript: z.transcript,
      });
      seitenJeVokabel.set(z.subjectTopicId, liste);
    }
  }

  const themen: KlausurThema[] = themenZeilen.map((t) => ({
    examTopicId: t.examTopicId,
    title: t.title,
    subjectTopicId: t.subjectTopicId,
    verknuepft: t.subjectTopicId !== null,
    seiten: t.subjectTopicId
      ? (seitenJeVokabel.get(t.subjectTopicId) ?? [])
      : [],
  }));

  // Eine Seite kann an mehreren Themen hängen und darf im Vorrat nur einmal
  // stehen — sonst zählt die Zeichenzahl doppelt und der Agent liest sie
  // zweimal, was zweimal kostet.
  const gesehen = new Set<string>();
  const seitenGesamt: AbschriftSeite[] = [];
  for (const thema of themen) {
    for (const seite of thema.seiten) {
      if (gesehen.has(seite.pageId)) continue;
      gesehen.add(seite.pageId);
      seitenGesamt.push(seite);
    }
  }

  return {
    ...klausur,
    themen,
    seitenGesamt,
    zeichenGesamt: seitenGesamt.reduce((s, p) => s + p.transcript.length, 0),
  };
}
