"use client";

import { createContext, useContext, type ReactNode } from "react";

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

/**
 * Was ein Teil für eine Auswahl ohne eigene Seite rendert (die Aufgabe hat
 * keine Seite der Registry). Der Teil setzt ihn beim Laden seines Moduls:
 * `detailSlotSetzen("hausaufgaben", (sel) => <AufgabeDetail id={sel} />)`.
 * Steht hier und nicht in liste-detail.tsx: ein Teil, den die Registry lädt,
 * liefe sonst beim Laden in den Kreis Registry → Seite → Liste und Detail.
 */
export type DetailSlot = (sel: string) => ReactNode;
const slots = new Map<Bereich, DetailSlot>();

export function detailSlotSetzen(bereich: Bereich, f: DetailSlot): void {
  slots.set(bereich, f);
}

export function detailSlot(bereich: Bereich): DetailSlot | undefined {
  return slots.get(bereich);
}
