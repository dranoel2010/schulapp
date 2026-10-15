"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { ImDetail, Seite, SeitenInhalt } from "@/components/kombi/seite";
import { seitenArt } from "@/components/kombi/seiten/registry";
import { E, reduce } from "@/lib/kombi/motion";

import { BEREICHE, zielFuerArt, zielFuerPfad, type BereichZiel } from "./bereiche";
import { DetailAusSlot, GeladeneSeite, ListeDetail, seitenDatenMerken } from "./liste-detail";
import { perTaste, tipptGerade, ueberlagert } from "./tasten";

/**
 * Die Bühne am Rechner: rechts der Seitenleiste steht genau eine Seite, die
 * oberste der Shell (Stapelseite oder Route). Daraus und aus der Adresse
 * folgt der Bereich (bereiche.ts) und wie er steht: Liste und Detail, eine
 * Fläche (Woche) oder eine Spalte bis --col für Seiten ohne Bereich. Heute
 * ist die Startseite selbst (`#home`); dann steht hier nichts.
 */

/** Der zuletzt gezeigte Bereich; `undefined` bis zum ersten Malen (ein Direktaufruf blendet nicht ein). */
let zuletzt: string | null | undefined;

/** Heute (die Startseite) meldet sich hier, wenn sie wieder vorn steht. */
export function heuteGezeigt(el: HTMLElement | null): void {
  if (zuletzt !== undefined && zuletzt !== "heute" && el) {
    bereichEinblenden(el);
    fokusHinein(el);
  }
  zuletzt = "heute";
}

/**
 * Nach einem Bereichswechsel steht der Fokus im neuen Bereich (nicht auf
 * einem Knopf des alten, der jetzt verdeckt ist): auf der Fläche selbst, der
 * nächste Tab führt zum ersten Bedienelement darin.
 */
function fokusHinein(el: HTMLElement): void {
  const a = document.activeElement;
  if (a instanceof HTMLElement && el.contains(a) && a !== el) return;
  // Wer in der Zeile tippt (etwa beim Queren der Schwelle), bleibt dort: eine Ziffer wechselte sonst den Bereich
  if (tipptGerade() && !(a instanceof HTMLElement && a.closest("[inert]"))) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/**
 * Ein Bereich kommt nach vorn (desktop.html `go`): mit der Maus 180 ms
 * Einblenden mit 6 px, bei reduzierter Bewegung nur Überblenden, mit der
 * Tastatur gar nichts (was man hundertmal am Tag tut, bewegt sich nicht).
 */
export function bereichEinblenden(el: HTMLElement): void {
  if (perTaste()) return;
  el.animate(
    reduce() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
    { duration: 180, easing: E.out },
  );
}

export type BuehnenEintrag =
  | {
      typ: "stapel";
      key: string;
      art: string;
      params: Record<string, string>;
      daten: unknown;
      ausCache: string | null;
      ohneNetz?: boolean;
    }
  | { typ: "route"; key: string };

/** Bereich und Lage der obersten Seite; ohne Seite ist es Heute. */
export function zielVon(e: BuehnenEintrag | null, pfad: string, suche: string): BereichZiel {
  if (!e) return zielFuerArt("heute");
  return e.typ === "stapel" ? zielFuerArt(e.art, e.params) : zielFuerPfad(pfad, suche);
}

export function Buehne({
  eintrag,
  ziel,
  pfad,
  children,
  onZurueck,
}: {
  eintrag: BuehnenEintrag;
  ziel: BereichZiel;
  pfad: string;
  /** die Route der Adresse, wenn sie oben liegt */
  children: ReactNode;
  onZurueck: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  // Bereichswechsel: mit der Maus 180 ms und 6 px, mit der Tastatur nichts
  useLayoutEffect(() => {
    if (zuletzt !== undefined && zuletzt !== ziel.bereich && ref.current) {
      bereichEinblenden(ref.current);
      fokusHinein(ref.current);
    }
    zuletzt = ziel.bereich;
  }, [ziel.bereich]);
  // Eine Spalte (Seite ohne Bereich) geht auf: der Fokus steht in ihr, Esc ist ihr Zurück-Pfeil
  const spalte = ziel.lage === "spalte" ? eintrag.key : null;
  const warSpalte = useRef<string | null>(null);
  useLayoutEffect(() => {
    // auch beim Schließen (Zurück in denselben Bereich): der Fokus bleibt nicht auf body liegen
    const zu = !!warSpalte.current && !spalte && document.activeElement === document.body;
    warSpalte.current = spalte;
    if ((spalte || zu) && ref.current) fokusHinein(ref.current);
  }, [spalte]);
  const zurueckRef = useRef(onZurueck);
  useEffect(() => {
    zurueckRef.current = onZurueck;
  }, [onZurueck]);
  useEffect(() => {
    if (!spalte) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.repeat || tipptGerade() || ueberlagert()) return;
      e.preventDefault();
      zurueckRef.current();
    };
    // vor der Shell: ist Menü, Sheet oder Dialog offen, schließt deren Esc zuerst (ueberlagert)
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [spalte]);
  // Geht die Bühne (zurück nach Heute), weiß der nächste Bereich, woher er kommt
  useEffect(
    () => () => {
      zuletzt = "heute";
    },
    [],
  );

  // Die Daten einer Listenseite gelten auch, wenn danach ein Detail daneben steht
  const stapel = eintrag.typ === "stapel" ? eintrag : null;
  useEffect(() => {
    if (stapel && stapel.daten !== undefined) seitenDatenMerken(stapel.art, stapel.params, stapel.daten, stapel.ausCache);
  }, [stapel]);

  const eigen = stapel ? (
    <SeitenInhalt art={stapel.art} params={stapel.params} daten={stapel.daten} ausCache={stapel.ausCache} ohneNetz={stapel.ohneNetz} />
  ) : (
    children
  );
  const label =
    BEREICHE.find((b) => b.key === ziel.bereich)?.label ?? (stapel ? (seitenArt(stapel.art)?.titel(stapel.params, stapel.daten) ?? "Seite") : "Seite");

  if (ziel.lage === "split" && ziel.bereich) {
    const liste = ziel.liste === "eigen" ? eigen : ziel.liste ? <GeladeneSeite art={ziel.liste.art} params={ziel.liste.params} /> : null;
    const detail =
      ziel.detail === "eigen" ? (
        eigen
      ) : ziel.detail === "slot" ? (
        ziel.sel ? (
          <DetailAusSlot bereich={ziel.bereich} sel={ziel.sel} />
        ) : null
      ) : ziel.detail ? (
        <GeladeneSeite art={ziel.detail.art} params={ziel.detail.params} />
      ) : null;
    const detailKey =
      ziel.detail === "eigen"
        ? stapel
          ? `${stapel.art}?${new URLSearchParams(stapel.params).toString()}`
          : `route:${pfad}`
        : `${JSON.stringify(ziel.detail)}:${ziel.sel ?? ""}`;
    return (
      <section className="page d-bereich" role="region" aria-label={label} data-lage="split" ref={ref}>
        <ListeDetail
          bereich={ziel.bereich}
          sel={ziel.sel}
          liste={liste}
          detail={
            detail ? (
              <ImDetail.Provider value>
                <div className="d-in">{detail}</div>
              </ImDetail.Provider>
            ) : null
          }
          detailKey={detailKey}
        />
      </section>
    );
  }
  if (ziel.lage === "scroll") {
    return (
      <section className="page d-bereich" role="region" aria-label={label} data-lage="scroll" ref={ref}>
        <div className="d-scroll">
          <div className="d-wide">{eigen}</div>
        </div>
      </section>
    );
  }
  return (
    <Seite label={label} onZurueck={onZurueck} className="d-spalte" elRef={(el) => void (ref.current = el)}>
      {eigen}
    </Seite>
  );
}
