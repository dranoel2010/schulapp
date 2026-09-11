"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { todayInBerlin } from "@/lib/dates";
import { formErrors, type FieldErrors } from "@/lib/form-errors";
import {
  createItem,
  neuPlanen,
  retireItem,
  type AnlageFehler,
} from "@/recall/items";
import {
  urteilFesthalten,
  versuchFesthalten,
  type VersuchErgebnis,
} from "@/recall/sessions";

/**
 * Die Aktionen des Abrufbereichs.
 *
 * Hier stehen nur Anmeldung, „heute" und das Auffrischen der betroffenen
 * Seiten; gerechnet und gespeichert wird in @/recall. „Heute" kommt immer aus
 * todayInBerlin() — der Server läuft in UTC, und um 23 Uhr wäre sonst schon
 * morgen, was einen Abend in zwei zerschnitte.
 *
 * Jede Aktion prüft über requireUser(), wem die Daten gehören, und die
 * Funktionen in @/recall filtern zusätzlich selbst nach userId. Das ist keine
 * doppelte Arbeit, sondern die Regel für Server Actions: Sie sind auch als
 * nackter POST erreichbar, ohne dass ein Formular beteiligt war.
 */

/** Nach jeder Änderung: Startseite, Übersicht, Sitzung und Bausteinliste. */
function revalidateAbruf(): void {
  revalidatePath("/");
  revalidatePath("/abruf");
  revalidatePath("/abruf/sitzung");
  revalidatePath("/abruf/bausteine");
}

/** Die Felder, unter denen eine Meldung stehen kann — als Typargument für formErrors(). */
type BausteinFeld =
  | "pageId"
  | "subjectId"
  | "promptFree"
  | "solution"
  | "misconception"
  | "sourceQuote"
  | "materialKind"
  | "role";

export type BausteinFormState = {
  message?: string;
  errors?: FieldErrors<BausteinFeld>;
  /** Steht nach einem angelegten Baustein da, damit das Formular leer bleiben kann. */
  angelegt?: boolean;
};

const bausteinSchema = z.object({
  pageId: z.string().min(1, "Wähle die Seite, aus der die Frage stammt."),
  subjectId: z.string().min(1, "Ohne Fach lässt sich nichts einordnen."),
  promptFree: z
    .string()
    .trim()
    .min(5, "Die Frage braucht mehr als ein Wort.")
    .max(500, "Eine Frage über 500 Zeichen ist keine Frage mehr."),
  solution: z
    .string()
    .trim()
    .min(1, "Ohne Musterlösung ist die Aufgabe nicht auslieferbar.")
    .max(2000, "Die Musterlösung ist zu lang — höchstens 2000 Zeichen."),
  misconception: z
    .string()
    .trim()
    .min(5, "Der Satz zur Verwechslung fehlt — ohne ihn wird nicht ausgeliefert.")
    .max(500, "Ein bis zwei Sätze genügen."),
  sourceQuote: z
    .string()
    .trim()
    .min(10, "Das Zitat ist zu kurz, um eine Stelle zu bezeichnen.")
    .max(1000, "Ein Zitat über 1000 Zeichen bezeichnet keine Stelle mehr."),
  materialKind: z.enum(["begriff", "anschauung", "verfahren", "ereignis"]),
  /**
   * A12: Übungsvorrat oder Messvorrat — und zwar BEIM ANLEGEN.
   *
   * Ohne dieses Feld wurde jeder Baustein stillschweigend „uebung", und der
   * Messvorrat war eine Behauptung ohne Weg dorthin. Nachträglich lässt er sich
   * nicht herstellen: Eine Frage, die schon geübt wurde, taugt nicht mehr als
   * unabhängige Schätzung. Für die erste Epoche — die einzige, über die gar
   * nichts bekannt ist — wäre die Gelegenheit dann ein für alle Mal vorbei.
   */
  role: z.enum(["uebung", "messung"]),
});

/**
 * Warum A5 nicht durchging — in Sätzen, die sagen, was zu tun ist.
 *
 * „Ungültig" ist keine Auskunft. Jeder dieser vier Fälle hat einen anderen
 * nächsten Schritt, und die Oberfläche ist die einzige Stelle, an der das
 * jemand erfährt.
 */
const A5_MELDUNGEN: Record<AnlageFehler, string> = {
  "keine-seite": "Diese Seite gibt es nicht mehr.",
  "keine-abschrift":
    "Diese Seite hat noch keine Abschrift — ohne Wortlaut lässt sich keine Frage daran binden.",
  "zitat-nicht-gefunden":
    "Dieses Zitat steht so nicht in der Abschrift. Kopiere die Stelle wörtlich heraus, statt sie nachzuerzählen.",
  "zitat-unsicher":
    "Im Zitat steht eine ⟨spitze Klammer⟩ — dort war schon das Abschreiben unsicher, und es genügt eine einzelne: Wer mitten in einer Markierung zu kopieren anfängt, nimmt den unsicheren Text mit. Eine Frage darauf zu bauen hieße, eine Vermutung abzufragen; wähle eine Stelle außerhalb der Hervorhebung oder berichtige zuerst die Abschrift.",
};

/** Einen Baustein anlegen. Die Termine entstehen dabei gleich mit. */
export async function createItemAction(
  _state: BausteinFormState,
  formData: FormData,
): Promise<BausteinFormState> {
  const user = await requireUser();

  const geprueft = bausteinSchema.safeParse({
    pageId: formData.get("pageId"),
    subjectId: formData.get("subjectId"),
    promptFree: formData.get("promptFree"),
    solution: formData.get("solution"),
    misconception: formData.get("misconception"),
    sourceQuote: formData.get("sourceQuote"),
    materialKind: formData.get("materialKind") ?? "begriff",
    role: formData.get("role") ?? "uebung",
  });

  if (!geprueft.success) {
    return { ...formErrors<BausteinFeld>(geprueft.error.issues) };
  }

  const ergebnis = await createItem(user.id, geprueft.data, todayInBerlin());

  if (!ergebnis.ok) {
    // Der Fehler hängt am Zitat, außer die Seite ist ganz weg — dann hat das
    // Feld darüber keine Schuld und die Meldung steht oben allein.
    const amFeld = ergebnis.fehler !== "keine-seite";
    return {
      message: A5_MELDUNGEN[ergebnis.fehler],
      errors: amFeld ? { sourceQuote: A5_MELDUNGEN[ergebnis.fehler] } : undefined,
    };
  }

  revalidateAbruf();

  // Kein redirect(): Nach einem angelegten Baustein will man meistens den
  // nächsten aus derselben Seite bauen. Das Formular leert sich selbst und
  // bleibt stehen; der Weg zurück steht daneben.
  return { angelegt: true, message: anlageSatz(ergebnis) };
}

/**
 * Was nach dem Anlegen dasteht — und zwar das, was wirklich gilt.
 *
 * Die Planung rechnet Warnungen aus; vorher wurden sie weggeworfen und der
 * Schüler las eine Zahl, die Erhaltungstermine NACH der Klausur mitzählte. Wer
 * am Abend vor der Prüfung einen Baustein anlegte, sah „3 Termine geplant" und
 * hatte in Wahrheit keinen einzigen Abruf davor. Eine Zahl, die nach
 * Vorbereitung aussieht, muss Vorbereitung zählen.
 */
function anlageSatz(ergebnis: {
  vorKlausur: number;
  nachKlausur: number;
  warnungen: readonly string[];
}): string {
  if (ergebnis.vorKlausur === 0 && ergebnis.nachKlausur === 0) {
    return "Angelegt. Termine gibt es keine: Bausteine des Messvorrats werden nie geübt.";
  }

  if (ergebnis.warnungen.includes("keine-tage")) {
    return `Angelegt — aber bis zur Klausur bleibt kein Tag mehr, an dem dieser Baustein drankäme. Die ${ergebnis.nachKlausur} geplanten Termine liegen alle danach.`;
  }

  if (ergebnis.warnungen.includes("zu-knapp")) {
    return `Angelegt — aber es reicht nur für ${ergebnis.vorKlausur} ${ergebnis.vorKlausur === 1 ? "Abruf" : "Abrufe"} vor der Klausur statt der vier, die nötig wären. Dafür ist es zu spät; beim nächsten Mal früher.`;
  }

  if (ergebnis.warnungen.includes("kein-termin")) {
    return `Angelegt — ${ergebnis.vorKlausur} Termine im Grundtakt. In diesem Fach steht keine Klausur an; sobald du eine einträgst, rechne die Termine neu.`;
  }

  return `Angelegt — ${ergebnis.vorKlausur} ${ergebnis.vorKlausur === 1 ? "Abruf" : "Abrufe"} vor der Klausur, danach ${ergebnis.nachKlausur} zum Behalten.`;
}

/**
 * Die offenen Termine aller Bausteine neu rechnen.
 *
 * Der Weg zurück, wenn der Kalender sich bewegt hat: Klausur nachgetragen,
 * verschoben, oder eine frühere kommt dazu. Erledigte Termine bleiben stehen —
 * sie sind Vergangenheit und tragen als einzige einen gemessenen Abruf.
 */
export async function neuPlanenAction(): Promise<void> {
  const user = await requireUser();

  await neuPlanen(user.id, todayInBerlin());
  revalidateAbruf();
}

/**
 * Schritt eins des Abends: den Versuch abschicken und die Lösung bekommen.
 *
 * Die Musterlösung reist NICHT mit der Frage zur Seite, sondern kommt hier
 * zurück (A2). Ein `revalidatePath()` steht hier bewusst nicht: Es würde die
 * Sitzungsseite neu bauen und damit mitten in der Frage den Boden wegziehen.
 * Aufgefrischt wird am Ende des Abends, nicht nach jeder Antwort.
 */
export async function versuchAction(
  scheduleId: string,
  itemId: string,
  answerText: string,
): Promise<VersuchErgebnis> {
  const user = await requireUser();

  return versuchFesthalten(
    user.id,
    { scheduleId, itemId, answerText },
    todayInBerlin(),
  );
}

/**
 * Schritt zwei: das eigene Urteil, nachdem die Lösung dastand.
 *
 * Ein „richtig" schließt den Termin, ein „daneben" lässt ihn offen — dann kommt
 * der Baustein noch am selben Abend wieder, hinten angestellt (A6).
 */
export async function urteilAction(
  attemptId: string,
  correct: boolean,
): Promise<{ wiederholt: boolean }> {
  const user = await requireUser();

  const ergebnis = await urteilFesthalten(user.id, attemptId, correct);
  return { wiederholt: ergebnis.wiederholt };
}

/** Am Ende des Abends: die Seiten auffrischen, die Zahlen des Tages zeigen. */
export async function abendBeendenAction(): Promise<void> {
  await requireUser();
  revalidateAbruf();
}

/** „Stand so nicht im Heft" — den Baustein zurückziehen. */
export async function retireItemAction(
  itemId: string,
  grund: string,
): Promise<void> {
  const user = await requireUser();

  await retireItem(user.id, itemId, grund);
  revalidateAbruf();
}
