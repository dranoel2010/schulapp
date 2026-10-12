"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";

import { E, reduce } from "@/lib/kombi/motion";
import { esc } from "@/lib/kombi/text";

/**
 * Die Überschrift der Startseite (Prototyp `setHeadline`, Z. 1648): beide
 * Fassungen liegen in einer Rasterzelle (`h1.hl .swap`), damit alt und neu
 * gleichzeitig stehen können, ohne dass sich die Höhe verschiebt.
 *
 * - Tageszeitwechsel (`dir` ±1): alt 120 ms aus, neu 24 px aus der
 *   Zeitrichtung in 260 ms (13.3 Nr. 3).
 * - Zahl ändert sich (`dir` 0): alt 100 ms aus, neu 160 ms ein (Nr. 4).
 *
 * Der Inhalt gehört nach dem ersten Malen allein diesem Baustein: React
 * schreibt ihn einmal (Server und Kaltstart), danach tauscht `setzen()`.
 */

export type UeberschriftApi = {
  setzen: (text: string, dir: number, sofort?: boolean) => void;
};

export function Ueberschrift({ start, apiRef }: { start: string; apiRef: Ref<UeberschriftApi> }) {
  const elRef = useRef<HTMLHeadingElement>(null);
  // nur beim ersten Malen — React fasst den Inhalt danach nicht mehr an
  const [html] = useState(() => (start ? `<span class="swap">${esc(start)}</span>` : ""));

  useImperativeHandle(apiRef, () => ({
    setzen(text, dir, sofort) {
      const hEl = elRef.current;
      if (!hEl) return;
      const cur = [...hEl.querySelectorAll<HTMLElement>(".swap")].filter((e) => !e.classList.contains("out")).pop();
      if (cur && cur.textContent === text) return;
      const neu = () => {
        const s = document.createElement("span");
        s.className = "swap";
        s.textContent = text;
        return s;
      };
      if (sofort || !cur || reduce()) {
        if (cur && !sofort && reduce()) {
          cur.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100 }).onfinish = () => {
            cur.textContent = text;
            cur.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
          };
          return;
        }
        hEl.replaceChildren(neu());
        return;
      }
      hEl.querySelectorAll(".out").forEach((e) => e.remove());
      cur.classList.add("out");
      const n = neu();
      hEl.append(n);
      if (dir) {
        cur.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" }).onfinish = () =>
          cur.remove();
        n.animate([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: "none" }], {
          duration: 260,
          easing: E.out,
        });
      } else {
        cur.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "ease-out", fill: "forwards" }).onfinish = () =>
          cur.remove();
        n.animate([{ opacity: 0 }, { opacity: 0, offset: 0.385 }, { opacity: 1 }], { duration: 260, easing: E.out });
      }
    },
  }));

  return <h1 className="hl enter" id="h1" ref={elRef} dangerouslySetInnerHTML={{ __html: html }} />;
}
