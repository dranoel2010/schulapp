"use client";

import { E, reduce } from "@/lib/kombi/motion";

import { perTaste, tipptGerade } from "./tasten";
import { istDesktop } from "./use-desktop";

/**
 * Der Tisch am Rechner (desktop.html, „Tisch in Fensterbreite“): Tasten,
 * Öffnen und Schließen, Platz für die Karte. Alles hier wirkt nur ab
 * 1024 px (`istDesktop()`); am Handy bleibt der Tisch, wie er ist.
 *
 * Tasten auf dem offenen Tisch: Leertaste deckt auf, 1 oder ← heißt
 * Daneben, 2, → oder Leertaste heißt Saß, P druckt das Blatt. Esc schließt
 * (das macht jeder Tisch selbst). Die Tasten drücken dieselben Knöpfe wie
 * die Maus, damit Karten und Blatt nur einen Weg kennen.
 */

let tastenAn = false;

const offen = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && !el.inert && getComputedStyle(el).visibility === "visible";

function onKey(e: KeyboardEvent): void {
  if (!istDesktop() || e.defaultPrevented || e.isComposing || e.repeat) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tisch = document.querySelector<HTMLElement>(".tisch.open");
  if (!tisch) return;
  // Ein Sheet oder Dialog auf dem Tisch, eine Rückfrage, ein Feld: dort gehören die Tasten nicht dem Tisch
  if (document.querySelector("#sheet.open, .d-dlg.on") || tisch.querySelector(".t-confirm.on, .tb-lupe:not([hidden])")) return;
  if (tipptGerade()) return;
  const k = e.key;
  if (k === "p" || k === "P") {
    const b = tisch.querySelector<HTMLElement>('[data-taste="p"]');
    if (b && b.offsetParent && b.getAttribute("aria-disabled") !== "true") {
      e.preventDefault();
      b.click();
    }
    return;
  }
  const ask = tisch.querySelector(".t-ask");
  const rate = tisch.querySelector(".t-rate");
  if (!(ask instanceof HTMLElement) || !ask.offsetParent || tisch.classList.contains("ended")) return;
  if (k === " " && offen(ask)) {
    e.preventDefault();
    ask.querySelector<HTMLElement>(".rb.known")?.click();
    return;
  }
  if (!offen(rate)) return;
  if (k === "1" || k === "ArrowLeft") {
    e.preventDefault();
    rate.querySelector<HTMLElement>(".rb:not(.known)")?.click();
  } else if (k === "2" || k === "ArrowRight" || k === " ") {
    e.preventDefault();
    rate.querySelector<HTMLElement>(".rb.known")?.click();
  }
}

/** Die Tasten des Tisches einschalten (einmal je Seite, egal wie viele Tische es gibt). */
export function tischTastenAn(): void {
  if (tastenAn || typeof window === "undefined") return;
  tastenAn = true;
  document.addEventListener("keydown", onKey);
}

function sichtbar(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected || !el.offsetParent) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

function vomKnopf(tisch: HTMLElement, r: DOMRect): string {
  const tr = tisch.getBoundingClientRect();
  return `translate(${r.left - tr.left}px,${r.top - tr.top}px) scale(${r.width / tr.width},${r.height / tr.height})`;
}

/**
 * Am Rechner wächst die Fläche aus dem gedrückten Knopf (transform vom
 * Knopf-Rechteck, 420 ms, ease-drawer), der Inhalt blendet nach 40 % ein.
 * Bei reduzierter Bewegung, ohne Knopf oder per Tastatur nur 160 ms
 * Überblenden. Gibt `false` zurück, wenn es nicht der Rechner ist: dann
 * öffnet der Tisch wie am Handy.
 */
export function tischAufRechner(
  tisch: HTMLElement,
  flaeche: HTMLElement | null,
  inhalt: (HTMLElement | null)[],
  knopf: HTMLElement | null | undefined,
): boolean {
  if (!istDesktop()) return false;
  [tisch, flaeche, ...inhalt].forEach((x) => x?.getAnimations().forEach((a) => a.cancel()));
  if (reduce() || perTaste() || !flaeche || !sichtbar(knopf)) {
    tisch.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease" });
    return true;
  }
  flaeche.animate([{ transform: vomKnopf(tisch, knopf.getBoundingClientRect()), borderRadius: "26px" }, { transform: "none", borderRadius: "0px" }], {
    duration: 420,
    easing: E.drawer,
  });
  inhalt.forEach((x) =>
    x?.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 0, offset: 0.4 }, { opacity: 1, transform: "none" }], {
      duration: 460,
      easing: E.out,
    }),
  );
  return true;
}

/**
 * Schließen am Rechner: der Inhalt geht in 140 ms, die Fläche schrumpft in
 * den Knopf zurück (300 ms). Ohne sichtbaren Knopf oder bei reduzierter
 * Bewegung nur Überblenden. `fertig` läuft danach (auch bei Abbruch).
 */
export function tischZuRechner(
  tisch: HTMLElement,
  flaeche: HTMLElement | null,
  inhalt: (HTMLElement | null)[],
  knopf: HTMLElement | null | undefined,
  fertig: () => void,
): boolean {
  if (!istDesktop()) return false;
  if (reduce() || perTaste() || !flaeche || !sichtbar(knopf)) {
    tisch.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease", fill: "forwards" }).finished.then(fertig, fertig);
    return true;
  }
  inhalt.forEach((x) => x?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" }));
  flaeche
    .animate(
      [
        { transform: "none", borderRadius: "0px", opacity: 1 },
        { transform: vomKnopf(tisch, knopf.getBoundingClientRect()), borderRadius: "26px", opacity: 0 },
      ],
      { duration: 300, easing: E.grow, fill: "forwards" },
    )
    .finished.then(fertig, fertig);
  return true;
}

/**
 * Platz für die Karte am Rechner: bis zum unteren Rand, abzüglich Abstand
 * (56), Knöpfe (64) und Rand (32). Die Karte ist so hoch wie ihr Inhalt
 * (Vorder- und Rückseite), ohne den Deckel des Handys. Am Handy `null`.
 */
export function kartenPlatzRechner(stack: HTMLElement): number | null {
  if (!istDesktop()) return null;
  return Math.max(240, window.innerHeight - stack.getBoundingClientRect().top - 56 - 64 - 32);
}
