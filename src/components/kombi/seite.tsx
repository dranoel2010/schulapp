"use client";

import { createContext, useContext, type ReactNode, type Ref } from "react";

import { Icon } from "@/components/kombi/icon";
import { Tn } from "@/components/kombi/tn";
import { seitenArt } from "@/components/kombi/seiten/registry";
import { uhrzeit } from "@/lib/kombi/text";

/**
 * Der Seitenrahmen `pageShell` (Prototyp Z. 2995–3001): Zurück-Pfeil `.pback`
 * oben links, darunter die Scrollfläche. Dieselbe Hülle tragen
 * Nachschlage-Seiten im Stapel und Routen, die als oberste Ebene einfahren
 * (Plan 2.4, Punkt 5).
 */
export function Seite({
  label,
  onZurueck,
  children,
  elRef,
  dataKey,
  className,
}: {
  label: string;
  onZurueck: () => void;
  children: ReactNode;
  elRef?: Ref<HTMLElement>;
  dataKey?: string;
  /** zusätzliche Klasse, am Rechner etwa `d-spalte` */
  className?: string;
}) {
  return (
    <section className={className ? `page ${className}` : "page"} role="region" aria-label={label} ref={elRef} data-ebene={dataKey}>
      <div className="p-top">
        <button className="pback" type="button" aria-label="Zurück" onClick={onZurueck}>
          <Icon name="arrow_back" />
        </button>
      </div>
      <div className="scroll">{children}</div>
    </section>
  );
}

/** Steht die Seite am Rechner im Detail neben einer Liste? (gesetzt von der Bühne) */
export const ImDetail = createContext(false);

/**
 * Titel und Inhalt einer Nachschlage-Seite — im Stapel und beim direkten
 * Aufruf der URL dieselbe Komponente. Ohne Daten (noch am Laden, nach 150 ms
 * eingefahren) steht nur der Titel. Kommt die Seite aus dem Cache des Service
 * Workers, steht darunter „Ohne Verbindung · Stand ⟨Uhrzeit⟩“ (2.4, Punkt 8).
 */
export function SeitenInhalt({
  art,
  params,
  daten,
  ausCache,
  ohneNetz = false,
}: {
  art: string;
  params: Record<string, string>;
  daten: unknown;
  ausCache?: string | null;
  /** ohne Netz und ohne gecachte Daten wiederhergestellt */
  ohneNetz?: boolean;
}) {
  const s = seitenArt(art);
  const imDetail = useContext(ImDetail);
  if (!s) return null;
  const sub = daten === undefined ? null : (s.untertitel?.(params, daten) ?? null);
  const titel = s.titel(params, daten);
  if (daten === undefined && ohneNetz)
    return (
      <>
        <h2 className="p-title">{titel || "Ohne Verbindung"}</h2>
        <p className="empty">{titel ? "Ohne Verbindung. Diese Seite war noch nicht geöffnet." : "Diese Seite war noch nicht geöffnet."}</p>
      </>
    );
  if (imDetail && s.detailKopf && daten !== undefined) {
    // am Rechner im Detail: erst die Angabe, dann der Titel (desktop.html, wie die Klausur)
    const angabe = s.detailKopf === true ? sub : s.detailKopf(params, daten);
    return (
      <>
        {/* .d-ober ist flex: der Text in einem span, sonst gehen die Leerzeichen an den Kommas verloren */}
        <p className="d-sub d-ober">
          <span>
            <Tn s={ausCache ? `Ohne Verbindung · Stand ${uhrzeit(new Date(ausCache))}` : (angabe ?? "")} />
          </span>
        </p>
        <h1 className="d-h1 d-kopf">{titel}</h1>
        <s.Inhalt params={params} daten={daten} />
      </>
    );
  }
  return (
    <>
      <h2 className="p-title">{titel}</h2>
      {ausCache ? <p className="p-sub">Ohne Verbindung · Stand {uhrzeit(new Date(ausCache))}</p> : null}
      {sub ? <p className="p-sub">{sub}</p> : null}
      {daten === undefined ? null : <s.Inhalt params={params} daten={daten} />}
    </>
  );
}
