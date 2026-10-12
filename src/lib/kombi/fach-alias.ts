/**
 * Fachnamen für die Zeile (Plan 3.2 „Anzeigename kurz“, D „Fachaliase“).
 *
 * Der Prototyp führt je Fach `kurz`, `alias` und `k2` (Z. 1094–1100). In der
 * App gibt es dafür keine Spalten, und `subjects.short` ist ein Kürzel wie
 * „M“ — für „Mathe abgehakt“ taugt es nicht. Deshalb hier zwei feste
 * Tabellen, wörtlich aus dem Prototyp, und die Regel, wie aus einem Fach der
 * Datenbank ein Eintrag für den Parser wird.
 *
 * - `kurz`: Mathematik → Mathe, Biologie → Bio, sonst der Name.
 * - `alias`: der Name, das Kürzel (ab zwei Zeichen) und die feste Liste.
 * - `k2`: ein Kürzel aus zwei Buchstaben, das nur als **erstes** Wort zählt
 *   („ma heft vergessen“). Teilen sich zwei Fächer dieselben zwei Buchstaben
 *   (Geschichte, Geographie), gilt es für keins von beiden.
 */

/** Anzeigename je Fachname (Prototyp Z. 1095–1100). */
const KURZ: Record<string, string> = {
  mathematik: "Mathe",
  biologie: "Bio",
};

/** Weitere Wörter, an denen der Parser ein Fach erkennt (Prototyp Z. 1094–1100). */
const ALIASE: Record<string, readonly string[]> = {
  mathematik: ["mathe"],
  biologie: ["bio"],
  franzoesisch: ["französisch", "franzoesisch", "frz", "franz"],
  englisch: ["english"],
};

/** Kleinschreibung, Umlaute als ae/oe/ue/ss, ohne Akzente (Prototyp `norm`, Z. 1036). */
export function norm(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Nur Buchstaben und Ziffern (Prototyp `bare`, Z. 2272). */
export const bare = (w: string): string => norm(w).replace(/[^a-z0-9]/g, "");

export type FachEintrag = {
  id: string;
  name: string;
  kurz: string;
  alias: string[];
  k2: string | null;
};

/** Der Anzeigename `kurz` eines Fachs. */
export function fachKurz(name: string): string {
  return KURZ[bare(name)] ?? name;
}

/** Aus den Fächern der Datenbank die Einträge für Parser und Suche. */
export function fachEintraege(
  faecher: readonly { id: string; name: string; short: string | null }[],
): FachEintrag[] {
  const k2Von = (f: { name: string; short: string | null }) => {
    const s = f.short ? bare(f.short) : "";
    return s.length === 2 ? s : bare(f.name).slice(0, 2) || null;
  };
  const zaehler = new Map<string, number>();
  for (const f of faecher) {
    const k = k2Von(f);
    if (k) zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
  }
  return faecher.map((f) => {
    const key = bare(f.name);
    const alias = new Set<string>([f.name.toLowerCase(), ...(ALIASE[key] ?? [])]);
    if (f.short && bare(f.short).length >= 2) alias.add(f.short.toLowerCase());
    const k = k2Von(f);
    return {
      id: f.id,
      name: f.name,
      kurz: fachKurz(f.name),
      alias: [...alias],
      k2: k && zaehler.get(k) === 1 ? k : null,
    };
  });
}
