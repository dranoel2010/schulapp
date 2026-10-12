"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { examTopics, exams, studyBlocks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { catchUpMissed, generatePlan, getExam, setBlockStatus, skipMissed } from "@/lib/exams";
import {
  blockAngefangen,
  blockBeenden,
  blockErledigt,
  blockFortsetzen,
  blockPausieren,
  blockStarten,
  type BlockEnde,
} from "@/lib/lernblock";
import { blattStaende, blockDaten, lernblockTisch, type BlockDaten, type LernblockTischDaten } from "@/lib/kombi/lernblock-daten";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { lernblockEreignisseLoeschen } from "@/lib/protokoll";
import { neuPlanen } from "@/recall/items";

/**
 * Die Actions von Abschnitt F: Lernblock-Uhr (Start, Pause, Fortsetzen,
 * Beenden, Erledigt) und der Lernplan auf der Klausurseite (Abhaken,
 * Lernplan neu erstellen, Termine neu rechnen, Nachholen, Auslassen).
 *
 * Wie alle Actions der neuen Oberfläche rufen sie KEIN `refresh()` und kein
 * `revalidatePath()` auf (Plan 2.4, Punkt 2): sie geben den neuen Stand
 * zurück, die Shell lädt danach gezielt nach (`neuLaden`).
 *
 * Das Protokoll schreibt `@/lib/lernblock` mit dem App-Tag (Wechsel 04:00).
 * Pläne rechnen wie bisher auf /lernen mit dem Berliner Kalendertag.
 */

const id = z.uuid();

type Antwort<T> = ({ ok: true } & T) | { ok: false; fehler: string };

async function blockLesen(userId: string, blockId: string): Promise<BlockDaten | null> {
  const [zeile] = await db
    .select({ block: studyBlocks, topic: examTopics })
    .from(studyBlocks)
    .innerJoin(exams, and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)))
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(eq(studyBlocks.id, blockId))
    .limit(1);
  if (!zeile) return null;
  const staende = await blattStaende(userId, [blockId]);
  return blockDaten({ ...zeile.block, topic: zeile.topic ?? null }, staende.get(blockId) ?? null);
}

/** Was der Tisch im Block braucht: Kopf, Uhr, Fragen (ohne Lösung), Material. */
export async function lernblockTischAction(
  blockId: string,
): Promise<Antwort<{ daten: LernblockTischDaten }>> {
  const user = await requireUser();
  const daten = await lernblockTisch(user.id, id.parse(blockId), todayInBerlin());
  if (!daten) return { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
  return { ok: true, daten };
}

/** Starten oder, wenn pausiert, fortsetzen (Prototyp `openTisch` im Block). */
export async function lernblockStartenAction(blockId: string): Promise<Antwort<{ block: BlockDaten }>> {
  const user = await requireUser();
  const now = new Date();
  await blockStarten(user.id, id.parse(blockId), now, appTagVon(now));
  const block = await blockLesen(user.id, blockId);
  return block ? { ok: true, block } : { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
}

/** Die Uhr antippen: anhalten oder weiterlaufen lassen. */
export async function lernblockUhrAction(
  blockId: string,
  was: "pause" | "weiter",
): Promise<Antwort<{ block: BlockDaten }>> {
  const user = await requireUser();
  const now = new Date();
  const tag = appTagVon(now);
  if (z.enum(["pause", "weiter"]).parse(was) === "pause") await blockPausieren(user.id, id.parse(blockId), now, tag);
  else await blockFortsetzen(user.id, id.parse(blockId), now, tag);
  const block = await blockLesen(user.id, blockId);
  return block ? { ok: true, block } : { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
}

/**
 * „Block beenden“: unter einer Minute zurück auf Ruhe ohne Spur im Protokoll,
 * sonst die Frage „Als erledigt zählen?“ mit den gelernten Minuten.
 */
export async function lernblockBeendenAction(
  blockId: string,
): Promise<Antwort<{ ende: BlockEnde; block: BlockDaten }>> {
  const user = await requireUser();
  const now = new Date();
  const ende = await blockBeenden(user.id, id.parse(blockId), now, appTagVon(now));
  const block = await blockLesen(user.id, blockId);
  return block ? { ok: true, ende, block } : { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
}

/** „Als erledigt zählen?“ → Ja. */
export async function lernblockErledigtAction(
  blockId: string,
  minuten: number,
): Promise<Antwort<{ block: BlockDaten }>> {
  const user = await requireUser();
  const now = new Date();
  await blockErledigt(user.id, id.parse(blockId), z.number().int().min(0).max(600).parse(minuten), appTagVon(now));
  const block = await blockLesen(user.id, blockId);
  return block ? { ok: true, block } : { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
}

/**
 * Eine Planzeile abhaken oder wieder öffnen (Tipp oder Linkswisch auf der
 * Klausurseite, Plan F). So lässt sich ein gestriger Block ohne Uhr abhaken
 * und ein versehentlich erledigter wieder öffnen. Beim Wiederöffnen geht die
 * Uhr auf Ruhe zurück, und die Einträge `lernblock_*` des Tages zu diesem
 * Block verschwinden — sonst stünde der Block sofort auf „Zeit um“.
 * Ein laufender Block schaltet nicht per Tipp, er öffnet die Uhr.
 */
export async function blockStatusAction(
  blockId: string,
  status: "open" | "done",
): Promise<Antwort<{ block: BlockDaten }>> {
  const user = await requireUser();
  const bid = id.parse(blockId);
  const neu = z.enum(["open", "done"]).parse(status);
  const [zeile] = await db
    .select({ block: studyBlocks })
    .from(studyBlocks)
    .innerJoin(exams, and(eq(exams.id, studyBlocks.examId), eq(exams.userId, user.id)))
    .where(eq(studyBlocks.id, bid))
    .limit(1);
  if (!zeile) return { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
  if (neu === "done" && zeile.block.status === "open" && blockAngefangen(zeile.block)) {
    return { ok: false, fehler: "Der Block läuft." };
  }

  if (neu === "open") {
    await db
      .update(studyBlocks)
      .set({ status: "open", laeuftSeit: null, pausiertSeit: null, pauseMs: 0, minutenGelernt: null })
      .where(eq(studyBlocks.id, bid));
    await lernblockEreignisseLoeschen(user.id, appTagVon(new Date()), bid);
  } else {
    await setBlockStatus(user.id, bid, "done");
  }
  const block = await blockLesen(user.id, bid);
  return block ? { ok: true, block } : { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
}

/** „Lernplan neu erstellen“: erledigte, gestrichene und angefangene Blöcke bleiben. */
export async function lernplanNeuAction(examId: string): Promise<Antwort<{ bloecke: number }>> {
  const user = await requireUser();
  const exam = await getExam(user.id, id.parse(examId));
  if (!exam) return { ok: false, fehler: "Diese Prüfung gibt es nicht mehr." };
  const plan = await generatePlan(user.id, examId, todayInBerlin());
  return { ok: true, bloecke: plan.blocks.length };
}

/**
 * „Termine neu rechnen“ (bisher auf /abruf): legt die Wiederholungstermine
 * wieder vor die Klausur. Am Takt ändert sich nichts — `neuPlanen` rechnet mit
 * denselben Regeln wie beim Anlegen, Erledigtes bleibt stehen.
 */
export async function termineNeuAction(): Promise<Antwort<{ termine: number; bausteine: number }>> {
  const user = await requireUser();
  const r = await neuPlanen(user.id, todayInBerlin());
  return { ok: true, ...r };
}

/** Verpasste Blöcke: auf die Tage bis zur Klausur neu verteilen. */
export async function nachholenAction(examId: string): Promise<Antwort<object>> {
  const user = await requireUser();
  await catchUpMissed(user.id, id.parse(examId), todayInBerlin());
  return { ok: true };
}

/** Verpasste Blöcke ohne neuen Termin auslassen (gestrichen). */
export async function auslassenAction(examId: string): Promise<Antwort<object>> {
  const user = await requireUser();
  await skipMissed(user.id, id.parse(examId), todayInBerlin());
  return { ok: true };
}
