"use client";

import Link from "next/link";
import { useEffect } from "react";

import { WiederholenBlock } from "@/components/kombi/home/wiederholen";
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
      <div className="modes">
        {/* Abschnitt E: der Block „Wiederholen“; Abschnitt B setzt ihn in den Überblick */}
        <div className="mode on" id="m-ueberblick">
          <WiederholenBlock stand={(kombi.tagDaten ?? daten)?.wiederholen} />
          <AbrufUebergang eingang={(kombi.tagDaten ?? daten)?.abrufEingang ?? 0} />
        </div>
      </div>
    </div>
  );
}

/**
 * Übergang bis D/G (Plan 2.2: Zeilen aus Fach, Klausur und Einstellungen):
 * Seit /abruf nach / umleitet, führen nur diese Zeilen in der Gestalt von
 * „Und eine weitere …“ zu den wartenden KI-Fragen und zu „Fragen und
 * Termine“ (/abruf/bausteine, mit „Termine neu rechnen“). Bisher stand „n
 * Fragen warten im Eingang“ ganz oben auf /abruf. Mit den Zeilen aus 2.2
 * entfällt dieser Block.
 */
function AbrufUebergang({ eingang }: { eingang: number }) {
  return (
    <div className="abruf-uebergang">
      {eingang > 0 ? (
        <Link className="textline more" href="/abruf/eingang">
          {eingang === 1 ? "Eine Frage wartet im Eingang" : `${eingang} Fragen warten im Eingang`}
          <Icon name="chevron_right" />
        </Link>
      ) : null}
      <Link className="textline more" href="/abruf/bausteine">
        Fragen und Termine
        <Icon name="chevron_right" />
      </Link>
    </div>
  );
}
