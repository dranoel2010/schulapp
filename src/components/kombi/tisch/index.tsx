"use client";

import { useEffect, useRef } from "react";

import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { BlattSheet } from "@/components/kombi/tisch/blatt-sheet";
import { erzeugeTisch, type TischOptionen } from "@/components/kombi/tisch/steuerung";

/**
 * Der Tisch (`#tisch`, Prototyp Z. 943–974): die blaue Fläche, auf der
 * Wiederholen läuft (Abschnitt E). Das Gerüst rendert React einmal, alles
 * Bewegte — Karten, Striche, Themenende — führt `erzeugeTisch()` wie im
 * Prototyp direkt am DOM. React rendert in `#tStack` und `#tEnd` nie Kinder.
 *
 * Der Lernblock (Uhr, Material, „Block beenden“, Abschnitt F) und das
 * Arbeitsblatt (Vorschau, Lupe, Druck, Abschnitt H) hängen sich an dieselbe
 * Fläche; ihre Elemente stehen hier schon im Gerüst (`#tClock`, `#tMat`,
 * `#tConfirm`, `#tBlatt`, `#tBFoot`), bleiben beim Wiederholen aber
 * verborgen bzw. leer.
 */
export function TischEbene() {
  const kombi = useKombi();
  const ref = useRef<HTMLElement>(null);
  const api = useRef(kombi);

  useEffect(() => {
    api.current = kombi;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tisch = erzeugeTisch(el, {
      toast: (...a) => api.current.toast(...a),
      hideToast: (k) => api.current.hideToast(k),
      closeMenu: () => api.current.closeMenu(),
      closeSheet: () => api.current.closeSheet(),
      sheetOffen: () => !!document.getElementById("sheet")?.classList.contains("open"),
      blattAnsehen: (blatt) => api.current.openSheet(<BlattSheet blatt={blatt} />, true),
      neuLaden: () => api.current.neuLaden(),
    });
    const ab = api.current.registriere("tisch", (o) => {
      const opt = (o ?? {}) as TischOptionen;
      // Der Lernblock (mode „block“) kommt mit Abschnitt F.
      if (opt.mode && opt.mode !== "wh") return;
      void tisch.openTisch(opt);
    });
    return () => {
      ab();
      tisch.zerstoeren();
    };
  }, []);

  return (
    <section className="tisch" id="tisch" aria-label="Tisch" role="dialog" aria-hidden="true" ref={ref}>
      <div className="t-surface" id="tSurface">
        <div className="t-tint" id="tTint" />
      </div>
      <div className="t-ghost" id="tGhost" aria-hidden="true" />
      <div className="t-body" id="tBody">
        <div className="t-top">
          <button className="tbtn" id="tClose" type="button" aria-label="Schließen">
            <Icon name="close" />
          </button>
          <span className="t-of" id="tOf" />
          <button className="t-clock" id="tClock" type="button" aria-label="Uhr anhalten" hidden>
            <span className="ic" id="tClockIcon" hidden />
            <span id="tClockText" />
          </button>
        </div>
        <div className="t-head" id="tHead">
          <p className="t-fach" id="tFach" />
          <p className="t-thema" id="tThema" />
        </div>
        <div className="t-ticks" id="tTicks" />
        <div className="t-meta" id="tMeta">
          <p className="t-count" id="tCount" />
          <p className="t-hint" id="tHint" aria-live="polite">
            Erst antworten.
          </p>
        </div>
        <div className="t-stack" id="tStack" />
        <div className="t-foot" id="tFoot">
          <div className="t-ask" id="tAsk">
            <button className="rb" type="button" id="tDunno">
              Weiß ich nicht
            </button>
            <button className="rb known" type="button" id="tReveal">
              Aufdecken
            </button>
          </div>
          <div className="t-rate" id="tRate">
            <button className="rb" type="button" data-r="daneben">
              Daneben
            </button>
            <button className="rb known" type="button" data-r="sass">
              Saß
            </button>
          </div>
        </div>
        <div className="t-blatt" id="tBlatt">
          <div className="tb-view" id="tbVorschau">
            <p style={{ fontSize: 15, lineHeight: 1.4, fontWeight: 450, textAlign: "center", paddingTop: 24 }}>
              Für dieses Thema ließ sich heute kein Blatt bauen.
            </p>
            <button className="tb-art" type="button" id="tbArt">
              Dieses Thema lieber abfragen
            </button>
          </div>
        </div>
        <div className="t-bfoot" id="tBFoot" />
        <button className="t-mat" id="tMat" type="button" hidden>
          <span id="tMatText" />
        </button>
      </div>
      <div className="t-end" id="tEnd" />
      <div className="t-confirm" id="tConfirm" role="alertdialog" aria-labelledby="tcH">
        <h2 id="tcH" />
        <p id="tcP" />
        <div className="row">
          <button className="btn nein" type="button" id="tcNo" />
          <button className="btn ja" type="button" id="tcYes">
            Ja
          </button>
        </div>
      </div>
    </section>
  );
}
