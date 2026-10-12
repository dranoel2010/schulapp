"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { protokollieren } from "@/lib/protokoll";
import { retireItem } from "@/recall/items";
import { urteilFesthalten, versuchFesthalten } from "@/recall/sessions";
import { appTagVon, istThemaSchluessel } from "@/recall/themen";

/**
 * Die Actions des Tisches beim Wiederholen (Modell 23, Plan E).
 *
 * Versuch und Urteil gehen unverändert durch `versuchFesthalten()` und
 * `urteilFesthalten()`, mit dem **Kalendertag** `todayInBerlin()` und nicht
 * dem App-Tag (Plan 3.1): `answered_on` und `gap_days` behalten so ihre
 * Bedeutung, und am Takt ändert sich nichts. „Saß“ setzt `done_at`, „Daneben“
 * lässt den Termin offen — genau wie bisher in `/abruf/sitzung`.
 *
 * Keine Action ruft `refresh()` oder `revalidatePath()` (Plan 2.4, Punkt 2):
 * der Tisch hält seinen Stand selbst, die Shell lädt danach gezielt nach.
 */

const id = z.uuid();

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

/** Den Versuch festhalten und erst dann die Lösung herausgeben (A2). */
export async function versuchThemaAction(
  scheduleId: string,
  itemId: string,
  antwort: string,
): Promise<VersuchAntwort> {
  const user = await requireUser();
  const p = z
    .object({ scheduleId: id, itemId: id, antwort: z.string().max(4000) })
    .safeParse({ scheduleId, itemId, antwort });
  if (!p.success) return { ok: false };

  const r = await versuchFesthalten(
    user.id,
    { scheduleId: p.data.scheduleId, itemId: p.data.itemId, answerText: p.data.antwort },
    todayInBerlin(),
  );
  if (!r.ok) return { ok: false };
  return {
    ok: true,
    attemptId: r.attemptId,
    loesung: r.solution
      .split("\n")
      .map((z) => z.trim())
      .filter(Boolean),
    verwechslung: r.misconception,
    zitat: r.sourceQuote,
    materialId: r.materialId,
  };
}

/** Das Urteil: „Saß“ schließt den Termin, „Daneben“ lässt ihn offen. */
export async function urteilThemaAction(attemptId: string, sass: boolean): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const p = z.object({ attemptId: id, sass: z.boolean() }).safeParse({ attemptId, sass });
  if (!p.success) return { ok: false };
  const r = await urteilFesthalten(user.id, p.data.attemptId, p.data.sass);
  return { ok: r.ok };
}

/** Themenende: Protokoll `thema_beendet` mit der Zahl der Fragen (Kriterium 57). */
export async function themaBeendenAction(key: string, n: number): Promise<{ ok: boolean; protokollId?: string }> {
  const user = await requireUser();
  const p = z
    .object({ key: z.string().refine(istThemaSchluessel), n: z.number().int().min(0).max(10_000) })
    .safeParse({ key, n });
  if (!p.success) return { ok: false };
  const protokollId = await protokollieren(user.id, appTagVon(new Date()), "thema_beendet", p.data.key, {
    n: p.data.n,
  });
  return { ok: true, protokollId };
}

/** „Stand so nicht im Heft“: die Frage zurückziehen, sie kommt nie wieder. */
export async function frageZurueckziehenAction(itemId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const p = id.safeParse(itemId);
  if (!p.success) return { ok: false };
  const ok = await retireItem(user.id, p.data, "Stand so nicht im Heft");
  if (ok) await protokollieren(user.id, appTagVon(new Date()), "frage_zurueckgezogen", p.data);
  return { ok };
}
