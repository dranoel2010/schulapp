"use client";

import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  aufgabeLoeschenAction,
  aufgabeSetzenAction,
  aufgabeWiederherstellenAction,
  aufgabeZuruecknehmenAction,
} from "@/app/(app)/hausaufgaben/zeile-actions";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { buzz, E, moveTo, reduce, springOpts } from "@/lib/kombi/motion";
import { kurz } from "@/lib/kombi/text";
import type { AufgabeDaten } from "@/lib/seiten/gemeinsam";

/**
 * Die Aufgabenzeile der Nachschlage-Seiten (Prototyp `taskRow`, Z. 1728–1900):
 * Kreis zum Abhaken mit Durchstreichen, Wisch nach rechts hakt ab, Wisch
 * nach links legt „Bearbeiten“ und „Löschen“ frei; eine erledigte Zeile
 * öffnet ein Tipp wieder. Abhaken zeigt den Toast „⟨Fach⟩ abgehakt“ mit
 * Rückgängig, Löschen „Gelöscht“ mit Rückgängig.
 *
 * Die Änderungen sind optimistisch: die Zeile springt sofort, die Action
 * läuft dahinter; scheitert sie, steht erst der Toast „Nicht gespeichert“
 * mit „Erneut“, dann springt die Zeile zurück (Plan 2.4, Punkt 9). Danach
 * lädt die Shell die Seite nach (`neuLaden`), so ordnen sich die Gruppen neu.
 */

export type ZeilenModus = "page" | "page-sp" | "woche" | "subj";

type Ueber = Record<string, { done?: boolean; weg?: boolean }>;

const RUECKSPRUNG_MS = 300;

/** Gemeinsamer Zustand aller Aufgabenzeilen einer Seite. */
export function useAufgaben(daten: unknown) {
  const kombi = useKombi();
  const [ueber, setUeber] = useState<Ueber>({});
  const [vorher, setVorher] = useState(daten);
  if (vorher !== daten) {
    // neue Daten vom Server: sie gelten
    setVorher(daten);
    setUeber({});
  }

  const setze = useCallback((id: string, wert: { done?: boolean; weg?: boolean } | null) => {
    setUeber((u) => {
      const n = { ...u };
      if (wert) n[id] = { ...n[id], ...wert };
      else delete n[id];
      return n;
    });
  }, []);

  const nachladen = useCallback(
    (ms: number) => {
      setTimeout(() => void kombi.neuLaden(), ms);
    },
    [kombi],
  );

  const schalten = useCallback(
    function schalten(a: AufgabeDaten, done: boolean) {
      setze(a.id, { done });
      if (done) buzz();
      else kombi.hideToast();
      aufgabeSetzenAction(a.id, done).then(
        (r) => {
          if (!r.ok) throw new Error("abgewiesen");
          if (done) {
            kombi.toast(
              `${a.fach} abgehakt`,
              () => {
                setze(a.id, { done: false });
                aufgabeZuruecknehmenAction(a.id, r.protokollId ?? null).then(
                  () => nachladen(0),
                  () => kombi.fehlerToast("Nicht gespeichert", () => schalten(a, false), "Erneut"),
                );
              },
              `${a.fach}, ${a.text}`,
            );
          }
          // die Zeile bleibt 350 ms stehen, dann ordnet sich die Liste neu
          nachladen(done ? 350 : 200);
        },
        () => {
          kombi.fehlerToast("Nicht gespeichert", () => schalten(a, done), "Erneut");
          setTimeout(() => setze(a.id, null), RUECKSPRUNG_MS);
        },
      );
    },
    [kombi, setze, nachladen],
  );

  const loeschen = useCallback(
    function loeschen(a: AufgabeDaten) {
      setze(a.id, { weg: true });
      aufgabeLoeschenAction(a.id).then(
        (r) => {
          if (!r.ok || !r.zeile) throw new Error("abgewiesen");
          const zeile = r.zeile;
          kombi.toast(
            "Gelöscht",
            () => {
              setze(a.id, null);
              aufgabeWiederherstellenAction(zeile, r.protokollId ?? null).then(
                () => nachladen(0),
                () => kombi.fehlerToast("Nicht gespeichert", () => loeschen(a), "Erneut"),
              );
            },
            a.text,
          );
          nachladen(200);
        },
        () => {
          kombi.fehlerToast("Nicht gespeichert", () => loeschen(a), "Erneut");
          setTimeout(() => setze(a.id, null), RUECKSPRUNG_MS);
        },
      );
    },
    [kombi, setze, nachladen],
  );

  const anwenden = useCallback(
    (liste: AufgabeDaten[]) =>
      liste
        .filter((a) => !ueber[a.id]?.weg)
        .map((a) => (ueber[a.id]?.done === undefined ? a : { ...a, done: ueber[a.id].done! })),
    [ueber],
  );

  return { anwenden, schalten, loeschen };
}

// ── Zeile ─────────────────────────────────────────────────────────────────

let offeneZeile: { el: HTMLElement; schliessen: (sofort?: boolean) => void } | null = null;
let schluckeKlick = false;

const ACT = 176 + 10;

function strichZiehen(row: HTMLElement, animiert: boolean) {
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
    if (animiert) {
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
  onSchalten,
  onLoeschen,
}: {
  a: AufgabeDaten;
  modus: ZeilenModus;
  heute: string;
  onSchalten: (a: AufgabeDaten, done: boolean) => void;
  onLoeschen: (a: AufgabeDaten) => void;
}) {
  const router = useRouter();
  const rowRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const warDone = useRef(a.done);
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

  // Durchstreichen: beim Wechsel animiert, sonst still (Prototyp `drawStrikes`)
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    if (a.done) strichZiehen(row, !warDone.current);
    else row.querySelectorAll(".strike").forEach((s) => s.remove());
    warDone.current = a.done;
  }, [a.done, a.text]);

  const schliessen = useCallback((sofort?: boolean) => {
    const row = rowRef.current;
    const f = frontRef.current;
    if (!row || !f) return;
    const anim = moveTo(f, { transform: "translateX(0px)" }, sofort || reduce() ? { duration: 0 } : springOpts());
    anim.finished.then(() => row.classList.remove("open-l"), () => {});
    if (offeneZeile?.el === row) offeneZeile = null;
  }, []);

  let sub: string | null = null;
  if (!a.done && a.due < heute) sub = `war fällig ${kurz(a.due)}`;
  else if (!a.done && (modus === "subj" || modus === "page-sp")) sub = kurz(a.due);

  const bearbeiten = () => {
    schliessen(true);
    router.push(`/hausaufgaben/${a.id}`);
  };

  return (
    <div
      ref={rowRef}
      className={`task${a.done ? " done" : ""}`}
      data-id={a.id}
      data-mode={modus}
      onClickCapture={(e) => {
        if (schluckeKlick) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <div className="t-under" aria-hidden="true">
        <Icon name="check" />
      </div>
      <div className="t-acts">
        <button className="edit" type="button" onClick={bearbeiten}>
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
        onClick={(e) => {
          const row = rowRef.current;
          if (!row) return;
          if (offeneZeile?.el === row) {
            schliessen();
            return;
          }
          if (offeneZeile) offeneZeile.schliessen();
          if ((e.target as HTMLElement).closest(".check")) {
            onSchalten(a, !a.done);
            return;
          }
          if (a.done) onSchalten(a, false);
        }}
        onPointerDown={(e) => {
          const row = rowRef.current;
          const f = frontRef.current;
          if (!row || !f || e.button > 0 || wisch.current) return;
          if (offeneZeile && offeneZeile.el !== row) offeneZeile.schliessen();
          const app = document.getElementById("app");
          const appLeft = app ? app.getBoundingClientRect().left : 0;
          const m = new DOMMatrixReadOnly(getComputedStyle(f).transform);
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
        }}
        onPointerMove={(e) => {
          const st = wisch.current;
          const row = rowRef.current;
          const f = frontRef.current;
          if (!st || !row || !f || e.pointerId !== st.id) return;
          const mx = e.clientX - st.x0;
          const my = e.clientY - st.y0;
          if (!st.drag) {
            if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
              wisch.current = null;
              return;
            }
            if (Math.abs(mx) < 10) return;
            // Vom linken Rand gehört der Wisch der Seite (zurück)
            if (st.edge && mx > 0 && st.base >= 0) {
              wisch.current = null;
              return;
            }
            st.drag = true;
            st.x0 = e.clientX - mx;
            f.getAnimations().forEach((x) => x.cancel());
            try {
              f.setPointerCapture(e.pointerId);
            } catch {}
            e.stopPropagation();
          }
          e.stopPropagation();
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
          f.style.transform = `translateX(${x}px)`;
          row.classList.toggle("drag-r", x > 0);
          row.classList.toggle("drag-l", x < 0);
          row.classList.toggle("past", x > W * 0.3);
          st.hist.push([e.timeStamp, x]);
          if (st.hist.length > 5) st.hist.shift();
        }}
        onPointerUp={(e) => ende(e)}
        onPointerCancel={(e) => ende(e)}
      >
        <button
          className="check"
          type="button"
          aria-pressed={a.done}
          aria-label={`${a.fach}, ${a.text}, ${a.done ? "wieder öffnen" : "abhaken"}`}
        >
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

  function ende(e: React.PointerEvent) {
    const st = wisch.current;
    const row = rowRef.current;
    const f = frontRef.current;
    if (!st || !row || !f || e.pointerId !== st.id) return;
    wisch.current = null;
    if (!st.drag) return;
    schluckeKlick = true;
    setTimeout(() => {
      schluckeKlick = false;
    }, 60);
    const [ta, xa] = st.hist[0];
    const [tb, xb] = st.hist[st.hist.length - 1];
    const v = (xb - xa) / Math.max(1, tb - ta);
    const W = row.offsetWidth;
    const abhaken = !a.done && st.x > 0 && (st.x > W * 0.3 || v > 0.6) && e.type !== "pointercancel";
    const offenL = st.x < 0 && (st.x < -ACT / 2 || v < -0.6) && e.type !== "pointercancel";
    const ziel = offenL ? -ACT : 0;
    const anim = moveTo(f, { transform: `translateX(${ziel}px)` }, reduce() ? { duration: 0 } : springOpts());
    row.classList.remove("drag-r", "past", "drag-l");
    if (offenL) {
      row.classList.add("open-l");
      offeneZeile = { el: row, schliessen };
    } else anim.finished.then(() => row.classList.remove("open-l"), () => {});
    if (abhaken) onSchalten(a, true);
  }
}
