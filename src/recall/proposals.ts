import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { exams, materialPages, materials, subjects } from "@/db/schema";
import { todayInBerlin } from "@/lib/dates";
import { createItem, type AnlageFehler } from "@/recall/items";
import { recallProposalItems, recallProposals } from "@/recall/schema";

/**
 * Vorschläge: was ein Agent an Fragen gebaut hat, und der Weg in den Bestand.
 *
 * ── Die eine Regel, die diese Datei durchsetzt ───────────────────────────────
 *
 * Ein Vorschlag wird nicht in den Bestand kopiert, sondern durch `createItem()`
 * geschickt — durch dieselbe Tür wie eine von Hand angelegte Frage. Damit gilt
 * die Quellbindung (A5) für den Agenten genauso: Das Zitat muss wörtlich in der
 * Abschrift stehen und darf keine ⟨spitze Klammer⟩ enthalten. Was durchfällt,
 * fällt durch, ganz gleich wer es vorgeschlagen hat.
 *
 * Das ist der Unterschied zwischen „die KI darf schreiben" und „die KI darf
 * vorschlagen". Der Bericht begründet ihn mit einer Zahl: Trennschärfe 0,28 bei
 * drei dokumentierten Halluzinationstypen. Eine erfundene Musterlösung kann
 * niemand gegen das Foto halten, wie man es bei einer Abschrift kann.
 *
 * ── Und die Regel, die sie NICHT durchsetzt ──────────────────────────────────
 *
 * Ob die Frage fachlich gut ist. Das kann kein Code prüfen. Deshalb liegt die
 * Liste dem Menschen vor, mit Frage, Musterlösung, Verwechslungssatz und Zitat
 * beieinander — damit die Entscheidung möglich ist, statt nur gefordert zu
 * werden.
 */

export type VorschlagsFrage = {
  pageId: string;
  subjectTopicId?: string | null;
  promptFree: string;
  solution: string;
  misconception: string;
  sourceQuote: string;
  materialKind?: string;
};

/**
 * Einen Vorschlag ablegen.
 *
 * Hier wird NICHT geprüft, ob die Zitate stimmen — das passiert beim
 * Übernehmen. Der Grund: Ein Vorschlag, dessen schwache Fragen schon beim
 * Ablegen verschwinden, verschweigt dem Menschen, was der Agent wirklich
 * geliefert hat. Die Zahl der abgewiesenen Fragen IST das Maß dafür, wie
 * zuverlässig er arbeitet; sie darf nicht stillschweigend auf null sinken.
 *
 * Geprüft wird nur, dass die Seite zu diesem Nutzer gehört. Ein Vorschlag auf
 * eine fremde Seite ist kein schwacher Vorschlag, sondern ein Angriff.
 */
export async function vorschlagAnlegen(
  userId: string,
  examId: string,
  fragen: readonly VorschlagsFrage[],
  note?: string | null,
): Promise<{ ok: true; proposalId: string; fragen: number } | { ok: false }> {
  const [klausur] = await db
    .select({ id: exams.id })
    .from(exams)
    .where(and(eq(exams.id, examId), eq(exams.userId, userId)))
    .limit(1);

  if (!klausur || fragen.length === 0) return { ok: false };

  // Alle Seiten in EINER Abfrage prüfen, nicht je Frage eine.
  const eigene = new Set(
    (
      await db
        .select({ id: materialPages.id })
        .from(materialPages)
        .innerJoin(
          materials,
          and(
            eq(materials.id, materialPages.materialId),
            eq(materials.userId, userId),
          ),
        )
    ).map((z) => z.id),
  );

  const erlaubt = fragen.filter((f) => eigene.has(f.pageId));
  if (erlaubt.length === 0) return { ok: false };

  const [vorschlag] = await db
    .insert(recallProposals)
    .values({ userId, examId, origin: "agent", note: note?.trim() || null })
    .returning({ id: recallProposals.id });

  await db.insert(recallProposalItems).values(
    erlaubt.map((f, i) => ({
      proposalId: vorschlag.id,
      pageId: f.pageId,
      subjectTopicId: f.subjectTopicId ?? null,
      sortOrder: i,
      promptFree: f.promptFree.trim(),
      solution: f.solution.trim(),
      misconception: f.misconception.trim(),
      sourceQuote: f.sourceQuote.trim(),
      materialKind: f.materialKind ?? "begriff",
    })),
  );

  return { ok: true, proposalId: vorschlag.id, fragen: erlaubt.length };
}

export type OffeneFrage = {
  id: string;
  pageId: string;
  promptFree: string;
  solution: string;
  misconception: string;
  sourceQuote: string;
  materialKind: string;
  /** Der Titel des Blattes, aus dem sie stammt — damit der Mensch weiß, wo er ist */
  blattTitel: string;
  seitenNummer: number;
};

export type OffenerVorschlag = {
  id: string;
  examId: string;
  klausurtag: string;
  subjectName: string;
  subjectColor: string;
  note: string | null;
  createdAt: Date;
  fragen: OffeneFrage[];
};

/** Die Vorschläge, die noch keiner durchgesehen hat, der neueste zuerst. */
export async function offeneVorschlaege(
  userId: string,
): Promise<OffenerVorschlag[]> {
  const koepfe = await db
    .select({
      id: recallProposals.id,
      examId: recallProposals.examId,
      klausurtag: exams.date,
      subjectName: subjects.name,
      subjectColor: subjects.color,
      note: recallProposals.note,
      createdAt: recallProposals.createdAt,
    })
    .from(recallProposals)
    .innerJoin(exams, eq(exams.id, recallProposals.examId))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .where(
      and(
        eq(recallProposals.userId, userId),
        isNull(recallProposals.settledAt),
      ),
    )
    .orderBy(desc(recallProposals.createdAt));

  if (koepfe.length === 0) return [];

  const zeilen = await db
    .select({
      id: recallProposalItems.id,
      proposalId: recallProposalItems.proposalId,
      pageId: recallProposalItems.pageId,
      promptFree: recallProposalItems.promptFree,
      solution: recallProposalItems.solution,
      misconception: recallProposalItems.misconception,
      sourceQuote: recallProposalItems.sourceQuote,
      materialKind: recallProposalItems.materialKind,
      sortOrder: recallProposalItems.sortOrder,
      blattTitel: materials.title,
      seitenNummer: materialPages.sortOrder,
    })
    .from(recallProposalItems)
    .innerJoin(
      recallProposals,
      eq(recallProposals.id, recallProposalItems.proposalId),
    )
    .innerJoin(materialPages, eq(materialPages.id, recallProposalItems.pageId))
    .innerJoin(materials, eq(materials.id, materialPages.materialId))
    .where(
      and(
        eq(recallProposals.userId, userId),
        isNull(recallProposals.settledAt),
        isNull(recallProposalItems.acceptedAt),
        isNull(recallProposalItems.rejectedReason),
      ),
    )
    .orderBy(asc(recallProposalItems.sortOrder));

  const jeVorschlag = new Map<string, OffeneFrage[]>();
  for (const z of zeilen) {
    const liste = jeVorschlag.get(z.proposalId) ?? [];
    liste.push({
      id: z.id,
      pageId: z.pageId,
      promptFree: z.promptFree,
      solution: z.solution,
      misconception: z.misconception,
      sourceQuote: z.sourceQuote,
      materialKind: z.materialKind,
      blattTitel: z.blattTitel,
      seitenNummer: z.seitenNummer + 1,
    });
    jeVorschlag.set(z.proposalId, liste);
  }

  return koepfe.map((k) => ({ ...k, fragen: jeVorschlag.get(k.id) ?? [] }));
}

export type UebernahmeErgebnis = {
  uebernommen: number;
  abgewiesen: Array<{ frage: string; grund: AnlageFehler }>;
  abgewaehlt: number;
};

/** Die Sätze, mit denen eine abgewiesene Frage im Protokoll stehen bleibt. */
const ABWEISUNG: Record<AnlageFehler, string> = {
  "keine-seite": "Die Seite gibt es nicht mehr.",
  "keine-abschrift": "Die Seite hat keine Abschrift.",
  "zitat-nicht-gefunden":
    "Das Zitat steht nicht wörtlich in der Abschrift — der Agent hat es nacherzählt.",
  "zitat-unsicher":
    "Das Zitat reicht in eine ⟨unsichere Stelle⟩ der Abschrift hinein.",
};

/**
 * Übernehmen: aus ausgewählten Vorschlägen werden Bausteine.
 *
 * ── Was hier NICHT passiert ──────────────────────────────────────────────────
 *
 * Kopieren. Jede Frage geht durch `createItem()`, und damit durch die
 * Quellbindung. Eine Frage, deren Zitat nicht wörtlich in der Abschrift steht,
 * wird abgewiesen und bleibt mit ihrem Grund stehen — nicht gelöscht. Denn die
 * Zahl dieser Abweisungen ist das einzige Maß dafür, wie zuverlässig der Agent
 * arbeitet, und ein Maß, das beim Aufräumen verschwindet, ist keines.
 *
 * Was der Mensch abgewählt hat, bekommt denselben Vermerk — mit einem anderen
 * Grund. Beides zusammen beantwortet später die Frage, ob sich der Agent lohnt.
 */
export async function vorschlagUebernehmen(
  userId: string,
  proposalId: string,
  gewaehlteIds: readonly string[],
  heute: string = todayInBerlin(),
): Promise<UebernahmeErgebnis | null> {
  const [vorschlag] = await db
    .select({ id: recallProposals.id, subjectId: exams.subjectId })
    .from(recallProposals)
    .innerJoin(exams, eq(exams.id, recallProposals.examId))
    .where(
      and(
        eq(recallProposals.id, proposalId),
        eq(recallProposals.userId, userId),
      ),
    )
    .limit(1);

  if (!vorschlag) return null;

  const fragen = await db
    .select()
    .from(recallProposalItems)
    .where(
      and(
        eq(recallProposalItems.proposalId, proposalId),
        isNull(recallProposalItems.acceptedAt),
        isNull(recallProposalItems.rejectedReason),
      ),
    )
    .orderBy(asc(recallProposalItems.sortOrder));

  const gewaehlt = new Set(gewaehlteIds);
  const ergebnis: UebernahmeErgebnis = {
    uebernommen: 0,
    abgewiesen: [],
    abgewaehlt: 0,
  };

  for (const frage of fragen) {
    if (!gewaehlt.has(frage.id)) {
      await db
        .update(recallProposalItems)
        .set({ rejectedReason: "Vom Menschen abgewählt." })
        .where(eq(recallProposalItems.id, frage.id));
      ergebnis.abgewaehlt += 1;
      continue;
    }

    const angelegt = await createItem(
      userId,
      {
        pageId: frage.pageId,
        subjectId: vorschlag.subjectId,
        subjectTopicId: frage.subjectTopicId,
        promptFree: frage.promptFree,
        solution: frage.solution,
        misconception: frage.misconception,
        sourceQuote: frage.sourceQuote,
        materialKind: frage.materialKind,
      },
      heute,
    );

    if (angelegt.ok) {
      await db
        .update(recallProposalItems)
        .set({ acceptedAt: new Date(), itemId: angelegt.id })
        .where(eq(recallProposalItems.id, frage.id));
      ergebnis.uebernommen += 1;
    } else {
      await db
        .update(recallProposalItems)
        .set({ rejectedReason: ABWEISUNG[angelegt.fehler] })
        .where(eq(recallProposalItems.id, frage.id));
      ergebnis.abgewiesen.push({
        frage: frage.promptFree,
        grund: angelegt.fehler,
      });
    }
  }

  await db
    .update(recallProposals)
    .set({ settledAt: new Date() })
    .where(eq(recallProposals.id, proposalId));

  return ergebnis;
}

/** Den ganzen Vorschlag wegräumen, ohne etwas zu übernehmen. */
export async function vorschlagVerwerfen(
  userId: string,
  proposalId: string,
): Promise<boolean> {
  const [zeile] = await db
    .update(recallProposals)
    .set({ settledAt: new Date() })
    .where(
      and(
        eq(recallProposals.id, proposalId),
        eq(recallProposals.userId, userId),
      ),
    )
    .returning({ id: recallProposals.id });

  if (!zeile) return false;

  await db
    .update(recallProposalItems)
    .set({ rejectedReason: "Der ganze Vorschlag wurde verworfen." })
    .where(
      and(
        eq(recallProposalItems.proposalId, proposalId),
        isNull(recallProposalItems.acceptedAt),
        isNull(recallProposalItems.rejectedReason),
      ),
    );

  return true;
}

export type ErledigteFrage = {
  promptFree: string;
  uebernommen: boolean;
  grund: string | null;
};

export type VorschlagsErgebnis = {
  id: string;
  subjectName: string;
  uebernommen: number;
  fragen: ErledigteFrage[];
};

/**
 * Was aus einem abgearbeiteten Vorschlag geworden ist.
 *
 * ── Warum das aus der Datenbank kommt und nicht aus dem Browser ──────────────
 *
 * Weil der Bericht im Browser nicht überleben kann. Am 12.9.2026 dreimal
 * gemessen: Jedes `revalidatePath()` in einer Server Action frischt die gerade
 * offene Route mit auf — egal, welcher Pfad angegeben ist. Die Vorschlagsliste
 * ist danach leer, die Seite zeigt ihren Leerzustand, und die Komponente mit
 * dem Bericht wird dabei ersetzt. Sichtbar blieb: „Kein Vorschlag im Eingang".
 * Unsichtbar wurde, dass eine Frage abgewiesen wurde, weil die KI ihr Zitat
 * nacherzählt hatte — die einzige Zahl, die beantwortet, ob man dem Agenten
 * trauen kann.
 *
 * Die Gründe liegen ohnehin in `rejected_reason`, aufgeschrieben beim
 * Übernehmen. Von dort gelesen, überlebt der Bericht auch ein Neuladen der
 * Seite, und man kann ihn sich später noch einmal ansehen.
 */
export async function vorschlagsErgebnis(
  userId: string,
  proposalId: string,
): Promise<VorschlagsErgebnis | null> {
  const [kopf] = await db
    .select({ id: recallProposals.id, subjectName: subjects.name })
    .from(recallProposals)
    .innerJoin(exams, eq(exams.id, recallProposals.examId))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .where(
      and(
        eq(recallProposals.id, proposalId),
        eq(recallProposals.userId, userId),
      ),
    )
    .limit(1);

  if (!kopf) return null;

  const zeilen = await db
    .select({
      promptFree: recallProposalItems.promptFree,
      acceptedAt: recallProposalItems.acceptedAt,
      rejectedReason: recallProposalItems.rejectedReason,
    })
    .from(recallProposalItems)
    .where(eq(recallProposalItems.proposalId, proposalId))
    .orderBy(asc(recallProposalItems.sortOrder));

  const fragen = zeilen.map((z) => ({
    promptFree: z.promptFree,
    uebernommen: z.acceptedAt !== null,
    grund: z.rejectedReason,
  }));

  return {
    id: kopf.id,
    subjectName: kopf.subjectName,
    uebernommen: fragen.filter((f) => f.uebernommen).length,
    fragen,
  };
}
