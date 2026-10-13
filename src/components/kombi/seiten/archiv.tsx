"use client";

import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { lang } from "@/lib/kombi/text";
import type { ArchivSeite } from "@/lib/seiten/archiv";

import { AufgabeZeile, useAufgaben } from "./aufgabe";

/**
 * Das Archiv (Antwort 11): eine schlichte Liste in der Formensprache der
 * Hausaufgaben-Seite. Oben die Klausuren (ab Tag 15 nach dem Klausurtag),
 * darunter die erledigten Aufgaben (zwei Tage nach dem Abhaken). Ein Tipp auf
 * eine Aufgabe öffnet sie wieder, wie unter „Erledigt“; sie steht dann wieder
 * in der Liste „Hausaufgaben“, der Toast sagt es.
 */
export function ArchivInhalt({ daten: vomServer }: { daten: ArchivSeite }) {
  const kombi = useKombi();
  const { stand: daten, anwenden, schalten, loeschen, ankerRef } = useAufgaben(vomServer, { wiederOffenMelden: true });
  const aufgaben = anwenden(daten.aufgaben);
  const leer = !daten.klausuren.length && !aufgaben.length;

  return (
    <div ref={ankerRef}>
      {leer ? <p className="empty">Im Archiv ist noch nichts.</p> : null}
      <div className="group" data-g="Klausuren" hidden={!daten.klausuren.length}>
        <h3 className="lab">Klausuren</h3>
        <div>
          {daten.klausuren.map((k) => (
            <button
              key={k.id}
              className="lrow plain"
              type="button"
              onPointerDown={() => kombi.vorladen("klausur", { id: k.id })}
              onClick={() => kombi.openPage("klausur", { id: k.id })}
            >
              <span>
                <b>{k.fach}</b>
                <span className="s">
                  {lang(k.datum)} · {k.thema}
                </span>
              </span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </div>
      </div>
      <div className="group" data-g="Hausaufgaben" hidden={!aufgaben.length}>
        <h3 className="lab">Hausaufgaben</h3>
        <div>
          {aufgaben.map((a) => (
            <AufgabeZeile
              key={a.id}
              a={a}
              modus="archiv"
              heute={daten.heute}
              onSchalten={schalten}
              onLoeschen={loeschen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
