"use client";

import { usePathname, useRouter, useSelectedLayoutSegments } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AblaufEbene } from "@/components/kombi/ablauf";
import { Startseite } from "@/components/kombi/home/startseite";
import { KameraEbene } from "@/components/kombi/kamera";
import {
  KombiKontext,
  type EbenenHandler,
  type EbenenName,
  type UeberEbene,
  type KombiApi,
  type OeffnenOptionen,
} from "@/components/kombi/kontext";
import { Seite, SeitenInhalt } from "@/components/kombi/seite";
import { artAusSegmenten, ROUTE_STATT_STAPEL, seitenArt } from "@/components/kombi/seiten/registry";
import { TischEbene } from "@/components/kombi/tisch";
import { ArbeitsblattTisch } from "@/components/kombi/tisch/arbeitsblatt/tisch-blatt";
import { LernblockTisch } from "@/components/kombi/tisch/lernblock-tisch";
import { Zeile, type ZeileHandle } from "@/components/kombi/zeile";
import { TOAST_MS } from "@/lib/kombi/aktion";
import { festeSeiteVon, zuletztMerken } from "@/components/kombi/zeile/zuletzt";
import { E, moveTo, reduce, springOpts } from "@/lib/kombi/motion";
import type { TagDaten } from "@/lib/kombi/tag-daten";
import { istAelter } from "@/lib/kombi/startseite";
import { uhrzeit } from "@/lib/kombi/text";
import { themeColor, themeColorBeobachten } from "@/lib/kombi/theme-color";

/**
 * Die Shell von Modell 23 (Plan 2.1, 2.4, A): `#app` mit den Ebenen `home`,
 * `flow` und `pages`, dazu Zeile, Toast, Scrim und Sheet. Kamera und Tisch
 * hängen spätere Abschnitte über `registriere()` ein.
 *
 * ── Der Vertrag mit dem Next-Router (Plan 2.4) ───────────────────────────────
 *
 * 1. `TagDaten`: Auf `/` bringt die Seite sie mit (Startseite merkt sie sich),
 *    sonst holt die Shell sie nach dem ersten Malen über `/api/tag/daten`.
 * 2. Kein `refresh()` aus Stapelseiten: nach einer Action ruft man
 *    `neuLaden()` — TagDaten und die oberste Stapelseite kommen über die API.
 * 3. Der Stapel liegt in `history.state`: `{kombi: 1, stapel: [{art, params}],
 *    idx}` an jedem Eintrag. Neuladen und Zurück stellen ihn wieder her.
 * 4. `popstate` mit `state.kombi` gleicht den Stapel ab. Next behandelt seinen
 *    Teil (Baum) selbst: unsere `pushState`-Einträge tragen den Baum der
 *    Seite darunter, also bleiben `children` dabei unverändert.
 * 5. Echte Navigation (Link, Umleitung): `useSelectedLayoutSegments()` ist
 *    nicht leer, die `children` liegen als oberste Ebene über dem Stapel und
 *    fahren ein wie `openPage`. Der Stapel darunter bleibt.
 * 6. Laden: die Seite fährt mit Daten ein, nach 150 ms auch ohne (nur Titel).
 * 7. Fehler: keine Seite, Toast „Keine Verbindung“ mit „Erneut“.
 * 8. Offline: der Service Worker liefert `/api/seite/*` aus dem Daten-Cache,
 *    die Seite trägt „Ohne Verbindung · Stand …“.
 * 9. Optimistische Actions: `src/lib/kombi/aktion.ts` mit `fehlerToast`.
 *
 * Menü und Sheet legen beim Öffnen einen eigenen Eintrag an (`overlay`), damit
 * die Android-Zurück-Taste sie zuerst schließt (Plan 1.4).
 */

type StapelEintrag = { art: string; params: Record<string, string> };

type Ebene =
  | {
      key: string;
      typ: "stapel";
      art: string;
      params: Record<string, string>;
      daten: unknown;
      ausCache: string | null;
      geht?: boolean;
      still?: boolean;
      /**
       * Die Seite stand vorher als echte Route da (Einstieg über eine andere
       * Adresse als „/“) und wurde zur Stapelseite, als eine neue Route darüber
       * kam. Ältere Einträge in der History kennen sie nicht als Stapelseite:
       * beim Abgleich bleibt sie liegen, statt zu gehen.
       */
      basis?: boolean;
      /** Wiederhergestellt ohne Netz und ohne gecachte Daten: Leerzustand statt stummer Seite */
      ohneNetz?: boolean;
    }
  | { key: string; typ: "route"; geht?: boolean; still?: boolean };

type KombiState = {
  kombi: 1;
  stapel: StapelEintrag[];
  idx: number;
  /** Welche Ladung der Seite den Eintrag schrieb (siehe LADUNG) */
  ladung: string;
  /** Der Eintrag gehört einer echten Route; `stapel` sind die Seiten darunter */
  route?: 1;
  overlay?: "menu" | "sheet" | UeberEbene;
};

/**
 * Eine Kennung je Laden der Seite. Einträge aus einer früheren Ladung (vor
 * einem Neuladen) kennt der Router-Cache nicht mehr: Next bleibt beim
 * Zurückspringen dorthin gelegentlich hängen, statt nachzuladen (gemessen mit
 * scripts/pruef-kombi/stapel.mjs, Prüfung 3). Für solche Einträge lädt die
 * Shell die Seite deshalb neu — der Stapel kommt dann aus `history.state`.
 */
const LADUNG = Math.random().toString(36).slice(2, 10);

type SeitenAntwort = { daten: unknown; ausCache: string | null };

const gleich = (a: StapelEintrag, b: StapelEintrag) =>
  a.art === b.art && JSON.stringify(a.params) === JSON.stringify(b.params);

function stateJetzt(): Partial<KombiState> & Record<string, unknown> {
  return (window.history.state ?? {}) as Partial<KombiState> & Record<string, unknown>;
}

/**
 * Kam diese Seite ohne Netz aus dem Cache des Service Workers? Der Worker
 * legt dafür eine Marke in seinen Daten-Cache (public/sw.js, `NAV_MARKE`);
 * die Kopfzeilen einer Navigation kann die Seite nicht lesen. Gibt den Stand
 * des HTML zurück (ms, 0 = unbekannt).
 */
async function navigationAusCache(): Promise<{ gespeichert: number } | null> {
  try {
    if (!("caches" in window)) return null;
    const cache = await caches.open("schulapp-v3-daten");
    const url = new URL("/__schulapp/navigation", window.location.origin).href;
    const r = await cache.match(url);
    if (!r) return null;
    const j = (await r.json()) as { pfad?: string; zeit?: number; gespeichert?: number | null };
    await cache.delete(url);
    if (j.pfad !== window.location.pathname || typeof j.zeit !== "number" || Date.now() - j.zeit > 60_000) return null;
    return { gespeichert: typeof j.gespeichert === "number" ? j.gespeichert : 0 };
  } catch {
    return null;
  }
}

/**
 * Das HTML einer echten Route (Eingangskorb, Bausteine …) neu in den Cache
 * des Service Workers legen. Ihr Stand steht nur im HTML: nach einer Action
 * auf der Seite (abgehakt, übernommen) lieferte der Worker ohne Netz sonst
 * still die zuerst geladene Fassung. Der Abruf läuft am Worker vorbei (kein
 * `navigate`) und trägt den Zeitpunkt wie public/sw.js `mitZeitpunkt`; ohne
 * `Vary`, damit die Navigation ihn später findet.
 */
async function routeNachCache(pfad: string): Promise<void> {
  try {
    if (!("caches" in window) || !navigator.onLine || window.location.pathname !== pfad) return;
    const url = window.location.href.split("#")[0];
    const r = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { accept: "text/html" } });
    if (!r.ok || r.redirected || !(r.headers.get("content-type") ?? "").includes("text/html")) return;
    const body = await r.arrayBuffer();
    const headers = new Headers(r.headers);
    // der Körper ist schon entpackt und neu gezählt
    for (const k of ["vary", "content-encoding", "content-length"]) headers.delete(k);
    headers.set("x-schulapp-gespeichert", new Date().toISOString());
    const cache = await caches.open("schulapp-v3-pages");
    await cache.put(url, new Response(body, { status: r.status, statusText: r.statusText, headers }));
  } catch {
    // ohne Netz oder ohne Cache-Speicher: es bleibt bei der Fassung von vorher
  }
}

async function seiteHolen(art: string, params: Record<string, string>): Promise<SeitenAntwort> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/seite/${encodeURIComponent(art)}${qs ? `?${qs}` : ""}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Seite ${art}: ${res.status}`);
  const json = (await res.json()) as { ok: boolean; daten?: unknown };
  if (!json.ok) throw new Error(`Seite ${art} abgewiesen`);
  return {
    daten: json.daten,
    ausCache: res.headers.get("x-schulapp-aus-cache") ? res.headers.get("x-schulapp-gespeichert") : null,
  };
}

export function KombiShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const segmente = useSelectedLayoutSegments();
  const segKey = segmente.join("/");
  const istStart = segmente.length === 0;

  const [tagDaten, setTagDaten] = useState<TagDaten | null>(null);
  const [ebenen, setEbenen] = useState<Ebene[]>(() =>
    istStart ? [] : [{ key: "route", typ: "route", still: true }],
  );
  const [sheet, setSheet] = useState<{ inhalt: ReactNode; aufDemTisch: boolean } | null>(null);

  const appRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const zeileRef = useRef<ZeileHandle>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const sheetScrimRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const toastTextRef = useRef<HTMLSpanElement>(null);
  const toastActRef = useRef<HTMLButtonElement>(null);

  const ebenenRef = useRef<Ebene[]>(ebenen);
  const elemente = useRef(new Map<string, HTMLElement>());
  const animiert = useRef(new Set<string>());
  const handler = useRef(new Map<EbenenName, EbenenHandler>());
  const vorgeladen = useRef(new Map<string, { zeit: number; p: Promise<SeitenAntwort> }>());
  const ignorierePop = useRef(0);
  const ausPop = useRef(false);
  /** Der Eintrag, auf den Zurück/Vor zuletzt sprang, gehört einer echten Route */
  const popRoute = useRef(false);
  const ausPopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idx = useRef(0);
  const zaehler = useRef(0);
  const erstesMal = useRef(true);
  const segVorher = useRef(segKey);
  const toastZustand = useRef<{ fn: (() => void) | null; bis: number; desc: string; undo: boolean; timer?: ReturnType<typeof setTimeout> }>({
    fn: null,
    bis: 0,
    desc: "",
    undo: false,
  });

  const setzeEbenen = useCallback((f: (alt: Ebene[]) => Ebene[]) => {
    const neu = f(ebenenRef.current);
    ebenenRef.current = neu;
    setEbenen(neu);
  }, []);

  const stapelJetzt = useCallback(
    (): StapelEintrag[] =>
      ebenenRef.current
        .filter((e): e is Extract<Ebene, { typ: "stapel" }> => e.typ === "stapel" && !e.geht)
        .map((e) => ({ art: e.art, params: e.params })),
    [],
  );

  // ── History ───────────────────────────────────────────────────────────────

  const pushStapel = useCallback(
    (stapel: StapelEintrag[], url: string) => {
      const s = stateJetzt();
      // Menü und Sheet ersetzt die Seite; Tisch und Lupe bleiben darunter stehen
      const ersetzen = s.overlay === "menu" || s.overlay === "sheet";
      const state: KombiState = { kombi: 1, stapel, idx: (ersetzen ? idx.current : idx.current + 1), ladung: LADUNG };
      idx.current = state.idx;
      // Ein offenes Menü (oder Sheet) hat einen eigenen Eintrag: den ersetzt
      // die Seite, damit Zurück nicht erst auf dem leeren Menü landet.
      if (ersetzen) window.history.replaceState(state, "", url);
      else window.history.pushState(state, "", url);
    },
    [],
  );

  /** Den aktuellen Eintrag mit dem Stapel beschriften (nach echter Navigation, beim Start). */
  const beschriften = useCallback(
    (neuerEintrag: boolean) => {
      if (neuerEintrag) idx.current += 1;
      const nr = idx.current;
      // Nach den Effekten des Routers: Next schreibt den Eintrag nach einer
      // Navigation selbst noch einmal (HistoryUpdater) und nähme die
      // Beschriftung sonst wieder mit.
      requestAnimationFrame(() => {
        const s = stateJetzt();
        if (s.kombi && s.ladung === LADUNG && !neuerEintrag) return;
        const state = { ...s, kombi: 1 as const, stapel: stapelJetzt(), idx: nr, ladung: LADUNG, route: 1 as const };
        delete (state as Partial<KombiState>).overlay;
        window.history.replaceState(state, "");
      });
    },
    [stapelJetzt],
  );

  // ── Toast (Prototyp Z. 1601–1624) ───────────────────────────────────────────

  const hideToast = useCallback((keepUndo?: boolean) => {
    const t = toastZustand.current;
    clearTimeout(t.timer);
    toastRef.current?.classList.remove("on");
    document.body.classList.remove("toast-on");
    if (!keepUndo || !t.undo) {
      t.fn = null;
      t.bis = 0;
    } else {
      t.timer = setTimeout(() => {
        t.fn = null;
      }, Math.max(0, t.bis - Date.now()));
    }
  }, []);

  const toast = useCallback(
    (text: string, fn?: (() => void) | null, desc?: string, label = "Rückgängig") => {
      const el = toastRef.current;
      const z = document.getElementById("zeile");
      if (!el || !toastTextRef.current || !toastActRef.current) return;
      const camTop = document.body.classList.contains("cam-offen") ? document.querySelector(".cam-top") : null;
      const bottom = camTop
        ? window.innerHeight - camTop.getBoundingClientRect().bottom - 8 - 44
        : z?.classList.contains("hide")
          ? 16
          : (z ? parseFloat(getComputedStyle(z).bottom) || 16 : 16) + 52 + 10;
      el.style.bottom = `${Math.round(bottom)}px`;
      toastTextRef.current.textContent = text;
      const t = toastZustand.current;
      t.fn = fn ?? null;
      t.bis = Date.now() + TOAST_MS;
      t.desc = desc ?? text;
      t.undo = !!fn && label === "Rückgängig";
      toastActRef.current.hidden = !fn;
      toastActRef.current.textContent = label;
      el.classList.remove("on");
      void el.offsetWidth;
      el.classList.add("on");
      document.body.classList.add("toast-on");
      clearTimeout(t.timer);
      t.timer = setTimeout(() => hideToast(), TOAST_MS);
    },
    [hideToast],
  );

  const toastAktuell = useRef(toast);
  useEffect(() => {
    toastAktuell.current = toast;
  }, [toast]);

  const fehlerToast = useCallback(
    (text: string, erneut: () => void, label: string) => toast(text, erneut, text, label),
    [toast],
  );

  // ── Ebenen: wer liegt unter wem ─────────────────────────────────────────────

  const unterVon = useCallback((key: string): HTMLElement | null => {
    const liste = ebenenRef.current;
    const i = liste.findIndex((e) => e.key === key);
    for (let j = i - 1; j >= 0; j--) {
      if (liste[j].geht) continue;
      const el = elemente.current.get(liste[j].key);
      if (el) return el;
    }
    return homeRef.current;
  }, []);

  const obersteEbene = useCallback(
    () => [...ebenenRef.current].reverse().find((e) => !e.geht) ?? null,
    [],
  );

  /**
   * Eine Seite geht (Zurück-Taste, Randwisch, Pfeil): die Stapelseite, die
   * danach oben liegt, holt still ihre Daten neu — eine Action auf der Seite
   * darüber (etwa „Note eintragen“) kann sie verändert haben. Der Inhalt
   * tauscht ohne eigene Animation (Plan 2.4, Punkt 6).
   */
  const freigelegtNachladen = useCallback(
    (gehtKey: string) => {
      const liste = ebenenRef.current;
      const i = liste.findIndex((x) => x.key === gehtKey);
      if (liste.slice(i + 1).some((x) => !x.geht)) return;
      const unten = liste.slice(0, Math.max(0, i)).reverse().find((x) => !x.geht);
      if (!unten || unten.typ !== "stapel") return;
      const key = unten.key;
      seiteHolen(unten.art, unten.params).then(
        (a) =>
          setzeEbenen((alt) =>
            alt.map((x) => (x.key === key && x.typ === "stapel" ? { ...x, daten: a.daten, ausCache: a.ausCache } : x)),
          ),
        () => {},
      );
    },
    [setzeEbenen],
  );

  // Einfahren neuer Ebenen und Ausfahren gehender, nach dem Rendern
  useLayoutEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const W = app.clientWidth;
    for (const e of ebenen) {
      const el = elemente.current.get(e.key);
      if (!el) continue;
      if (!e.geht && !animiert.current.has(e.key)) {
        animiert.current.add(e.key);
        const under = unterVon(e.key);
        if (e.still) {
          // ohne Einfahren (Neuladen, direkter Aufruf): die Ebene darunter
          // steht trotzdem dort, wo openPage sie hinlegt
          if (under && !reduce()) {
            under.style.transform = `translateX(${-0.24 * W}px)`;
            under.style.opacity = ".4";
          }
          // Eine abgelöste Route (`basis`), über der schon eine Seite liegt:
          // dort, wo die Seite darüber sie hingelegt hätte
          const i = ebenen.indexOf(e);
          const ueber = ebenen.slice(i + 1).find((x) => !x.geht);
          if (e.typ === "stapel" && e.basis && ueber && animiert.current.has(ueber.key) && !reduce()) {
            el.style.transform = `translateX(${-0.24 * W}px)`;
            el.style.opacity = ".4";
          }
          continue;
        }
        if (reduce()) {
          el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease" });
        } else {
          el.style.transform = `translateX(${W}px)`;
          moveTo(el, { transform: "translateX(0px)" }, { duration: 300, easing: E.drawer });
          if (under) moveTo(under, { transform: `translateX(${-0.24 * W}px)`, opacity: ".4" }, { duration: 300, easing: E.drawer });
        }
      } else if (e.geht && !animiert.current.has(`weg:${e.key}`)) {
        animiert.current.add(`weg:${e.key}`);
        const under = unterVon(e.key);
        freigelegtNachladen(e.key);
        const fertig = () => {
          animiert.current.delete(e.key);
          animiert.current.delete(`weg:${e.key}`);
          elemente.current.delete(e.key);
          setzeEbenen((alt) => alt.filter((x) => x.key !== e.key));
        };
        // Liegt `under` danach oben (kein neuer Stapel inzwischen), fällt
        // sein Stil weg — wie `if (underOf() === under)` im Prototyp.
        const unterLoesen = () => {
          const oben = obersteEbene();
          const obenEl = oben ? elemente.current.get(oben.key) : homeRef.current;
          if (under && under === obenEl) {
            under.style.transform = "";
            under.style.opacity = "";
          }
        };
        themeColor("paper");
        if (reduce()) {
          el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).finished.then(fertig, fertig);
          if (under) {
            under.getAnimations().forEach((a) => a.cancel());
            under.style.transform = "";
            under.style.opacity = "";
          }
        } else {
          moveTo(el, { transform: `translateX(${W}px)` }, { duration: 260, easing: E.drawer }).finished.then(fertig, () => {});
          if (under) {
            moveTo(under, { transform: "translateX(0px)", opacity: "1" }, { duration: 260, easing: E.drawer }).finished.then(unterLoesen, () => {});
          }
        }
      }
    }
  }, [ebenen, unterVon, setzeEbenen, obersteEbene, freigelegtNachladen]);

  // ── Stapel ──────────────────────────────────────────────────────────────────

  const holen = useCallback((art: string, params: Record<string, string>) => {
    const k = `${art}?${new URLSearchParams(params).toString()}`;
    const v = vorgeladen.current.get(k);
    if (v && Date.now() - v.zeit < 10_000) {
      vorgeladen.current.delete(k);
      return v.p;
    }
    return seiteHolen(art, params);
  }, []);

  const vorladen = useCallback((art: string, params: Record<string, string> = {}) => {
    if (!seitenArt(art)) return;
    const k = `${art}?${new URLSearchParams(params).toString()}`;
    const v = vorgeladen.current.get(k);
    if (v && Date.now() - v.zeit < 10_000) return;
    const p = seiteHolen(art, params);
    p.catch(() => vorgeladen.current.delete(k));
    vorgeladen.current.set(k, { zeit: Date.now(), p });
  }, []);

  const keyFuer = (art: string) => `s${++zaehler.current}:${art}`;

  const stapelEinfuegen = useCallback(
    (eintraege: (StapelEintrag & { daten: unknown; ausCache: string | null; still?: boolean; key?: string })[]) => {
      setzeEbenen((alt) => [
        ...alt,
        ...eintraege.map(
          (e): Ebene => ({
            key: e.key ?? keyFuer(e.art),
            typ: "stapel",
            art: e.art,
            params: e.params,
            daten: e.daten,
            ausCache: e.ausCache,
            still: e.still,
          }),
        ),
      ]);
    },
    [setzeEbenen],
  );

  const navigiereEcht = useCallback(
    (url: string) => {
      if (stateJetzt().overlay) router.replace(url);
      else router.push(url);
    },
    [router],
  );

  // für „Erneut“ im Fehler-Toast: openPage ruft sich selbst wieder auf
  const openPageRef = useRef<(art: string, params?: Record<string, string>) => void>(() => {});

  const openPage = useCallback(
    (art: string, params: Record<string, string> = {}, optionen?: OeffnenOptionen) => {
      clearTimeout(ausPopTimer.current);
      // „Zuletzt geöffnet“ im Menü der Zeile (Prototyp `remember`)
      zuletztMerken(art, params, optionen?.zuletzt);
      ausPop.current = false;
      zeileRef.current?.schliessen({ ausHistory: true });
      hideToast(true);
      const s = seitenArt(art);
      if (!s) {
        const route = ROUTE_STATT_STAPEL[art]?.(params);
        if (route) navigiereEcht(route);
        return;
      }
      const key = keyFuer(art);
      let gezeigt = false;
      let erledigt = false;
      const zeigen = (daten: unknown, ausCache: string | null) => {
        if (daten !== undefined) {
          const zl = s.zuletzt?.(params, daten);
          if (zl) zuletztMerken(art, params, zl);
        }
        if (gezeigt) {
          setzeEbenen((alt) =>
            alt.map((e) => (e.key === key && e.typ === "stapel" ? { ...e, daten, ausCache } : e)),
          );
          return;
        }
        gezeigt = true;
        stapelEinfuegen([{ key, art, params, daten, ausCache }]);
        // stapelJetzt() enthält die neue Seite schon (ebenenRef ist synchron)
        pushStapel(stapelJetzt(), s.url(params));
        themeColor("paper");
      };
      const timer = setTimeout(() => {
        if (!erledigt) zeigen(undefined, null);
      }, 150);
      holen(art, params).then(
        (antwort) => {
          erledigt = true;
          clearTimeout(timer);
          zeigen(antwort.daten, antwort.ausCache);
        },
        () => {
          erledigt = true;
          clearTimeout(timer);
          if (gezeigt) {
            // schon (nur mit Titel) eingefahren: wieder weg, kein halber Zustand
            window.history.back();
          }
          toast("Keine Verbindung", () => openPageRef.current(art, params), "Keine Verbindung", "Erneut");
        },
      );
    },
     
    [hideToast, navigiereEcht, holen, stapelEinfuegen, pushStapel, stapelJetzt, setzeEbenen, toast],
  );

  useEffect(() => {
    openPageRef.current = openPage;
  }, [openPage]);

  /** Stapel an einen Zielzustand angleichen (Zurück, Vor, Neuladen). */
  const stapelAngleichen = useCallback(
    (ziel: StapelEintrag[]) => {
      const aktuell = ebenenRef.current.filter(
        (e): e is Extract<Ebene, { typ: "stapel" }> => e.typ === "stapel" && !e.geht,
      );
      // Abgelöste Routen (`basis`) nennt ein älterer Eintrag nicht: überspringen
      let p = 0;
      let q = 0;
      for (;;) {
        if (p >= aktuell.length) break;
        if (q < ziel.length && gleich(aktuell[p], ziel[q])) {
          p++;
          q++;
        } else if (aktuell[p].basis) p++;
        else break;
      }
      const weg = aktuell.slice(p);
      if (weg.length) {
        const oben = weg[weg.length - 1];
        const sofort = new Set(weg.slice(0, -1).map((e) => e.key));
        setzeEbenen((alt) =>
          alt
            .filter((e) => !sofort.has(e.key))
            .map((e) => (e.key === oben.key ? { ...e, geht: true } : e)),
        );
      }
      const dazu = ziel.slice(q);
      dazu.forEach((eintrag, i) => {
        const key = keyFuer(eintrag.art);
        const letzte = i === dazu.length - 1;
        stapelEinfuegen([{ ...eintrag, key, daten: undefined, ausCache: null, still: !letzte }]);
        holen(eintrag.art, eintrag.params).then(
          (a) =>
            setzeEbenen((alt) =>
              alt.map((e) => (e.key === key && e.typ === "stapel" ? { ...e, daten: a.daten, ausCache: a.ausCache } : e)),
            ),
          () => toast("Keine Verbindung", null),
        );
      });
    },
     
    [setzeEbenen, stapelEinfuegen, holen, toast],
  );

  const popPage = useCallback(() => {
    const oben = obersteEbene();
    if (!oben) return;
    if (oben.typ === "stapel" && !(oben.basis && idx.current === 0)) {
      window.history.back();
      return;
    }
    // Route oben: zurück, wenn es einen Eintrag davor gibt, sonst zur Startseite
    if (idx.current > 0) router.back();
    else router.replace("/");
  }, [obersteEbene, router]);

  const neuLaden = useCallback(async () => {
    const auftraege: Promise<unknown>[] = [
      fetch("/api/tag/daten", { headers: { accept: "application/json" } })
        .then((r) => (r.ok ? (r.json() as Promise<TagDaten>) : null))
        .then((d) => {
          if (d) setTagDaten(d);
        })
        .catch(() => {}),
    ];
    const oben = [...ebenenRef.current].reverse().find((e) => !e.geht);
    if (oben && oben.typ === "route") {
      // Die oberste Ebene ist eine echte Route (direkter Aufruf, Push-Erinnerung,
      // Neuladen ohne Stapel): ihre Daten kommen aus dem Server-Render, also
      // rendert der Router sie neu (Plan 2.4, Punkt 2 erlaubt das für Routen).
      router.refresh();
      // Dieselben Daten auch in den Daten-Cache: ohne Netz liefert der Service
      // Worker sonst das HTML vom ersten Laden, ohne die Änderung von eben.
      const hier = artAusSegmenten(window.location.pathname.split("/").filter(Boolean));
      if (hier && seitenArt(hier.art)) auftraege.push(seiteHolen(hier.art, hier.params).catch(() => {}));
    } else if (oben && oben.typ === "stapel") {
      const key = oben.key;
      auftraege.push(
        seiteHolen(oben.art, oben.params)
          .then((a) =>
            setzeEbenen((alt) =>
              alt.map((e) => (e.key === key && e.typ === "stapel" ? { ...e, daten: a.daten, ausCache: a.ausCache } : e)),
            ),
          )
          .catch(() => {}),
      );
    }
    await Promise.all(auftraege);
  }, [setzeEbenen, router]);

  // ── Sheet (Prototyp Z. 3333–3366) ───────────────────────────────────────────

  const sheetSchliessen = useCallback((ausHistory = false) => {
    const el = sheetRef.current;
    if (!el || !el.classList.contains("open")) return;
    sheetScrimRef.current?.classList.remove("on");
    const a = reduce()
      ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 })
      : moveTo(el, { transform: "translateY(105%)" }, { duration: 300, easing: E.drawer });
    a.finished.then(
      () => {
        el.classList.remove("open");
        el.style.transform = "translateY(105%)";
        setSheet(null);
      },
      () => {},
    );
    if (!ausHistory && stateJetzt().overlay === "sheet") {
      ignorierePop.current += 1;
      window.history.back();
    }
  }, []);

  const openSheet = useCallback((inhalt: ReactNode, aufDemTisch = false) => {
    setSheet({ inhalt, aufDemTisch });
    if (stateJetzt().overlay !== "sheet") {
      window.history.pushState({ ...stateJetzt(), kombi: 1, stapel: stapelJetzt(), idx: idx.current, ladung: LADUNG, overlay: "sheet" }, "");
    }
  }, [stapelJetzt]);

  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!sheet || !el || el.classList.contains("open")) return;
    el.classList.add("open");
    sheetScrimRef.current?.classList.add("on");
    sheetScrimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce() ? 160 : 320, easing: "ease" });
    if (reduce()) {
      el.style.transform = "none";
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    } else moveTo(el, { transform: "translateY(0px)" }, { duration: 380, easing: E.drawer });
  }, [sheet]);

  // ── Menü der Zeile als Eintrag in der History (Android-Zurück schließt es) ──

  const menuOffen = useCallback(
    (offen: boolean, ausHistory: boolean) => {
      if (offen) {
        if (stateJetzt().overlay !== "menu") {
          window.history.pushState({ ...stateJetzt(), kombi: 1, stapel: stapelJetzt(), idx: idx.current, ladung: LADUNG, overlay: "menu" }, "");
        }
      } else if (!ausHistory && stateJetzt().overlay === "menu") {
        ignorierePop.current += 1;
        window.history.back();
      }
    },
    [stapelJetzt],
  );

  // ── Tisch und Lupe als Einträge in der History (Grundsatz 4) ────────────────
  //
  // Zurück schließt erst das Sheet, dann die Bestätigung, dann die Lupe, dann
  // den Tisch. Menü und Sheet haben ihre Einträge oben; Tisch und Lupe melden
  // sich hier an (`ebeneAuf`) und schließen per Knopf über `ebeneZu`, das
  // ihren Eintrag wieder abräumt.

  const offeneEbenen = useRef<{ name: UeberEbene; schliessen: () => void }[]>([]);
  /**
   * Nach einem Neuladen mit offenem Overlay (Menü, Sheet, Tisch, Bestätigung):
   * das Overlay ist zu, sein Eintrag in der History aber noch da. Die Shell
   * geht einmal (bei verschachtelten Overlays mehrmals) zurück auf den
   * Eintrag darunter und schreibt dort den Stapel dieser Ladung hinein — sonst
   * bewirkte der nächste Android-Zurück-Druck sichtbar nichts.
   */
  const overlayAbbau = useRef<{ stapel: StapelEintrag[]; ohneRoute: boolean } | null>(null);
  const nachPop = useRef<(() => void)[]>([]);

  const ebeneAuf = useCallback(
    (name: UeberEbene, schliessen: () => void) => {
      const eintragen = () => {
        const s = stateJetzt();
        const state = { ...s, kombi: 1 as const, stapel: stapelJetzt(), idx: idx.current, ladung: LADUNG, overlay: name };
        if (s.overlay === "menu") {
          // Das Menü hat einen eigenen Eintrag: den übernimmt die Ebene
          zeileRef.current?.schliessen({ ausHistory: true });
          window.history.replaceState(state, "");
        } else window.history.pushState(state, "");
        offeneEbenen.current.push({ name, schliessen });
      };
      // Ein Zurück vom Schließen des Menüs ist noch unterwegs: erst danach eintragen
      if (ignorierePop.current > 0) nachPop.current.push(eintragen);
      else eintragen();
    },
    [stapelJetzt],
  );

  const ebeneZu = useCallback((name: UeberEbene, ohneZurueck = false) => {
    const i = offeneEbenen.current.findIndex((e) => e.name === name);
    if (i < 0) return;
    const n = offeneEbenen.current.length - i;
    offeneEbenen.current.splice(i);
    if (ohneZurueck) return;
    ignorierePop.current += 1;
    window.history.go(-n);
  }, []);

  // ── popstate: nur mit Stapel-Markierung (Plan 2.4, Punkt 4) ────────────────

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const abbau = overlayAbbau.current;
      if (abbau) {
        const st = (e.state ?? {}) as Partial<KombiState> & Record<string, unknown>;
        if (st.overlay) {
          window.history.back();
          return;
        }
        overlayAbbau.current = null;
        const neu: Partial<KombiState> & Record<string, unknown> = { ...st, kombi: 1, stapel: abbau.stapel, idx: idx.current, ladung: LADUNG };
        if (abbau.ohneRoute) delete neu.route;
        window.history.replaceState(neu, "");
        return;
      }
      if (ignorierePop.current > 0) {
        ignorierePop.current -= 1;
        if (ignorierePop.current === 0) nachPop.current.splice(0).forEach((f) => f());
        return;
      }
      const s = (e.state ?? null) as (Partial<KombiState> & Record<string, unknown>) | null;
      // Lupe und Tisch: alles über dem Eintrag, auf dem wir jetzt stehen, geht zu — oben zuerst
      const ebenen = offeneEbenen.current;
      let bleibt = ebenen.length;
      while (bleibt > 0 && ebenen[bleibt - 1].name !== s?.overlay) bleibt -= 1;
      ebenen
        .splice(bleibt)
        .reverse()
        .forEach((x) => x.schliessen());
      if (zeileRef.current?.istOffen() && s?.overlay !== "menu") zeileRef.current.schliessen({ ausHistory: true });
      if (sheetRef.current?.classList.contains("open") && s?.overlay !== "sheet") sheetSchliessen(true);
      if (!s?.kombi) return;
      if (s.ladung !== LADUNG) {
        // Eintrag aus der Zeit vor einem Neuladen: neu laden, der Stapel
        // kommt aus history.state (siehe LADUNG).
        window.location.reload();
        return;
      }
      if (typeof s.idx === "number") idx.current = s.idx;
      popRoute.current = !!s.route;
      ausPop.current = true;
      clearTimeout(ausPopTimer.current);
      ausPopTimer.current = setTimeout(() => {
        ausPop.current = false;
      }, 1000);
      stapelAngleichen(s.stapel ?? []);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [stapelAngleichen, sheetSchliessen]);

  // ── Start: Eintrag beschriften, Stapel nach Neuladen wiederherstellen ──────

  /**
   * Daten einer wiederhergestellten Stapelseite holen. Ohne Netz (und ohne
   * Daten im Cache) bekommt sie einen Leerzustand; die oberste meldet dazu
   * „Keine Verbindung · Erneut“ wie `openPage`.
   */
  const stapelNachladen = useCallback(
    (key: string, art: string, params: Record<string, string>, melden: boolean) => {
      holen(art, params).then(
        (a) =>
          setzeEbenen((alt) =>
            alt.map((x) =>
              x.key === key && x.typ === "stapel" ? { ...x, daten: a.daten, ausCache: a.ausCache, ohneNetz: false } : x,
            ),
          ),
        () => {
          setzeEbenen((alt) => alt.map((x) => (x.key === key && x.typ === "stapel" ? { ...x, ohneNetz: true } : x)));
          if (melden) toast("Keine Verbindung", () => stapelNachladenRef.current(key, art, params, true), "Keine Verbindung", "Erneut");
        },
      );
    },
    [holen, setzeEbenen, toast],
  );
  const stapelNachladenRef = useRef(stapelNachladen);
  useEffect(() => {
    stapelNachladenRef.current = stapelNachladen;
  }, [stapelNachladen]);

  // Kommt die Verbindung zurück, laden die Seiten ohne Daten nach
  useEffect(() => {
    const online = () => {
      for (const e of ebenenRef.current)
        if (e.typ === "stapel" && !e.geht && e.ohneNetz && e.daten === undefined) stapelNachladenRef.current(e.key, e.art, e.params, false);
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);

  useEffect(() => {
    const s = stateJetzt();
    if (s.kombi && typeof s.idx === "number") idx.current = s.idx;
    const gespeichert = (s.kombi ? s.stapel ?? [] : []) as StapelEintrag[];
    // Ein Stapel-Eintrag nennt in `stapel` auch die Seite seiner URL — die
    // rendert nach dem Neuladen die Route, darunter liegt der Rest. Ein
    // Routen-Eintrag nennt nur die Seiten darunter.
    let unten = istStart || s.route ? gespeichert : gespeichert.slice(0, -1);
    // Ohne Netz liefert der Service Worker für eine Stapelseite ohne eigene
    // gecachte Fassung die Startseite unter ihrer Adresse aus (public/sw.js,
    // `stapelPfad`). Dann fehlt die Seite der Adresse noch oben auf dem
    // Stapel, wenn der Eintrag sie nicht schon nennt (Routen-Eintrag oder
    // gar kein Eintrag, etwa beim Aufruf über ein Lesezeichen).
    const ersatzStart = istStart && window.location.pathname !== "/";
    if (ersatzStart) {
      const hier = artAusSegmenten(window.location.pathname.split("/").filter(Boolean));
      const oben = unten[unten.length - 1];
      if (hier && !(oben && oben.art === hier.art && (oben.params.id ?? "") === (hier.params.id ?? ""))) unten = [...unten, hier];
    }
    if (unten.length) {
      const keys = unten.map((e) => keyFuer(e.art));
      setzeEbenen((alt) => [
        ...unten.map(
          (e, i): Ebene => ({ key: keys[i], typ: "stapel", art: e.art, params: e.params, daten: undefined, ausCache: null, still: true }),
        ),
        ...alt,
      ]);
      unten.forEach((e, i) => stapelNachladen(keys[i], e.art, e.params, i === unten.length - 1));
    }
    // Diesen Eintrag übernimmt die jetzige Ladung (auch nach Neuladen). Ein
    // liegengebliebenes Overlay (Menü, Sheet, Kamera) gibt es nach dem
    // Neuladen nicht mehr — Chrome stellt eine verworfene PWA mit ihrem
    // History-Eintrag wieder her; der darf den Ablauf nicht aufhalten.
    const { overlay: _liegengeblieben, ...ohneOverlay } = s;
    void _liegengeblieben;
    // Ersatz-Startseite: der Eintrag ist jetzt ein Stapel-Eintrag, der die
    // Seite seiner Adresse nennt — so stellt ihn auch ein späteres Neuladen
    // mit Netz (echte Route) richtig wieder her.
    if (ersatzStart) delete (ohneOverlay as Partial<KombiState>).route;
    const stapelHier = s.kombi && !ersatzStart ? gespeichert : unten;
    window.history.replaceState(
      { ...ohneOverlay, kombi: 1, stapel: stapelHier, idx: idx.current, ladung: LADUNG },
      "",
    );
    // Der Eintrag des Overlays selbst bleibt sonst stehen: zurück auf den darunter
    if (_liegengeblieben) {
      overlayAbbau.current = { stapel: stapelHier, ohneRoute: ersatzStart };
      window.history.back();
    }

    // Ohne Netz aus dem Cache: Die Daten-Antworten im Cache können neuer sein
    // als das HTML (nach dem Laden wurde abgehakt oder eingetragen). TagDaten
    // von dort nehmen, wenn sie neuer sind, und den Stand nennen. Eine
    // Stapelseite auf der Shell nennt ihn selbst („Ohne Verbindung · Stand …“).
    void navigationAusCache().then(async (nav) => {
      if (!nav) return;
      let stand = nav.gespeichert;
      if (istStart) {
        try {
          const r = await fetch("/api/tag/daten", { headers: { accept: "application/json" } });
          if (r.ok) {
            const d = (await r.json()) as TagDaten;
            setTagDaten((alt) => (alt && istAelter(d, alt) ? alt : d));
            const t = Date.parse(r.headers.get("x-schulapp-gespeichert") ?? "");
            if (r.headers.get("x-schulapp-aus-cache") && Number.isFinite(t)) stand = Math.max(stand, t);
          }
        } catch {
          // nichts im Daten-Cache: es bleibt beim HTML
        }
      }
      if (ersatzStart || !stand) return;
      // Ein Toast, der schon steht („Keine Verbindung · Erneut“), geht vor
      setTimeout(() => {
        if (!toastRef.current?.classList.contains("on")) toastAktuell.current(`Ohne Verbindung · Stand ${uhrzeit(new Date(stand))}`);
      }, 400);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Echte Route neu gerendert (Action mit revalidatePath, `router.refresh()`,
  // Navigation dorthin): ihr HTML im Cache auf diesen Stand bringen. Das erste
  // Rendern nach dem Laden nicht — das HTML hat der Worker eben gespeichert.
  const routeCacheErst = useRef(true);
  useEffect(() => {
    if (routeCacheErst.current) {
      routeCacheErst.current = false;
      return;
    }
    if (istStart) return;
    const t = setTimeout(() => void routeNachCache(pathname), 800);
    return () => clearTimeout(t);
  }, [children, istStart, pathname]);

  // ── Echte Navigation (Plan 2.4, Punkt 5) ────────────────────────────────────

  useEffect(() => {
    if (erstesMal.current) {
      erstesMal.current = false;
      return;
    }
    if (segVorher.current === segKey) return;
    const alteSegmente = segVorher.current ? segVorher.current.split("/") : [];
    segVorher.current = segKey;
    const route = ebenenRef.current.find((e) => e.typ === "route" && !e.geht);
    const obenIstRoute = !!route && obersteEbene()?.key === route.key;
    // Zurück auf einen Eintrag ohne Route, über dem die Route lag (die alte
    // Route darunter ist inzwischen Stapelseite oder fort, siehe unten): die
    // Route fährt aus, die Seiten darunter bleiben.
    if (ausPop.current && !istStart && route && obenIstRoute && !popRoute.current && ebenenRef.current.some((e) => e.typ === "stapel" && !e.geht)) {
      setzeEbenen((alt) => alt.map((e) => (e.key === route.key ? { ...e, geht: true } : e)));
      ausPop.current = false;
      return;
    }
    // Eine echte Route über Stapelseiten, unter denen noch die Einstiegsroute
    // liegt (Neuladen, Lesezeichen, Push-Erinnerung): die neue Route kommt als
    // oberste Ebene dazu. Die alte Route-Ebene darf keine fremden `children`
    // mehr bekommen — sie wird zur Stapelseite derselben Adresse, oder geht,
    // wo es keine gibt (Formulare).
    if (!istStart && route && !obenIstRoute && !ausPop.current) {
      const alt = artAusSegmenten(alteSegmente);
      const key = alt ? keyFuer(alt.art) : null;
      animiert.current.delete(route.key);
      elemente.current.delete(route.key);
      setzeEbenen((liste) => [
        ...liste.flatMap((e): Ebene[] =>
          e.key !== route.key
            ? [e]
            : alt && key
              ? [{ key, typ: "stapel", art: alt.art, params: alt.params, daten: undefined, ausCache: null, still: true, basis: true }]
              : [],
        ),
        { key: `route${++zaehler.current}`, typ: "route" },
      ]);
      if (alt && key) {
        holen(alt.art, alt.params).then(
          (a) =>
            setzeEbenen((liste) =>
              liste.map((e) => (e.key === key && e.typ === "stapel" ? { ...e, daten: a.daten, ausCache: a.ausCache } : e)),
            ),
          () => {},
        );
      }
      beschriften(true);
      return;
    }
    // Route löst Route ab (Blatt per URL geöffnet → „Blatt bearbeiten“): die
    // bisherige Route legt sich als Stapelseite unter die neue, so wie eine
    // Stapelseite unter einem Formular liegen bleibt (2.4, Punkt 5). Sonst
    // läge unter dem einfahrenden Formular die Startseite.
    const unter = !istStart && route && !ausPop.current && obenIstRoute ? artAusSegmenten(alteSegmente) : null;
    if (unter && route) {
      const key = keyFuer(unter.art);
      setzeEbenen((alt) => [
        ...alt.filter((e) => e.key !== route.key),
        { key, typ: "stapel", art: unter.art, params: unter.params, daten: undefined, ausCache: null, still: true, basis: true },
        { key: `route${++zaehler.current}`, typ: "route" },
      ]);
      holen(unter.art, unter.params).then(
        (a) =>
          setzeEbenen((alt) =>
            alt.map((e) => (e.key === key && e.typ === "stapel" ? { ...e, daten: a.daten, ausCache: a.ausCache } : e)),
          ),
        () => {},
      );
      beschriften(true);
      ausPop.current = false;
      return;
    }
    if (istStart) {
      if (route) {
        setzeEbenen((alt) => alt.map((e) => (e.key === route.key ? { ...e, geht: true } : e)));
        // Zurück von einer echten Route (eingang, bausteine, stoff …): was dort
        // geschah, kennt die Startseite noch nicht — TagDaten frisch holen.
        // Die Server-Props aus dem Router-Cache sind älter und gelten nicht
        // (merkeTagDaten vergleicht `stand`).
        fetch("/api/tag/daten", { headers: { accept: "application/json" } })
          .then((r) => (r.ok ? (r.json() as Promise<TagDaten>) : null))
          .then((d) => {
            if (d) setTagDaten((alt) => (alt && istAelter(d, alt) ? alt : d));
          })
          .catch(() => {});
      }
      if (!ausPop.current) {
        // Eine Navigation zur Startseite (nicht Zurück): alles zu, wie setView
        setzeEbenen((alt) => alt.filter((e) => e.typ === "route"));
        beschriften(false);
      }
    } else if (!route) {
      setzeEbenen((alt) => [...alt, { key: `route${++zaehler.current}`, typ: "route" }]);
      if (!ausPop.current) beschriften(true);
    } else if (!ausPop.current) {
      beschriften(true);
    }
    ausPop.current = false;
  }, [segKey, istStart, setzeEbenen, beschriften, obersteEbene, holen]);

  // „Zuletzt geöffnet“: Seiten ohne Parameter, die (bis G) noch Routen sind,
  // zählen bei jedem Einstieg — nicht nur über openPage (Prototyp `remember`)
  useEffect(() => {
    const art = festeSeiteVon(pathname);
    if (art) zuletztMerken(art, {});
  }, [pathname]);

  // ── TagDaten nachladen, wenn der Einstieg nicht `/` war (2.4, Punkt 1) ──────

  useEffect(() => {
    if (tagDaten || istStart) return;
    let weg = false;
    fetch("/api/tag/daten", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<TagDaten>) : null))
      .then((d) => {
        if (d && !weg) setTagDaten(d);
      })
      .catch(() => {});
    return () => {
      weg = true;
    };
  }, [tagDaten, istStart]);

  // ── Randwisch: die oberste Seite folgt dem Finger (10 gestureMove()) ───────

  const wisch = useRef<{ key: string; x0: number; y0: number; id: number; drag: boolean; hist: [number, number][]; x: number } | null>(null);
  const swallowClick = useRef(false);

  const randRunter = (e: React.PointerEvent<HTMLDivElement>) => {
    const oben = obersteEbene();
    if (!oben || e.button > 0) return;
    const el = elemente.current.get(oben.key);
    if (!el || !el.contains(e.target as Node)) return;
    if (e.clientX - el.getBoundingClientRect().left > 20) return;
    wisch.current = { key: oben.key, x0: e.clientX, y0: e.clientY, id: e.pointerId, drag: false, hist: [[e.timeStamp, 0]], x: 0 };
  };
  const randZiehen = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = wisch.current;
    if (!st || e.pointerId !== st.id) return;
    const el = elemente.current.get(st.key);
    const app = appRef.current;
    if (!el || !app) return;
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    if (!st.drag) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        wisch.current = null;
        return;
      }
      if (dx < 8) return;
      st.drag = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      el.getAnimations().forEach((a) => a.cancel());
    }
    const W = app.clientWidth;
    const x = Math.max(0, dx);
    st.x = x;
    el.style.transform = `translateX(${x}px)`;
    const under = unterVon(st.key);
    if (under) {
      under.getAnimations().forEach((a) => a.cancel());
      under.style.transform = `translateX(${-0.24 * W * (1 - x / W)}px)`;
      under.style.opacity = String(0.4 + (0.6 * x) / W);
    }
    st.hist.push([e.timeStamp, x]);
    if (st.hist.length > 5) st.hist.shift();
  };
  const randLos = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = wisch.current;
    if (!st || e.pointerId !== st.id) return;
    wisch.current = null;
    if (!st.drag) return;
    swallowClick.current = true;
    setTimeout(() => {
      swallowClick.current = false;
    }, 60);
    const el = elemente.current.get(st.key);
    const app = appRef.current;
    if (!el || !app) return;
    const [ta, xa] = st.hist[0];
    const [tb, xb] = st.hist[st.hist.length - 1];
    const v = ((xb - xa) / Math.max(1, tb - ta)) * 1000;
    const W = app.clientWidth;
    const projected = st.x + (v * 0.998) / 2;
    const under = unterVon(st.key);
    if (projected > W / 2 && e.type !== "pointercancel") {
      popPage();
    } else if (reduce()) {
      el.style.transform = "translateX(0px)";
      if (under) {
        under.style.transform = `translateX(${-0.24 * W}px)`;
        under.style.opacity = ".4";
      }
    } else {
      moveTo(el, { transform: "translateX(0px)" }, springOpts());
      if (under) moveTo(under, { transform: `translateX(${-0.24 * W}px)`, opacity: ".4" }, springOpts());
    }
  };

  // ── Verlauf vor der Zeile (Prototyp updFade, Z. 1566–1599) ─────────────────

  useEffect(() => {
    let footPx = 0;
    const footSpace = () => {
      if (!footPx) {
        const pr = document.createElement("div");
        pr.style.cssText = "position:absolute;visibility:hidden;height:var(--foot-space)";
        document.body.append(pr);
        footPx = pr.offsetHeight;
        pr.remove();
      }
      return footPx;
    };
    const updFade = (sc: EventTarget | null) => {
      if (!(sc instanceof HTMLElement) || !sc.classList.contains("scroll")) return;
      let fade = sc.scrollHeight - sc.scrollTop - sc.clientHeight > 2;
      if (fade) {
        const r = sc.getBoundingClientRect();
        const foot = footSpace();
        const z1 = r.bottom - foot - 28;
        const z0 = r.bottom - foot;
        fade = ![...sc.querySelectorAll<HTMLElement>(".btn, .foot button, .whbtn")].some((b) => {
          if (!b.offsetParent || getComputedStyle(b).visibility === "hidden") return false;
          const k = b.getBoundingClientRect();
          if (k.height < 40) return false;
          if (!(k.bottom > z1 && k.top < z0)) return false;
          return (Math.min(k.bottom, z0) - k.top) / k.height >= 0.4;
        });
      }
      sc.classList.toggle("fade", fade);
      if (sc.closest(".page")) sc.classList.toggle("fade-t", sc.scrollTop > 2);
    };
    let q = 0;
    const fadeAll = () => {
      if (q) return;
      q = requestAnimationFrame(() => {
        q = 0;
        document.querySelectorAll(".scroll").forEach(updFade);
      });
    };
    const onScroll = (e: Event) => updFade(e.target);
    const onResize = () => {
      footPx = 0;
      fadeAll();
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    const mo = new MutationObserver(fadeAll);
    if (appRef.current) mo.observe(appRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
    fadeAll();
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      mo.disconnect();
      cancelAnimationFrame(q);
    };
  }, []);

  // ── Kaltstart (Prototyp Z. 4670–4686): erst nach den Schriften einblenden ──

  useEffect(() => {
    const html = document.documentElement;
    const stopp = themeColorBeobachten();
    const fertig = () => {
      if (!html.classList.contains("pre")) return;
      if (!reduce()) {
        const els = [
          document.getElementById("whenrow"),
          document.getElementById("h1"),
          ...Array.from(document.querySelectorAll<HTMLElement>("#home .modes > .mode.on > *")),
        ].filter((x): x is HTMLElement => !!x);
        els.forEach((el, i) =>
          el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
            duration: 220,
            delay: 40 + Math.min(i, 3) * 25,
            easing: E.out,
            fill: "backwards",
          }),
        );
      }
      html.classList.remove("pre");
    };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(fertig, fertig);
    return stopp;
  }, []);

  // ── Tastatur: Esc schließt die oberste Ebene (Prototyp Z. 4648–4662) ───────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (zeileRef.current?.istOffen()) zeileRef.current.schliessen();
        else zeileRef.current?.oeffnen();
        return;
      }
      // Eine Ebene über der Shell (der Tisch) hat Escape schon für sich genommen
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (sheetRef.current?.classList.contains("open")) sheetSchliessen();
      else if (zeileRef.current?.istOffen()) zeileRef.current.schliessen();
      else if (obersteEbene()) popPage();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetSchliessen, obersteEbene, popPage]);

  // ── API ─────────────────────────────────────────────────────────────────────

  const registriere = useCallback((name: EbenenName, h: EbenenHandler) => {
    handler.current.set(name, h);
    return () => {
      if (handler.current.get(name) === h) handler.current.delete(name);
    };
  }, []);

  /**
   * TagDaten aus den Server-Props der Startseite. Nach Android-Zurück von
   * einer echten Route (popstate) entsteht die Startseite neu — mit den Props
   * aus dem Router-Cache von „/“, also dem Stand vom letzten Seitenladen.
   * Die dürfen den frischeren Stand aus `neuLaden()` nicht überschreiben:
   * übernommen wird nur, was nicht älter ist (`stand`, Uhr des Servers).
   */
  const merkeTagDaten = useCallback(
    (d: TagDaten) => setTagDaten((alt) => (alt && istAelter(d, alt) ? alt : d)),
    [],
  );

  const api = useMemo<KombiApi>(
    () => ({
      openPage,
      vorladen,
      popPage,
      toast,
      hideToast,
      fehlerToast,
      openSheet,
      closeSheet: () => sheetSchliessen(),
      openCam: (o) => {
        const h = handler.current.get("kamera");
        if (h) h(o);
        else navigiereEcht("/material");
      },
      openTisch: (o) => {
        // Der Lernblock (Abschnitt F) hat seine eigene Ebene auf demselben Tisch;
        // ein Block mit Arbeitsblatt (`blatt: true`, Abschnitt H) die des Blatts
        const block = o?.mode === "block";
        const h =
          (block && o?.blatt === true ? handler.current.get("arbeitsblatt") : undefined) ??
          (block ? handler.current.get("lernblock") : undefined) ??
          handler.current.get("tisch");
        if (h) h(o);
        // Bis der Tisch kommt (F): der Lernblock dorthin, wo man ihn abhakt
        // (Lernplan), das Wiederholen in die Abrufsitzung.
        else navigiereEcht(o?.mode === "block" ? "/lernen" : "/abruf/sitzung");
      },
      setView: (ansicht, o) => {
        const h = handler.current.get("ansicht");
        if (pathname !== "/" || ebenenRef.current.some((e) => e.typ === "route" && !e.geht)) {
          navigiereEcht("/");
        } else if (ebenenRef.current.length) {
          // Stapel zu, wie setView → closeAllPages im Prototyp
          setzeEbenen(() => []);
          animiert.current.clear();
          elemente.current.clear();
          homeRef.current?.getAnimations().forEach((a) => a.cancel());
          if (homeRef.current) {
            homeRef.current.style.transform = "";
            homeRef.current.style.opacity = "";
          }
          pushStapel([], "/");
        }
        h?.({ ansicht, ...o });
        // die Ebene `flow` (Abschnitt C) zeigt oder verbirgt den Ablauf
        handler.current.get("ablauf")?.({ ansicht, ...o });
      },
      openZeile: (kontext) => zeileRef.current?.oeffnen(kontext),
      undoJetzt: () => {
        const t = toastZustand.current;
        if (!t.fn || !t.undo || Date.now() >= t.bis) return null;
        const fn = t.fn;
        return { desc: t.desc, run: () => { hideToast(); fn(); } };
      },
      closeMenu: () => zeileRef.current?.schliessen(),
      tagDaten,
      merkeTagDaten,
      neuLaden,
      registriere,
      ebeneAuf,
      ebeneZu,
    }),
    [openPage, vorladen, popPage, toast, hideToast, fehlerToast, openSheet, sheetSchliessen, navigiereEcht, pathname, setzeEbenen, pushStapel, tagDaten, merkeTagDaten, neuLaden, registriere, ebeneAuf, ebeneZu],
  );

  // Nur mit SCHULAPP_TESTUHR (data-pruefung am <html>): die API für die
  // Playwright-Prüfungen unter scripts/pruef-kombi/.
  useEffect(() => {
    if (document.documentElement.dataset.pruefung !== "1") return;
    (window as unknown as { __kombi?: KombiApi }).__kombi = api;
  }, [api]);

  // Nur die oberste lebende Route-Ebene zeigt die `children` (2.4, Punkt 5)
  const routeMitInhalt = [...ebenen].reverse().find((e) => e.typ === "route" && !e.geht)?.key;

  return (
    <KombiKontext.Provider value={api}>
      <div id="app" ref={appRef}>
        <div className="layer on" id="home" ref={homeRef}>
          {istStart ? children : <Startseite daten={tagDaten} />}
        </div>
        <div className="layer" id="flow">
          <AblaufEbene />
        </div>
        <div
          id="pages"
          onPointerDown={randRunter}
          onPointerMove={randZiehen}
          onPointerUp={randLos}
          onPointerCancel={randLos}
          onClickCapture={(e) => {
            if (swallowClick.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
        >
          {ebenen.map((e) =>
            e.typ === "route" ? (
              <Seite
                key={e.key}
                dataKey={e.key}
                label="Seite"
                onZurueck={popPage}
                elRef={(el) => {
                  if (el) elemente.current.set(e.key, el);
                }}
              >
                {istStart || e.geht || e.key !== routeMitInhalt ? null : children}
              </Seite>
            ) : (
              <Seite
                key={e.key}
                dataKey={e.key}
                label={seitenArt(e.art)?.titel(e.params, e.daten) ?? "Seite"}
                onZurueck={popPage}
                elRef={(el) => {
                  if (el) elemente.current.set(e.key, el);
                }}
              >
                <SeitenInhalt art={e.art} params={e.params} daten={e.daten} ausCache={e.ausCache} ohneNetz={e.ohneNetz} />
              </Seite>
            ),
          )}
        </div>
      </div>

      <Zeile handleRef={zeileRef} onOffen={menuOffen} />

      <div className="toast" id="toast" role="status" ref={toastRef}>
        <span id="toastText" ref={toastTextRef} />
        <button
          type="button"
          id="toastAct"
          ref={toastActRef}
          hidden
          onClick={() => {
            const u = toastZustand.current.fn;
            hideToast();
            u?.();
          }}
        >
          Rückgängig
        </button>
      </div>

      <div className="scrim sheet-scrim" id="sheetScrim" ref={sheetScrimRef} onClick={() => sheetSchliessen()} />
      <section
        className={`sheet${sheet?.aufDemTisch ? " on-table" : ""}`}
        id="sheet"
        aria-label="Blatt"
        role="dialog"
        ref={sheetRef}
      >
        <SheetGriff sheetRef={sheetRef} onSchliessen={() => sheetSchliessen()} />
        <div className="sh-body" id="sheetBody">
          {sheet?.inhalt}
        </div>
      </section>

      <KameraEbene />
      <TischEbene />
      <LernblockTisch />
      <ArbeitsblattTisch />
      <div id="druck" aria-hidden="true" />
    </KombiKontext.Provider>
  );
}

/** Sheet nach unten ziehen (Prototyp Z. 3349–3366). */
function SheetGriff({
  sheetRef,
  onSchliessen,
}: {
  sheetRef: React.RefObject<HTMLElement | null>;
  onSchliessen: () => void;
}) {
  const st = useRef<{ y0: number; dy: number; hist: [number, number][] } | null>(null);
  return (
    <div
      className="grab"
      id="sheetGrab"
      onPointerDown={(e) => {
        st.current = { y0: e.clientY, dy: 0, hist: [[e.timeStamp, e.clientY]] };
        e.currentTarget.setPointerCapture(e.pointerId);
        sheetRef.current?.getAnimations().forEach((a) => a.cancel());
      }}
      onPointerMove={(e) => {
        const s = st.current;
        const sheet = sheetRef.current;
        if (!s || !sheet) return;
        const dy = e.clientY - s.y0;
        const H = sheet.offsetHeight;
        s.dy = dy < 0 ? -((-dy * H * 0.55) / (H + 0.55 * -dy)) : dy;
        sheet.style.transform = `translateY(${s.dy}px)`;
        s.hist.push([e.timeStamp, e.clientY]);
        if (s.hist.length > 5) s.hist.shift();
      }}
      onPointerUp={() => {
        const s = st.current;
        const sheet = sheetRef.current;
        st.current = null;
        if (!s || !sheet) return;
        const [ta, ya] = s.hist[0];
        const [tb, yb] = s.hist[s.hist.length - 1];
        const v = (yb - ya) / Math.max(1, tb - ta);
        if (s.dy > sheet.offsetHeight * 0.28 || v > 0.5) {
          onSchliessen();
          return;
        }
        moveTo(sheet, { transform: "translateY(0px)" }, reduce() ? { duration: 0 } : springOpts());
      }}
    >
      <i />
    </div>
  );
}
