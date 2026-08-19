"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import {
  createExam,
  deleteExam,
  examInputSchema,
  generatePlan,
  getExam,
  setTopics,
  updateExam,
} from "@/lib/exams";
import { listSubjects } from "@/lib/subjects";

import type { ExamFieldErrors, ExamFormState } from "./exam-form";

/**
 * Die Server Actions der Klausurverwaltung.
 *
 * Der Lernplan wird hier nicht gerechnet, sondern nur angestoßen: beim Anlegen
 * einmal, beim Bearbeiten nur dann, wenn sich an seinen Grundlagen etwas
 * geändert hat. "heute" kommt aus todayInBerlin(), nie aus new Date().
 *
 * Verwalten und Lernen sind getrennt: nach dem Anlegen geht es zum frisch
 * gebauten Lernplan unter /lernen, nach dem Bearbeiten und Löschen zurück in
 * die Liste. Weil jede Änderung den Plan betrifft, wird /lernen mit
 * aufgefrischt.
 */

/** Länger als eine Zeile ist kein Thema mehr. */
const TOPIC_MAX_LENGTH = 80;

/** So viele Themen kann ein Mensch vor einer Prüfung nicht durcharbeiten. */
const TOPIC_LIMIT = 40;

function readInput(formData: FormData) {
  return {
    subjectId: formData.get("subjectId"),
    title: formData.get("title"),
    kind: formData.get("kind"),
    date: formData.get("date"),
    leadDays: formData.get("leadDays"),
    minutesPerDay: formData.get("minutesPerDay"),
    notes: formData.get("notes"),
  };
}

/**
 * Die Themen kommen als mehrere Felder gleichen Namens aus dem Formular. Hier
 * werden sie genauso zurechtgeschnitten wie in setTopics — sonst hielte der
 * Vergleich „hat sich etwas geändert?“ Kleinigkeiten für echte Änderungen.
 */
function readTopics(formData: FormData): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];

  for (const value of formData.getAll("topics")) {
    if (typeof value !== "string") continue;

    const title = value.trim().slice(0, TOPIC_MAX_LENGTH);
    if (!title) continue;

    const key = title.toLocaleLowerCase("de");
    if (seen.has(key)) continue;

    seen.add(key);
    titles.push(title);
    if (titles.length >= TOPIC_LIMIT) break;
  }

  return titles;
}

function sameTopics(before: string[], after: string[]): boolean {
  return (
    before.length === after.length &&
    before.every((title, index) => title === after[index])
  );
}

/** Aus den zod-Meldungen wird pro Feld die erste — mehr passt nicht unters Feld. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: ExamFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string") continue;

    const key = field as keyof ExamFieldErrors;
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

export async function createExamAction(
  _state: ExamFormState,
  formData: FormData,
): Promise<ExamFormState> {
  const user = await requireUser();

  const parsed = examInputSchema.safeParse(readInput(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  if (await subjectMissing(user.id, parsed.data.subjectId)) {
    return { errors: { subjectId: "Dieses Fach gibt es nicht mehr." } };
  }

  const exam = await createExam(user.id, parsed.data);
  await setTopics(user.id, exam.id, readTopics(formData));
  // Der Plan entsteht sofort, damit unter "Lernen" gleich etwas steht.
  await generatePlan(user.id, exam.id, todayInBerlin());

  revalidatePath("/klausuren");
  revalidatePath("/lernen");
  revalidatePath("/");
  // Genau dafür wurde die Prüfung eingetragen: der Lernplan steht jetzt da.
  redirect("/lernen");
}

export async function updateExamAction(
  examId: string,
  _state: ExamFormState,
  formData: FormData,
): Promise<ExamFormState> {
  const user = await requireUser();

  const existing = await getExam(user.id, examId);
  if (!existing) {
    return { message: "Diese Prüfung gibt es nicht mehr." };
  }

  const today = todayInBerlin();
  const raw = readInput(formData);

  // Eine Prüfung, die schon war, muss man weiter bearbeiten können — sonst
  // käme man an Notizen und Themen nie wieder heran. Solange das Datum
  // unverändert bleibt, tritt für die Prüfung des Formulars heute an seine
  // Stelle; gespeichert wird danach wieder der alte Tag.
  const keepsPastDate =
    typeof raw.date === "string" &&
    raw.date === existing.exam.date &&
    existing.exam.date < today;

  const parsed = examInputSchema.safeParse(
    keepsPastDate ? { ...raw, date: today } : raw,
  );
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  const input = keepsPastDate
    ? { ...parsed.data, date: existing.exam.date }
    : parsed.data;

  if (await subjectMissing(user.id, input.subjectId)) {
    return { errors: { subjectId: "Dieses Fach gibt es nicht mehr." } };
  }

  const topics = readTopics(formData);
  const planChanged =
    input.date !== existing.exam.date ||
    input.leadDays !== existing.exam.leadDays ||
    input.minutesPerDay !== existing.exam.minutesPerDay ||
    !sameTopics(
      existing.topics.map((topic) => topic.title),
      topics,
    );

  await updateExam(user.id, examId, input);
  await setTopics(user.id, examId, topics);

  // generatePlan lässt Erledigtes und Gestrichenes stehen und verteilt nur den
  // Rest neu.
  if (planChanged) {
    await generatePlan(user.id, examId, today);
  }

  revalidatePath("/klausuren");
  revalidatePath(`/klausuren/${examId}`);
  revalidatePath("/lernen");
  revalidatePath("/");
  redirect("/klausuren");
}

export async function deleteExamAction(examId: string): Promise<void> {
  const user = await requireUser();

  // Themen und Lernblöcke hängen per Fremdschlüssel dran und gehen mit.
  await deleteExam(user.id, examId);

  revalidatePath("/klausuren");
  revalidatePath("/lernen");
  revalidatePath("/");
  redirect("/klausuren");
}
