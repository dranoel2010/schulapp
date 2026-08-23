"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { listSubjects } from "@/lib/subjects";
import {
  clearSlot,
  lessonInputSchema,
  listPeriods,
  MAX_PERIOD,
  parseSlotKeys,
  PeriodsInUseError,
  savePeriods,
  saveLesson,
  switchEpoch,
  type PeriodRow,
} from "@/lib/timetable";

import type {
  LessonFieldErrors,
  LessonFormState,
} from "./[tag]/[stunde]/lesson-form";
import type { EpochFormState } from "./epoche/epoch-form";
import type {
  PeriodFieldErrors,
  PeriodFormState,
} from "./zeiten/period-form";

/**
 * Die Server Actions des Stundenplans: ein Feld im Wochenraster füllen oder
 * leeren, und das Stundenraster einstellen.
 *
 * Welches Feld gemeint ist, steht nicht im Formular, sondern in der Adresse —
 * Wochentag und Stunde kommen deshalb per `bind` als erste Argumente herein.
 * Das Formular kann sie nicht überschreiben, und ein manipulierter Wert wird
 * hier genauso geprüft wie in der Datenschicht.
 *
 * Der Wochenplan steht auch auf der Startseite, deshalb wird sie bei jeder
 * Änderung mit aufgefrischt.
 */

/** "08:00" bis "23:59" — das Stundenraster prüft seine Zeiten damit. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Eine Zeile des Stundenrasters. Die Uhrzeiten sind Zeichenketten "HH:MM" und
 * lassen sich als solche vergleichen — "09:35" < "09:55" stimmt Zeichen für
 * Zeichen, solange die Stunde zweistellig geschrieben ist.
 */
const periodRowSchema = z
  .object({
    startsAt: z
      .string("Wann beginnt die Stunde?")
      .regex(TIME_PATTERN, "Die Uhrzeit gehört in der Form 08:00 hierher."),
    endsAt: z
      .string("Wann endet die Stunde?")
      .regex(TIME_PATTERN, "Die Uhrzeit gehört in der Form 08:00 hierher."),
  })
  .refine((row) => row.endsAt > row.startsAt, {
    message: "Diese Stunde endet, bevor sie beginnt.",
  });

function readLesson(formData: FormData) {
  return {
    subjectId: formData.get("subjectId"),
    room: formData.get("room"),
    note: formData.get("note"),
  };
}

/** Aus den zod-Meldungen wird pro Feld die erste — mehr passt nicht unters Feld. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: LessonFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string") continue;

    const key = field as keyof LessonFieldErrors;
    if (!errors[key]) errors[key] = issue.message;
  }

  return errors;
}

/** Nach jeder Änderung: das Feld selbst, das Wochenraster und die Startseite. */
function revalidateSlot(weekday: number, period: number): void {
  revalidatePath("/");
  revalidatePath("/stundenplan");
  revalidatePath(`/stundenplan/${weekday}/${period}`);
}

export async function saveLessonAction(
  weekday: number,
  period: number,
  _state: LessonFormState,
  formData: FormData,
): Promise<LessonFormState> {
  const user = await requireUser();

  const parsed = lessonInputSchema.safeParse(readLesson(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues) };
  }

  // Das Raster kann kürzer geworden sein, während das Formular offen war.
  const periods = await listPeriods(user.id);
  if (weekday < 1 || weekday > 5 || period < 1 || period > periods.length) {
    return { message: "Dieses Feld gibt es im Stundenplan nicht mehr." };
  }

  // Auch archivierte Fächer zählen: sie stehen in der Auswahl, wenn sie schon
  // in diesem Feld standen. Ein gelöschtes Fach würde in saveLesson sonst als
  // Ausnahme hochschlagen.
  const subjects = await listSubjects(user.id, { includeArchived: true });
  if (!subjects.some((subject) => subject.id === parsed.data.subjectId)) {
    return { errors: { subjectId: "Dieses Fach gibt es nicht mehr." } };
  }

  await saveLesson(user.id, { ...parsed.data, weekday, period });

  revalidateSlot(weekday, period);
  redirect("/stundenplan");
}

export async function deleteLessonAction(
  weekday: number,
  period: number,
): Promise<void> {
  const user = await requireUser();

  await clearSlot(user.id, weekday, period);

  revalidateSlot(weekday, period);
  redirect("/stundenplan");
}

/** [7] → "7.", [7, 8] → "7. und 8.", [7, 8, 9] → "7., 8. und 9." */
function germanList(numbers: number[]): string {
  const parts = numbers.map((number) => `${number}.`);
  const last = parts.pop();

  return parts.length > 0 ? `${parts.join(", ")} und ${last}` : (last ?? "");
}

export async function savePeriodsAction(
  _state: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const user = await requireUser();

  const starts = formData.getAll("startsAt");
  const ends = formData.getAll("endsAt");

  if (starts.length !== ends.length) {
    return {
      message: "Die Zeiten kamen unvollständig an. Versuch es noch einmal.",
    };
  }

  if (starts.length === 0) {
    return {
      message: "Eine Stunde muss bleiben — ohne Raster gibt es keinen Plan.",
    };
  }

  if (starts.length > MAX_PERIOD) {
    return { message: `Höchstens ${MAX_PERIOD} Stunden am Tag.` };
  }

  const errors: PeriodFieldErrors = {};
  const rows: PeriodRow[] = [];

  for (const [index, startsAt] of starts.entries()) {
    const number = index + 1;
    const parsed = periodRowSchema.safeParse({ startsAt, endsAt: ends[index] });

    if (!parsed.success) {
      errors[number] =
        parsed.error.issues[0]?.message ?? "Diese Zeile stimmt nicht.";
      continue;
    }

    rows.push({ number, ...parsed.data });
  }

  // Die Stunden laufen hintereinander ab wie der Schultag selbst. Überlappen
  // sie sich, stünde dieselbe Minute in zwei Zeilen — und die Tagesansicht
  // müsste sich für eine entscheiden.
  for (const [index, row] of rows.entries()) {
    const previous = rows[index - 1];

    if (previous && row.startsAt < previous.endsAt) {
      errors[row.number] =
        `Diese Stunde beginnt, bevor die ${previous.number}. zu Ende ist.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  try {
    await savePeriods(user.id, rows);
  } catch (error) {
    // Kürzen, obwohl in den wegfallenden Stunden noch Unterricht steht: die
    // Datenschicht lehnt das ab, damit nichts ungefragt verloren geht. Hier
    // wird daraus ein Satz, der sagt, was zu tun ist.
    if (error instanceof PeriodsInUseError) {
      return {
        message: `In der ${germanList(error.numbers)} Stunde steht noch Unterricht. Entferne ihn zuerst im Wochenplan.`,
      };
    }

    throw error;
  }

  revalidatePath("/");
  revalidatePath("/stundenplan");
  revalidatePath("/stundenplan/zeiten");
  redirect("/stundenplan");
}

/**
 * Den Hauptunterricht in einem Zug auf ein anderes Fach umtragen.
 *
 * Welche Felder mitwandern, entscheidet der Mensch am Formular und nicht eine
 * Regel hier — die Begründung steht an `switchEpoch()` in @/lib/timetable.
 *
 * Aufgefrischt wird großzügig: der Wochenplan steht auch auf der Startseite,
 * und jedes umgetragene Feld hat seine eigene Adresse.
 */
export async function switchEpochAction(
  _state: EpochFormState,
  formData: FormData,
): Promise<EpochFormState> {
  const user = await requireUser();

  const fromSubjectId = String(formData.get("fromSubjectId") ?? "");
  const toSubjectId = String(formData.get("toSubjectId") ?? "");

  if (!toSubjectId) {
    return { errors: { toSubjectId: "Welches Fach kommt jetzt?" } };
  }

  if (fromSubjectId === toSubjectId) {
    return {
      errors: { toSubjectId: "Das ist dasselbe Fach — dann gibt es nichts umzutragen." },
    };
  }

  // Archivierte Fächer zählen mit: ein Fach, das im Plan steht, darf auch
  // dann weichen, wenn es zugemacht wurde.
  const subjects = await listSubjects(user.id, { includeArchived: true });
  const kennt = (id: string) => subjects.some((subject) => subject.id === id);

  if (!kennt(fromSubjectId)) {
    return { errors: { fromSubjectId: "Dieses Fach gibt es nicht mehr." } };
  }
  if (!kennt(toSubjectId)) {
    return { errors: { toSubjectId: "Dieses Fach gibt es nicht mehr." } };
  }

  // Das Raster kann kürzer geworden sein, während das Formular offen war —
  // dann fallen Haken auf Stunden weg, die es nicht mehr gibt.
  const periods = await listPeriods(user.id);
  const slots = parseSlotKeys(formData.getAll("slots").map(String), periods.length);

  if (slots.length === 0) {
    return { errors: { slots: "Hak wenigstens eine Stunde an." } };
  }

  const umgetragen = await switchEpoch(
    user.id,
    fromSubjectId,
    toSubjectId,
    slots,
  );

  if (umgetragen === 0) {
    return {
      message:
        "Keine dieser Stunden trägt noch das alte Fach. Vermutlich wurde der Plan nebenher geändert — sieh im Wochenraster nach.",
    };
  }

  revalidatePath("/");
  revalidatePath("/stundenplan");
  for (const slot of slots) {
    revalidatePath(`/stundenplan/${slot.weekday}/${slot.period}`);
  }
  redirect("/stundenplan");
}
