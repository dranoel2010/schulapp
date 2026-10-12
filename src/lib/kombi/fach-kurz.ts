/**
 * Der Anzeigename `kurz` eines Fachs in Zeilen und Toasts (Modell 23,
 * Plan 3.2): „Mathe abgehakt“, „Mathe S. 84, Nr. 3–5“. `subjects.short` ist
 * ein Kürzel wie „M“ und taugt dafür nicht; eine neue Spalte gibt es nicht.
 * Die Tabelle steht wörtlich im Prototyp (Z. 1095–1100): Mathematik → Mathe,
 * Biologie → Bio, sonst der Name.
 *
 * Die Aliase der Zeile (Abschnitt D) gehören nicht hierher.
 */
const KURZ: Record<string, string> = {
  mathematik: "Mathe",
  biologie: "Bio",
};

export function fachKurz(name: string): string {
  return KURZ[name.trim().toLocaleLowerCase("de")] ?? name;
}

/** Derselbe Anzeigename unter dem Namen aus Abschnitt C. */
export const kurzName = fachKurz;
