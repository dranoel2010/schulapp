import { ablageSeite, blattSeite } from "@/lib/seiten/ablage";
import { einstellungenSeite } from "@/lib/seiten/einstellungen";
import { fachSeite, faecherSeite } from "@/lib/seiten/faecher";
import { hausaufgabenSeite } from "@/lib/seiten/hausaufgaben";
import { klausurenSeite, klausurSeite } from "@/lib/seiten/klausuren";
import { notenfachSeite, notenSeite } from "@/lib/seiten/noten";
import { probeSeite } from "@/lib/seiten/probe";
import { wocheSeite } from "@/lib/seiten/woche";

/**
 * Die Loader der Nachschlage-Seiten (Plan 2.1, 3.2). Jeder Loader gibt ein
 * reines, serialisierbares Objekt zurück — keine Drizzle-Objekte, keine
 * Funktionen, Datumswerte als Text. Derselbe Loader dient zwei Wegen:
 *
 * - dem Stapel der Shell über `GET /api/seite/[art]` (Route Handler), und
 * - dem direkten Aufruf der URL, der dieselbe Seite serverseitig rendert.
 *
 * Abschnitt A brachte die Probe-Seite für die Prüfung des Vertrags aus 2.4,
 * Abschnitt G die echten Seiten (Plan 2.2, 3.2).
 */

export type SeitenParams = Record<string, string>;

export type SeitenLoader = (userId: string, params: SeitenParams) => Promise<unknown>;

export const SEITEN_LOADER: Record<string, SeitenLoader | undefined> = {
  probe: probeSeite,
  woche: wocheSeite,
  hausaufgaben: (userId) => hausaufgabenSeite(userId),
  klausuren: (userId) => klausurenSeite(userId),
  klausur: klausurSeite,
  noten: (userId) => notenSeite(userId),
  notenfach: notenfachSeite,
  ablage: ablageSeite,
  blatt: blattSeite,
  faecher: (userId) => faecherSeite(userId),
  fach: fachSeite,
  einstellungen: (userId) => einstellungenSeite(userId),
};

export function seitenLoader(art: string): SeitenLoader | undefined {
  return Object.hasOwn(SEITEN_LOADER, art) ? SEITEN_LOADER[art] : undefined;
}
