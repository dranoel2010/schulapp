"use client";

import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";

/**
 * Die Datumszeile (Prototyp Z. 846–849, `renderWhen` Z. 1627): nur das Datum
 * „Montag, 12. Oktober“ — kein „morgens“ dahinter, keine Pille „Jetzt“, kein
 * Menü (Plan B: der Prototyp geht V2 3.4 und Kriterium 12 vor). Rechts das
 * Zahnrad zu den Einstellungen.
 */
export function Datumszeile({ datum }: { datum: string }) {
  const kombi = useKombi();
  return (
    <header className="whenrow enter" id="whenrow">
      <div className="when" id="when">
        <span id="wDate">{datum}</span>
      </div>
      <button
        className="gear"
        id="gearBtn"
        type="button"
        aria-label="Einstellungen"
        onPointerDown={() => kombi.vorladen("einstellungen")}
        onClick={() => kombi.openPage("einstellungen")}
      >
        <Icon name="settings" />
      </button>
    </header>
  );
}
