"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";

import { ablaufAusMenuMerken, ablaufStore } from "@/components/kombi/ablauf/ablauf-store";
import { Icon } from "@/components/kombi/icon";
import { warmCamera } from "@/components/kombi/kamera/stream";
import { useKombi } from "@/components/kombi/kontext";
import { E, reduce, springOpts } from "@/lib/kombi/motion";

/**
 * Die Zeile (Prototyp Z. 891–909, 2262–2919): die dunkle Pille unten mit
 * Lupe, Feld, Sendeknopf und Kameraknopf, darüber das Menü, das per
 * `clip-path` aus der Pille wächst (13.3 Nr. 13, die einzige Ausnahme von
 * transform und opacity).
 *
 * Abschnitt A baut die **Hülle**: Menü auf und zu (Fokus, Scrim, Esc,
 * Ziehen nach unten, Android-Zurück), Tastatur (`vvFit`), Größe des Menüs,
 * Verlauf am Rand, und unter „Wohin?“ die neun Bereiche. Parser, Tokens,
 * Vorschläge, Suche und Eintragen bringt Abschnitt D (src/components/kombi/
 * zeile/*). Die Zeile lebt in der Shell und bewegt sich beim Tageszeitwechsel
 * nicht (7.1).
 */

export type ZeileHandle = {
  oeffnen: (kontext?: Record<string, unknown> | null) => void;
  schliessen: (optionen?: { blur?: boolean; ausHistory?: boolean }) => void;
  istOffen: () => boolean;
};

/** Die neun Bereiche unter „Wohin?“ (Prototyp AREAS, Z. 2359; Kriterium 54). */
const BEREICHE = [
  { key: "ueberblick", label: "Überblick" },
  { key: "woche", label: "Woche" },
  { key: "hausaufgaben", label: "Hausaufgaben" },
  { key: "klausuren", label: "Klausuren" },
  { key: "wiederholen", label: "Wiederholen" },
  { key: "noten", label: "Noten" },
  { key: "ablage", label: "Ablage" },
  { key: "faecher", label: "Fächer" },
  { key: "einstellungen", label: "Einstellungen" },
] as const;

const MENU_FULL = "inset(0px 0px 0px 0px round 24px 24px 0px 0px)";

export function Zeile({
  handleRef,
  versteckt = false,
  onOffen,
}: {
  handleRef?: Ref<ZeileHandle>;
  /** auf Tisch und Kamera (7.1) */
  versteckt?: boolean;
  /** Menü auf/zu — die Shell legt dafür einen Eintrag in die History (Android-Zurück) */
  onOffen?: (offen: boolean, ausHistory: boolean) => void;
}) {
  const kombi = useKombi();
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState("");
  const offenRef = useRef(false);
  const zeileRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLFormElement>(null);
  const feldRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);

  const sb = () => (zeileRef.current ? parseFloat(getComputedStyle(zeileRef.current).bottom) || 16 : 16);
  const menuClip = (H: number) => `inset(${Math.max(0, H - 52 - sb())}px 16px ${sb()}px 16px round 26px)`;

  /** maxHeight des Menüs: bis 44 px unter die Oberkante des sichtbaren Bereichs */
  const sizeMenu = useCallback(() => {
    const menu = menuRef.current;
    const dock = dockRef.current;
    if (!menu || !dock) return;
    const vv = window.visualViewport;
    const top = (vv ? vv.offsetTop : 0) + 44;
    const dockB = dock.getBoundingClientRect().bottom + sb();
    menu.style.maxHeight = `${Math.max(240, dockB - top)}px`;
  }, []);

  const mehrAnzeigen = useCallback(() => {
    const ms = scrollRef.current;
    if (ms) ms.classList.toggle("more", ms.scrollHeight - ms.scrollTop - ms.clientHeight > 2);
  }, []);

  const oeffnen = useCallback(() => {
    if (offenRef.current) return;
    offenRef.current = true;
    kombi.hideToast(true);
    setOffen(true);
    onOffen?.(true, false);
    const menu = menuRef.current;
    if (!menu) return;
    menu.classList.add("open");
    sizeMenu();
    const H = menu.offsetHeight;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    animRef.current?.cancel();
    animRef.current = reduce()
      ? menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 })
      : menu.animate([{ clipPath: menuClip(H) }, { clipPath: MENU_FULL }], { duration: 280, easing: E.drawer });
    // Treffer und Gruppen kommen nach (13.3 Nr. 14): ab 80 ms, je 25 ms, höchstens 4 Stufen
    if (!reduce() && leerRef.current) {
      const frisch = [...leerRef.current.querySelectorAll<HTMLElement>(".m-group, .opt")].slice(0, 12);
      const staffel = frisch.map((n, i) =>
        n.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
          duration: 200,
          delay: 80 + Math.min(i, 3) * 25,
          easing: E.out,
          fill: "backwards",
        }),
      );
      // Solange die Staffel läuft, zählt ihr translateY(6px) zum Überlauf; ihr
      // Ende löst weder ResizeObserver noch Scroll aus. Darum danach einmal
      // nachmessen, sonst bliebe der Verlauf (.more) ohne Überlauf stehen.
      Promise.all(staffel.map((a) => a.finished)).then(mehrAnzeigen, () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kombi, onOffen, sizeMenu, mehrAnzeigen]);

  const schliessen = useCallback(
    (optionen: { blur?: boolean; ausHistory?: boolean } = {}) => {
      if (!offenRef.current) return;
      offenRef.current = false;
      setOffen(false);
      onOffen?.(false, !!optionen.ausHistory);
      if (optionen.blur !== false) feldRef.current?.blur();
      const menu = menuRef.current;
      if (!menu) return;
      const H = menu.offsetHeight;
      const cur = getComputedStyle(menu).clipPath;
      animRef.current?.cancel();
      const a = reduce()
        ? menu.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 })
        : menu.animate(
            [
              { clipPath: cur && cur !== "none" ? cur : MENU_FULL, transform: menu.style.transform || "none" },
              { clipPath: menuClip(H), transform: "none" },
            ],
            { duration: 220, easing: E.drawer },
          );
      animRef.current = a;
      a.finished.then(
        () => {
          if (offenRef.current) return;
          menu.classList.remove("open");
          menu.style.transform = "";
          setText("");
        },
        () => {},
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onOffen],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      oeffnen: () => {
        feldRef.current?.focus({ preventScroll: true });
        oeffnen();
      },
      schliessen,
      istOffen: () => offenRef.current,
    }),
    [oeffnen, schliessen],
  );

  // Tastatur: die Zeile bleibt am Daumen (03 Z. 96, Prototyp vvFit)
  useEffect(() => {
    const vv = window.visualViewport;
    const zeile = zeileRef.current;
    if (!vv || !zeile) return;
    const vvFit = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const kb = inset >= 100 ? inset : 0;
      zeile.style.transform = kb ? `translateY(${-(kb + 10 - sb())}px)` : "";
      if (offenRef.current) sizeMenu();
      mehrAnzeigen();
    };
    vv.addEventListener("resize", vvFit);
    vv.addEventListener("scroll", vvFit);
    return () => {
      vv.removeEventListener("resize", vvFit);
      vv.removeEventListener("scroll", vvFit);
    };
     
  }, [sizeMenu, mehrAnzeigen]);

  // Verlauf am unteren Rand des Menüs, wenn noch etwas kommt
  useEffect(() => {
    const ms = scrollRef.current;
    if (!ms) return;
    ms.addEventListener("scroll", mehrAnzeigen, { passive: true });
    const ro = new ResizeObserver(mehrAnzeigen);
    ro.observe(ms);
    ms.querySelectorAll(".m-layer").forEach((l) => ro.observe(l));
    return () => {
      ms.removeEventListener("scroll", mehrAnzeigen);
      ro.disconnect();
    };
  }, [mehrAnzeigen]);

  // Menü nach unten ziehen (16 dragToClose() Z. 733 bis 757)
  const zug = useRef<{ y0: number; dy: number; hist: [number, number][] } | null>(null);
  const griffRunter = (e: React.PointerEvent<HTMLDivElement>) => {
    zug.current = { y0: e.clientY, dy: 0, hist: [[e.timeStamp, e.clientY]] };
    e.currentTarget.setPointerCapture(e.pointerId);
    animRef.current?.cancel();
  };
  const griffZiehen = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = zug.current;
    const menu = menuRef.current;
    if (!st || !menu) return;
    const dy = e.clientY - st.y0;
    const H = menu.offsetHeight;
    st.dy = dy < 0 ? -((-dy * H * 0.55) / (H + 0.55 * -dy)) : dy;
    menu.style.transform = `translateY(${st.dy}px)`;
    st.hist.push([e.timeStamp, e.clientY]);
    if (st.hist.length > 5) st.hist.shift();
  };
  const griffLos = () => {
    const s = zug.current;
    const menu = menuRef.current;
    zug.current = null;
    if (!s || !menu) return;
    const [ta, ya] = s.hist[0];
    const [tb, yb] = s.hist[s.hist.length - 1];
    const v = (yb - ya) / Math.max(1, tb - ta);
    if (s.dy > menu.offsetHeight * 0.28 || v > 0.5) {
      schliessen();
      return;
    }
    menu.style.transform = "";
    if (!reduce()) menu.animate([{ transform: `translateY(${s.dy}px)` }, { transform: "none" }], springOpts());
  };

  // Vorschläge des Ablaufs (Prototyp suggestions(), Z. 2595–2608); den Rest bringt Abschnitt D
  const ablauf = useSyncExternalStore(ablaufStore.subscribe, ablaufStore.get, ablaufStore.getServer);
  const vorschlaege: { key: "ablauf" | "cam"; l1: string; l2?: string }[] = [];
  if (ablauf.nachDerSchule && !ablauf.sichtbar) {
    vorschlaege.push({ key: "ablauf", l1: "Nach der Schule", l2: "Blätter und Hausaufgaben" });
  }
  if (ablauf.sichtbar && ablauf.schritt === "blaetter") vorschlaege.push({ key: "cam", l1: "Blatt aufnehmen" });

  function vorschlagWaehlen(key: "ablauf" | "cam") {
    schliessen();
    if (key === "ablauf") {
      ablaufAusMenuMerken();
      kombi.setView("ablauf", { dir: -1 });
    } else kombi.openCam({ ziel: { kind: "liste" } });
  }

  /** „Wohin?“: die neun Bereiche (Prototyp AREAS, Z. 2359) */
  function bereichWaehlen(key: string) {
    if (key === "ueberblick") {
      schliessen();
      kombi.setView("ueberblick");
    } else if (key === "wiederholen") {
      schliessen();
      kombi.openTisch({ mode: "wh" });
    } else {
      kombi.openPage(key);
    }
  }

  return (
    <>
      <div
        className={`scrim${offen ? " on" : ""}`}
        id="scrim"
        onClick={() => schliessen()}
      />
      <div
        className={`zeile${offen ? " menu-on" : ""}${versteckt ? " hide" : ""}`}
        id="zeile"
        ref={zeileRef}
      >
        <div className="menu" id="menu" ref={menuRef} aria-label="Eintragen oder suchen" onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest(".opt, .tok, .fp, button")) e.preventDefault();
        }}>
          <div
            className="m-grab"
            id="mGrab"
            aria-hidden="true"
            onPointerDown={griffRunter}
            onPointerMove={griffZiehen}
            onPointerUp={griffLos}
            onPointerCancel={griffLos}
          />
          <div className="m-scroll" id="mScroll" ref={scrollRef}>
            <div className="m-layer" id="mLeer" role="listbox" aria-label="Wohin?" ref={leerRef}>
              {vorschlaege.length ? (
                <div className="m-group" role="group" aria-label="Vorschläge">
                  <p className="m-gl">Vorschläge</p>
                  <div>
                    {vorschlaege.map((o, i) => (
                      <div
                        key={o.key}
                        className={`opt${i === 0 ? " first" : ""}`}
                        role="option"
                        aria-selected="false"
                        id={`o-v-${o.key}`}
                        onPointerDown={o.key === "cam" ? () => void warmCamera() : undefined}
                        onClick={() => vorschlagWaehlen(o.key)}
                      >
                        <div>
                          <p className="o1">{o.l1}</p>
                          {o.l2 ? <p className="o2">{o.l2}</p> : null}
                        </div>
                        <span className="o-end" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="m-group" role="group" aria-label="Wohin?">
                <p className="m-gl">Wohin?</p>
                <div className="m-grid">
                  {BEREICHE.map((b) => (
                    <div
                      key={b.key}
                      className="opt cell"
                      role="option"
                      aria-selected="false"
                      id={`o-w-${b.key}`}
                      onPointerDown={b.key !== "ueberblick" && b.key !== "wiederholen" ? () => kombi.vorladen(b.key) : undefined}
                      onClick={() => bereichWaehlen(b.key)}
                    >
                      <div>
                        <p className="o1">{b.label}</p>
                      </div>
                      <span className="o-end" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="m-layer m-hits off" id="mHits" role="listbox" aria-label="Treffer" />
          </div>
          <div className="m-fach" id="mFach" />
          <div className="m-tokens" id="mTokens" aria-live="polite" />
        </div>
        <form
          className="dock"
          id="dock"
          ref={dockRef}
          autoComplete="off"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("#camBtn, #send, input")) return;
            e.preventDefault();
            feldRef.current?.focus({ preventScroll: true });
          }}
          onSubmit={(e) => {
            // Eintragen und Suchen bringt Abschnitt D.
            e.preventDefault();
          }}
        >
          <span className="lupe" aria-hidden="true">
            <Icon name="search" id="lupeIcon" />
          </span>
          <input
            ref={feldRef}
            id="field"
            type="text"
            placeholder="Eintragen oder suchen"
            role="combobox"
            aria-controls="mLeer"
            aria-expanded={offen}
            aria-autocomplete="list"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-label="Eintragen oder suchen"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!offenRef.current) oeffnen();
            }}
            onFocus={() => {
              if (!offenRef.current) oeffnen();
            }}
          />
          <button className={`send${text.trim() ? " on" : ""}`} id="send" type="submit" aria-label="Zeigen">
            <Icon name="arrow_forward" id="sendIcon" />
          </button>
          <span className="dsep" aria-hidden="true" />
          <button
            className="camb"
            id="camBtn"
            type="button"
            aria-label="Blatt aufnehmen"
            onPointerDown={() => void warmCamera()}
            onClick={() => {
              schliessen();
              kombi.openCam({ ziel: "zeile" });
            }}
          >
            <Icon name="camera" />
          </button>
        </form>
      </div>
    </>
  );
}
