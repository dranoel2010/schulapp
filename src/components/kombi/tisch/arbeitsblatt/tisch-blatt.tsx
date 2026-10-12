"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  artAction,
  blattOeffnenAction,
  blattStandAction,
  naechstesUebungsthemaAction,
  type ArbeitsblattAntwort,
} from "@/app/(app)/arbeitsblatt-actions";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import type { Auswertung, BlattStand } from "@/lib/arbeitsblatt/ablauf";
import { buzz, E, reduce } from "@/lib/kombi/motion";
import { dm, kurz, TAG, uhrzeit, wd } from "@/lib/kombi/text";
import { themeColor } from "@/lib/kombi/theme-color";

import { a4Daten, BlattKoerper, BlattLupe, DruckSeiten, type LupeSteuerung } from "./blatt";
import { useArbeitsblatt, type BlattAnfang } from "./use-arbeitsblatt";

/**
 * Der Tisch für ein Arbeitsblatt (Plan H) — der Gastgeber, bis Abschnitt E
 * den ganzen Tisch bringt. Dann übernimmt der Tisch aus E diese Teile:
 * `useArbeitsblatt` (Stand), `BlattKoerper` und `BlattLupe` (./blatt),
 * `DruckSeiten` und `ArbeitsblattEnde`. Fläche, Kopf, Wachsen aus dem Knopf
 * und Schließen sind hier nur so weit gebaut, wie das Blatt sie braucht.
 *
 * `openTisch` mit
 *   - `{ thema }`: ein Übungsthema beim Wiederholen;
 *   - `{ block }`: der Lernblock — ist er kein Arbeitsblatt, gilt der alte
 *     Weg; ist er schon erledigt (Blatt ausgewertet), geht nichts auf
 *     (Prototyp `openTisch`);
 *   - `{ mode: 'wh' }` ohne Thema: das erste fällige Übungsthema mit
 *     fertigem Blatt; gibt es keins, die alte Sitzung (Karten), bis E sie
 *     ersetzt.
 *
 * Der Tisch geht erst auf, wenn der Stand da ist. Scheitert das, geht nichts
 * auf: Toast „Keine Verbindung“ mit „Erneut“ (Plan 2.4, Punkt 7). Offen hat
 * er einen Eintrag in der History, die Lupe darüber einen eigenen
 * (`ebeneAuf`): Android-Zurück schließt erst die Lupe, dann den Tisch.
 *
 * Bekannte Lücken bis E/F: „Thema x von y“ oben rechts (die Themenfolge kennt
 * erst E); im Lernblock die Uhr, „Material · …“ unter dem Knopf und
 * „Material ansehen“ am Ende (kommen mit F).
 */

export type TischOptionen = {
  mode?: "wh" | "block";
  thema?: string;
  block?: string;
  blatt?: string;
  origin?: HTMLElement | null;
  /** „Thema 2 von 3“ — kennt nur der Tisch aus E */
  of?: string;
};

/** Zahlen mit proportionalen Trennzeichen (Prototyp `tn`). */
function Tn({ text }: { text: string }) {
  const teile: ReactNode[] = [];
  text.split(/([:.,])/).forEach((t, i) => {
    if (!t) return;
    teile.push(/^[:.,]$/.test(t) ? <span key={i} className="c">{t}</span> : t);
  });
  return <>{teile}</>;
}

const und = (l: number[]) => (l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} und ${l[l.length - 1]}`);

/** Das Themenende nach der Auswertung (Prototyp `endThema`, Zweig Blatt). */
export function ArbeitsblattEnde({
  stand,
  auswertung,
  imBlock,
  knoepfe,
}: {
  stand: BlattStand;
  auswertung: Auswertung | null;
  imBlock: boolean;
  /** Die Knöpfe in `.tnext` (Prototyp: „Weiter mit ⟨Fach⟩“ und „Für heute aufhören“, sonst „Fertig“) */
  knoepfe: ReactNode;
}) {
  const n = auswertung?.n ?? stand.inhalt?.aufgaben.length ?? 0;
  const falsch =
    auswertung?.falsch ??
    Object.entries(stand.wertung)
      .filter(([, ok]) => !ok)
      .map(([nr]) => Number(nr))
      .sort((a, b) => a - b);
  const ok = auswertung?.richtig ?? n - falsch.length;
  const zeileFalsch = falsch.length ? (
    <p>{`${falsch.length === 1 ? "Aufgabe" : "Aufgaben"} ${und(falsch)} ${falsch.length === 1 ? "kommt" : "kommen"} aufs nächste Blatt.`}</p>
  ) : null;
  const zahlen = <p>{`${n} Aufgaben, ${ok === n ? "alle" : ok} richtig.`}</p>;

  if (imBlock) {
    return (
      <>
        <h2 className="sans">Blatt ausgewertet.</h2>
        {zahlen}
        {zeileFalsch}
        <p>Der Lernblock zählt als erledigt.</p>
        <div className="tnext">{knoepfe}</div>
      </>
    );
  }
  const nt = auswertung?.wiederDran ?? null;
  return (
    <>
      <h2>{ok === n ? `${stand.thema} sitzt.` : `${stand.thema} geübt.`}</h2>
      {zahlen}
      {zeileFalsch}
      {nt ? <p>{`Wieder dran: ${TAG[wd(nt)]}, ${dm(nt)}`}</p> : null}
      <div className="tnext">{knoepfe}</div>
    </>
  );
}

/** Ist die App installiert (standalone)? Dann öffnet „Drucken“ das PDF (Plan H, „Drucken“). */
function alsApp(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export function ArbeitsblattTisch() {
  const kombi = useKombi();
  const { registriere, fehlerToast, neuLaden, ebeneAuf, ebeneZu } = kombi;
  const router = useRouter();
  const [optionen, setOptionen] = useState<TischOptionen | null>(null);
  const [anfang, setAnfang] = useState<BlattAnfang | null>(null);
  /** Nach dem Auswerten beim Wiederholen: das nächste Übungsthema mit fertigem Blatt (Prototyp `endThema`) */
  const [naechstes, setNaechstes] = useState<BlattStand | null>(null);
  const tischRef = useRef<HTMLElement>(null);
  const surfRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lupe = useRef<LupeSteuerung | null>(null);
  const seitenRef = useRef<(HTMLDivElement | null)[]>([]);
  const offenRef = useRef(false);
  const oeffnetRef = useRef(false);
  const zaehler = useRef(0);
  const imBlock = optionen?.mode === "block" || Boolean(optionen?.block);

  const blatt = useArbeitsblatt(anfang, fehlerToast);
  const { lage, phase } = blatt;
  const stand = lage.art === "da" ? lage.stand : null;

  const zeileVerstecken = (an: boolean) => document.getElementById("zeile")?.classList.toggle("hide", an);

  // Zurück (aus der History) schließt den Tisch über diese Referenz — immer die neueste `schliessen`
  const schliessenRef = useRef<(sofort?: boolean, ausHistory?: boolean) => void>(() => {});

  // ── Öffnen ────────────────────────────────────────────────────────────────
  const oeffnen = useCallback(
    async function oeffnen(o?: Record<string, unknown>): Promise<void> {
      if (offenRef.current || oeffnetRef.current) return;
      const opt = (o ?? {}) as TischOptionen;
      const alsBlock = opt.mode === "block" || Boolean(opt.block);
      let antwort: ArbeitsblattAntwort<BlattStand | null> | null = null;
      oeffnetRef.current = true;
      try {
        if (opt.blatt) antwort = await blattStandAction(opt.blatt);
        else if (opt.thema) antwort = await blattOeffnenAction({ thema: opt.thema });
        else if (opt.block) antwort = await blattOeffnenAction({ block: opt.block });
        else if (!alsBlock) antwort = await naechstesUebungsthemaAction();
        else antwort = { ok: true, daten: null };
      } catch {
        antwort = null;
      } finally {
        oeffnetRef.current = false;
      }
      if (!antwort?.ok) {
        // Keine Ebene öffnen (Plan 2.4, Punkt 7)
        fehlerToast("Keine Verbindung", () => void oeffnen(o), "Erneut");
        return;
      }
      const st = antwort.daten;
      if (!st) {
        // Kein Arbeitsblatt: Karten in der alten Sitzung (bis E), ein Lernblock auf dem alten Weg (bis F)
        router.push(alsBlock ? "/lernen" : "/abruf/sitzung");
        return;
      }
      // Ein erledigter Block öffnet den Tisch nicht (Prototyp `openTisch`, Z. 4240)
      if (alsBlock && st.ausgewertetAm) return;
      kombi.closeMenu();
      kombi.hideToast(true);
      offenRef.current = true;
      zaehler.current += 1;
      setOptionen(opt);
      setNaechstes(null);
      setAnfang({ stand: st, nr: zaehler.current });
      ebeneAuf("tisch", () => schliessenRef.current(false, true));
    },
    [kombi, router, fehlerToast, ebeneAuf],
  );

  useEffect(() => registriere("tisch", (o) => void oeffnen(o)), [registriere, oeffnen]);

  // Der Tisch geht auf: aus dem Knopf, sonst Überblenden
  const offen = optionen !== null && anfang !== null;
  useLayoutEffect(() => {
    if (!offen) return;
    const tisch = tischRef.current;
    const surf = surfRef.current;
    const body = bodyRef.current;
    if (!tisch || !surf || !body) return;
    themeColor("table");
    const origin = optionen?.origin;
    if (reduce() || !origin) zeileVerstecken(true);
    else setTimeout(() => offenRef.current && zeileVerstecken(true), 340);
    [surf, body].forEach((x) => x.getAnimations().forEach((a) => a.cancel()));
    if (reduce()) {
      tisch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      return;
    }
    if (origin && origin.isConnected && origin.offsetParent) {
      const r = origin.getBoundingClientRect();
      surf.animate([{ clipPath: clipVon(tisch, r) }, { clipPath: "inset(0px 0px 0px 0px round 0px)" }], { duration: 340, easing: E.grow });
      body.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 200, delay: 204, easing: E.out, fill: "backwards" });
    } else {
      tisch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  // ── Schließen ─────────────────────────────────────────────────────────────
  /**
   * `ausHistory`: Zurück hat den Eintrag schon genommen. `navigiert`: danach
   * geht es auf eine andere Route, deren Eintrag den des Tisches ersetzt.
   */
  const schliessen = useCallback(
    (sofort = false, ausHistory = false, navigiert = false) => {
      if (!offenRef.current) return;
      offenRef.current = false;
      if (!ausHistory) ebeneZu("tisch", navigiert);
      lupe.current?.schliessen(true);
      zeileVerstecken(false);
      themeColor("paper");
      const tisch = tischRef.current;
      const fertig = () => {
        setOptionen(null);
        setAnfang(null);
        setNaechstes(null);
      };
      void neuLaden();
      if (sofort || !tisch) {
        fertig();
        return;
      }
      if (reduce()) {
        tisch.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).finished.then(fertig, fertig);
        return;
      }
      const o = optionen?.origin;
      const r = o && o.isConnected && o.offsetParent ? o.getBoundingClientRect() : null;
      if (r && r.width && r.bottom > 0 && r.top < innerHeight && surfRef.current) {
        [bodyRef.current, endRef.current].forEach((x) =>
          x?.animate([{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], { duration: 280, fill: "forwards" }),
        );
        surfRef.current
          .animate([{ clipPath: "inset(0px 0px 0px 0px round 0px)" }, { clipPath: clipVon(tisch, r) }], { duration: 280, easing: E.grow, fill: "forwards" })
          .finished.then(fertig, fertig);
        return;
      }
      tisch.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease", fill: "forwards" }).finished.then(fertig, fertig);
    },
    [neuLaden, optionen, ebeneZu],
  );
  useEffect(() => {
    schliessenRef.current = schliessen;
  }, [schliessen]);

  // Escape: erst die Lupe, dann der Tisch (Android-Zurück geht über die History, siehe `ebeneAuf`)
  useEffect(() => {
    if (!offen) return;
    const taste = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (lupe.current?.offen()) lupe.current.schliessen();
      else schliessen();
    };
    document.addEventListener("keydown", taste, true);
    return () => document.removeEventListener("keydown", taste, true);
  }, [offen, schliessen]);

  const lupeAuf = useCallback(() => ebeneAuf("lupe", () => lupe.current?.schliessen()), [ebeneAuf]);
  const lupeZu = useCallback(() => ebeneZu("lupe"), [ebeneZu]);

  // ── Handlungen ────────────────────────────────────────────────────────────
  const drucken = useCallback(() => {
    if (!stand?.inhalt) return;
    if (alsApp()) {
      window.open(`/api/arbeitsblatt/${stand.id}/pdf`, "_blank", "noopener");
    } else {
      try {
        window.print();
      } catch {
        // ohne Druckdialog: die Wertung kommt trotzdem
      }
    }
    void blatt.gedruckt();
  }, [stand, blatt]);

  const fertig = useCallback(async () => {
    // Beim Wiederholen: gibt es noch ein Übungsthema mit fertigem Blatt? Dann „Weiter mit …“
    const weiter =
      !imBlock && stand?.topicId ? await naechstesUebungsthemaAction(stand.topicId).catch(() => null) : null;
    const a = await blatt.auswerten(imBlock);
    if (!a) return;
    setNaechstes(weiter?.ok ? weiter.daten : null);
    buzz();
    void neuLaden();
  }, [blatt, imBlock, neuLaden, stand]);

  /** „Weiter mit ⟨Fach⟩“: das nächste Blatt auf denselben Tisch (Prototyp `nextThema`). */
  const weiterMit = useCallback(() => {
    if (!naechstes) return;
    zaehler.current += 1;
    setAnfang({ stand: naechstes, nr: zaehler.current });
    setNaechstes(null);
    const body = bodyRef.current;
    if (body && !reduce()) {
      body.animate([{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: E.out });
    }
  }, [naechstes]);

  /**
   * „Dieses Thema lieber abfragen“: die Art umstellen, dann Karten — bis E in
   * der alten Sitzung. Ohne fertiges Blatt (es wird noch gebaut oder ließ
   * sich heute nicht bauen) nur für heute: die Art bleibt.
   */
  const abfragen = useCallback(async function abfragen(): Promise<void> {
    if (!stand) return;
    if (stand.topicId && stand.inhalt) {
      const a = await artAction(stand.topicId, "abfragen").catch(() => null);
      if (!a?.ok) {
        fehlerToast("Nicht gespeichert", () => void abfragen(), "Erneut");
        return;
      }
    }
    schliessen(true, false, true);
    router.replace("/abruf/sitzung");
  }, [stand, fehlerToast, schliessen, router]);

  const ended = phase === "fertig" && stand !== null;

  // Das Themenende blendet ein (Prototyp endThema)
  useLayoutEffect(() => {
    const end = endRef.current;
    if (!ended || !end || reduce()) return;
    end.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: 340, easing: "ease" });
    [...end.children]
      .filter((c) => !c.classList.contains("tnext"))
      .forEach((c) => c.animate([{ transform: "translateY(16px)" }, { transform: "none" }], { duration: 340, easing: E.out }));
    end.querySelectorAll(".tnext > *").forEach((b, i) =>
      b.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 340, delay: 100 + i * 40, easing: E.out, fill: "backwards" }),
    );
  }, [ended]);

  if (!offen) return null;

  const n = stand?.inhalt?.aufgaben.length ?? 0;
  const gedrucktUm = stand?.gedrucktAm ? uhrzeit(new Date(stand.gedrucktAm)) : null;
  const zaehlerText = !stand?.inhalt
    ? "Arbeitsblatt"
    : phase === "bewerten" && gedrucktUm
      ? `Arbeitsblatt · gedruckt um ${gedrucktUm}`
      : `Arbeitsblatt · ${n} Aufgaben, etwa ${stand.inhalt.minuten} Minuten`;

  // Der Kopf folgt dem Weg, nicht dem Blatt: dasselbe Blatt ist beim Wiederholen das Thema, im Lernblock der Block
  const alsBlock = imBlock && stand?.block;
  const kopfFach = alsBlock ? `${stand.fach} · Klausur ${kurz(stand.block!.klausurtag)}` : (stand?.fach ?? "");
  const kopfThema = alsBlock ? `Lernblock · ${stand.block!.label}` : (stand?.thema ?? "");

  return (
    <section
      className={`tisch open blatt${ended ? " ended" : ""}`}
      id="tisch"
      aria-label="Tisch"
      role="dialog"
      ref={tischRef}
      data-blatt={stand?.id}
    >
      <div className="t-surface" id="tSurface" ref={surfRef}>
        <div className="t-tint" id="tTint" />
      </div>
      <div className="t-body" id="tBody" ref={bodyRef}>
        <div className="t-top">
          <button className="tbtn" id="tClose" type="button" aria-label="Schließen" onClick={() => schliessen()}>
            <Icon name="close" />
          </button>
          <span className="t-of" id="tOf" hidden={imBlock || !optionen?.of}>
            {optionen?.of ?? ""}
          </span>
          <span style={{ width: 44 }} />
        </div>
        <div className="t-head" id="tHead" style={ended ? { visibility: "hidden" } : undefined}>
          <p className="t-fach" id="tFach">
            {kopfFach}
          </p>
          <p className="t-thema" id="tThema">
            {kopfThema}
          </p>
        </div>
        <div className="t-meta" id="tMeta" style={ended ? { visibility: "hidden" } : undefined}>
          <p className="t-count" id="tCount">
            {stand ? <Tn text={zaehlerText} /> : null}
          </p>
        </div>
        {stand && !ended ? (
          <BlattKoerper
            key={anfang?.nr}
            stand={stand}
            phase={phase}
            wertung={blatt.wertung}
            onDrucken={drucken}
            onBewerten={blatt.bewerten}
            onFertig={() => void fertig()}
            onAbfragen={stand.hatFragen && !imBlock ? () => void abfragen() : null}
            lupeRef={lupe}
            seitenRef={seitenRef}
            einblenden={optionen?.origin ? 204 : 60}
          />
        ) : null}
      </div>
      <BlattLupe
        daten={stand ? a4Daten(stand) : null}
        steuerungRef={lupe}
        seitenRef={seitenRef}
        istOffen={() => offenRef.current}
        beimOeffnen={lupeAuf}
        beimSchliessen={lupeZu}
      />
      <div className={`t-end${ended ? " on" : ""}`} id="tEnd" ref={endRef}>
        {ended && stand ? (
          <ArbeitsblattEnde
            stand={stand}
            auswertung={blatt.auswertung}
            imBlock={imBlock}
            knoepfe={
              !imBlock && naechstes ? (
                <>
                  <button className="tlink known" type="button" onClick={weiterMit}>
                    <span>{`Weiter mit ${naechstes.fach}`}</span>
                    <span className="s">{`${naechstes.thema}, Arbeitsblatt`}</span>
                  </button>
                  <button className="tlink" type="button" onClick={() => schliessen()}>
                    Für heute aufhören
                  </button>
                </>
              ) : (
                <button className={`tlink${imBlock ? " known" : ""}`} type="button" onClick={() => schliessen()}>
                  Fertig
                </button>
              )
            }
          />
        ) : null}
      </div>
      <DruckSeiten daten={stand ? a4Daten(stand) : null} />
    </section>
  );
}

/** Startmaske: genau die Pille, aus der der Tisch kommt, mit ihrem Radius (Prototyp `clipOf`). */
function clipVon(tisch: HTMLElement, r: DOMRect): string {
  const tr = tisch.getBoundingClientRect();
  const R = Math.min(r.height / 2, 26);
  return `inset(${r.top - tr.top}px ${tr.right - r.right}px ${tr.bottom - r.bottom}px ${r.left - tr.left}px round ${R}px)`;
}
