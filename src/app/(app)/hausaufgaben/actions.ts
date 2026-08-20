"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import {
  homeworkInputSchema,
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
 * Das Prüfschema steht in @/lib/homework und wird hier nur benutzt. Die
 * Datenschicht wirft, wenn etwas nicht stimmt; im Formular soll aber eine
 * Meldung unter dem Feld stehen und keine Ausnahme hochschlagen — also fängt
 * zod alles ab, bevor die Datenschicht es zu sehen bekommt. Dieselbe Tür gilt
 * damit für jeden Aufrufer, nicht nur für dieses Formular.
 *
 * Abgehakt wird von drei Stellen aus: aus der Liste, von der Startseite und
 * aus dem Dashboard. Deshalb frischt jede Änderung „/“ mit auf, nicht nur
 * „/hausaufgaben“ — sonst zeigte die Kachel eine Zahl, die nicht mehr stimmt.
 */

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
