"use client";

import { reduce } from "@/lib/kombi/motion";

import { ausloeserVormerken } from "./fokus";

/**
 * Kurze Fragen am Rechner (desktop.html `dialog`): dieselbe Sheet-Komponente
 * der Shell, ab 1024 px als Dialog in der Mitte statt als Bogen von unten.
 * Die Sheet-Inhalte bleiben gleich; die Gestalt kommt aus `.sheet.d-dlg` in
 * src/app/desktop/grund.css (bis 560 px breit, Einblenden 160 ms, scale .97
 * in 200 ms). Esc und ein Klick auf den Scrim schließen ihn (die Shell), der
 * Fokus springt auf den ersten Knopf und danach zurück.
 */

const ZIELE = "button:not([disabled]), [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1'])";
const fokusVorher = new WeakMap<HTMLElement, HTMLElement | null>();

export function dialogAuf(el: HTMLElement, scrim: HTMLElement | null): void {
  el.getAnimations().forEach((a) => a.cancel());
  el.style.transform = "";
  fokusVorher.set(el, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  // fokus.ts sieht den Dialog erst, wenn der Fokus schon darin steht: der Auslöser ist vorgemerkt
  // (ohne Fokus, etwa nach dem Dateidialog, bleibt der vorgemerkte „Hochladen“ stehen)
  if (document.activeElement && document.activeElement !== document.body) ausloeserVormerken(document.activeElement);
  el.classList.add("open");
  // ein Bild später, damit die Übergänge von „zu“ nach „auf“ laufen
  requestAnimationFrame(() => {
    el.classList.add("on");
    scrim?.classList.add("on");
    // das erste sichtbare (das Schließen gibt es nur beim Blatt auf dem Tisch)
    [...el.querySelectorAll<HTMLElement>(ZIELE)].find((z) => z.getClientRects().length > 0)?.focus({ preventScroll: true });
  });
}

/** Schließt den Dialog; das Versprechen erfüllt sich, wenn er ausgeblendet ist. */
export function dialogZu(el: HTMLElement, scrim: HTMLElement | null): Promise<void> {
  el.classList.remove("on");
  scrim?.classList.remove("on");
  const zurueck = fokusVorher.get(el);
  if (zurueck?.isConnected) zurueck.focus({ preventScroll: true });
  return new Promise((fertig) =>
    window.setTimeout(() => {
      if (!el.classList.contains("on")) el.classList.remove("open");
      fertig();
    }, reduce() ? 120 : 200),
  );
}
