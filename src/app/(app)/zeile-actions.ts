"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  abhakenZuruecknehmen,
  aufgabeAbhaken,
  aufgabeAendern,
  aufgabeEintragen,
  eintragenZuruecknehmen,
  type AufgabeEingabe,
} from "@/lib/kombi/aufgaben-zeile";
import { appTag, jetzt } from "@/lib/tag";

/**
 * Server Actions der Zeile (Plan 3.9, D): Eintragen, Abhaken, Ändern und ihr
 * Rückgängig. Sie geben ihr Ergebnis zurück und rufen **kein** `refresh()`
 * (Plan 2.4, Punkt 2) — die Zeile lädt danach gezielt Vorrat, TagDaten und
 * die oberste Stapelseite nach.
 *
 * Die Aufgaben-Actions der Startseite (Abschnitt B, `kombi-actions.ts`)
 * teilen dieselbe Bibliothek `src/lib/kombi/aufgaben-zeile.ts`.
 */

const id = z.uuid();
const eingabe = z.object({ subjectId: z.uuid(), title: z.string().trim().min(1).max(120), dueDate: z.iso.date() });

export async function aufgabeEintragenAction(e: AufgabeEingabe) {
  const user = await requireUser();
  const p = eingabe.safeParse(e);
  if (!p.success) return { ok: false as const, fehler: "Ungültig" };
  return aufgabeEintragen(user.id, appTag(await jetzt()), p.data);
}

export async function eintragenZuruecknehmenAction(aufgabeId: string, protokollId: string) {
  const user = await requireUser();
  if (!id.safeParse(aufgabeId).success || !id.safeParse(protokollId).success) return { ok: false as const, fehler: "Ungültig" };
  return eintragenZuruecknehmen(user.id, aufgabeId, protokollId);
}

export async function aufgabeAbhakenAction(aufgabeId: string, done: boolean) {
  const user = await requireUser();
  if (!id.safeParse(aufgabeId).success || typeof done !== "boolean") return { ok: false as const, fehler: "Ungültig" };
  return aufgabeAbhaken(user.id, appTag(await jetzt()), aufgabeId, done);
}

export async function abhakenZuruecknehmenAction(aufgabeId: string, done: boolean, protokollId: string) {
  const user = await requireUser();
  if (!id.safeParse(aufgabeId).success || !id.safeParse(protokollId).success || typeof done !== "boolean")
    return { ok: false as const, fehler: "Ungültig" };
  return abhakenZuruecknehmen(user.id, aufgabeId, done, protokollId);
}

export async function aufgabeAendernAction(aufgabeId: string, e: AufgabeEingabe) {
  const user = await requireUser();
  const p = eingabe.safeParse(e);
  if (!id.safeParse(aufgabeId).success || !p.success) return { ok: false as const, fehler: "Ungültig" };
  return aufgabeAendern(user.id, aufgabeId, p.data);
}
