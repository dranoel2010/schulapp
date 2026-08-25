"use client";

import { createContext, useContext } from "react";

/**
 * Welche Seite der Wischhülle gerade vorn ist.
 *
 * **Es gibt genau einen Grund dafür, und der ist die Kamera.** Alle drei Seiten
 * liegen die ganze Zeit im Dokument — geblättert wird über `transform`, nicht
 * über Aus- und Einbauen. Für Text ist das richtig: er steht schon da, wenn man
 * ankommt. Ein laufendes Kamerabild ist es nicht. Es würde die ganze Zeit
 * mitlaufen, das Lämpchen des Geräts brennen lassen, beim ersten Öffnen der App
 * ungefragt um Kamerazugriff bitten und den Akku für ein Bild verbrauchen, das
 * niemand sieht.
 *
 * Also sagt die Hülle, was nur sie weiß: welche Seite vorn ist. Wer das nicht
 * braucht, merkt nichts davon.
 */

const PagerPage = createContext<number | null>(null);

export const PagerPageProvider = PagerPage.Provider;

/**
 * Ist diese Seite gerade vorn?
 *
 * Außerhalb der Wischhülle — am großen Bildschirm, wo das Dashboard steht —
 * gibt es keine Hülle und damit auch kein Blättern. Dann ist die Antwort `true`:
 * was gerendert wird, ist zu sehen.
 */
export function useIsFrontPage(index: number): boolean {
  const page = useContext(PagerPage);
  return page === null || page === index;
}
