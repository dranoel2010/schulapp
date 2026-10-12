import { zuletztTitel } from "@/components/kombi/zeile/zuletzt";
import { dm } from "@/lib/kombi/text";

/**
 * Titel und Unterzeile für „Zuletzt geöffnet“ aus den Daten einer
 * Nachschlage-Seite (Prototyp `remember`, Z. 3119, 3143, 3164, 3191). Rein und
 * ohne Client-Abhängigkeit: der Stapel ruft es über die Registry, der direkte
 * Aufruf einer Seite (`DirekteSeite`) auf dem Server.
 */
export function zuletztAngabe(art: string, daten: unknown): { label: string; sub?: string | null } | null {
  if (!daten || typeof daten !== "object") return null;
  const d = daten as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  switch (art) {
    case "klausur":
      return s("fach") ? { label: zuletztTitel.klausur(s("fach")), sub: s("datum") ? dm(s("datum")) : null } : null;
    case "notenfach":
      return s("name") ? { label: zuletztTitel.notenfach(s("name")) } : null;
    case "fach":
      return s("name") ? { label: zuletztTitel.fach(s("name")) } : null;
    case "blatt":
      return { label: zuletztTitel.blatt(s("titel")) };
    default:
      return null;
  }
}
