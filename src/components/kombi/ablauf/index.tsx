"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import {
  ablaufEndeAction,
  ablaufSchrittAction,
  abhakenZuruecknehmenAction,
  abschriftErneutAction,
  aufgabeAbhakenAblaufAction,
  aufgabeAendernAblaufAction,
  aufgabeEintragenAblaufAction,
  aufgabeLoeschenAblaufAction,
  aufgabeWiederherstellenAblaufAction,
  eintragenZuruecknehmenAblaufAction,
  fachAendernAction,
} from "@/app/(app)/ablauf-actions";
import { ablaufAusMenuNehmen, ablaufStore, ablaufTagSetzen } from "@/components/kombi/ablauf/ablauf-store";
import { AufgabeZeile } from "@/components/kombi/ablauf/aufgabe";
import { BlattZeile, type BlattAnzeige } from "@/components/kombi/ablauf/blatt-zeile";
import { blattFertig } from "@/components/kombi/ablauf/status-texte";
import {
  ablageEmpfangen,
  blaetterStore,
  haengendeFortsetzen,
  vorLandungMelden,
  type Landung,
} from "@/components/kombi/ablauf/blaetter-store";
import { Icon } from "@/components/kombi/icon";
import { useKombi, type Ansicht } from "@/components/kombi/kontext";
import { warmCamera } from "@/components/kombi/kamera/stream";
import type { EintragSenden } from "@/components/kombi/zeile";
import type { AblaufDaten, AufgabeKurz } from "@/lib/kombi/ablauf";
import { E, buzz, flash, flip, moveTo, reduce, vvStable } from "@/lib/kombi/motion";
import { cap, zahl } from "@/lib/kombi/text";
import { themeColor } from "@/lib/kombi/theme-color";

/**
 * Der Ablauf nach der Schule (Modell 23, Abschnitt C; Prototyp Z. 858–886
 * und 2086–2260): die Ebene `flow` mit dem Schrittband „Blätter“ und
 * „Hausaufgaben“, „Überspringen“ oben rechts.
 *
 * - Schritt 1 „Neue Blätter?“: keine Fächer, ein großer Sucher; die Kamera
 *   wächst aus ihm. Darunter alle Blätter von heute, das neueste oben, erst
 *   „Wird eingeordnet …“, dann Fach und Thema (Jev).
 * - Schritt 2 „Was hast du auf?“: die Fächer von heute, ein Tipp öffnet die
 *   Zeile zum Eintragen; „Schon offen“ und „Erledigt“.
 *
 * Ob der Ablauf heute dran ist, sagt der Server (`GET /api/ablauf`, wie
 * `ansicht()` im Prototyp): Schultag, nach Schulschluss, noch nicht erledigt
 * oder übersprungen. Übersprungen bleibt er über den Vorschlag „Nach der
 * Schule“ in der Zeile erreichbar, dann mit „Schließen“ statt „Überspringen“.
 */

type Schritt = "blaetter" | "ha";
const STEPS: Schritt[] = ["blaetter", "ha"];
const sIdx = (s: Schritt) => STEPS.indexOf(s);
const ORDER: Record<Ansicht, number> = { morgens: 0, ablauf: 1, ueberblick: 2, frueh: 3 };
const OFFEN = new Set(["hochladen", "haengt", "einordnen", "abschrift_laeuft"]);

/** Kam die letzte Antwort von /api/ablauf ohne Netz aus dem Daten-Cache des Service Workers? */
let zuletztAusCache = false;

async function ablaufHolen(): Promise<AblaufDaten | null> {
  try {
    const r = await fetch("/api/ablauf", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as AblaufDaten;
    zuletztAusCache = !!r.headers.get("x-schulapp-aus-cache");
    return d;
  } catch {
    return null;
  }
}

export function AblaufEbene() {
  const kombi = useKombi();
  const { registriere, toast, hideToast, fehlerToast, openPage, openCam, openZeile, setView, neuLaden } = kombi;

  const [daten, setDaten] = useState<AblaufDaten | null>(null);
  const [ausMenu, setAusMenu] = useState(false);
  /** abgelegt, aber noch nicht gelandet (die Kamera schließt gerade) */
  const [versteckt, setVersteckt] = useState<Set<string>>(() => new Set());
  /** optimistische Änderungen an Aufgaben: id → erledigt (ISO|null) oder gelöscht */
  const [aenderung, setAenderung] = useState<Map<string, { done?: string | null; weg?: boolean }>>(() => new Map());
  /** Aufgaben, die nach dem Abhaken noch 350 ms in ihrer Gruppe stehen */
  const [halten, setHalten] = useState<Map<string, boolean>>(() => new Map());
  /** „Fach ändern“ läuft: Thema folgt */
  const [themaFolgt, setThemaFolgt] = useState<Set<string>>(() => new Set());
  const lokal = useSyncExternalStore(blaetterStore.subscribe, blaetterStore.get, () => []);

  const flowRef = useRef<HTMLElement | null>(null);
  const bandRef = useRef<HTMLElement>(null);
  const stepRefs = useRef<Record<Schritt, HTMLElement | null>>({ blaetter: null, ha: null });
  const sucherRef = useRef<HTMLButtonElement>(null);
  const suLabelRef = useRef<HTMLSpanElement>(null);
  const nextBoxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const haScrollRef = useRef<HTMLDivElement>(null);
  const blScrollRef = useRef<HTMLDivElement>(null);

  const z = useRef({
    sichtbar: false,
    schritt: null as Schritt | null,
    view: "ueberblick" as Ansicht,
    live: null as boolean | null,
    stepGen: 0,
    viewGen: 0,
    ausMenu: false,
    hasVorher: null as boolean | null,
    animNext: false,
    waitT: undefined as ReturnType<typeof setTimeout> | undefined,
    gestartet: false,
    daten: null as AblaufDaten | null,
  });

  /** „Keine Verbindung · Erneut“ für den Ablauf ohne Daten (unten gesetzt) */
  const keineVerbindungRef = useRef<() => void>(() => {});

  /** laufende Actions je Aufgabe: ihre optimistische Änderung bleibt, bis die Action fertig ist */
  const laufend = useRef(new Map<string, number>());
  const laufStart = useCallback((id: string) => {
    laufend.current.set(id, (laufend.current.get(id) ?? 0) + 1);
  }, []);
  const laufEnde = useCallback((id: string) => {
    const n = (laufend.current.get(id) ?? 1) - 1;
    if (n > 0) laufend.current.set(id, n);
    else laufend.current.delete(id);
  }, []);
  /**
   * Neue Serverdaten: optimistische Änderungen fallen nur weg, wenn ihre
   * Action fertig ist oder der Server sie schon enthält — sonst spränge eine
   * eben abgehakte Zeile still zurück (2.4 Punkt 9).
   */
  const aenderungAbgleichen = useCallback((server: AufgabeKurz[]) => {
    const byId = new Map(server.map((a) => [a.id, a]));
    setAenderung((m) => {
      if (!m.size) return m;
      const n = new Map<string, { done?: string | null; weg?: boolean }>();
      for (const [id, c] of m) {
        if (!laufend.current.get(id)) continue;
        const s = byId.get(id);
        const schonDa = c.weg ? !s : !!s && "done" in c && !!s.done === !!c.done;
        if (!schonDa) n.set(id, c);
      }
      return n;
    });
  }, []);

  const uebernehmen = useCallback(
    (d: AblaufDaten) => {
      z.current.daten = d;
      ablaufTagSetzen(d.tag);
      blaetterStore.tagSetzen(d.tag);
      setDaten(d);
      aenderungAbgleichen(d.aufgaben);
    },
    [aenderungAbgleichen],
  );

  const laden = useCallback(
    () =>
      ablaufHolen().then((d) => {
        if (d) uebernehmen(d);
        return d;
      }),
    [uebernehmen],
  );

  // ── Schritte (Prototyp goStep/setBand, Z. 2185–2249) ────────────────────────

  const setBand = useCallback((animate: boolean) => {
    const s = z.current.schritt;
    bandRef.current?.querySelectorAll<HTMLElement>(".seg").forEach((seg) => {
      const st = seg.dataset.step as Schritt;
      const war = seg.classList.contains("cur");
      seg.classList.toggle("cur", st === s);
      seg.classList.toggle("done", !!s && sIdx(st) < sIdx(s));
      seg.setAttribute("aria-current", st === s ? "step" : "false");
      if (animate && st === s && !war && !reduce()) {
        seg.querySelector(".seg-fill")?.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 300, easing: E.out });
      }
    });
  }, []);

  const goStep = useCallback(
    (to: Schritt, opts: { instant?: boolean } = {}) => {
      const from = z.current.schritt;
      if (to === from && !opts.instant) return;
      z.current.schritt = to;
      ablaufStore.setzen({ schritt: to });
      if (!opts.instant) void ablaufSchrittAction(to).catch(() => {});
      setBand(!opts.instant);
      const gen = ++z.current.stepGen;
      const flow = flowRef.current;
      const W = flow?.clientWidth || document.getElementById("app")?.clientWidth || 390;
      const el = (s: Schritt) => stepRefs.current[s]!;
      const inEl = el(to);
      STEPS.forEach((s, i) => {
        el(s).style.zIndex = String(i + 1);
      });
      if (from == null || opts.instant) {
        STEPS.forEach((s) => {
          const e = el(s);
          e.getAnimations().forEach((a) => a.cancel());
          const i = sIdx(s);
          const t = sIdx(to);
          e.style.transform = i === t ? "none" : `translateX(${i < t ? -0.24 * W : W}px)`;
          e.style.opacity = i < t ? ".4" : "1";
          e.classList.toggle("vis", s === to);
        });
        const sc = inEl.querySelector<HTMLElement>(".scroll");
        if (sc) sc.scrollTop = 0;
        return;
      }
      hideToast();
      const outEl = el(from);
      const fwd = sIdx(to) > sIdx(from);
      let a: Animation;
      if (reduce()) {
        inEl.getAnimations().forEach((x) => x.cancel());
        inEl.style.transform = "none";
        inEl.style.opacity = "1";
        inEl.style.zIndex = "9";
        inEl.classList.add("vis");
        a = inEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease" });
      } else {
        if (!inEl.classList.contains("vis")) {
          inEl.style.transform = `translateX(${fwd ? W : -0.24 * W}px)`;
          inEl.style.opacity = fwd ? "1" : ".4";
          inEl.classList.add("vis");
        }
        const dur = fwd ? 300 : 260;
        a = moveTo(inEl, { transform: "translateX(0px)", opacity: "1" }, { duration: dur, easing: E.drawer });
        moveTo(outEl, { transform: `translateX(${fwd ? -0.24 * W : W}px)`, opacity: fwd ? ".4" : "1" }, { duration: dur, easing: E.drawer });
      }
      a.finished.then(
        () => {
          if (gen !== z.current.stepGen) return;
          STEPS.forEach((s) => {
            if (s === to) return;
            const e = el(s);
            e.classList.remove("vis");
            const i = sIdx(s);
            const t = sIdx(to);
            e.style.transform = `translateX(${i < t ? -0.24 * W : W}px)`;
            e.style.opacity = i < t ? ".4" : "1";
          });
          inEl.style.zIndex = String(sIdx(to) + 1);
        },
        () => {},
      );
    },
    [hideToast, setBand],
  );

  // ── Ansicht zeigen oder verlassen (Prototyp setView, Z. 1675) ───────────────

  const zeigeAnsicht = useCallback(
    (v: Ansicht, { anim = true, dir }: { anim?: boolean; dir?: number } = {}) => {
      const flow = flowRef.current;
      const home = document.getElementById("home");
      if (!flow || !home) return;
      const fromView = z.current.view;
      const vonAblauf = z.current.sichtbar;
      const zuAblauf = v === "ablauf";
      z.current.view = v;
      if (fromView !== v) hideToast();
      [home, flow].forEach((l) => {
        l.getAnimations({ subtree: true }).forEach((a) => a.cancel());
        l.classList.remove("leaving");
      });
      if (!zuAblauf && vonAblauf) {
        setAusMenu(false);
        z.current.ausMenu = false;
      }
      z.current.sichtbar = zuAblauf;
      ablaufStore.setzen({ sichtbar: zuAblauf });
      const gen = ++z.current.viewGen;
      if (zuAblauf) {
        // prepareAblauf: Schritt vom Server, ohne Bewegung
        goStep(z.current.daten?.schritt ?? "blaetter", { instant: true });
        void laden();
      }
      home.classList.toggle("on", !zuAblauf);
      flow.classList.toggle("on", zuAblauf);
      themeColor("paper");
      if (!anim || vonAblauf === zuAblauf) return;
      const d = dir ?? (ORDER[v] > ORDER[fromView] ? 1 : -1);
      const outEl = vonAblauf ? flow : home;
      outEl.classList.add("leaving");
      const a = outEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
      a.onfinish = () => {
        if (gen !== z.current.viewGen) return;
        outEl.classList.remove("leaving");
        a.cancel();
      };
      let blocks: Element[];
      if (zuAblauf) {
        const sc = stepRefs.current[z.current.schritt ?? "blaetter"]?.querySelector(".scroll");
        blocks = [bandRef.current!, ...(sc ? [...sc.children] : [])];
      } else {
        const modes = home.querySelector(".modes");
        const kids = modes ? [...(modes.querySelector(".mode.on")?.children ?? modes.children)] : [];
        blocks = [home.querySelector("#whenrow"), home.querySelector("#h1"), ...kids].filter((x): x is Element => !!x);
      }
      if (reduce()) {
        (zuAblauf ? flow : home).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
        return;
      }
      blocks.forEach((el, i) =>
        el.animate([{ opacity: 0, transform: `translateX(${d * 24}px)` }, { opacity: 1, transform: "none" }], {
          duration: 260,
          delay: Math.min(i, 5) * 30,
          easing: E.out,
          fill: "backwards",
        }),
      );
    },
    [goStep, hideToast, laden],
  );

  useEffect(
    () =>
      registriere("ablauf", (o) => {
        const { ansicht, anim, dir } = (o ?? {}) as { ansicht?: Ansicht; anim?: boolean; dir?: number };
        if (!ansicht) return;
        if (ansicht === "ablauf") {
          const am = ablaufAusMenuNehmen();
          setAusMenu(am);
          z.current.ausMenu = am;
        }
        zeigeAnsicht(ansicht, { anim, dir });
      }),
    [registriere, zeigeAnsicht],
  );

  // ── Start: Ansicht vom Server; Rückkehr aus dem Hintergrund ─────────────────

  useEffect(() => {
    flowRef.current = bandRef.current?.closest<HTMLElement>("#flow") ?? null;
    let weg = false;
    // Aufnahmen, die beim letzten Mal hängen blieben (Neuladen, von Android beendet), gehen weiter
    void haengendeFortsetzen((text) => toast(text));
    void laden().then((d) => {
      if (weg) return;
      if (!d) {
        // Ohne Netz und ohne gecachte Fassung: „Keine Verbindung · Erneut“,
        // sobald der Ablauf zu sehen ist; das Netz zurück lädt von selbst nach
        setTimeout(() => {
          if (!weg && !z.current.daten && z.current.sichtbar) keineVerbindungRef.current();
        }, 0);
        return;
      }
      z.current.live = d.ansichtAblauf;
      // Eine Fassung aus dem Cache kann von einer anderen Tageszeit stammen:
      // ob der Ablauf dran ist, sagen dann die Tagesdaten der Startseite
      if (zuletztAusCache) return;
      // Nur ein echter Stapel hält den Ablauf auf; ein Overlay (Menü, Kamera)
      // aus der Zeit vor dem Neuladen nicht (Kriterium 11).
      const state = window.history.state as { stapel?: unknown[] } | null;
      const stapelLeer = !state?.stapel?.length;
      if (d.ansichtAblauf && window.location.pathname === "/" && stapelLeer && !z.current.gestartet) {
        z.current.gestartet = true;
        setView("ablauf", { anim: false });
      }
    });
    return () => {
      weg = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) return;
      void laden().then((d) => {
        if (!d) return;
        const alt = z.current.live;
        z.current.live = d.ansichtAblauf;
        if (document.body.classList.contains("cam-offen") || document.querySelector(".tisch.open")) return;
        // nur beim Zurückkommen, nie während der Bildschirm sichtbar ist (V2 3.2)
        if (d.ansichtAblauf && alt === false && !z.current.sichtbar && window.location.pathname === "/") setView("ablauf");
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [laden, setView]);

  // ── Ohne Netz: nachladen, sobald es zurück ist (auch nach Kaltstart offline) ──

  useEffect(() => {
    keineVerbindungRef.current = () =>
      fehlerToast(
        "Keine Verbindung",
        () =>
          void laden().then((d) => {
            if (!d && z.current.sichtbar) keineVerbindungRef.current();
          }),
        "Erneut",
      );
  }, [fehlerToast, laden]);

  useEffect(() => {
    const online = () => void laden();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [laden]);

  /*
   * Die Startseite wechselt beim Kaltstart selbst in den Ablauf (TagDaten
   * sagen „ablauf“), ohne über die Shell zu gehen — etwa ohne Netz, wenn
   * /api/ablauf nicht antwortet und der Weg oben nie `setView` ruft. Dann
   * richtet sich die Ebene hier nachträglich ein: Schritt sichtbar, Daten
   * holen. Kommt der Wechsel über die Shell, hat ihr Handler das im selben
   * Takt schon getan, und hier geschieht nichts.
   */
  useEffect(() => {
    const nachziehen = (v: Ansicht) => {
      const an = !!flowRef.current?.classList.contains("on");
      if (v === "ablauf" && an && (!z.current.sichtbar || z.current.schritt == null)) {
        zeigeAnsicht("ablauf", { anim: false });
        if (!z.current.daten)
          void laden().then((d) => {
            if (!d && z.current.sichtbar) keineVerbindungRef.current();
          });
      } else if (v !== "ablauf" && !an && z.current.sichtbar) {
        z.current.view = v;
        z.current.sichtbar = false;
        z.current.ausMenu = false;
        setAusMenu(false);
        ablaufStore.setzen({ sichtbar: false });
      }
    };
    const onAnsicht = (e: Event) => {
      const v = (e as CustomEvent<{ ansicht?: Ansicht }>).detail?.ansicht;
      if (v) setTimeout(() => nachziehen(v), 0);
    };
    window.addEventListener("kombi:ansicht", onAnsicht);
    // Die Startseite malt vor dieser Ebene: ihr Wechsel beim Kaltstart kann
    // schon vor diesem Hörer geschehen sein
    const t = setTimeout(() => {
      if (flowRef.current?.classList.contains("on")) nachziehen("ablauf");
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("kombi:ansicht", onAnsicht);
    };
  }, [zeigeAnsicht, laden]);

  // Nach einer Action anderswo (Zeile, Seite): neu holen
  const tagStand = kombi.tagDaten?.stand;
  useEffect(() => {
    if (tagStand && z.current.sichtbar) void laden();
  }, [tagStand, laden]);

  // Vorschläge der Zeile
  useEffect(() => {
    ablaufStore.setzen({
      nachDerSchule: !!daten && daten.schultag && daten.nachSchluss && daten.stand === "übersprungen",
    });
  }, [daten]);

  // ── Blätter: Anzeige aus Server und Browser ─────────────────────────────────

  const datenTag = daten?.tag ?? null;
  const anzeige = useMemo((): BlattAnzeige[] => {
    const server = daten?.blaetter ?? [];
    const byId = new Map(server.map((b) => [b.id, b]));
    const benutzt = new Set<string>();
    const out: (BlattAnzeige & { order: number })[] = [];
    for (const l of lokal) {
      if (datenTag && l.tag && l.tag !== datenTag) continue;
      if (versteckt.has(l.key)) {
        // Auch versteckt gehört der Server-Eintrag zu diesem Blatt: er darf
        // nicht vor der Landung als eigene Zeile erscheinen.
        if (l.id) benutzt.add(l.id);
        continue;
      }
      const s = (l.id && byId.get(l.id)) || l.kurz;
      if (l.id) benutzt.add(l.id);
      if (s) {
        out.push({
          key: l.key,
          id: s.id,
          status: l.lokal ?? s.status,
          fach: s.fach,
          titel: s.titel,
          thema: (themaFolgt.has(s.id) || s.themaFolgt) && !s.themen.length ? "Thema folgt" : (s.themen[0] ?? ""),
          seiten: Math.max(s.seiten, l.seiten),
          bild: l.bild || s.vorschau,
          order: l.order,
        });
      } else {
        out.push({ key: l.key, id: null, status: l.lokal ?? "hochladen", fach: null, titel: "", thema: "", seiten: l.seiten, bild: l.bild, order: l.order });
      }
    }
    for (const s of server) {
      if (benutzt.has(s.id)) continue;
      out.push({
        key: s.id,
        id: s.id,
        status: s.status,
        fach: s.fach,
        titel: s.titel,
        thema: (themaFolgt.has(s.id) || s.themaFolgt) && !s.themen.length ? "Thema folgt" : (s.themen[0] ?? ""),
        seiten: s.seiten,
        bild: blaetterStore.bildVon(s.id) ?? s.vorschau,
        order: Date.parse(s.erstellt),
      });
    }
    return out.sort((a, b) => b.order - a.order);
  }, [daten?.blaetter, datenTag, lokal, versteckt, themaFolgt]);

  const has = anzeige.length > 0;

  // Nach jedem Upload: Liste neu holen
  const fertigeUploads = lokal.filter((l) => l.id && !l.lokal).map((l) => l.key).join(",");
  useEffect(() => {
    if (!fertigeUploads) return;
    void laden();
    void neuLaden();
  }, [fertigeUploads, laden, neuLaden]);

  // Solange ein Blatt nicht fertig ist: alle 2 s nach dem Stand fragen (Plan 3.8)
  // nur Blätter, die der Server für heute kennt — sonst liefe die Abfrage ohne Ende
  const serverIds = useMemo(() => new Set((daten?.blaetter ?? []).map((b) => b.id)), [daten?.blaetter]);
  const themaWartet = (daten?.blaetter ?? []).some((b) => b.themaFolgt);
  const offen =
    themaWartet || anzeige.some((b) => OFFEN.has(b.status) && !!b.id && serverIds.has(b.id) && !blattFertig(b.status));
  useEffect(() => {
    if (!offen) return;
    let stand: string | null = null;
    let weg = false;
    const tick = async () => {
      if (weg) return;
      if (!document.hidden) {
        try {
          if (z.current.daten?.blaetter.some((b) => b.themaFolgt)) {
            // Jev bestimmt nach „Fach ändern“ die Themen: direkt über /api/ablauf nachfragen
            await laden();
          } else {
            const r = await fetch("/api/material/stand", { cache: "no-store" });
            const j = (await r.json()) as { stand?: string };
            if (j.stand && stand !== null && j.stand !== stand) await laden();
            if (j.stand) stand = j.stand;
          }
        } catch {
          // ohne Netz: der nächste Takt
        }
      }
      if (!weg) t = setTimeout(tick, 2000);
    };
    let t = setTimeout(tick, 2000);
    return () => {
      weg = true;
      clearTimeout(t);
    };
  }, [offen, laden]);

  // updateBlNext (Prototyp Z. 2119): nach dem ersten Blatt wandert das Gewicht zum Weitergehen
  useLayoutEffect(() => {
    const box = nextBoxRef.current;
    const su = sucherRef.current;
    const label = suLabelRef.current;
    if (!box || !su || !label) return;
    const animate = z.current.animNext && z.current.hasVorher !== null;
    z.current.animNext = false;
    z.current.hasVorher = has;
    if (has && box.classList.contains("wait")) {
      clearTimeout(z.current.waitT);
      box.classList.remove("wait");
    }
    if (box.classList.contains("has") !== has) {
      if (!animate || reduce()) {
        const kids = [...box.children] as HTMLElement[];
        kids.forEach((x) => (x.style.transition = "none"));
        box.classList.toggle("has", has);
        void box.offsetWidth;
        kids.forEach((x) => (x.style.transition = ""));
      } else box.classList.toggle("has", has);
    }
    const text = has ? "Noch ein Blatt" : "Fotografieren";
    if (su.classList.contains("compact") !== has) {
      const h0 = su.offsetHeight;
      su.classList.toggle("compact", has);
      label.textContent = text;
      if (animate && !reduce() && su.offsetParent) {
        su.animate([{ transform: `scaleY(${h0 / su.offsetHeight})` }, { transform: "none" }], { duration: 300, easing: E.out });
        [...su.children].forEach((c) =>
          c.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: 300, easing: "ease-out" }),
        );
        su.style.transformOrigin = "50% 0";
      }
    } else if (label.textContent !== text) {
      if (reduce() || !animate) label.textContent = text;
      else {
        label.classList.add("swap");
        setTimeout(() => {
          label.textContent = text;
          label.classList.remove("swap");
        }, 160);
      }
    }
    su.setAttribute("aria-label", has ? "Noch ein Blatt fotografieren" : "Fotografieren");
  }, [has]);

  // Vor der Landung: der Sucher ist schon flach, „Weiter“ wartet (Prototyp Z. 3595–3602)
  useEffect(
    () =>
      vorLandungMelden((ausSucher) => {
        const su = sucherRef.current;
        const box = nextBoxRef.current;
        if (su && ausSucher && !su.classList.contains("compact")) {
          su.classList.add("compact");
          if (suLabelRef.current) suLabelRef.current.textContent = "Noch ein Blatt";
          su.setAttribute("aria-label", "Noch ein Blatt fotografieren");
        }
        if (box) {
          box.classList.add("wait");
          clearTimeout(z.current.waitT);
          z.current.waitT = setTimeout(() => box.classList.remove("wait"), 1600);
        }
        // die neuen Zeilen erst mit der Landung
        setVersteckt(new Set(blaetterStore.get().filter((b) => !b.id && b.lokal === "hochladen").map((b) => b.key)));
      }),
    [],
  );

  // Landung (Prototyp landSheets/flyThumb, Z. 3710–3758)
  const flyThumb = useCallback((target: HTMLElement | null, bild: string | null, from: DOMRect | null, after: () => void, keepVisible = false) => {
    if (reduce() || !target || !from) {
      after();
      return;
    }
    const tr = target.getBoundingClientRect();
    const g = document.createElement("div");
    g.className = "fly";
    g.style.cssText = `left:${tr.left}px;top:${tr.top}px;width:${tr.width}px;height:${tr.height}px;${bild ? `background-image:url("${bild}");` : ""}background-position:center top`;
    document.body.append(g);
    if (!keepVisible) target.style.visibility = "hidden";
    g.animate(
      [
        { transform: `translate(${from.left - tr.left}px,${from.top - tr.top}px) scale(${from.width / tr.width},${from.height / tr.height}) rotate(-2.2deg)` },
        { transform: "none" },
      ],
      { duration: 520, easing: E.drawer },
    ).finished.then(
      () => {
        g.remove();
        target.style.visibility = "";
        after();
      },
      () => {
        g.remove();
        target.style.visibility = "";
      },
    );
  }, []);

  useEffect(
    () =>
      ablageEmpfangen((l: Landung) => {
        const onBl = z.current.sichtbar && z.current.schritt === "blaetter" && !document.querySelector("#pages > .page");
        const zeigen = () => setVersteckt(new Set());
        l.dazu.forEach(({ id, from }) => {
          const el = listRef.current?.querySelector<HTMLElement>(`.sheet-item[data-bid="${id}"]`);
          if (el && onBl) flyThumb(el.querySelector(".thumb .pg:not(.under)"), blaetterStore.bildVon(id), from, () => flash(el), true);
        });
        if (!l.neu.length) {
          zeigen();
          if (l.dazu.length && !onBl) void l.dazuOk.then((ok) => ok && toast("Seite dazugelegt"));
          return l.dazu.length > 0;
        }
        if (!onBl && l.ziel !== "liste") {
          zeigen();
          return false;
        }
        if (!onBl) {
          z.current.animNext = false;
          flushSync(zeigen);
          const n = l.neu.length;
          const k0 = l.neu[0].key;
          toast(n === 1 ? "Blatt abgelegt" : `${cap(zahl(n, "n"))} Blätter abgelegt`, () => {
            const id = blaetterStore.get().find((x) => x.key === k0)?.id;
            if (id) openPage("blatt", { id });
          }, undefined, "Ansehen");
          return true;
        }
        const scroll = blScrollRef.current;
        z.current.animNext = true;
        // die neuen Zeilen stehen sofort da, nur die Miniatur fliegt ein (Prototyp Z. 3721 `_noFade`)
        const neuKeys = new Set(l.neu.map(({ key }) => key));
        if (scroll)
          flip(scroll, () => flushSync(zeigen), {
            ohneEinblenden: (x) => x.classList.contains("sheet-item") && neuKeys.has(x.dataset.k ?? ""),
          });
        else flushSync(zeigen);
        const els = l.neu.map(({ key }) => listRef.current?.querySelector<HTMLElement>(`.sheet-item[data-k="${key}"]`) ?? null);
        if (!reduce()) {
          els.forEach((el) =>
            el?.querySelector(".sheet-st")?.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
              duration: 220,
              delay: 200,
              easing: E.out,
              fill: "backwards",
            }),
          );
        }
        els.forEach((el, i) =>
          setTimeout(() => {
            if (!el) return;
            const bild = blaetterStore.get().find((x) => x.key === l.neu[i].key)?.bild ?? null;
            flyThumb(el.querySelector<HTMLElement>(".thumb .pg:not(.under)") ?? el.querySelector<HTMLElement>(".thumb"), bild, l.neu[i].from, () => flash(el));
          }, i * 50),
        );
        return true;
      }),
    [flyThumb, openPage, toast],
  );

  // ── Ende des Ablaufs (Prototyp ablaufEnde, Z. 2254) ─────────────────────────

  const ablaufEnde = useCallback(
    (typ: "ablauf_beendet" | "ablauf_uebersprungen") => {
      const am = z.current.ausMenu;
      void ablaufEndeAction(typ, am).then(
        (r) => {
          z.current.live = false;
          setDaten((d) => (d ? { ...d, stand: r.stand, ansichtAblauf: false } : d));
        },
        () => {},
      );
      setView("ueberblick", { dir: 1 });
    },
    [setView],
  );

  // ── Blätter: Aktionen ───────────────────────────────────────────────────────

  const oeffneKamera = useCallback(() => openCam({ ziel: { kind: "liste" }, origin: sucherRef.current }), [openCam]);

  const blattOeffnen = useCallback(
    (b: BlattAnzeige) => {
      if (!b.id) return;
      // Auch ein Blatt im Eingangskorb öffnet seine Blattseite: /material/eingang/[id]
      // erwartet eine Vorschlags-ID, die es hier nicht gibt (sonst „Hier ist
      // nichts“). Die Blattseite führt mit „Vorschlag anlegen“ weiter.
      openPage("blatt", { id: b.id });
    },
    [openPage],
  );

  const fachAendern = useCallback(
    (b: BlattAnzeige, fachId: string) => {
      if (!b.id || !daten) return;
      const id = b.id;
      const f = daten.alleFaecher.find((x) => x.id === fachId);
      const vorher = daten;
      // sofort: neues Fach, Thema folgt
      setDaten((d) =>
        d ? { ...d, blaetter: d.blaetter.map((x) => (x.id === id ? { ...x, fach: f ?? x.fach, themen: [] } : x)) } : d,
      );
      // bis der Server antwortet; danach sagt er selbst, ob Jev noch läuft (BlattKurz.themaFolgt)
      setThemaFolgt((s) => new Set(s).add(id));
      const ohneFolgt = () =>
        setThemaFolgt((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      if (f) toast(`Nach ${f.name} verschoben`);
      const lauf = () =>
        fachAendernAction(id, fachId).then(
          (kurz) => {
            if (kurz) setDaten((d) => (d ? { ...d, blaetter: d.blaetter.map((x) => (x.id === id ? kurz : x)) } : d));
            ohneFolgt();
            void laden();
          },
          () => {
            ohneFolgt();
            fehlerToast("Nicht gespeichert", lauf, "Erneut");
            setTimeout(() => setDaten(vorher), 320);
          },
        );
      void lauf();
    },
    [daten, fehlerToast, laden, toast],
  );

  const erneutRef = useRef<(b: BlattAnzeige) => void>(() => {});
  const erneut = useCallback(
    (b: BlattAnzeige) => {
      if (!b.id) return;
      const id = b.id;
      setDaten((d) => (d ? { ...d, blaetter: d.blaetter.map((x) => (x.id === id ? { ...x, status: "abschrift_laeuft" } : x)) } : d));
      void abschriftErneutAction(id).then(
        (kurz) => {
          if (kurz) setDaten((d) => (d ? { ...d, blaetter: d.blaetter.map((x) => (x.id === id ? kurz : x)) } : d));
        },
        () => fehlerToast("Keine Verbindung", () => erneutRef.current(b), "Erneut"),
      );
    },
    [fehlerToast],
  );

  useEffect(() => {
    erneutRef.current = erneut;
  }, [erneut]);

  // ── Hausaufgaben ────────────────────────────────────────────────────────────

  const aufgaben = useMemo(() => {
    const liste = (daten?.aufgaben ?? [])
      .filter((a) => !aenderung.get(a.id)?.weg)
      .map((a) => {
        const c = aenderung.get(a.id);
        return c && "done" in c ? { ...a, done: c.done ?? null } : a;
      });
    return liste;
  }, [daten?.aufgaben, aenderung]);

  const tag = daten?.tag ?? "";
  const eingetragen = useMemo(() => new Set(daten?.eingetragen ?? []), [daten?.eingetragen]);
  const heuteFaecher = daten?.faecher ?? [];
  const doneToday = (a: AufgabeKurz) => {
    if (!a.done) return false;
    const t = new Date(Date.parse(a.done) - 4 * 3600_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    return t === tag;
  };
  const istDone = (a: AufgabeKurz) => (halten.has(a.id) ? halten.get(a.id)! : !!a.done);
  const offenListe = aufgaben
    .filter((a) => !istDone(a) && !eingetragen.has(a.id))
    // nach Fälligkeit; bei gleichem Tag in der Reihenfolge des Eintragens
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.erstellt < b.erstellt ? -1 : a.erstellt > b.erstellt ? 1 : 0));
  const erlListe = aufgaben
    .filter((a) => (halten.has(a.id) ? halten.get(a.id)! : doneToday(a)) && !eingetragen.has(a.id))
    .sort((a, b) => Date.parse(a.done ?? "0") - Date.parse(b.done ?? "0"));
  const unterFach = (fid: string | null) =>
    aufgaben.filter((a) => eingetragen.has(a.id) && (fid ? a.fachId === fid : !heuteFaecher.some((f) => f.id === a.fachId)));

  const umsortieren = useCallback((f: () => void) => {
    const sc = haScrollRef.current;
    if (sc && z.current.sichtbar && z.current.schritt === "ha") flip(sc, () => flushSync(f), { duration: 340, easing: E.io });
    else f();
  }, []);

  const abhaken = useCallback(
    (a: AufgabeKurz, erledigt: boolean) => {
      if (!!a.done === erledigt) return;
      const neu = erledigt ? new Date().toISOString() : null;
      setAenderung((m) => new Map(m).set(a.id, { done: neu }));
      // die Zeile bleibt 350 ms in ihrer Gruppe stehen
      setHalten((m) => new Map(m).set(a.id, !!a.done));
      if (erledigt) buzz();
      setTimeout(
        () =>
          umsortieren(() =>
            setHalten((m) => {
              const n = new Map(m);
              n.delete(a.id);
              return n;
            }),
          ),
        erledigt ? 350 : 200,
      );
      const lauf = () => {
        laufStart(a.id);
        return aufgabeAbhakenAblaufAction(a.id, erledigt).then(
          ({ protokollId }) => {
            laufEnde(a.id);
            void neuLaden();
            if (erledigt) {
              toast(
                `${a.kurz} abgehakt`,
                () => {
                  setAenderung((m) => new Map(m).set(a.id, { done: a.done }));
                  laufStart(a.id);
                  void abhakenZuruecknehmenAction(a.id, false, protokollId).then(
                    () => {
                      laufEnde(a.id);
                      void laden();
                    },
                    () => laufEnde(a.id),
                  );
                },
                `${a.kurz}, ${a.text}`,
              );
            }
          },
          () => {
            laufEnde(a.id);
            fehlerToast("Nicht gespeichert", lauf, "Erneut");
            setTimeout(() => setAenderung((m) => new Map(m).set(a.id, { done: a.done })), 320);
          },
        );
      };
      if (!erledigt) hideToast();
      void lauf();
    },
    [fehlerToast, hideToast, laden, laufEnde, laufStart, neuLaden, toast, umsortieren],
  );

  const loeschen = useCallback(
    (a: AufgabeKurz) => {
      umsortieren(() => setAenderung((m) => new Map(m).set(a.id, { weg: true })));
      const lauf = () => {
        laufStart(a.id);
        return aufgabeLoeschenAblaufAction(a.id).then(
          (r) => {
            laufEnde(a.id);
            void neuLaden();
            if (!r) return;
            toast(
              "Gelöscht",
              () => {
                umsortieren(() =>
                  setAenderung((m) => {
                    const n = new Map(m);
                    n.delete(a.id);
                    return n;
                  }),
                );
                void aufgabeWiederherstellenAblaufAction(r.zeile, r.protokollId).then(() => void laden());
              },
              a.text,
            );
          },
          () => {
            laufEnde(a.id);
            fehlerToast("Nicht gespeichert", lauf, "Erneut");
            setTimeout(
              () =>
                setAenderung((m) => {
                  const n = new Map(m);
                  n.delete(a.id);
                  return n;
                }),
              320,
            );
          },
        );
      };
      void lauf();
    },
    [fehlerToast, laden, laufEnde, laufStart, neuLaden, toast, umsortieren],
  );

  // ── Eintragen und Ändern über die Zeile (Kriterium 22; Prototyp doEintragen/placeNewTask, Z. 2922–2975) ──

  /** Geistflug: der Satz löst sich aus dem Feld und landet an seiner Zeile (13.3 Nr. 23) */
  const geistflug = useCallback(async (id: string, satz: string, fr: DOMRect | null) => {
    await vvStable();
    const row = haScrollRef.current?.querySelector<HTMLElement>(`#haSubjects .task[data-id="${id}"]`);
    if (!row) return;
    const front = row.querySelector<HTMLElement>(".t-front") ?? row;
    const tEl = row.querySelector<HTMLElement>(".t-txt");
    if (reduce() || !fr || !tEl || !z.current.sichtbar || z.current.schritt !== "ha") {
      row.style.visibility = "";
      flash(front);
      return;
    }
    const tr = tEl.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.style.cssText = `position:fixed;z-index:80;left:${tr.left}px;top:${tr.top}px;font-size:17px;line-height:1.4;color:var(--ink);pointer-events:none;white-space:nowrap`;
    ghost.textContent = satz;
    document.body.append(ghost);
    row.style.visibility = "hidden";
    const gr = ghost.getBoundingClientRect();
    const dx = fr.left + 4 - gr.left;
    const dy = fr.top + (fr.height - gr.height) / 2 - gr.top;
    ghost
      .animate([{ transform: `translate(${dx}px,${dy}px)`, opacity: 0.4 }, { transform: "none", opacity: 1 }], { duration: 360, easing: E.drawer })
      .finished.then(
        () => {
          ghost.remove();
          row.style.visibility = "";
          flash(front);
        },
        () => {
          ghost.remove();
          row.style.visibility = "";
        },
      );
  }, []);

  const senden = useCallback(
    (e: EintragSenden) => {
      const eingabe = { subjectId: e.fachId, title: e.text, dueDate: e.due };
      if (e.intent === "aendern" && e.id) {
        const aid = e.id;
        const alt = z.current.daten?.aufgaben.find((x) => x.id === aid);
        const lauf = () =>
          aufgabeAendernAblaufAction(aid, eingabe).then(
            () => {
              void laden();
              void neuLaden();
              if (alt) {
                toast(
                  "Geändert",
                  () =>
                    void aufgabeAendernAblaufAction(aid, { subjectId: alt.fachId, title: alt.text, dueDate: alt.due }).then(() => {
                      void laden();
                      void neuLaden();
                    }),
                  e.text,
                );
              }
            },
            () => fehlerToast("Nicht gespeichert", lauf, "Erneut"),
          );
        void lauf();
        return;
      }
      const lauf = () =>
        aufgabeEintragenAblaufAction(eingabe).then(
          async ({ id: neu, protokollId }) => {
            const d = await ablaufHolen();
            if (d) {
              const sc = haScrollRef.current;
              const aufHA = z.current.sichtbar && z.current.schritt === "ha" && !document.querySelector("#pages > .page");
              // die Zeilen darunter rücken per FLIP (13.3 Nr. 24); die neue steht unsichtbar, bis der Satz landet
              if (sc && aufHA && !reduce()) flip(sc, () => flushSync(() => uebernehmen(d)), {
                  duration: 280,
                  easing: E.out,
                  // Ziel des Geistflugs: steht verborgen, bis der Satz landet (Prototyp Z. 2951 `_noFade`)
                  ohneEinblenden: (x) => x.classList.contains("task") && x.dataset.id === neu,
                });
              else flushSync(() => uebernehmen(d));
              void geistflug(neu, e.text, aufHA ? e.from : null);
            }
            void neuLaden();
            toast(
              "Eingetragen",
              () => {
                umsortieren(() => setAenderung((m) => new Map(m).set(neu, { weg: true })));
                laufStart(neu);
                void eintragenZuruecknehmenAblaufAction(neu, protokollId).then(
                  () => {
                    laufEnde(neu);
                    void laden();
                    void neuLaden();
                  },
                  () => laufEnde(neu),
                );
              },
              e.text,
            );
          },
          () => fehlerToast("Nicht gespeichert", lauf, "Erneut"),
        );
      void lauf();
    },
    [fehlerToast, geistflug, laden, laufEnde, laufStart, neuLaden, toast, uebernehmen, umsortieren],
  );

  /** Was die Zeile zum Eintragen braucht: Fächer mit nächster Stunde, der App-Tag, und wohin sie absendet */
  const zeileKontext = useCallback(
    (k: { intent: "eintragen" | "aendern"; fach: string | null; due: string | null; dueAuto?: boolean; fachPills?: boolean; id?: string; text?: string }) => {
      const d = z.current.daten;
      const faecher = (d?.alleFaecher ?? []).map((f) => ({ id: f.id, name: f.name, kurz: f.kurz, naechste: f.naechste }));
      openZeile({ ...k, from: "ha", heute: d?.tag ?? "", faecher, senden });
    },
    [openZeile, senden],
  );

  const bearbeiten = useCallback(
    (a: AufgabeKurz) => zeileKontext({ intent: "aendern", id: a.id, text: a.text, fach: a.fachId, due: a.due, dueAuto: false }),
    [zeileKontext],
  );

  const skipLabel = ausMenu ? "Schließen" : "Überspringen";

  return (
    <>
      <div className="plate" aria-hidden="true" />
      <nav
        className="band"
        id="band"
        aria-label="Schritte"
        ref={bandRef}
        onClick={(e) => {
          const seg = (e.target as HTMLElement).closest<HTMLElement>(".seg");
          if (seg) goStep(seg.dataset.step as Schritt);
        }}
      >
        <button className="seg" data-step="blaetter" type="button">
          <span className="seg-track">
            <span className="seg-fill" />
          </span>
          <span className="seg-label">Blätter</span>
        </button>
        <button className="seg" data-step="ha" type="button">
          <span className="seg-track">
            <span className="seg-fill" />
          </span>
          <span className="seg-label">Hausaufgaben</span>
        </button>
        <button
          className="skip"
          id="skipBtn"
          type="button"
          onClick={() => {
            if (z.current.ausMenu) setView("ueberblick", { dir: 1 });
            else ablaufEnde("ablauf_uebersprungen");
          }}
        >
          {skipLabel}
        </button>
      </nav>
      <div className="steps">
        <section
          className="step"
          id="s-blaetter"
          data-step="blaetter"
          aria-label="Neue Blätter?"
          ref={(el) => {
            stepRefs.current.blaetter = el;
          }}
        >
          <div className="scroll" ref={blScrollRef}>
            <h1 className="q">Neue Blätter?</h1>
            <p className="q-sub">Ein Foto je Blatt. Fach und Thema erkennt die App.</p>
            <button
              className="sucher"
              type="button"
              id="blShoot"
              aria-label="Fotografieren"
              ref={sucherRef}
              onPointerDown={() => void warmCamera()}
              onClick={oeffneKamera}
            >
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              <span className="su-mid" aria-hidden="true">
                <span className="su-ring">
                  <i />
                </span>
                <Icon name="camera" className="su-cam" />
                <span className="su-label btn-label" id="blShootLabel" ref={suLabelRef}>
                  Fotografieren
                </span>
              </span>
            </button>
            <div className="bl-list" id="blTop" aria-label="Abgelegte Blätter" ref={listRef}>
              {anzeige.map((b) => (
                <BlattZeile
                  key={b.key}
                  b={b}
                  alleFaecher={daten?.alleFaecher ?? []}
                  onOeffnen={blattOeffnen}
                  onWarm={() => void warmCamera()}
                  onSeiteDazu={(x) =>
                    x.id &&
                    openCam({
                      ziel: { kind: "liste" },
                      attach: { id: x.id, seiten: x.seiten, bild: x.bild },
                      origin: sucherRef.current,
                    })
                  }
                  onFach={fachAendern}
                  onErneut={erneut}
                />
              ))}
            </div>
            <div className="foot">
              <div className="bl-next" id="blNextBox" ref={nextBoxRef}>
                <button className="textbtn skipnext" type="button" id="blSkipNext" tabIndex={has ? -1 : 0} onClick={() => goStep("ha")}>
                  Keine Blätter, weiter
                </button>
                <button className="btn primary" type="button" id="blNext" tabIndex={has ? 0 : -1} onClick={() => goStep("ha")}>
                  Weiter zu Hausaufgaben
                </button>
              </div>
            </div>
          </div>
        </section>
        <section
          className="step"
          id="s-ha"
          data-step="ha"
          aria-label="Was hast du auf?"
          ref={(el) => {
            stepRefs.current.ha = el;
          }}
        >
          <div className="scroll" ref={haScrollRef}>
            <h1 className="q">Was hast du auf?</h1>
            <div id="haSubjects">
              {[...heuteFaecher, null].map((f) => {
                const items = unterFach(f?.id ?? null);
                return (
                  <div className="subj" data-fach={f?.id ?? "andere"} key={f?.id ?? "andere"}>
                    <button
                      className="subj-head"
                      type="button"
                      aria-label={f ? `Aufgabe in ${f.name} eintragen` : "Aufgabe in anderem Fach eintragen"}
                      onClick={() =>
                        zeileKontext(
                          f
                            ? { intent: "eintragen", fach: f.id, due: f.naechste, dueAuto: true }
                            : { intent: "eintragen", fach: null, due: null, fachPills: true },
                        )
                      }
                    >
                      <span className="subj-name">
                        <b>{f ? f.name : "Anderes Fach"}</b>
                        {f?.sub ? <span>{f.sub}</span> : null}
                      </span>
                      <Icon name="add" />
                    </button>
                    <div className="items">
                      {items.map((a) => (
                        <AufgabeZeile
                          key={a.id}
                          a={a}
                          mode={f ? "subj" : "ab"}
                          heute={tag}
                          festerSub
                          onAbhaken={abhaken}
                          onLoeschen={loeschen}
                          onBearbeiten={bearbeiten}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="group" id="haOffenG" hidden={!offenListe.length}>
              <h2 className="lab">Schon offen</h2>
              <div id="haOffen">
                {offenListe.map((a) => (
                  <AufgabeZeile key={a.id} a={a} mode="ab" heute={tag} festerSub onAbhaken={abhaken} onLoeschen={loeschen} onBearbeiten={bearbeiten} />
                ))}
              </div>
            </div>
            <div className="group" id="haErlG" hidden={!erlListe.length}>
              <h2 className="lab">Erledigt</h2>
              <div id="haErl">
                {erlListe.map((a) => (
                  <AufgabeZeile key={a.id} a={a} mode="ab" heute={tag} onAbhaken={abhaken} onLoeschen={loeschen} onBearbeiten={bearbeiten} />
                ))}
              </div>
            </div>
            <div className="foot">
              <button className="round" type="button" id="haBack" aria-label="Zurück zu Blätter" onClick={() => goStep("blaetter")}>
                <Icon name="arrow_back" />
              </button>
              <button className="btn primary" type="button" id="haDone" onClick={() => ablaufEnde("ablauf_beendet")}>
                <span className="btn-label">Fertig</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
