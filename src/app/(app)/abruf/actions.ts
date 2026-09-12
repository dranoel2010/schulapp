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
  MATERIALARTEN,
  type AnlageFehler,
} from "@/recall/items";
import {
  FRAGE_MAX,
  FRAGE_MIN,
  LOESUNG_MAX,
  LOESUNG_MIN,
  VERWECHSLUNG_MAX,
  VERWECHSLUNG_MIN,
  ZITAT_MAX,
  ZITAT_MIN,
} from "@/recall/proposals";
import {
  vorschlagUebernehmen,
  vorschlagVerwerfen,
  type UebernahmeErgebnis,
} from "@/recall/proposals";
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
  revalidatePath("/abruf/eingang");
}

/**
 * Dasselbe, aber OHNE die Eingangsseite — für das Übernehmen von Vorschlägen.
 *
 * ── Warum diese Ausnahme sein muss ───────────────────────────────────────────
 *
 * Am 12.9.2026 im Browser gefunden, und erst beim zweiten Anlauf verstanden.
 * `revalidatePath()` auf die GERADE OFFENE Route lässt Next ihren Baum im
 * Ergebnis der Aktion mitschicken. Die Vorschlagsliste ist danach leer, die
 * Seite zeigt ihren Leerzustand — und die Komponente, die eben den Bericht
 * gesetzt hat, wird dabei ersetzt. Sichtbar war: „Kein Vorschlag im Eingang".
 * Unsichtbar blieb, dass eine Frage abgewiesen wurde, weil die KI ihr Zitat
 * nacherzählt hatte.
 *
 * Das ist die einzige Zahl, die beantwortet, ob man dem Agenten trauen kann.
 * Sie darf nicht an einer Auffrischung verlorengehen. Die Eingangsseite ist
 * ohnehin dynamisch (`force-dynamic` im Gruppenlayout), also ist sie beim
 * nächsten echten Aufruf von selbst frisch — die Auffrischung hier war nie
 * nötig, nur schädlich.
 *
 * Beim VERWERFEN gilt das nicht: Dort gibt es keinen Bericht zu lesen, und der
 * Leerzustand ist genau das richtige Ergebnis.
 */
function revalidateAbrufOhneEingang(): void {
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

/**
 * Was der Schüler abgeschickt hat, unverändert — damit es nach einem Fehler
 * wieder im Formular steht.
 *
 * ── Warum der Server das zurückschicken muss ─────────────────────────────────
 *
 * Weil das Formular beim Abschicken NEU AUFGEBAUT wird und dabei jeden
 * Zustand im Browser verliert. Am 12.9.2026 im Browser gemessen: vier Felder
 * ausgefüllt, abgeschickt, die Quellbindung weist das Zitat zurecht ab — und
 * darunter steht ein leeres Formular. Sogar das Auswahlfeld „Art" springt auf
 * seinen Anfangswert zurück, und genau das ist der Beweis: Ein bloßes
 * Neu-Rendern würde eine getroffene Auswahl behalten.
 *
 * Kontrollierte Felder allein reichen dagegen nicht — sie überleben ein
 * Neu-Rendern, aber keinen Neuaufbau. Was überlebt, ist nur, was der Server
 * zurückgibt. Deshalb reisen die Werte mit der Fehlermeldung zurück und das
 * Formular beginnt damit.
 *
 * Ein Formular, das Arbeit verschluckt, wird zweimal benutzt und danach nicht
 * mehr — und dieses hier verlangt fünf ausgefüllte Felder, bevor es etwas
 * annimmt.
 */
export type BausteinWerte = {
  pageId: string;
  sourceQuote: string;
  promptFree: string;
  solution: string;
  misconception: string;
  materialKind: string;
  role: string;
};

export type BausteinFormState = {
  message?: string;
  errors?: FieldErrors<BausteinFeld>;
  /** Steht nach einem angelegten Baustein da, damit das Formular leer bleiben kann. */
  angelegt?: boolean;
  /** Nach einem Fehler: was dastand, damit es wieder dasteht. */
  werte?: BausteinWerte;
};

/** Die rohen Eingaben aus dem Formular, ohne Prüfung — nur zum Zurückgeben. */
function werteAus(formData: FormData): BausteinWerte {
  const text = (name: string): string => {
    const wert = formData.get(name);
    return typeof wert === "string" ? wert : "";
  };

  return {
    pageId: text("pageId"),
    sourceQuote: text("sourceQuote"),
    promptFree: text("promptFree"),
    solution: text("solution"),
    misconception: text("misconception"),
    materialKind: text("materialKind") || "begriff",
    role: text("role") || "uebung",
  };
}

const bausteinSchema = z.object({
  pageId: z.string().min(1, "Wähle die Seite, aus der die Frage stammt."),
  subjectId: z.string().min(1, "Ohne Fach lässt sich nichts einordnen."),
  // Die acht Zahlen stehen im Abrufkern und nicht hier. Bis zum Eingangskorb
  // war dieses Schema die einzige Stelle, an der sie vorkamen; seit es eine
  // zweite Tür gibt, wären zwei Fassungen zwei Versprechen — und dann bekäme
  // entweder der Mensch eine Abweisung für etwas, das die KI durchbringt, oder
  // umgekehrt. Die Sätze bleiben hier: Sie sind für einen Menschen am
  // Formular geschrieben und nicht für ein Modell.
  promptFree: z
    .string()
    .trim()
    .min(FRAGE_MIN, "Die Frage braucht mehr als ein Wort.")
    .max(FRAGE_MAX, `Eine Frage über ${FRAGE_MAX} Zeichen ist keine Frage mehr.`),
  solution: z
    .string()
    .trim()
    .min(LOESUNG_MIN, "Ohne Musterlösung ist die Aufgabe nicht auslieferbar.")
    .max(
      LOESUNG_MAX,
      `Die Musterlösung ist zu lang — höchstens ${LOESUNG_MAX} Zeichen.`,
    ),
  misconception: z
    .string()
    .trim()
    .min(
      VERWECHSLUNG_MIN,
      "Der Satz zur Verwechslung fehlt — ohne ihn wird nicht ausgeliefert.",
    )
    .max(VERWECHSLUNG_MAX, "Ein bis zwei Sätze genügen."),
  sourceQuote: z
    .string()
    .trim()
    .min(ZITAT_MIN, "Das Zitat ist zu kurz, um eine Stelle zu bezeichnen.")
    .max(
      ZITAT_MAX,
      `Ein Zitat über ${ZITAT_MAX} Zeichen bezeichnet keine Stelle mehr.`,
    ),
  // Die vier Arten kommen aus dem Kern und stehen nicht hier: eine zweite
  // Liste wäre genau dann falsch, wenn eine fünfte Art dazukäme.
  materialKind: z.enum(MATERIALARTEN),
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
 * „Ungültig" ist keine Auskunft. Jeder dieser sechs Fälle hat einen anderen
 * nächsten Schritt, und die Oberfläche ist die einzige Stelle, an der das
 * jemand erfährt.
 */
const A5_MELDUNGEN: Record<AnlageFehler, string> = {
  "keine-seite": "Diese Seite gibt es nicht mehr.",
  "kein-fach":
    "Das Fach ist weggekommen — lade die Seite neu und wähle die Quelle noch einmal.",
  "keine-abschrift":
    "Diese Seite hat noch keine Abschrift — ohne Wortlaut lässt sich keine Frage daran binden.",
  "zitat-leer":
    "Ohne Zitat geht es nicht — markiere die Stelle in der Abschrift, auf die die Frage sich stützt.",
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
    return {
      ...formErrors<BausteinFeld>(geprueft.error.issues),
      werte: werteAus(formData),
    };
  }

  const ergebnis = await createItem(user.id, geprueft.data, todayInBerlin());

  if (!ergebnis.ok) {
    // Der Fehler hängt am Zitat, außer die Seite ist ganz weg — dann hat das
    // Feld darüber keine Schuld und die Meldung steht oben allein.
    const amFeld = ergebnis.fehler !== "keine-seite";
    return {
      message: A5_MELDUNGEN[ergebnis.fehler],
      errors: amFeld ? { sourceQuote: A5_MELDUNGEN[ergebnis.fehler] } : undefined,
      werte: werteAus(formData),
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

/**
 * Ausgewählte Vorschläge übernehmen.
 *
 * Jede Frage geht durch `createItem()` und damit durch die Quellbindung — die
 * KI bekommt hier keinen kürzeren Weg als ein Mensch. Was durchfällt, fällt
 * SICHTBAR durch: Das Ergebnis nennt die abgewiesenen Fragen samt Grund, und
 * im Protokoll bleiben sie mit diesem Grund stehen. Die Zahl der Abweisungen
 * ist das einzige Maß dafür, wie zuverlässig der Agent arbeitet.
 */
export async function vorschlagUebernehmenAction(
  proposalId: string,
  gewaehlteIds: string[],
): Promise<UebernahmeErgebnis | null> {
  const user = await requireUser();

  const ergebnis = await vorschlagUebernehmen(
    user.id,
    proposalId,
    gewaehlteIds,
    todayInBerlin(),
  );
  revalidateAbrufOhneEingang();
  return ergebnis;
}

/** Einen ganzen Vorschlag verwerfen, ohne etwas zu übernehmen. */
export async function vorschlagVerwerfenAction(
  proposalId: string,
): Promise<void> {
  const user = await requireUser();

  await vorschlagVerwerfen(user.id, proposalId);
  revalidateAbruf();
}
