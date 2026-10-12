"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { statusTexts, wartet, type BlattAnzeige } from "@/components/kombi/ablauf/status-texte";
import { E, reduce, swapText } from "@/lib/kombi/motion";

export type { AnzeigeStatus, BlattAnzeige } from "@/components/kombi/ablauf/status-texte";

/**
 * Eine Zeile in der Liste unter dem Sucher (Prototyp `sheetItem`,
 * `statusTexts`, `paintSheet`, Z. 3608–3661): Miniatur, drei feste Zeilen
 * (Fach, Thema, Titel mit Stand der Abschrift) und darunter „Fach ändern“
 * und, am obersten Blatt, „Seite dazu“. Die Höhe ändert sich beim Einordnen
 * nicht (129 px): die Zeilen stehen von Anfang an da, nur leer.
 */

export function BlattZeile({
  b,
  alleFaecher,
  onOeffnen,
  onSeiteDazu,
  onWarm,
  onFach,
  onErneut,
}: {
  b: BlattAnzeige;
  alleFaecher: { id: string; name: string }[];
  onOeffnen: (b: BlattAnzeige) => void;
  onSeiteDazu: (b: BlattAnzeige) => void;
  onWarm: () => void;
  onFach: (b: BlattAnzeige, fachId: string) => void;
  onErneut: (b: BlattAnzeige) => void;
}) {
  const tRef = useRef<HTMLParagraphElement>(null);
  const hRef = useRef<HTMLParagraphElement>(null);
  const sRef = useRef<HTMLParagraphElement>(null);
  const actsRef = useRef<HTMLDivElement>(null);
  const rfRef = useRef<HTMLDivElement>(null);
  const gemalt = useRef(false);
  const [refile, setRefile] = useState(false);
  const warteVorher = useRef<boolean | null>(null);

  const [t, th, s] = statusTexts(b);
  const w = wartet(b.status);

  // paintSheet: Text tauschen (100 ms aus, 160 ms ein), beim ersten Malen ohne Bewegung
  useLayoutEffect(() => {
    const els: [HTMLParagraphElement | null, string][] = [
      [tRef.current, t],
      [hRef.current, th],
      [sRef.current, s],
    ];
    for (const [el, text] of els) {
      if (!el) continue;
      if (gemalt.current) swapText(el, text);
      else {
        el.textContent = text;
        (el as HTMLElement & { _text?: string })._text = text;
      }
    }
    gemalt.current = true;
  }, [t, th, s]);

  // der Platz der Knöpfe ist reserviert: nur die Sichtbarkeit wechselt
  useLayoutEffect(() => {
    const acts = actsRef.current;
    const war = warteVorher.current;
    warteVorher.current = w;
    if (acts && war && !w && !reduce()) {
      acts.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 160, easing: E.out, fill: "backwards" });
    }
  }, [w]);

  // Fach ändern: die Pillen kommen 20 ms versetzt
  useLayoutEffect(() => {
    if (!refile || reduce() || !rfRef.current) return;
    [...rfRef.current.children].forEach((c, i) =>
      c.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], {
        duration: 200,
        delay: Math.min(i, 4) * 20,
        easing: E.out,
        fill: "backwards",
      }),
    );
  }, [refile]);

  const faecher = alleFaecher.slice().sort((x, y) => Number(y.id === b.fach?.id) - Number(x.id === b.fach?.id));

  return (
    <div className="item sheet-item" data-bid={b.id ?? b.key} data-k={b.key}>
      <button
        className="thumb"
        type="button"
        aria-label="Blatt öffnen"
        onClick={() => onOeffnen(b)}
      >
        {b.seiten > 1 ? <span className="pg under" /> : null}
        <span className="pg" style={b.bild ? { backgroundImage: `url("${b.bild}")` } : undefined} />
      </button>
      <div className="sheet-st">
        <p className="st-t" ref={tRef} />
        <p className="st-th" ref={hRef} />
        <p className={`st-s${b.status === "fehlgeschlagen" ? " err" : ""}`} ref={sRef} />
        {b.status === "fehlgeschlagen" ? (
          <button className="retry" type="button" onClick={() => onErneut(b)}>
            Erneut versuchen
          </button>
        ) : null}
        <div className={`st-acts${w ? " wait" : ""}`} ref={actsRef} hidden={refile}>
          <button className="refile-btn" type="button" aria-expanded={refile} onClick={() => setRefile(true)}>
            Fach ändern
          </button>
          <button
            className="add-page"
            type="button"
            aria-label="Seite dazu fotografieren"
            onPointerDown={onWarm}
            onClick={() => onSeiteDazu(b)}
          >
            Seite dazu
          </button>
        </div>
        <div className="refile" role="group" aria-label="Fach ändern" hidden={!refile} ref={rfRef}>
          {refile
            ? faecher.map((f) => (
                <button
                  key={f.id}
                  className="fp"
                  type="button"
                  aria-pressed={b.fach?.id === f.id}
                  data-fach={f.id}
                  onClick={() => {
                    setRefile(false);
                    if (b.fach?.id !== f.id) onFach(b, f.id);
                  }}
                >
                  {f.name}
                </button>
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
