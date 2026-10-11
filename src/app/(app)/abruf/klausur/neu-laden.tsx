"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Lädt die Klausurseite nach, solange Claude Fragen baut (seit dem
 * 11.10.2026).
 *
 * Ein Lauf dauert ein, zwei Minuten, und danach soll die Seite von selbst
 * sagen, was herauskam — ohne dass jemand neu lädt. Der Baustein steht nur
 * da, solange der Server „baut gerade“ meldet: zeichnet `router.refresh()` die
 * Seite ohne Lauf neu, verschwindet er, und mit ihm der Takt. Gefragt wird nur,
 * solange der Tab sichtbar ist.
 *
 * Bewusst einfacher als `AutoRefresh` der Blätter
 * (@/components/material/auto-refresh): diese Seite hat kein Formular, in das
 * getippt wird, und keinen Fingerabdruck, an dem sich ein neuer Stand billig
 * erkennen ließe — sie ist eine Auskunft, und ihr Neuzeichnen kostet drei
 * kleine Abfragen.
 */

/** Wie oft nachgefragt wird — ein Zehntel der kürzesten gemessenen Laufzeit. */
const TAKT_MS = 10_000;

export function NeuLadenWaehrendFragen() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, TAKT_MS);

    return () => clearInterval(timer);
  }, [router]);

  return null;
}
