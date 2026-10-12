"use client";

import type { ComponentType } from "react";

import { KlausurenInhalt, KlausurInhalt, klausurTitel, klausurUntertitel } from "@/components/kombi/seiten/klausur";
import { ProbeInhalt, probeTitel } from "@/components/kombi/seiten/probe";

/**
 * Die Nachschlage-Seiten des Stapels (Plan 2.1, 2.4). Jede Art hat
 *
 * - `url(params)`: die echte Adresse, die `openPage` per `pushState` schreibt
 *   und die bei direktem Aufruf dieselbe Seite serverseitig rendert;
 * - `titel(params, daten)`: der Titel aus `pageShell` — er steht schon da,
 *   wenn die Seite nach 150 ms ohne Daten einfährt (2.4, Punkt 6);
 * - `Inhalt`: der Rest der Seite unter dem Titel, mit den Daten des Loaders.
 *
 * Abschnitt A trägt nur die Probe-Seite ein. Für alle anderen Bereiche steht
 * in `ROUTE_STATT_STAPEL` die heutige Route: `openPage` navigiert dorthin,
 * bis Abschnitt G die Seite hier als Stapelseite einträgt.
 */

export type SeitenInhaltProps<D = unknown> = {
  params: Record<string, string>;
  daten: D;
};

export type SeitenArt = {
  url: (params: Record<string, string>) => string;
  titel: (params: Record<string, string>, daten: unknown) => string;
  untertitel?: (params: Record<string, string>, daten: unknown) => string | null;
  Inhalt: ComponentType<SeitenInhaltProps>;
};

export const SEITEN: Record<string, SeitenArt | undefined> = {
  probe: {
    url: (p) => (p.ebene && p.ebene !== "1" ? `/kombi-probe?ebene=${encodeURIComponent(p.ebene)}` : "/kombi-probe"),
    titel: (p) => probeTitel(p),
    Inhalt: ProbeInhalt as ComponentType<SeitenInhaltProps>,
  },
  // Abschnitt F
  klausuren: {
    url: () => "/klausuren",
    titel: () => "Klausuren",
    Inhalt: KlausurenInhalt as ComponentType<SeitenInhaltProps>,
  },
  klausur: {
    url: (p) => `/klausuren/${encodeURIComponent(p.id ?? "")}`,
    titel: klausurTitel,
    untertitel: klausurUntertitel,
    Inhalt: KlausurInhalt as ComponentType<SeitenInhaltProps>,
  },
};

/** Bis G: welche Route eine Art heute noch ist. */
export const ROUTE_STATT_STAPEL: Record<string, (p: Record<string, string>) => string> = {
  woche: () => "/stundenplan",
  hausaufgaben: () => "/hausaufgaben",
  noten: () => "/noten",
  notenfach: (p) => `/noten/fach/${p.id}`,
  ablage: () => "/material",
  blatt: (p) => `/material/${p.id}`,
  faecher: () => "/faecher",
  fach: (p) => `/faecher/${p.id}`,
  einstellungen: () => "/einstellungen",
};

export function seitenArt(art: string): SeitenArt | undefined {
  return Object.hasOwn(SEITEN, art) ? SEITEN[art] : undefined;
}
