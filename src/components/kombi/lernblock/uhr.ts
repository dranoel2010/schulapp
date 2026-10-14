"use client";

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

import type { BlockDaten } from "@/lib/kombi/lernblock-daten";

/**
 * Die Uhr des Lernblocks im Client (Prototyp `blockRest`, `clockLoop`,
 * Z. 1363–1370, 4209–4221).
 *
 * Der Stand liegt am Server (`laeuft_seit`, `pausiert_seit`, `pause_ms`) und
 * übersteht so Schließen und Neuladen. Hier wird nur weitergezählt: Überblick,
 * Klausurseite und Tisch lesen denselben Block aus einem kleinen Speicher,
 * damit „Starten“, „Weiter“, die Restzeit und „Erledigt“ überall gleich
 * stehen — auch zwischen Action und Antwort des Servers (optimistisch).
 *
 * Gezählt wird mit der App-Uhr (`appJetzt()`), nicht mit der Uhr des Geräts
 * allein: der Server schreibt `laeuft_seit` mit `jetzt()`, mit Testuhr also
 * mit der Testuhr. Den Versatz bringen die Tagesdaten und jede Antwort der
 * Lernblock-Actions mit (`uhrVersatz()` in @/lib/tag, ohne Testuhr 0).
 */

export type Zustand = "ruhe" | "laeuft" | "pausiert" | "erledigt";

type Uhr = Pick<BlockDaten, "minuten" | "status" | "laeuftSeit" | "pausiertSeit" | "pauseMs" | "minutenGelernt">;

const ms = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

export function zustand(b: Uhr): Zustand {
  if (b.status === "done") return "erledigt";
  if (!b.laeuftSeit) return "ruhe";
  return b.pausiertSeit ? "pausiert" : "laeuft";
}

export const gesamtMs = (b: Pick<Uhr, "minuten">): number => b.minuten * 60_000;

/**
 * Gelaufene Zeit. Pausiert zählt sie bis `pausiertSeit` und hängt nicht von
 * „jetzt“ ab: Tisch (letzter Takt vor dem Anhalten) und Startseite (frisch
 * geladen) zeigen dieselbe Restzeit.
 */
export function gelaufenMs(b: Uhr, jetzt: number): number {
  const start = ms(b.laeuftSeit);
  if (start === null) return 0;
  const bis = ms(b.pausiertSeit) ?? jetzt;
  return Math.max(0, bis - start - b.pauseMs);
}

/** Restzeit, nie unter 0; ein erledigter Block steht. */
export function restMs(b: Uhr, jetzt: number): number {
  if (b.status === "done") {
    return b.minutenGelernt === null ? 0 : Math.max(0, gesamtMs(b) - b.minutenGelernt * 60_000);
  }
  return Math.max(0, gesamtMs(b) - gelaufenMs(b, jetzt));
}

/** Volle gelernte Minuten (Prototyp `blockMinuten`). */
export const gelernt = (b: Uhr, jetzt: number): number =>
  Math.floor(Math.min(gesamtMs(b), gelaufenMs(b, jetzt)) / 60_000);

/** „24:12“ (Prototyp `fmtRest`). */
export function fmtRest(rest: number): string {
  const s = Math.ceil(rest / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Starten oder Fortsetzen, sofort im Client (die Action folgt). */
export function gestartet(b: BlockDaten, jetzt: number): BlockDaten {
  const z = zustand(b);
  if (z === "ruhe") return { ...b, laeuftSeit: new Date(jetzt).toISOString(), pausiertSeit: null, pauseMs: 0 };
  if (z === "pausiert") return fortgesetzt(b, jetzt);
  return b;
}
export function pausiert(b: BlockDaten, jetzt: number): BlockDaten {
  return zustand(b) === "laeuft" ? { ...b, pausiertSeit: new Date(jetzt).toISOString() } : b;
}
export function fortgesetzt(b: BlockDaten, jetzt: number): BlockDaten {
  const p = ms(b.pausiertSeit);
  if (zustand(b) !== "pausiert" || p === null) return b;
  return { ...b, pausiertSeit: null, pauseMs: b.pauseMs + Math.max(0, jetzt - p) };
}

/**
 * Ist die Zeit eines laufenden Blocks um? Gerechnet mit `appJetzt()`, nicht
 * mit dem zuletzt gerenderten Takt: der kann von vor dem Setzen des Versatzes
 * stammen, und mit zurückgestellter Testuhr stünde der Rest sonst beim
 * Starten sofort auf 0.
 */
export function zeitUm(b: Uhr): boolean {
  return zustand(b) === "laeuft" && restMs(b, appJetzt()) <= 0;
}

// ── Speicher: ein Block, überall derselbe Stand ─────────────────────────────

const bloecke = new Map<string, BlockDaten>();
const hoerer = new Set<() => void>();
let fassung = 0;

function melden() {
  fassung += 1;
  hoerer.forEach((h) => h());
}

/** Neuer Stand eines Blocks (vom Server oder optimistisch). */
export function blockMerken(b: BlockDaten): void {
  bloecke.set(b.id, b);
  melden();
}

/** Ein Stand vom Server, mit dem Versatz seiner Uhr. */
export function blockVomServer(r: { block: BlockDaten; uhrVersatz: number }): void {
  appUhrStellen(r.uhrVersatz);
  blockMerken(r.block);
}

export function blockLesen(id: string): BlockDaten | undefined {
  return bloecke.get(id);
}

// ── App-Uhr: Uhr des Geräts plus Versatz zur Uhr des Servers ───────────────

let versatz = 0;

/** Versatz der App-Uhr zur Uhr des Geräts setzen (ms, vom Server). */
export function appUhrStellen(ms: number): void {
  if (!Number.isFinite(ms) || ms === versatz) return;
  versatz = ms;
  melden();
}

const versatzLesen = () => versatz;

/** „Jetzt“ der App in ms: mit Testuhr die Testuhr, sonst die Uhr des Geräts. */
export function appJetzt(): number {
  return Date.now() + versatz;
}

function abonnieren(h: () => void) {
  hoerer.add(h);
  return () => hoerer.delete(h);
}

/**
 * Der aktuelle Stand eines Blocks. Kommen neue Server-Daten (`vomServer`
 * ändert sich, etwa nach `neuLaden`), gelten sie.
 */
export function useBlock(vomServer: BlockDaten | null): BlockDaten | null {
  useEffect(() => {
    if (vomServer) blockMerken(vomServer);
  }, [vomServer]);
  useSyncExternalStore(
    abonnieren,
    () => fassung,
    () => 0,
  );
  if (!vomServer) return null;
  return bloecke.get(vomServer.id) ?? vomServer;
}

/**
 * Die Zeit in ganzen Sekunden, solange `aktiv` — angestoßen per
 * `requestAnimationFrame` wie `clockLoop`, sonst steht sie (kein Takt im
 * Leerlauf).
 */
export function useSekunde(aktiv: boolean): number {
  const [jetzt, setJetzt] = useState(appJetzt);
  const v = useSyncExternalStore(abonnieren, versatzLesen, () => 0);
  // Beim Anlaufen und wenn der Versatz kommt: sofort die App-Uhr, noch vor
  // dem Zeichnen (der Anfangswert stammt vom ersten Rendern, oft lange her
  // und ohne Versatz).
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Abgleich mit der App-Uhr, einmal je Anlauf
    if (aktiv) setJetzt(appJetzt());
  }, [aktiv, v]);
  useEffect(() => {
    if (!aktiv) return;
    let raf = 0;
    let letzte = -1;
    const schritt = () => {
      const t = appJetzt();
      const s = Math.floor(t / 1000);
      if (s !== letzte) {
        letzte = s;
        setJetzt(t);
      }
      raf = requestAnimationFrame(schritt);
    };
    raf = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(raf);
  }, [aktiv]);
  // Steht die Uhr (Ruhe, Pause, erledigt), hängt die Restzeit nicht von
  // „jetzt“ ab — der alte Wert genügt.
  return jetzt;
}
