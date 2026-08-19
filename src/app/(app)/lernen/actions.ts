"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import {
  catchUpMissed,
  generatePlan,
  getExam,
  setBlockStatus,
  skipMissed,
} from "@/lib/exams";

/**
 * Die Aktionen des Lernbereichs — alles, was man mit einem Lernplan tut.
 *
 * Sie liegen hier, weil gelernt wird auf /lernen; die Klausurenseiten
 * verwalten nur noch. Benutzt werden sie von /lernen selbst und von der
 * Startseite, die dieselben Häkchen und dieselbe Nachfrage zeigt.
 *
 * Gerechnet und gespeichert wird in @/lib/exams; hier stehen nur Anmeldung,
 * "heute" und das Auffrischen der betroffenen Seiten. "Heute" kommt immer aus
 * todayInBerlin() — der Server läuft je nach Hosting in UTC, und um 23 Uhr
 * wäre sonst schon morgen.
 *
 * Alle Aktionen prüfen über requireUser(), wem die Daten gehören; die
 * Funktionen in @/lib/exams filtern zusätzlich selbst nach userId.
 */

/** Nach jeder Änderung: Startseite, Lernbereich, Liste und die Prüfung selbst. */
function revalidateExam(examId: string): void {
  revalidatePath("/");
  revalidatePath("/lernen");
  revalidatePath("/klausuren");
  revalidatePath(`/klausuren/${examId}`);
}

/** Einen Lernblock abhaken oder das Häkchen wieder zurücknehmen. */
export async function setBlockStatusAction(
  examId: string,
  blockId: string,
  status: "open" | "done",
): Promise<void> {
  const user = await requireUser();

  // Gestrichen wird nur über skipMissedAction, nicht von Hand aus der Liste.
  if (status !== "open" && status !== "done") return;

  await setBlockStatus(user.id, blockId, status);
  revalidateExam(examId);
}

/**
 * Den Lernplan neu rechnen. Erledigte und gestrichene Blöcke bleiben stehen,
 * neu verteilt wird nur, was noch offen ist.
 */
export async function generatePlanAction(examId: string): Promise<void> {
  const user = await requireUser();

  // Ohne diese Prüfung würde generatePlan werfen — etwa wenn die Prüfung im
  // anderen Fenster gerade gelöscht wurde.
  const exam = await getExam(user.id, examId);
  if (!exam) return;

  await generatePlan(user.id, examId, todayInBerlin());
  revalidateExam(examId);
}

/** Nachholen: alle offenen Blöcke rutschen auf die verbleibenden Tage. */
export async function catchUpMissedAction(examId: string): Promise<void> {
  const user = await requireUser();

  await catchUpMissed(user.id, examId, todayInBerlin());
  revalidateExam(examId);
}

/** Streichen: was liegen geblieben ist, wird ohne neuen Termin abgehakt. */
export async function skipMissedAction(examId: string): Promise<void> {
  const user = await requireUser();

  await skipMissed(user.id, examId, todayInBerlin());
  revalidateExam(examId);
}
