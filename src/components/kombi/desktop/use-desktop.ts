"use client";

import { useSyncExternalStore } from "react";

/**
 * Ab 1024 px ist die App ein Schreibtisch (desktop.html, EINBAU.md „Am
 * Rechner“). Was zu sehen ist, steuert allein das CSS in src/app/desktop/;
 * dieser Hook steuert nur Verhalten (Bereich statt Stapel, Dialog statt
 * Sheet, Tastatur). Auf dem Server und beim Hydrieren ist er `false`, damit
 * Server und Browser gleich rendern; die Weiche greift erst nach dem Mount.
 */

export const DESKTOP_MQ = "(min-width:1024px)";

let mql: MediaQueryList | null = null;
const mq = (): MediaQueryList => (mql ??= window.matchMedia(DESKTOP_MQ));

function abonnieren(f: () => void): () => void {
  const m = mq();
  m.addEventListener("change", f);
  return () => m.removeEventListener("change", f);
}

/** Jetzt am Rechner? Für Ereignisse und Effekte (nach dem Mount). */
export function istDesktop(): boolean {
  return typeof window !== "undefined" && mq().matches;
}

export function useDesktop(): boolean {
  return useSyncExternalStore(abonnieren, istDesktop, () => false);
}
