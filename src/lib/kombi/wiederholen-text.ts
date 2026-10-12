/**
 * Die Texte rund um „Wiederholen“ (V2 4.5, 6.5; Prototyp `whState`,
 * `themaUmfang`, Z. 1400 und 2016–2033). Rein und ohne Datenbank, damit
 * Server (Überblick) und Tisch (nach dem Schließen) denselben Wortlaut
 * schreiben.
 */

/** Der Zustand des Blocks „Wiederholen“ auf dem Überblick. */
export type WhStand =
  | { kind: "ferien" }
  | { kind: "leer" }
  | { kind: "knopf"; n: number; sub: string }
  | { kind: "text"; text: string; ok: boolean };

export const fragenText = (n: number): string => `${n} ${n === 1 ? "Frage" : "Fragen"}`;

export const themenText = (n: number): string => `${n} ${n === 1 ? "Thema" : "Themen"}`;

export const themaLabel = (t: { fach: string; titel: string }): string => `${t.fach} · ${t.titel}`;

/** Unterzeile unter dem Knopf: „Zuerst …“, „Weiter mit …, noch 4 Fragen“, „…, Blatt auswerten“. */
export function whUnterzeile(t: {
  fach: string;
  titel: string;
  art: "abfragen" | "ueben";
  angefangen: boolean;
  blattAngefangen: boolean;
  fragen: number;
}): string {
  if (t.art === "ueben") {
    return t.blattAngefangen ? `Weiter mit ${themaLabel(t)}, Blatt auswerten` : `Zuerst ${themaLabel(t)}`;
  }
  return t.angefangen ? `Weiter mit ${themaLabel(t)}, noch ${fragenText(t.fragen)}` : `Zuerst ${themaLabel(t)}`;
}

/** Die Textzeile ohne Knopf: „Für heute durch. Nächstes Thema Dienstag.“ */
export function whText(durch: boolean, naechstesThema: string | null): string {
  const nd = naechstesThema ? ` Nächstes Thema ${naechstesThema}.` : "";
  return durch ? `Für heute durch.${nd}` : `Heute ist nichts fällig.${nd}`;
}

export const LEER_TEXT = "Noch keine Fragen. Sie entstehen aus den Blättern eines Themas.";
export const FERIEN_TEXT = "In den Ferien wird nicht wiederholt.";
