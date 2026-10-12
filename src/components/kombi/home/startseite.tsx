"use client";

import { useEffect } from "react";

import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import type { TagDaten } from "@/lib/kombi/tag-daten";
import { voll } from "@/lib/kombi/text";

/**
 * Die Startseite in der Ebene `home` (Prototyp Z. 844–857): Datumszeile mit
 * Zahnrad, Überschrift, darunter die Tageszeit-Ansichten.
 *
 * Abschnitt A baut nur das Gerüst: Datumszeile (`voll(tag)`, Prototyp
 * `renderWhen`) und Zahnrad; Überschrift und Ansichten (Morgens, Überblick,
 * Morgen früh) bringt Abschnitt B.
 *
 * Kommt die Seite vom Server mit Daten (Kaltstart auf `/`), merkt sich die
 * Shell sie — so braucht sie beim Wechsel auf eine Route keinen zweiten
 * Abruf (Plan 2.4, Punkt 1). Ohne Daten steht das Gerüst ohne Datum.
 */
export function Startseite({ daten, vomServer = false }: { daten: TagDaten | null; vomServer?: boolean }) {
  const kombi = useKombi();
  const { merkeTagDaten } = kombi;

  useEffect(() => {
    if (vomServer && daten) merkeTagDaten(daten);
  }, [vomServer, daten, merkeTagDaten]);

  return (
    <div className="scroll" id="homeScroll">
      <header className="whenrow enter" id="whenrow">
        <div className="when" id="when">
          <span id="wDate">{daten ? voll(daten.tag) : ""}</span>
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
      <h1 className="hl enter" id="h1" />
      <div className="modes" />
    </div>
  );
}
