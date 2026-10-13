"use client";

import { addDays } from "@/lib/dates";
import { lang, TAG, wd } from "@/lib/kombi/text";
import type { HausaufgabenDaten } from "@/lib/seiten/hausaufgaben";

import { AufgabeZeile, useAufgaben, type ZeilenModus } from "./aufgabe";
import { TextLine } from "./zeilen";

/**
 * Hausaufgaben (Prototyp `PAGES.hausaufgaben` und `hausaufgabenGroups`,
 * Z. 3026–3105): „Für ⟨Tag⟩“, „Später“, „Erledigt“ — davor „Heute“ mit
 * den heute fälligen, noch offenen Aufgaben (sonst fänden sie sich nach der
 * Schule nur über das Fach). Ist „Für ⟨Tag⟩“ leer,
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
  // [Überschrift, Liste, Modus, leer zeigen]: „Heute“ nur, wenn etwas offen ist
  const gruppen: [string, HausaufgabenDaten["fuer"], ZeilenModus, boolean][] = [
    ["Heute", anwenden(daten.heuteFaellig ?? []), "page", false],
    [fuer, anwenden(daten.fuer), "page", true],
    ["Später", anwenden(daten.spaeter), "page-sp", false],
    ["Erledigt", anwenden(daten.erledigt), "page", false],
  ];

  return (
    <>
      <div ref={ankerRef}>
        {gruppen.map(([l, liste, modus, leerZeigen]) => (
          <div className="group" data-g={l} key={l} hidden={!liste.length && !leerZeigen}>
            <h3 className="lab">{l}</h3>
            <div>
              {!liste.length && leerZeigen ? <p className="empty">{`${fuer} ist nichts offen.`}</p> : null}
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
