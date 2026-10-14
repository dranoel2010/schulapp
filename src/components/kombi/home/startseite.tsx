"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  aufgabeAbhakenAction,
  aufgabeLoeschenAction,
  aufgabeWiederherstellenAction,
} from "@/app/(app)/kombi-actions";
import { Datumszeile } from "@/components/kombi/home/datumszeile";
import { Morgens } from "@/components/kombi/home/morgens";
import { Ueberblick } from "@/components/kombi/home/ueberblick";
import { Ueberschrift, type UeberschriftApi } from "@/components/kombi/home/ueberschrift";
import { useKombi } from "@/components/kombi/kontext";
import { RUECKSPRUNG_MS, TOAST_MS } from "@/lib/kombi/aktion";
import { buzz, E, flip, reduce } from "@/lib/kombi/motion";
import {
  datumFuer,
  headlineFor,
  istAelter,
  moAbgaben,
  ueberblickAufgaben,
  type Ansicht,
  type AufgabeT,
  type TagDaten,
} from "@/lib/kombi/startseite";
import { voll } from "@/lib/kombi/text";
import { themeColor } from "@/lib/kombi/theme-color";

/**
 * Die Startseite in der Ebene `home` (Modell 23, Abschnitt B; Prototyp
 * Z. 844–857, 1626–2084): Datumszeile mit Zahnrad, Überschrift, darunter die
 * Tageszeit-Ansichten Morgens, Überblick und Morgen früh in einer
 * Rasterzelle (`.modes`).
 *
 * - Die Ansicht kommt vom Server (`TagDaten.ansicht`). Beim Kaltstart öffnet
 *   die Seite direkt in ihr, ohne Wechsel (Kriterium 10).
 * - Gewechselt wird nur beim Zurückkommen aus dem Hintergrund
 *   (`visibilitychange`), über die Zeile (`setView`, etwa „Überblick“) und
 *   nach dem Ablauf (Abschnitt C) — nie, während der Bildschirm sichtbar ist.
 * - Der Wechsel ist der aus Modell 17 (13.3 Nr. 1–3): alte Ansicht 120 ms
 *   aus, Blöcke der neuen 24 px aus der Zeitrichtung, 30 ms versetzt.
 *
 * Die Aufgaben hakt man hier optimistisch ab (Toast „Mathe abgehakt“ mit
 * Rückgängig, die Zeile bleibt 350 ms stehen); scheitert der Aufruf, steht
 * zuerst „Nicht gespeichert“ da, dann springt die Zeile zurück (Plan 2.4,
 * Punkt 9). Danach lädt die Shell die Tagesdaten gezielt nach — kein
 * `refresh()` (Punkt 2).
 *
 * Der Ablauf (Ebene `flow`) kommt mit Abschnitt C. Solange er fehlt, zeigt
 * die Startseite nach Schulschluss den Überblick.
 */

const ORDER: Record<Ansicht, number> = { morgens: 0, ablauf: 1, ueberblick: 2, frueh: 3 };

/** Gibt es den Ablauf schon (Abschnitt C)? */
const ablaufDa = () => typeof document !== "undefined" && !!document.querySelector("#flow .steps");

/** Die zuletzt gezeigte Ansicht — überlebt, wenn die Startseite unter einer Route neu entsteht. */
let gemerkt: { tag: string; view: Ansicht } | null = null;

function startAnsicht(d: TagDaten | null): Ansicht | null {
  if (!d) return null;
  if (gemerkt && gemerkt.tag === d.tag) return gemerkt.view;
  // Beim Server-Rendern gibt es den Ablauf nie im DOM; er wird nach dem
  // Malen eingeschaltet (siehe unten), damit Server und Browser gleich rendern.
  return d.ansicht === "ablauf" ? "ueberblick" : d.ansicht;
}

type Ueber = { done: boolean; doneAt: string | null };

export function Startseite({ daten, vomServer = false }: { daten: TagDaten | null; vomServer?: boolean }) {
  const kombi = useKombi();
  const router = useRouter();
  const { merkeTagDaten, registriere, neuLaden, toast, hideToast, fehlerToast, openZeile } = kombi;
  const live = kombi.tagDaten ?? daten;
  /**
   * Solange eine Zeile gehalten wird, gilt der Stand vom Abhaken: Kommt die
   * Antwort des Servers vor Ablauf der 350 ms, ordnete sie die Liste sonst
   * neu, während die Zeile noch stehen soll — und das FLIP beim Loslassen
   * fände nichts mehr zu bewegen. Die Serverdaten gelten erst in loslassen(),
   * im selben FLIP-Lauf (Prototyp: erst nach 350 ms `refreshTasks`).
   */
  const [eingefroren, setEingefroren] = useState<TagDaten | null>(null);
  /** Zeilen, die nach dem Abhaken noch an ihrer alten Stelle stehen: id → alter Zustand */
  const [halten, setHalten] = useState<ReadonlyMap<string, boolean>>(new Map());
  const haltenRef = useRef<ReadonlyMap<string, boolean>>(halten);
  const d = halten.size && eingefroren ? eingefroren : live;

  useEffect(() => {
    if (vomServer && daten) merkeTagDaten(daten);
  }, [vomServer, daten, merkeTagDaten]);

  const [view, setViewState] = useState<Ansicht | null>(() => startAnsicht(d));
  const viewRef = useRef<Ansicht | null>(view);
  const liveRef = useRef<Ansicht | null>(d ? d.ansicht : null);
  /** App-Tag der zuletzt gemeldeten Ansicht */
  const tagRef = useRef<string | null>(d ? d.tag : null);
  const wechsel = useRef(false);
  const viewGen = useRef(0);
  const ueberschrift = useRef<UeberschriftApi>(null);

  // ── Aufgaben: Server-Stand plus optimistische Änderungen ───────────────────

  const [ueber, setUeber] = useState<Record<string, Ueber>>({});
  const [weg, setWeg] = useState<ReadonlySet<string>>(new Set());
  const [extra, setExtra] = useState<AufgabeT[]>([]);
  const laufend = useRef(new Set<string>());
  const timer = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const aufgaben = useMemo<AufgabeT[]>(() => {
    if (!d) return [];
    const ids = new Set(d.aufgaben.map((a) => a.id));
    return [...d.aufgaben, ...extra.filter((a) => !ids.has(a.id))]
      .filter((a) => !weg.has(a.id))
      .map((a) => (ueber[a.id] ? { ...a, ...ueber[a.id] } : a));
  }, [d, extra, weg, ueber]);


  /** Für die Reihenfolge zählt bei gehaltenen Zeilen noch der alte Zustand. */
  const ordnung = useMemo(
    () => aufgaben.map((a) => (halten.has(a.id) ? { ...a, done: halten.get(a.id)! } : a)),
    [aufgaben, halten],
  );
  const echt = useMemo(() => new Map(aufgaben.map((a) => [a.id, a])), [aufgaben]);
  const zuEcht = useCallback((liste: AufgabeT[]) => liste.map((a) => echt.get(a.id) ?? a), [echt]);

  const aufgabenRef = useRef(aufgaben);
  const dRef = useRef(d);
  useLayoutEffect(() => {
    aufgabenRef.current = aufgaben;
    dRef.current = d;
  });
  // Versatz der App-Uhr (Server, mit Testuhr die Testuhr) zur Uhr des Geräts,
  // gemessen beim Eintreffen der Tagesdaten: der vorläufige Erledigt-Zeitpunkt
  // beim Abhaken rechnet damit, nicht mit der Uhr des Geräts allein.
  const versatzRef = useRef(0);
  useLayoutEffect(() => {
    const s = d ? Date.parse(d.stand) : NaN;
    versatzRef.current = Number.isFinite(s) ? s - Date.now() : 0;
  }, [d]);

  const scope = () => document.getElementById(`m-${viewRef.current ?? "ueberblick"}`);

  /** Overrides, deren Aufruf nicht mehr unterwegs ist, gelten nicht mehr. */
  const ueberAufraeumen = useCallback(
    () =>
      setUeber((alt) => {
        const neu: Record<string, Ueber> = {};
        let gleich = true;
        for (const [id, u] of Object.entries(alt)) {
          if (laufend.current.has(id) || haltenRef.current.has(id)) neu[id] = u;
          else gleich = false;
        }
        return gleich ? alt : neu;
      }),
    [],
  );

  /**
   * Nach dem Halten: Listen per FLIP abgleichen (13.3 Nr. 27, 340 ms ease-io).
   * Im selben Lauf gelten die inzwischen geladenen Serverdaten und fallen die
   * erledigten Overrides; `vorher` legt weitere Änderungen in denselben Lauf
   * (Rückgängig).
   */
  const loslassen = useCallback(
    (id: string, vorher?: () => void) => {
      clearTimeout(timer.current.get(id));
      timer.current.delete(id);
      const s = scope();
      const run = () =>
        flushSync(() => {
          vorher?.();
          if (haltenRef.current.has(id)) {
            const n = new Map(haltenRef.current);
            n.delete(id);
            haltenRef.current = n;
            setHalten(n);
            if (!n.size) setEingefroren(null);
          }
          ueberAufraeumen();
        });
      if (s) flip(s, run, { duration: 340, easing: E.io });
      else run();
    },
    [ueberAufraeumen],
  );

  // Neue Tagesdaten (nicht während des Haltens, da gilt der eingefrorene
  // Stand): was nicht mehr unterwegs ist, gilt vom Server
  useEffect(() => {
    ueberAufraeumen();
  }, [d, ueberAufraeumen]);

  // für „Erneut“ im Fehler-Toast: der Weg ruft sich selbst wieder auf
  const abhakenRef = useRef<(id: string, done: boolean) => void>(() => {});
  const loeschenRef = useRef<(id: string) => void>(() => {});

  const abhaken = useCallback(
    (id: string, done: boolean) => {
      const a = aufgabenRef.current.find((x) => x.id === id);
      if (!a || a.done === done) return;
      const vorher: Ueber = { done: a.done, doneAt: a.doneAt };
      laufend.current.add(id);
      setUeber((u) => ({ ...u, [id]: { done, doneAt: done ? new Date(Date.now() + versatzRef.current).toISOString() : null } }));
      if (done) buzz();
      if (!haltenRef.current.size) setEingefroren(dRef.current);
      const gehaltenNeu = new Map(haltenRef.current).set(id, vorher.done);
      haltenRef.current = gehaltenNeu;
      setHalten(gehaltenNeu);
      clearTimeout(timer.current.get(id));
      timer.current.set(id, setTimeout(() => loslassen(id), done ? 350 : 200));

      let zurueckgenommen = false;
      const aufruf = aufgabeAbhakenAction({ id, done });
      const zurueck = async () => {
        zurueckgenommen = true;
        // Der alte Zustand gilt im selben FLIP-Lauf: die Zeile gleitet zurück.
        // Bis die Rücknahme gespeichert und geladen ist, hält der Override.
        laufend.current.add(id);
        loslassen(id, () => setUeber((u) => ({ ...u, [id]: vorher })));
        try {
          const r = await aufruf;
          await aufgabeAbhakenAction({ id, done: vorher.done, rueckgaengig: r.protokollId });
          await neuLaden();
          // der Override fällt mit dem Übernehmen der neuen Daten (Effekt auf `d`)
          laufend.current.delete(id);
        } catch {
          fehlerToast("Nicht gespeichert", () => void zurueck(), "Erneut");
          await new Promise((res) => setTimeout(res, RUECKSPRUNG_MS));
          laufend.current.delete(id);
          loslassen(id);
        }
      };
      if (done) toast(`${a.fach} abgehakt`, () => void zurueck(), `${a.fach}, ${a.text}`);
      else hideToast();

      aufruf
        .then(async (r) => {
          if (!r.ok) throw new Error("abgewiesen");
          if (zurueckgenommen) return;
          await neuLaden();
          // Der Override fällt mit dem Übernehmen der neuen Daten (Effekt auf
          // `d`), bei einer gehaltenen Zeile erst in loslassen()
          laufend.current.delete(id);
        })
        .catch(async () => {
          if (zurueckgenommen) return;
          fehlerToast("Nicht gespeichert", () => abhakenRef.current(id, done), "Erneut");
          await new Promise((r) => setTimeout(r, RUECKSPRUNG_MS));
          laufend.current.delete(id);
          loslassen(id);
        });
    },
    [toast, hideToast, fehlerToast, neuLaden, loslassen],
  );
  useEffect(() => {
    abhakenRef.current = abhaken;
  }, [abhaken]);

  const loeschen = useCallback(
    (id: string) => {
      const a = aufgabenRef.current.find((x) => x.id === id);
      if (!a) return;
      const s = scope();
      const weg1 = () =>
        flushSync(() =>
          setWeg((w) => {
            const n = new Set(w);
            n.add(id);
            return n;
          }),
        );
      if (s) flip(s, weg1, { duration: 340, easing: E.io });
      else weg1();
      const zurueckHolen = () => {
        const s2 = scope();
        const run = () =>
          flushSync(() =>
            setWeg((w) => {
              const n = new Set(w);
              n.delete(id);
              return n;
            }),
          );
        if (s2) flip(s2, run, { duration: 340, easing: E.io });
        else run();
      };
      const aufruf = aufgabeLoeschenAction(id);
      let zurueckgenommen = false;
      /** Läuft der Fehler-Toast des Rückgängig ab, gilt das Löschen doch (Plan 2.4, Punkt 9). */
      let aufgeben: ReturnType<typeof setTimeout> | undefined;
      const extraWeg = () => setExtra((x) => x.filter((y) => y.id !== id));
      // Rückgängig: die Aufgabe mit ihrer alten id zurück (Plan 3.3). „Erneut“
      // im Fehler-Toast ruft genau diesen Weg mit derselben Zeile wieder auf.
      const wiederherstellen = async () => {
        clearTimeout(aufgeben);
        let r: Awaited<typeof aufruf> | null = null;
        try {
          r = await aufruf;
        } catch {
          r = null; // das Löschen selbst kam nicht an: die Aufgabe steht noch
        }
        try {
          if (r?.ok) {
            const w = await aufgabeWiederherstellenAction(r.zeile, r.protokollId);
            if (!w.ok) throw new Error("abgewiesen");
          }
          await neuLaden();
          extraWeg();
        } catch {
          fehlerToast("Nicht gespeichert", () => void wiederherstellen(), "Erneut");
          // Die Zeile bleibt stehen, solange „Erneut“ angeboten wird
          aufgeben = setTimeout(() => {
            const s3 = scope();
            const run = () =>
              flushSync(() => {
                extraWeg();
                setWeg((w) => new Set(w).add(id));
              });
            if (s3) flip(s3, run, { duration: 340, easing: E.io });
            else run();
          }, TOAST_MS);
        }
      };
      toast(
        "Gelöscht",
        () => {
          zurueckgenommen = true;
          setExtra((x) => [...x.filter((y) => y.id !== id), a]);
          zurueckHolen();
          void wiederherstellen();
        },
        a.text,
      );
      aufruf
        .then(async (r) => {
          if (!r.ok) throw new Error("abgewiesen");
          if (!zurueckgenommen) await neuLaden();
        })
        .catch(async () => {
          if (zurueckgenommen) return;
          fehlerToast("Nicht gespeichert", () => loeschenRef.current(id), "Erneut");
          await new Promise((r) => setTimeout(r, RUECKSPRUNG_MS));
          zurueckHolen();
        });
    },
    [toast, fehlerToast, neuLaden],
  );
  useEffect(() => {
    loeschenRef.current = loeschen;
  }, [loeschen]);

  /**
   * Bearbeiten (Plan 2.2, Prototyp `startEdit`): ein Kurztext ohne Details
   * ändert man in der Zeile, eine Aufgabe mit Details im Formular.
   */
  const bearbeiten = useCallback(
    (id: string) => {
      const a = aufgabenRef.current.find((x) => x.id === id);
      if (!a || a.details) {
        router.push(`/hausaufgaben/${id}`);
        return;
      }
      openZeile({ intent: "aendern", id: a.id, text: a.text, fach: a.fachId, due: a.due, dueAuto: false });
    },
    [router, openZeile],
  );

  // ── Überschrift ────────────────────────────────────────────────────────────

  const headline = d && view && view !== "ablauf" ? headlineFor(view, d, aufgaben) : "";
  const [startHeadline] = useState(headline);

  useLayoutEffect(() => {
    if (wechsel.current || !headline) return;
    ueberschrift.current?.setzen(headline, 0);
  }, [headline]);

  // ── Tageszeitwechsel (Prototyp setView, Z. 1675) ───────────────────────────

  const setView = useCallback(
    (wunsch: Ansicht, { anim = true, dir }: { anim?: boolean; dir?: number } = {}) => {
      const dd = dRef.current;
      if (!dd) return;
      const v: Ansicht = wunsch === "ablauf" && !ablaufDa() ? "ueberblick" : wunsch;
      const from = viewRef.current;
      const home = document.getElementById("home");
      const flow = document.getElementById("flow");
      if (from !== v) hideToast();
      // ein zweiter Wechsel während des ersten startet neu (17 Z. 912)
      [home, flow].forEach((l) => l?.getAnimations({ subtree: true }).forEach((a) => a.cancel()));
      document.querySelectorAll(".leaving").forEach((x) => x.classList.remove("leaving"));
      viewRef.current = v;
      gemerkt = { tag: dd.tag, view: v };
      const gen = ++viewGen.current;
      wechsel.current = true;
      flushSync(() => setViewState(v));
      wechsel.current = false;

      const layerOf = (x: Ansicht) => (x === "ablauf" ? flow : home);
      const toL = layerOf(v);
      const fromL = from ? layerOf(from) : null;
      [home, flow].forEach((l) => l?.classList.toggle("on", l === toL));
      themeColor("paper");
      if (v !== "ablauf") {
        const sc = document.getElementById("homeScroll");
        if (sc) sc.scrollTop = 0;
      }
      window.dispatchEvent(new CustomEvent("kombi:ansicht", { detail: { ansicht: v, schritt: dd.schritt, dir, anim } }));
      window.dispatchEvent(new Event("kombi:striche"));
      const text = v === "ablauf" ? "" : headlineFor(v, dd, aufgabenRef.current);
      const setzen = (dirH: number, sofort?: boolean) => {
        if (text) ueberschrift.current?.setzen(text, dirH, sofort);
      };
      if (!anim || from == null || from === v) {
        setzen(0, true);
        return;
      }
      const dd2 = dir ?? (ORDER[v] > ORDER[from] ? 1 : -1);
      const modeEl = (x: Ansicht) => document.getElementById(`m-${x}`);
      const outEl = fromL === toL ? modeEl(from) : fromL;
      if (outEl) {
        outEl.classList.add("leaving");
        const a = outEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
        // Auch wenn das Ausblenden abbricht (das Menü der Zeile schließt,
        // ein zweiter Wechsel): sonst bliebe die alte Ansicht stehen.
        const fertig = () => {
          if (gen !== viewGen.current) return;
          outEl.classList.remove("leaving");
          a.cancel();
        };
        a.finished.then(fertig, fertig);
      }
      let blocks: Element[] = [];
      if (toL === home) {
        const kids = [...(modeEl(v)?.children ?? [])];
        if (fromL === home) {
          setzen(reduce() ? 0 : dd2);
          blocks = kids;
        } else {
          setzen(0, true);
          blocks = [document.getElementById("whenrow"), document.getElementById("h1"), ...kids].filter(
            (x): x is HTMLElement => !!x,
          );
        }
      } else if (flow) {
        const band = flow.querySelector("#band");
        const st = flow.querySelector(".step.cur .scroll") ?? flow.querySelector(".step .scroll");
        blocks = [band, ...(st ? [...st.children] : [])].filter((x): x is Element => !!x);
      }
      if (reduce()) {
        const inEl = fromL === toL ? modeEl(v) : toL;
        inEl?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
        return;
      }
      blocks.forEach((el, i) =>
        el.animate([{ opacity: 0, transform: `translateX(${dd2 * 24}px)` }, { opacity: 1, transform: "none" }], {
          duration: 260,
          delay: Math.min(i, 5) * 30,
          easing: E.out,
          fill: "backwards",
        }),
      );
    },
    [hideToast],
  );

  // Die Shell ruft beim Wechsel aus der Zeile („Überblick“) diesen Weg auf
  useEffect(
    () =>
      registriere("ansicht", (o) => {
        const ansicht = o?.ansicht as Ansicht | undefined;
        if (ansicht) setView(ansicht, { dir: o?.dir as number | undefined, anim: o?.anim as boolean | undefined });
      }),
    [registriere, setView],
  );

  // Daten kamen erst nach dem ersten Malen (Einstieg über eine Route)
  useEffect(() => {
    if (!d) return;
    if (liveRef.current == null) liveRef.current = d.ansicht;
    if (tagRef.current == null) tagRef.current = d.tag;
    if (viewRef.current == null) {
      // Auch hier gilt der Ablauf nach dem Malen: wer über eine Stapel-URL
      // (Push-Erinnerung, Lesezeichen) einsteigt, sieht ihn beim Zurück
      const ablauf = d.ansicht === "ablauf" && !(gemerkt && gemerkt.tag === d.tag) && ablaufDa();
      setView(ablauf ? "ablauf" : (startAnsicht(d) ?? "ueberblick"), { anim: false });
    }
  }, [d, setView]);

  // Der Ablauf nach dem Malen (Abschnitt C), wenn der Server ihn nennt
  useEffect(() => {
    const dd = dRef.current;
    if (dd && dd.ansicht === "ablauf" && viewRef.current !== "ablauf" && !gemerkt && ablaufDa()) {
      setView("ablauf", { anim: false });
    }
  }, [setView]);

  /*
   * Kaltstart ohne Netz: Der Service Worker liefert die Startseite mit den
   * Tagesdaten vom Laden ihres HTML; die Shell holt gleich danach die neueren
   * aus dem Daten-Cache (etwa nach „Überspringen“ oder Abhaken). Sagen die
   * eine andere Ansicht, gilt deren — noch beim Kaltstart, ohne Wechsel-
   * Bewegung und nur, bevor man etwas angetippt hat. Danach gilt wieder:
   * gewechselt wird nur beim Zurückkommen aus dem Hintergrund.
   */
  const kaltstart = useRef<{ bis: number; stand: string | null; ansicht: Ansicht | null } | null>(null);
  useEffect(() => {
    const dd = dRef.current;
    kaltstart.current = { bis: Date.now() + 3000, stand: dd?.stand ?? null, ansicht: dd?.ansicht ?? null };
    const weg = () => {
      kaltstart.current = null;
    };
    window.addEventListener("pointerdown", weg, { capture: true, once: true });
    return () => window.removeEventListener("pointerdown", weg, { capture: true });
  }, []);
  useEffect(() => {
    const k = kaltstart.current;
    if (!k || !live) return;
    if (Date.now() > k.bis) {
      kaltstart.current = null;
      return;
    }
    if (live.stand === k.stand || live.ansicht === k.ansicht || (k.stand && istAelter(live, { stand: k.stand }))) return;
    kaltstart.current = null;
    if (document.querySelector("#tisch.open, #cam.open, #lbTisch.open")) return;
    setView(live.ansicht === "ablauf" && !ablaufDa() ? "ueberblick" : live.ansicht, { anim: false });
  }, [live, setView]);

  // Nur beim Zurückkommen aus dem Hintergrund, nie während der Bildschirm sichtbar ist (V2 3.2)
  useEffect(() => {
    const onVis = async () => {
      if (document.hidden) return;
      let neu: Ansicht | null = null;
      let tagNeu: string | null = null;
      try {
        const r = await fetch("/api/tag/stand", { headers: { accept: "application/json" } });
        if (r.ok) {
          const j = (await r.json()) as { ok?: boolean; ansicht?: Ansicht; tag?: string };
          if (j.ok && j.ansicht) {
            neu = j.ansicht;
            tagNeu = j.tag ?? null;
          }
        }
      } catch {
        // ohne Verbindung bleibt die Ansicht
      }
      await neuLaden();
      if (!neu) return;
      const alt = liveRef.current;
      const tagAlt = tagRef.current;
      liveRef.current = neu;
      if (tagNeu) tagRef.current = tagNeu;
      if (document.querySelector("#tisch.open, #cam.open")) return;
      // Solange der Ablauf fehlt, steht statt seiner der Überblick: beide
      // Seiten gleich abbilden, sonst bliebe der Abend morgens stehen.
      const eff = (x: Ansicht | null) => (x === "ablauf" && !ablaufDa() ? "ueberblick" : x);
      // Gewechselt wird, wenn der Server eine andere Ansicht oder einen neuen
      // Tag nennt; verglichen wird mit der gezeigten Ansicht, nicht mit der
      // zuletzt gemeldeten: nach „Fertig“ oder „Überspringen“ steht der
      // Überblick da, obwohl der Server zuletzt „ablauf“ sagte
      const geaendert = eff(neu) !== eff(alt) || (!!tagNeu && !!tagAlt && tagNeu !== tagAlt);
      if (geaendert && eff(neu) !== viewRef.current) setView(neu);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [neuLaden, setView]);

  // Wird es eng, kürzt der Überblick die Titel unter den Miniaturen (V2 4.2)
  useLayoutEffect(() => {
    const fit = () => {
      const box = document.getElementById("m-ueberblick");
      const sc = document.getElementById("homeScroll");
      if (!box || !sc) return;
      box.classList.remove("short");
      if (viewRef.current !== "ueberblick") return;
      if (sc.scrollHeight > sc.clientHeight + 1 && window.innerHeight >= 700) box.classList.add("short");
    };
    fit();
    window.addEventListener("resize", fit);
    document.fonts?.ready.then(fit, () => {});
    return () => window.removeEventListener("resize", fit);
  });

  useEffect(() => {
    const t = timer.current;
    return () => t.forEach((x) => clearTimeout(x));
  }, []);

  // ── Malen ──────────────────────────────────────────────────────────────────

  // Gehaltene Zeilen bleiben auf dem Überblick stehen, auch eine eben wieder
  // geöffnete, deren alter Zustand „erledigt“ ist (Prototyp `keep`, Z. 1951).
  const gehalten = useMemo(() => new Set(halten.keys()), [halten]);
  const ov = d ? ueberblickAufgaben(d, ordnung, gehalten) : { gezeigt: [], zeilen: [] };
  const datum = d && view && view !== "ablauf" ? voll(datumFuer(view, d)) : d ? voll(d.tag) : "";
  const handlers = { onAbhaken: abhaken, onBearbeiten: bearbeiten, onLoeschen: loeschen };

  return (
    <div className="scroll" id="homeScroll">
      <Datumszeile datum={datum} />
      <Ueberschrift start={startHeadline} apiRef={ueberschrift} />
      <div className="modes">
        <section className={`mode${view === "morgens" ? " on" : ""}`} id="m-morgens" data-v="morgens" aria-label="Morgens">
          {d ? (
            <Morgens
              morgen={d.morgens}
              abgaben={zuEcht(moAbgaben(ordnung, d.morgens.tag, d))}
              heute={d.tag}
              {...handlers}
            />
          ) : null}
        </section>
        <section
          className={`mode${view === "ueberblick" ? " on" : ""}`}
          id="m-ueberblick"
          data-v="ueberblick"
          aria-label="Überblick"
        >
          {d ? <Ueberblick d={d} gezeigt={zuEcht(ov.gezeigt)} zeilen={ov.zeilen} {...handlers} /> : null}
        </section>
        <section className={`mode${view === "frueh" ? " on" : ""}`} id="m-frueh" data-v="frueh" aria-label="Morgen früh">
          {d ? (
            <Morgens
              morgen={d.frueh}
              abgaben={zuEcht(moAbgaben(ordnung, d.frueh.tag, d))}
              heute={d.tag}
              {...handlers}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
