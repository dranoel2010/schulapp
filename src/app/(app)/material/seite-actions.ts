"use server";

import { after } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { jetzt } from "@/lib/tag";
import { claudeConfigured } from "@/lib/claude/client";
import { markFiled } from "@/lib/inbox";
import {
  claudeKnopfMoeglich,
  claudeVonHandAnstossen,
  claudeVonHandVormerken,
} from "@/lib/leser/claude-leser";
import { deleteMaterial, getMaterial, ownsSubject, updateMaterial } from "@/lib/materials";

/**
 * Die Actions der Blattseite im Stapel (Plan 2.2, Zeile `blatt`): Fach
 * ändern, abschreiben lassen, zurück in den Eingangskorb, Blatt löschen. Wie
 * alle Actions der neuen Oberfläche ohne `refresh()`/`revalidatePath()` —
 * die Shell lädt danach gezielt nach (Plan 2.4, Punkt 2).
 */

const id = z.uuid();

/**
 * „Fach ändern“ (Prototyp `refileRow`): setzt das Fach und hakt das Blatt als
 * durchgesehen ab. Die Themen des alten Fachs fallen dabei ab (wie beim
 * Speichern im Formular); ohne Thema zeigt die Seite „Thema folgt“.
 */
export async function blattFachAction(
  materialId: string,
  subjectId: string,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(materialId).success || !id.safeParse(subjectId).success) return { ok: false };
  if (!(await ownsSubject(user.id, subjectId))) return { ok: false };
  const blatt = await getMaterial(user.id, materialId);
  if (!blatt) return { ok: false };
  const ok = await updateMaterial(user.id, materialId, {
    subjectId,
    title: blatt.title,
    capturedOn: blatt.capturedOn,
    note: blatt.note,
  });
  if (ok) await markFiled(user.id, materialId, true, await jetzt());
  return { ok };
}

/**
 * „Abschreiben lassen“ und „Erneut versuchen“: derselbe Weg wie bisher auf
 * der Blattseite (`abschreibenLassenAction`) — nur ohne Auffrischen der Route.
 */
export async function abschreibenAction(
  materialId: string,
  gesehen: string | null,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(materialId).success) return { ok: false };
  if (!(await getMaterial(user.id, materialId))) return { ok: false };
  if (claudeConfigured() && claudeKnopfMoeglich(materialId)) {
    claudeVonHandVormerken(user.id, materialId);
    after(() => claudeVonHandAnstossen(user.id, materialId, gesehen));
  }
  return { ok: true };
}

export async function inDenKorbAction(materialId: string, rein: boolean): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(materialId).success) return { ok: false };
  const r = await markFiled(user.id, materialId, !rein, await jetzt());
  return { ok: r !== "weg" };
}

export async function blattLoeschenAction(materialId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!id.safeParse(materialId).success) return { ok: false };
  return { ok: await deleteMaterial(user.id, materialId) };
}
