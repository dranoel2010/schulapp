"use client";

import { createContext, useContext } from "react";

/** Aktiver Startseiten-Tab. Die Kamera (0) läuft nur, wenn sie sichtbar ist. */

const PagerPage = createContext<number | null>(null);

export const PagerPageProvider = PagerPage.Provider;

/** Ohne Tab-Hülle ist die eingebundene Ansicht sichtbar. */
export function useIsFrontPage(index: number): boolean {
  const page = useContext(PagerPage);
  return page === null || page === index;
}
