"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type Ref } from "react";

import { ablaufAusMenuMerken, ablaufStore } from "@/components/kombi/ablauf/ablauf-store";
import { Icon } from "@/components/kombi/icon";
import { warmCamera } from "@/components/kombi/kamera/stream";
import { useKombi } from "@/components/kombi/kontext";
import { E, reduce, springOpts } from "@/lib/kombi/motion";
import { TAG, cap, kurz as kurzDatum, wd } from "@/lib/kombi/text";

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

/**
 * Kontext „Eintragen“ (Prototyp `openZeile`, Z. 2829; V2 5.3): Schritt 2 des
 * Ablaufs öffnet die Zeile mit Fach und nächster Stunde als Tokens, „Anderes
 * Fach“ ohne Fach-Token mit Fach-Pillen. Abschnitt C baut davon nur, was
 * „+ Aufgabe“ braucht (Kriterium 22): Tokens, Pillen, Rückfrage „Bis wann?“
 * und Absenden. Parser, Suche und Dubletten bringt Abschnitt D.
 */
export type EintragFach = { id: string; name: string; kurz: string; naechste: string | null };
export type EintragSenden = {
  intent: "eintragen" | "aendern";
  id?: string;
  fachId: string;
  text: string;
  due: string;
  /** das Feld der Zeile beim Absenden: dort startet der Geistflug (13.3 Nr. 23) */
  from: DOMRect | null;
};
export type EintragKontext = {
  intent: "eintragen" | "aendern";
  fach: string | null;
  due: string | null;
  dueAuto?: boolean;
  dueRemoved?: boolean;
  fachPills?: boolean;
  text?: string;
  /** beim Ändern: die Aufgabe */
  id?: string;
  /** App-Tag, für die Rückfrage „Bis wann?“ */
  heute: string;
  faecher: EintragFach[];
  senden: (e: EintragSenden) => void;
};

function istEintragKontext(k: unknown): k is EintragKontext {
  if (!k || typeof k !== "object") return false;
  const o = k as Record<string, unknown>;
  return (o.intent === "eintragen" || o.intent === "aendern") && Array.isArray(o.faecher) && typeof o.senden === "function";
}

/** Prototyp `fmtTask`, Z. 2302 */
function fmtTask(roh: string): string {
  let s = roh.replace(/\s+/g, " ").trim();
  s = s.replace(/^[\s,.:;–-]+|[\s,:;–-]+$/g, "");
  s = s
    .replace(/(?<![\p{L}])s\.?\s*(\d)/giu, "S. $1")
    .replace(/(?<![\p{L}])nr\.?\s*(\d)/giu, "Nr. $1")
    .replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
  return cap(s);
}

function plusTage(tag: string, n: number): string {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Die nächsten Wochentage Mo–Fr nach `tag` (Rückfrage „Bis wann?“, Prototyp Z. 2647). */
function naechsteWochentage(tag: string, n: number): string[] {
  const out: string[] = [];
  let t = tag;
  while (out.length < n) {
    t = plusTage(t, 1);
    const w = wd(t);
    if (w >= 1 && w <= 5) out.push(t);
  }
  return out;
}

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
  const [ctx, setCtx] = useState<EintragKontext | null>(null);
  const [needFach, setNeedFach] = useState(false);
  const [rueck, setRueck] = useState(false);
  const fachRef = useRef<HTMLDivElement>(null);
  const tokRef = useRef<HTMLDivElement>(null);
  const tokVorher = useRef<Set<string>>(new Set());
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
          setCtx(null);
          setNeedFach(false);
          setRueck(false);
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
      oeffnen: (kontext) => {
        const k = istEintragKontext(kontext) ? kontext : null;
        setCtx(k);
        setNeedFach(false);
        setRueck(false);
        setText(k?.text ?? "");
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

  // ── Kontext „Eintragen“ (Prototyp parse/renderTokens/renderFachPills/doEintragen) ──
  const eFach = ctx?.fach ? (ctx.faecher.find((f) => f.id === ctx.fach) ?? null) : null;
  let eDue: string | null = null;
  let dueAuto = false;
  if (ctx?.due) {
    eDue = ctx.due;
    dueAuto = !!ctx.dueAuto;
  } else if (eFach && !ctx?.dueRemoved && eFach.naechste) {
    eDue = eFach.naechste;
    dueAuto = true;
  }
  const taskText = ctx ? fmtTask(text) : "";
  const tokens: { key: string; cls: string; icon?: "add" | "edit"; label: string }[] = ctx
    ? [
        { key: `int:${ctx.intent}`, cls: "int", icon: ctx.intent === "aendern" ? "edit" : "add", label: ctx.intent === "aendern" ? "Ändern" : "Eintragen" },
        eFach ? { key: `fach:${eFach.id}`, cls: "", label: eFach.name } : { key: "fach:none", cls: "want", label: "welches Fach?" },
        ...(eFach
          ? [
              eDue
                ? { key: `due:${eDue}${dueAuto}`, cls: "", label: `${kurzDatum(eDue)}${dueAuto ? ", nächste Stunde" : ""}` }
                : { key: "due:none", cls: "want", label: "bis wann?" },
            ]
          : []),
      ]
    : [];
  const tokKeys = tokens.map((t) => t.key).join("|");

  // Tippen erkennt ein Token: nur neue kommen herein, unveränderte bleiben stehen (13.3 Nr. 18)
  useLayoutEffect(() => {
    const box = tokRef.current;
    if (!box) return;
    const jetzt = new Set<string>();
    box.querySelectorAll<HTMLElement>(".tok").forEach((t) => {
      const k = t.dataset.k ?? "";
      jetzt.add(k);
      if (!tokVorher.current.has(k) && !reduce()) {
        t.animate([{ opacity: 0, transform: "translateY(4px) scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: E.out });
      }
    });
    tokVorher.current = jetzt;
  }, [tokKeys]);

  // Treffer stehen unten am Feld: der Scrollbereich sitzt beim Eintragen am Ende (Prototyp renderMenu, Z. 2756)
  const hitsKey = ctx ? `${tokKeys}|${taskText}|${needFach}|${rueck}` : "";
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !hitsKey) return;
    sc.scrollTop = sc.scrollHeight;
    mehrAnzeigen();
  }, [hitsKey, mehrAnzeigen]);

  const absenden = (due: string) => {
    if (!ctx || !eFach) return;
    const from = feldRef.current?.getBoundingClientRect() ?? null;
    const c = ctx;
    // das Feld ist sofort leer, der Satz fliegt (Prototyp doEintragen: field.value = '' vor closeMenu)
    setText("");
    schliessen();
    c.senden({ intent: c.intent, id: c.id, fachId: eFach.id, text: taskText, due, from });
  };

  /** Prototyp `doEintragen`, Z. 2922 */
  const eintragen = () => {
    if (!ctx) return;
    if (!eFach) {
      setNeedFach(true);
      feldRef.current?.focus({ preventScroll: true });
      const b = fachRef.current;
      if (b?.firstChild && !reduce()) {
        b.animate([{ transform: "translateX(0)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 200 });
      }
      return;
    }
    if (!taskText) {
      feldRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!eDue) {
      setRueck(true);
      return;
    }
    absenden(eDue);
  };

  const rueckWahl = (() => {
    if (!ctx || !eFach || !rueck) return null;
    const [d1, d2, d3] = naechsteWochentage(ctx.heute, 3);
    return [
      { l: d1 === plusTage(ctx.heute, 1) ? "Morgen" : TAG[wd(d1)], d: d1 },
      { l: TAG[wd(d2)], d: d2 },
      { l: TAG[wd(d3)], d: d3 },
    ];
  })();
  const ersteZeile =
    ctx && !rueckWahl && (taskText || !eFach || needFach)
      ? {
          l1: !eFach ? (needFach || !taskText ? "Welches Fach?" : taskText) : taskText,
          l2: !eFach && taskText && !needFach ? "Fach fehlt" : null,
        }
      : null;

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
            <div className={`m-layer${ctx ? " off" : ""}`} id="mLeer" role="listbox" aria-label="Wohin?" ref={leerRef}>
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
            <div className={`m-layer m-hits${ctx ? "" : " off"}`} id="mHits" role="listbox" aria-label="Treffer">
              {ersteZeile ? (
                <div className="opt first" role="option" aria-selected="true" id="o-first" onClick={eintragen}>
                  <div>
                    <p className="o1">{ersteZeile.l1}</p>
                    {ersteZeile.l2 ? <p className="o2">{ersteZeile.l2}</p> : null}
                  </div>
                  <span className="o-end" />
                </div>
              ) : null}
              {rueckWahl && eFach ? (
                <div className="m-group">
                  <p className="m-gl" style={{ fontSize: 17, color: "var(--ink)" }}>
                    Bis wann ist {eFach.kurz} fällig?
                  </p>
                  <div>
                    {rueckWahl.map((c, i) => (
                      <div
                        key={c.d}
                        className={`opt${i === 0 ? " first" : ""}`}
                        role="option"
                        aria-selected={i === 0}
                        id={`o-rq-${i}`}
                        onClick={() => absenden(c.d)}
                      >
                        <div>
                          <p className="o1">{c.l}</p>
                          <p className="o2">{kurzDatum(c.d)}</p>
                        </div>
                        <span className="o-end" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="m-fach" id="mFach" ref={fachRef}>
            {ctx && !eFach && !rueck
              ? ctx.faecher.map((f) => (
                  <button
                    key={f.id}
                    className="fp"
                    type="button"
                    aria-pressed="false"
                    onClick={() => {
                      setCtx({ ...ctx, fach: f.id, due: null, dueAuto: false, dueRemoved: false });
                      setNeedFach(false);
                      feldRef.current?.focus({ preventScroll: true });
                    }}
                  >
                    {f.name}
                  </button>
                ))
              : null}
          </div>
          <div className="m-tokens" id="mTokens" aria-live="polite" ref={tokRef}>
            {tokens.map((t) => (
              <button key={t.key} data-k={t.key} className={`tok${t.cls ? ` ${t.cls}` : ""}`} type="button" tabIndex={-1}>
                {t.icon ? <Icon name={t.icon} /> : null}
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <form
          className={`dock${ctx ? " ctx" : ""}`}
          id="dock"
          ref={dockRef}
          autoComplete="off"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("#camBtn, #send, input")) return;
            e.preventDefault();
            feldRef.current?.focus({ preventScroll: true });
          }}
          onSubmit={(e) => {
            e.preventDefault();
            // Eintragen aus Schritt 2 (Kriterium 22); Suchen bringt Abschnitt D.
            if (!ctx) return;
            if (rueckWahl) absenden(rueckWahl[0].d);
            else eintragen();
          }}
        >
          <span className="lupe" aria-hidden="true">
            <Icon name={ctx ? (ctx.intent === "aendern" ? "edit" : "add") : "search"} id="lupeIcon" />
          </span>
          <input
            ref={feldRef}
            id="field"
            type="text"
            placeholder={ctx ? "Was ist auf?" : "Eintragen oder suchen"}
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
              setNeedFach(false);
              setRueck(false);
              if (!offenRef.current) oeffnen();
            }}
            onKeyDown={(e) => {
              // Rücktaste im leeren Feld nimmt erst den Termin, dann das Fach (Prototyp Z. 2800)
              if (e.key !== "Backspace" || text || !ctx) return;
              e.preventDefault();
              if (eDue && !ctx.dueRemoved) setCtx({ ...ctx, due: null, dueAuto: false, dueRemoved: true });
              else if (ctx.fach) setCtx({ ...ctx, fach: null, fachPills: true });
              setRueck(false);
            }}
            onFocus={() => {
              if (!offenRef.current) oeffnen();
            }}
          />
          <button
            className={`send${text.trim() ? " on" : ""}`}
            id="send"
            type="submit"
            aria-label={ctx ? (ctx.intent === "aendern" ? "Ändern" : "Eintragen") : "Zeigen"}
          >
            <Icon name={ctx ? "check" : "arrow_forward"} id="sendIcon" />
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
