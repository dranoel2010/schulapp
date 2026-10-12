import { z } from "zod";

import {
  onlyInUncertainSpans,
  UNCERTAIN_CLOSE,
  UNCERTAIN_OPEN,
} from "@/lib/transcripts";

/**
 * Der Inhalt eines Arbeitsblatts (Modell 23, Plan 3.6), Form wie `UEBUNG`
 * im Prototyp (Z. 1231):
 *
 *   {teil, minuten, papier: 'kaestchen'|'linien',
 *    quellen: [{materialId, datum, zitat}],
 *    aufgaben: [{kurz, q, teile?, platz, zitat, l: [['p'|'teile'|'eq'|'erg'|'hint', …]]}]}
 *
 * `{…}` in einem Text markiert eine Formel (Newsreader kursiv, `fx`).
 * Gerendert wird immer als Text, nie über `innerHTML`.
 */

export const MIN_AUFGABEN = 5;
export const MAX_AUFGABEN = 8;
/** Höchstens so viele Bau-Versuche je Blatt und Tag (Opus-Kosten). */
export const MAX_VERSUCHE = 2;
/** So lange darf ein Bau dauern; danach gilt `laeuft` als hängen geblieben. */
export const FRIST_MS = 15 * 60_000;

const text = z.string().trim().min(1).max(2000);

/** Ein Baustein der Lösung (Seite 2). */
export const loesungsTeilSchema = z.union([
  z.tuple([z.literal("p"), text]),
  z.tuple([z.literal("teile"), z.array(text).min(1).max(8)]),
  // links leer heißt: Folgezeile einer Umformung (nur „= …“)
  z.tuple([z.literal("eq"), z.array(z.tuple([z.string().trim().max(2000), text])).min(1).max(12)]),
  z.tuple([z.literal("erg"), text]),
  z.tuple([z.literal("hint"), text]),
]);

export const aufgabeSchema = z.object({
  /** „Scheitelpunkt ablesen“ — die Zeile in „Wie lief es?“ */
  kurz: z.string().trim().min(1).max(80),
  q: text,
  teile: z.array(text).min(1).max(8).optional(),
  /** Fremdsprachiger Text in den Teilen: kursiv gesetzt (Prototyp `fr`) */
  fr: z.boolean().optional(),
  /**
   * Platz zum Rechnen/Schreiben: bei Kästchen in mm (5 mm je Kästchen), bei
   * Linien die Zahl der Linien (9 mm je Linie) — wie `padSvg` im Prototyp.
   */
  platz: z.number().int().min(0).max(120),
  /** Muss wörtlich in einer Abschrift der Quelle stehen, außerhalb von ⟨⟩ */
  zitat: z.string().trim().min(1).max(600),
  l: z.array(loesungsTeilSchema).min(1).max(12),
});

export const quelleSchema = z.object({
  materialId: z.uuid(),
  datum: z.iso.date(),
  zitat: z.string().trim().min(1).max(200),
  /** Titel des Blatts für den Kopf („»Scheitelpunktform, Übungen«“) */
  titel: z.string().trim().max(200).optional(),
});

export const inhaltSchema = z.object({
  teil: z.string().trim().min(1).max(120),
  minuten: z.number().int().min(5).max(60),
  papier: z.enum(["kaestchen", "linien"]),
  quellen: z.array(quelleSchema).min(1).max(12),
  aufgaben: z.array(aufgabeSchema).min(MIN_AUFGABEN).max(MAX_AUFGABEN),
});

export type Aufgabe = z.infer<typeof aufgabeSchema>;
export type ArbeitsblattInhalt = z.infer<typeof inhaltSchema>;

/**
 * Steht das Zitat wörtlich in einer der Abschriften, und dort nicht nur in
 * unsicheren ⟨…⟩-Stellen? Dieselbe Tür wie `createItem` (A5): ein Zitat, das
 * selbst ⟨ oder ⟩ enthält, kommt nicht durch.
 */
export function zitatGebunden(zitat: string, abschriften: readonly string[]): boolean {
  const z = leerraum(zitat);
  if (z === "") return false;
  if (z.includes(UNCERTAIN_OPEN) || z.includes(UNCERTAIN_CLOSE)) return false;
  return abschriften.some((abschrift) => {
    const a = leerraum(abschrift);
    return a.includes(z) && !onlyInUncertainSpans(a, z);
  });
}

/**
 * Leerraum zusammengezogen: eine Abschrift bricht Zeilen, wo das Blatt sie
 * bricht, und ein Zitat über einen Zeilenumbruch hinweg ist trotzdem
 * wörtlich. Sonst ändert sich kein Zeichen.
 */
export function leerraum(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export type Quellbindung = {
  /** Aufgaben mit gebundenem Zitat, in ihrer Reihenfolge */
  gueltig: Aufgabe[];
  /** Verworfene Aufgaben (erfunden oder nur aus ⟨⟩) */
  verworfen: Aufgabe[];
  /** Genug für ein Blatt? Unter MIN_AUFGABEN wird es `fehlgeschlagen`. */
  reicht: boolean;
};

/** Verwirft Aufgaben ohne Quelle; höchstens MAX_AUFGABEN bleiben. */
export function quellbindung(
  aufgaben: readonly Aufgabe[],
  abschriften: readonly string[],
): Quellbindung {
  const gueltig: Aufgabe[] = [];
  const verworfen: Aufgabe[] = [];
  for (const a of aufgaben) {
    (zitatGebunden(a.zitat, abschriften) ? gueltig : verworfen).push(a);
  }
  const genommen = gueltig.slice(0, MAX_AUFGABEN);
  return {
    gueltig: genommen,
    verworfen,
    reicht: genommen.length >= MIN_AUFGABEN,
  };
}
