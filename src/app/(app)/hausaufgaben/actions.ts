"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  createHomework,
  deleteHomework,
  getHomework,
  setHomeworkDone,
  updateHomework,
} from "@/lib/homework";
import { listSubjects } from "@/lib/subjects";

import type { HomeworkFieldErrors, HomeworkFormState } from "./homework-form";

/**
 * Die Server Actions der Hausaufgaben.
 *
 * Das Prüfschema steht hier und nicht in @/lib/homework: die Datenschicht
 * nimmt fertige Werte entgegen und wirft, wenn etwas nicht stimmt. Im Formular
 * soll aber eine Meldung unter dem Feld stehen und keine Ausnahme hochschlagen
 * — also fängt zod alles ab, bevor die Datenschicht es zu sehen bekommt.
 *
 * Abgehakt wird von drei Stellen aus: aus der Liste, von der Startseite und
 * aus dem Dashboard. Deshalb frischt jede Änderung „/“ mit auf, nicht nur
 * „/hausaufgaben“ — sonst zeigte die Kachel eine Zahl, die nicht mehr stimmt.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Prüft Form und Gültigkeit: „2026-02-31“ sieht richtig aus, gibt es aber
 * nicht. Dieselbe Prüfung steht in @/lib/homework — dort ist sie privat, und
 * eine Datenschicht, die ihre Prüfungen nach außen reicht, wäre schlechter
 * abgegrenzt als eine Zeile Wiederholung hier.
 */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const stamp = new Date(Date.UTC(year, month - 1, day));

  return (
    stamp.getUTCFullYear() === year &&
    stamp.getUTCMonth() === month - 1 &&
    stamp.getUTCDate() === day
  );
}

const homeworkInputSchema = z.object({
  subjectId: z.uuid("Zu welchem Fach gehört die Aufgabe?"),
  title: z
    .string("Was ist aufgegeben?")
    .trim()
    .min(1, "Was ist aufgegeben?")
    .max(120, "Der Titel ist zu lang — höchstens 120 Zeichen."),
  dueDate: z
    .string("Wann ist die Aufgabe fällig?")
    .min(1, "Wann ist die Aufgabe fällig?")
    .refine(isCalendarDate, "Diesen Tag gibt es nicht."),
  // Leere Eingabe soll als NULL in der Datenbank landen, nicht als "".
  details: z
    .string()
    .trim()
    .max(2000, "Die Notiz ist zu lang — höchstens 2000 Zeichen.")
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

function readInput(formData: FormData) {
  return {
    subjectId: formData.get("subjectId"),
    title: formData.get("title"),
    dueDate: formData.get("dueDate"),
    details: formData.get("details"),
  };
}

/** Aus den zod-Meldungen wird pro Feld die erste — mehr passt nicht unters Feld. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: HomeworkFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string") continue;

    const key = field as keyof HomeworkFieldErrors;
    if (!errors[key]) errors[key] = issue.message;
  }

  return errors;
}

/** Ein Fach, das es nicht (mehr) gibt, würde sonst als Ausnahme hochschlagen. */
async function subjectMissing(
  userId: string,
  subjectId: string,
): Promise<boolean> {
  const subjects = await listSubjects(userId, { includeArchived: true });

  return !subjects.some((subject) => subject.id === subjectId);
}

/**
 * Nach jeder Änderung: die Liste, die Aufgabe selbst und die Startseite. Die
 * Startseite zeigt dieselben Aufgaben in Kachel und Tagesspur — ohne sie
 * bliebe dort die alte Zahl stehen.
 */
function revalidateHomework(id?: string): void {
  revalidatePath("/");
  revalidatePath("/hausaufgaben");
  if (id) revalidatePath(`/hausaufgaben/${id}`);
}

export async function createHomeworkAction(
  _state: HomeworkFormState,
  formData: FormData,
): Promise<HomeworkFormState> {
  const user = await requireUser();

  const parsed = homeworkInputSchema.safeParse(readInput(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  if (await subjectMissing(user.id, parsed.data.subjectId)) {
    return { errors: { subjectId: "Dieses Fach gibt es nicht mehr." } };
  }

  await createHomework(user.id, parsed.data);

  revalidateHomework();
  redirect("/hausaufgaben");
}

export async function updateHomeworkAction(
  id: string,
  _state: HomeworkFormState,
  formData: FormData,
): Promise<HomeworkFormState> {
  const user = await requireUser();

  const existing = await getHomework(user.id, id);
  if (!existing) {
    return { message: "Diese Aufgabe gibt es nicht mehr." };
  }

  const parsed = homeworkInputSchema.safeParse(readInput(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  if (await subjectMissing(user.id, parsed.data.subjectId)) {
    return { errors: { subjectId: "Dieses Fach gibt es nicht mehr." } };
  }

  // Der Haken bleibt, wie er ist: updateHomework fasst doneAt nicht an.
  await updateHomework(user.id, id, parsed.data);

  revalidateHomework(id);
  redirect("/hausaufgaben");
}

/**
 * Abhaken und wieder aufmachen. Ohne Weiterleitung, denn der Knopf steht mal
 * in der Liste, mal auf der Startseite — man bleibt, wo man ist.
 */
export async function setHomeworkDoneAction(
  id: string,
  done: boolean,
): Promise<void> {
  const user = await requireUser();

  await setHomeworkDone(user.id, id, done);

  revalidateHomework(id);
}

export async function deleteHomeworkAction(id: string): Promise<void> {
  const user = await requireUser();

  await deleteHomework(user.id, id);

  revalidateHomework(id);
  redirect("/hausaufgaben");
}
