import { probeSeite } from "@/lib/seiten/probe";

/**
 * Die Loader der Nachschlage-Seiten (Plan 2.1, 3.2). Jeder Loader gibt ein
 * reines, serialisierbares Objekt zurück — keine Drizzle-Objekte, keine
 * Funktionen, Datumswerte als Text. Derselbe Loader dient zwei Wegen:
 *
 * - dem Stapel der Shell über `GET /api/seite/[art]` (Route Handler), und
 * - dem direkten Aufruf der URL, der dieselbe Seite serverseitig rendert.
 *
 * Abschnitt A bringt nur die Probe-Seite für die Prüfung des Vertrags aus
 * 2.4; die echten Seiten (woche, hausaufgaben, klausur, noten, …) trägt
 * Abschnitt G hier ein.
 */

export type SeitenParams = Record<string, string>;

export type SeitenLoader = (userId: string, params: SeitenParams) => Promise<unknown>;

export const SEITEN_LOADER: Record<string, SeitenLoader | undefined> = {
  probe: probeSeite,
};

export function seitenLoader(art: string): SeitenLoader | undefined {
  return Object.hasOwn(SEITEN_LOADER, art) ? SEITEN_LOADER[art] : undefined;
}
