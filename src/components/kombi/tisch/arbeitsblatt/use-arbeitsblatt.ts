"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  auswertenAction,
  bewertenAction,
  blattStandAction,
  gedrucktAction,
} from "@/app/(app)/arbeitsblatt-actions";
import type { Auswertung, BlattStand } from "@/lib/arbeitsblatt/ablauf";
import type { FehlerToast } from "@/lib/kombi/aktion";
import { RUECKSPRUNG_MS } from "@/lib/kombi/aktion";

/**
 * Der Stand eines Arbeitsblatts auf dem Tisch (Plan H): nachfragen
 * bis zu einem Endstatus (alle 3 s, nur solange der Server es sagt),
 * drucken, werten, auswerten. Wiederholen und Lernblock teilen sich den
 * Stand über die Datenbank: wer im einen gedruckt hat, landet im anderen
 * direkt bei „Wie lief es?“.
 *
 * Optimistisch wie 2.4, Punkt 9: eine Wertung steht sofort; scheitert sie,
 * kommt erst der Toast „Nicht gespeichert“ mit „Erneut“, dann springt sie
 * zurück.
 */

export type BlattPhase = "vorschau" | "bewerten" | "fertig";

/** Was auf dem Tisch liegt: ein Stand, mit dem der Tisch geöffnet wurde (`nr` zählt jedes Öffnen). */
export type BlattAnfang = { stand: BlattStand; nr: number };

export type BlattLage = { art: "zu" } | { art: "da"; stand: BlattStand };

const NACHFRAGEN_MS = 3000;

export function phaseVon(stand: BlattStand): BlattPhase {
  if (stand.ausgewertetAm) return "fertig";
  if (stand.gedrucktAm) return "bewerten";
  return "vorschau";
}

/**
 * Der Tisch öffnet erst, wenn der Stand da ist (Plan 2.4, Punkt 7: scheitert
 * das Öffnen, geht keine Ebene auf) — der Hook bekommt ihn fertig mit.
 */
export function useArbeitsblatt(anfang: BlattAnfang | null, fehlerToast: FehlerToast) {
  const [lage, setLage] = useState<BlattLage>({ art: "zu" });
  const [wertung, setWertung] = useState<Record<number, boolean>>({});
  const [phase, setPhase] = useState<BlattPhase>("vorschau");
  const [auswertung, setAuswertung] = useState<Auswertung | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Ein neuer Anfang (Öffnen, „Weiter mit …“): Stand, Wertung und Phase von vorn
  const [vorher, setVorher] = useState<BlattAnfang | null>(null);
  if (anfang !== vorher) {
    setVorher(anfang);
    setLage(anfang ? { art: "da", stand: anfang.stand } : { art: "zu" });
    setWertung(anfang?.stand.wertung ?? {});
    setPhase(anfang ? phaseVon(anfang.stand) : "vorschau");
    setAuswertung(null);
  }

  // Nachfragen bis zum Endstatus (oder bis die Frist um ist — dann sagt der Server `weiter: false`)
  const standId = lage.art === "da" ? lage.stand.id : null;
  const weiter = lage.art === "da" && lage.stand.weiter;
  const nr = anfang?.nr ?? null;
  useEffect(() => {
    if (!standId || !weiter) return;
    let ab = false;
    timer.current = setTimeout(async () => {
      try {
        const antwort = await blattStandAction(standId);
        if (ab || !antwort.ok || !antwort.daten) return;
        const stand = antwort.daten;
        setLage((l) => (l.art === "da" && l.stand.id === stand.id ? { art: "da", stand } : l));
      } catch {
        // Ohne Netz: beim nächsten Öffnen wieder
      }
    }, NACHFRAGEN_MS);
    return () => {
      ab = true;
      clearTimeout(timer.current);
    };
  }, [standId, weiter, lage, nr]);

  /** „Arbeitsblatt drucken“ ist gedrückt: der Stand wechselt auf „Wie lief es?“. */
  const gedruckt = useCallback(async () => {
    if (lage.art !== "da") return;
    const id = lage.stand.id;
    const vorher = phase;
    if (vorher === "vorschau") setPhase("bewerten");
    const antwort = await gedrucktAction(id).catch(() => null);
    if (antwort?.ok) {
      setLage((l) => (l.art === "da" && l.stand.id === id ? { art: "da", stand: { ...l.stand, gedrucktAm: antwort.daten.gedrucktAm } } : l));
    }
    // Scheitert nur der Vermerk, bleibt „Wie lief es?“: gedruckt ist das Blatt trotzdem.
  }, [lage, phase]);

  const bewerten = useCallback(
    function bewerten(nr: number, richtig: boolean) {
      if (lage.art !== "da") return;
      const id = lage.stand.id;
      const alt = wertung[nr];
      setWertung((w) => ({ ...w, [nr]: richtig }));
      void bewertenAction(id, nr, richtig)
        .then((a) => {
          if (!a.ok) throw new Error(a.fehler);
        })
        .catch(() => {
          fehlerToast("Nicht gespeichert", () => bewerten(nr, richtig), "Erneut");
          setTimeout(() => {
            setWertung((w) => {
              const n = { ...w };
              if (alt === undefined) delete n[nr];
              else n[nr] = alt;
              return n;
            });
          }, RUECKSPRUNG_MS);
        });
    },
    [lage, wertung, fehlerToast],
  );

  const auswerten = useCallback(
    async function auswerten(imBlock: boolean): Promise<Auswertung | null> {
      if (lage.art !== "da") return null;
      const antwort = await auswertenAction(lage.stand.id, imBlock).catch(() => null);
      if (!antwort?.ok) {
        fehlerToast("Nicht gespeichert", () => void auswerten(imBlock), "Erneut");
        return null;
      }
      setAuswertung(antwort.daten);
      setPhase("fertig");
      return antwort.daten;
    },
    [lage, fehlerToast],
  );

  return { lage, wertung, phase, setPhase, gedruckt, bewerten, auswerten, auswertung };
}
