import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/db";
import { exams, materialPages, materials, subjects } from "@/db/schema";
import { todayInBerlin } from "@/lib/dates";
import { uncertainSpans } from "@/lib/transcripts";
import { planeFaelligkeiten } from "@/recall/schedule";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * Bausteine anlegen, auflisten, zurückziehen.
 *
 * ── Die Tür, an der A5 durchgesetzt wird ─────────────────────────────────────
 *
 * Der Bericht nennt die Quellbindung ausdrücklich das Einzige am Fragenbestand,
 * das KEINE Bauentscheidung ist: Jede Aufgabe stammt aus dem, was dieser
 * Schüler an diesem Vormittag aufgeschrieben oder abfotografiert hat. Die Zahl
 * dahinter ist unangenehm — maschinell erzeugte Fragen erreichen eine
 * Trennschärfe von 0,28 [0,21; 0,35], also unter dem Zielwert 0,3, bei drei
 * dokumentierten Halluzinationstypen.
 *
 * Deshalb steht die Prüfung hier und nicht im Formular. Ein Formular prüft
 * einen Weg; diese Funktion ist der einzige Weg. Wenn später ein Agent Fragen
 * vorschlägt (Stufe 1b), geht er durch dieselbe Tür — und nicht durch eine
 * zweite, die jemand vergessen hat gleich streng zu machen.
 *
 * Zwei Bedingungen, und die zweite ist die wichtigere:
 *
 *   1. Die Abschrift der Seite muss das Zitat WÖRTLICH enthalten.
 *   2. Das Zitat darf keine ⟨spitzen Klammern⟩ enthalten.
 *
 * Die Klammern markieren, was schon beim Abschreiben unsicher war. Eine Frage
 * darauf zu bauen hieße, eine Vermutung als Prüfstoff auszuliefern — und zwar
 * eine, die niemand mehr als Vermutung erkennt, sobald sie als Musterlösung
 * dasteht. Die Markierung steht schon im Text; sie muss nur gelesen werden.
 *
 * Abgewiesen wird, nicht abgeschnitten. Das ist dieselbe Haltung, mit der die
 * MCP-Werkzeuge eine zu lange Eingabe zurückweisen, statt sie stillschweigend
 * zu kürzen: Wer kürzt, liefert etwas aus, das niemand so gemeint hat.
 */

/**
 * Warum ein Baustein nicht angelegt werden konnte.
 *
 * Eine Aufzählung und keine freie Zeichenkette, damit die Oberfläche für jeden
 * Fall einen eigenen Satz hat — „ungültig" ist keine Auskunft.
 */
export type AnlageFehler =
  | "keine-seite"
  | "keine-abschrift"
  | "zitat-nicht-gefunden"
  | "zitat-unsicher";

export type NeuerBaustein = {
  /** Die Heftseite, aus der die Frage stammt */
  pageId: string;
  subjectId: string;
  subjectTopicId?: string | null;
  /** Die Frage im freien Format (A1) */
  promptFree: string;
  /** Dieselbe Frage mit Hinweisreiz und als Lückentext (A9), beide freiwillig */
  promptCue?: string | null;
  promptCloze?: string | null;
  /** Die Musterlösung, eine Sinneinheit je Zeile */
  solution: string;
  /** Ein bis zwei Sätze zur Verwechslung (A3, Teil drei) */
  misconception: string;
  /** Der Wortlaut aus der Abschrift, auf den sich die Frage stützt */
  sourceQuote: string;
  materialKind?: string;
  /** uebung | messung — beim Anlegen reserviert, nie nachträglich (A12) */
  role?: string;
};

export type AnlageErgebnis =
  | { ok: true; id: string; termine: number }
  | { ok: false; fehler: AnlageFehler };

/**
 * Die Seite samt Abschrift — und samt Nachweis, dass sie diesem Nutzer gehört.
 *
 * Der Verbund über `materials` steht hier aus demselben Grund wie in
 * `listMaterialTranscripts()`: An der Seite selbst hängt keine `userId`.
 */
async function seiteMitAbschrift(
  userId: string,
  pageId: string,
): Promise<{ transcript: string | null } | null> {
  const [zeile] = await db
    .select({ transcript: materialPages.transcript })
    .from(materialPages)
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialPages.materialId),
        eq(materials.userId, userId),
      ),
    )
    .where(eq(materialPages.id, pageId))
    .limit(1);

  return zeile ?? null;
}

/**
 * Die nächste Klausur in diesem Fach, oder null.
 *
 * Sie ist der harte Termin, gegen den geplant wird (A7). Kein fertiger
 * Wiederholungsalgorithmus kennt so etwas — sie kennen eine Zielbehaltensrate,
 * keinen Prüfungstag. Genau deshalb liegt die Planung hier und nicht in einer
 * Bibliothek.
 */
async function naechsteKlausur(
  userId: string,
  subjectId: string,
  heute: string,
): Promise<string | null> {
  const [zeile] = await db
    .select({ date: exams.date })
    .from(exams)
    .where(
      and(
        eq(exams.userId, userId),
        eq(exams.subjectId, subjectId),
        gte(exams.date, heute),
      ),
    )
    .orderBy(asc(exams.date))
    .limit(1);

  return zeile?.date ?? null;
}

/**
 * Einen Baustein anlegen und seine Termine gleich mitplanen.
 *
 * Beides in einem Schritt, weil ein Baustein ohne Termine nichts ist: Die
 * belegte Wirkung stammt aus der Zahl der Abrufgelegenheiten und ihrer
 * Verteilung, nicht aus dem Vorhandensein einer Frage. Ein Bestand, der sich
 * füllt, während der Terminplan leer bleibt, sähe nach Fortschritt aus und
 * wäre keiner.
 */
export async function createItem(
  userId: string,
  eingabe: NeuerBaustein,
  heute: string = todayInBerlin(),
): Promise<AnlageErgebnis> {
  const seite = await seiteMitAbschrift(userId, eingabe.pageId);
  if (!seite) return { ok: false, fehler: "keine-seite" };

  // NULL heißt „diese Seite hat noch niemand gelesen", der leere String heißt
  // „gelesen, und es stand nichts darauf". Beide taugen nicht als Quelle, aber
  // aus verschiedenen Gründen — und nur der erste lässt sich beheben.
  if (seite.transcript === null || seite.transcript.trim() === "") {
    return { ok: false, fehler: "keine-abschrift" };
  }

  const zitat = eingabe.sourceQuote.trim();
  if (!seite.transcript.includes(zitat)) {
    return { ok: false, fehler: "zitat-nicht-gefunden" };
  }
  if (uncertainSpans(zitat).length > 0) {
    return { ok: false, fehler: "zitat-unsicher" };
  }

  const klausurtag = await naechsteKlausur(userId, eingabe.subjectId, heute);
  const role = eingabe.role === "messung" ? "messung" : "uebung";

  const [angelegt] = await db
    .insert(recallItems)
    .values({
      userId,
      pageId: eingabe.pageId,
      subjectId: eingabe.subjectId,
      subjectTopicId: eingabe.subjectTopicId ?? null,
      promptFree: eingabe.promptFree.trim(),
      promptCue: eingabe.promptCue?.trim() || null,
      promptCloze: eingabe.promptCloze?.trim() || null,
      solution: eingabe.solution.trim(),
      misconception: eingabe.misconception.trim(),
      sourceQuote: zitat,
      sourceLength: seite.transcript.length,
      materialKind: eingabe.materialKind ?? "begriff",
      role,
    })
    .returning({ id: recallItems.id });

  // A12: Ein Baustein des Messvorrats bekommt NIEMALS einen Termin. Das ist
  // eine Eigenschaft der Planung und keine Filterregel beim Ausliefern — sonst
  // wäre die Trennung eine Absprache und keine Struktur.
  if (role === "messung") {
    return { ok: true, id: angelegt.id, termine: 0 };
  }

  const plan = planeFaelligkeiten({
    heute,
    aufgenommenAm: heute,
    klausurtag,
  });

  if (plan.faelligkeiten.length > 0) {
    await db.insert(recallSchedule).values(
      plan.faelligkeiten.map((f) => ({
        itemId: angelegt.id,
        dueOn: f.dueOn,
        round: f.round,
        mode: f.mode,
        sortOrder: f.sortOrder,
      })),
    );
  }

  return { ok: true, id: angelegt.id, termine: plan.faelligkeiten.length };
}

export type BausteinZeile = {
  id: string;
  promptFree: string;
  solution: string;
  misconception: string;
  sourceQuote: string;
  materialKind: string;
  role: string;
  retiredAt: Date | null;
  subjectName: string;
  subjectColor: string;
  offeneTermine: number;
};

/** Alle Bausteine des Nutzers, die neuesten zuerst. */
export async function listItems(userId: string): Promise<BausteinZeile[]> {
  const zeilen = await db
    .select({
      id: recallItems.id,
      promptFree: recallItems.promptFree,
      solution: recallItems.solution,
      misconception: recallItems.misconception,
      sourceQuote: recallItems.sourceQuote,
      materialKind: recallItems.materialKind,
      role: recallItems.role,
      retiredAt: recallItems.retiredAt,
      subjectName: subjects.name,
      subjectColor: subjects.color,
    })
    .from(recallItems)
    .innerJoin(subjects, eq(subjects.id, recallItems.subjectId))
    .where(eq(recallItems.userId, userId))
    .orderBy(desc(recallItems.createdAt));

  if (zeilen.length === 0) return [];

  // Die offenen Termine je Baustein in einer zweiten Abfrage statt als Verbund:
  // ein Verbund mit Gruppierung über zwei Tabellen liefert für einen Baustein
  // ohne Termine keine Zeile, und dann fehlte er in der Liste ganz.
  const termine = await db
    .select({ itemId: recallSchedule.itemId })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .where(and(eq(recallItems.userId, userId), isNull(recallSchedule.doneAt)));

  const offen = new Map<string, number>();
  for (const t of termine) offen.set(t.itemId, (offen.get(t.itemId) ?? 0) + 1);

  return zeilen.map((z) => ({ ...z, offeneTermine: offen.get(z.id) ?? 0 }));
}

/**
 * „Stand so nicht im Heft" — den Baustein zurückziehen (A5).
 *
 * Kein Löschen. Die Antworten darauf sind selbst ein Messwert, und Abschnitt 8
 * macht die Zahl dieser Meldungen zu einem Abnahmekriterium: Sie ist das
 * einzige Warnsignal dafür, dass der Fragenbestand auseinanderläuft. Ein
 * zurückgezogener Baustein verliert nur seine offenen Termine.
 */
export async function retireItem(
  userId: string,
  itemId: string,
  grund: string,
): Promise<boolean> {
  const [zeile] = await db
    .update(recallItems)
    .set({ retiredAt: new Date(), retiredReason: grund.trim() || "ohne Angabe" })
    .where(and(eq(recallItems.id, itemId), eq(recallItems.userId, userId)))
    .returning({ id: recallItems.id });

  if (!zeile) return false;

  await db
    .delete(recallSchedule)
    .where(and(eq(recallSchedule.itemId, itemId), isNull(recallSchedule.doneAt)));

  return true;
}
