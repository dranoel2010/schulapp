"use client";

import { addDays } from "@/lib/dates";
import { lang, TAG, wd } from "@/lib/kombi/text";
import type { HausaufgabenDaten } from "@/lib/seiten/hausaufgaben";

import { AufgabeZeile, useAufgaben, type ZeilenModus } from "./aufgabe";
import { TextLine } from "./zeilen";

/**
 * Hausaufgaben (Prototyp `PAGES.hausaufgaben` und `hausaufgabenGroups`,
 * Z. 3026–3105): „Für ⟨Tag⟩“, „Später“, „Erledigt“. Ist „Für ⟨Tag⟩“ leer,
 * steht dort „Für ⟨Tag⟩ ist nichts offen.“ Darunter der Weg zum Formular mit
 * Details (Plan 2.2).
 */

/** „Dienstag“, wenn es morgen ist, sonst „Montag, 19.10.“ (Prototyp `tagName`) */
export const tagName = (tag: string, heute: string) =>
  tag === addDays(heute, 1) ? TAG[wd(tag)] : lang(tag);

export function HausaufgabenInhalt({ daten: vomServer }: { daten: HausaufgabenDaten }) {
  // gezeigt wird der Stand, den der FLIP-Lauf übernommen hat (useAufgaben)
  const { stand: daten, anwenden, schalten, loeschen, ankerRef } = useAufgaben(vomServer);
  const fuer = `Für ${tagName(daten.ns, daten.heute)}`;
  const gruppen: [string, HausaufgabenDaten["fuer"], ZeilenModus][] = [
    [fuer, anwenden(daten.fuer), "page"],
    ["Später", anwenden(daten.spaeter), "page-sp"],
    ["Erledigt", anwenden(daten.erledigt), "page"],
  ];

  return (
    <>
      <div ref={ankerRef}>
        {gruppen.map(([l, liste, modus], i) => (
          <div className="group" data-g={l} key={l} hidden={!liste.length && i > 0}>
            <h3 className="lab">{l}</h3>
            <div>
              {!liste.length && i === 0 ? <p className="empty">{`${fuer} ist nichts offen.`}</p> : null}
              {liste.map((a) => (
                <AufgabeZeile
                  key={a.id}
                  a={a}
                  modus={modus}
                  heute={daten.heute}
                  onSchalten={schalten}
                  onLoeschen={loeschen}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 16 }} />
      <TextLine href="/hausaufgaben/neu">Mit Details eintragen</TextLine>
    </>
  );
}
