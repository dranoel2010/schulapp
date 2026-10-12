"use client";

import { AufgabeZeile } from "@/components/kombi/aufgabe-zeile";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import type { AufgabeT, MorgenT } from "@/lib/kombi/startseite";
import { tn } from "@/lib/kombi/text";

/**
 * Die Morgenansicht (V2 3.3, Prototyp `renderMorgens`, Z. 1914): „Abgeben“
 * mit allen Abgaben des Tages (offene zuerst, erledigte mit Haken darunter),
 * „Stunden“ als kompakte Zeilen (Beginn, Fach, Raum; der Hauptunterricht mit
 * Thema), „Klausur heute“ nur an dem Tag, und am Ende „Ganze Woche“.
 *
 * Dieselbe Ansicht zeigt als „Morgen früh“ (`frueh`) den nächsten Schultag.
 */
export function Morgens({
  morgen,
  abgaben,
  heute,
  onAbhaken,
  onBearbeiten,
  onLoeschen,
}: {
  morgen: MorgenT;
  /** Die Abgaben des Tages, schon in der Reihenfolge der Anzeige */
  abgaben: AufgabeT[];
  heute: string;
  onAbhaken: (id: string, done: boolean) => void;
  onBearbeiten: (id: string) => void;
  onLoeschen: (id: string) => void;
}) {
  const kombi = useKombi();
  return (
    <>
      {abgaben.length > 0 ? (
        <div className="blk enter">
          <h2 className="lab">Abgeben</h2>
          <div className="mo-list">
            {abgaben.map((a) => (
              <AufgabeZeile
                key={a.id}
                a={a}
                modus="mo"
                heute={heute}
                onAbhaken={onAbhaken}
                onBearbeiten={onBearbeiten}
                onLoeschen={onLoeschen}
              />
            ))}
          </div>
        </div>
      ) : null}
      <div className="blk enter">
        <h2 className="lab">Stunden</h2>
        <div>
          {morgen.stunden.map((l) => (
            <div className="lesson-row" key={l.nr}>
              <time dangerouslySetInnerHTML={{ __html: tn(l.von) }} />
              <div>
                <b>{l.fach}</b>
                {l.hu ? <em>{l.hu}</em> : null}
              </div>
              <span className="room">{l.raum ?? ""}</span>
            </div>
          ))}
        </div>
      </div>
      {morgen.klausur ? (
        <div className="blk enter">
          <h2 className="lab">Klausur heute</h2>
          <p className="examtoday">{morgen.klausur}</p>
        </div>
      ) : null}
      <div className="blk enter">
        <button
          className="textline big"
          type="button"
          onPointerDown={() => kombi.vorladen("woche", { tag: morgen.tag })}
          onClick={() => kombi.openPage("woche", { tag: morgen.tag })}
        >
          Ganze Woche
          <Icon name="chevron_right" />
        </button>
      </div>
    </>
  );
}
