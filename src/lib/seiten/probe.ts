import { listHomework } from "@/lib/homework";

/**
 * Die Probe-Stapelseite aus Abschnitt A (Plan 2.4, „Prüfung“): eine
 * Nachschlage-Seite mit echten Daten, an der sich Abhaken ohne `refresh()`,
 * Zurück über ein Formular, Neuladen und Flugmodus prüfen lassen, bevor die
 * echten Seiten in G darauf stehen.
 *
 * Nur mit `SCHULAPP_TESTUHR=1` (auf dem NAS nie gesetzt).
 */

export const probeErlaubt = (): boolean => process.env.SCHULAPP_TESTUHR === "1";

export type ProbeDaten = {
  ebene: number;
  aufgaben: { id: string; fach: string; text: string; done: boolean }[];
  stand: string;
};

export async function probeSeite(
  userId: string,
  params: Record<string, string>,
): Promise<ProbeDaten | null> {
  if (!probeErlaubt()) return null;
  const ebene = Math.max(1, Math.min(3, Number(params.ebene) || 1));
  const liste = await listHomework(userId, { includeDone: true });
  return {
    ebene,
    aufgaben: liste
      .filter((a) => !a.done || (a.doneAt && Date.now() - a.doneAt.getTime() < 2 * 864e5))
      .slice(0, 8)
      .map((a) => ({ id: a.id, fach: a.subject.name, text: a.title, done: a.done })),
    stand: new Date().toISOString(),
  };
}
