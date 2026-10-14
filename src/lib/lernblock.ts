import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import { db } from "@/db";
import { examTopics, exams, studyBlocks, type StudyBlock } from "@/db/schema";
import { lernblockEreignisseLoeschen, protokollieren } from "@/lib/protokoll";
import { recallAttempts, recallItems } from "@/recall/schema";
import { faelligHeute, type FaelligerBaustein } from "@/recall/sessions";
import { versucheDesTages } from "@/recall/themen";

/**
 * Der Lernblock mit Uhr (Modell 23, Plan 3.5).
 *
 * Der Uhrstand liegt am Block selbst (`laeuft_seit`, `pausiert_seit`,
 * `pause_ms`), damit er Schließen, Neuladen und einen Neustart des Servers
 * übersteht. `laeuft_seit` ist nur Uhrstand: Lernblöcke haben **keine
 * Uhrzeit**, nichts davon wird je als Tageszeit angezeigt oder geplant.
 *
 * Die Rechnung ist dieselbe wie im Prototyp (`blockRest`, Z. 1360):
 * gelaufen = jetzt − Start − Pausen − (laufende Pause).
 */

/** Was die Uhr eines Blocks braucht — eine Teilmenge von `StudyBlock`. */
export type BlockUhr = Pick<
  StudyBlock,
  "minutes" | "status" | "laeuftSeit" | "pausiertSeit" | "pauseMs" | "minutenGelernt"
>;

export type BlockZustand = "ruhe" | "laeuft" | "pausiert" | "erledigt";

/**
 * Angefangen heißt: die Uhr lief schon einmal. Ein angefangener Block
 * übersteht jedes Neuplanen (`generatePlan`, `catchUpMissed`,
 * `moveOffFreeDays`, `setTopics` behandeln ihn wie erledigt).
 */
export function blockAngefangen(
  block: Pick<StudyBlock, "laeuftSeit" | "pauseMs">,
): boolean {
  return block.laeuftSeit !== null || block.pauseMs > 0;
}

export function blockZustand(block: BlockUhr): BlockZustand {
  if (block.status === "done") return "erledigt";
  if (!block.laeuftSeit) return "ruhe";
  return block.pausiertSeit ? "pausiert" : "laeuft";
}

/** Gesamtdauer des Blocks in Millisekunden. */
export function blockGesamtMs(block: Pick<StudyBlock, "minutes">): number {
  return block.minutes * 60_000;
}

/** Gelaufene Zeit in Millisekunden, Pausen abgezogen. */
export function blockGelaufenMs(block: BlockUhr, now: Date): number {
  if (!block.laeuftSeit) return 0;
  const jetzt = now.getTime();
  const offenePause = block.pausiertSeit
    ? Math.max(0, jetzt - block.pausiertSeit.getTime())
    : 0;
  return Math.max(
    0,
    jetzt - block.laeuftSeit.getTime() - block.pauseMs - offenePause,
  );
}

/** Restzeit in Millisekunden, nie unter 0. Ein erledigter Block steht. */
export function blockRest(block: BlockUhr, now: Date): number {
  const gesamt = blockGesamtMs(block);
  if (block.status === "done") {
    return block.minutenGelernt === null
      ? 0
      : Math.max(0, gesamt - block.minutenGelernt * 60_000);
  }
  return Math.max(0, gesamt - blockGelaufenMs(block, now));
}

/** Volle gelernte Minuten (wie `blockMinuten` im Prototyp). */
export function blockMinuten(block: BlockUhr, now: Date): number {
  return Math.floor(
    Math.min(blockGesamtMs(block), blockGelaufenMs(block, now)) / 60_000,
  );
}

/** „24:12“ — Minuten und Sekunden der Restzeit, aufgerundet auf die Sekunde. */
export function fmtRest(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ── Schreiben ────────────────────────────────────────────────────────────────

async function eigenerBlock(userId: string, blockId: string) {
  const [zeile] = await db
    .select({ block: studyBlocks })
    .from(studyBlocks)
    .innerJoin(exams, eq(exams.id, studyBlocks.examId))
    .where(and(eq(studyBlocks.id, blockId), eq(exams.userId, userId)));
  if (!zeile) throw new Error("Lernblock nicht gefunden");
  return zeile.block;
}

async function uhrSchreiben(
  blockId: string,
  werte: Partial<Pick<StudyBlock, "laeuftSeit" | "pausiertSeit" | "pauseMs" | "minutenGelernt" | "status">>,
) {
  const [neu] = await db
    .update(studyBlocks)
    .set(werte)
    .where(eq(studyBlocks.id, blockId))
    .returning();
  return neu;
}

/**
 * Starten oder, wenn pausiert, fortsetzen. Ein laufender Block bleibt, wie er
 * ist. Gibt den neuen Stand zurück.
 */
export async function blockStarten(
  userId: string,
  blockId: string,
  now: Date,
  tag: string,
): Promise<StudyBlock> {
  const block = await eigenerBlock(userId, blockId);
  const zustand = blockZustand(block);
  if (zustand === "pausiert") return blockFortsetzen(userId, blockId, now, tag);
  if (zustand !== "ruhe") return block;

  const neu = await uhrSchreiben(blockId, {
    laeuftSeit: now,
    pausiertSeit: null,
    pauseMs: 0,
  });
  await protokollieren(userId, tag, "lernblock_gestartet", blockId);
  return neu;
}

export async function blockPausieren(
  userId: string,
  blockId: string,
  now: Date,
  tag: string,
): Promise<StudyBlock> {
  const block = await eigenerBlock(userId, blockId);
  if (blockZustand(block) !== "laeuft") return block;
  const neu = await uhrSchreiben(blockId, { pausiertSeit: now });
  await protokollieren(userId, tag, "lernblock_pausiert", blockId);
  return neu;
}

export async function blockFortsetzen(
  userId: string,
  blockId: string,
  now: Date,
  tag: string,
): Promise<StudyBlock> {
  const block = await eigenerBlock(userId, blockId);
  if (blockZustand(block) !== "pausiert" || !block.pausiertSeit) return block;
  const neu = await uhrSchreiben(blockId, {
    pausiertSeit: null,
    pauseMs:
      block.pauseMs + Math.max(0, now.getTime() - block.pausiertSeit.getTime()),
  });
  await protokollieren(userId, tag, "lernblock_fortgesetzt", blockId);
  return neu;
}

export type BlockEnde =
  /** unter einer Minute: zurück auf Ruhe, keine Spur im Protokoll */
  | { art: "zurueck" }
  /** „Als erledigt zählen? n Minuten gelernt“ */
  | { art: "frage"; minuten: number };

/**
 * „Block beenden“. Unter einer Minute geht der Block auf Ruhe zurück, und die
 * Einträge `lernblock_*` dieses Tages verschwinden. Sonst fragt die
 * Oberfläche „Als erledigt zählen?“ und ruft danach `blockErledigt`.
 */
export async function blockBeenden(
  userId: string,
  blockId: string,
  now: Date,
  tag: string,
): Promise<BlockEnde> {
  const block = await eigenerBlock(userId, blockId);
  const minuten = blockMinuten(block, now);
  if (minuten >= 1) return { art: "frage", minuten };

  await uhrSchreiben(blockId, {
    laeuftSeit: null,
    pausiertSeit: null,
    pauseMs: 0,
  });
  await lernblockEreignisseLoeschen(userId, tag, blockId);
  return { art: "zurueck" };
}

/**
 * Der Block zählt als erledigt: Status `done`, die gelernten Minuten, ein
 * Eintrag `lernblock_erledigt` {n, perWH}. `perWH`: das Arbeitsblatt des
 * Blocks wurde beim Wiederholen ausgewertet, nicht im Block.
 */
export async function blockErledigt(
  userId: string,
  blockId: string,
  minuten: number,
  tag: string,
  perWH = false,
): Promise<{ block: StudyBlock; protokollId: string }> {
  await eigenerBlock(userId, blockId);
  const block = await uhrSchreiben(blockId, {
    status: "done",
    minutenGelernt: Math.max(0, Math.round(minuten)),
  });
  const protokollId = await protokollieren(
    userId,
    tag,
    "lernblock_erledigt",
    blockId,
    { n: block.minutenGelernt, perWH },
  );
  return { block, protokollId };
}

/**
 * „Nachholen“ auf der Klausurseite: Ein Block von einem vergangenen Tag, der
 * angefangen und nie beendet wurde, zählt als verpasst. Damit `catchUpMissed`
 * ihn verlegen darf (angefangene Blöcke lässt es sonst stehen, Plan 3.5),
 * geht seine Uhr zuerst zurück auf Ruhe. Das Protokoll jenes Tages bleibt.
 * Gibt die Zahl der zurückgesetzten Blöcke zurück.
 */
export async function vergangeneUhrenZuruecksetzen(
  userId: string,
  examId: string,
  vor: string,
): Promise<number> {
  const [klausur] = await db
    .select({ id: exams.id })
    .from(exams)
    .where(and(eq(exams.id, examId), eq(exams.userId, userId)));
  if (!klausur) return 0;
  const neu = await db
    .update(studyBlocks)
    .set({ laeuftSeit: null, pausiertSeit: null, pauseMs: 0 })
    .where(
      and(
        eq(studyBlocks.examId, examId),
        eq(studyBlocks.status, "open"),
        lt(studyBlocks.date, vor),
        or(isNotNull(studyBlocks.laeuftSeit), gt(studyBlocks.pauseMs, 0)),
      ),
    )
    .returning({ id: studyBlocks.id });
  return neu.length;
}

// ── Fragen im Block ──────────────────────────────────────────────────────────

/**
 * Die heute fälligen Fragen der Klausur dieses Blocks (Plan 3.5): aus
 * `faelligHeute`, gefiltert auf die Klausurthemen (`exam_topics.
 * subject_topic_id`) und auf Fragen, die an der Klausur selbst hängen
 * (`recall_items.exam_id`). Sortiert nach `exam_topics.sort_order`, innerhalb
 * eines Themas in der Reihenfolge von `faelligHeute`. Eine Frage, die hier
 * saß, ist auch für Wiederholen erledigt — beide schreiben denselben Termin.
 *
 * Was am App-Tag schon saß, fällt weg (dieselbe Regel wie in Wiederholen):
 * `faelligHeute` nimmt je Baustein den ältesten offenen Termin, und hat eine
 * Frage zwei überfällige Termine, rückte nach „Saß“ sofort der zweite nach.
 * Er kommt am nächsten Abend. Was heute danebenging, kommt wie bisher hinten
 * noch einmal.
 */
export async function fragenFuerLernblock(
  userId: string,
  blockId: string,
  heute: string,
): Promise<FaelligerBaustein[]> {
  const block = await eigenerBlock(userId, blockId);
  const themen = await db
    .select({
      subjectTopicId: examTopics.subjectTopicId,
      sortOrder: examTopics.sortOrder,
    })
    .from(examTopics)
    .where(eq(examTopics.examId, block.examId))
    .orderBy(asc(examTopics.sortOrder));

  const rang = new Map<string, number>();
  for (const t of themen) {
    if (t.subjectTopicId && !rang.has(t.subjectTopicId)) {
      rang.set(t.subjectTopicId, t.sortOrder);
    }
  }

  const [alleFaellig, versuche, gespeichert] = await Promise.all([
    faelligHeute(userId, heute),
    versucheDesTages(userId, heute),
    // `answered_on` ist der Tag beim Speichern; er gilt auch, wenn die Testuhr
    // auf einem anderen Tag steht als die Uhr der Datenbank (`created_at`)
    db
      .select({ itemId: recallAttempts.itemId })
      .from(recallAttempts)
      .where(and(eq(recallAttempts.userId, userId), eq(recallAttempts.answeredOn, heute), eq(recallAttempts.correct, true))),
  ]);
  const sassHeute = new Set(
    [...versuche.filter((v) => v.correct), ...gespeichert].flatMap((v) => (v.itemId ? [v.itemId] : [])),
  );
  const faellig = alleFaellig.filter((f) => !sassHeute.has(f.itemId));
  if (faellig.length === 0) return [];

  const zuordnung = await db
    .select({
      id: recallItems.id,
      subjectTopicId: recallItems.subjectTopicId,
      examId: recallItems.examId,
    })
    .from(recallItems)
    .where(
      and(
        eq(recallItems.userId, userId),
        inArray(
          recallItems.id,
          faellig.map((f) => f.itemId),
        ),
      ),
    );
  const jeFrage = new Map(zuordnung.map((z) => [z.id, z]));

  const ohneRang = Number.MAX_SAFE_INTEGER;
  return faellig
    .map((frage, i) => {
      const z = jeFrage.get(frage.itemId);
      const r =
        z?.subjectTopicId && rang.has(z.subjectTopicId)
          ? rang.get(z.subjectTopicId)!
          : z?.examId === block.examId
            ? ohneRang
            : null;
      return { frage, r, i };
    })
    .filter((x): x is { frage: FaelligerBaustein; r: number; i: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.frage);
}

/**
 * Der erste Versuch von heute (App-Tag) je Frage dieses Blocks: itemId →
 * gewusst. Daraus zählt das Blockende „n Fragen, … beim ersten Mal“ — aus
 * `recall_attempts`, nicht aus dem Speicher der Seite, damit die Zählung ein
 * Neuladen übersteht (Android beendet eine PWA im Hintergrund). Wie beim
 * Wiederholen (`themaTagesbericht`, UMSETZUNG 3.4 Nr. 6). „Fragen des Blocks“
 * heißt wie in `fragenFuerLernblock`: an einem Klausurthema oder an der
 * Klausur selbst; zurückgezogene Fragen zählen nicht (V2 6.4).
 */
export async function ersteVersucheImBlock(
  userId: string,
  blockId: string,
  heute: string,
): Promise<Record<string, boolean>> {
  const versuche = await versucheDesTages(userId, heute);
  const ids = [...new Set(versuche.flatMap((v) => (v.itemId ? [v.itemId] : [])))];
  if (ids.length === 0) return {};
  const block = await eigenerBlock(userId, blockId);
  const themen = await db
    .select({ subjectTopicId: examTopics.subjectTopicId })
    .from(examTopics)
    .where(eq(examTopics.examId, block.examId));
  const vokabeln = new Set(themen.flatMap((t) => (t.subjectTopicId ? [t.subjectTopicId] : [])));
  const zeilen = await db
    .select({ id: recallItems.id, subjectTopicId: recallItems.subjectTopicId, examId: recallItems.examId })
    .from(recallItems)
    .where(and(eq(recallItems.userId, userId), inArray(recallItems.id, ids), isNull(recallItems.retiredAt)));
  const imBlock = new Set(
    zeilen
      .filter((z) => (z.subjectTopicId && vokabeln.has(z.subjectTopicId)) || z.examId === block.examId)
      .map((z) => z.id),
  );
  const erste: Record<string, boolean> = {};
  for (const v of versuche) {
    if (!v.itemId || !imBlock.has(v.itemId) || v.itemId in erste) continue;
    erste[v.itemId] = v.correct;
  }
  return erste;
}
