"use client";

/*
 * Der Zustand der Zeile lebt wie im Prototyp (`Z`, Z. 2264) in einem
 * veränderlichen Objekt: jede Änderung ist von `neu()` gefolgt, das neu
 * rendert, und das Rendern liest daraus. Ohne React Compiler ist das sicher;
 * die Regel unten meldet genau dieses Lesen.
 */
/* eslint-disable react-hooks/refs */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type Ref } from "react";

import {
  abhakenZuruecknehmenAction,
  aufgabeAbhakenAction,
  aufgabeAendernAction,
  aufgabeEintragenAction,
  eintragenZuruecknehmenAction,
} from "@/app/(app)/zeile-actions";
import { ablaufAusMenuMerken, ablaufStore } from "@/components/kombi/ablauf/ablauf-store";
import { Icon, type IconName } from "@/components/kombi/icon";
import { warmCamera } from "@/components/kombi/kamera/stream";
import { useKombi } from "@/components/kombi/kontext";
import { Fachpillen } from "@/components/kombi/zeile/fachpillen";
import { AntwortInhaltView, Opt } from "@/components/kombi/zeile/menu";
import { parse, WH_WORDS, type Absicht, type Geparst, type ZeilenKontext } from "@/components/kombi/zeile/parser";
import {
  AREAS,
  dublette,
  rueckfrageTage,
  STOP,
  suche,
  suggestions,
  textWords,
  ZIEL_INHALT,
  type Antwort,
  type BlattTreffer,
  type Option,
  type Ziel,
} from "@/components/kombi/zeile/suche";
import { Tokens, tokensFuer } from "@/components/kombi/zeile/tokens";
import { zuletztListe, zuletztTitel } from "@/components/kombi/zeile/zuletzt";
import { bare, norm, type FachEintrag } from "@/lib/kombi/fach-alias";
import { E, flash, reduce, springOpts, vvStable } from "@/lib/kombi/motion";
import { appTagVon } from "@/lib/kombi/app-tag";
import { dm, kurz } from "@/lib/kombi/text";
import { nextLesson, type VorratAufgabe, type ZeilenVorrat } from "@/lib/kombi/vorrat";

/**
 * Die Zeile (Prototyp Z. 891–909, 2262–2989): die dunkle Pille unten mit
 * Lupe, Feld, Sendeknopf und Kameraknopf, darüber das Menü, das per
 * `clip-path` aus der Pille wächst (13.3 Nr. 13).
 *
 * Abschnitt A baute die Hülle (Menü auf und zu, Tastatur, Ziehen, Verlauf),
 * Abschnitt D das Innere: Parser mit Präfixen `+` und `?`, Tokens und
 * Fachpillen, Vorschläge, „Zuletzt geöffnet“ und „Wohin?“, Antworten beim
 * Tippen, Volltextsuche über die Abschriften, Eintragen mit Rückfrage und
 * Dublette, Ändern, Abhaken im offenen Menü (der Rang friert bis zum nächsten
 * Tippen ein) und den Geistflug ins Ziel.
 *
 * Die Logik steckt rein in `zeile/parser.ts` und `zeile/suche.ts`; hier
 * stehen nur Zustand, Darstellung und Bewegung.
 */

export type ZeileHandle = {
  oeffnen: (kontext?: Record<string, unknown> | null) => void;
  schliessen: (optionen?: { blur?: boolean; ausHistory?: boolean; keepText?: boolean }) => void;
  istOffen: () => boolean;
};

/** Die Uhr des Geräts; die Zeile rechnet mit dem Versatz zur Serveruhr weiter. */
const uhr = () => Date.now();
/** Monotone Zeit für die Reihenfolge von Quittung und Laden des Vorrats. */
const messzeit = () => performance.now();

const MENU_FULL = "inset(0px 0px 0px 0px round 24px 24px 0px 0px)";

type Zustand = {
  ctx: ZeilenKontext | null;
  override: Absicht | null;
  answer: { q: string; ans: Extract<Antwort, { inhalt: unknown }> } | null;
  rueck: Geparst | null;
  used: Set<string>;
  server: { q: string; list: BlattTreffer[] };
  settled: boolean;
  needFach: boolean;
  keptAt: number;
  selKey: string | null;
  sel: number;
  maxH: number;
  shrinkT?: ReturnType<typeof setTimeout>;
  settleT?: ReturnType<typeof setTimeout>;
  serverT?: ReturnType<typeof setTimeout>;
  lastIntent: Absicht | null;
  /** im offenen Menü abgehakt: zählt für Rang und Treffer erst beim nächsten Tippen */
  heldDone: Map<string, number | null>;
  /** einmal gezeigte Knoten fahren nicht noch einmal ein (Prototyp nodeCache/_new) */
  gesehen: Set<string>;
  animNext: boolean;
  /** zuletzt gerenderte Zerlegung (für „Eintragen“ aus der ersten Zeile) */
  p?: Geparst | null;
  /**
   * Das nächste Malen ist ein `renderMenu` im Sinne des Prototyps (Eingabe,
   * Öffnen, Ebenenwechsel, Antwort, Rückfrage, neue Serverliste): nur dann
   * setzt es `scrollTop` und scrollt die Auswahl ins Bild. Neu malen durch
   * Abhaken, Toast oder neue Daten lässt die Liste stehen.
   */
  scrollNeu: boolean;
  /** wartet auf einen Vorrat vom heutigen App-Tag (Eintragen nach 04:00) */
  nachVorrat: (() => void) | null;
};

type UeberEintrag = { wert: number | null; bis: number; tok: number };
/**
 * Optimistischer Stand: `bis` ist der Zeitpunkt (performance.now) der
 * Quittung durch die Action, `Infinity`, solange sie läuft. Ein Vorrat, der
 * danach geholt wurde, enthält den Stand schon; dann fällt der Eintrag weg.
 */
type Ueberlagerung = {
  done: Map<string, UeberEintrag>;
  neu: { a: VorratAufgabe; bis: number; tok: number }[];
  weg: Map<string, UeberEintrag>;
};

function ueberlagerungNach(l: Ueberlagerung, start: number): Ueberlagerung {
  const done = new Map([...l.done].filter(([, e]) => e.bis > start));
  const weg = new Map([...l.weg].filter(([, e]) => e.bis > start));
  const neu = l.neu.filter((n) => n.bis > start);
  if (done.size === l.done.size && weg.size === l.weg.size && neu.length === l.neu.length) return l;
  return { done, neu, weg };
}

/** Gilt der Vorrat noch für den App-Tag von jetzt (Wechsel 04:00)? */
function vorratVomTag(vv: { v: ZeilenVorrat; versatz: number }): boolean {
  return appTagVon(new Date(Date.now() + vv.versatz)) === vv.v.heute;
}

/** Wie `homeworkInputSchema`: der Titel einer Aufgabe hat höchstens 120 Zeichen. */
const TITEL_MAX = 120;

const ZIEL_ARTEN = new Set(["woche", "hausaufgaben", "klausuren", "klausur", "noten", "notenfach", "ablage", "blatt", "faecher", "fach", "einstellungen"]);

/**
 * Was ein Eintrag aus einem fremden Kontext zurückgibt (Abschnitt C): Der
 * Ablauf öffnet die Zeile mit `openZeile({intent, fach, due, …, senden})`,
 * die Zeile zerlegt und fragt wie sonst und übergibt am Ende an `senden`.
 */
export type EintragSenden = {
  intent: "eintragen" | "aendern";
  id?: string;
  fachId: string;
  text: string;
  due: string;
  /** das Feld der Zeile beim Absenden: dort startet der Geistflug (13.3 Nr. 23) */
  from: DOMRect | null;
};

const ohneAbo = () => () => {};

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
  const router = useRouter();
  const pathname = usePathname();
  const [offen, setOffen] = useState(false);
  /** Tokens und Pillen bleiben bis zum Ende der Schließ-Bewegung stehen */
  const [sichtbar, setSichtbar] = useState(false);
  const [text, setText] = useState("");
  const [, setTick] = useState(0);
  const [vorrat, setVorrat] = useState<{ v: ZeilenVorrat; versatz: number } | null>(null);
  /** optimistischer Stand der Aufgaben, bis ein Vorrat da ist, der ihn schon enthält */
  const [lokal, setLokal] = useState<Ueberlagerung>(() => ({ done: new Map(), neu: [], weg: new Map() }));

  const offenRef = useRef(false);
  const textRef = useRef("");
  const zeileRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLFormElement>(null);
  const feldRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leerRef = useRef<HTMLDivElement>(null);
  const hitsRef = useRef<HTMLDivElement>(null);
  const tokRef = useRef<HTMLDivElement>(null);
  const fachRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  const vorratLaeuft = useRef<Promise<boolean> | null>(null);
  /** Beginn des Ladens, dessen Vorrat gerade gilt — ein älteres überschreibt ihn nicht */
  const vorratStand = useRef(-1);
  const vorratRef = useRef<{ v: ZeilenVorrat; versatz: number } | null>(null);
  const ueberNr = useRef(0);
  /** Vertrag mit dem Ablauf (C): wohin ein Eintrag aus dessen Kontext geht */
  const sendenRef = useRef<((e: EintragSenden) => void) | null>(null);
  const ablaufZ = useSyncExternalStore(ablaufStore.subscribe, ablaufStore.get, ablaufStore.getServer);
  /** false beim Server-Rendern und beim Hydrieren, danach true */
  const hydriert = useSyncExternalStore(ohneAbo, () => true, () => false);
  const Z = useRef<Zustand>({
    ctx: null,
    override: null,
    answer: null,
    rueck: null,
    used: new Set(),
    server: { q: "", list: [] },
    settled: true,
    needFach: false,
    keptAt: 0,
    selKey: null,
    sel: 0,
    maxH: 0,
    lastIntent: null,
    heldDone: new Map(),
    gesehen: new Set(),
    animNext: false,
    scrollNeu: false,
    nachVorrat: null,
  });
  const neu = useCallback(() => setTick((t) => t + 1), []);

  // ── Vorrat (Plan 3.2) ──────────────────────────────────────────────────────
  // Stale-while-revalidate: der alte Vorrat steht sofort, der neue ersetzt ihn,
  // sobald er da ist. Geholt wird bei jedem Öffnen des Menüs, nach jedem
  // `neuLaden()` der Shell (neue TagDaten), wenn die App wieder sichtbar wird
  // und spätestens, wenn der App-Tag (04:00) wechselt. Die optimistische
  // Überlagerung bleibt, bis ein Vorrat da ist, der erst nach der Quittung
  // der Action geholt wurde.
  const vorratLaden = useCallback((): Promise<boolean> => {
    const start = messzeit();
    const p: Promise<boolean> = fetch("/api/zeile/vorrat", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean; vorrat?: ZeilenVorrat }>) : null))
      .then((j) => {
        if (!j?.ok || !j.vorrat) return false;
        if (start < vorratStand.current) return true;
        vorratStand.current = start;
        // die erste Liste nach einem Menü ohne Daten darf Auswahl und Scroll setzen
        if (!vorratRef.current) Z.current.scrollNeu = true;
        const neuV = { v: j.vorrat, versatz: j.vorrat.jetzt - Date.now() };
        vorratRef.current = neuV;
        setVorrat(neuV);
        setLokal((l) => ueberlagerungNach(l, start));
        return true;
      })
      .catch(() => false)
      .finally(() => {
        if (vorratLaeuft.current === p) vorratLaeuft.current = null;
      });
    vorratLaeuft.current = p;
    return p;
  }, []);
  /** Neu holen, außer es läuft schon ein Laden (Öffnen, Sichtbarwerden, Tageswechsel). */
  const vorratAuffrischen = useCallback(() => vorratLaeuft.current ?? vorratLaden(), [vorratLaden]);
  useEffect(() => {
    // im Leerlauf vorwärmen, damit das erste Öffnen schon Daten hat
    const t = setTimeout(() => {
      if (!vorratRef.current) void vorratAuffrischen();
    }, 1200);
    return () => clearTimeout(t);
  }, [vorratAuffrischen]);
  // nach jedem neuLaden() der Shell (Abhaken auf der Startseite, Rückgängig, …)
  useEffect(() => {
    if (kombi.tagDaten && vorratRef.current) void vorratLaden();
  }, [kombi.tagDaten, vorratLaden]);
  // wieder sichtbar (offen gelassene PWA) und der Tageswechsel um 04:00
  useEffect(() => {
    const sichtbarGeworden = () => {
      if (document.visibilityState === "visible" && vorratRef.current) void vorratAuffrischen();
    };
    const uhrwerk = setInterval(() => {
      const vv = vorratRef.current;
      if (vv && document.visibilityState === "visible" && !vorratVomTag(vv)) void vorratAuffrischen();
    }, 60_000);
    document.addEventListener("visibilitychange", sichtbarGeworden);
    return () => {
      document.removeEventListener("visibilitychange", sichtbarGeworden);
      clearInterval(uhrwerk);
    };
  }, [vorratAuffrischen]);

  // Überlagerung setzen (Action läuft), quittieren (Action fertig) und entfernen (gescheitert)
  const ueberSetzen = (art: "done" | "weg", id: string, wert: number | null = null): number => {
    const tok = ++ueberNr.current;
    setLokal((l) => ({ ...l, [art]: new Map(l[art]).set(id, { wert, bis: Infinity, tok }) }));
    return tok;
  };
  const ueberQuittieren = (art: "done" | "weg", id: string, tok: number) => {
    const bis = messzeit();
    setLokal((l) => {
      const e = l[art].get(id);
      if (!e || e.tok !== tok) return l;
      return { ...l, [art]: new Map(l[art]).set(id, { ...e, bis }) };
    });
  };
  const ueberEntfernen = (art: "done" | "weg", id: string, tok: number) =>
    setLokal((l) => {
      const e = l[art].get(id);
      if (!e || e.tok !== tok) return l;
      const m = new Map(l[art]);
      m.delete(id);
      return { ...l, [art]: m };
    });

  // Vorrat mit dem optimistischen Stand
  const v: ZeilenVorrat | null = vorrat
    ? {
        ...vorrat.v,
        aufgaben: vorrat.v.aufgaben
          .filter((a) => !lokal.weg.has(a.id))
          .map((a) => (lokal.done.has(a.id) ? { ...a, done: lokal.done.get(a.id)!.wert } : a))
          .concat(
            lokal.neu
              // steht die echte Aufgabe schon im Vorrat, fällt die vorläufige weg (keine Dublette)
              .filter((n) => !vorrat.v.aufgaben.some((x) => x.fachId === n.a.fachId && x.text === n.a.text && x.due === n.a.due))
              .map((n) => n.a),
          ),
      }
    : null;
  const jetzt = () => uhr() + (vorrat?.versatz ?? 0);
  const fachVon = (id: string): FachEintrag | undefined => v?.faecher.find((f) => f.id === id);
  const fachKurz = (id: string) => fachVon(id)?.kurz ?? "";

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
    const mx = Math.max(240, dockB - top);
    menu.style.maxHeight = `${mx}px`;
    if (Z.current.maxH > mx) {
      Z.current.maxH = mx;
      menu.style.minHeight = `${mx}px`;
    }
  }, []);

  const mehrAnzeigen = useCallback(() => {
    const ms = scrollRef.current;
    if (ms) ms.classList.toggle("more", ms.scrollHeight - ms.scrollTop - ms.clientHeight > 2);
  }, []);

  // ── Auf und zu ─────────────────────────────────────────────────────────────

  const oeffnen = useCallback(() => {
    if (offenRef.current) return;
    offenRef.current = true;
    const z = Z.current;
    z.used = new Set();
    z.lastIntent = null;
    z.maxH = 0;
    z.settled = true;
    z.animNext = true;
    z.scrollNeu = true;
    kombi.hideToast(true);
    // jedes Öffnen holt den Vorrat neu; bis er da ist, steht der alte
    void vorratAuffrischen();
    setOffen(true);
    setSichtbar(true);
    onOffen?.(true, false);
  }, [kombi, onOffen, vorratAuffrischen]);

  const schliessen = useCallback(
    (optionen: { blur?: boolean; ausHistory?: boolean; keepText?: boolean } = {}) => {
      if (!offenRef.current) return;
      offenRef.current = false;
      const z = Z.current;
      clearTimeout(z.shrinkT);
      z.heldDone.clear();
      z.nachVorrat = null;
      setOffen(false);
      onOffen?.(false, !!optionen.ausHistory);
      if (optionen.blur !== false) feldRef.current?.blur();
      const menu = menuRef.current;
      const fertig = () => {
        if (offenRef.current) return;
        if (menu) {
          menu.classList.remove("open");
          menu.style.transform = "";
          menu.style.minHeight = "";
        }
        z.answer = null;
        z.rueck = null;
        if (optionen.keepText && (textRef.current.trim() || (z.ctx && z.ctx.intent === "aendern"))) z.keptAt = Date.now();
        else {
          z.ctx = null;
          sendenRef.current = null;
          z.override = null;
          textRef.current = "";
          setText("");
        }
        setSichtbar(false);
      };
      if (!menu) return fertig();
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
      a.finished.then(fertig, () => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onOffen],
  );

  /** Nach dem Schließen (und dem Zurück im Verlauf) etwas tun, das selbst navigiert. */
  const nachSchliessen = useCallback(
    (fn: () => void) => {
      if (!offenRef.current) return fn();
      let erledigt = false;
      const los = () => {
        if (erledigt) return;
        erledigt = true;
        window.removeEventListener("popstate", los);
        // die Shell hat den Menü-Eintrag dann schon verworfen
        setTimeout(fn, 0);
      };
      window.addEventListener("popstate", los);
      setTimeout(los, 350);
      schliessen();
    },
    [schliessen],
  );

  // ── Zustand ändern ─────────────────────────────────────────────────────────

  const onInput = useCallback(() => {
    const z = Z.current;
    z.heldDone.clear();
    z.settled = false;
    z.needFach = false;
    z.scrollNeu = true;
    clearTimeout(z.settleT);
    z.settleT = setTimeout(() => {
      z.settled = true;
      // wie im Prototyp (Z. 2780): neu malen nur, wenn die Absicht gehalten war
      if (offenRef.current && z.p && z.p.held) {
        z.scrollNeu = true;
        neu();
      }
    }, 250);
    const val = textRef.current;
    if (!val.trim() && !z.ctx) z.override = null;
    if (val.trim()) z.answer = null;
    if (z.rueck && val.trim() !== z.rueck.raw.trim()) z.rueck = null;
    if (!offenRef.current) oeffnen();
    else neu();
  }, [neu, oeffnen]);

  const setFeld = (s: string) => {
    textRef.current = s;
    setText(s);
  };

  const openZeile = useCallback(
    (ctx: ZeilenKontext | null) => {
      const z = Z.current;
      z.ctx = ctx;
      z.override = null;
      z.answer = null;
      z.rueck = null;
      z.keptAt = 0;
      setFeld(ctx?.text ?? "");
      feldRef.current?.focus({ preventScroll: true });
      if (!offenRef.current) oeffnen();
      else {
        z.animNext = true;
        z.scrollNeu = true;
        neu();
      }
    },
    [neu, oeffnen],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      oeffnen: (kontext) => {
        if (kontext && typeof kontext === "object" && "intent" in kontext) {
          // Vertrag mit dem Ablauf (Abschnitt C): `id` ist die Aufgabe beim
          // Ändern, `senden` übernimmt das Speichern (der Ablauf führt seine
          // Liste, den Geistflug und das Rückgängig selbst).
          const k = kontext as unknown as ZeilenKontext & { id?: string; senden?: unknown };
          const { id, senden, ...rest } = k as ZeilenKontext & { id?: string; senden?: unknown; faecher?: unknown; heute?: unknown; from?: unknown };
          delete (rest as Record<string, unknown>).faecher;
          delete (rest as Record<string, unknown>).heute;
          delete (rest as Record<string, unknown>).from;
          const ctx: ZeilenKontext = { ...rest, editId: rest.editId ?? id };
          openZeile(ctx);
          sendenRef.current = typeof senden === "function" ? (senden as (e: EintragSenden) => void) : null;
          return;
        }
        feldRef.current?.focus({ preventScroll: true });
        oeffnen();
      },
      schliessen,
      istOffen: () => offenRef.current,
    }),
    [oeffnen, schliessen, openZeile],
  );

  // ── Ziele ausführen ────────────────────────────────────────────────────────

  const aufStart = () => pathname === "/" && !document.querySelector("#pages > .page");

  const gehe = (ziel: Ziel | null | undefined) => {
    if (!ziel) return;
    switch (ziel.typ) {
      case "seite": {
        const params = ziel.params ?? {};
        let zuletzt: { label: string; sub?: string | null } | undefined;
        if (ziel.art === "klausur" && v) {
          const k = v.klausuren.find((x) => x.id === params.id);
          if (k) zuletzt = { label: zuletztTitel.klausur(fachVon(k.fachId)?.name ?? ""), sub: dm(k.datum) };
        } else if (ziel.art === "notenfach") {
          const f = fachVon(params.id);
          if (f) zuletzt = { label: zuletztTitel.notenfach(f.name) };
        }
        kombi.openPage(ziel.art, params, zuletzt ? { zuletzt } : undefined);
        return;
      }
      case "route":
        kombi.openPage(ziel.url === "/material/eingang" ? "eingang" : "bausteine");
        return;
      case "ansicht":
        if (aufStart()) nachSchliessen(() => kombi.setView(ziel.ansicht));
        else {
          schliessen({ ausHistory: true });
          kombi.setView(ziel.ansicht);
        }
        return;
      case "ablauf":
        ablaufAusMenuMerken();
        if (aufStart()) nachSchliessen(() => kombi.setView("ablauf", { dir: -1 }));
        else {
          schliessen({ ausHistory: true });
          kombi.setView("ablauf", { dir: -1 });
        }
        return;
      case "tisch":
        nachSchliessen(() => kombi.openTisch({ mode: ziel.mode, fach: ziel.fach ?? null, blockId: ziel.blockId, thema: ziel.thema }));
        return;
      case "kamera":
        nachSchliessen(() => kombi.openCam({ ziel: ziel.ziel }));
        return;
      case "ha-kontext":
        Z.current.ctx = { intent: "eintragen", fach: null, fachPills: true };
        sendenRef.current = null;
        setFeld("");
        feldRef.current?.focus();
        onInput();
        return;
    }
  };

  // ── Abhaken im offenen Menü ────────────────────────────────────────────────

  const setDone = (a: VorratAufgabe) => {
    const z = Z.current;
    const vorher = a.done;
    const done = !a.done;
    if (!z.heldDone.has(a.id)) z.heldDone.set(a.id, vorher);
    const neuDone = done ? jetzt() : null;
    const tok = ueberSetzen("done", a.id, neuDone);
    const k = fachKurz(a.fachId);
    let protokoll: Promise<string | null> = Promise.resolve(null);
    // Rückgängig: der alte Stand gilt, bis das Zurücknehmen quittiert ist
    const zurueck = () => ueberSetzen("done", a.id, vorher);
    protokoll = aufgabeAbhakenAction(a.id, done).then(
      (r) => {
        if (!r.ok) throw new Error(r.fehler);
        ueberQuittieren("done", a.id, tok);
        void kombi.neuLaden();
        return r.protokollId;
      },
      () => {
        throw new Error("Netz");
      },
    );
    protokoll.catch(() => {
      kombi.fehlerToast("Nicht gespeichert", () => setDone({ ...a, done: vorher }), "Erneut");
      // auf dem Server hat sich nichts geändert: die Überlagerung fällt weg
      setTimeout(() => ueberEntfernen("done", a.id, tok), 320);
    });
    if (done) {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* ohne Vibration */
      }
      kombi.toast(
        `${k} abgehakt`,
        () => {
          const tz = zurueck();
          void protokoll.then(
            (pid) => {
              if (!pid) return ueberQuittieren("done", a.id, tz);
              const fertig = () => {
                ueberQuittieren("done", a.id, tz);
                void kombi.neuLaden();
              };
              void abhakenZuruecknehmenAction(a.id, !!vorher, pid).then(fertig, fertig);
            },
            () => ueberEntfernen("done", a.id, tz),
          );
        },
        `${k}, ${a.text}`,
      );
    } else kombi.hideToast();
  };

  // ── Eintragen und Ändern ───────────────────────────────────────────────────

  /** Geistflug: der Satz löst sich aus dem Feld und landet an seiner Zeile (7.2 Nr. 23). */
  const geistflug = async (id: string, satz: string, fr: DOMRect) => {
    await vvStable();
    await kombi.neuLaden();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (document.querySelector("#pages > .page")) return;
    const target = document.querySelector<HTMLElement>(`#home .task[data-id="${CSS.escape(id)}"], #flow .task[data-id="${CSS.escape(id)}"]`);
    if (!target || !target.offsetParent) return;
    const flashEl = target.querySelector<HTMLElement>(".t-front") ?? target;
    if (reduce()) {
      flash(flashEl);
      return;
    }
    const tEl = target.querySelector<HTMLElement>(".t-txt") ?? target.querySelector("p") ?? target;
    const tr = tEl.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.style.cssText = `position:fixed;z-index:80;left:${tr.left}px;top:${tr.top}px;font-size:17px;line-height:1.4;color:var(--ink);pointer-events:none;white-space:nowrap`;
    ghost.textContent = satz;
    document.body.append(ghost);
    target.style.visibility = "hidden";
    const gr = ghost.getBoundingClientRect();
    const dx = fr.left + 4 - gr.left;
    const dy = fr.top + (fr.height - gr.height) / 2 - gr.top;
    const an = ghost.animate([{ transform: `translate(${dx}px,${dy}px)`, opacity: 0.4 }, { transform: "none", opacity: 1 }], {
      duration: 360,
      easing: E.drawer,
    });
    an.finished.then(
      () => {
        ghost.remove();
        target.style.visibility = "";
        flash(flashEl);
      },
      () => {
        ghost.remove();
        target.style.visibility = "";
      },
    );
  };

  const doAendern = (p: Geparst, editId = Z.current.ctx?.editId) => {
    const vorher = v?.aufgaben.find((a) => a.id === editId);
    if (!vorher || !p.eFach || !p.due) {
      schliessen();
      return;
    }
    const neuWert = { subjectId: p.eFach.id, title: p.taskText, dueDate: p.due };
    const alt = { subjectId: vorher.fachId, title: vorher.text, dueDate: vorher.due };
    const senden = sendenRef.current;
    if (senden) {
      const from = feldRef.current?.getBoundingClientRect() ?? null;
      schliessen();
      senden({ intent: "aendern", id: vorher.id, fachId: p.eFach.id, text: p.taskText, due: p.due, from });
      return;
    }
    schliessen();
    const ausfuehren = (e: typeof neuWert, nachher: () => void) =>
      aufgabeAendernAction(vorher.id, e).then(
        (r) => {
          if (!r.ok) throw new Error(r.fehler);
          // neuLaden() bringt neue TagDaten, und die holen den Vorrat nach
          void kombi.neuLaden();
          nachher();
        },
        () => {
          throw new Error("Netz");
        },
      );
    // Rückgängig schreibt den alten Stand zurück; scheitert es, bietet der Toast „Erneut“
    const zuruecknehmen = (): void =>
      void ausfuehren(alt, () => {}).catch(() => kombi.fehlerToast("Nicht gespeichert", zuruecknehmen, "Erneut"));
    ausfuehren(neuWert, () => kombi.toast("Geändert", zuruecknehmen, p.taskText)).catch(() =>
      kombi.fehlerToast("Nicht gespeichert", () => doAendern(p, editId), "Erneut"),
    );
  };

  const doEintragen = (p: Geparst) => {
    const z = Z.current;
    if (!p.eFach) {
      z.needFach = true;
      z.scrollNeu = true;
      neu();
      feldRef.current?.focus({ preventScroll: true });
      const b = fachRef.current;
      if (b?.firstChild && !reduce())
        b.animate([{ transform: "translateX(0)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 200 });
      return;
    }
    if (!p.taskText || p.taskText.length > TITEL_MAX) {
      // zu lang: die erste Zeile sagt es („Höchstens 120 Zeichen“), nichts wird eingetragen
      feldRef.current?.focus({ preventScroll: true });
      return;
    }
    // Fälligkeiten („morgen“, „bis Do“, nächste Stunde) rechnen vom App-Tag des
    // Vorrats: nach 04:00 erst den heutigen holen und dann neu zerlegen
    if (!vorrat || !vorratVomTag(vorrat)) {
      const auto = !z.rueck && p === z.p;
      z.nachVorrat = () => {
        const q = auto ? Z.current.p : p;
        if (q) doEintragenRef.current(q);
      };
      void vorratLaden().then((ok) => {
        if (ok) return;
        Z.current.nachVorrat = null;
        kombi.fehlerToast("Keine Verbindung", () => doEintragenRef.current(p), "Erneut");
      });
      return;
    }
    if (!p.due) {
      z.rueck = p;
      z.scrollNeu = true;
      neu();
      return;
    }
    if (p.intent === "aendern" || (z.ctx && z.ctx.intent === "aendern" && z.ctx.editId)) {
      doAendern(p);
      return;
    }
    const fr = feldRef.current?.getBoundingClientRect() ?? new DOMRect();
    const senden = sendenRef.current;
    if (senden) {
      setFeld("");
      schliessen();
      senden({ intent: "eintragen", fachId: p.eFach.id, text: p.taskText, due: p.due, from: fr });
      return;
    }
    const tempId = `neu-${uhr()}`;
    const a: VorratAufgabe = { id: tempId, fachId: p.eFach.id, text: p.taskText, due: p.due, done: null, details: false };
    const tok = ++ueberNr.current;
    setLokal((l) => ({ ...l, neu: [...l.neu, { a, bis: Infinity, tok }] }));
    setFeld("");
    schliessen();
    const weg = () => setLokal((l) => ({ ...l, neu: l.neu.filter((x) => x.a.id !== tempId) }));
    const ergebnis = aufgabeEintragenAction({ subjectId: a.fachId, title: a.text, dueDate: a.due }).then((r) => {
      if (!r.ok) throw new Error(r.fehler);
      return r;
    });
    ergebnis.then(
      (r) => {
        const bis = messzeit();
        setLokal((l) => ({ ...l, neu: l.neu.map((x) => (x.a.id === tempId ? { ...x, bis } : x)) }));
        void geistflug(r.id, a.text, fr);
        void vorratLaden();
      },
      () => {
        kombi.fehlerToast("Nicht gespeichert", () => doEintragen(p), "Erneut");
        setTimeout(weg, 320);
      },
    );
    kombi.toast(
      "Eingetragen",
      () => {
        weg();
        void ergebnis.then((r) => {
          // die echte Aufgabe bleibt verborgen, bis das Zurücknehmen quittiert ist
          const tw = ueberSetzen("weg", r.id);
          const fertig = () => {
            ueberQuittieren("weg", r.id, tw);
            void kombi.neuLaden();
          };
          void eintragenZuruecknehmenAction(r.id, r.protokollId).then(fertig, fertig);
        });
      },
      a.text,
    );
  };
  const doEintragenRef = useRef(doEintragen);
  doEintragenRef.current = doEintragen;

  // ── Antwort zeigen (Prototyp showAnswer, Z. 2817) ───────────────────────────

  const kuerzelFlug = useRef<DOMRect | null>(null);
  const letzteHits = useRef<React.ReactNode>(null);
  const letzteLeer = useRef<{ label: string; items: Option[]; grid?: boolean }[] | null>(null);
  const showAnswer = (q: string, ans: Antwort) => {
    if (ans.kind === "nav") return;
    kuerzelFlug.current = feldRef.current?.getBoundingClientRect() ?? null;
    const z = Z.current;
    z.answer = { q, ans };
    setFeld("");
    z.ctx = null;
    sendenRef.current = null;
    z.override = null;
    z.scrollNeu = true;
    neu();
  };

  const waehlen = (o: Option, ausLeer = false) => {
    const z = Z.current;
    if (ausLeer && (o.key.startsWith("w:") || o.key === "v:morgen")) z.used.add(o.key);
    if (o.intern) {
      const i = o.intern;
      if (i.typ === "antwort") showAnswer(i.q, i.antwort);
      else if (i.typ === "override") {
        z.override = i.intent;
        onInput();
      } else if (i.typ === "eintragen") {
        if (z.p) doEintragen(z.p);
      } else if (i.typ === "rueck") {
        const r = z.rueck;
        z.rueck = null;
        if (r) doEintragen({ ...r, due: i.due, dueAuto: false });
      } else if (i.typ === "details") {
        const url = i.url;
        nachSchliessen(() => router.push(url));
      } else if (i.typ === "wiederOeffnen") {
        setDone(v?.aufgaben.find((y) => y.id === i.aufgabe.id) ?? i.aufgabe);
      } else if (i.typ === "undo") {
        kombi.undoJetzt()?.run();
        z.scrollNeu = true;
        neu();
      }
      return;
    }
    gehe(o.ziel);
  };

  // ── Darstellung ────────────────────────────────────────────────────────────

  const z = Z.current;
  const wert = text;
  const vt = wert.trim();
  const showLeer = !vt && !z.ctx && !z.answer && !z.rueck;
  const umg = v
    ? {
        faecher: v.faecher,
        heute: v.heute,
        naechsteStunde: (fachId: string, ab: string) => nextLesson(v, fachId, ab),
        ctx: z.ctx,
        override: z.override,
      }
    : null;
  let p: Geparst | null = (vt || z.ctx) && !z.answer && umg ? parse(wert, umg) : null;
  if (
    p &&
    umg &&
    z.lastIntent &&
    p.intent !== z.lastIntent &&
    !z.settled &&
    !/\s$/.test(wert) &&
    !z.override &&
    !z.ctx &&
    p.why !== "praefix"
  )
    p = parse(wert, umg, z.lastIntent);
  z.p = p;

  const doneFuer = (a: VorratAufgabe) => (z.heldDone.has(a.id) ? (z.heldDone.get(a.id) ?? null) : a.done);
  const undo = kombi.undoJetzt();
  const tagAnsicht = (kombi.tagDaten as unknown as { ansicht?: string } | null)?.ansicht;
  /** die Ansicht, die die Startseite gerade zeigt (Morgens, Überblick, Morgen früh) */
  const homeAnsicht = () =>
    typeof document === "undefined" ? undefined : (document.querySelector<HTMLElement>("#home .mode.on")?.dataset.v ?? undefined);

  const leerGruppen: { label: string; items: Option[]; grid?: boolean }[] = [];
  let hitsInhalt: React.ReactNode = null;
  let ersteOpt: Option | null = null;

  // Wie im Prototyp bleibt der Inhalt der verborgenen Ebene stehen (sie blendet aus, statt leer zu werden)
  if (v)
    leerGruppen.push({
      label: "Vorschläge",
      // Was gerade zu sehen ist, weiß der Ablauf (C): die Ansicht aus den Tagesdaten
      // sagt nur, womit der Tag begann; „übersprungen“ meldet er, bevor der Vorrat nachzieht
      items: suggestions({ v: ablaufZ.nachDerSchule && v.ablauf !== "übersprungen" ? { ...v, ablauf: "übersprungen" } : v, jetzt: jetzt(),
          ansicht: ablaufZ.sichtbar ? "ablauf" : (homeAnsicht() ?? (tagAnsicht === "ablauf" ? "ueberblick" : (tagAnsicht ?? v.ansicht))),
          schritt: ablaufZ.sichtbar ? ablaufZ.schritt : v.schritt, undo: undo ? { desc: undo.desc } : null, used: z.used }),
    });
  leerGruppen.push({
    label: "Zuletzt geöffnet",
    // erst nach dem Hydrieren: der Server kennt sessionStorage nicht (React #418)
    items: (hydriert ? zuletztListe() : [])
      .slice(0, 3)
      .map((r) => ({ key: "r:" + r.key, l1: r.label, l2: r.sub, ziel: { typ: "seite" as const, art: r.art, params: r.params } })),
  });
  leerGruppen.push({
    label: "Wohin?",
    grid: true,
    items: AREAS.map((a) => ({ key: "w:" + a.key, l1: a.label, ziel: a.ziel(v), cell: true })),
  });

  // Während des Schließens bleibt der Inhalt stehen, wie er offen war (der
  // Prototyp zeichnet erst beim nächsten Öffnen neu): sonst holte „Zuletzt
  // geöffnet“ die eben geöffnete Seite noch in die Schließ-Bewegung, das Menü
  // wüchse und die Maske, mit der alten Höhe berechnet, endete neben dem Dock.
  const leerAnzeige = !offen && sichtbar && letzteLeer.current ? letzteLeer.current : leerGruppen;
  if (offen) letzteLeer.current = leerGruppen;

  const optProps = {
    fachKurz,
    onAbhaken: setDone,
    onStarten: () => gehe({ typ: "tisch", mode: "block", blockId: v?.lernblock?.key }),
    onVorladen: (o: Option) => {
      if (o.ziel?.typ === "seite" && ZIEL_ARTEN.has(o.ziel.art)) kombi.vorladen(o.ziel.art, o.ziel.params ?? {});
    },
  };

  if (!showLeer && v) {
    if (z.answer) {
      const a = z.answer;
      ersteOpt = { key: "ans:open", l1: a.ans.openLabel || "Öffnen", ziel: a.ans.open };
      hitsInhalt = (
        <>
          <Opt o={ersteOpt} first onWaehlen={(o) => waehlen(o)} {...optProps} />
          <div className="m-group" data-k={"g:antwort"}>
            <p className="kuerzel" id="kuerzel">
              {a.q}
            </p>
            <p className="m-gl" style={{ paddingTop: 2 }}>
              {a.ans.l1}
            </p>
            <AntwortInhaltView
              inhalt={a.ans.inhalt}
              heute={v.heute}
              fachKurz={fachKurz}
              aufgabe={(x) => v.aufgaben.find((y) => y.id === x.id) ?? x}
              onAbhaken={setDone}
            />
          </div>
        </>
      );
    } else if (z.rueck) {
      const r = z.rueck;
      const nl = r.eFach ? nextLesson(v, r.eFach.id, v.heute) : null;
      const choices = rueckfrageTage(v, r.eFach?.id ?? null, nl);
      hitsInhalt = (
        <div className="m-group" data-k="g:rueck">
          <p className="m-gl" style={{ fontSize: 17, color: "var(--ink)" }}>{`Bis wann ist ${r.eFach?.kurz ?? ""} fällig?`}</p>
          <div>
            {choices.map(([l, d], i) => (
              <Opt
                key={"rq:" + i}
                o={{ key: "rq:" + i, l1: l, l2: kurz(d), intern: { typ: "rueck", due: d } }}
                first={i === 0}
                onWaehlen={(o) => waehlen(o)}
                {...optProps}
              />
            ))}
          </div>
        </div>
      );
    } else if (p && (p.intent === "eintragen" || p.intent === "aendern")) {
      const dup = p.intent === "eintragen" && p.eFach && p.due ? dublette(v, p.eFach.id, p.due, p.taskText) : null;
      let first: Option;
      if (dup)
        first = {
          key: "first",
          l1: "Steht schon drin",
          l2: [{ t: fachKurz(dup.fachId), k: "b" }, { t: ` ${dup.text}, bis ${kurz(dup.due)}` }],
          ziel: { typ: "seite", art: "hausaufgaben", params: { flash: dup.id } },
        };
      else {
        // Fach und Termin stehen schon als Tokens darunter; die Zeile nennt nur, was eingetragen wird
        const l1 = !p.eFach ? (z.needFach || !p.taskText ? "Welches Fach?" : p.taskText) : p.taskText ? p.taskText : "Was ist auf?";
        // zu lang für eine Aufgabe (homeworkInputSchema): Hinweis wie bei „Fach fehlt“
        const zuLang = p.taskText.length > TITEL_MAX;
        first = {
          key: "first",
          l1,
          l2: zuLang ? `Zu lang · höchstens ${TITEL_MAX} Zeichen` : !p.eFach && p.taskText && !z.needFach ? "Fach fehlt" : null,
          intern: { typ: "eintragen" },
        };
      }
      const second: Option | null =
        p.intent === "eintragen"
          ? {
              key: "second",
              l1: [{ t: "Stattdessen suchen: " }, { t: `»${p.text}«`, k: "nw" }],
              intern: { typ: "override", intent: "suchen" },
            }
          : z.ctx?.details
            ? // Ändern kann keine Notiz setzen: der Weg zum vollen Formular
              { key: "second", l1: "Mit Details bearbeiten", intern: { typ: "details", url: z.ctx.details } }
            : null;
      // ohne Text wiederholt die erste Zeile nur den Platzhalter: dann stehen nur die Tokens da
      const zeigeErste = !!dup || !!p.taskText || !p.eFach || z.needFach;
      if (zeigeErste) ersteOpt = first;
      hitsInhalt = (
        <>
          {zeigeErste ? <Opt key="first" o={first} first onWaehlen={(o) => waehlen(o)} {...optProps} /> : null}
          {second && (p.text || second.intern?.typ === "details") ? <Opt key="second" o={second} onWaehlen={(o) => waehlen(o)} {...optProps} /> : null}
        </>
      );
    } else if (p) {
      const r = suche(p, { v, jetzt: jetzt(), doneFuer, server: z.server });
      ersteOpt = r.top;
      const zweite: Option | null =
        p.fach && p.text && !WH_WORDS.some((w) => p!.words.map(bare).includes(w))
          ? {
              key: "second",
              l1: "Als Aufgabe eintragen",
              l2: `${p.fach.name}, ${p.due ? `bis ${kurz(p.due)}` : "bis wann?"}`,
              intern: { typ: "override", intent: "eintragen" },
            }
          : null;
      hitsInhalt = (
        <>
          <Opt key="top" o={r.top} first onWaehlen={(o) => waehlen(o)} {...optProps} />
          {zweite ? <Opt key="second" o={zweite} onWaehlen={(o) => waehlen(o)} {...optProps} /> : null}
          {r.groups.map((g) => (
            <div key={g.key} className="m-group" role="group" aria-label={g.label ?? undefined} data-k={g.key}>
              {g.label ? <p className="m-gl">{g.label}</p> : null}
              <div>
                {g.inhalt ? (
                  <AntwortInhaltView
                    inhalt={g.inhalt}
                    heute={v.heute}
                    fachKurz={fachKurz}
                    aufgabe={(x) => v.aufgaben.find((y) => y.id === x.id) ?? x}
                    onAbhaken={setDone}
                  />
                ) : (
                  g.items!.map((it) => (
                    <Opt key={it.key} o={{ ...it, task: it.task ? (v.aufgaben.find((y) => y.id === it.task!.id) ?? it.task) : undefined }} onWaehlen={(o) => waehlen(o)} {...optProps} />
                  ))
                )}
              </div>
            </div>
          ))}
        </>
      );
    }
  }

  if (!showLeer) letzteHits.current = hitsInhalt;
  const intent: Absicht = p ? p.intent : "suchen";
  const tokens = tokensFuer(sichtbar && !z.answer && (vt || z.ctx) ? p : null, true, () => {
    z.override = intent === "suchen" ? "eintragen" : "suchen";
    onInput();
    feldRef.current?.focus({ preventScroll: true });
  });
  const pillen = sichtbar && v && p && (p.intent === "eintragen" || p.intent === "aendern") && !p.eFach && !z.answer && !z.rueck;
  const lupeName: IconName = intent === "suchen" ? "search" : intent === "aendern" ? "edit" : "add";
  const sendName: IconName = intent === "suchen" ? "arrow_forward" : "check";

  const syncSel = (opts?: HTMLElement[], insBild = true) => {
    const z = Z.current;
    const layer = showLeer ? leerRef.current : hitsRef.current;
    const list = opts ?? (layer ? [...layer.querySelectorAll<HTMLElement>(".opt")] : []);
    list.forEach((n, i) => n.setAttribute("aria-selected", String(i === z.sel)));
    const cur = list[z.sel];
    z.selKey = cur?.dataset.k ?? null;
    const feld = feldRef.current;
    if (cur && feld) {
      feld.setAttribute("aria-activedescendant", cur.id);
      if (insBild) cur.scrollIntoView({ block: "nearest" });
    } else feld?.removeAttribute("aria-activedescendant");
  };

  // ── Nach dem Malen: Größe, Verlauf, Auswahl, Einblenden ──────────────────────

  const vorherSend = useRef<IconName>("arrow_forward");
  const vorherLupe = useRef<IconName>("search");
  const vorherLeer = useRef(true);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const ms = scrollRef.current;
    if (!menu || !ms) return;
    // Icons: Pfeil zeigt, Haken trägt ein (13.3 Nr. 20)
    if (vorherSend.current !== sendName) {
      const si = document.getElementById("sendIcon");
      if (si && text.trim() && !reduce())
        si.animate([{ transform: "rotate(-90deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 200, easing: E.out });
      vorherSend.current = sendName;
    }
    if (vorherLupe.current !== lupeName) {
      const li = document.getElementById("lupeIcon");
      if (li && !reduce()) li.animate([{ transform: "rotate(-90deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 200, easing: E.out });
      vorherLupe.current = lupeName;
    }
    if (!offenRef.current) return;

    const animate = z.animNext;
    const ersteMal = !menu.classList.contains("open");
    if (ersteMal) menu.classList.add("open");
    if (vorherLeer.current !== showLeer) {
      z.maxH = 0;
      vorherLeer.current = showLeer;
    }
    if (ersteMal) sizeMenu();

    // Höhe hält beim Tippen, schrumpft erst nach 400 ms Ruhe
    menu.style.minHeight = "";
    const nat = menu.offsetHeight;
    clearTimeout(z.shrinkT);
    if (nat >= (z.maxH || 0)) z.maxH = nat;
    else
      z.shrinkT = setTimeout(() => {
        if (!offenRef.current) return;
        menu.style.minHeight = "";
        z.maxH = menu.offsetHeight;
      }, 400);
    const mx = parseFloat(menu.style.maxHeight) || Infinity;
    z.maxH = Math.min(z.maxH, mx);
    menu.style.minHeight = `${z.maxH}px`;

    // Auswahl (Pfeiltasten, Enter) — aria-selected wie syncSel
    const layer = showLeer ? leerRef.current : hitsRef.current;
    const opts = layer ? [...layer.querySelectorAll<HTMLElement>(".opt")] : [];
    const keep = opts.findIndex((n) => n.dataset.k === z.selKey);
    if (z.scrollNeu) {
      // nur ein renderMenu im Sinne des Prototyps setzt Scroll und Auswahl
      z.scrollNeu = false;
      ms.scrollTop = showLeer ? 0 : ms.scrollHeight;
      z.sel = keep >= 0 && !animate ? keep : 0;
      syncSel(opts);
    } else {
      // Abhaken, Toast, neue Daten: die Liste bleibt, wo sie ist (kein Umsortieren unter dem Finger)
      if (keep >= 0) z.sel = keep;
      syncSel(opts, false);
    }
    if (z.nachVorrat && vorrat && vorratVomTag(vorrat)) {
      const weiter = z.nachVorrat;
      z.nachVorrat = null;
      queueMicrotask(weiter);
    }

    if (ersteMal) {
      const H = menu.offsetHeight;
      animRef.current?.cancel();
      animRef.current = reduce()
        ? menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 })
        : menu.animate([{ clipPath: menuClip(H) }, { clipPath: MENU_FULL }], { duration: 280, easing: E.drawer });
    }

    // Neue Knoten fahren ein (13.3 Nr. 14): beim Öffnen gestaffelt ab 80 ms.
    // Wie im Prototyp (`opts.concat($$('.m-group'))`) erst alle Optionen, dann
    // die Gruppenlabels — so fahren alle Bereichszellen ein.
    const frisch = layer
      ? [
          ...layer.querySelectorAll<HTMLElement>(".opt"),
          ...layer.querySelectorAll<HTMLElement>(".m-group"),
        ].filter((n) => {
          const k = (showLeer ? "L" : "") + (n.dataset.k ?? "");
          const istNeu = !z.gesehen.has(k);
          z.gesehen.add(k);
          return istNeu || animate;
        })
      : [];
    if (!reduce()) {
      const staffel = frisch.slice(0, 12).map((n, i) =>
        n.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
          duration: 200,
          delay: animate ? 80 + Math.min(i, 3) * 25 : 0,
          easing: E.out,
          fill: "backwards",
        }),
      );
      // Solange die Staffel läuft, zählt ihr translateY(6px) zum Überlauf: danach nachmessen
      Promise.all(staffel.map((a) => a.finished)).then(mehrAnzeigen, () => {});
    }
    // Tokens fahren ein
    tokRef.current?.querySelectorAll<HTMLElement>(".tok").forEach((n) => {
      const k = n.dataset.k ?? "";
      if (z.gesehen.has(k)) return;
      z.gesehen.add(k);
      if (!reduce()) n.animate([{ opacity: 0, transform: "translateY(4px) scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: E.out });
    });
    // Absicht gewechselt: die erste Zeile blendet neu ein
    if (p && z.lastIntent && p.intent !== z.lastIntent && !reduce()) {
      const f1 = hitsRef.current?.querySelector<HTMLElement>(".opt.first .o1");
      f1?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.38 }, { opacity: 1 }], { duration: 260, easing: E.out });
    }
    // Antwort: das Kürzel fliegt aus dem Feld an seinen Platz
    if (kuerzelFlug.current && z.answer) {
      const fr = kuerzelFlug.current;
      kuerzelFlug.current = null;
      const k = document.getElementById("kuerzel");
      if (k && !reduce()) {
        const kr = k.getBoundingClientRect();
        k.animate([{ transform: `translate(${fr.left + 4 - kr.left}px,${fr.top + 12 - kr.top}px)` }, { transform: "none" }], {
          duration: 360,
          easing: E.drawer,
        });
        const ans = k.parentElement?.querySelector(".ans");
        [...(ans?.children ?? [])].forEach((c, i) =>
          (c as HTMLElement).animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
            duration: 220,
            delay: 90 + Math.min(i, 3) * 25,
            easing: E.out,
            fill: "backwards",
          }),
        );
      }
    }
    z.lastIntent = p ? p.intent : null;
    z.animNext = false;
    mehrAnzeigen();
  });


  // ── Volltextsuche: 150 ms nach dem letzten Tastendruck (Prototyp Z. 2451) ───
  const suchText = p && p.intent === "suchen" && !z.answer ? p.text : "";
  const markWoerter = (() => {
    if (!p || !suchText) return "";
    const qs = textWords(suchText).filter((w) => !STOP.has(w));
    const fw = new Set(p.fach ? p.fach.alias.map(bare).concat(p.fach.k2 ? [p.fach.k2] : []) : []);
    const content = qs.filter((q) => !fw.has(q) && !ZIEL_INHALT.has(q));
    return (content.length ? content : qs).join(" ");
  })();
  useEffect(() => {
    const zz = Z.current;
    clearTimeout(zz.serverT);
    if (!suchText) return;
    const q = suchText;
    // Eine ältere Antwort (langsamer Funnel) darf die Liste der neueren nicht überschreiben:
    // jede Anfrage bricht beim nächsten Tastendruck ab
    const abbruch = new AbortController();
    let nachlauf: ReturnType<typeof setTimeout> | undefined;
    zz.serverT = setTimeout(() => {
      fetch(`/api/suche?q=${encodeURIComponent(q)}&w=${encodeURIComponent(markWoerter)}`, {
        headers: { accept: "application/json" },
        signal: abbruch.signal,
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean; list: BlattTreffer[] }>) : null))
        .then((j) => {
          if (!j?.ok || abbruch.signal.aborted) return;
          nachlauf = setTimeout(() => {
            const alt = zz.server;
            const same = alt.q === q && alt.list.length === j.list.length && alt.list.every((x, i) => x.id === j.list[i].id && x.ausschnitt === j.list[i].ausschnitt);
            zz.server = { q, list: j.list };
            if (!same && offenRef.current && textRef.current.trim() && norm(textRef.current).includes(norm(q))) {
              zz.scrollNeu = true;
              neu();
            }
          }, 40);
        })
        .catch(() => {});
    }, 150);
    return () => {
      abbruch.abort();
      clearTimeout(nachlauf);
    };
  }, [suchText, markWoerter, neu]);

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
    const vel = (yb - ya) / Math.max(1, tb - ta);
    if (s.dy > menu.offsetHeight * 0.28 || vel > 0.5) {
      schliessen({ keepText: true });
      return;
    }
    menu.style.transform = "";
    if (!reduce()) menu.animate([{ transform: `translateY(${s.dy}px)` }, { transform: "none" }], springOpts());
  };

  const optionenJetzt = () => {
    const layer = showLeer ? leerRef.current : hitsRef.current;
    return layer ? [...layer.querySelectorAll<HTMLElement>(".opt")] : [];
  };
  const optionVon = (el: HTMLElement | undefined) => el?.click();

  return (
    <>
      <div className={`scrim${offen ? " on" : ""}`} id="scrim" onClick={() => schliessen({ keepText: true })} />
      <div className={`zeile${offen ? " menu-on" : ""}${versteckt ? " hide" : ""}`} id="zeile" ref={zeileRef}>
        <div
          className="menu"
          id="menu"
          ref={menuRef}
          aria-label="Eintragen oder suchen"
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest(".opt, .tok, .fp, button")) e.preventDefault();
          }}
        >
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
            <div className={`m-layer${showLeer ? "" : " off"}`} id="mLeer" role="listbox" aria-label="Wohin?" ref={leerRef}>
              {/* mit Kontext bleibt die leere Ebene leer wie im Prototyp (dort nie befüllt), sonst vergrößert sie die Scrollhöhe */}
              {(z.ctx && !showLeer ? [] : leerAnzeige)
                    .filter((g) => g.items.length)
                    .map((g) => (
                      <div key={g.label} className="m-group" role="group" aria-label={g.label} data-k={"lg:" + g.label}>
                        <p className="m-gl">{g.label}</p>
                        <div className={g.grid ? "m-grid" : undefined}>
                          {g.items.map((o) => (
                            <Opt key={"L" + o.key} o={o} onWaehlen={(x) => waehlen(x, true)} {...optProps} />
                          ))}
                        </div>
                      </div>
                    ))}
            </div>
            <div className={`m-layer m-hits${showLeer ? " off" : ""}`} id="mHits" role="listbox" aria-label="Treffer" ref={hitsRef}>
              {showLeer ? letzteHits.current : hitsInhalt}
            </div>
          </div>
          <div className="m-fach" id="mFach" ref={fachRef}>
            {pillen && v ? (
              <Fachpillen
                faecher={v.faecher}
                onWahl={(f) => {
                  const c: ZeilenKontext = { ...(z.ctx ?? { intent: "eintragen", fach: null }), fach: f.id, due: null, dueAuto: false };
                  if (z.override === "eintragen" && c.intent !== "aendern") c.intent = "eintragen";
                  z.ctx = c;
                  feldRef.current?.focus({ preventScroll: true });
                  onInput();
                }}
              />
            ) : null}
          </div>
          <div className="m-tokens" id="mTokens" aria-live="polite" ref={tokRef}>
            <Tokens list={tokens} />
          </div>
        </div>
        <form
          className={`dock${intent !== "suchen" ? " ctx" : ""}`}
          id="dock"
          ref={dockRef}
          autoComplete="off"
          onPointerDown={(e) => {
            if (!vorratRef.current) void vorratAuffrischen();
            if ((e.target as HTMLElement).closest("#camBtn, #send, input")) return;
            e.preventDefault();
            feldRef.current?.focus({ preventScroll: true });
          }}
          onSubmit={(e) => {
            e.preventDefault();
            const zz = Z.current;
            if (p && p.held) {
              zz.settled = true;
              zz.sel = 0;
              zz.scrollNeu = true;
              neu();
              setTimeout(() => {
                if (offenRef.current) optionVon(optionenJetzt()[0]);
              }, 150);
              return;
            }
            optionVon(optionenJetzt()[zz.sel]);
          }}
        >
          <span className="lupe" aria-hidden="true">
            <Icon name={lupeName} id="lupeIcon" />
          </span>
          <input
            ref={feldRef}
            id="field"
            type="text"
            placeholder={z.ctx && intent !== "suchen" ? "Was ist auf?" : "Eintragen oder suchen"}
            role="combobox"
            aria-controls={showLeer ? "mLeer" : "mHits"}
            aria-expanded={offen}
            aria-autocomplete="list"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-label="Eintragen oder suchen"
            value={text}
            onChange={(e) => {
              setFeld(e.target.value);
              onInput();
            }}
            onFocus={() => {
              const zz = Z.current;
              if (zz.keptAt && Date.now() - zz.keptAt > 600000) {
                setFeld("");
                zz.ctx = null;
                sendenRef.current = null;
                zz.override = null;
              }
              zz.keptAt = 0;
              if (!offenRef.current) oeffnen();
            }}
            onKeyDown={(e) => {
              const zz = Z.current;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const opts = optionenJetzt();
                if (!opts.length) return;
                zz.sel = (zz.sel + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
                syncSel(opts);
              } else if (e.key === "Backspace" && !textRef.current && zz.ctx) {
                e.preventDefault();
                if (zz.ctx.due && !zz.ctx.dueRemoved) zz.ctx = { ...zz.ctx, due: null, dueAuto: false, dueRemoved: true };
                else if (zz.ctx.fach) zz.ctx = { ...zz.ctx, fach: null, fachPills: true };
                onInput();
              }
            }}
          />
          <button className={`send${vt ? " on" : ""}`} id="send" type="submit" aria-label={intent === "suchen" ? "Zeigen" : intent === "aendern" ? "Ändern" : "Eintragen"}>
            <Icon name={sendName} id="sendIcon" />
          </button>
          <span className="dsep" aria-hidden="true" />
          <button
            className="camb"
            id="camBtn"
            type="button"
            aria-label="Blatt aufnehmen"
            onPointerDown={() => void warmCamera()}
            onClick={() => nachSchliessen(() => kombi.openCam({ ziel: "zeile" }))}
          >
            <Icon name="camera" />
          </button>
        </form>
      </div>
    </>
  );
}
