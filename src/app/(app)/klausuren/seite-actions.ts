"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import {
  catchUpMissed,
  generatePlan,
  getExam,
  setBlockStatus,
  skipMissed,
} from "@/lib/exams";
import { neuPlanen } from "@/recall/items";

/**
 * Die Actions der Klausurseite im Stapel (Plan F, G): Lernblock abhaken und
 * zurücknehmen, Lernplan neu erstellen, verpasste Blöcke nachholen oder
 * auslassen und die Wiederholungstermine neu rechnen. Ohne `refresh()` und
 * ohne `revalidatePath()` — die Shell lädt die Seite danach nach (Plan 2.4).
 *
 * Der Takt der Wiederholung bleibt, wie er ist: „Termine neu rechnen“ ruft
 * das bestehende `neuPlanen()` (bisher auf /abruf), mehr nicht.
 */

const id = z.uuid();

export async function blockSchaltenAction(
  blockId: string,
  status: "open" | "done",
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(blockId).success) return { ok: false };
  if (status !== "open" && status !== "done") return { ok: false };
  await setBlockStatus(user.id, blockId, status);
  return { ok: true };
}

export async function lernplanNeuAction(examId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(examId).success) return { ok: false };
  if (!(await getExam(user.id, examId))) return { ok: false };
  await generatePlan(user.id, examId, todayInBerlin());
  return { ok: true };
}

export async function nachholenAction(examId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(examId).success) return { ok: false };
  await catchUpMissed(user.id, examId, todayInBerlin());
  return { ok: true };
}

export async function auslassenAction(examId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(examId).success) return { ok: false };
  await skipMissed(user.id, examId, todayInBerlin());
  return { ok: true };
}

export async function termineNeuAction(): Promise<{ ok: boolean; termine: number; bausteine: number }> {
  const user = await requireUser();
  const r = await neuPlanen(user.id, todayInBerlin());
  return { ok: true, ...r };
}
