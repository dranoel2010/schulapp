"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { wiederholenVorwaermen } from "@/components/kombi/tisch/daten";
import { useWhUeberschreibung, whZuruecksetzen } from "@/components/kombi/tisch/wh-stand";
import { E, reduce, swapText } from "@/lib/kombi/motion";
import { LEER_TEXT, themenText, type WhStand } from "@/lib/kombi/wiederholen-text";

/**
 * Der Block „Wiederholen“ auf dem Überblick (V2 4.5; Prototyp `#ovWh`,
 * `renderWH`, Z. 1941 und 2034–2054): der einzige gefüllte blaue Knopf mit der
 * Zahl der fälligen Themen und der Unterzeile, oder — ist nichts fällig — die
 * Textzeile. In Ferien fehlt der Block.
 *
 * Abschnitt B baut den Überblick; dort steht dieser Block nach der
 * Klausurzeile an der Stelle von `#ovWh`.
 *
 * Der Stand kommt aus `TagDaten.wiederholen`. Beim Schließen des Tisches
 * setzt der Tisch ihn vorab (`wh-stand.ts`): bleibt der Knopf, steht die neue
 * Zahl schon drin, bevor der Tisch in ihn zurückschrumpft; danach blenden Zahl
 * und Unterzeile über, oder die Textzeile ersetzt den Knopf (13.3 Nr. 58).
 */
export function WiederholenBlock({ stand: vomServer }: { stand: WhStand | null | undefined }) {
  const kombi = useKombi();
  const ueber = useWhUeberschreibung();
  const stand = ueber?.stand ?? vomServer ?? null;
  const animiert = !!ueber?.animiert;

  const nRef = useRef<HTMLSpanElement & { _text?: string }>(null);
  const subRef = useRef<HTMLParagraphElement & { _text?: string }>(null);
  const okRef = useRef<HTMLParagraphElement>(null);
  const vorher = useRef<WhStand["kind"] | null>(null);
  // Der erste Stand steht schon im Server-HTML; danach führt der Effekt den Text (swapText).
  const [anfang] = useState(() => ({
    n: stand?.kind === "knopf" ? themenText(stand.n) : "",
    sub: stand?.kind === "knopf" ? stand.sub : "",
  }));

  // Neue Tagesdaten vom Server gelten wieder (nach `neuLaden()` beim Schließen)
  const serverStand = JSON.stringify(vomServer ?? null);
  const ersterServer = useRef(serverStand);
  useLayoutEffect(() => {
    if (ersterServer.current === serverStand) return;
    ersterServer.current = serverStand;
    whZuruecksetzen();
  }, [serverStand]);

  useLayoutEffect(() => {
    if (!stand) return;
    const war = vorher.current;
    vorher.current = stand.kind;
    if (stand.kind === "knopf") {
      const label = themenText(stand.n);
      const n = nRef.current;
      const sub = subRef.current;
      if (n) {
        if (animiert && war === "knopf") swapText(n, label);
        else {
          n.getAnimations().forEach((a) => a.cancel());
          n.textContent = label;
          n._text = label;
        }
      }
      if (sub) {
        if (animiert && war === "knopf") swapText(sub, stand.sub);
        else {
          sub.getAnimations().forEach((a) => a.cancel());
          sub.textContent = stand.sub;
          sub._text = stand.sub;
        }
      }
    } else if (animiert && war === "knopf" && okRef.current && !reduce()) {
      okRef.current.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], {
        duration: 240,
        easing: E.out,
      });
    }
  }, [stand, animiert]);

  if (!stand || stand.kind === "ferien") return null;

  return (
    <div className="wh" id="ovWh">
      <div className="wh-slot" id="whSlot">
        {stand.kind === "knopf" ? (
          <button
            className="whbtn"
            type="button"
            id="whBtn"
            onPointerDown={() => wiederholenVorwaermen()}
            onClick={(e) => kombi.openTisch({ mode: "wh", origin: e.currentTarget })}
          >
            <span>Wiederholen</span>
            <span className="n" ref={nRef}>
              {anfang.n}
            </span>
          </button>
        ) : (
          <p className="wh-ok" ref={okRef}>
            {stand.kind === "text" && stand.ok ? <Icon name="check" /> : null}
            {stand.kind === "leer" ? LEER_TEXT : stand.text}
          </p>
        )}
      </div>
      <p className="wh-sub" id="whSub" ref={subRef} hidden={stand.kind !== "knopf"}>
        {anfang.sub}
      </p>
    </div>
  );
}
