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

function ausVorrat<T>(url: string, neu: boolean): Promise<T> {
  const v = vorrat.get(url);
  if (v && Date.now() - v.zeit < 10_000) {
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

export async function blattHolen(id: string): Promise<BlattImSheet> {
  const r = await holen<{ ok: true; blatt: BlattImSheet }>(`/api/wiederholen/blatt?id=${encodeURIComponent(id)}`);
  return r.blatt;
}
