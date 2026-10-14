"use client";

import { useEffect } from "react";

import { istDesktop } from "./use-desktop";

/**
 * Der Fokus am Rechner, wenn etwas über der Bühne liegt (Tisch, Kamera,
 * Dialog, Bestätigung): Was darunter liegt, ist `inert` (nicht per Tab
 * erreichbar, nicht bedienbar), der Fokus springt beim Öffnen hinein und
 * beim Schließen zurück auf den Auslöser. Am Handy tut dieser Teil nichts.
 *
 * Die Ebenen melden sich nicht an: ein MutationObserver liest die Klassen,
 * mit denen die Ebenen ohnehin auf- und zugehen (dieselben wie `ueberlagert()`
 * in tasten.ts).
 */

/** Von oben nach unten: was weiter vorn steht, liegt über dem Rest. */
const EBENEN = ["body > .t-confirm.on", "#sheet.open", ".d-dlg.on", ".cam.open", ".tisch.open"];

const ZIELE =
  "button:not([disabled]):not([hidden]), [href], input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])";

function offeneEbenen(): HTMLElement[] {
  const alle: HTMLElement[] = [];
  for (const s of EBENEN) {
    document.querySelectorAll<HTMLElement>(s).forEach((el) => {
      if (!alle.includes(el)) alle.push(el);
    });
  }
  return alle;
}

function fokussierbar(el: HTMLElement): boolean {
  if (el.closest("[inert]")) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Wohin der Fokus in einer Ebene geht: in Dialogen auf das erste sichtbare
 * Bedienelement, auf Tisch und Kamera auf die Fläche selbst (dort gehören
 * Leertaste und Enter den Tasten des Tisches, nicht dem Knopf „Schließen“;
 * der nächste Tab führt zum ersten Knopf).
 */
export function erstesZiel(ebene: HTMLElement): HTMLElement {
  const flaeche = ebene.matches(".tisch, .cam");
  const z = flaeche ? undefined : [...ebene.querySelectorAll<HTMLElement>(ZIELE)].find(fokussierbar);
  if (z) return z;
  if (!ebene.hasAttribute("tabindex")) ebene.setAttribute("tabindex", "-1");
  return ebene;
}

export function useUeberlagerungFokus(desktop: boolean): void {
  useEffect(() => {
    if (!desktop) return;
    /** Was wir selbst inert gemacht haben (nur das wird wieder frei). */
    const gesperrt = new Set<HTMLElement>();
    /** Je Ebene: wer den Fokus vorher hatte. */
    const ausloeser = new WeakMap<HTMLElement, HTMLElement | null>();
    let oben: HTMLElement | null = null;
    let raf = 0;

    const sperren = (el: HTMLElement | null, an: boolean) => {
      if (!el) return;
      if (an && !el.inert) {
        el.inert = true;
        gesperrt.add(el);
      } else if (!an && gesperrt.has(el)) {
        el.inert = false;
        gesperrt.delete(el);
      }
    };

    const abgleichen = () => {
      raf = 0;
      if (!istDesktop()) return;
      const ebenen = offeneEbenen();
      const neu = ebenen[0] ?? null;
      const desk = document.getElementById("desk");
      sperren(desk, !!neu);
      // offene Ebenen unter der obersten (ein Sheet auf dem Tisch) sind ebenfalls gesperrt
      for (const el of [...gesperrt]) if (el !== desk && (!ebenen.includes(el) || el === neu)) sperren(el, false);
      ebenen.slice(1).forEach((el) => sperren(el, true));
      if (neu === oben) return;
      const alt = oben;
      oben = neu;
      const aktiv = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (neu) {
        if (!ausloeser.has(neu)) ausloeser.set(neu, aktiv && !neu.contains(aktiv) ? (alt && alt.contains(aktiv) ? null : aktiv) : null);
        if (!aktiv || aktiv === document.body || !neu.contains(aktiv)) {
          // ein Bild später: die Ebene blendet per visibility ein
          requestAnimationFrame(() => {
            if (oben !== neu) return;
            const a = document.activeElement;
            if (a && a !== document.body && neu.contains(a)) return;
            erstesZiel(neu).focus({ preventScroll: true });
          });
        }
      }
      if (alt && !ebenen.includes(alt)) {
        const zurueck = ausloeser.get(alt);
        ausloeser.delete(alt);
        const a = document.activeElement;
        const verloren = !a || a === document.body || alt.contains(a) || !!(a instanceof HTMLElement && a.closest("[inert]"));
        if (verloren) {
          if (neu) erstesZiel(neu).focus({ preventScroll: true });
          else if (zurueck?.isConnected && fokussierbar(zurueck)) zurueck.focus({ preventScroll: true });
        }
      }
    };

    const planen = () => {
      if (!raf) raf = requestAnimationFrame(abgleichen);
    };
    // Tab bleibt in der obersten Ebene: vom letzten Element zum ersten und umgekehrt
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented || !oben || !istDesktop()) return;
      const ziele = [...oben.querySelectorAll<HTMLElement>(ZIELE)].filter(fokussierbar);
      if (!ziele.length) return;
      const a = document.activeElement;
      const i = a instanceof HTMLElement ? ziele.indexOf(a) : -1;
      const draussen = !(a instanceof HTMLElement) || !oben.contains(a);
      if (e.shiftKey && (i === 0 || a === oben || draussen)) {
        e.preventDefault();
        ziele[ziele.length - 1].focus();
      } else if (!e.shiftKey && (i === ziele.length - 1 || draussen)) {
        e.preventDefault();
        ziele[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const mo = new MutationObserver(planen);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    planen();
    return () => {
      mo.disconnect();
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      gesperrt.forEach((el) => (el.inert = false));
      gesperrt.clear();
    };
  }, [desktop]);
}
