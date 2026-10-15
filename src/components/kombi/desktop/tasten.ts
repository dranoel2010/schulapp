"use client";

import { useEffect, useRef } from "react";

import { BEREICHE, type Bereich } from "./bereiche";

/**
 * Die Tastatur am Rechner (desktop.html, „Tastatur“): `/` oder Strg/Cmd+K
 * öffnen die Zeile, 1 bis 7 wechseln den Bereich. ↑/↓ und j/k in der Liste
 * hängt liste-detail.tsx ein, die Tasten auf dem Tisch der Teil „Tisch“.
 *
 * Alles ist aus, solange ein Eingabefeld den Fokus hat oder Tisch, Kamera,
 * Sheet oder Dialog offen sind. Was per Tastatur passiert, bewegt sich nicht:
 * `perTaste()` sagt den Übergängen, ob die letzte Eingabe eine Taste war.
 */

let letzte: "maus" | "taste" = "maus";
let gemerkt = false;

/** Merkt sich, ob zuletzt Maus (oder Finger) oder Tastatur benutzt wurde. */
export function eingabeMerken(): void {
  if (gemerkt || typeof window === "undefined") return;
  gemerkt = true;
  window.addEventListener(
    "pointerdown",
    () => {
      letzte = "maus";
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.repeat || letzte !== "taste") letzte = "taste";
    },
    { capture: true },
  );
}

/** War die letzte Eingabe eine Taste? Dann gibt es keinen Übergang. */
export function perTaste(): boolean {
  return letzte === "taste";
}

/** Steht der Fokus in einem Feld, in das man tippt? */
export function tipptGerade(): boolean {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement)) return false;
  return a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
}

/** Liegt etwas über der Bühne (Tisch, Kamera, Sheet, Dialog, Bestätigung, Menü der Zeile)? */
export function ueberlagert(): boolean {
  return !!document.querySelector(".tisch.open, .cam.open, #sheet.open, .d-dlg.on, body > .t-confirm.on, #menu.open");
}

/**
 * Die globalen Kürzel. `zeile` öffnet die Zeile, `bereich` wechselt den
 * Bereich (mit `taste: true`, also ohne Übergang). Nur, solange `aktiv`.
 *
 * Strg/Cmd+P druckt nur, wo es etwas zu drucken gibt (das Arbeitsblatt in
 * `#druck`); sonst käme eine leere Seite, und `ohneDruck` sagt es stattdessen.
 */
export function useTasten(aktiv: boolean, zeile: () => void, bereich: (b: Bereich) => void, ohneDruck: () => void): void {
  const fn = useRef({ zeile, bereich, ohneDruck });
  useEffect(() => {
    fn.current = { zeile, bereich, ohneDruck };
  }, [zeile, bereich, ohneDruck]);
  useEffect(() => {
    eingabeMerken();
    if (!aktiv) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && k === "p") {
        if (!document.querySelector("#druck > *")) {
          e.preventDefault();
          fn.current.ohneDruck();
        }
        return;
      }
      if (tipptGerade() || ueberlagert()) return;
      if (e.key === "/" || ((e.metaKey || e.ctrlKey) && k === "k")) {
        e.preventDefault();
        fn.current.zeile();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      const b = BEREICHE.find((x) => x.taste === n);
      if (b) {
        e.preventDefault();
        fn.current.bereich(b.key);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aktiv]);
}
