import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  arbeitsblaetter,
  examTopics,
  exams,
  materialPages,
  materialTopics,
  materials,
  studyBlocks,
  subjects,
  tagesprotokoll,
  type ExamTopic,
  type StudyBlock,
} from "@/db/schema";
import { addDays } from "@/lib/dates";
import { klausurNamen, type VerpasstEintrag } from "@/lib/kombi/verpasst";
import { planEintragArt, planEintragTitel } from "@/lib/study-plan";
import { missedBlocks } from "@/lib/exams";
import { ersteVersucheImBlock, fragenFuerLernblock } from "@/lib/lernblock";
import { bloeckeAlsBlatt } from "@/lib/arbeitsblatt/quelle";

/**
 * Was die Oberfläche vom Lernblock wissen muss (Modell 23, Abschnitt F):
 * die Lernblockzeile im Überblick (Prototyp `ovKlausur`, `updateBlockUI`,
 * Z. 1970–2014), die Planzeilen der Klausurseite (`planRows`, Z. 3009) und
 * der Tisch im Block (`setHead`, `openMaterial`, Z. 4041–4176).
 *
 * Alles hier ist serialisierbar: Zeitpunkte als ISO-Text, keine
 * Drizzle-Objekte. Der Uhrstand (`laeuftSeit`, `pausiertSeit`, `pauseMs`)
 * reist mit, damit der Client die Restzeit selbst weiterzählt — er ist nur
 * Uhrstand und wird nie als Tageszeit angezeigt (Lernblöcke ohne Uhrzeit).
 */

/** Ein Planeintrag, wie ihn Überblick, Klausurseite und Tisch zeigen. */
export type BlockDaten = {
  id: string;
  examId: string;
  /** Tag des Blocks 'YYYY-MM-DD' */
  tag: string;
  minuten: number;
  art: "learn" | "review" | "probe";
  /** „Scheitelpunktform“, „Wiederholung“, „Probeklausur“ oder „Gesamtwiederholung“ (Plan 3.5) */
  titel: string;
  /** Das Klausurthema dahinter, falls es eins gibt */
  thema: string | null;
  status: "open" | "done" | "skipped";
  laeuftSeit: string | null;
  pausiertSeit: string | null;
  pauseMs: number;
  minutenGelernt: number | null;
  /** Das Arbeitsblatt des Blocks (Abschnitt H), falls eins gebaut wird */
  blatt: BlattStand | null;
  /**
   * Der Block ist nach der Art seines Themas ein Arbeitsblatt (`blockAlsBlatt`),
   * auch bevor das Blatt gebaut ist: Zusatz „mit Arbeitsblatt“ (Prototyp `lbDauer`).
   */
  alsBlatt: boolean;
};

export type BlattStand = {
  gedruckt: boolean;
  ausgewertet: boolean;
  fehlgeschlagen: boolean;
  /** beim Wiederholen ausgewertet, nicht im Block (Protokoll `lernblock_erledigt` {perWH}) */
  perWH: boolean;
};

/** Benennung der Planeinträge (Plan 3.5): ein Lernblock heißt nach seinem Thema. */
export function blockTitel(art: string, thema: string | null): string {
  return planEintragTitel(art, thema);
}

type BlockZeile = StudyBlock & { topic: ExamTopic | null };

export function blockDaten(block: BlockZeile, blatt: BlattStand | null = null, alsBlatt = false): BlockDaten {
  const art = block.kind === "review" || block.kind === "probe" ? block.kind : "learn";
  const status = block.status === "done" || block.status === "skipped" ? block.status : "open";
  return {
    id: block.id,
    examId: block.examId,
    tag: block.date,
    minuten: block.minutes,
    art,
    titel: blockTitel(art, block.topic?.title ?? null),
    thema: block.topic?.title ?? null,
    status,
    laeuftSeit: block.laeuftSeit ? block.laeuftSeit.toISOString() : null,
    pausiertSeit: block.pausiertSeit ? block.pausiertSeit.toISOString() : null,
    pauseMs: block.pauseMs,
    minutenGelernt: block.minutenGelernt,
    blatt,
    alsBlatt,
  };
}

/** `blockDaten` für mehrere Blöcke, mit Blattstand und Art aus je einer Abfrage. */
export async function blockDatenLaden(userId: string, bloecke: BlockZeile[]): Promise<BlockDaten[]> {
  const ids = bloecke.map((b) => b.id);
  const [staende, alsBlatt] = await Promise.all([blattStaende(userId, ids), bloeckeAlsBlatt(userId, bloecke)]);
  return bloecke.map((b) => blockDaten(b, staende.get(b.id) ?? null, alsBlatt.has(b.id)));
}

/** Der Stand der Arbeitsblätter je Block, in einer Abfrage. */
export async function blattStaende(
  userId: string,
  blockIds: string[],
): Promise<Map<string, BlattStand>> {
  const out = new Map<string, BlattStand>();
  if (blockIds.length === 0) return out;
  const zeilen = await db
    .select({
      blockId: arbeitsblaetter.studyBlockId,
      status: arbeitsblaetter.status,
      gedrucktAm: arbeitsblaetter.gedrucktAm,
      ausgewertetAm: arbeitsblaetter.ausgewertetAm,
    })
    .from(arbeitsblaetter)
    .where(and(eq(arbeitsblaetter.userId, userId), inArray(arbeitsblaetter.studyBlockId, blockIds)));
  const perWH = zeilen.some((z) => z.ausgewertetAm !== null)
    ? new Set(
        (
          await db
            .select({ ref: tagesprotokoll.ref })
            .from(tagesprotokoll)
            .where(
              and(
                eq(tagesprotokoll.userId, userId),
                eq(tagesprotokoll.typ, "lernblock_erledigt"),
                inArray(tagesprotokoll.ref, blockIds),
                sql`${tagesprotokoll.daten}->>'perWH' = 'true'`,
              ),
            )
        ).map((z) => z.ref),
      )
    : new Set<string | null>();
  for (const z of zeilen) {
    if (!z.blockId) continue;
    out.set(z.blockId, {
      gedruckt: z.gedrucktAm !== null,
      ausgewertet: z.ausgewertetAm !== null,
      fehlgeschlagen: z.status === "fehlgeschlagen",
      perWH: z.ausgewertetAm !== null && perWH.has(z.blockId),
    });
  }
  return out;
}

/** Name → Anzeigename, wie im Prototyp (Z. 1095–1100): „Mathe abgehakt“, „Bio“. */
const KURZ: Record<string, string> = { Mathematik: "Mathe", Biologie: "Bio" };
export const fachKurz = (name: string): string => KURZ[name] ?? name;

// ── Überblick: Klausur und Lernblockzeile ────────────────────────────────────

export type LernblockUeberblick = {
  /** Die nächste Klausur in ≤ 14 Tagen (Prototyp `klausurenBald()[0]`) */
  klausur: { id: string; fach: string; kurz: string; datum: string } | null;
  /** Der heutige Block dieser Klausur (Prototyp `planHeute()`), auch erledigt */
  heute: BlockDaten | null;
  /** Ohne Block heute: der nächste Block dieser Klausur, „Lernblock“ oder „Wiederholung“ (Prototyp `nx.art`) */
  naechster: { tag: string; art: string } | null;
  /**
   * Weitere Klausuren mit einem offenen Block heute (das alte /lernen zeigte
   * unter „Heute“ die Blöcke aller Klausuren). Je Klausur eine Zeile in der
   * Gestalt von „Und eine weitere …“: „Noch ein Lernblock heute: Mathe ›“,
   * bei zwei Klausuren im selben Fach mit dem Tag („Mathe So 18.10.“).
   */
  heuteWeitere: { examId: string; kurz: string }[];
  /** „Und eine weitere am Do 22.10.“ */
  weitere: { anzahl: number; datum: string } | null;
  /**
   * Verpasste offene Blöcke je Klausur (Plan 3.5). `name` ist null bei der
   * gezeigten Klausur, sonst das Fach („Englisch“), bei zwei Klausuren im
   * selben Fach mit dem Tag der Klausur („Mathe Sa 17.10.“).
   */
  verpasst: VerpasstEintrag[];
};

/**
 * Die Daten für den Klausur-Block des Überblicks. `tag` ist der App-Tag.
 * Ohne Klausur in den nächsten 14 Tagen und ohne verpassten Block: null.
 */
export async function lernblockUeberblick(
  userId: string,
  tag: string,
): Promise<LernblockUeberblick | null> {
  const bald = await db
    .select({ id: exams.id, datum: exams.date, fach: subjects.name })
    .from(exams)
    .innerJoin(subjects, and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)))
    .where(and(eq(exams.userId, userId), sql`${exams.date} > ${tag}`, lte(exams.date, addDays(tag, 14))))
    .orderBy(asc(exams.date), asc(exams.createdAt));

  const verpasstRoh = await missedBlocks(userId, tag);
  const jeKlausur = new Map<string, Omit<VerpasstEintrag, "name">>();
  for (const b of verpasstRoh) {
    const e = jeKlausur.get(b.examId) ?? {
      examId: b.examId,
      anzahl: 0,
      tag: b.date,
      kurz: fachKurz(b.subject.name),
      datum: b.exam.date,
    };
    e.anzahl += 1;
    if (b.date > e.tag) e.tag = b.date;
    jeKlausur.set(b.examId, e);
  }
  const verpasstOhneNamen = [...jeKlausur.values()];

  const k = bald[0] ?? null;
  let heute: BlockDaten | null = null;
  let naechster: LernblockUeberblick["naechster"] = null;

  if (k) {
    const zeilen = await db
      .select({ block: studyBlocks, topic: examTopics })
      .from(studyBlocks)
      .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
      .where(and(eq(studyBlocks.examId, k.id), ne(studyBlocks.status, "skipped"), gte(studyBlocks.date, tag)))
      .orderBy(asc(studyBlocks.date), asc(studyBlocks.sortOrder));
    const bloecke = zeilen.map((z) => ({ ...z.block, topic: z.topic ?? null }));
    const vonHeute = bloecke.filter((b) => b.date === tag);
    // Mehrere Blöcke heute: der erste offene, sonst der erste
    const ph = vonHeute.find((b) => b.status === "open") ?? vonHeute[0];
    if (ph) {
      [heute] = await blockDatenLaden(userId, [ph]);
    } else {
      const nx = bloecke.find((b) => b.date > tag && b.status === "open");
      if (nx) naechster = { tag: nx.date, art: planEintragArt(nx.kind) };
    }
  }

  // Offene Blöcke heute zu anderen Klausuren als der obersten
  const andere = await db
    .select({ examId: studyBlocks.examId, fach: subjects.name, datum: exams.date })
    .from(studyBlocks)
    .innerJoin(exams, and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .where(and(eq(studyBlocks.date, tag), eq(studyBlocks.status, "open"), sql`${exams.date} > ${tag}`))
    .orderBy(asc(exams.date), asc(exams.createdAt));
  const weitereRoh: { examId: string; kurz: string; datum: string }[] = [];
  for (const a of andere) {
    if (a.examId === k?.id || weitereRoh.some((h) => h.examId === a.examId)) continue;
    weitereRoh.push({ examId: a.examId, kurz: fachKurz(a.fach), datum: a.datum });
  }

  const { verpasst, heuteWeitere } = klausurNamen(verpasstOhneNamen, k ? { id: k.id, kurz: fachKurz(k.fach) } : null, weitereRoh);
  if (!k && verpasst.length === 0 && heuteWeitere.length === 0) return null;

  const rest = bald.slice(1);
  return {
    klausur: k ? { id: k.id, fach: k.fach, kurz: fachKurz(k.fach), datum: k.datum } : null,
    heute,
    naechster,
    weitere: rest.length ? { anzahl: rest.length, datum: rest[0].datum } : null,
    heuteWeitere,
    verpasst,
  };
}

// ── Tisch im Block ───────────────────────────────────────────────────────────

export type MaterialDaten = {
  id: string;
  titel: string;
  fach: string;
  seiten: number;
  /** Die Abschrift aller Seiten, in Absätze geteilt (leer: „Abschrift folgt“) */
  abschrift: string[];
};

/** Eine Karte im Block: nur die Frage, die Lösung kommt erst nach dem Versuch (A2). */
export type BlockFrage = {
  scheduleId: string;
  itemId: string;
  /** Text der Frage; `{…}` markiert eine Formel */
  frage: string;
  /** wie oft heute schon „Daneben“ */
  heuteDaneben: number;
};

export type LernblockTischDaten = {
  block: BlockDaten;
  /** „Mathematik · Klausur Fr 16.10.“ */
  fach: string;
  klausurDatum: string;
  /** Die heute offenen Fragen der Klausurthemen, ohne Lösung (A2) */
  fragen: BlockFrage[];
  /**
   * Heute (App-Tag) schon beantwortete Fragen des Blocks: itemId → beim
   * ersten Versuch gewusst. Für „n Fragen, … beim ersten Mal“ am Blockende,
   * auch nach einem Neuladen.
   */
  erste: Record<string, boolean>;
  material: MaterialDaten | null;
};

/**
 * Das Material des Blocks (Plan 3.5, „Material · Scheitelpunktform, 2 Seiten“):
 * das jüngste Blatt am Fach-Thema des Blocks; ohne eigenes Thema das jüngste
 * Blatt an einem Thema der Klausur.
 */
export async function materialFuerLernblock(
  userId: string,
  block: { examId: string; topicId: string | null },
): Promise<MaterialDaten | null> {
  const themen = await db
    .select({ id: examTopics.id, subjectTopicId: examTopics.subjectTopicId })
    .from(examTopics)
    .where(eq(examTopics.examId, block.examId))
    .orderBy(asc(examTopics.sortOrder));
  const eigenes = themen.find((t) => t.id === block.topicId)?.subjectTopicId ?? null;
  const vokabeln = eigenes
    ? [eigenes]
    : themen.map((t) => t.subjectTopicId).filter((id): id is string => id !== null);
  if (vokabeln.length === 0) return null;

  const [blatt] = await db
    .select({ id: materials.id })
    .from(materials)
    .innerJoin(materialTopics, eq(materialTopics.materialId, materials.id))
    .where(and(eq(materials.userId, userId), inArray(materialTopics.subjectTopicId, vokabeln)))
    .orderBy(desc(materials.capturedOn), desc(materials.createdAt))
    .limit(1);
  return blatt ? materialDaten(userId, blatt.id) : null;
}

/** Ein Blatt als Sheet auf dem Tisch: Titel, Fach, Seitenzahl, Abschrift in Absätzen. */
export async function materialDaten(userId: string, materialId: string): Promise<MaterialDaten | null> {
  const [blatt] = await db
    .select({ id: materials.id, titel: materials.title, fach: subjects.name })
    .from(materials)
    .innerJoin(subjects, eq(subjects.id, materials.subjectId))
    .where(and(eq(materials.userId, userId), eq(materials.id, materialId)))
    .limit(1);
  if (!blatt) return null;

  const seiten = await db
    .select({ transcript: materialPages.transcript })
    .from(materialPages)
    .where(eq(materialPages.materialId, blatt.id))
    .orderBy(asc(materialPages.sortOrder));

  return {
    id: blatt.id,
    titel: blatt.titel ?? "Blatt",
    fach: blatt.fach,
    seiten: seiten.length,
    abschrift: seiten
      .map((s) => s.transcript ?? "")
      .join("\n\n")
      .split(/\n\s*\n/)
      .map((a) => a.trim())
      .filter(Boolean),
  };
}

export async function lernblockTisch(
  userId: string,
  blockId: string,
  heute: string,
): Promise<LernblockTischDaten | null> {
  const [zeile] = await db
    .select({ block: studyBlocks, topic: examTopics, datum: exams.date, fach: subjects.name })
    .from(studyBlocks)
    .innerJoin(exams, and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(eq(studyBlocks.id, blockId))
    .limit(1);
  if (!zeile) return null;

  const [[block], fragen, material, erste] = await Promise.all([
    blockDatenLaden(userId, [{ ...zeile.block, topic: zeile.topic ?? null }]),
    fragenFuerLernblock(userId, blockId, heute),
    materialFuerLernblock(userId, zeile.block),
    ersteVersucheImBlock(userId, blockId, heute),
  ]);

  return {
    block,
    fach: zeile.fach,
    klausurDatum: zeile.datum,
    fragen: fragen.map((f) => ({
      scheduleId: f.scheduleId,
      itemId: f.itemId,
      frage: f.promptFree,
      heuteDaneben: f.heuteDaneben,
      // solution, misconception und sourceQuote stehen hier ABSICHTLICH nicht (A2)
    })),
    erste,
    material,
  };
}
