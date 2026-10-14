import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { homework } from "@/db/schema";
import { createHomework, deleteHomework, getHomework, homeworkInputSchema, setHomeworkDone, updateHomework } from "@/lib/homework";
import { nachAufgabeGeschrieben } from "@/lib/homework-nachlauf";
import { protokollieren, protokollLoeschen } from "@/lib/protokoll";

/**
 * Aufgaben aus der Zeile (Plan 3.9): Eintragen, Abhaken, Ändern und ihr
 * Rückgängig. Die Server Actions in `src/app/(app)/zeile-actions.ts` prüfen
 * nur die Anmeldung und rufen diese Funktionen; so lassen sie sich gegen den
 * Test-Harness prüfen.
 *
 * Jeder Weg stößt danach den Kalender an (`nachAufgabeGeschrieben`), auch
 * jedes Rückgängig. „Ändern“ schreibt kein Protokoll, wie im Prototyp.
 */

export type AufgabeEingabe = { subjectId: string; title: string; dueDate: string };

export type Ergebnis<T = object> = ({ ok: true } & T) | { ok: false; fehler: string };

export async function aufgabeEintragen(
  userId: string,
  tag: string,
  eingabe: AufgabeEingabe,
): Promise<Ergebnis<{ id: string; protokollId: string }>> {
  const p = homeworkInputSchema.safeParse({ ...eingabe, details: null });
  if (!p.success) return { ok: false, fehler: p.error.issues[0]?.message ?? "Ungültig" };
  try {
    const id = await createHomework(userId, p.data);
    const protokollId = await protokollieren(userId, tag, "aufgabe_eingetragen", id);
    nachAufgabeGeschrieben(userId);
    return { ok: true, id, protokollId };
  } catch {
    return { ok: false, fehler: "Nicht gespeichert" };
  }
}

/** Rückgängig nach dem Eintragen: die Aufgabe und ihr Protokolleintrag gehen wieder. */
export async function eintragenZuruecknehmen(userId: string, id: string, protokollId: string): Promise<Ergebnis> {
  await deleteHomework(userId, id);
  await protokollLoeschen(userId, protokollId);
  nachAufgabeGeschrieben(userId);
  return { ok: true };
}

export async function aufgabeAbhaken(
  userId: string,
  tag: string,
  id: string,
  done: boolean,
): Promise<Ergebnis<{ protokollId: string }>> {
  const a = await getHomework(userId, id);
  if (!a) return { ok: false, fehler: "Diese Aufgabe gibt es nicht mehr." };
  await setHomeworkDone(userId, id, done);
  const protokollId = await protokollieren(userId, tag, done ? "aufgabe_abgehakt" : "aufgabe_geoeffnet", id);
  nachAufgabeGeschrieben(userId);
  return { ok: true, protokollId };
}

/** Rückgängig nach dem Abhaken: alter Stand, Protokolleintrag weg. */
export async function abhakenZuruecknehmen(userId: string, id: string, done: boolean, protokollId: string): Promise<Ergebnis> {
  await setHomeworkDone(userId, id, done);
  await protokollLoeschen(userId, protokollId);
  nachAufgabeGeschrieben(userId);
  return { ok: true };
}

const zeitpunkt = z.iso.datetime();
const kennung = z.uuid();

/**
 * Rückgängig nach „Wieder öffnen“ im Archiv (Antwort 6): die Aufgabe bekommt
 * ihr altes `doneAt` zurück, nicht jetzt, und steht damit wieder im Archiv.
 *
 * Das alte `doneAt` kommt vom Gerät, also wird geprüft: ein gültiger
 * Zeitpunkt, nicht nach `jetzt`, die eigene Aufgabe, und sie ist noch offen.
 * Ist sie inzwischen wieder erledigt (anderer Tab), bleibt ihr neuerer Stand.
 */
export async function wiederOeffnenZuruecknehmen(
  userId: string,
  id: string,
  doneAtVorher: string,
  protokollId: string | null,
  jetzt: Date,
): Promise<Ergebnis> {
  if (!kennung.safeParse(id).success) return { ok: false, fehler: "Ungültig" };
  if (!zeitpunkt.safeParse(doneAtVorher).success) return { ok: false, fehler: "Ungültig" };
  const doneAt = new Date(doneAtVorher);
  if (doneAt.getTime() > jetzt.getTime()) return { ok: false, fehler: "Ungültig" };
  const a = await getHomework(userId, id);
  if (!a) return { ok: false, fehler: "Diese Aufgabe gibt es nicht mehr." };
  await db
    .update(homework)
    .set({ doneAt })
    .where(and(eq(homework.userId, userId), eq(homework.id, id), isNull(homework.doneAt)));
  if (protokollId && kennung.safeParse(protokollId).success) await protokollLoeschen(userId, protokollId);
  nachAufgabeGeschrieben(userId);
  return { ok: true };
}

export async function aufgabeAendern(userId: string, id: string, eingabe: AufgabeEingabe): Promise<Ergebnis> {
  const a = await getHomework(userId, id);
  if (!a) return { ok: false, fehler: "Diese Aufgabe gibt es nicht mehr." };
  const p = homeworkInputSchema.safeParse({ ...eingabe, details: a.details });
  if (!p.success) return { ok: false, fehler: p.error.issues[0]?.message ?? "Ungültig" };
  await updateHomework(userId, id, p.data);
  nachAufgabeGeschrieben(userId);
  return { ok: true };
}
