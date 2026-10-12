import { z } from "zod";

import {
  createHomework,
  deleteHomework,
  getHomework,
  homeworkWiederherstellen,
  setHomeworkDone,
  updateHomework,
  type HomeworkInput,
} from "@/lib/homework";
import { nachAufgabeGeschrieben } from "@/lib/homework-nachlauf";
import { protokollieren, protokollLoeschen } from "@/lib/protokoll";

/**
 * Die Aufgaben-Wege der neuen Oberfläche (Modell 23, Plan 3.9) — Datenschicht
 * unter den Actions in `src/app/(app)/kombi-actions.ts`, damit sie sich ohne
 * Sitzung prüfen lassen.
 *
 * Jeder Weg schreibt ins Tagesprotokoll und gibt die Protokoll-ID zurück;
 * Rückgängig löscht genau diesen Eintrag wieder (Kriterium 57). Jeder Weg,
 * auch jedes Rückgängig, stößt den Kalender-Abgleich an
 * (`nachAufgabeGeschrieben`).
 *
 * „Ändern“ schreibt kein Protokoll, wie im Prototyp (`doAendern`).
 */

/** Eine gelöschte Aufgabe, wie der Client sie bis zum Ablauf des Toasts hält. */
export const geloeschteZeileSchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  title: z.string().min(1).max(120),
  details: z.string().max(2000).nullable(),
  dueDate: z.iso.date(),
  doneAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type GeloeschteZeile = z.infer<typeof geloeschteZeileSchema>;

export async function aufgabeEintragen(
  userId: string,
  tag: string,
  input: HomeworkInput,
): Promise<{ id: string; protokollId: string }> {
  const id = await createHomework(userId, input);
  const protokollId = await protokollieren(userId, tag, "aufgabe_eingetragen", id);
  nachAufgabeGeschrieben(userId);
  return { id, protokollId };
}

/**
 * Abhaken oder wieder öffnen. Mit `rueckgaengig` (der Protokoll-ID des
 * Abhakens) ist es das Rückgängig aus dem Toast: der Haken geht weg, und der
 * Eintrag `aufgabe_abgehakt` verschwindet, statt dass ein zweiter
 * `aufgabe_geoeffnet` dazukommt.
 */
export async function aufgabeAbhaken(
  userId: string,
  tag: string,
  id: string,
  done: boolean,
  rueckgaengig?: string | null,
): Promise<{ ok: boolean; protokollId: string | null }> {
  const vorher = await getHomework(userId, id);
  if (!vorher) return { ok: false, protokollId: null };

  await setHomeworkDone(userId, id, done);
  let protokollId: string | null = null;
  if (rueckgaengig) {
    await protokollLoeschen(userId, rueckgaengig);
  } else if (vorher.done !== done) {
    protokollId = await protokollieren(
      userId,
      tag,
      done ? "aufgabe_abgehakt" : "aufgabe_geoeffnet",
      id,
    );
  }
  nachAufgabeGeschrieben(userId);
  return { ok: true, protokollId };
}

/** Löscht und gibt die vollständige Zeile zurück — für Rückgängig mit derselben id. */
export async function aufgabeLoeschen(
  userId: string,
  tag: string,
  id: string,
): Promise<{ zeile: GeloeschteZeile; protokollId: string } | null> {
  const vorher = await getHomework(userId, id);
  if (!vorher) return null;

  await deleteHomework(userId, id);
  const protokollId = await protokollieren(userId, tag, "aufgabe_geloescht", id);
  nachAufgabeGeschrieben(userId);
  return {
    protokollId,
    zeile: {
      id: vorher.id,
      subjectId: vorher.subjectId,
      title: vorher.title,
      details: vorher.details,
      dueDate: vorher.dueDate,
      doneAt: vorher.doneAt ? vorher.doneAt.toISOString() : null,
      createdAt: vorher.createdAt.toISOString(),
    },
  };
}

/** Rückgängig nach dem Löschen: erst die Aufgabe mit alter id, dann der Eintrag weg. */
export async function aufgabeWiederherstellen(
  userId: string,
  zeile: GeloeschteZeile,
  protokollId: string,
): Promise<void> {
  const z = geloeschteZeileSchema.parse(zeile);
  await homeworkWiederherstellen(userId, {
    id: z.id,
    subjectId: z.subjectId,
    title: z.title,
    details: z.details,
    dueDate: z.dueDate,
    doneAt: z.doneAt ? new Date(z.doneAt) : null,
    createdAt: new Date(z.createdAt),
  });
  await protokollLoeschen(userId, protokollId);
  nachAufgabeGeschrieben(userId);
}

export async function aufgabeAendern(
  userId: string,
  id: string,
  input: HomeworkInput,
): Promise<{ ok: boolean }> {
  const vorher = await getHomework(userId, id);
  if (!vorher) return { ok: false };
  await updateHomework(userId, id, input);
  nachAufgabeGeschrieben(userId);
  return { ok: true };
}
