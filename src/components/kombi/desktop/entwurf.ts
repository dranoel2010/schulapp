"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { istDesktop } from "./use-desktop";

/**
 * Was in einem Formular getippt, aber noch nicht gespeichert ist, übersteht
 * das Queren der Desktop-Schwelle (1024 px). Handy und Rechner rendern die
 * Seiten in verschiedenen Bäumen (Stapel oder Bühne); quert das Fenster die
 * Schwelle, hängt sich das Formular neu ein und stünde wieder auf dem
 * gespeicherten Stand.
 *
 * Darum merkt sich die Shell jede Eingabe in Formularen unter `#pages` (je
 * Adresse, je Feldname) und spielt sie nach dem Wechsel in die neuen Felder
 * zurück, über dieselben Ereignisse wie eine Eingabe (React übernimmt sie in
 * seinen Zustand). Nach dem Absenden ist er weg.
 *
 * Am Rechner führt auch Zurück auf ein Formular wieder zu seinem Entwurf
 * (etwa: Aufgabe halb getippt, Noten angesehen, Zurück). Wer das Formular
 * neu öffnet (Link, Knopf), bekommt es leer. Am Handy bleibt das Formular
 * unter einer Seite darüber stehen und braucht das nicht.
 */

type Feld = { name: string; i: number; wert: string; an?: boolean };

const ART_OHNE = /^(hidden|file|submit|button|reset|image|password)$/;

type Eingabe = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function istFeld(el: EventTarget | null): el is Eingabe {
  return (
    (el instanceof HTMLInputElement && !ART_OHNE.test(el.type)) ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

/** Die wievielte Eingabe dieses Namens im Formular (Radiogruppen, Listen). */
function stelle(el: Eingabe): number {
  const form = el.form;
  if (!form || !el.name) return 0;
  return [...form.querySelectorAll<Eingabe>(`[name="${CSS.escape(el.name)}"]`)].indexOf(el);
}

function setzen(el: Eingabe, f: Feld): void {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    if (el.checked !== !!f.an) el.click();
    return;
  }
  if (el.value === f.wert) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, f.wert);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new Event("change", { bubbles: true }));
}

const adresse = () => `${window.location.pathname}${window.location.search}`;

export function useEntwurfUeberSchwelle(desktop: boolean, pfad: string): void {
  const entwuerfe = useRef(new Map<string, Map<string, Feld>>());
  const zurueckspielen = useRef(false);

  // Mitschreiben (ein Listener für alle Formulare der Seiten)
  useEffect(() => {
    const merken = (e: Event) => {
      if (zurueckspielen.current) return;
      const el = e.target;
      if (!istFeld(el) || !el.name || !el.form || !el.closest("#pages")) return;
      const k = adresse();
      let m = entwuerfe.current.get(k);
      if (!m) entwuerfe.current.set(k, (m = new Map()));
      const i = stelle(el);
      if (el instanceof HTMLInputElement && el.type === "radio") {
        // in einer Radiogruppe gilt nur die gewählte
        for (const [key, f] of m) if (f.name === el.name) m.delete(key);
      }
      m.set(`${el.name}#${i}`, { name: el.name, i, wert: el.value, an: el instanceof HTMLInputElement ? el.checked : undefined });
    };
    const abgeschickt = (e: Event) => {
      if (e.target instanceof HTMLFormElement && e.target.closest("#pages")) entwuerfe.current.delete(adresse());
    };
    document.addEventListener("input", merken, true);
    document.addEventListener("change", merken, true);
    document.addEventListener("submit", abgeschickt, true);
    return () => {
      document.removeEventListener("input", merken, true);
      document.removeEventListener("change", merken, true);
      document.removeEventListener("submit", abgeschickt, true);
    };
  }, []);

  // Zurück oder Vor (popstate) kommt auf einen Eintrag, den man schon kannte
  const ausPop = useRef(0);
  useEffect(() => {
    const pop = () => {
      ausPop.current = Date.now();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  // Eine andere Adresse: per Zurück am Rechner kommt der Entwurf wieder, sonst beginnt das Formular leer
  const [zurueckAuf, setZurueckAuf] = useState(0);
  useEffect(() => {
    const k = adresse();
    if (Date.now() - ausPop.current < 1500 && istDesktop()) {
      if (entwuerfe.current.get(k)?.size) setZurueckAuf((n) => n + 1);
    } else entwuerfe.current.delete(k);
    // nur die jüngsten Adressen behalten
    const keys = [...entwuerfe.current.keys()];
    keys.slice(0, Math.max(0, keys.length - 6)).forEach((x) => entwuerfe.current.delete(x));
  }, [pfad]);

  // Nach dem Wechsel über die Schwelle (oder Zurück am Rechner): den Entwurf in die neuen Felder
  const erstes = useRef(true);
  useLayoutEffect(() => {
    if (erstes.current) {
      erstes.current = false;
      return;
    }
    const m = entwuerfe.current.get(adresse());
    if (!m || !m.size) return;
    const offen = new Map(m);
    const versuch = () => {
      const pages = document.getElementById("pages");
      if (!pages) return;
      zurueckspielen.current = true;
      try {
        for (const [key, f] of offen) {
          const sel = `[name="${CSS.escape(f.name)}"]`;
          const form = [...pages.querySelectorAll("form")].find((x) => x.querySelectorAll(sel).length > f.i);
          const el = form?.querySelectorAll<Eingabe>(sel)[f.i];
          if (!istFeld(el ?? null)) continue;
          setzen(el as Eingabe, f);
          offen.delete(key);
        }
      } finally {
        zurueckspielen.current = false;
      }
    };
    versuch();
    // Inhalte, die erst nach dem Einhängen kommen (nachgeladene Seiten): noch zweimal
    const t1 = window.setTimeout(versuch, 120);
    const t2 = window.setTimeout(versuch, 500);
    const t3 = window.setTimeout(versuch, 1000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [desktop, zurueckAuf]);
}
