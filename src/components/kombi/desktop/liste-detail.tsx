"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { SeitenInhalt } from "@/components/kombi/seite";
import { reduce } from "@/lib/kombi/motion";

import { AuswahlKontext, detailSlot } from "./auswahl";
import type { Bereich } from "./bereiche";
import { perTaste, tipptGerade, ueberlagert } from "./tasten";

/**
 * Liste und Detail am Rechner (desktop.html `split`, `selectIn`): links die
 * Liste mit denselben Zeilen wie am Handy, rechts das Gewählte. Die Auswahl
 * steht in der URL (`sel` oder die Adresse der Detailseite); die Bühne in
 * shell.tsx leitet daraus Liste und Detail ab (bereiche.ts).
 *
 * - Das Detail kann jede Seite der Registry zeigen (`GeladeneSeite`) oder die
 *   Route der Adresse (Formulare, Archiv, Eingangskorb, Unterseiten der
 *   Einstellungen). Ein Teil baut nur, was im Entwurf eigens gestaltet ist.
 * - ↑/↓ und j/k gehen durch die Zeilen mit `data-id` (ohne Übergang), ein
 *   Mausklick wechselt das Detail mit 140 ms Überblenden.
 * - Zeilen erfahren über `useAuswahl()`, was gewählt ist (`.sel`).
 */

// ── Seiten der Registry nachladen ─────────────────────────────────────────────

type Antwort = { daten: unknown; ausCache: string | null };

const cache = new Map<string, Antwort>();
let stand = 0;
const hoerer = new Set<() => void>();

/** Nach einer Action (neuLaden der Shell): alle geladenen Listen und Details neu holen. */
export function datenNeu(): void {
  stand += 1;
  hoerer.forEach((f) => f());
}

function standAbo(f: () => void): () => void {
  hoerer.add(f);
  return () => hoerer.delete(f);
}

const schluessel = (art: string, params: Record<string, string>) => `${art}?${new URLSearchParams(params).toString()}`;

async function holen(art: string, params: Record<string, string>): Promise<Antwort> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/seite/${encodeURIComponent(art)}${qs ? `?${qs}` : ""}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Seite ${art}: ${res.status}`);
  const json = (await res.json()) as { ok: boolean; daten?: unknown };
  if (!json.ok) throw new Error(`Seite ${art} abgewiesen`);
  return {
    daten: json.daten,
    ausCache: res.headers.get("x-schulapp-aus-cache") ? res.headers.get("x-schulapp-gespeichert") : null,
  };
}

/** Schon geladene Daten einer Seite (etwa die einer Stapelseite) in den Speicher legen. */
export function seitenDatenMerken(art: string, params: Record<string, string>, daten: unknown, ausCache: string | null): void {
  if (daten !== undefined) cache.set(schluessel(art, params), { daten, ausCache });
}

/** Eine Seite der Registry, die die Bühne selbst holt (Liste links, Detail rechts). */
export function GeladeneSeite({ art, params }: { art: string; params: Record<string, string> }) {
  const { daten, ausCache, ohneNetz } = useSeitenDaten(art, params);
  return <SeitenInhalt art={art} params={params} daten={daten} ausCache={ausCache} ohneNetz={ohneNetz} />;
}

/**
 * Die Daten einer Seite (`/api/seite/<art>`), nach jeder Action neu geholt
 * (`datenNeu`). Für Details, die ein Teil selbst rendert (die Aufgabe).
 */
export function useSeitenDaten(
  art: string,
  params: Record<string, string>,
): { daten: unknown; ausCache: string | null; ohneNetz: boolean } {
  const k = schluessel(art, params);
  const s = useSyncExternalStore(standAbo, () => stand, () => 0);
  const [geladen, setGeladen] = useState<{ k: string; a: Antwort } | null>(null);
  const [ohneNetz, setOhneNetz] = useState(false);
  useEffect(() => {
    let weg = false;
    holen(art, params).then(
      (a) => {
        cache.set(k, a);
        if (!weg) {
          setGeladen({ k, a });
          setOhneNetz(false);
        }
      },
      () => {
        if (!weg) setOhneNetz(true);
      },
    );
    return () => {
      weg = true;
    };
    // params steckt in k
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, art, s]);
  const a = geladen && geladen.k === k ? geladen.a : (cache.get(k) ?? null);
  return { daten: a?.daten, ausCache: a?.ausCache ?? null, ohneNetz: ohneNetz && !a };
}

// ── Auswahl ───────────────────────────────────────────────────────────────────

export { useAuswahl, type Auswahl } from "./auswahl";

// ── Detail-Slots der Teile ────────────────────────────────────────────────────

// Die Slots selbst stehen in auswahl.ts (ohne Kreis über die Registry)
export { detailSlotSetzen, type DetailSlot } from "./auswahl";

export function DetailAusSlot({ bereich, sel }: { bereich: Bereich; sel: string }) {
  return detailSlot(bereich)?.(sel) ?? null;
}

// ── Liste und Detail ──────────────────────────────────────────────────────────

export function ListeDetail({
  bereich,
  sel,
  liste,
  detail,
  detailKey,
}: {
  bereich: Bereich;
  sel: string | null;
  liste: ReactNode;
  detail: ReactNode;
  /** wechselt mit dem Gewählten: dann blendet das Detail über und steht oben */
  detailKey: string;
}) {
  const listeRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [detailEl, setDetailEl] = useState<HTMLDivElement | null>(null);
  const vorher = useRef(detailKey);

  // Detailwechsel: mit der Maus 140 ms Überblenden, mit der Tastatur keins
  useLayoutEffect(() => {
    if (vorher.current === detailKey) return;
    vorher.current = detailKey;
    const det = detailRef.current;
    if (!det) return;
    det.scrollTop = 0;
    const inhalt = det.firstElementChild;
    if (inhalt && !perTaste()) inhalt.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce() ? 120 : 140, easing: "ease-out" });
  }, [detailKey]);

  // Die gewählte Zeile bleibt im Bild
  useEffect(() => {
    if (!sel) return;
    const el = listeRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(sel)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  // ↑/↓ und j/k: die nächste Zeile mit data-id, wie ein Klick auf sie
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const runter = e.key === "ArrowDown" || e.key === "j";
      const hoch = e.key === "ArrowUp" || e.key === "k";
      if (!runter && !hoch) return;
      if (tipptGerade() || ueberlagert()) return;
      const zeilen = [...(listeRef.current?.querySelectorAll<HTMLElement>("[data-id]") ?? [])].filter((z) => z.offsetParent);
      if (!zeilen.length) return;
      e.preventDefault();
      const i = zeilen.findIndex((z) => z.dataset.id === sel);
      const j = i < 0 ? 0 : Math.max(0, Math.min(zeilen.length - 1, i + (runter ? 1 : -1)));
      if (j === i) return;
      const z = zeilen[j];
      // Aufgabenzeilen: der Text wählt aus, der Ring hakt ab
      const ziel = z.querySelector<HTMLElement>("[data-waehlen]") ?? z;
      ziel.click();
      z.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sel]);

  return (
    <div className="d-split">
      <div className="d-list" ref={listeRef}>
        <AuswahlKontext.Provider value={{ bereich, sel, detailEl }}>{liste}</AuswahlKontext.Provider>
      </div>
      <div
        className="d-detail"
        ref={(el) => {
          detailRef.current = el;
          setDetailEl(el);
        }}
      >
        {detail}
      </div>
    </div>
  );
}
