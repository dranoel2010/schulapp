"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { homework } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { requestCalendarSync } from "@/lib/calendar/sync";
import { deleteHomework, getHomework, setHomeworkDone } from "@/lib/homework";
import { wiederOeffnenZuruecknehmen } from "@/lib/kombi/aufgaben-zeile";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { ownsSubject } from "@/lib/materials";
import { protokollieren, protokollLoeschen } from "@/lib/protokoll";
import { jetzt } from "@/lib/tag";

/**
 * Die Actions der Aufgabenzeile auf den Nachschlage-Seiten (Hausaufgaben,
 * Woche, Fach; Prototyp `setDone`, `deleteTask`, Z. 1796–1820).
 *
 * Wie alle Actions der neuen Oberfläche rufen sie kein `refresh()` und kein
 * `revalidatePath()` auf: die Shell lädt die Seite danach gezielt nach (Plan
 * 2.4, Punkt 2). Jede stößt den Google-Kalender an — auch jedes Rückgängig
 * (Plan 3.9).
 */

const id = z.uuid();

/**
 * Abhaken oder wieder öffnen; gibt die Protokoll-ID für Rückgängig zurück,
 * beim Öffnen dazu das alte `doneAt`, damit Rückgängig es exakt zurückstellt.
 */
export async function aufgabeSetzenAction(
  aufgabeId: string,
  done: boolean,
): Promise<{ ok: boolean; protokollId?: string; doneAtVorher?: string | null }> {
  const user = await requireUser();
  const sauber = id.safeParse(aufgabeId);
  if (!sauber.success) return { ok: false };
  const alt = await getHomework(user.id, sauber.data);
  if (!alt) return { ok: false };
  const now = await jetzt();
  await setHomeworkDone(user.id, sauber.data, done, now);
  const protokollId = await protokollieren(
    user.id,
    appTagVon(now),
    done ? "aufgabe_abgehakt" : "aufgabe_geoeffnet",
    sauber.data,
  );
  requestCalendarSync(user.id);
  return { ok: true, protokollId, doneAtVorher: alt.doneAt ? alt.doneAt.toISOString() : null };
}

/** Rückgängig nach „Wieder öffnen“ im Archiv: das alte `doneAt` gilt wieder. */
export async function aufgabeWiederAbhakenAction(
  aufgabeId: string,
  doneAtVorher: string,
  protokollId: string | null,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const r = await wiederOeffnenZuruecknehmen(user.id, aufgabeId, doneAtVorher, protokollId, await jetzt());
  return { ok: r.ok };
}

/** Rückgängig nach dem Abhaken: wieder offen, Protokolleintrag weg. */
export async function aufgabeZuruecknehmenAction(
  aufgabeId: string,
  protokollId: string | null,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const sauber = id.safeParse(aufgabeId);
  if (!sauber.success) return { ok: false };
  await setHomeworkDone(user.id, sauber.data, false);
  if (protokollId && id.safeParse(protokollId).success) await protokollLoeschen(user.id, protokollId);
  requestCalendarSync(user.id);
  return { ok: true };
}

export type GeloeschteAufgabe = {
  id: string;
  subjectId: string;
  title: string;
  details: string | null;
  dueDate: string;
  doneAt: string | null;
  createdAt: string;
};

/** Löschen; die ganze Zeile kommt zurück, damit Rückgängig sie mit alter ID einsetzt (Plan 3.3). */
export async function aufgabeLoeschenAction(
  aufgabeId: string,
): Promise<{ ok: boolean; zeile?: GeloeschteAufgabe; protokollId?: string }> {
  const user = await requireUser();
  const sauber = id.safeParse(aufgabeId);
  if (!sauber.success) return { ok: false };
  const alt = await getHomework(user.id, sauber.data);
  if (!alt) return { ok: false };
  await deleteHomework(user.id, sauber.data);
  const protokollId = await protokollieren(user.id, appTagVon(await jetzt()), "aufgabe_geloescht", sauber.data);
  requestCalendarSync(user.id);
  return {
    ok: true,
    protokollId,
    zeile: {
      id: alt.id,
      subjectId: alt.subjectId,
      title: alt.title,
      details: alt.details,
      dueDate: alt.dueDate,
      doneAt: alt.doneAt ? alt.doneAt.toISOString() : null,
      createdAt: alt.createdAt.toISOString(),
    },
  };
}

const zeileSchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  details: z.string().max(2000).nullable(),
  dueDate: z.iso.date(),
  doneAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

/** Rückgängig nach dem Löschen: dieselbe Aufgabe mit derselben ID. */
export async function aufgabeWiederherstellenAction(
  zeile: GeloeschteAufgabe,
  protokollId: string | null,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const sauber = zeileSchema.safeParse(zeile);
  if (!sauber.success) return { ok: false };
  const z0 = sauber.data;
  if (!(await ownsSubject(user.id, z0.subjectId))) return { ok: false };
  const vorhanden = await db
    .select({ id: homework.id })
    .from(homework)
    .where(and(eq(homework.userId, user.id), eq(homework.id, z0.id)));
  if (vorhanden.length === 0) {
    await db.insert(homework).values({
      id: z0.id,
      userId: user.id,
      subjectId: z0.subjectId,
      title: z0.title,
      details: z0.details,
      dueDate: z0.dueDate,
      doneAt: z0.doneAt ? new Date(z0.doneAt) : null,
      createdAt: new Date(z0.createdAt),
    });
  }
  if (protokollId && id.safeParse(protokollId).success) await protokollLoeschen(user.id, protokollId);
  requestCalendarSync(user.id);
  return { ok: true };
}
