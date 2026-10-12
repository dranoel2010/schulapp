"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { homeworkInputSchema } from "@/lib/homework";
import {
  aufgabeAbhaken,
  aufgabeAendern,
  aufgabeEintragen,
  aufgabeLoeschen,
  aufgabeWiederherstellen,
  geloeschteZeileSchema,
  type GeloeschteZeile,
} from "@/lib/kombi/aufgaben";
import { appTag, jetzt } from "@/lib/tag";

/**
 * Die Actions der neuen Oberfläche (Modell 23, Plan 3.9).
 *
 * Alle prüfen die Sitzung (`requireUser`) und ihre Eingabe (zod). Keine ruft
 * `refresh()` oder `revalidatePath` auf: Die Shell lädt danach gezielt nach
 * (`/api/tag/daten`, oberste Stapelseite; Plan 2.4, Punkt 2). Sie geben nur
 * zurück, was der Client für Rückgängig braucht.
 *
 * Der Tag im Protokoll ist der App-Tag (Wechsel 04:00) der Uhr des Servers —
 * mit `SCHULAPP_TESTUHR` die Testuhr.
 */

const idSchema = z.uuid();
const optProtokoll = z.uuid().nullish();

async function appTagJetzt(): Promise<string> {
  return appTag(await jetzt());
}

export async function aufgabeEintragenAction(
  eingabe: z.input<typeof homeworkInputSchema>,
): Promise<{ ok: true; id: string; protokollId: string } | { ok: false; fehler: string }> {
  const user = await requireUser();
  const parsed = homeworkInputSchema.safeParse(eingabe);
  if (!parsed.success) return { ok: false, fehler: parsed.error.issues[0]?.message ?? "Ungültig" };
  try {
    const r = await aufgabeEintragen(user.id, await appTagJetzt(), parsed.data);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Nicht gespeichert" };
  }
}

/** Abhaken, wieder öffnen; mit `rueckgaengig` das Rückgängig aus dem Toast. */
export async function aufgabeAbhakenAction(eingabe: {
  id: string;
  done: boolean;
  rueckgaengig?: string | null;
}): Promise<{ ok: boolean; protokollId: string | null }> {
  const user = await requireUser();
  const id = idSchema.parse(eingabe.id);
  const done = z.boolean().parse(eingabe.done);
  const rueckgaengig = optProtokoll.parse(eingabe.rueckgaengig);
  return aufgabeAbhaken(user.id, await appTagJetzt(), id, done, rueckgaengig ?? null);
}

export async function aufgabeLoeschenAction(
  id: string,
): Promise<{ ok: true; zeile: GeloeschteZeile; protokollId: string } | { ok: false }> {
  const user = await requireUser();
  const r = await aufgabeLoeschen(user.id, await appTagJetzt(), idSchema.parse(id));
  return r ? { ok: true, ...r } : { ok: false };
}

/** Rückgängig nach „Gelöscht“: die Aufgabe kommt mit ihrer alten id zurück. */
export async function aufgabeWiederherstellenAction(
  zeile: GeloeschteZeile,
  protokollId: string,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await aufgabeWiederherstellen(user.id, geloeschteZeileSchema.parse(zeile), idSchema.parse(protokollId));
  return { ok: true };
}

export async function aufgabeAendernAction(
  id: string,
  eingabe: z.input<typeof homeworkInputSchema>,
): Promise<{ ok: boolean; fehler?: string }> {
  const user = await requireUser();
  const parsed = homeworkInputSchema.safeParse(eingabe);
  if (!parsed.success) return { ok: false, fehler: parsed.error.issues[0]?.message ?? "Ungültig" };
  return aufgabeAendern(user.id, idSchema.parse(id), parsed.data);
}
