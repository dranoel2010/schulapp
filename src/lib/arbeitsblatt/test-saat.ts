import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import {
  examTopics,
  exams,
  materialPages,
  materialTopics,
  materials,
  studyBlocks,
  subjects,
  subjectTopics,
} from "@/db/schema";
import { db } from "@/db";
import type { ClaudeSender } from "@/lib/claude/client";
import { CLAUDE_MODELL } from "@/lib/claude/client";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * Saat für die Datenbank-Tests der Arbeitsblätter (nur Tests — `@/db` ist
 * dort die PGlite im Speicher aus @/test/db-harness). Kein Testfile selbst.
 */

const BILD = new Uint8Array([0xff, 0xd8, 0xff]);

export async function fachMitThema(
  userId: string,
  fach: string,
  thema: string,
  tag: string,
): Promise<{ subjectId: string; topicId: string }> {
  const [f] = await db
    .insert(subjects)
    .values({ userId, name: fach, short: fach.slice(0, 1) })
    .returning({ id: subjects.id });
  const [t] = await db
    .insert(subjectTopics)
    .values({ userId, subjectId: f.id, title: thema, matchKey: thema.toLowerCase(), lastSeenAt: tag })
    .returning({ id: subjectTopics.id });
  return { subjectId: f.id, topicId: t.id };
}

export async function blattMitAbschrift(
  userId: string,
  subjectId: string,
  topicId: string,
  titel: string,
  datum: string,
  abschrift: string,
): Promise<string> {
  const [m] = await db
    .insert(materials)
    .values({ userId, subjectId, title: titel, capturedOn: datum })
    .returning({ id: materials.id });
  await db.insert(materialPages).values({
    materialId: m.id,
    width: 10,
    height: 10,
    byteSize: 3,
    image: BILD,
    reading: BILD,
    thumb: BILD,
    transcript: abschrift,
  });
  await db.insert(materialTopics).values({ materialId: m.id, subjectTopicId: topicId });
  return m.id;
}

/** Eine Frage mit Terminen an den genannten Tagen. */
export async function frageMitTerminen(
  userId: string,
  subjectId: string,
  topicId: string,
  termine: string[],
  examId: string | null = null,
): Promise<string> {
  const [i] = await db
    .insert(recallItems)
    .values({
      userId,
      subjectId,
      subjectTopicId: topicId,
      examId,
      promptFree: "Frage",
      solution: "Lösung",
      misconception: "Verwechslung",
      sourceQuote: "Zitat",
      sourceLength: 5,
    })
    .returning({ id: recallItems.id });
  for (const [n, dueOn] of termine.entries()) {
    await db.insert(recallSchedule).values({ itemId: i.id, dueOn, round: n + 1, sortOrder: n });
  }
  return i.id;
}

export async function klausurMitBlock(
  userId: string,
  subjectId: string,
  klausurtag: string,
  blocktag: string,
  topicId: string | null,
  mitBlockThema: boolean,
): Promise<{ examId: string; blockId: string }> {
  const [k] = await db
    .insert(exams)
    .values({ userId, subjectId, date: klausurtag })
    .returning({ id: exams.id });
  const [et] = await db
    .insert(examTopics)
    .values({ examId: k.id, title: "Scheitelpunktform", sortOrder: 0, subjectTopicId: topicId })
    .returning({ id: examTopics.id });
  const [b] = await db
    .insert(studyBlocks)
    .values({ examId: k.id, date: blocktag, minutes: 25, kind: mitBlockThema ? "learn" : "review", topicId: mitBlockThema ? et.id : null })
    .returning({ id: studyBlocks.id });
  return { examId: k.id, blockId: b.id };
}

/** Ein nachgemachter Sender, der immer dieselbe Antwort gibt, und die Zahl der Aufrufe. */
export function senderMit(antwort: unknown): { senden: ClaudeSender; aufrufe: () => number } {
  let n = 0;
  const senden: ClaudeSender = async (_anfrage, _signal, begonnen) => {
    n += 1;
    begonnen?.();
    return {
      id: "msg_erfunden",
      type: "message",
      role: "assistant",
      container: null,
      context_management: null,
      diagnostics: null,
      model: CLAUDE_MODELL,
      content: [{ type: "text", text: JSON.stringify(antwort), citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: {
        cache_creation: null,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        fallback_credit: null,
        inference_geo: null,
        input_tokens: 4000,
        iterations: null,
        output_tokens: 3000,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: "standard",
        speed: null,
      },
    } as unknown as BetaMessage;
  };
  return { senden, aufrufe: () => n };
}
