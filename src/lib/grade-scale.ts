import type { GradeKind } from "@/db/schema";

/**
 * Die Notenskala von 1+ bis 6 — und alles, was man mit ihr ausrechnet.
 *
 * Noten stehen hier wie in der Datenbank als ganze Zahl in Zehnteln: 7 ist
 * eine 1+, 10 eine 1, 13 eine 1−, 60 eine 6. Der Grund dafür ist der Schnitt.
 * Eine 1,3 und eine 2,3 ergeben in Gleitkomma 3.5999999999999996 statt 3,6; in
 * Zehnteln dagegen genau 36. Gerechnet wird deshalb in ganzen Zahlen, und erst
 * das Ergebnis wird durch zehn geteilt.
 *
 * Kleiner ist besser: 0,7 ist die beste Note, 6,0 die schlechteste. „Das Ziel
 * halten“ heißt in dieser Datei überall `Schnitt ≤ Ziel`.
 *
 * Alles hier ist reine Rechnung — keine Datenbank, kein React, keine
 * Systemuhr. `GradeKind` kommt zwar aus dem Schema, aber als reiner Typ; zur
 * Laufzeit bleibt davon nichts übrig. Genau deshalb ist die Datei testbar, und
 * ihr Test liegt daneben.
 */

/**
 * Das typografische Minus (U+2212), nicht der Bindestrich. Eine 2− steht in
 * der App direkt neben einer 2+, und ein Bindestrich säße dort zu kurz und zu
 * tief — dieselbe Regel wie im übrigen Projekt.
 */
const MINUS = "−";

/**
 * Auf so viele Stellen zeigt die App einen Schnitt an. Die Zahl steht hier
 * einmal, weil auch das Urteil über ein Ziel sie braucht: angezeigt und
 * verglichen wird derselbe Wert.
 */
const DISPLAY_DIGITS = 2;

/** Eine Stufe der Skala: ihr Wert in Zehnteln und wie sie geschrieben wird. */
export type GradeStep = { value: number; label: string };

/**
 * Die Skala, beste Note zuerst.
 *
 * Sie steht als Regel statt als abgetippte Liste: zu jeder ganzen Note gehört
 * ein Plus drei Zehntel darüber und ein Minus drei Zehntel darunter — 1+ ist
 * 0,7, 1− ist 1,3.
 *
 * Auf die 5− folgt unmittelbar die 6. Eine Sechs trägt keine Tendenz, es gibt
 * weder 6+ noch 6−. Die Lücke zwischen 53 und 60 ist also keine vergessene
 * Stufe, sondern die deutsche Notenskala selbst.
 */
export const GRADE_STEPS: readonly GradeStep[] = [
  ...[1, 2, 3, 4, 5].flatMap((grade) => [
    { value: grade * 10 - 3, label: `${grade}+` },
    { value: grade * 10, label: `${grade}` },
    { value: grade * 10 + 3, label: `${grade}${MINUS}` },
  ]),
  { value: 60, label: "6" },
];

/** Die beste Note, eine 1+. */
export const BEST_GRADE: number = GRADE_STEPS[0].value;

/** Die schlechteste Note, eine 6. */
export const WORST_GRADE: number = GRADE_STEPS[GRADE_STEPS.length - 1].value;

/** Sechzehn Stufen, einmal nachschlagbar gemacht statt bei jedem Aufruf gesucht. */
const LABELS = new Map(GRADE_STEPS.map((step) => [step.value, step.label]));

/** Liegt der Wert auf einer Stufe der Skala? */
export function isGradeValue(value: number): boolean {
  return LABELS.has(value);
}

/**
 * Die Beschriftung zu einem Wert: 17 → „2+“.
 *
 * Zwischen den Stufen gibt es eigentlich nichts, aber ein Schnitt sieht aus
 * wie eine Note und landet gelegentlich hier. Statt zu raten oder leer zu
 * bleiben, zeigt die Funktion dann die Zahl selbst: 19 → „1,9“.
 */
export function gradeLabel(value: number): string {
  return LABELS.get(value) ?? formatAverage(value / 10, 1);
}

/**
 * Kaufmännisch runden: bei genau ,5 aufwärts.
 *
 * Der Umweg über die Zeichenkette ist Absicht. `1.005 * 100` ergibt im
 * Binärsystem 100,49999… und würde damit zu 1,00 statt zu 1,01 — genau hier
 * versagt auch `toFixed`. „1.005e2“ liest die Sprache dagegen als glatte
 * 100,5. Zurück geht es per Division, die rundet auf die nächstgelegene
 * Gleitkommazahl und trifft damit dieselbe Zahl wie ein geschriebenes Literal.
 */
function roundTo(value: number, digits: number): number {
  const shifted = Number(`${value}e${digits}`);

  // Nur Zahlen, die JavaScript in Exponentialschreibweise ausgibt (1e-7),
  // überstehen diesen Weg nicht. Für einen Notenschnitt kommt das nicht vor —
  // und wenn doch, bleibt der Wert lieber ungerundet als falsch.
  if (!Number.isFinite(shifted)) return value;

  return Math.round(shifted) / 10 ** digits;
}

/** `toFixed` nimmt nur ganze Stellen; mehr als zehn ergäbe bei einer Note keinen Sinn. */
function sanitizeDigits(digits: number): number {
  return Number.isFinite(digits)
    ? Math.min(10, Math.max(0, Math.trunc(digits)))
    : DISPLAY_DIGITS;
}

/**
 * Ein Schnitt, wie er auf dem Bildschirm steht: „2,17“, mit Komma und fester
 * Stellenzahl. Die Nullen hinten bleiben stehen, damit in einer Liste alle
 * Kommas untereinander sitzen.
 */
export function formatAverage(
  average: number,
  digits: number = DISPLAY_DIGITS,
): string {
  const places = sanitizeDigits(digits);
  return roundTo(average, places).toFixed(places).replace(".", ",");
}

/** Eine Note, so viel wie die Rechnung von ihr braucht. */
export type GradeEntry = { value: number; weight: number; kind: GradeKind };

/**
 * Ein Gewicht unter eins ist keins. Solche Noten zählen gar nicht mit, statt
 * den Schnitt mit einer Null zu verzerren oder ihn durch null zu teilen.
 */
function usableWeight(weight: number): number {
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/**
 * Der gewichtete Schnitt einer Notenliste, als Note (2,17) und nicht in
 * Zehnteln.
 *
 * Gezählt wird in ganzen Zahlen und erst am Ende durch zehn geteilt — deshalb
 * ergeben eine 1,3 und eine 2,3 hier zusammen genau 3,6.
 *
 * Ohne Noten gibt es keinen Schnitt, also `null`. Das ist ausdrücklich nicht
 * dasselbe wie eine 0 oder eine 4: ein Fach ohne Noten hat keinen schlechten
 * Schnitt, es hat gar keinen.
 */
export function weightedAverage(entries: GradeEntry[]): number | null {
  let sum = 0;
  let weights = 0;

  for (const entry of entries) {
    const weight = usableWeight(entry.weight);
    if (weight === 0) continue;

    sum += entry.value * weight;
    weights += weight;
  }

  if (weights === 0) return null;

  return sum / weights / 10;
}

/** Prozent bleiben Prozent: alles außerhalb von 0 bis 100 wird zurechtgerückt. */
function sanitizeShare(weightWritten: number): number {
  return Number.isFinite(weightWritten)
    ? Math.min(100, Math.max(0, weightWritten))
    : 50;
}

/**
 * Der Fachschnitt aus beiden Töpfen, gewichtet mit `weightWritten` in Prozent.
 *
 * Der Fall, auf den es ankommt, ist der leere Topf: Wer nur schriftliche Noten
 * hat, dessen Fachschnitt ist der schriftliche Schnitt. Der fehlende mündliche
 * Topf zählt nicht als 0 und nicht als 4, sondern gar nicht — sonst stünde im
 * September nach der ersten Klausur eine ausgedachte Zahl auf dem Zeugnis.
 *
 * Sind beide Töpfe gefüllt, ist es die schlichte Mischung. Bei 100 zählt nur
 * schriftlich, auch wenn mündliche Noten dastehen, bei 0 nur mündlich; das
 * ergibt sich aus der Formel von selbst und braucht keinen Sonderfall.
 */
export function subjectAverage(
  entries: GradeEntry[],
  weightWritten: number,
): number | null {
  const written = weightedAverage(
    entries.filter((entry) => entry.kind === "schriftlich"),
  );
  const oral = weightedAverage(
    entries.filter((entry) => entry.kind === "muendlich"),
  );

  if (written === null) return oral;
  if (oral === null) return written;

  const share = sanitizeShare(weightWritten) / 100;
  return written * share + oral * (1 - share);
}

/**
 * Der Gesamtschnitt über die Fächer: jedes Fach zählt einmal, egal ob zwölf
 * Noten darin stehen oder eine.
 *
 * Das ist die Rechnung, die ein Zeugnis meint. Würde man stattdessen alle
 * Einzelnoten in einen Topf werfen, entschiede die Zahl der Klausuren über den
 * Schnitt und nicht die Leistung.
 */
export function overallAverage(averages: number[]): number | null {
  if (averages.length === 0) return null;

  return averages.reduce((sum, value) => sum + value, 0) / averages.length;
}

/**
 * Wie eine Zielnote ausgeht.
 *
 * „sicher“ und „unmoeglich“ sind eigene Fälle und keine Notenwerte, weil die
 * App dort etwas anderes sagen muss als „du brauchst eine 3“.
 */
export type TargetOutcome =
  | { status: "sicher" }
  | { status: "reicht"; value: number }
  | { status: "unmoeglich" };

/**
 * Was die nächste Note sein muss, damit der Fachschnitt das Ziel hält.
 *
 * Gesucht ist die **schlechteste** Stufe, die noch reicht — gefragt ist ja
 * „was brauche ich mindestens?“ und nicht „was wäre schön?“.
 *
 * Verglichen wird der auf zwei Stellen gerundete Schnitt, also genau die Zahl,
 * die auch auf dem Bildschirm steht. Sonst zeigte die App „2,00“ an und sagte
 * im selben Atemzug, das Ziel sei verfehlt: richtig gerechnet und trotzdem
 * niemandem zu erklären.
 */
export function neededForTarget(input: {
  entries: GradeEntry[];
  weightWritten: number;
  /** Zielschnitt als Note, z.B. 2 für „eine 2“ */
  target: number;
  next: { kind: GradeKind; weight: number };
}): TargetOutcome {
  // Ein Gewicht von null hieße, die nächste Note zählte nicht — dann wäre die
  // ganze Frage sinnlos. Mindestens einfach zählt sie also.
  const weight = Math.max(1, usableWeight(input.next.weight));

  const holds = (value: number): boolean => {
    const average = subjectAverage(
      [...input.entries, { value, weight, kind: input.next.kind }],
      input.weightWritten,
    );

    // Die nächste Note ist immer dabei, `null` kann hier also nicht vorkommen.
    if (average === null) return false;

    return roundTo(average, DISPLAY_DIGITS) <= input.target;
  };

  // Von der 6 aus rückwärts: die erste Stufe, die hält, ist zugleich die
  // schlechteste, die reicht. Hält schon die 6, ist das Ziel nicht mehr zu
  // verlieren; hält am Ende nicht einmal die 1+, ist es nicht mehr zu holen.
  for (let index = GRADE_STEPS.length - 1; index >= 0; index -= 1) {
    const step = GRADE_STEPS[index];
    if (!holds(step.value)) continue;

    return index === GRADE_STEPS.length - 1
      ? { status: "sicher" }
      : { status: "reicht", value: step.value };
  }

  return { status: "unmoeglich" };
}
