"use server";


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

/*
 * Kein revalidatePath() mehr in diesen Actions (Modell 23, Plan 2.4): Nach
 * dem Speichern geht die Formularseite per popPage() eine Ebene zurück, und
 * die Shell lädt die Stapelseite darunter gezielt nach. Ein Auffrischen der
 * Route käme nach dem Zurückgehen an und überschriebe den Stapel-Eintrag.
 */

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

  return { fertig: Date.now() };
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
  return { fertig: Date.now() };
}

export async function deleteGradeAction(id: string): Promise<void> {
  const user = await requireUser();

  await deleteGrade(user.id, id);
}
