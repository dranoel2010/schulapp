"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { artAction, blattOeffnenAction } from "@/app/(app)/arbeitsblatt-actions";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { a4Daten, BlattKoerper, BlattLupe, DruckSeiten, type LupeSteuerung } from "@/components/kombi/tisch/arbeitsblatt/blatt";
import { useArbeitsblatt, type BlattAnfang } from "@/components/kombi/tisch/arbeitsblatt/use-arbeitsblatt";
import { BlattSheet } from "@/components/kombi/tisch/blatt-sheet";
import { erzeugeTisch, type TischOptionen } from "@/components/kombi/tisch/steuerung";
import type { ThemaKurz } from "@/components/kombi/tisch/typen";
import { buzz } from "@/lib/kombi/motion";
import { uhrzeit } from "@/lib/kombi/text";

/**
 * Der Tisch (`#tisch`, Prototyp Z. 943–974): die blaue Fläche, auf der
 * Wiederholen läuft (Abschnitt E). Das Gerüst rendert React einmal, alles
 * Bewegte — Karten, Striche, Themenende — führt `erzeugeTisch()` wie im
 * Prototyp direkt am DOM. React rendert in `#tStack` und `#tEnd` nie Kinder.
 *
 * Ein Übungsthema liegt als Arbeitsblatt auf demselben Tisch (Abschnitt H):
 * die Steuerung meldet das Thema (`deps.blatt`), React füllt `#tBlatt` und
 * `#tBFoot` mit Vorschau, Lupe, „Wie lief es?“ und Druck (./arbeitsblatt).
 * Nach dem Auswerten schreibt die Steuerung das Themenende samt „Weiter mit
 * …“ (Prototyp `endThema`, Zweig Blatt).
 *
 * Der Lernblock hat seine eigene Ebene (./lernblock-tisch, Abschnitt F);
 * `#tClock`, `#tMat` und `#tConfirm` bleiben hier verborgen.
 */

/** Ist die App installiert (standalone)? Dann öffnet „Drucken“ das PDF (Plan H, „Drucken“). */
function alsApp(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

type Steuerung = ReturnType<typeof erzeugeTisch>;
export function TischEbene() {
  const kombi = useKombi();
  const ref = useRef<HTMLElement>(null);
  const api = useRef(kombi);
  const steuerung = useRef<Steuerung | null>(null);

  // ── Arbeitsblatt eines Übungsthemas ───────────────────────────────────────
  const [blattThema, setBlattThema] = useState<{ t: ThemaKurz; einblenden: number; ab: number | null; nr: number } | null>(null);
  const [anfang, setAnfang] = useState<BlattAnfang | null>(null);
  const zaehler = useRef(0);
  const lupe = useRef<LupeSteuerung | null>(null);
  const seitenRef = useRef<(HTMLDivElement | null)[]>([]);
  const blatt = useArbeitsblatt(anfang, kombi.fehlerToast);
  const stand = blatt.lage.art === "da" ? blatt.lage.stand : null;

  // Das Thema wechselt: den Stand des Blatts holen (anlegen und anstoßen, falls nötig)
  useEffect(() => {
    if (!blattThema) {
      setAnfang(null);
      return;
    }
    let ab = false;
    const holen = () => {
      blattOeffnenAction({ thema: blattThema.t.key }).then(
        (r) => {
          if (ab) return;
          if (!r.ok) throw new Error(r.fehler);
          if (!r.daten) {
            // Kein Blatt (ohne Schlüssel und ohne fertiges Blatt): für heute Karten
            steuerung.current?.lieberAbfragen();
            return;
          }
          zaehler.current += 1;
          setAnfang({ stand: r.daten, nr: zaehler.current });
        },
        () => {
          if (!ab) api.current.fehlerToast("Keine Verbindung", holen, "Erneut");
        },
      );
    };
    holen();
    return () => {
      ab = true;
    };
  }, [blattThema]);

  // Das Zählwort unter dem Kopf folgt dem Stand des Blatts
  const phase = blatt.phase;
  useEffect(() => {
    if (!stand) return;
    const n = stand.inhalt?.aufgaben.length ?? 0;
    const um = stand.gedrucktAm ? uhrzeit(new Date(stand.gedrucktAm)) : null;
    steuerung.current?.blattZaehler(
      !stand.inhalt
        ? "Arbeitsblatt"
        : phase === "bewerten" && um
          ? `Arbeitsblatt · gedruckt um ${um}`
          : `Arbeitsblatt · ${n} Aufgaben, etwa ${stand.inhalt.minuten} Minuten`,
    );
  }, [stand, phase]);

  const drucken = useCallback(() => {
    if (!stand?.inhalt) return;
    if (alsApp()) window.open(`/api/arbeitsblatt/${stand.id}/pdf`, "_blank", "noopener");
    else {
      try {
        window.print();
      } catch {
        // ohne Druckdialog: die Wertung kommt trotzdem
      }
    }
    void blatt.gedruckt();
  }, [stand, blatt]);

  const fertig = useCallback(async () => {
    const a = await blatt.auswerten(false);
    if (!a) return;
    buzz();
    steuerung.current?.blattFertig({ n: a.n, richtig: a.richtig, falsch: a.falsch, wiederDran: a.wiederDran });
  }, [blatt]);

  /**
   * „Dieses Thema lieber abfragen“: mit fertigem Blatt die Art umstellen (wie
   * im Tisch aus H), sonst nur für heute — dann Karten auf demselben Tisch.
   */
  const abfragen = useCallback(
    async function abfragen(): Promise<void> {
      if (stand?.topicId && stand.inhalt) {
        const a = await artAction(stand.topicId, "abfragen").catch(() => null);
        if (!a?.ok) {
          api.current.fehlerToast("Nicht gespeichert", () => void abfragen(), "Erneut");
          return;
        }
      }
      steuerung.current?.lieberAbfragen();
    },
    [stand],
  );

  const lupeAuf = useCallback(() => kombi.ebeneAuf("lupe", () => lupe.current?.schliessen()), [kombi]);
  const lupeZu = useCallback(() => kombi.ebeneZu("lupe"), [kombi]);

  useEffect(() => {
    api.current = kombi;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tisch = erzeugeTisch(el, {
      toast: (...a) => api.current.toast(...a),
      hideToast: (k) => api.current.hideToast(k),
      closeMenu: () => api.current.closeMenu(),
      closeSheet: () => api.current.closeSheet(),
      sheetOffen: () => !!document.getElementById("sheet")?.classList.contains("open"),
      blattAnsehen: (blatt) => api.current.openSheet(<BlattSheet blatt={blatt} />, true),
      neuLaden: () => api.current.neuLaden(),
      blatt: (t, beimOeffnen) => {
        if (!t) {
          lupe.current?.schliessen(true);
          setBlattThema(null);
          return;
        }
        // im selben Frame wie Kopf und Striche (go() in der Steuerung)
        const ab = document.timeline.currentTime;
        setBlattThema((alt) => ({ t, einblenden: beimOeffnen ? 204 : 60, ab: typeof ab === "number" ? ab : null, nr: (alt?.nr ?? 0) + 1 }));
      },
      lupeOffen: () => !!lupe.current?.offen(),
      lupeSchliessen: () => lupe.current?.schliessen(),
    });
    steuerung.current = tisch;
    const ab = api.current.registriere("tisch", (o) => {
      const opt = (o ?? {}) as TischOptionen;
      // Der Lernblock (mode „block“) kommt mit Abschnitt F.
      if (opt.mode && opt.mode !== "wh") return;
      void tisch.openTisch(opt);
    });
    return () => {
      ab();
      tisch.zerstoeren();
      steuerung.current = null;
    };
  }, []);

  return (
    <section className="tisch" id="tisch" aria-label="Tisch" role="dialog" aria-hidden="true" ref={ref}>
      <div className="t-surface" id="tSurface">
        <div className="t-tint" id="tTint" />
      </div>
      <div className="t-ghost" id="tGhost" aria-hidden="true" />
      <div className="t-body" id="tBody">
        <div className="t-top">
          <button className="tbtn" id="tClose" type="button" aria-label="Schließen">
            <Icon name="close" />
          </button>
          <span className="t-of" id="tOf" />
          <button className="t-clock" id="tClock" type="button" aria-label="Uhr anhalten" hidden>
            <span className="ic" id="tClockIcon" hidden />
            <span id="tClockText" />
          </button>
        </div>
        <div className="t-head" id="tHead">
          <p className="t-fach" id="tFach" />
          <p className="t-thema" id="tThema" />
        </div>
        <div className="t-ticks" id="tTicks" />
        <div className="t-meta" id="tMeta">
          <p className="t-count" id="tCount" />
          <p className="t-hint" id="tHint" aria-live="polite">
            Erst antworten.
          </p>
        </div>
        <div className="t-stack" id="tStack" />
        <div className="t-foot" id="tFoot">
          <div className="t-ask" id="tAsk">
            <button className="rb" type="button" id="tDunno">
              Weiß ich nicht
            </button>
            <button className="rb known" type="button" id="tReveal">
              Aufdecken
            </button>
          </div>
          <div className="t-rate" id="tRate">
            <button className="rb" type="button" data-r="daneben">
              Daneben
            </button>
            <button className="rb known" type="button" data-r="sass">
              Saß
            </button>
          </div>
        </div>
        {blattThema && stand ? (
          <BlattKoerper
            key={`${blattThema.nr}:${anfang?.nr ?? 0}`}
            stand={stand}
            phase={phase}
            wertung={blatt.wertung}
            onDrucken={drucken}
            onBewerten={blatt.bewerten}
            onFertig={() => void fertig()}
            onAbfragen={stand.hatFragen ? () => void abfragen() : null}
            lupeRef={lupe}
            seitenRef={seitenRef}
            einblenden={blattThema.einblenden}
            einblendenAb={blattThema.ab}
          />
        ) : (
          <>
            <div className="t-blatt" id="tBlatt" />
            <div className="t-bfoot" id="tBFoot" />
          </>
        )}
        <button className="t-mat" id="tMat" type="button" hidden>
          <span id="tMatText" />
        </button>
      </div>
      <BlattLupe
        daten={blattThema && stand ? a4Daten(stand) : null}
        steuerungRef={lupe}
        seitenRef={seitenRef}
        istOffen={() => !!steuerung.current?.istOffen()}
        beimOeffnen={lupeAuf}
        beimSchliessen={lupeZu}
      />
      <div className="t-end" id="tEnd" />
      <div className="t-confirm" id="tConfirm" role="alertdialog" aria-labelledby="tcH">
        <h2 id="tcH" />
        <p id="tcP" />
        <div className="row">
          <button className="btn nein" type="button" id="tcNo" />
          <button className="btn ja" type="button" id="tcYes">
            Ja
          </button>
        </div>
      </div>
      <DruckSeiten daten={blattThema && stand ? a4Daten(stand) : null} />
    </section>
  );
}
