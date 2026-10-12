"use client";

import { useRef, useState } from "react";

import { Tn } from "@/components/kombi/tn";
import { E, moveTo, reduce } from "@/lib/kombi/motion";
import { dm, lang, TAG, TK, wd } from "@/lib/kombi/text";
import type { WocheDaten } from "@/lib/seiten/woche";

import { AufgabeZeile, useAufgaben } from "./aufgabe";
import { TextLine } from "./zeilen";

/**
 * Woche (Prototyp `PAGES.woche`, Z. 3052–3097): fünf Tage mit Strich unter
 * dem gewählten, darunter die Stunden des Tages. Beim Wechsel schiebt die
 * Liste 20px zur Seite und blendet über. Am Ende die Zeile „Stundenplan
 * bearbeiten“ (Plan 2.2).
 */

export const wocheTitel = () => "Woche";
export const wocheSub = (d: WocheDaten) => `${dm(d.tage[0].tag)} bis ${dm(d.tage[4].tag)}`;

export function WocheInhalt({ daten }: { daten: WocheDaten }) {
  const start = Math.max(0, daten.tage.findIndex((t) => t.tag === daten.tag));
  const [sel, setSel] = useState(start);
  const [gezeigt, setGezeigt] = useState(start);
  const listRef = useRef<HTMLDivElement>(null);
  const { anwenden, schalten, loeschen } = useAufgaben(daten);

  const waehlen = (i: number) => {
    if (i === sel) return;
    const dir = i > sel ? 1 : -1;
    setSel(i);
    const list = listRef.current;
    if (!list || reduce()) {
      setGezeigt(i);
      list?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      return;
    }
    moveTo(list, { opacity: "0", transform: `translateX(${-dir * 20}px)` }, { duration: 200, easing: E.out }).finished.then(
      () => {
        setGezeigt(i);
        requestAnimationFrame(() => {
          list.getAnimations().forEach((a) => a.cancel());
          list.style.opacity = "";
          list.style.transform = "";
          list.animate([{ opacity: 0, transform: `translateX(${dir * 20}px)` }, { opacity: 1, transform: "none" }], {
            duration: 260,
            easing: E.out,
          });
        });
      },
      () => {},
    );
  };

  const t = daten.tage[gezeigt];
  const abgeben = anwenden(t.abgeben);

  return (
    <>
      <div className="days">
        {daten.tage.map((d, i) => (
          <button
            key={d.tag}
            className="day"
            type="button"
            aria-pressed={i === sel}
            aria-label={lang(d.tag)}
            onClick={() => waehlen(i)}
          >
            <b>{TK[wd(d.tag)]}</b>
            <span>
              <Tn s={dm(d.tag)} />
            </span>
          </button>
        ))}
        <span className="day-ind" aria-hidden="true" style={{ transform: `translateX(${sel * 100}%)` }} />
      </div>
      <div className="lessons" ref={listRef}>
        {t.frei ? <p className="free">{t.frei}</p> : null}
        {t.stunden.map((l) => (
          <div className="lesson" key={`${l.nr}-${l.fachId}`}>
            <time>
              {l.von ? <Tn s={l.von} /> : `${l.nr}.`}
              {l.bis ? (
                <span className="end">
                  <Tn s={l.bis} />
                </span>
              ) : null}
            </time>
            <div>
              <b>{l.fach}</b>
              {l.hu || l.raum ? <em>{l.hu ? `Hauptunterricht${l.raum ? ` · ${l.raum}` : ""}` : l.raum}</em> : null}
              {l.klausur ? <span className="tag">{`Klausur: ${l.klausur}`}</span> : null}
            </div>
          </div>
        ))}
        {!t.stunden.length && !t.frei ? <p className="free">Keine Schule</p> : null}
        {abgeben.length ? (
          <>
            <h3 className="lab" style={{ marginTop: 16 }}>{`Abgeben am ${TAG[wd(t.tag)]}`}</h3>
            {abgeben.map((a) => (
              <AufgabeZeile key={a.id} a={a} modus="woche" heute={daten.heute} onSchalten={schalten} onLoeschen={loeschen} />
            ))}
          </>
        ) : null}
      </div>
      <div style={{ height: 16 }} />
      <TextLine href="/stundenplan/bearbeiten">Stundenplan bearbeiten</TextLine>
    </>
  );
}
