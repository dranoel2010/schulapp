"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import {
  createExam,
  examInputSchema,
  generatePlan,
  setTopics,
} from "@/lib/exams";
import { createHomework, homeworkInputSchema } from "@/lib/homework";
import { setMaterialTopics } from "@/lib/materials";
import {
  createProposal,
  decideProposal,
  getProposal,
  isProposalKind,
  reopenProposal,
  type ProposalItem,
} from "@/lib/proposals";
import { linkExamTopics } from "@/lib/subject-topics";
import { normalizeTopics } from "@/lib/topics";

import type { ExamFieldErrors, ExamFormState } from "../klausuren/exam-form";
import type {
  HomeworkFieldErrors,
  HomeworkFormState,
} from "../hausaufgaben/homework-form";
import type { NewProposalState } from "./neu/proposal-form";
import type { TopicsFormState } from "./[id]/topics-form";

/**
 * Die Server Actions des Eingangskorbs.
 *
 * Sie alle folgen demselben Ablauf, und die Reihenfolge darin ist der ganze
 * Punkt:
 *
 * 1. **Prüfen, bevor beansprucht wird.** Das Formular geht durch dasselbe
 *    zod-Schema wie beim Eintragen von Hand — `homeworkInputSchema`,
 *    `examInputSchema`, `normalizeTopics()`. Ein Vorschlag bekommt keine
 *    Ausnahme; er füllt Felder vor, mehr nicht.
 * 2. **Beanspruchen.** `decideProposal()` setzt den Vorschlag auf
 *    „übernommen“, aber nur, wenn er noch offen war. Zweimal tippen legt
 *    dadurch nicht zwei Aufgaben an — der zweite Versuch bekommt einen Satz.
 * 3. **Schreiben**, durch dieselbe Tür wie jedes Formular: `createHomework()`,
 *    `createExam()`, `setMaterialTopics()`.
 * 4. **Zurücknehmen, wenn das Schreiben scheitert.** `reopenProposal()` stellt
 *    den Korb wieder her; sonst stünde ein Vorschlag als übernommen da, aus
 *    dem nichts geworden ist.
 *
 * Nach jeder Entscheidung geht es zurück in den Korb. Wer dort arbeitet,
 * arbeitet einen Stapel ab — die frisch angelegte Aufgabe wird man sich später
 * ansehen, den nächsten Vorschlag jetzt.
 *
 * `redirect()` steht überall **außerhalb** des try-Blocks: es wirft intern, und
 * ein `catch` darum herum hielte die Umleitung für einen Fehler und nähme den
 * Vorschlag gleich wieder zurück.
 */

/** Wenn beim Speichern etwas schiefgeht, das die App nicht vorhergesehen hat. */
const SAVE_FAILED =
  "Das konnte nicht gespeichert werden. Versuch es noch einmal.";

/** Der Satz für den zweiten Tipp auf denselben Knopf. */
const ALREADY_DECIDED =
  "Über diesen Vorschlag ist schon entschieden — im Korb steht, wie.";

/** Ein Textfeld aus dem Formular. Alles andere ist keine Eingabe. */
function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Mehrere Felder gleichen Namens — so kommen Themen aus einem Formular. */
function texts(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

/** Aus den zod-Meldungen wird pro Feld die erste — mehr passt nicht unters Feld. */
function fieldErrors<T extends Record<string, string>>(
  issues: { path: PropertyKey[]; message: string }[],
): T {
  const errors = {} as T;

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string") continue;

    const key = field as keyof T;
    if (!errors[key]) errors[key] = issue.message as T[keyof T];
  }

  return errors;
}

/**
 * Nach jeder Entscheidung: der Korb, die Startseite und das Blatt.
 *
 * Die Startseite zeigt die Zahl der offenen Vorschläge — am Handy als Hinweis
 * über dem Kachelmenü, am Rechner im Dashboard. Das Blatt zeigt, was noch aus
 * ihm werden soll. Bliebe eines von beiden stehen, sähe der Nutzer eine Zahl,
 * die er gerade selbst kleiner gemacht hat.
 */
function revalidateInbox(materialId?: string): void {
  revalidatePath("/");
  revalidatePath("/eingang");
  if (materialId) revalidatePath(`/material/${materialId}`);
}

/**
 * Holt den Vorschlag und stellt sicher, dass er noch zu haben ist.
 *
 * Ein entschiedener Vorschlag ist kein Fehler, sondern ein gewöhnlicher
 * Ausgang: zwei geöffnete Tabs, ein Zurück-Knopf, ein zweiter Tipp. Deshalb
 * ein Satz und keine Ausnahme.
 */
async function claimable(
  userId: string,
  id: string,
  kind: string,
): Promise<
  { ok: true; proposal: ProposalItem } | { ok: false; message: string }
> {
  const proposal = await getProposal(userId, id);

  if (!proposal || proposal.kind !== kind) {
    return { ok: false, message: "Diesen Vorschlag gibt es nicht mehr." };
  }
  if (proposal.status !== "offen") {
    return { ok: false, message: ALREADY_DECIDED };
  }

  return { ok: true, proposal };
}

/**
 * Übernimmt einen Themen-Vorschlag: die Themen des Formulars werden zu den
 * Themen des Blattes.
 *
 * Was aus den getippten Titeln nicht wurde, steht danach nicht auf dem
 * Bildschirm — anders als auf der Seite des Blattes, wo man weitertippt.
 * Hier geht es zurück in den Korb, und ein Satz, den niemand mehr liest, ist
 * keiner. Ein verworfener Titel („Übungen“ hat kein Fachwort) fehlt dafür
 * sichtbar in der Themenliste des Blattes, einen Tipp entfernt.
 */
export async function acceptTopicsAction(
  id: string,
  _state: TopicsFormState,
  formData: FormData,
): Promise<TopicsFormState> {
  const user = await requireUser();

  const titles = normalizeTopics(texts(formData, "themen"));
  if (titles.length === 0) {
    return {
      errors: {
        topics:
          "Ohne ein Thema wäre das kein Übernehmen, sondern ein Leeren — dafür ist „Verwerfen“ da.",
      },
    };
  }

  const found = await claimable(user.id, id, "themen");
  if (!found.ok) return { message: found.message };

  if (!(await decideProposal(user.id, id, "uebernommen"))) {
    return { message: ALREADY_DECIDED };
  }

  try {
    await setMaterialTopics(user.id, found.proposal.material.id, titles);
  } catch (error) {
    await reopenProposal(user.id, id);
    console.error("Themen übernehmen fehlgeschlagen", error);
    return { message: SAVE_FAILED };
  }

  revalidateInbox(found.proposal.material.id);
  revalidatePath("/material");
  redirect("/eingang");
}

/** Übernimmt einen Aufgaben-Vorschlag — dasselbe Schema wie „Neue Aufgabe“. */
export async function acceptHomeworkAction(
  id: string,
  _state: HomeworkFormState,
  formData: FormData,
): Promise<HomeworkFormState> {
  const user = await requireUser();

  const parsed = homeworkInputSchema.safeParse({
    subjectId: text(formData, "subjectId"),
    title: text(formData, "title"),
    dueDate: text(formData, "dueDate"),
    details: text(formData, "details"),
  });

  if (!parsed.success) {
    return { errors: fieldErrors<HomeworkFieldErrors>(parsed.error.issues) };
  }

  const found = await claimable(user.id, id, "hausaufgabe");
  if (!found.ok) return { message: found.message };

  if (!(await decideProposal(user.id, id, "uebernommen"))) {
    return { message: ALREADY_DECIDED };
  }

  try {
    // createHomework() prüft selbst, ob das Fach dem Nutzer gehört, und wirft
    // sonst — dieselbe Tür wie beim Eintragen von Hand.
    await createHomework(user.id, parsed.data);
  } catch (error) {
    await reopenProposal(user.id, id);
    console.error("Aufgabe übernehmen fehlgeschlagen", error);
    return { message: SAVE_FAILED };
  }

  revalidateInbox(found.proposal.material.id);
  revalidatePath("/hausaufgaben");
  redirect("/eingang");
}

/**
 * Übernimmt einen Termin-Vorschlag.
 *
 * Die vier Schritte danach sind genau die aus `createExamAction()`: Prüfung
 * anlegen, Themen setzen, Themen ans Vokabular des Fachs hängen, Lernplan
 * bauen. Sie stehen hier ein zweites Mal und nicht als gemeinsame Funktion,
 * weil dazwischen die Rücknahme sitzt — und weil eine Funktion, die beide
 * Wege bedient, den Unterschied verwischte, um den es geht: dort legt ein
 * Mensch eine Prüfung an, hier beantwortet er eine Frage über ein Blatt.
 */
export async function acceptExamAction(
  id: string,
  _state: ExamFormState,
  formData: FormData,
): Promise<ExamFormState> {
  const user = await requireUser();

  const parsed = examInputSchema.safeParse({
    subjectId: text(formData, "subjectId"),
    title: text(formData, "title"),
    kind: text(formData, "kind"),
    date: text(formData, "date"),
    leadDays: text(formData, "leadDays"),
    minutesPerDay: text(formData, "minutesPerDay"),
    notes: text(formData, "notes"),
  });

  if (!parsed.success) {
    return { errors: fieldErrors<ExamFieldErrors>(parsed.error.issues) };
  }

  const found = await claimable(user.id, id, "klausur");
  if (!found.ok) return { message: found.message };

  if (!(await decideProposal(user.id, id, "uebernommen"))) {
    return { message: ALREADY_DECIDED };
  }

  try {
    const exam = await createExam(user.id, parsed.data);
    await setTopics(user.id, exam.id, normalizeTopics(texts(formData, "topics")));
    await linkExamTopics(user.id, exam.id);
    await generatePlan(user.id, exam.id, todayInBerlin());
  } catch (error) {
    await reopenProposal(user.id, id);
    console.error("Termin übernehmen fehlgeschlagen", error);
    return { message: SAVE_FAILED };
  }

  revalidateInbox(found.proposal.material.id);
  revalidatePath("/klausuren");
  revalidatePath("/lernen");
  redirect("/eingang");
}

/**
 * Legt einen Vorschlag beiseite.
 *
 * Ohne Rückgabewert und ohne Fehlerpfad: ein Vorschlag, den es nicht mehr gibt
 * oder über den schon entschieden wurde, ist genau der Zustand, den dieser
 * Knopf herstellen sollte. Dafür einen Satz zu zeigen hieße, jemandem zu
 * widersprechen, der recht hat.
 */
export async function discardProposalAction(id: string): Promise<void> {
  const user = await requireUser();

  const proposal = await getProposal(user.id, id);
  await decideProposal(user.id, id, "verworfen");

  revalidateInbox(proposal?.material.id);
  redirect("/eingang");
}

/**
 * Legt einen Vorschlag von Hand an — der Weg, ohne den die Regel des Projekts
 * gebrochen wäre: alles, was der Agent kann, muss auch von Hand gehen.
 *
 * Er ist nicht bloß Pflichtübung. Im Unterricht bleiben zwei Sekunden für das
 * Foto; dass auf dem Blatt eine Aufgabe steht, weiß man in dem Moment und
 * vergisst es bis zum Abend. Ein Vorschlag ist genau der richtige Ort dafür —
 * er kostet nichts und verändert nichts, bis man ihn übernimmt.
 */
export async function createProposalAction(
  _state: NewProposalState,
  formData: FormData,
): Promise<NewProposalState> {
  const user = await requireUser();

  const kind = text(formData, "kind");
  if (!isProposalKind(kind)) {
    return { errors: { kind: "Diese Art von Vorschlag kennt die App nicht." } };
  }

  const materialId = text(formData, "materialId");
  const payload = readPayload(kind, formData);

  const result = await createProposal(user.id, {
    materialId,
    kind,
    payload,
    reason: text(formData, "reason"),
    source: "manuell",
  });

  if (!result.ok) {
    // Am Blatt liegt es nur, wenn das Blatt weg ist; alles andere ist der
    // Inhalt und gehört an das Feld, das ihn trägt.
    if (result.grund === "blatt") {
      return { errors: { materialId: result.satz } };
    }
    if (result.grund === "inhalt") {
      return { errors: { payload: result.satz } };
    }

    return { message: result.satz };
  }

  revalidateInbox(materialId);
  redirect("/eingang");
}

/**
 * Liest die Felder, die zu einer Art gehören — ungeprüft.
 *
 * Geprüft wird eine Stufe weiter, in `createProposal()`, und zwar mit
 * demselben Schema, das auch ein Werkzeugaufruf durchläuft. Hier steht nur die
 * Übersetzung von Formularfeldern in die Form, die dieses Schema erwartet;
 * eine zweite Prüfung an dieser Stelle wäre die zweite Stelle, an der die
 * Regeln stehen.
 */
function readPayload(kind: string, formData: FormData): unknown {
  if (kind === "themen") {
    return { titel: texts(formData, "themen") };
  }

  if (kind === "hausaufgabe") {
    return {
      titel: text(formData, "titel"),
      faellig: text(formData, "faellig"),
      notiz: text(formData, "notiz"),
    };
  }

  return {
    datum: text(formData, "datum"),
    art: text(formData, "art") || "klausur",
    titel: text(formData, "klausurTitel"),
    themen: texts(formData, "klausurThemen"),
  };
}
