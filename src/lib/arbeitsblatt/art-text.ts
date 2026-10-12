import type { ThemaArt } from "@/db/schema";

/** Ein Thema mit seiner Art — serialisierbar, für die Fachseite (./art-liste). */
export type ThemaMitArt = {
  id: string;
  title: string;
  art: ThemaArt;
  /** Die Art ohne Eingriff — weicht `art` ab, ist sie „von dir umgestellt“ */
  abgeleitet: ThemaArt;
  /** Nicht zurückgezogene Fragen */
  fragen: number;
  /** Gibt es Blätter mit Abschrift? Sonst: „Üben, Arbeitsblatt folgt“ */
  hatQuelle: boolean;
};

/** Die Unterzeile unter dem Thema (Prototyp `artText`, Z. 3204). */
export function artText(t: Pick<ThemaMitArt, "fragen" | "hatQuelle" | "abgeleitet">, art: ThemaArt): string {
  const basis =
    art === "ueben"
      ? t.hatQuelle
        ? "Üben mit Arbeitsblatt zum Ausdrucken"
        : "Üben, Arbeitsblatt folgt"
      : `Abfragen mit ${t.fragen} ${t.fragen === 1 ? "Frage" : "Fragen"}`;
  return art === t.abgeleitet ? basis : `${basis}, von dir umgestellt`;
}
