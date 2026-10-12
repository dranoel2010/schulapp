"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { Icon } from "@/components/kombi/icon";
import type { AufgabeT } from "@/lib/kombi/startseite";
import { kurz } from "@/lib/kombi/text";
import { E, moveTo, reduce, springOpts } from "@/lib/kombi/motion";

/**
 * Die Aufgabenzeile (V1 4.3, Prototyp Z. 1727–1900): Abhakkreis, Fach fett
 * vor dem Text, Unterzeile; Wisch nach rechts hakt ab, Linkswisch legt
 * „Bearbeiten“ und „Löschen“ frei. Erledigt: grauer Haken, durchgestrichen
 * wird nur der Aufgabentext, nicht das Fach.
 *
 * Modi wie im Prototyp (`data-mode`): `mo` (Morgens), `ov` (Überblick), `ab`
 * (Ablauf), `subj` (unter einer Fachzeile), `page`, `page-sp`, `woche`,
 * `menu` (im Menü der Zeile, ohne Linkswisch).
 */

export type AufgabeModus = "mo" | "ov" | "ab" | "subj" | "page" | "page-sp" | "woche" | "menu";

/** Breite der freigelegten Aktionen plus 10 px Rand (Prototyp ACT). */
const ACT = 176 + 10;

/** Die gerade offene Zeile (Linkswisch) — höchstens eine zugleich. */
let offeneZeile: { el: HTMLElement; schliessen: (sofort?: boolean) => void } | null = null;

/** Unterzeile (Prototyp `setSub`, Z. 1742). */
export function aufgabeSub(a: AufgabeT, modus: AufgabeModus, heute: string): string | null {
  if (!a.done && a.due < heute) return `war fällig ${kurz(a.due)}`;
  if (!a.done && (modus === "ab" || modus === "subj" || modus === "page-sp")) return kurz(a.due);
  return null;
}

/** Durchstrich je Textzeile (Prototyp `drawStrikes`, Z. 1749). */
function striche(row: HTMLElement, animieren: boolean) {
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
    if (animieren) {
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
  modus,
  heute,
  onAbhaken,
  onBearbeiten,
  onLoeschen,
}: {
  a: AufgabeT;
  modus: AufgabeModus;
  /** App-Tag, für „war fällig …“ */
  heute: string;
  onAbhaken: (id: string, done: boolean) => void;
  onBearbeiten?: (id: string) => void;
  onLoeschen?: (id: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const warDone = useRef<boolean | null>(null);
  const schluck = useRef(false);
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

  const sub = aufgabeSub(a, modus, heute);

  // Durchstrich: neu gezeichnet bei jeder Änderung, animiert nur beim Abhaken
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const vorher = warDone.current;
    warDone.current = a.done;
    if (a.done) striche(row, vorher === false);
    else row.querySelectorAll(".strike").forEach((s) => s.remove());
  }, [a.done, a.text]);

  // Schriften und Breite ändern den Umbruch: Striche neu legen
  useEffect(() => {
    const neu = () => {
      if (a.done && rowRef.current) striche(rowRef.current, false);
    };
    window.addEventListener("resize", neu);
    // nach einem Tageszeitwechsel: die Zeile war versteckt und hatte keine Maße
    window.addEventListener("kombi:striche", neu);
    document.fonts?.ready.then(neu, () => {});
    return () => {
      window.removeEventListener("resize", neu);
      window.removeEventListener("kombi:striche", neu);
    };
  }, [a.done]);

  const schliessen = (sofort = false) => {
    const row = rowRef.current;
    const f = frontRef.current;
    if (!row || !f) return;
    const anim = moveTo(f, { transform: "translateX(0px)" }, sofort || reduce() ? { duration: 0 } : springOpts());
    anim.finished.then(
      () => row.classList.remove("open-l"),
      () => {},
    );
    if (offeneZeile?.el === row) offeneZeile = null;
  };

  // Ein Tipp irgendwo sonst schließt die offene Zeile (Prototyp Z. 1831)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const row = rowRef.current;
      if (!row || offeneZeile?.el !== row) return;
      const t = e.target as HTMLElement;
      if (row.contains(t)) return;
      if (t.closest(".t-acts")) return;
      schliessen();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  });

  const klick = (e: React.MouseEvent) => {
    if (schluck.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const row = rowRef.current;
    if (!row) return;
    const t = e.target as HTMLElement;
    if (t.closest(".edit")) {
      schliessen(true);
      onBearbeiten?.(a.id);
      return;
    }
    if (t.closest(".del")) {
      offeneZeile = null;
      onLoeschen?.(a.id);
      return;
    }
    if (offeneZeile?.el === row) {
      schliessen();
      return;
    }
    if (offeneZeile) offeneZeile.schliessen();
    if (t.closest(".check")) {
      onAbhaken(a.id, !a.done);
      return;
    }
    if (a.done && t.closest(".t-front")) onAbhaken(a.id, false);
  };

  // Wisch: folgt dem Finger, Achse nach 10 px, Start erst ab 24 px vom linken Rand (Prototyp Z. 1842)
  const runter = (e: React.PointerEvent<HTMLDivElement>) => {
    if (modus === "menu" || e.button > 0 || wisch.current) return;
    const row = rowRef.current;
    const front = frontRef.current;
    if (!row || !front) return;
    if (offeneZeile && offeneZeile.el !== row) offeneZeile.schliessen();
    const app = document.getElementById("app");
    const appLeft = app ? app.getBoundingClientRect().left : 0;
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
    const row = rowRef.current;
    const front = frontRef.current;
    if (!st || e.pointerId !== st.id || !row || !front) return;
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
        // ohne Fang geht es auch
      }
    }
    const raw = st.base + (e.clientX - st.x0);
    const W = row.offsetWidth;
    let x: number;
    if (raw >= 0) x = a.done ? (raw * 40) / (40 + raw) : raw;
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
    const row = rowRef.current;
    const front = frontRef.current;
    if (!s || e.pointerId !== s.id || !row || !front) return;
    wisch.current = null;
    if (!s.drag) return;
    schluck.current = true;
    setTimeout(() => {
      schluck.current = false;
    }, 60);
    const [ta, xa] = s.hist[0];
    const [tb, xb] = s.hist[s.hist.length - 1];
    const v = (xb - xa) / Math.max(1, tb - ta);
    const W = row.offsetWidth;
    const abbruch = e.type === "pointercancel";
    const commit = !a.done && s.x > 0 && (s.x > W * 0.3 || v > 0.6) && !abbruch;
    const openL = modus !== "menu" && s.x < 0 && (s.x < -ACT / 2 || v < -0.6) && !abbruch;
    const ziel = openL ? -ACT : 0;
    const anim = moveTo(front, { transform: `translateX(${ziel}px)` }, reduce() ? { duration: 0 } : springOpts());
    row.classList.remove("drag-r", "past", "drag-l");
    if (openL) {
      row.classList.add("open-l");
      offeneZeile = { el: row, schliessen };
    } else {
      anim.finished.then(
        () => row.classList.remove("open-l"),
        () => {},
      );
    }
    if (commit) onAbhaken(a.id, true);
  };

  const label = `${a.fach}, ${a.text}, ${a.done ? "wieder öffnen" : "abhaken"}`;

  return (
    <div
      className={`task${a.done ? " done" : ""}`}
      data-id={a.id}
      data-mode={modus}
      data-k={a.id}
      ref={rowRef}
      onClickCapture={klick}
    >
      <div className="t-under" aria-hidden="true">
        <Icon name="check" />
      </div>
      {modus !== "menu" ? (
        <div className="t-acts">
          <button className="edit" type="button">
            Bearbeiten
          </button>
          <button className="del" type="button">
            Löschen
          </button>
        </div>
      ) : null}
      <div
        className="t-front"
        ref={frontRef}
        onPointerDown={runter}
        onPointerMove={ziehen}
        onPointerUp={los}
        onPointerCancel={los}
      >
        <button className="check" type="button" aria-pressed={a.done} aria-label={label}>
          <span className="ring">
            <span className="cfill">
              <Icon name="check" />
            </span>
          </span>
        </button>
        <div className="t-text">
          <p className="t-title">
            <b>{a.fach}</b>
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
