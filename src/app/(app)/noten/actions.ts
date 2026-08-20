"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import {
  createGrade,
  deleteGrade,
  getGrade,
  gradeInputSchema,
  updateGrade,
} from "@/lib/grades";
import { listSubjects } from "@/lib/subjects";

import type { GradeFieldErrors, GradeFormState } from "./grade-form";

/**
 * Die Server Actions der Noten.
 *
 * Das Prüfschema steht hier und nicht in @/lib/grades: die Datenschicht nimmt
 * fertige Werte entgegen und wirft, wenn etwas nicht stimmt. Im Formular soll
 * aber eine Meldung unter dem Feld stehen und keine Ausnahme hochschlagen —
 * also fängt zod alles ab, bevor die Datenschicht es zu sehen bekommt.
 *
 * Eine Note wirkt an mehr Stellen als sie steht: sie verschiebt den Fachschnitt
 * und damit den Gesamtschnitt auf Kachel und Dashboard. Deshalb frischt jede
 * Änderung mehrere Wege auf — siehe revalidateGrades.
 */

function readInput(formData: FormData) {
  return {
    subjectId: formData.get("subjectId"),
    value: formData.get("value"),
    kind: formData.get("kind"),
    weight: formData.get("weight"),
    date: formData.get("date"),
    title: formData.get("title"),
  };
}

/** Aus den zod-Meldungen wird pro Feld die erste — mehr passt nicht unters Feld. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: GradeFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string") continue;

    const key = field as keyof GradeFieldErrors;
    if (!errors[key]) errors[key] = issue.message;
  }

  return errors;
}

/** Ein Fach, das es nicht (mehr) gibt, würde sonst als Ausnahme hochschlagen. */
async function subjectMissing(
  userId: string,
  subjectId: string,
): Promise<boolean> {
  // Archivierte zählen mit: eine alte Note trägt man auch dann noch nach, wenn
  // das Fach längst abgewählt ist.
  const subjects = await listSubjects(userId, { includeArchived: true });

  return !subjects.some((subject) => subject.id === subjectId);
}

/**
 * Nach jeder Änderung: die Startseite, die Liste, die Note selbst und die
 * Fachseite.
 *
 * „/“ muss dabei sein, weil Kachel und Dashboard den Gesamtschnitt zeigen —
 * eine einzige neue Note verschiebt ihn. Und `subjectIds` ist eine Liste, weil
 * beim Ändern das Fach gewechselt worden sein kann: dann muss auch die alte
 * Fachseite neu rechnen, sonst bliebe dort ein Schnitt stehen, in dem die
 * weggezogene Note noch mitzählt.
 */
function revalidateGrades(subjectIds: string[], id?: string): void {
  revalidatePath("/");
  revalidatePath("/noten");
  if (id) revalidatePath(`/noten/${id}`);

  // Beim Anlegen und beim Fach, das gleich geblieben ist, steht dieselbe id
  // zweimal in der Liste — einmal auffrischen genügt.
  for (const subjectId of new Set(subjectIds)) {
    revalidatePath(`/noten/fach/${subjectId}`);
  }
}

export async function createGradeAction(
  _state: GradeFormState,
  formData: FormData,
): Promise<GradeFormState> {
  const user = await requireUser();

  const parsed = gradeInputSchema.safeParse(readInput(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  if (await subjectMissing(user.id, parsed.data.subjectId)) {
    return { errors: { subjectId: "Dieses Fach gibt es nicht mehr." } };
  }

  await createGrade(user.id, parsed.data);

  revalidateGrades([parsed.data.subjectId]);
  redirect("/noten");
}

export async function updateGradeAction(
  id: string,
  _state: GradeFormState,
  formData: FormData,
): Promise<GradeFormState> {
  const user = await requireUser();

  const existing = await getGrade(user.id, id);
  if (!existing) {
    return { message: "Diese Note gibt es nicht mehr." };
  }

  const parsed = gradeInputSchema.safeParse(readInput(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  if (await subjectMissing(user.id, parsed.data.subjectId)) {
    return { errors: { subjectId: "Dieses Fach gibt es nicht mehr." } };
  }

  await updateGrade(user.id, id, parsed.data);

  // Das alte Fach kommt mit: wurde gewechselt, hängt die Note dort nicht mehr.
  revalidateGrades([existing.subjectId, parsed.data.subjectId], id);
  redirect("/noten");
}

export async function deleteGradeAction(id: string): Promise<void> {
  const user = await requireUser();

  // Vorher nachsehen, an welchem Fach die Note hängt: hinterher ist die Zeile
  // weg und mit ihr die Auskunft, welche Fachseite falsch geworden ist.
  const existing = await getGrade(user.id, id);

  await deleteGrade(user.id, id);

  revalidateGrades(existing ? [existing.subjectId] : [], id);
  redirect("/noten");
}
