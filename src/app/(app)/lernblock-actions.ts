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
  vergangeneUhrenZuruecksetzen,
  type BlockEnde,
} from "@/lib/lernblock";
import {
  blockDatenLaden,
  lernblockTisch,
  materialDaten,
  type BlockDaten,
  type LernblockTischDaten,
  type MaterialDaten,
} from "@/lib/kombi/lernblock-daten";
import { appTag, jetzt, uhrVersatz } from "@/lib/tag";
import {
  lernblockEintraegeAbnehmen,
  lernblockEintraegeZurueck,
  protokollieren,
  type LernblockEintrag,
} from "@/lib/protokoll";
import { neuPlanen, retireItem } from "@/recall/items";
import { urteilFesthalten, versuchFesthalten } from "@/recall/sessions";

/**
 * Die Actions von Abschnitt F: Lernblock-Uhr (Start, Pause, Fortsetzen,
 * Beenden, Erledigt), die Karten im Block (Versuch, Urteil, Zurückziehen)
 * und der Lernplan auf der Klausurseite (Abhaken, Lernplan neu erstellen,
 * Termine neu rechnen, Nachholen, Auslassen).
 *
 * Wie alle Actions der neuen Oberfläche rufen sie KEIN `refresh()` und kein
 * `revalidatePath()` auf (Plan 2.4, Punkt 2): sie geben den neuen Stand
 * zurück, die Shell lädt danach gezielt nach (`neuLaden`).
 *
 * Tage (Plan 3.1): Lesen, Protokoll und Lernplan rechnen mit dem App-Tag
 * (Wechsel 04:00), damit Überblick, Klausurseite und Tisch zwischen 0 und
 * 4 Uhr denselben Tag meinen. Nur die Schreibwege des Abrufkerns
 * (`versuchFesthalten`, `neuPlanen`) bleiben beim Berliner Kalendertag.
 * Die Uhr ist überall `jetzt()`: ohne Testuhr `new Date()`, mit Testuhr die
 * Testuhr, auch für die Lernblock-Uhr und `answered_at`. Weil der Tisch die
 * Uhr im Gerät weiterzählt, geben die Uhr-Actions den Versatz der App-Uhr
 * zur Uhr des Rechners mit (`uhrVersatz`, ohne Testuhr 0).
 */

const id = z.uuid();

type Antwort<T> = ({ ok: true } & T) | { ok: false; fehler: string };

/** Ein Block mit dem Versatz der App-Uhr, für die Uhr im Tisch. */
type MitUhr<T> = Antwort<T & { uhrVersatz: number }>;

async function blockAntwort<T extends object>(
  userId: string,
  blockId: string,
  mehr: T,
): Promise<MitUhr<T & { block: BlockDaten }>> {
  const block = await blockLesen(userId, blockId);
  return block
    ? { ok: true, ...mehr, block, uhrVersatz: await uhrVersatz() }
    : { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
}

async function blockLesen(userId: string, blockId: string): Promise<BlockDaten | null> {
  const [zeile] = await db
    .select({ block: studyBlocks, topic: examTopics })
    .from(studyBlocks)
    .innerJoin(exams, and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)))
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(eq(studyBlocks.id, blockId))
    .limit(1);
  if (!zeile) return null;
  const [block] = await blockDatenLaden(userId, [{ ...zeile.block, topic: zeile.topic ?? null }]);
  return block;
}

/** Was der Tisch im Block braucht: Kopf, Uhr, Fragen (ohne Lösung), Material. */
export async function lernblockTischAction(
  blockId: string,
): Promise<MitUhr<{ daten: LernblockTischDaten }>> {
  const user = await requireUser();
  const daten = await lernblockTisch(user.id, id.parse(blockId), appTag(await jetzt()));
  if (!daten) return { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
  return { ok: true, daten, uhrVersatz: await uhrVersatz() };
}

/** „Blatt ansehen“ auf der Rückseite einer Karte: das Blatt als Sheet auf dem Tisch. */
export async function lernblockBlattAction(materialId: string): Promise<Antwort<{ blatt: MaterialDaten }>> {
  const user = await requireUser();
  const p = id.safeParse(materialId);
  const blatt = p.success ? await materialDaten(user.id, p.data) : null;
  return blatt ? { ok: true, blatt } : { ok: false, fehler: "Dieses Blatt gibt es nicht mehr." };
}

// ── Karten im Block ──────────────────────────────────────────────────────────

export type VersuchAntwort =
  | { ok: false }
  | {
      ok: true;
      attemptId: string;
      /** Musterlösung, eine Sinneinheit je Zeile — erst nach dem Versuch (A2) */
      loesung: string[];
      verwechslung: string;
      zitat: string;
      materialId: string | null;
    };

/**
 * Den Versuch festhalten und erst dann die Lösung herausgeben (A2). Derselbe
 * Weg wie beim Wiederholen: `versuchFesthalten()` mit dem Kalendertag. Eine
 * Frage, die hier „saß“, ist damit auch für Wiederholen erledigt
 * (Kriterium 47) — beide schreiben denselben Termin.
 */
export async function lernblockVersuchAction(
  scheduleId: string,
  itemId: string,
  antwort: string,
): Promise<VersuchAntwort> {
  const user = await requireUser();
  const p = z
    .object({ scheduleId: id, itemId: id, antwort: z.string().max(4000) })
    .safeParse({ scheduleId, itemId, antwort });
  if (!p.success) return { ok: false };

  const now = await jetzt();
  const r = await versuchFesthalten(
    user.id,
    { scheduleId: p.data.scheduleId, itemId: p.data.itemId, answerText: p.data.antwort },
    todayInBerlin(now),
    now,
  );
  if (!r.ok) return { ok: false };
  return {
    ok: true,
    attemptId: r.attemptId,
    loesung: r.solution
      .split("\n")
      .map((zeile) => zeile.trim())
      .filter(Boolean),
    verwechslung: r.misconception,
    zitat: r.sourceQuote,
    materialId: r.materialId,
  };
}

/** Das Urteil: „Saß“ schließt den Termin, „Daneben“ lässt ihn offen (Takt unverändert). */
export async function lernblockUrteilAction(attemptId: string, sass: boolean): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const p = z.object({ attemptId: id, sass: z.boolean() }).safeParse({ attemptId, sass });
  if (!p.success) return { ok: false };
  const r = await urteilFesthalten(user.id, p.data.attemptId, p.data.sass, await jetzt());
  return { ok: r.ok };
}

/** „Stand so nicht im Heft“: die Frage zurückziehen, sie kommt nie wieder. */
export async function lernblockZurueckziehenAction(itemId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const p = id.safeParse(itemId);
  if (!p.success) return { ok: false };
  const ok = await retireItem(user.id, p.data, "Stand so nicht im Heft");
  if (ok) await protokollieren(user.id, appTag(await jetzt()), "frage_zurueckgezogen", p.data);
  return { ok };
}

// ── Uhr ──────────────────────────────────────────────────────────────────────

/** Starten oder, wenn pausiert, fortsetzen (Prototyp `openTisch` im Block). */
export async function lernblockStartenAction(blockId: string): Promise<MitUhr<{ block: BlockDaten }>> {
  const user = await requireUser();
  const now = await jetzt();
  await blockStarten(user.id, id.parse(blockId), now, appTag(now));
  return blockAntwort(user.id, blockId, {});
}

/** Die Uhr antippen: anhalten oder weiterlaufen lassen. */
export async function lernblockUhrAction(
  blockId: string,
  was: "pause" | "weiter",
): Promise<MitUhr<{ block: BlockDaten }>> {
  const user = await requireUser();
  const now = await jetzt();
  const tag = appTag(now);
  if (z.enum(["pause", "weiter"]).parse(was) === "pause") await blockPausieren(user.id, id.parse(blockId), now, tag);
  else await blockFortsetzen(user.id, id.parse(blockId), now, tag);
  return blockAntwort(user.id, blockId, {});
}

/**
 * „Block beenden“: unter einer Minute zurück auf Ruhe ohne Spur im Protokoll,
 * sonst die Frage „Als erledigt zählen?“ mit den gelernten Minuten.
 */
export async function lernblockBeendenAction(
  blockId: string,
): Promise<MitUhr<{ ende: BlockEnde; block: BlockDaten }>> {
  const user = await requireUser();
  const now = await jetzt();
  const ende = await blockBeenden(user.id, id.parse(blockId), now, appTag(now));
  return blockAntwort(user.id, blockId, { ende });
}

/** „Als erledigt zählen?“ → Ja. */
export async function lernblockErledigtAction(
  blockId: string,
  minuten: number,
): Promise<MitUhr<{ block: BlockDaten }>> {
  const user = await requireUser();
  await blockErledigt(user.id, id.parse(blockId), z.number().int().min(0).max(600).parse(minuten), appTag(await jetzt()));
  return blockAntwort(user.id, blockId, {});
}

// ── Lernplan auf der Klausurseite ────────────────────────────────────────────

/** Was ein Wiederöffnen weggenommen hat — „Rückgängig“ setzt es wieder ein. */
export type BlockVorher = {
  minutenGelernt: number | null;
  laeuftSeit: string | null;
  pausiertSeit: string | null;
  pauseMs: number;
  eintraege: LernblockEintrag[];
};

/**
 * Eine Planzeile abhaken oder wieder öffnen (Tipp oder Linkswisch auf der
 * Klausurseite, Plan F). So lässt sich ein gestriger Block ohne Uhr abhaken
 * und ein versehentlich erledigter wieder öffnen. Beim Wiederöffnen geht die
 * Uhr auf Ruhe zurück, und die Einträge `lernblock_*` zu diesem Block
 * verschwinden — sonst stünde der Block sofort auf „Zeit um“. Was dabei
 * wegfällt (Minuten, Uhrstand, Einträge), kommt als `vorher` zurück;
 * „Rückgängig“ gibt es an `blockZurueckAction`.
 * Ein laufender Block schaltet nicht per Tipp, er öffnet die Uhr.
 */
export async function blockStatusAction(
  blockId: string,
  status: "open" | "done",
): Promise<Antwort<{ block: BlockDaten; vorher: BlockVorher | null }>> {
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

  let vorher: BlockVorher | null = null;
  if (neu === "open") {
    const alt = zeile.block;
    await db
      .update(studyBlocks)
      .set({ status: "open", laeuftSeit: null, pausiertSeit: null, pauseMs: 0, minutenGelernt: null })
      .where(eq(studyBlocks.id, bid));
    vorher = {
      minutenGelernt: alt.minutenGelernt,
      laeuftSeit: alt.laeuftSeit ? alt.laeuftSeit.toISOString() : null,
      pausiertSeit: alt.pausiertSeit ? alt.pausiertSeit.toISOString() : null,
      pauseMs: alt.pauseMs,
      eintraege: await lernblockEintraegeAbnehmen(user.id, bid),
    };
  } else {
    await setBlockStatus(user.id, bid, "done");
  }
  const block = await blockLesen(user.id, bid);
  return block ? { ok: true, block, vorher } : { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
}

const vorherSchema = z.object({
  minutenGelernt: z.number().int().min(0).max(600).nullable(),
  laeuftSeit: z.iso.datetime({ offset: true }).nullable(),
  pausiertSeit: z.iso.datetime({ offset: true }).nullable(),
  pauseMs: z.number().int().min(0),
  eintraege: z.array(z.unknown()),
});

/**
 * „Rückgängig“ nach dem Wiederöffnen eines erledigten Blocks: der alte Stand
 * kommt ganz zurück — erledigt, die gelernten Minuten, der Uhrstand und die
 * Einträge `lernblock_*` mit ihrer ID.
 */
export async function blockZurueckAction(
  blockId: string,
  vorher: BlockVorher,
): Promise<Antwort<{ block: BlockDaten }>> {
  const user = await requireUser();
  const bid = id.parse(blockId);
  const v = vorherSchema.parse(vorher);
  const [zeile] = await db
    .select({ id: studyBlocks.id })
    .from(studyBlocks)
    .innerJoin(exams, and(eq(exams.id, studyBlocks.examId), eq(exams.userId, user.id)))
    .where(eq(studyBlocks.id, bid))
    .limit(1);
  if (!zeile) return { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
  await db
    .update(studyBlocks)
    .set({
      status: "done",
      minutenGelernt: v.minutenGelernt,
      laeuftSeit: v.laeuftSeit ? new Date(v.laeuftSeit) : null,
      pausiertSeit: v.pausiertSeit ? new Date(v.pausiertSeit) : null,
      pauseMs: v.pauseMs,
    })
    .where(eq(studyBlocks.id, bid));
  await lernblockEintraegeZurueck(user.id, bid, v.eintraege);
  const block = await blockLesen(user.id, bid);
  return block ? { ok: true, block } : { ok: false, fehler: "Diesen Lernblock gibt es nicht." };
}

/** „Lernplan neu erstellen“: erledigte, gestrichene und angefangene Blöcke bleiben. */
export async function lernplanNeuAction(examId: string): Promise<Antwort<{ bloecke: number }>> {
  const user = await requireUser();
  const exam = await getExam(user.id, id.parse(examId));
  if (!exam) return { ok: false, fehler: "Diese Prüfung gibt es nicht mehr." };
  const plan = await generatePlan(user.id, examId, appTag(await jetzt()));
  return { ok: true, bloecke: plan.blocks.length };
}

/**
 * „Termine neu rechnen“ (bisher auf /abruf): legt die Wiederholungstermine
 * wieder vor die Klausur. Am Takt ändert sich nichts — `neuPlanen` rechnet mit
 * denselben Regeln wie beim Anlegen, Erledigtes bleibt stehen. Ein Schreibweg
 * des Abrufkerns, also mit dem Kalendertag (Plan 3.1).
 */
export async function termineNeuAction(): Promise<Antwort<{ termine: number; bausteine: number }>> {
  const user = await requireUser();
  const r = await neuPlanen(user.id, todayInBerlin(await jetzt()));
  return { ok: true, ...r };
}

/**
 * Verpasste Blöcke: auf die Tage bis zur Klausur neu verteilen. Ein gestern
 * angefangener und nie beendeter Block zählt als verpasst; seine Uhr geht
 * zuerst auf Ruhe, sonst ließe `catchUpMissed` ihn stehen.
 */
export async function nachholenAction(examId: string): Promise<Antwort<object>> {
  const user = await requireUser();
  const eid = id.parse(examId);
  const tag = appTag(await jetzt());
  await vergangeneUhrenZuruecksetzen(user.id, eid, tag);
  await catchUpMissed(user.id, eid, tag);
  return { ok: true };
}

/** Verpasste Blöcke ohne neuen Termin auslassen (gestrichen). */
export async function auslassenAction(examId: string): Promise<Antwort<object>> {
  const user = await requireUser();
  await skipMissed(user.id, id.parse(examId), appTag(await jetzt()));
  return { ok: true };
}
