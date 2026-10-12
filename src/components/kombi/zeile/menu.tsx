"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { Icon } from "@/components/kombi/icon";
import { E, reduce } from "@/lib/kombi/motion";
import { dm, kurz } from "@/lib/kombi/text";
import type { VorratAufgabe } from "@/lib/kombi/vorrat";

import type { AntwortInhalt, Option, Txt } from "./suche";

/**
 * Bausteine des Menüs der Zeile (Prototyp `optNode`, `morgenAnswer`,
 * `notenAnswer`, `klausurAnswer`, Z. 2380–2402 und 2523–2559). Alles wird als
 * Text gerendert — Hervorhebungen kommen als Teile, nie als HTML.
 */

/** Ein `Txt` als Text mit Hervorhebungen. */
export function T({ x }: { x: Txt | null | undefined }): ReactNode {
  if (x == null) return null;
  if (typeof x === "string") return x;
  return x.map((p, i) =>
    p.k === "hl" ? (
      <span key={i} className="hl">
        {p.t}
      </span>
    ) : p.k === "dim" ? (
      <span key={i} className="dim">
        {p.t}
      </span>
    ) : p.k === "b" ? (
      <b key={i}>{p.t}</b>
    ) : p.k === "nw" ? (
      <span key={i} style={{ whiteSpace: "nowrap" }}>
        {p.t}
      </span>
    ) : (
      <span key={i}>{p.t}</span>
    ),
  );
}

/** Uhrzeit mit proportionalen Trennzeichen (Prototyp `tn`). */
export function Tn({ s }: { s: string }) {
  return (
    <>
      {s.split(/([:.,])/).map((t, i) =>
        /^[:.,]$/.test(t) ? (
          <span key={i} className="c">
            {t}
          </span>
        ) : (
          t
        ),
      )}
    </>
  );
}

export const optId = (key: string) => `o-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/** Eine Zeile im Menü (Prototyp `optNode`). */
export function Opt({
  o,
  first = false,
  fachKurz,
  onWaehlen,
  onAbhaken,
  onStarten,
  onVorladen,
}: {
  o: Option;
  first?: boolean;
  fachKurz?: (fachId: string) => string;
  onWaehlen: (o: Option) => void;
  onAbhaken?: (a: VorratAufgabe) => void;
  onStarten?: (el: HTMLElement) => void;
  onVorladen?: (o: Option) => void;
}) {
  const t = o.task;
  const kurzName = t && fachKurz ? fachKurz(t.fachId) : "";
  let lead: ReactNode = null;
  if (o.thumb) {
    lead = <span className="mini" style={{ backgroundImage: `url("${o.thumb}")` }} aria-hidden="true" />;
  } else if (t) {
    lead = (
      <button
        className={`mcheck${t.done ? " on" : ""}`}
        type="button"
        aria-label={`${kurzName}, ${t.text}, ${t.done ? "wieder öffnen" : "abhaken"}`}
        onClick={(e) => {
          e.stopPropagation();
          onAbhaken?.(t);
        }}
      >
        <span className="ring">
          <span className="cfill">
            <Icon name="check" />
          </span>
        </span>
      </button>
    );
  }
  return (
    <div
      className={`opt${lead ? " has-ic" : ""}${o.cell ? " cell" : ""}${first ? " first" : ""}`}
      role="option"
      aria-selected={false}
      id={optId(o.key)}
      data-k={o.key}
      onPointerDown={() => onVorladen?.(o)}
      onClick={() => onWaehlen(o)}
    >
      {lead}
      <div>
        <p className="o1">
          <T x={o.l1} />
        </p>
        {o.l2 ? (
          <p className="o2">
            <T x={o.l2} />
          </p>
        ) : null}
      </div>
      <span className="o-end">
        {o.start ? (
          <button
            className="lbbtn"
            type="button"
            style={{ padding: "0 6px 0 12px" }}
            onClick={(e) => {
              e.stopPropagation();
              onStarten?.(e.currentTarget);
            }}
          >
            Starten
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** Aufgabenzeile im Menü (Prototyp `taskRow(a, 'menu')`): Haken, Fach, Text, durchgestrichen wenn erledigt. */
export function MenuAufgabe({
  a,
  heute,
  fachKurz,
  onAbhaken,
}: {
  a: VorratAufgabe;
  heute: string;
  fachKurz: string;
  onAbhaken: (a: VorratAufgabe) => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const titelRef = useRef<HTMLSpanElement>(null);
  const warDone = useRef<boolean | null>(null);
  const done = !!a.done;

  // Striche wie `drawStrikes`: je Zeile des Aufgabentexts ein Strich, das Fach bleibt lesbar
  useLayoutEffect(() => {
    const host = textRef.current;
    const title = titelRef.current;
    if (!host || !title) return;
    host.querySelectorAll(".strike").forEach((s) => s.remove());
    const animate = warDone.current === false && done;
    warDone.current = done;
    if (!done || !title.offsetParent) return;
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
      if (animate)
        s.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
          duration: reduce() ? 120 : 260,
          delay: reduce() ? 0 : 60 + i * 60,
          easing: E.out,
          fill: "backwards",
        });
    });
  });

  const sub = !done && a.due < heute ? `war fällig ${kurz(a.due)}` : null;
  return (
    <div className={`task${done ? " done" : ""}`} data-id={a.id} data-mode="menu">
      <div className="t-under" aria-hidden="true">
        <Icon name="check" />
      </div>
      <div className="t-front">
        <button
          className="check"
          type="button"
          aria-pressed={done}
          aria-label={`${fachKurz}, ${a.text}, ${done ? "wieder öffnen" : "abhaken"}`}
          onClick={(e) => {
            e.stopPropagation();
            onAbhaken(a);
          }}
        >
          <span className="ring">
            <span className="cfill">
              <Icon name="check" />
            </span>
          </span>
        </button>
        <div className="t-text" ref={textRef}>
          <p className="t-title">
            <b>{fachKurz}</b>
            <span className="t-txt" ref={titelRef}>
              {a.text}
            </span>
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

/** Die Antwort beim Tippen (Prototyp `morgenAnswer`, `notenAnswer`, `klausurAnswer`). */
export function AntwortInhaltView({
  inhalt,
  heute,
  fachKurz,
  aufgabe,
  onAbhaken,
}: {
  inhalt: AntwortInhalt;
  heute: string;
  fachKurz: (fachId: string) => string;
  /** aktueller Stand einer Aufgabe (nach Abhaken im offenen Menü) */
  aufgabe: (a: VorratAufgabe) => VorratAufgabe;
  onAbhaken: (a: VorratAufgabe) => void;
}) {
  if (inhalt.art === "tag") {
    return (
      <div className="ans">
        {inhalt.frei ? <p className="free">{inhalt.frei}</p> : null}
        {inhalt.stunden.length ? <p className="alab">Stunden</p> : null}
        {inhalt.stunden.map((l, i) => (
          <div className="lesson" key={`l${i}`}>
            <time>
              <Tn s={l.von} />
            </time>
            <div>
              <b>{l.fach}</b>
              <em>{l.em}</em>
            </div>
          </div>
        ))}
        {inhalt.abgeben.length ? <p className="alab">Abgeben</p> : null}
        {inhalt.abgeben.map((a0) => {
          const a = aufgabe(a0);
          return <MenuAufgabe key={a.id} a={a} heute={heute} fachKurz={fachKurz(a.fachId)} onAbhaken={onAbhaken} />;
        })}
      </div>
    );
  }
  if (inhalt.art === "noten") {
    return (
      <div className="ans">
        {inhalt.noten.map((n, i) => (
          <div className="grade-row" key={i}>
            <b>{n.label}</b>
            <span>{`${n.titel}, ${dm(n.datum)}`}</span>
          </div>
        ))}
        {inhalt.leer ? <p className="free">{inhalt.leer}</p> : null}
      </div>
    );
  }
  return (
    <div className="ans">
      <p className="free" style={{ padding: "6px 0 4px" }}>
        {inhalt.kopf}
      </p>
      {inhalt.zeilen.map((z, i) => (
        <div className="lesson" key={i}>
          <time>{z.time}</time>
          <div>
            <b>{z.b}</b>
            <em>{z.em}</em>
          </div>
        </div>
      ))}
    </div>
  );
}
