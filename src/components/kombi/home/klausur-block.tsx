"use client";

import { useEffect, useRef } from "react";

import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { fmtRest, restMs, useBlock, useSekunde, zustand } from "@/components/kombi/lernblock/uhr";
import type { BlockDaten, LernblockUeberblick } from "@/lib/kombi/lernblock-daten";
import { E, reduce } from "@/lib/kombi/motion";
import { verpasstSatz } from "@/lib/kombi/verpasst";
import { diffDays, esc, kurz, tn, weekdayOrDate, zahl } from "@/lib/kombi/text";

/**
 * Der Block „Klausur“ im Überblick (Prototyp `ovKlausur` und
 * `updateBlockUI`, Z. 1970–2014): Klausurzeile, darunter die Lernblockzeile
 * mit „Starten“, der Restzeit, „Weiter“, „Auswerten“ oder „Erledigt“; ohne
 * Block heute „Nächster Lernblock Mittwoch · Wiederholung“. Dazu „Und eine
 * weitere …“, die verpassten Blöcke (Plan 3.5) und die Lernblöcke heute zu
 * weiteren Klausuren („Noch ein Lernblock heute: Mathe ›“, wie bisher unter
 * „Heute“ auf /lernen) in derselben Gestalt.
 *
 * Abschnitt B setzt ihn in die Ansicht `ueberblick`; die Daten kommen aus
 * `TagDaten.lernblock`.
 */

export const relTage = (heute: string, datum: string): string => {
  const n = diffDays(heute, datum);
  return n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`;
};

/** „25 Minuten“, beim Block mit Arbeitsblatt „25 Minuten mit Arbeitsblatt“ (Prototyp `lbDauer`). */
export const lbDauer = (b: BlockDaten): string =>
  `${b.minuten} Minuten${b.blatt && !b.blatt.fehlgeschlagen ? " mit Arbeitsblatt" : ""}`;

export function KlausurBlock({ daten, heute }: { daten: LernblockUeberblick; heute: string }) {
  const kombi = useKombi();
  const k = daten.klausur;
  return (
    <div className="blk enter" id="ovKl">
      <h2 className="lab">Klausur</h2>
      {k ? (
        <button
          className="exam-row"
          type="button"
          aria-label={`Klausur ${k.fach} öffnen`}
          onPointerDown={() => kombi.vorladen("klausur", { id: k.id })}
          onClick={() => kombi.openPage("klausur", { id: k.id })}
        >
          <span>
            <b>{k.kurz}</b>
            <span>
              {kurz(k.datum)} · {relTage(heute, k.datum)}
            </span>
          </span>
          <Icon name="chevron_right" />
        </button>
      ) : null}
      {k && daten.heute ? (
        <LernblockZeile block={daten.heute} fach={k.fach} klausurDatum={k.datum} />
      ) : daten.naechster ? (
        <div className="lb-row">
          <p>
            Nächster Lernblock {weekdayOrDate(daten.naechster.tag, heute)} · {daten.naechster.art}
          </p>
        </div>
      ) : null}
      {daten.heuteWeitere.map((w) => (
        <button
          key={w.examId}
          className="textline more"
          type="button"
          onPointerDown={() => kombi.vorladen("klausur", { id: w.examId })}
          onClick={() => kombi.openPage("klausur", { id: w.examId })}
        >
          Noch ein Lernblock heute: {w.kurz}
          <Icon name="chevron_right" />
        </button>
      ))}
      {daten.verpasst.map((v) => (
        <button
          key={v.examId}
          className="textline more"
          type="button"
          onPointerDown={() => kombi.vorladen("klausur", { id: v.examId })}
          onClick={() => kombi.openPage("klausur", { id: v.examId })}
        >
          {verpasstSatz(v, heute)}
          <Icon name="chevron_right" />
        </button>
      ))}
      {daten.weitere ? (
        <button className="textline more" type="button" onClick={() => kombi.openPage("klausuren")}>
          Und {daten.weitere.anzahl === 1 ? "eine weitere" : `${zahl(daten.weitere.anzahl)} weitere`} am{" "}
          {kurz(daten.weitere.datum)}
          <Icon name="chevron_right" />
        </button>
      ) : null}
    </div>
  );
}

/** Die Lernblockzeile (Prototyp `#lbRow`, `updateBlockUI`). */
function LernblockZeile({ block: vomServer, fach, klausurDatum }: { block: BlockDaten; fach: string; klausurDatum: string }) {
  const kombi = useKombi();
  const block = useBlock(vomServer)!;
  const z = zustand(block);
  const jetzt = useSekunde(z === "laeuft");
  const rest = restMs(block, jetzt);
  const done = z === "erledigt";
  const gedruckt = !done && !!block.blatt?.gedruckt && !block.blatt.ausgewertet;

  const rowRef = useRef<HTMLDivElement>(null);
  const warDone = useRef<boolean | null>(null);
  useEffect(() => {
    // „Erledigt“ kommt mit kurzem Einblenden, nur beim Wechsel (nicht beim ersten Malen)
    if (warDone.current === false && done && !reduce()) {
      rowRef.current
        ?.querySelector(".lbdone")
        ?.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: E.out });
    }
    warDone.current = done;
  }, [done]);

  const text = gedruckt ? "Auswerten" : z === "ruhe" || done ? "Starten" : z === "pausiert" ? "Weiter" : null;
  // als HTML wie im Prototyp: Zahlen mit `tn`, Text maskiert
  const sub = done
    ? esc(
        block.blatt?.perWH
          ? "Blatt beim Wiederholen ausgewertet"
          : block.blatt?.ausgewertet
            ? "Arbeitsblatt ausgewertet"
            : lbDauer(block),
      )
    : gedruckt
      ? esc("Gedruckt, noch nicht ausgewertet")
      : z === "pausiert"
        ? `Pausiert bei ${tn(fmtRest(rest))}`
        : esc(lbDauer(block));

  return (
    <div className={`lb-row${done ? " erledigt" : ""}`} id="lbRow" ref={rowRef}>
      <p>
        <span className="lbk">Lernblock&nbsp;· </span>
        {block.titel}
        <span>
          <span className="lbk2">Lernblock · </span>
          <span id="lbSub" dangerouslySetInnerHTML={{ __html: sub }} />
        </span>
      </p>
      <div className="lb-act">
        <button
          className="lbbtn"
          type="button"
          id="lbBtn"
          tabIndex={done ? -1 : 0}
          aria-label={z === "ruhe" ? "Lernblock starten" : `Lernblock fortsetzen, noch ${fmtRest(rest)}`}
          onClick={(e) =>
            kombi.openTisch({
              mode: "block",
              origin: e.currentTarget,
              blockId: block.id,
              fach,
              klausurDatum,
              // Die Probeklausur ist immer ein Blatt: der Tisch des Blatts baut es
              // nach oder sagt, dass es fehlt (nie die Karten)
              blatt: block.art === "probe" || (!!block.blatt && !block.blatt.fehlgeschlagen),
            })
          }
        >
          {text ? <span id="lbText">{text}</span> : <span id="lbText" dangerouslySetInnerHTML={{ __html: tn(fmtRest(rest)) }} />}
        </button>
        <span className="lbdone">
          <Icon name="check" className="s18" />
          Erledigt
        </span>
      </div>
    </div>
  );
}
