"use client";

import type { ReactNode, Ref } from "react";

import { Icon } from "@/components/kombi/icon";
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
}: {
  label: string;
  onZurueck: () => void;
  children: ReactNode;
  elRef?: Ref<HTMLElement>;
  dataKey?: string;
}) {
  return (
    <section className="page" role="region" aria-label={label} ref={elRef} data-ebene={dataKey}>
      <div className="p-top">
        <button className="pback" type="button" aria-label="Zurück" onClick={onZurueck}>
          <Icon name="arrow_back" />
        </button>
      </div>
      <div className="scroll">{children}</div>
    </section>
  );
}

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
}: {
  art: string;
  params: Record<string, string>;
  daten: unknown;
  ausCache?: string | null;
}) {
  const s = seitenArt(art);
  if (!s) return null;
  const sub = daten === undefined ? null : (s.untertitel?.(params, daten) ?? null);
  return (
    <>
      <h2 className="p-title">{s.titel(params, daten)}</h2>
      {ausCache ? <p className="p-sub">Ohne Verbindung · Stand {uhrzeit(new Date(ausCache))}</p> : null}
      {sub ? <p className="p-sub">{sub}</p> : null}
      {daten === undefined ? null : <s.Inhalt params={params} daten={daten} />}
    </>
  );
}
