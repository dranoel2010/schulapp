"use client";

import type { ComponentType } from "react";

import { ArchivInhalt } from "@/components/kombi/seiten/archiv";
import { AblageInhalt, ablageSub, BlattInhalt, blattSub } from "@/components/kombi/seiten/blatt";
import { EinstellungenInhalt } from "@/components/kombi/seiten/einstellungen";
import { FachInhalt, FaecherInhalt } from "@/components/kombi/seiten/faecher";
import { HausaufgabenInhalt } from "@/components/kombi/seiten/hausaufgaben";
import { KlausurenInhalt, KlausurInhalt, klausurTitel, klausurUntertitel } from "@/components/kombi/seiten/klausur";
import { NotenfachInhalt, NotenInhalt } from "@/components/kombi/seiten/noten";
import { ProbeInhalt, probeTitel } from "@/components/kombi/seiten/probe";
import { zuletztAngabe } from "@/components/kombi/zeile/zuletzt-angabe";
import { WocheInhalt, wocheSub } from "@/components/kombi/seiten/woche";
import type { AblageDaten, BlattDaten } from "@/lib/seiten/ablage";
import type { FachDaten } from "@/lib/seiten/faecher";
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
  /**
   * Titel und Unterzeile für „Zuletzt geöffnet“ aus den Seitendaten (Klausur,
   * Noten eines Fachs, Fach, Blatt). Die Shell ruft es, sobald die Antwort von
   * `/api/seite` da ist — für jeden Einstieg. Seiten ohne Parameter brauchen es nicht.
   */
  zuletzt?: (params: Record<string, string>, daten: unknown) => { label: string; sub?: string | null } | null;
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
  // Abschnitt F
  klausuren: {
    url: () => "/klausuren",
    titel: () => "Klausuren",
    Inhalt: KlausurenInhalt as ComponentType<SeitenInhaltProps>,
  },
  klausur: {
    zuletzt: (_p, d) => zuletztAngabe("klausur", d),
    url: (p) => `/klausuren/${enc(p.id ?? "")}`,
    titel: klausurTitel,
    untertitel: klausurUntertitel,
    Inhalt: KlausurInhalt as ComponentType<SeitenInhaltProps>,
  },
  noten: {
    url: () => "/noten",
    titel: () => "Noten",
    Inhalt: inhalt(NotenInhalt),
  },
  notenfach: {
    zuletzt: (_p, d) => zuletztAngabe("notenfach", d),
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
    zuletzt: (_p, d) => zuletztAngabe("blatt", d),
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
    zuletzt: (_p, d) => zuletztAngabe("fach", d),
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
  // Antwort 11: Vergangenes nach zwei Wochen
  archiv: {
    url: () => "/archiv",
    titel: () => "Archiv",
    Inhalt: inhalt(ArchivInhalt),
  },
};

/**
 * Arten, die keine Stapelseite sind, und ihre Route. Seit Abschnitt G sind
 * alle Bereiche Stapelseiten; übrig bleiben die Ziele der Zeile, die
 * Formular-Unterseiten sind (Plan 2.2: „eingang“, „bausteine“).
 */
export const ROUTE_STATT_STAPEL: Record<string, (p: Record<string, string>) => string> = {
  eingang: () => "/material/eingang",
  bausteine: () => "/abruf/bausteine",
  // „Stoff und Fragen“ einer Klausur (Rückfall im leeren Lernblock)
  stoff: (p) => `/abruf/klausur?id=${encodeURIComponent(p.id ?? "")}`,
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Die Umkehrung von `url(params)` für die Segmente einer Route
 * (`useSelectedLayoutSegments`): welche Stapelseite zeigt diese Adresse?
 * Gebraucht, wenn eine Route (etwa ein per URL geöffnetes Blatt) von einer
 * anderen Route abgelöst wird: die bisherige legt sich dann als Stapelseite
 * darunter (Plan 2.4, Punkt 5). Abfrageteile kennen die Segmente nicht; die
 * Ablage kommt hier also ohne Filter zurück.
 */
export function artAusSegmenten(segmente: string[]): { art: string; params: Record<string, string> } | null {
  const s = segmente.filter((x) => !/^\(.*\)$/.test(x)).map((x) => decodeURIComponent(x));
  const [a, b, c] = s;
  if (s.length === 1) {
    const einfach: Record<string, string> = {
      stundenplan: "woche",
      hausaufgaben: "hausaufgaben",
      klausuren: "klausuren",
      noten: "noten",
      material: "ablage",
      faecher: "faecher",
      einstellungen: "einstellungen",
      archiv: "archiv",
    };
    return Object.hasOwn(einfach, a) ? { art: einfach[a], params: {} } : null;
  }
  if (s.length === 2 && ID.test(b)) {
    if (a === "klausuren") return { art: "klausur", params: { id: b } };
    if (a === "material") return { art: "blatt", params: { id: b } };
    if (a === "faecher") return { art: "fach", params: { id: b } };
  }
  if (s.length === 3 && a === "noten" && b === "fach" && ID.test(c)) return { art: "notenfach", params: { id: c } };
  return null;
}

export function seitenArt(art: string): SeitenArt | undefined {
  return Object.hasOwn(SEITEN, art) ? SEITEN[art] : undefined;
}
