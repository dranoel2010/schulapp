"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { requestCalendarSync } from "@/lib/calendar/sync";
import { createHomework, setHomeworkDone } from "@/lib/homework";
import { probeErlaubt } from "@/lib/seiten/probe";
import { listSubjects } from "@/lib/subjects";
import { todayInBerlin, addDays } from "@/lib/dates";

/**
 * Die Actions der Probe-Stapelseite (Abschnitt A, Plan 2.4). Nur mit
 * `SCHULAPP_TESTUHR=1`. Sie rufen — wie alle Actions der neuen Oberfläche —
 * KEIN `refresh()`: die Shell lädt danach gezielt nach.
 */

const abhakenSchema = z.object({
  id: z.uuid(),
  done: z.boolean(),
  scheitern: z.boolean().optional(),
});

export async function probeAbhakenAction(eingabe: {
  id: string;
  done: boolean;
  scheitern?: boolean;
}): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!probeErlaubt()) return { ok: false };
  const { id, done, scheitern } = abhakenSchema.parse(eingabe);
  // Künstlich scheiternde Action für die Prüfung des Fehler-Toasts.
  if (scheitern) throw new Error("Probe: absichtlich gescheitert");
  await setHomeworkDone(user.id, id, done);
  requestCalendarSync(user.id);
  return { ok: true };
}

const eintragenSchema = z.object({ text: z.string().trim().min(1).max(120) });

export async function probeEintragenAction(eingabe: {
  text: string;
}): Promise<{ ok: boolean; fehler?: string }> {
  const user = await requireUser();
  if (!probeErlaubt()) return { ok: false };
  const parsed = eintragenSchema.safeParse(eingabe);
  if (!parsed.success) return { ok: false, fehler: "Was ist auf?" };
  const [fach] = await listSubjects(user.id);
  if (!fach) return { ok: false, fehler: "Erst ein Fach anlegen." };
  await createHomework(user.id, {
    subjectId: fach.id,
    title: parsed.data.text,
    dueDate: addDays(todayInBerlin(), 1),
  });
  requestCalendarSync(user.id);
  return { ok: true };
}
