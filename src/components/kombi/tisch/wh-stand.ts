"use client";

import { useSyncExternalStore } from "react";

import type { WhStand } from "@/lib/kombi/wiederholen-text";

/**
 * Der Stand des Knopfs „Wiederholen“, wie ihn der Tisch beim Schließen
 * kennt (Prototyp `closeTisch` → `renderWH`, Z. 4322–4331): Bleibt der Knopf,
 * steht seine neue Zahl schon drin, bevor der Tisch in ihn zurückgeht; die
 * Textzeile ersetzt ihn erst nach dem Schrumpfen. Sobald die Shell die
 * Tagesdaten neu geladen hat, gilt wieder deren Stand.
 */

export type WhUeberschreibung = { stand: WhStand; animiert: boolean; nr: number };

let aktuell: WhUeberschreibung | null = null;
let zaehler = 0;
const hoerer = new Set<() => void>();

const melden = () => hoerer.forEach((h) => h());

export function whSetzen(stand: WhStand, animiert: boolean): void {
  aktuell = { stand, animiert, nr: ++zaehler };
  melden();
}

export function whZuruecksetzen(): void {
  if (!aktuell) return;
  aktuell = null;
  melden();
}

export function useWhUeberschreibung(): WhUeberschreibung | null {
  return useSyncExternalStore(
    (h) => {
      hoerer.add(h);
      return () => hoerer.delete(h);
    },
    () => aktuell,
    () => null,
  );
}
