"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import {
  createSubject,
  deleteSubject,
  getSubject,
  listSubjects,
  setArchived,
  subjectInputSchema,
  updateSubject,
  type SubjectFieldErrors,
  type SubjectFormState,
} from "@/lib/subjects";

/** Höchstens so viele Fächer legt die Schnellauswahl auf einmal an. */
const QUICK_ADD_LIMIT = 30;

function readInput(formData: FormData) {
  return {
    name: formData.get("name"),
    short: formData.get("short"),
    color: formData.get("color"),
    teacher: formData.get("teacher"),
    room: formData.get("room"),
    weightWritten: formData.get("weightWritten"),
  };
}

/** Aus den zod-Meldungen wird pro Feld die erste — mehr passt nicht unters Feld. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: SubjectFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string") continue;

    const key = field as keyof SubjectFieldErrors;
    if (!errors[key]) errors[key] = issue.message;
  }

  return errors;
}

/** Zwei Fächer mit demselben Namen wären im Stundenplan nicht auseinanderzuhalten. */
async function nameTaken(userId: string, name: string, exceptId?: string) {
  const existing = await listSubjects(userId, { includeArchived: true });
  const wanted = name.toLocaleLowerCase("de");

  return existing.some(
    (subject) =>
      subject.id !== exceptId && subject.name.toLocaleLowerCase("de") === wanted,
  );
}

export async function createSubjectAction(
  _state: SubjectFormState,
  formData: FormData,
): Promise<SubjectFormState> {
  const user = await requireUser();

  const parsed = subjectInputSchema.safeParse(readInput(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  if (await nameTaken(user.id, parsed.data.name)) {
    return { errors: { name: "Dieses Fach hast du schon." } };
  }

  await createSubject(user.id, parsed.data);

  revalidatePath("/faecher");
  redirect("/faecher");
}

export async function updateSubjectAction(
  id: string,
  _state: SubjectFormState,
  formData: FormData,
): Promise<SubjectFormState> {
  const user = await requireUser();

  const existing = await getSubject(user.id, id);
  if (!existing) {
    return { message: "Dieses Fach gibt es nicht mehr." };
  }

  const parsed = subjectInputSchema.safeParse(readInput(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  if (await nameTaken(user.id, parsed.data.name, id)) {
    return { errors: { name: "Dieses Fach hast du schon." } };
  }

  await updateSubject(user.id, id, parsed.data);

  revalidatePath("/faecher");
  revalidatePath(`/faecher/${id}`);
  redirect("/faecher");
}

export async function setArchivedAction(
  id: string,
  archived: boolean,
): Promise<void> {
  const user = await requireUser();

  await setArchived(user.id, id, archived);

  revalidatePath("/faecher");
  revalidatePath(`/faecher/${id}`);
  redirect("/faecher");
}

export async function deleteSubjectAction(id: string): Promise<void> {
  const user = await requireUser();

  await deleteSubject(user.id, id);

  revalidatePath("/faecher");
  redirect("/faecher");
}

/**
 * Schnellauswahl: Name, Kürzel und Farbe kommen als gleich lange Listen aus
 * dem Formular, die Reihenfolge bestimmt die Farbe. Was schon existiert oder
 * nicht durch die Prüfung kommt, wird still übersprungen — der Nutzer soll
 * nicht wegen eines Doppels die ganze Auswahl neu antippen.
 */
export async function quickAddSubjectsAction(
  _state: SubjectFormState,
  formData: FormData,
): Promise<SubjectFormState> {
  const user = await requireUser();

  const names = formData.getAll("name").slice(0, QUICK_ADD_LIMIT);
  const shorts = formData.getAll("short");
  const colors = formData.getAll("color");

  if (names.length === 0) {
    return { message: "Tipp erst die Fächer an, die du hast." };
  }

  const existing = await listSubjects(user.id, { includeArchived: true });
  const taken = new Set(
    existing.map((subject) => subject.name.toLocaleLowerCase("de")),
  );

  let created = 0;

  for (const [index, name] of names.entries()) {
    const parsed = subjectInputSchema.safeParse({
      name,
      short: shorts[index],
      color: colors[index],
      teacher: null,
      room: null,
      weightWritten: 50,
    });

    if (!parsed.success) continue;

    const key = parsed.data.name.toLocaleLowerCase("de");
    if (taken.has(key)) continue;

    await createSubject(user.id, parsed.data);
    taken.add(key);
    created += 1;
  }

  if (created === 0) {
    return { message: "Diese Fächer hast du schon alle." };
  }

  revalidatePath("/faecher");
  return {};
}
