"use client";

import type { BlattImSheet, ThemaLauf, WiederholenAntwort } from "@/components/kombi/tisch/typen";

/**
 * Daten für den Tisch, mit Vorwärmen: ein `pointerdown` auf „Wiederholen“
 * holt die Themen schon, bevor der Finger loslässt (wie das Vorwärmen der
 * Kamera, Plan 2.4 Punkt 6). Ein vorgewärmter Abruf gilt 10 Sekunden.
 */

const vorrat = new Map<string, { zeit: number; p: Promise<unknown> }>();

async function holen<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const json = (await res.json()) as { ok?: boolean };
  if (json.ok === false) throw new Error(`${url} abgewiesen`);
  return json as T;
}

function ausVorrat<T>(url: string, neu: boolean, gilt = 10_000): Promise<T> {
  const v = vorrat.get(url);
  if (v && Date.now() - v.zeit < gilt) {
    if (!neu) vorrat.delete(url);
    return v.p as Promise<T>;
  }
  const p = holen<T>(url);
  if (neu) {
    vorrat.set(url, { zeit: Date.now(), p });
    p.catch(() => vorrat.delete(url));
  }
  return p;
}

const themenUrl = (fach?: string | null) => `/api/wiederholen${fach ? `?fach=${encodeURIComponent(fach)}` : ""}`;

/** Bei `pointerdown`: die Themen schon holen. */
export function wiederholenVorwaermen(fach?: string | null): void {
  void ausVorrat<WiederholenAntwort>(themenUrl(fach), true).catch(() => {});
}

export function wiederholenHolen(fach?: string | null): Promise<WiederholenAntwort> {
  return ausVorrat<WiederholenAntwort>(themenUrl(fach), false);
}

export async function laufHolen(key: string): Promise<ThemaLauf> {
  const r = await holen<{ ok: true; lauf: ThemaLauf }>(`/api/wiederholen?thema=${encodeURIComponent(key)}`);
  return r.lauf;
}

const blattUrl = (id: string) => `/api/wiederholen/blatt?id=${encodeURIComponent(id)}`;
/* Ein Blatt ändert sich beim Lesen der Lösung nicht: das Vorgewärmte gilt eine Minute */
const BLATT_GILT = 60_000;

/**
 * Beim Aufklappen von „Stelle im Blatt“: das Blatt schon holen, damit
 * „Blatt ansehen“ das Sheet gleich mit Inhalt öffnet (Plan 2.4 Punkt 6).
 */
export function blattVorwaermen(id: string): void {
  void ausVorrat<{ ok: true; blatt: BlattImSheet }>(blattUrl(id), true, BLATT_GILT).catch(() => {});
}

export async function blattHolen(id: string): Promise<BlattImSheet> {
  const r = await ausVorrat<{ ok: true; blatt: BlattImSheet }>(blattUrl(id), true, BLATT_GILT);
  return r.blatt;
}
