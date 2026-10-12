"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Icon } from "@/components/kombi/icon";
import type { AufgabeKurz } from "@/lib/kombi/ablauf";
import { E, SPRING, moveTo, reduce } from "@/lib/kombi/motion";
import { kurz as kurzDatum } from "@/lib/kombi/text";

/**
 * Die Aufgabenzeile im Ablauf (Prototyp `taskRow`, Z. 1727–1900) in den Modi
 * `ab` (mit Fach) und `subj` (unter einer Fachzeile, ohne Fach): abhaken,
 * Wisch nach rechts hakt ab, Linkswisch öffnet „Bearbeiten“ und „Löschen“,
 * durchgestrichen wird nur der Aufgabentext.
 *
 * Abschnitt B baut dieselbe Zeile für alle Modi (`aufgabe-zeile.tsx`); beim
 * Zusammenführen ersetzt sie diese hier, das Markup ist dasselbe.
 */

const ACT = 176 + 10;
let offeneZeile: HTMLElement | null = null;
let schlucken = false;

function closeActions(row: HTMLElement | null, instant = false) {
  if (!row) return;
  const f = row.querySelector<HTMLElement>(".t-front");
  if (!f) return;
  const anim = moveTo(f, { transform: "translateX(0px)" }, instant || reduce() ? { duration: 0 } : SPRING);
  anim.finished.then(() => row.classList.remove("open-l"), () => {});
  if (offeneZeile === row) offeneZeile = null;
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      if (schlucken) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (offeneZeile && !t?.closest(".t-acts") && t?.closest(".task") !== offeneZeile) closeActions(offeneZeile);
    },
    true,
  );
}

/** Striche über den Zeilen des Aufgabentexts (Prototyp `drawStrikes`, Z. 1749). */
function drawStrikes(row: HTMLElement, animate: boolean) {
  row.querySelectorAll(".strike").forEach((s) => s.remove());
  const title = row.querySelector<HTMLElement>(".t-txt");
  const host = row.querySelector<HTMLElement>(".t-text");
  if (!title || !host || !title.offsetParent) return;
  const rg = document.createRange();
  rg.selectNodeContents(title);
  const lines: { left: number; right: number; top: number; bottom: number }[] = [];
  [...rg.getClientRects()].forEach((r) => {
    if (r.width < 1) return;
    const l = lines.find((x) => Math.abs(x.top - r.top) < 4);
    if (l) {
      l.left = Math.min(l.left, r.left);
      l.right = Math.max(l.right, r.right);
      l.bottom = Math.max(l.bottom, r.bottom);
    } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  });
  const hb = host.getBoundingClientRect();
  lines.forEach((r, i) => {
    const s = document.createElement("i");
    s.className = "strike";
    s.setAttribute("aria-hidden", "true");
    s.style.left = `${r.left - hb.left}px`;
    s.style.width = `${r.right - r.left}px`;
    s.style.top = `${r.top - hb.top + (r.bottom - r.top) * 0.55}px`;
    host.append(s);
    if (animate) {
      s.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
        duration: reduce() ? 120 : 260,
        delay: reduce() ? 0 : 60 + i * 60,
        easing: E.out,
        fill: "backwards",
      });
    }
  });
}

export function AufgabeZeile({
  a,
  mode,
  heute,
  festerSub = false,
  onAbhaken,
  onLoeschen,
  onBearbeiten,
}: {
  a: AufgabeKurz;
  mode: "ab" | "subj";
  heute: string;
  /**
   * Die Unterzeile bleibt beim Abhaken stehen (Prototyp: `setSub` läuft nur
   * beim Anlegen der Zeile); erst in „Erledigt“ steht die Zeile ohne sie.
   */
  festerSub?: boolean;
  onAbhaken: (a: AufgabeKurz, erledigt: boolean) => void;
  onLoeschen: (a: AufgabeKurz) => void;
  onBearbeiten: (a: AufgabeKurz) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const done = !!a.done;
  const vorher = useRef<boolean | null>(null);

  // Striche: beim Abhaken gezeichnet, beim Wiederöffnen weg
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const war = vorher.current;
    vorher.current = done;
    if (done) {
      if (war === false || !row.querySelector(".strike")) requestAnimationFrame(() => drawStrikes(row, war === false));
    } else row.querySelectorAll(".strike").forEach((s) => s.remove());
  }, [done, a.text]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || !done) return;
    // auch beim ersten Sichtbarwerden (die Ebene war display:none): die Striche brauchen gemessene Zeilen
    const ro = new ResizeObserver(() => drawStrikes(row, false));
    ro.observe(row);
    return () => ro.disconnect();
  }, [done]);

  // Wisch: folgt dem Finger, Achse nach 10 px, Start erst ab 24 px vom linken Rand
  const wisch = useRef<{
    id: number;
    x0: number;
    y0: number;
    base: number;
    drag: boolean;
    edge: boolean;
    hist: [number, number][];
    x: number;
  } | null>(null);

  const runter = (e: React.PointerEvent<HTMLDivElement>) => {
    const front = frontRef.current;
    const row = rowRef.current;
    if (!front || !row || e.button > 0 || wisch.current) return;
    if (offeneZeile && offeneZeile !== row) closeActions(offeneZeile);
    const appLeft = document.getElementById("app")?.getBoundingClientRect().left ?? 0;
    const m = new DOMMatrixReadOnly(getComputedStyle(front).transform);
    wisch.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      base: m.m41,
      drag: false,
      edge: e.clientX - appLeft < 24,
      hist: [[e.timeStamp, m.m41]],
      x: m.m41,
    };
  };
  const ziehen = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = wisch.current;
    const front = frontRef.current;
    const row = rowRef.current;
    if (!st || !front || !row || e.pointerId !== st.id) return;
    const mx = e.clientX - st.x0;
    const my = e.clientY - st.y0;
    if (!st.drag) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
        wisch.current = null;
        return;
      }
      if (Math.abs(mx) < 10) return;
      if (st.edge && mx > 0 && st.base >= 0) {
        wisch.current = null;
        return;
      }
      st.drag = true;
      st.x0 = e.clientX - mx;
      front.getAnimations().forEach((x) => x.cancel());
      try {
        front.setPointerCapture(e.pointerId);
      } catch {
        // ohne Capture geht es auch
      }
    }
    const raw = st.base + (e.clientX - st.x0);
    const W = row.offsetWidth;
    let x: number;
    if (raw >= 0) x = done ? (raw * 40) / (40 + raw) : raw;
    else if (raw > -ACT) x = raw;
    else {
      const o = -raw - ACT;
      x = -ACT - (o * 40) / (40 + o);
    }
    st.x = x;
    front.style.transform = `translateX(${x}px)`;
    row.classList.toggle("drag-r", x > 0);
    row.classList.toggle("drag-l", x < 0);
    row.classList.toggle("past", x > W * 0.3);
    st.hist.push([e.timeStamp, x]);
    if (st.hist.length > 5) st.hist.shift();
  };
  const los = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = wisch.current;
    const front = frontRef.current;
    const row = rowRef.current;
    if (!s || !front || !row || e.pointerId !== s.id) return;
    wisch.current = null;
    if (!s.drag) return;
    schlucken = true;
    setTimeout(() => (schlucken = false), 60);
    const [ta, xa] = s.hist[0];
    const [tb, xb] = s.hist[s.hist.length - 1];
    const v = (xb - xa) / Math.max(1, tb - ta);
    const W = row.offsetWidth;
    const commit = !done && s.x > 0 && (s.x > W * 0.3 || v > 0.6) && e.type !== "pointercancel";
    const openL = s.x < 0 && (s.x < -ACT / 2 || v < -0.6) && e.type !== "pointercancel";
    const target = openL ? -ACT : 0;
    const anim = moveTo(front, { transform: `translateX(${target}px)` }, reduce() ? { duration: 0 } : SPRING);
    row.classList.remove("drag-r", "past", "drag-l");
    if (openL) {
      row.classList.add("open-l");
      offeneZeile = row;
    } else anim.finished.then(() => row.classList.remove("open-l"), () => {});
    if (commit) onAbhaken(a, true);
  };

  const [offenAngelegt] = useState(!done);
  const offenGezeigt = festerSub ? offenAngelegt : !done;
  let sub: string | null = null;
  if (offenGezeigt && a.due < heute) sub = `war fällig ${kurzDatum(a.due)}`;
  if (!sub && offenGezeigt) sub = kurzDatum(a.due);

  const label = `${a.kurz}, ${a.text}, ${done ? "wieder öffnen" : "abhaken"}`;

  return (
    <div className={`task${done ? " done" : ""}`} data-id={a.id} data-mode={mode} ref={rowRef}>
      <div className="t-under" aria-hidden="true">
        <Icon name="check" />
      </div>
      <div className="t-acts">
        <button
          className="edit"
          type="button"
          onClick={() => {
            closeActions(rowRef.current, true);
            onBearbeiten(a);
          }}
        >
          Bearbeiten
        </button>
        <button
          className="del"
          type="button"
          onClick={() => {
            offeneZeile = null;
            onLoeschen(a);
          }}
        >
          Löschen
        </button>
      </div>
      <div
        className="t-front"
        ref={frontRef}
        onPointerDown={runter}
        onPointerMove={ziehen}
        onPointerUp={los}
        onPointerCancel={los}
        onClick={(e) => {
          const row = rowRef.current;
          if (offeneZeile === row) {
            closeActions(row);
            return;
          }
          if ((e.target as HTMLElement).closest(".check")) return;
          if (done) onAbhaken(a, false);
        }}
      >
        <button
          className="check"
          type="button"
          aria-pressed={done}
          aria-label={label}
          onClick={() => {
            if (offeneZeile === rowRef.current) return;
            onAbhaken(a, !done);
          }}
        >
          <span className="ring">
            <span className="cfill">
              <Icon name="check" />
            </span>
          </span>
        </button>
        <div className="t-text">
          <p className="t-title">
            <b>{a.kurz}</b>
            <span className="t-txt">{a.text}</span>
          </p>
          <p className="t-sub" hidden={!sub}>
            {sub}
          </p>
        </div>
        <span />
      </div>
    </div>
  );
}
