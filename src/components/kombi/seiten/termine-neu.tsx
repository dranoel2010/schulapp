"use client";

import { termineNeuAction } from "@/app/(app)/klausuren/seite-actions";
import { useKombi } from "@/components/kombi/kontext";

import { RowBtn } from "./zeilen";

/**
 * „Termine neu rechnen“ (Plan 2.2, F, G): der bestehende Rettungsweg nach
 * einer nachgetragenen oder verschobenen Klausur — `neuPlanen()`, bisher auf
 * /abruf. Er legt die offenen Wiederholungstermine wieder vor die Klausur;
 * am Takt ändert sich nichts. Danach ein Toast mit der Zahl der Termine.
 */
export function TermineNeuZeile() {
  const kombi = useKombi();
  const rechnen = () => {
    termineNeuAction().then(
      (r) => {
        kombi.toast(
          r.termine === 0
            ? "Kein offener Termin"
            : r.termine === 1
              ? "Ein Termin neu gelegt"
              : `${r.termine} Termine neu gelegt`,
        );
        void kombi.neuLaden();
      },
      () => kombi.fehlerToast("Nicht gespeichert", rechnen, "Erneut"),
    );
  };
  return (
    <RowBtn
      titel="Termine neu rechnen"
      sub="Nach einer neuen oder verschobenen Klausur: legt die Wiederholungstermine wieder vor die Klausur. Am Takt ändert sich nichts."
      ziel={{ onClick: rechnen }}
      rechts={<span />}
    />
  );
}
