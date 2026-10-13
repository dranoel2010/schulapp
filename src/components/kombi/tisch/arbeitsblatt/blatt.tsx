"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { A4Seite, Mx, type A4Daten } from "@/components/kombi/a4/seite";
import { Icon } from "@/components/kombi/icon";
import type { BlattStand } from "@/lib/arbeitsblatt/ablauf";
import { E, reduce, swapText } from "@/lib/kombi/motion";

import type { BlattPhase } from "./use-arbeitsblatt";

/**
 * Das Arbeitsblatt auf dem Tisch (Prototyp Z. 4352–4618, Markup Z. 963–972):
 * Vorschau mit zwei A4-Seiten, „Wie lief es?“ mit einer Zeile je Aufgabe,
 * der Knopf am Daumen und die Lesegröße (Lupe). Gerendert wird nur der
 * Inhalt; den Tisch selbst (Fläche, Kopf, Schließen) stellt der Gastgeber —
 * bis Abschnitt E der Platzhalter in ./tisch-blatt, danach der Tisch.
 *
 * Eingebaut wird es so (alles innerhalb von `section.tisch.blatt`):
 *
 *   <div class="t-body"> … <BlattKoerper/> </div>
 *   <BlattLupe/>          ← Geschwister von .t-body, wie im Prototyp
 */

export const A4W = (210 * 96) / 25.4;
export const A4H = (297 * 96) / 25.4;

export function a4Daten(stand: BlattStand): A4Daten | null {
  if (!stand.inhalt) return null;
  return { fach: stand.fach, thema: stand.thema, tag: stand.tag, inhalt: stand.inhalt };
}

/** Der Knopftext tauscht wie Nr. 26: 160 ms ausblenden, dann der neue Text. */
function TauschText({ text, animiert }: { text: string; animiert: boolean }) {
  const [gezeigt, setGezeigt] = useState(text);
  const [tauscht, setTauscht] = useState(false);
  useEffect(() => {
    if (text === gezeigt) return;
    if (!animiert || reduce()) {
      const t = setTimeout(() => setGezeigt(text), 0);
      return () => clearTimeout(t);
    }
    const an = setTimeout(() => setTauscht(true), 0);
    const t = setTimeout(() => {
      setGezeigt(text);
      setTauscht(false);
    }, 160);
    return () => {
      clearTimeout(an);
      clearTimeout(t);
    };
  }, [text, gezeigt, animiert]);
  return <span className={`btn-label${tauscht ? " swap" : ""}`}>{gezeigt}</span>;
}

export type LupeSteuerung = {
  oeffnen: (i: 0 | 1, ev: { clientY?: number } | null) => void;
  schliessen: (sofort?: boolean) => void;
  offen: () => boolean;
};

type KoerperProps = {
  stand: BlattStand;
  phase: BlattPhase;
  wertung: Record<number, boolean>;
  /** Wird gedruckt: Vorschau → „Wie lief es?“ */
  onDrucken: () => void;
  onBewerten: (nr: number, richtig: boolean) => void;
  onFertig: () => void;
  /** „Dieses Thema lieber abfragen“ — nur wenn das Thema Fragen hat; auch solange gebaut wird oder wenn es scheiterte */
  onAbfragen: (() => void) | null;
  lupeRef: RefObject<LupeSteuerung | null>;
  /** Die Seiten der Vorschau, für den FLIP der Lupe */
  seitenRef: RefObject<(HTMLDivElement | null)[]>;
  /** Einblenden beim Öffnen des Tisches: Verzögerung in ms, null = nicht */
  einblenden: number | null;
  /**
   * Zeitpunkt (document.timeline), zu dem der Tisch Kopf und Striche
   * einblenden ließ: die Seiten zählen ihre Verzögerung von dort, nicht vom
   * späteren Messen der Breite — alles startet im selben Frame (Prototyp
   * staggerBlatt, Z. 4555).
   */
  einblendenAb?: number | null;
};

/** `.t-blatt` und `.t-bfoot` (Prototyp `renderBlatt`, `buildWertung`, `updateMain`). */
export function BlattKoerper(p: KoerperProps) {
  const { stand, phase, wertung } = p;
  const daten = a4Daten(stand);
  const boxRef = useRef<HTMLDivElement>(null);
  const vorRef = useRef<HTMLDivElement>(null);
  const werRef = useRef<HTMLDivElement>(null);
  const fussRef = useRef<HTMLDivElement>(null);
  const zustandRef = useRef<HTMLParagraphElement>(null);
  const [w, setW] = useState(0);
  const n = stand.inhalt?.aufgaben.length ?? 0;
  const offen = n - Object.keys(wertung).filter((k) => Number(k) <= n).length;
  const bewerten = phase === "bewerten";

  // Seite so groß, dass Seite 1 ganz im Bild steht und die Überschrift von Seite 2 darunter anschaut (fitBlatt)
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const messen = () => {
      if (!box.clientHeight) return;
      setW(Math.max(180, Math.min(346, box.clientWidth - 44, (box.clientHeight - 2 - 24 - 46) / (A4H / A4W))));
    };
    messen();
    const ro = new ResizeObserver(messen);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  const s = w / A4W;

  // Phasenwechsel: die Vorschau geht nach oben weg, „Wie lief es?“ kommt Block für Block (setBlattPhase)
  const letztePhase = useRef(phase);
  useLayoutEffect(() => {
    const vorher = letztePhase.current;
    letztePhase.current = phase;
    if (vorher === phase || phase !== "bewerten") return;
    const vor = vorRef.current;
    const wer = werRef.current;
    if (!vor || !wer) return;
    [vor, wer, ...vor.children, ...wer.children].forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    wer.scrollTop = 0;
    if (reduce()) {
      wer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease" });
      return;
    }
    vor.hidden = false;
    vor
      .animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-12px)" }], { duration: 160, easing: E.out, fill: "forwards" })
      .finished.then(
        () => {
          vor.hidden = true;
          vor.getAnimations().forEach((a) => a.cancel());
        },
        () => {},
      );
    [...wer.children].forEach((c, i) =>
      c.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], {
        duration: 260,
        delay: 120 + Math.min(i, 5) * 40,
        easing: E.out,
        fill: "backwards",
      }),
    );
    wer.querySelectorAll(".tb-row").forEach((r, i) =>
      r.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
        duration: 220,
        delay: 200 + i * 30,
        easing: E.out,
        fill: "backwards",
      }),
    );
  }, [phase]);

  // Einblenden wie der Kartenstapel (staggerBlatt)
  const eingeblendet = useRef(false);
  useLayoutEffect(() => {
    if (p.einblenden === null || eingeblendet.current || !w || reduce()) return;
    eingeblendet.current = true;
    const base = p.einblenden;
    const ab = p.einblendenAb ?? null;
    // Genau im Takt des Kopfes: dessen Startzeit, sobald sie feststeht
    const kopf =
      ab !== null ? document.getElementById("tHead")?.getAnimations().find((x) => x.playState === "running") : undefined;
    const anheften = (a: Animation | undefined) => {
      if (!a || ab === null) return;
      a.startTime = ab;
      kopf?.ready.then(
        () => {
          if (kopf.startTime !== null) a.startTime = kopf.startTime;
        },
        () => {},
      );
    };
    const els = bewerten ? [...(werRef.current?.children ?? [])] : [...(vorRef.current?.querySelectorAll(".tb-page") ?? [])];
    els.forEach((c, i) =>
      anheften(
        c.animate([{ opacity: 0, transform: "translateY(60px) scale(.94)" }, { opacity: 1, transform: "none" }], {
          duration: 340,
          delay: base + i * 40,
          easing: E.out,
          fill: "backwards",
        }),
      ),
    );
    anheften(
      fussRef.current?.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
        duration: 220,
        delay: base + 80,
        easing: E.out,
        fill: "backwards",
      }),
    );
  }, [p.einblenden, p.einblendenAb, w, bewerten]);

  // Die Zeile über dem Knopf: „Noch 2 von 6 offen“ / „Alle 6 bewertet“
  const zeileText = offen > 0 ? `Noch ${offen} von ${n} offen` : `Alle ${n} bewertet`;
  const zeileWar = useRef(false);
  useEffect(() => {
    const el = zustandRef.current;
    if (!el) return;
    if (!bewerten) {
      zeileWar.current = false;
      return;
    }
    if (!zeileWar.current) {
      zeileWar.current = true;
      el.textContent = "";
    }
    swapText(el, zeileText);
  }, [bewerten, zeileText]);

  const ersteOffeneZeigen = useCallback(() => {
    const zeilen = [...(werRef.current?.querySelectorAll<HTMLElement>(".tb-row") ?? [])];
    const r = zeilen.find((x) => !(Number(x.dataset.nr) in wertung));
    if (!r) return;
    r.scrollIntoView({ block: "nearest", behavior: reduce() ? "auto" : "smooth" });
    if (!reduce()) r.querySelector(".tb-seg")?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 420, easing: "ease-out" });
  }, [wertung]);

  const fertigGesperrt = bewerten && offen > 0;
  const ohneInhalt = !daten;
  const gescheitert = stand.status === "fehlgeschlagen" && ohneInhalt;
  const mainText = bewerten ? "Fertig" : "Arbeitsblatt drucken";

  return (
    <>
      <div className="t-blatt" id="tBlatt" ref={boxRef}>
        <div className="tb-view" id="tbVorschau" ref={vorRef} hidden={bewerten}>
          {daten && w ? (
            <div className="tb-pages" id="tbPages">
              {([1, 2] as const).map((seite) => (
                <figure className="tb-page" key={seite}>
                  <figcaption className="tb-cap">
                    <span>{seite === 1 ? "Seite 1 · Aufgaben" : "Seite 2 · Lösungen"}</span>
                    <span>A4</span>
                  </figcaption>
                  <div
                    className="tb-paper"
                    role="button"
                    tabIndex={0}
                    aria-label={seite === 1 ? "Seite 1, Aufgaben, in Lesegröße ansehen" : "Seite 2, Lösungen, in Lesegröße ansehen"}
                    style={{ width: `${w}px`, height: `${A4H * s}px` }}
                    ref={(el) => {
                      p.seitenRef.current[seite - 1] = el;
                    }}
                    onClick={(e) => p.lupeRef.current?.oeffnen((seite - 1) as 0 | 1, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        p.lupeRef.current?.oeffnen((seite - 1) as 0 | 1, null);
                      }
                    }}
                  >
                    <A4Seite daten={daten} seite={seite} style={{ transform: `scale(${s})` }} />
                  </div>
                </figure>
              ))}
            </div>
          ) : (
            // Die einzige neue Gestalt (Plan H): ein ruhiger Satz an der Stelle der Vorschau
            <p className="tb-wait">
              {gescheitert ? "Für dieses Thema ließ sich heute kein Blatt bauen." : ohneInhalt ? "Das Blatt wird gerade gebaut." : ""}
            </p>
          )}
          {p.onAbfragen ? (
            <button className="tb-art" type="button" id="tbArt" onClick={p.onAbfragen}>
              Dieses Thema lieber abfragen
            </button>
          ) : null}
        </div>
        <div className="tb-view tb-wert" id="tbWertung" ref={werRef} hidden={!bewerten}>
          {bewerten && stand.inhalt ? (
            <>
              <h2>Wie lief es?</h2>
              <p>Vergleiche mit dem Lösungsblatt. Dann tipp je Aufgabe an, wie es lief.</p>
              <ol className="tb-rows">
                {stand.inhalt.aufgaben.map((a, i) => {
                  const nr = i + 1;
                  const v = wertung[nr];
                  return (
                    <li className="tb-row" key={nr} data-nr={nr}>
                      <span className="nr">{nr}</span>
                      <span className="k">
                        <Mx text={a.kurz} />
                      </span>
                      <div className="tb-seg" role="group" aria-label={`Aufgabe ${nr}, ${a.kurz.replace(/[{}]/g, "")}`}>
                        <button type="button" data-v="true" aria-pressed={v === true} onClick={() => p.onBewerten(nr, true)}>
                          Richtig
                        </button>
                        <button type="button" data-v="false" aria-pressed={v === false} onClick={() => p.onBewerten(nr, false)}>
                          Falsch
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="tb-alt">
                {/* Der zweite Weg steht schon da; gebaut wird er erst nach einer Messung an echten, gelösten Blättern */}
                <div className="tb-bald" role="note" aria-label="Gelöstes Blatt fotografieren, kommt bald">
                  <Icon name="camera" />
                  <span>
                    <span className="l">Gelöstes Blatt fotografieren</span>
                    <span className="s">Dann korrigiert die App selbst.</span>
                  </span>
                  <i>bald</i>
                </div>
                <div className="tb-links">
                  <button type="button" onClick={() => p.lupeRef.current?.oeffnen(1, null)}>
                    Lösungen ansehen
                  </button>
                  <button type="button" onClick={p.onDrucken}>
                    Nochmal drucken
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="t-bfoot" id="tBFoot" ref={fussRef} hidden={gescheitert}>
        <p className="tb-state" id="tbState" hidden={!bewerten} aria-live="polite" ref={zustandRef} />
        <button
          className="tb-main"
          type="button"
          id="tbMain"
          aria-disabled={fertigGesperrt || ohneInhalt}
          aria-label={fertigGesperrt ? `Fertig, noch ${offen} Aufgaben offen` : mainText}
          onClick={() => {
            if (ohneInhalt) return;
            if (!bewerten) {
              p.onDrucken();
              return;
            }
            if (fertigGesperrt) {
              // Erst wenn jede Zeile bewertet ist, zählt das Thema (Kriterium 3): die erste offene Zeile zeigt sich
              ersteOffeneZeigen();
              return;
            }
            p.onFertig();
          }}
        >
          <TauschText text={mainText} animiert />
        </button>
      </div>
    </>
  );
}

/** Die Seiten liegen in #druck; das Druck-Stylesheet zeigt nur sie (Prototyp `drucken`). */
export function DruckSeiten({ daten }: { daten: A4Daten | null }) {
  const [ziel, setZiel] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setZiel(document.getElementById("druck")), 0);
    return () => clearTimeout(t);
  }, []);
  if (!ziel || !daten) return null;
  return createPortal(
    <>
      <A4Seite daten={daten} seite={1} />
      <A4Seite daten={daten} seite={2} />
    </>,
    ziel,
  );
}

const lupeTitel = (i: number) => (i === 0 ? "Seite 1 von 2 · Aufgaben" : "Seite 2 von 2 · Lösungen");

/**
 * Lesegröße (Prototyp `openLupe`, `closeLupe`): dieselben Seiten, umbrochen
 * auf die Bildschirmbreite; Seite 2 direkt unter Seite 1. Die Seite wächst
 * per FLIP aus der Vorschau (senkrecht dort, wo getippt wurde) und geht beim
 * Schließen dorthin zurück — zu der Seite, die gerade am meisten im Bild ist.
 */
export function BlattLupe({
  daten,
  steuerungRef,
  seitenRef,
  istOffen,
  beimOeffnen,
  beimSchliessen,
}: {
  daten: A4Daten | null;
  steuerungRef: RefObject<LupeSteuerung | null>;
  seitenRef: RefObject<(HTMLDivElement | null)[]>;
  /** Liegt der Tisch noch offen? Sonst ohne Rückflug schließen. */
  istOffen: () => boolean;
  /** Die Lupe ist aufgegangen bzw. zu — für den Eintrag in der History (Android-Zurück) */
  beimOeffnen?: () => void;
  beimSchliessen?: () => void;
}) {
  const lupeRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seitenBox = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const titelRef = useRef<HTMLSpanElement>(null);
  const schliessenRef = useRef<HTMLButtonElement>(null);
  const zustand = useRef<{ i: number } | null>(null);
  const [offen, setOffen] = useState<{ i: number; fy: number; flug: boolean } | null>(null);

  const alles = () =>
    [seitenBox.current, bgRef.current, topRef.current, lupeRef.current, ...(seitenBox.current?.children ?? [])].filter(
      (x): x is HTMLElement => x instanceof HTMLElement,
    );

  const schliessen = useCallback(
    (sofort = false) => {
      if (!zustand.current) return;
      let { i } = zustand.current;
      zustand.current = null;
      beimSchliessen?.();
      const box = seitenBox.current;
      const L = lupeRef.current;
      if (!box || !L) {
        setOffen(null);
        return;
      }
      const fertig = () => {
        if (zustand.current) return;
        alles().forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
        setOffen(null);
      };
      if (!sofort && istOffen() && box.children.length > 1) {
        const vh = innerHeight;
        let best = -1;
        [...box.children].forEach((c, k) => {
          const r = c.getBoundingClientRect();
          const sichtbar = Math.min(r.bottom, vh) - Math.max(r.top, 0);
          if (sichtbar > best) {
            best = sichtbar;
            i = k;
          }
        });
      }
      const pg = box.children[i] as HTMLElement | undefined;
      const src = seitenRef.current[i];
      if (sofort || !istOffen()) {
        fertig();
        return;
      }
      if (reduce() || !src || !src.offsetParent || !pg) {
        L.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).finished.then(fertig, fertig);
        return;
      }
      const r1 = src.getBoundingClientRect();
      const r2 = pg.getBoundingClientRect();
      const k = r1.width / r2.width;
      topRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
      bgRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease", fill: "forwards" });
      [...box.children]
        .filter((x) => x !== pg)
        .forEach((x) => x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" }));
      // Erst verschwindet der große Text (80 ms), dann fliegt nur die leere Seite auf ihre Vorschau zurück
      [...pg.children].forEach((c) => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, easing: "ease-out", fill: "forwards" }));
      pg.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: "none", opacity: 1, offset: 0.2 },
          { opacity: 1, offset: 0.75 },
          { transform: `translate(${r1.left - r2.left}px,${r1.top - r2.top}px) scale(${k})`, opacity: 0 },
        ],
        { duration: 340, easing: E.drawer, fill: "forwards" },
      ).finished.then(fertig, () => {});
    },
    [istOffen, seitenRef, beimSchliessen],
  );

  const oeffnen = useCallback((i: 0 | 1, ev: { clientY?: number } | null) => {
    const src = seitenRef.current[i];
    if (!src) return;
    const r1 = src.getBoundingClientRect();
    const fy = ev && ev.clientY ? Math.max(0, (ev.clientY - r1.top) / r1.height) : 0;
    const schonOffen = zustand.current !== null;
    zustand.current = { i };
    setOffen({ i, fy, flug: true });
    if (!schonOffen) beimOeffnen?.();
  }, [seitenRef, beimOeffnen]);

  useEffect(() => {
    steuerungRef.current = { oeffnen, schliessen, offen: () => zustand.current !== null };
  }, [steuerungRef, oeffnen, schliessen]);

  // Nach dem Rendern: an die Stelle scrollen und die Seite aus der Vorschau wachsen lassen
  useLayoutEffect(() => {
    if (!offen?.flug) return;
    const { i, fy } = offen;
    const sc = scrollRef.current;
    const box = seitenBox.current;
    const L = lupeRef.current;
    const src = seitenRef.current[i];
    if (!sc || !box || !L || !src) return;
    alles().forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    const pg = box.children[i] as HTMLElement;
    sc.scrollTop = Math.max(0, pg.offsetTop - 6 + fy * pg.offsetHeight - sc.clientHeight / 3);
    if (titelRef.current) titelRef.current.textContent = lupeTitel(i);
    schliessenRef.current?.focus({ preventScroll: true });
    if (reduce()) {
      L.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      return;
    }
    const r1 = src.getBoundingClientRect();
    const r2 = pg.getBoundingClientRect();
    const k = r1.width / r2.width;
    pg.animate(
      [{ transform: `translate(${r1.left - r2.left}px,${r1.top - r2.top}px) scale(${k})`, opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: "none", opacity: 1 }],
      { duration: 360, easing: E.drawer },
    );
    [...box.children]
      .filter((x) => x !== pg)
      .forEach((x) => x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 200, easing: "ease", fill: "backwards" }));
    bgRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease" });
    topRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 160, easing: E.out, fill: "backwards" });
  }, [offen, seitenRef]);

  return (
    <div className="tb-lupe" id="tbLupe" hidden={!offen} role="dialog" aria-label="Blatt in Lesegröße" ref={lupeRef}>
      <div className="tb-lbg" id="tbLbg" ref={bgRef} />
      <div className="t-top" ref={topRef}>
        <button className="tbtn" id="tbLClose" type="button" aria-label="Lesegröße schließen" ref={schliessenRef} onClick={() => schliessen()}>
          <Icon name="close" />
        </button>
        <span className="t-of" id="tbLOf" ref={titelRef} />
        <span style={{ width: 44 }} />
      </div>
      <div
        className="tb-lscroll"
        id="tbLScroll"
        ref={scrollRef}
        onClick={() => schliessen()}
        onScroll={() => {
          if (!zustand.current) return;
          const sc = scrollRef.current;
          const p2 = seitenBox.current?.children[1] as HTMLElement | undefined;
          if (!sc || !p2) return;
          const i = sc.scrollTop + sc.clientHeight / 3 >= p2.offsetTop ? 1 : 0;
          if (i !== zustand.current.i) {
            zustand.current.i = i;
            if (titelRef.current) swapText(titelRef.current, lupeTitel(i));
          }
        }}
      >
        <div className="tb-lpages" id="tbLPages" ref={seitenBox}>
          {offen && daten
            ? ([1, 2] as const).map((seite) => (
                <div className="tb-lpage" data-i={seite - 1} key={seite}>
                  <A4Seite daten={daten} seite={seite} flow />
                </div>
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
