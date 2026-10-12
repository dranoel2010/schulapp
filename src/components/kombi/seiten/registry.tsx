"use client";

import type { ComponentType } from "react";

import { AblageInhalt, ablageSub, BlattInhalt, blattSub } from "@/components/kombi/seiten/blatt";
import { EinstellungenInhalt } from "@/components/kombi/seiten/einstellungen";
import { FachInhalt, FaecherInhalt } from "@/components/kombi/seiten/faecher";
import { HausaufgabenInhalt } from "@/components/kombi/seiten/hausaufgaben";
import { KlausurenInhalt, KlausurInhalt, klausurSub } from "@/components/kombi/seiten/klausuren";
import { NotenfachInhalt, NotenInhalt } from "@/components/kombi/seiten/noten";
import { ProbeInhalt, probeTitel } from "@/components/kombi/seiten/probe";
import { WocheInhalt, wocheSub } from "@/components/kombi/seiten/woche";
import type { AblageDaten, BlattDaten } from "@/lib/seiten/ablage";
import type { FachDaten } from "@/lib/seiten/faecher";
import type { KlausurDaten } from "@/lib/seiten/klausuren";
import type { NotenfachDaten } from "@/lib/seiten/noten";
import type { WocheDaten } from "@/lib/seiten/woche";

/**
 * Die Nachschlage-Seiten des Stapels (Plan 2.1, 2.2, 2.4). Jede Art hat
 *
 * - `url(params)`: die echte Adresse, die `openPage` per `pushState` schreibt
 *   und die bei direktem Aufruf dieselbe Seite serverseitig rendert;
 * - `titel(params, daten)`: der Titel aus `pageShell` — er steht schon da,
 *   wenn die Seite nach 150 ms ohne Daten einfährt (2.4, Punkt 6);
 * - `untertitel`: das `.p-sub` unter dem Titel, aus den Daten;
 * - `Inhalt`: der Rest der Seite unter dem Titel, mit den Daten des Loaders.
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

const mitQuery = (pfad: string, q: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `${pfad}?${s}` : pfad;
};

const enc = encodeURIComponent;
const inhalt = (C: ComponentType<{ daten: never }>) => C as unknown as ComponentType<SeitenInhaltProps>;

export const SEITEN: Record<string, SeitenArt | undefined> = {
  probe: {
    url: (p) => (p.ebene && p.ebene !== "1" ? `/kombi-probe?ebene=${enc(p.ebene)}` : "/kombi-probe"),
    titel: (p) => probeTitel(p),
    Inhalt: ProbeInhalt as ComponentType<SeitenInhaltProps>,
  },
  woche: {
    url: (p) => mitQuery("/stundenplan", { tag: p.tag }),
    titel: () => "Woche",
    untertitel: (_p, d) => wocheSub(d as WocheDaten),
    Inhalt: inhalt(WocheInhalt),
  },
  hausaufgaben: {
    url: () => "/hausaufgaben",
    titel: () => "Hausaufgaben",
    Inhalt: inhalt(HausaufgabenInhalt),
  },
  klausuren: {
    url: () => "/klausuren",
    titel: () => "Klausuren",
    Inhalt: inhalt(KlausurenInhalt),
  },
  klausur: {
    url: (p) => `/klausuren/${enc(p.id ?? "")}`,
    titel: (_p, d) => (d as KlausurDaten | undefined)?.fach ?? "",
    untertitel: (_p, d) => klausurSub(d as KlausurDaten),
    Inhalt: inhalt(KlausurInhalt),
  },
  noten: {
    url: () => "/noten",
    titel: () => "Noten",
    Inhalt: inhalt(NotenInhalt),
  },
  notenfach: {
    url: (p) => `/noten/fach/${enc(p.id ?? "")}`,
    titel: (_p, d) => {
      const n = (d as NotenfachDaten | undefined)?.name;
      return n ? `Noten ${n}` : "Noten";
    },
    Inhalt: inhalt(NotenfachInhalt),
  },
  ablage: {
    url: (p) => mitQuery("/material", { fach: p.fach, thema: p.thema }),
    titel: () => "Ablage",
    untertitel: (_p, d) => ablageSub(d as AblageDaten),
    Inhalt: inhalt(AblageInhalt),
  },
  blatt: {
    url: (p) => `/material/${enc(p.id ?? "")}`,
    titel: (_p, d) => (d as BlattDaten | undefined)?.titel ?? "",
    untertitel: (_p, d) => blattSub(d as BlattDaten),
    Inhalt: inhalt(BlattInhalt),
  },
  faecher: {
    url: () => "/faecher",
    titel: () => "Fächer",
    Inhalt: inhalt(FaecherInhalt),
  },
  fach: {
    url: (p) => `/faecher/${enc(p.id ?? "")}`,
    titel: (_p, d) => (d as FachDaten | undefined)?.name ?? "",
    untertitel: (_p, d) => (d as FachDaten).sub,
    Inhalt: inhalt(FachInhalt),
  },
  einstellungen: {
    url: () => "/einstellungen",
    titel: () => "Einstellungen",
    Inhalt: inhalt(EinstellungenInhalt),
  },
};

/**
 * Arten, die (noch) keine Stapelseite sind, und ihre Route. Seit Abschnitt G
 * sind alle Bereiche Stapelseiten; die Tabelle bleibt für die Shell, die sie
 * als Rückfall liest.
 */
export const ROUTE_STATT_STAPEL: Record<string, (p: Record<string, string>) => string> = {};

export function seitenArt(art: string): SeitenArt | undefined {
  return Object.hasOwn(SEITEN, art) ? SEITEN[art] : undefined;
}
