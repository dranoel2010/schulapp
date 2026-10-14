"use client";

import { createContext, useContext } from "react";

import type { Bereich } from "./bereiche";

/**
 * Was in der Liste am Rechner gewählt ist (liste-detail.tsx stellt es nur um
 * die Liste). Außerhalb davon — am Handy, im Detail — ist es `null`: dort
 * tragen Zeilen weder `data-id` noch `.sel`. Eigene Datei ohne weitere
 * Importe, damit die Zeilen der Seiten sie ohne Kreis über die Registry lesen.
 */
export type Auswahl = { bereich: Bereich; sel: string | null };

export const AuswahlKontext = createContext<Auswahl | null>(null);

export function useAuswahl(): Auswahl | null {
  return useContext(AuswahlKontext);
}
