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

/**
 * Wohin der Fokus nach dem Schließen zurückgeht: der Auslöser selbst. Wurde
 * er inzwischen neu gerendert (nach dem Lernblock lädt das Detail neu, und
 * „Starten“ heißt dann „Weiter“), das Element an seiner Stelle: dasselbe
 * Tag mit denselben Klassen, das wievielte im Dokument. Ohne Auslöser ein
 * vorgemerkter (der Knopf „Blatt hochladen“ vor dem Dateidialog, nach dem
 * der Fokus auf body steht).
 */
type Ausloeser = { el: HTMLElement; sel: string; nr: number };

let vorgemerkt: { el: HTMLElement; bis: number } | null = null;

/** Den Auslöser einer Ebene vormerken, die erst nach einem Umweg aufgeht (Dateidialog). */
export function ausloeserVormerken(el: Element | null): void {
  vorgemerkt = el instanceof HTMLElement ? { el, bis: Date.now() + 120000 } : null;
}

function merken(el: HTMLElement | null): Ausloeser | null {
  if (!el || el === document.body) {
    const v = vorgemerkt;
    vorgemerkt = null;
    return v && v.bis > Date.now() && v.el.isConnected ? merken(v.el) : null;
  }
  // mit id (#whBtn, #lbBtn) eindeutig, sonst Tag und Klassen und das wievielte
  const sel = el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase() + [...el.classList].map((c) => `.${CSS.escape(c)}`).join("");
  return { el, sel, nr: [...document.querySelectorAll(sel)].indexOf(el) };
}

function wiederfinden(a: Ausloeser | null | undefined): HTMLElement | null {
  if (!a) return null;
  if (a.el.isConnected) return a.el;
  const statt = a.nr >= 0 ? document.querySelectorAll<HTMLElement>(a.sel)[a.nr] : undefined;
  return statt ?? null;
}

/**
 * Je Ebene: wer den Fokus vorher hatte. Außerhalb des Effekts, damit es das
 * Queren der Schwelle übersteht (Tisch auf, Fenster schmal und wieder breit,
 * Esc: der Fokus kommt trotzdem auf „Wiederholen“ zurück).
 */
const ausloeser = new Map<HTMLElement, Ausloeser | null>();

export function useUeberlagerungFokus(desktop: boolean): void {
  useEffect(() => {
    if (!desktop) return;
    // was am Handy zuging, hat keinen Auslöser mehr
    const offen = offeneEbenen();
    for (const el of [...ausloeser.keys()]) if (!offen.includes(el)) ausloeser.delete(el);
    /** Was wir selbst inert gemacht haben (nur das wird wieder frei). */
    const gesperrt = new Set<HTMLElement>();
    let oben: HTMLElement | null = null;
    let raf = 0;
    /** Kurz nach dem Zurückgeben: wird der Auslöser noch neu gerendert, folgt ihm der Fokus */
    let nachsorge: { a: Ausloeser; el: HTMLElement; bis: number } | null = null;

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
      if (nachsorge) {
        const n = nachsorge;
        if (Date.now() > n.bis || document.activeElement !== document.body) {
          if (Date.now() > n.bis || document.activeElement !== n.el) nachsorge = null;
        } else if (!n.el.isConnected) {
          const neuEl = wiederfinden({ ...n.a, el: n.el });
          if (neuEl && fokussierbar(neuEl)) {
            neuEl.focus({ preventScroll: true });
            nachsorge = { ...n, el: neuEl };
          }
        }
      }
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
        // ein Auslöser in der Ebene darunter zählt, solange sie offen bleibt (Blatt auf dem Tisch)
        if (!ausloeser.has(neu))
          ausloeser.set(neu, aktiv && !neu.contains(aktiv) ? (alt && alt.contains(aktiv) && !ebenen.includes(alt) ? null : merken(aktiv)) : merken(null));
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
        const ausloeserVon = ausloeser.get(alt);
        const zurueck = wiederfinden(ausloeserVon);
        ausloeser.delete(alt);
        const a = document.activeElement;
        const verloren = !a || a === document.body || alt.contains(a) || !!(a instanceof HTMLElement && a.closest("[inert]"));
        if (verloren) {
          if (neu) (zurueck && neu.contains(zurueck) && fokussierbar(zurueck) ? zurueck : erstesZiel(neu)).focus({ preventScroll: true });
          else {
            if (zurueck?.isConnected && fokussierbar(zurueck)) zurueck.focus({ preventScroll: true });
            if (ausloeserVon) nachsorge = { a: ausloeserVon, el: zurueck ?? ausloeserVon.el, bis: Date.now() + 2000 };
          }
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
