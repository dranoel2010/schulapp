"use client";

import { startTransition, useCallback, useOptimistic } from "react";

/**
 * Optimistische Actions der neuen Oberfläche (Plan 2.4, Punkt 9).
 *
 * Abhaken, Wischen, Eintragen, „Fach ändern“ zeigen ihr Ergebnis sofort.
 * Scheitert der Aufruf, erscheint ZUERST der Toast „Nicht gespeichert“ mit
 * „Erneut“, und erst danach springt der Zustand zurück — nie still.
 *
 * Gebaut auf `useOptimistic`: Solange die Transition läuft, gilt der
 * optimistische Stand. Gelingt der Aufruf, übernimmt der Aufrufer den neuen
 * Stand in `bestaetigen` (in derselben Transition), dann bleibt er stehen.
 * Scheitert er, zeigt `fehlerToast` die Meldung, die Transition wartet
 * `RUECKSPRUNG_MS` (der Toast fährt in 260 ms ein) und endet dann — und
 * `useOptimistic` fällt auf den alten Stand zurück.
 */

export const RUECKSPRUNG_MS = 320;

/** So lange steht ein Toast (Prototyp Z. 1601ff.). */
export const TOAST_MS = 4500;

export type FehlerToast = (text: string, erneut: () => void, label: string) => void;

const warten = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useOptimistischeAktion<S, A>(
  stand: S,
  anwenden: (stand: S, aktion: A) => S,
  fehlerToast: FehlerToast,
) {
  const [optimistisch, setzeOptimistisch] = useOptimistic(stand, anwenden);

  const ausfuehren = useCallback(
    function ausfuehren(
      aktion: A,
      aufruf: () => Promise<unknown>,
      bestaetigen?: (ergebnis: unknown) => void,
    ): void {
      startTransition(async () => {
        setzeOptimistisch(aktion);
        try {
          const ergebnis = await aufruf();
          if (
            ergebnis &&
            typeof ergebnis === "object" &&
            "ok" in ergebnis &&
            (ergebnis as { ok: unknown }).ok === false
          ) {
            throw new Error("abgewiesen");
          }
          startTransition(() => bestaetigen?.(ergebnis));
        } catch {
          fehlerToast("Nicht gespeichert", () => ausfuehren(aktion, aufruf, bestaetigen), "Erneut");
          await warten(RUECKSPRUNG_MS);
        }
      });
    },
    [setzeOptimistisch, fehlerToast],
  );

  return [optimistisch, ausfuehren] as const;
}
