"use client";

import type { CSSProperties } from "react";

import { useKombi } from "@/components/kombi/kontext";
import { useBlock, zustand } from "@/components/kombi/lernblock/uhr";
import { Tn } from "@/components/kombi/tn";
import type { BlockDaten } from "@/lib/kombi/lernblock-daten";
import { dm, kurz } from "@/lib/kombi/text";
import { probeHilfsmittel } from "@/lib/probe-hilfsmittel";

import { streifenWochen } from "./lernplan-wochen";

/**
 * Der Lernplan am Rechner als Wochenstreifen (desktop.html `klausurDetail`,
 * `.lp`): Montag bis Freitag nebeneinander, heute kräftig mit „Starten“ bzw.
 * „Weiter“, am Klausurtag die Klausur mit Stunde. Lernblöcke tragen keine
 * Uhrzeit. Von 1024 bis 1279 px ist es eine Zeile je Tag (listen.css).
 *
 * Anders als im Entwurf steht nicht nur die Klausurwoche da: ein Streifen je
 * Woche vom ersten Block bis zur Klausur, Samstag und Sonntag nur mit Eintrag
 * (lernplan-wochen.ts). Kein Block fällt heraus.
 */

/** Unterzeile eines Planeintrags (Prototyp `planRows`); die Probeklausur nennt ihre Hilfsmittel nach dem Fach. */
export function planUnterzeile(b: BlockDaten, fach: string): string {
  const erledigt = b.status === "done" ? ", erledigt" : "";
  if (b.art === "review") return `${b.thema ?? "Alle Themen"}, ${b.minuten} Minuten${erledigt}`;
  if (b.art === "probe") return `${probeHilfsmittel(fach)}, ${b.minuten} Minuten${erledigt}`;
  return `${b.alsBlatt && !b.blatt?.fehlgeschlagen ? "Lernblock mit Arbeitsblatt" : "Lernblock"}, ${b.minuten} Minuten${erledigt}`;
}

export function LernplanStreifen({
  bloecke,
  heute,
  klausurTag,
  art,
  stunde,
  stundeVon,
  fach,
}: {
  /** ohne gestrichene, nach Tag und Reihenfolge */
  bloecke: readonly BlockDaten[];
  heute: string;
  klausurTag: string;
  /** „Klausur“, „Test“ … */
  art: string;
  stunde: number | null;
  stundeVon: string | null;
  fach: string;
}) {
  const wochen = streifenWochen(
    bloecke.map((b) => b.tag),
    klausurTag,
  );
  return (
    <div className="lp-wochen">
      {wochen.map((tage) => (
        <div className={`lp${tage.length > 5 ? " lp-wende" : ""}`} key={tage[0]} style={{ "--n": tage.length } as CSSProperties}>
          {tage.map((d) => {
            const amTag = bloecke.filter((b) => b.tag === d);
            const istHeute = d === heute;
            const klausur = d === klausurTag;
            return (
              <div
                key={d}
                data-tag={d}
                className={`lp-d${istHeute ? " today" : ""}${klausur ? " exday" : ""}${d < heute ? " vorbei" : ""}`}
              >
                <span className="pday">{istHeute ? <Tn s={`Heute, ${dm(d)}`} /> : <Tn s={kurz(d)} />}</span>
                <div className="lp-t">
                  {amTag.map((b) => (
                    <StreifenBlock key={b.id} block={b} heute={heute} fach={fach} klausurTag={klausurTag} />
                  ))}
                  {klausur ? (
                    <div className="lp-b">
                      {/* in <p> wie die Blöcke: knapp steht die Stunde unter „Klausur“, nicht in der Spalte von „Starten“ */}
                      <p>
                        <b>{art}</b>
                        {stunde ? (
                          <span>
                            <Tn s={stundeVon ? `${stunde}. Stunde, ${stundeVon}` : `${stunde}. Stunde`} />
                          </span>
                        ) : null}
                      </p>
                    </div>
                  ) : null}
                  {!amTag.length && !klausur ? <span className="none">{d < heute || d > klausurTag ? "" : "Frei"}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Ein Eintrag im Streifen; der heutige offene trägt „Starten“ bzw. „Weiter“ und öffnet den Tisch. */
function StreifenBlock({ block: vomServer, heute, fach, klausurTag }: { block: BlockDaten; heute: string; fach: string; klausurTag: string }) {
  const kombi = useKombi();
  // Status und Uhr aus dem Speicher, den auch der Tisch schreibt
  const b = useBlock(vomServer)!;
  const z = zustand(b);
  const offen = b.tag === heute && b.status !== "done";
  return (
    <div className={`lp-b${b.status === "done" ? " done" : ""}`}>
      <p>
        <b>{b.titel}</b>
        <span>{planUnterzeile(b, fach)}</span>
      </p>
      {offen ? (
        <button
          className="lbbtn"
          type="button"
          aria-label={z === "ruhe" ? `${b.titel}, Lernblock starten` : `${b.titel}, Lernblock fortsetzen`}
          onClick={(e) =>
            kombi.openTisch({
              mode: "block",
              origin: e.currentTarget,
              blockId: b.id,
              fach,
              klausurDatum: klausurTag,
              blatt: b.art === "probe" || (!!b.blatt && !b.blatt.fehlgeschlagen),
            })
          }
        >
          {z === "ruhe" ? "Starten" : "Weiter"}
        </button>
      ) : null}
    </div>
  );
}
