/**
 * Der Anzeigename `kurz` eines Fachs (Plan 3.2): wörtlich aus dem Prototyp
 * Z. 1095–1100 — Mathematik → Mathe, Biologie → Bio, sonst der Name.
 * `subjects.short` ist ein Kürzel wie „M“ und taugt dafür nicht.
 *
 * Abschnitt D führt dieselbe Tabelle in `fach-alias.ts` samt Aliasen; beim
 * Zusammenführen bleibt eine von beiden.
 */
const KURZ: Record<string, string> = {
  mathematik: "Mathe",
  biologie: "Bio",
};

export function kurzName(name: string): string {
  return KURZ[name.trim().toLocaleLowerCase("de")] ?? name;
}
