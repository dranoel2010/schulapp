"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  lernblockBeendenAction,
  lernblockBlattAction,
  lernblockErledigtAction,
  lernblockStartenAction,
  lernblockTischAction,
  lernblockUhrAction,
} from "@/app/(app)/lernblock-actions";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import {
  appJetzt,
  appUhrStellen,
  blockLesen,
  blockMerken,
  blockVomServer,
  fortgesetzt,
  gelernt,
  gestartet,
  pausiert,
  restMs,
  useBlock,
  useSekunde,
  zustand,
} from "@/components/kombi/lernblock/uhr";
import { Abschrift } from "@/components/kombi/abschrift";
import { BlockKarten, blockKartenErgebnis, type BlockKartenDeps } from "@/components/kombi/tisch/block-karten";
import { LernblockUhr } from "@/components/kombi/tisch/lernblock-uhr";
import type { BlockDaten, LernblockTischDaten, MaterialDaten } from "@/lib/kombi/lernblock-daten";
import { buzz, E, reduce } from "@/lib/kombi/motion";
import { kurz } from "@/lib/kombi/text";
import { themeColor } from "@/lib/kombi/theme-color";

/**
 * Der Tisch im Lernblock (Prototyp Z. 943–974, 4041–4313; V2 9.1): derselbe
 * blaue Tisch wie beim Wiederholen, mit der Uhr oben rechts, dem Kopf
 * „Mathematik · Klausur Fr 16.10.“ / „Lernblock · Scheitelpunktform“, den
 * Karten der Klausurthemen und unter den Knöpfen „Material · …“.
 *
 * - Öffnen startet die Uhr (oder setzt sie fort); Schließen hält sie nicht an.
 * - Ein Tipp auf die Uhr pausiert und setzt fort.
 * - „Zeit um. Als erledigt zählen?“ kommt einmal, wenn die Restzeit 0 ist.
 * - „Block beenden“: unter einer Minute ohne Rückfrage und ohne Spur im
 *   Protokoll zurück auf Ruhe, sonst „Als erledigt zählen? n Minuten gelernt“.
 * - Ohne offene Fragen öffnet der Block direkt mit dem Material.
 * - Der Tisch wächst aus dem Knopf, der ihn startet, und schrumpft dorthin
 *   zurück (clip-path, Nr. 41 und 57).
 *
 * Er hängt sich als Ebene „lernblock“ in die Shell: `openTisch({mode:
 * 'block', blockId, origin})` landet hier. Wiederholen (Abschnitt E) hat
 * seinen eigenen Tisch unter „tisch“.
 */

type Sitzung = {
  blockId: string;
  fach: string;
  klausurDatum: string;
  origin: HTMLElement | null;
};

type Frage = { titel: string; text: string; nein: string; ja: () => void };

/** `leer`: der Block hat heute weder Fragen noch Material (die Uhr läuft dann nicht) */
type Ende = { n: number; ok: number; leer?: boolean } | null;

const clipVon = (r: DOMRect, tr: DOMRect): string => {
  const R = Math.min(r.height / 2, 26);
  return `inset(${r.top - tr.top}px ${tr.right - r.right}px ${tr.bottom - r.bottom}px ${r.left - tr.left}px round ${R}px)`;
};

function sichtbar(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.isConnected && el.offsetParent !== null;
}

/** Die Zeile geht, wenn der Tisch sie bedeckt (7.1); die Shell kennt dafür keinen Schalter. */
function zeileVerstecken(an: boolean) {
  document.querySelector(".zeile")?.classList.toggle("hide", an);
}

export function LernblockTisch() {
  const kombi = useKombi();
  const [sitzung, setSitzung] = useState<Sitzung | null>(null);
  const [daten, setDaten] = useState<LernblockTischDaten | null>(null);
  const [ende, setEnde] = useState<Ende>(null);
  const [frage, setFrage] = useState<Frage | null>(null);
  const [startBlock, setStartBlock] = useState<BlockDaten | null>(null);

  const tischRef = useRef<HTMLElement>(null);
  const surfRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const jaRef = useRef<HTMLButtonElement>(null);
  const offenRef = useRef(false);
  const zeitGefragt = useRef(false);
  const ignorierePop = useRef(0);
  const zeileTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const block = useBlock(daten?.block ?? startBlock);
  const z = block ? zustand(block) : "ruhe";
  const jetzt = useSekunde(!!sitzung && z === "laeuft");
  const rest = block ? restMs(block, jetzt) : 0;

  // ── Material als Sheet von unten (die Uhr läuft weiter) ───────────────────
  const material = daten?.material ?? null;
  const openMaterial = useCallback(() => {
    if (!material) return;
    kombi.openSheet(<MaterialSheet m={material} />, true);
  }, [kombi, material]);

  // ── Bestätigung (Prototyp showConfirm/hideConfirm) ───────────────────────
  const zeigeFrage = useCallback((f: Frage) => {
    setFrage(f);
  }, []);
  useLayoutEffect(() => {
    const c = confirmRef.current;
    if (!frage || !c) return;
    c.animate(
      reduce()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }],
      { duration: reduce() ? 160 : 260, easing: E.out },
    );
    jaRef.current?.focus({ preventScroll: true });
  }, [frage]);

  // ── Schließen: der Tisch schrumpft in den Knopf, aus dem er kam ──────────
  const schliessen = useCallback(
    (optionen?: { ausHistory?: boolean; sofort?: boolean }) => {
      if (!offenRef.current) return;
      offenRef.current = false;
      setFrage(null);
      kombi.closeSheet();
      const tisch = tischRef.current;
      if (document.activeElement instanceof HTMLElement && tisch?.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      if (!optionen?.ausHistory && window.history.state?.overlay === "tisch") {
        ignorierePop.current += 1;
        window.history.back();
      }
      clearTimeout(zeileTimer.current);
      zeileVerstecken(false);
      themeColor("paper");

      const lbBtn = document.getElementById("lbBtn");
      const keineSeite = !document.querySelector("#pages > .page");
      const o = keineSeite && sichtbar(lbBtn) ? lbBtn : sitzung && sichtbar(sitzung.origin) ? sitzung.origin : null;
      const fertig = () => {
        if (offenRef.current) return;
        [surfRef.current, bodyRef.current, endRef.current, tisch].forEach((x) =>
          x?.getAnimations().forEach((a) => a.cancel()),
        );
        tisch?.classList.remove("open");
        setSitzung(null);
        setDaten(null);
        setEnde(null);
        setStartBlock(null);
      };
      void kombi.neuLaden();
      if (!tisch || optionen?.sofort) return fertig();
      if (reduce()) {
        tisch.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).finished.then(fertig, () => {});
        return;
      }
      const r = o?.getBoundingClientRect();
      if (o && r && r.width && r.bottom > 0 && r.top < window.innerHeight) {
        // Inhalt geht zuerst, die Fläche nimmt die Form der Pille an
        [bodyRef.current, endRef.current].forEach((x) =>
          x?.animate([{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], { duration: 280, fill: "forwards" }),
        );
        surfRef.current
          ?.animate(
            [{ clipPath: "inset(0px 0px 0px 0px round 0px)" }, { clipPath: clipVon(r, tisch.getBoundingClientRect()) }],
            { duration: 280, easing: E.grow, fill: "forwards" },
          )
          .finished.then(fertig, () => {});
        return;
      }
      tisch.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease" }).finished.then(fertig, () => {});
    },
    [kombi, sitzung],
  );

  // ── Öffnen (Prototyp openTisch im Block) ──────────────────────────────────
  const oeffnen = useCallback(
    (o?: Record<string, unknown>) => {
      const blockId = typeof o?.blockId === "string" ? o.blockId : null;
      if (!blockId || offenRef.current) return;
      const vorher = blockLesen(blockId) ?? null;
      if (vorher && zustand(vorher) === "erledigt") return;
      // Eine Probeklausur ohne Angabe zum Blatt (etwa aus der Zeile) geht an
      // den Tisch des Blatts; der gibt sie mit `blatt: false` zurück, wenn es fehlt.
      if (vorher?.art === "probe" && o?.blatt === undefined) {
        kombi.openTisch({ ...o, blatt: true });
        return;
      }

      kombi.closeMenu();
      kombi.hideToast();
      kombi.closeSheet();
      offenRef.current = true;
      zeitGefragt.current = false;
      const origin = o?.origin instanceof HTMLElement ? o.origin : null;
      setSitzung({
        blockId,
        fach: typeof o?.fach === "string" ? o.fach : "",
        klausurDatum: typeof o?.klausurDatum === "string" ? o.klausurDatum : "",
        origin,
      });
      setDaten(null);
      setEnde(null);
      setFrage(null);

      // Die Uhr läuft sofort; der Server bestätigt
      const jetztMs = appJetzt();
      if (vorher) {
        const neu = gestartet(vorher, jetztMs);
        blockMerken(neu);
        setStartBlock(neu);
      }
      const starten = (): Promise<void> =>
        lernblockStartenAction(blockId).then(
          (r) => {
            if (r.ok) blockVomServer(r);
          },
          () => kombi.fehlerToast("Nicht gespeichert", () => void starten(), "Erneut"),
        );
      const gestartetP = starten();

      lernblockTischAction(blockId).then(
        (r) => {
          if (!offenRef.current) return;
          if (!r.ok) {
            kombi.toast(r.fehler);
            return;
          }
          appUhrStellen(r.uhrVersatz);
          // Wurden heute schon Fragen des Blocks beantwortet, ist er nicht leer:
          // das Ende nennt sie (auch nach einem Neuladen)
          // Die Probeklausur ist nur ein Blatt (Prototyp): hierher kommt sie
          // nur, wenn es fehlt oder sein Bau gescheitert ist, und fällt nicht
          // in die Karten.
          const probe = r.daten.block.art === "probe";
          if (probe || (r.daten.fragen.length === 0 && !r.daten.material && Object.keys(r.daten.erste).length === 0)) {
            // Nichts zu lernen und kein Blatt: keine Uhr, keine leere
            // Endkarte ohne Ausweg. Hat erst dieses Öffnen die Uhr gestartet,
            // geht sie still zurück auf Ruhe (wie „Block beenden“ unter einer
            // Minute); der Weg führt zu „Stoff und Fragen“ der Klausur.
            if (!vorher || zustand(vorher) === "ruhe") {
              const ruhe = vorher ?? { ...r.daten.block, laeuftSeit: null, pausiertSeit: null, pauseMs: 0 };
              blockMerken(ruhe);
              setStartBlock(ruhe);
              setDaten({ ...r.daten, block: ruhe });
              void gestartetP.then(() =>
                lernblockBeendenAction(blockId).then(
                  (b) => {
                    if (b.ok) blockVomServer(b);
                  },
                  () => {},
                ),
              );
            } else setDaten(r.daten);
            setEnde({ n: 0, ok: 0, leer: true });
            return;
          }
          setDaten(r.daten);
          if (r.daten.fragen.length === 0) {
            // Ohne offene Fragen: direkt das Ende des Blocks und das Material
            setEnde(blockKartenErgebnis(blockId, r.daten.erste));
            if (r.daten.material) {
              const m = r.daten.material;
              setTimeout(() => {
                if (offenRef.current) kombi.openSheet(<MaterialSheet m={m} />, true);
              }, reduce() ? 0 : 360);
            }
          }
        },
        () => {
          if (offenRef.current) kombi.fehlerToast("Keine Verbindung", () => {}, "Erneut");
        },
      );

      if (window.history.state?.overlay !== "tisch") {
        window.history.pushState({ ...(window.history.state ?? {}), overlay: "tisch" }, "");
      }
      themeColor("table");
      clearTimeout(zeileTimer.current);
      if (reduce() || !origin) zeileVerstecken(true);
      else zeileTimer.current = setTimeout(() => offenRef.current && zeileVerstecken(true), 340);
    },
    [kombi],
  );

  useEffect(() => kombi.registriere("lernblock", oeffnen), [kombi, oeffnen]);

  // Aufgehen: aus der Pille wachsen (clip-path), Inhalt ab 60 %
  useLayoutEffect(() => {
    const tisch = tischRef.current;
    if (!sitzung || !tisch || tisch.classList.contains("open")) return;
    tisch.classList.add("open");
    tisch.classList.toggle("rm", reduce());
    const surf = surfRef.current;
    const body = bodyRef.current;
    [surf, body, endRef.current].forEach((x) => x?.getAnimations().forEach((a) => a.cancel()));
    if (reduce()) {
      tisch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      return;
    }
    const o = sitzung.origin;
    if (sichtbar(o) && surf) {
      const r = o.getBoundingClientRect();
      surf.animate([{ clipPath: clipVon(r, tisch.getBoundingClientRect()) }, { clipPath: "inset(0px 0px 0px 0px round 0px)" }], {
        duration: 340,
        easing: E.grow,
      });
      body?.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
        duration: 200,
        delay: 204,
        easing: E.out,
        fill: "backwards",
      });
      endRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 204, easing: E.out, fill: "backwards" });
    } else {
      tisch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" });
    }
  }, [sitzung]);

  // Ende des Blocks: Kopf blendet aus, der Satz steht allein, Knöpfe am Fuß
  useLayoutEffect(() => {
    const end = endRef.current;
    if (!ende || !end || reduce()) return;
    end.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: 340, easing: "ease" });
    [...end.children]
      .filter((c) => !c.classList.contains("tnext"))
      .forEach((c) => c.animate([{ transform: "translateY(16px)" }, { transform: "none" }], { duration: 340, easing: E.out }));
    end.querySelectorAll(".tnext > *").forEach((b, i) =>
      b.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], {
        duration: 340,
        delay: 100 + i * 40,
        easing: E.out,
        fill: "backwards",
      }),
    );
  }, [ende]);

  // Android-Zurück: Bestätigung zuerst, dann der Tisch
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (ignorierePop.current > 0) {
        ignorierePop.current -= 1;
        return;
      }
      if (!offenRef.current) return;
      const s = (e.state ?? {}) as { overlay?: string };
      if (s.overlay === "tisch" || s.overlay === "sheet") return;
      if (frage) {
        setFrage(null);
        window.history.pushState({ ...(window.history.state ?? {}), overlay: "tisch" }, "");
        return;
      }
      schliessen({ ausHistory: true });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [frage, schliessen]);

  // Escape wie im Prototyp (Z. 4620–4687): nur die oberste Ebene — Sheet
  // (schließt die Shell), dann Bestätigung, dann der Tisch. In der
  // Capture-Phase am Fenster und danach gestoppt, damit die Shell nicht
  // zugleich die Seite unter dem Tisch vom Stapel nimmt.
  useEffect(() => {
    if (!sitzung) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".sheet.open")) return;
      e.preventDefault();
      e.stopPropagation();
      if (frage) setFrage(null);
      else schliessen();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sitzung, frage, schliessen]);

  // ── Erledigt zählen ──────────────────────────────────────────────────────
  const fertigZaehlen = useCallback(
    (min: number) => {
      if (!block) return;
      blockMerken({ ...block, status: "done", minutenGelernt: min });
      schliessen();
      const senden = () =>
        lernblockErledigtAction(block.id, min).then(
          (r) => {
            if (r.ok) blockVomServer(r);
            void kombi.neuLaden();
          },
          () => {
            kombi.fehlerToast("Nicht gespeichert", () => void senden(), "Erneut");
            blockMerken(block);
          },
        );
      void senden();
    },
    [block, kombi, schliessen],
  );

  // Zeit um (einmal je Öffnen): „Zeit um. Als erledigt zählen?“
  useEffect(() => {
    if (!sitzung || !block || z !== "laeuft" || rest > 0 || frage || zeitGefragt.current) return;
    zeitGefragt.current = true;
    buzz();
    const min = Math.round(block.minuten);
    zeigeFrage({
      titel: "Zeit um. Als erledigt zählen?",
      text: `${min} Minuten gelernt`,
      nein: "Noch die restlichen Fragen",
      ja: () => fertigZaehlen(min),
    });
  }, [sitzung, block, z, rest, frage, zeigeFrage, fertigZaehlen]);

  const blockBeenden = useCallback(() => {
    if (!block) return;
    const min = gelernt(block, appJetzt());
    if (min < 1) {
      // Unter einer Minute: keine Rückfrage, keine Zählung, keine Spur
      blockMerken({ ...block, laeuftSeit: null, pausiertSeit: null, pauseMs: 0 });
      schliessen();
      lernblockBeendenAction(block.id).then(
        (r) => {
          if (r.ok) blockVomServer(r);
          void kombi.neuLaden();
        },
        () => kombi.fehlerToast("Nicht gespeichert", () => void lernblockBeendenAction(block.id), "Erneut"),
      );
      return;
    }
    zeigeFrage({
      titel: "Als erledigt zählen?",
      text: `${min} ${min === 1 ? "Minute" : "Minuten"} gelernt`,
      nein: "Weiterlernen",
      ja: () => fertigZaehlen(min),
    });
  }, [block, kombi, schliessen, zeigeFrage, fertigZaehlen]);

  const uhrTippen = useCallback(() => {
    if (!block) return;
    const jetztMs = appJetzt();
    const was = zustand(block) === "laeuft" ? "pause" : zustand(block) === "pausiert" ? "weiter" : null;
    if (!was) return;
    const vorher = block;
    blockMerken(was === "pause" ? pausiert(block, jetztMs) : fortgesetzt(block, jetztMs));
    const senden = () =>
      lernblockUhrAction(vorher.id, was).then(
        (r) => {
          if (r.ok) blockVomServer(r);
        },
        () => {
          kombi.fehlerToast("Nicht gespeichert", () => void senden(), "Erneut");
          blockMerken(vorher);
        },
      );
    void senden();
  }, [block, kombi]);

  // „Blatt ansehen“ auf der Rückseite einer Karte: das Blatt als Sheet auf dem Tisch
  const kartenDeps = useMemo<BlockKartenDeps>(
    () => ({
      toast: kombi.toast,
      blattAnsehen: (materialId) => {
        if (material && material.id === materialId) {
          kombi.openSheet(<MaterialSheet m={material} />, true);
          return;
        }
        lernblockBlattAction(materialId).then(
          (r) => {
            if (r.ok && offenRef.current) kombi.openSheet(<MaterialSheet m={r.blatt} />, true);
            else if (!r.ok) kombi.toast(r.fehler);
          },
          () => kombi.fehlerToast("Keine Verbindung", () => {}, "Erneut"),
        );
      },
    }),
    [kombi, material],
  );
  const kartenEnde = useCallback((e: { n: number; ok: number }) => setEnde(e), []);

  const fach = daten?.fach ?? sitzung?.fach ?? "";
  const istProbe = block?.art === "probe";
  const datum = daten?.klausurDatum ?? sitzung?.klausurDatum ?? "";

  return (
    <section className="tisch" id="lbTisch" aria-label="Tisch" role="dialog" ref={tischRef}>
      <div className="t-surface" ref={surfRef}>
        <div className="t-tint" />
      </div>
      <div className="t-ghost" aria-hidden="true" />
      <div className="t-body" ref={bodyRef}>
        <div className="t-top">
          <button className="tbtn" type="button" aria-label="Schließen" onClick={() => schliessen()}>
            <Icon name="close" />
          </button>
          <span className="t-of" />
          {/* der leere Block kommt ohne Uhr aus (Korrektur Runde 4) */}
          {block && !ende?.leer ? <LernblockUhr block={block} jetzt={jetzt} onTipp={uhrTippen} /> : null}
        </div>
        {sitzung ? (
          <>
            <div className="t-head" style={ende ? { visibility: "hidden" } : undefined}>
              <p className="t-fach">{fach && datum ? `${fach} · Klausur ${kurz(datum)}` : fach}</p>
              <p className="t-thema">Lernblock · {block?.titel ?? ""}</p>
            </div>
            {daten && !ende && daten.fragen.length > 0 ? (
              <BlockKarten blockId={daten.block.id} fragen={daten.fragen} erste={daten.erste} onEnde={kartenEnde} deps={kartenDeps} />
            ) : (
              <div style={{ flex: "1 1 auto" }} />
            )}
            {material && !ende && !istProbe ? (
              <button className="t-mat" type="button" onClick={openMaterial}>
                <span>
                  Material · {material.titel.split(",")[0]}, {material.seiten}{" "}
                  {material.seiten === 1 ? "Seite" : "Seiten"}
                </span>
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <div className={`t-end${ende ? " on" : ""}`} ref={endRef}>
        {ende ? (
          <>
            <h2 className="sans">
              {ende.leer ? (istProbe ? "Heute kein Blatt." : "Heute nichts offen.") : "Fragen für heute durch."}
            </h2>
            <p>
              {ende.leer
                ? istProbe
                  ? "Für die Probeklausur ließ sich heute kein Blatt bauen."
                  : "Zu diesem Thema gibt es heute keine Fragen und kein Blatt."
                : ende.n
                  ? `${ende.n} ${ende.n === 1 ? "Frage" : "Fragen"}, ${ende.ok === ende.n ? "alle" : ende.ok} beim ersten Mal.`
                  : "Heute waren keine Fragen offen."}
            </p>
            <div className="tnext">
              {ende.leer && block ? (
                <button
                  className="tlink"
                  type="button"
                  onClick={() => {
                    // Der Eintrag des Tisches wird zur Route (kein Zurück dazwischen)
                    schliessen({ ausHistory: true });
                    kombi.openPage("stoff", { id: block.examId });
                  }}
                >
                  Stoff und Fragen
                </button>
              ) : null}
              {rest > 0 && material && !istProbe ? (
                <button className="tlink" type="button" onClick={openMaterial}>
                  Weiter mit Material
                </button>
              ) : null}
              {ende.leer ? (
                <button className="tlink known" type="button" onClick={() => schliessen()}>
                  Schließen
                </button>
              ) : (
                <button className="tlink known" type="button" onClick={blockBeenden}>
                  Block beenden
                </button>
              )}
            </div>
          </>
        ) : null}
      </div>
      <div className={`t-confirm${frage ? " on" : ""}`} role="alertdialog" aria-labelledby="lbcH" ref={confirmRef}>
        <h2 id="lbcH">{frage?.titel}</h2>
        <p>{frage?.text}</p>
        <div className="row">
          <button className="btn nein" type="button" onClick={() => setFrage(null)}>
            {frage?.nein}
          </button>
          <button
            className="btn ja"
            type="button"
            ref={jaRef}
            onClick={() => {
              const f = frage;
              setFrage(null);
              f?.ja();
            }}
          >
            Ja
          </button>
        </div>
      </div>
    </section>
  );
}

/** Das Material als Sheet auf dem Tisch (Prototyp `openSheet(b, true)`, `abschriftEl`). */
export function MaterialSheet({ m }: { m: MaterialDaten }) {
  return (
    <>
      <h2 className="p-title">{m.titel}</h2>
      <p className="p-sub">
        {m.fach}, {m.seiten} {m.seiten === 1 ? "Seite" : "Seiten"}
      </p>
      <Abschrift absaetze={m.abschrift} />
    </>
  );
}
