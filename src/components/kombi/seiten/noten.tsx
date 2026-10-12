"use client";

import Link from "next/link";

import { Tn } from "@/components/kombi/tn";
import { formatAverage } from "@/lib/grade-scale";
import { dm } from "@/lib/kombi/text";
import type { NotenDaten, NotenfachDaten } from "@/lib/seiten/noten";

import { PLab, RowBtn, TextLine } from "./zeilen";

/**
 * Noten und Noten ⟨Fach⟩ (Prototyp Z. 3123–3145): Gesamtschnitt, je Fach
 * die Notenreihe mit Schnitt; im Fach die Noten mit Titel, Datum und Art,
 * die beiden Töpfe und ihre Gewichtung. „Note eintragen“ führt zum Formular,
 * der Zielrechner steht als Zeile „Was brauche ich für …?“ (Plan 2.2).
 */

const avg = (x: number) => formatAverage(x, 1);

export function NotenInhalt({ daten }: { daten: NotenDaten }) {
  if (!daten.faecher.length && !daten.abgewaehlt.length) {
    return (
      <>
        <p className="empty">Noch keine Noten eingetragen.</p>
        {daten.hatFaecher ? <TextLine href="/noten/neu">Note eintragen</TextLine> : null}
      </>
    );
  }
  return (
    <>
      {daten.gesamt !== null ? (
        <p className="total">
          <span>Gesamt</span>
          <b>
            <Tn s={avg(daten.gesamt)} />
          </b>
        </p>
      ) : null}
      {daten.faecher.map((f) => (
        <RowBtn
          key={f.id}
          titel={f.name}
          sub={f.reihe}
          strong
          ziel={{ seite: "notenfach", params: { id: f.id } }}
          rechts={
            <span className="avg">
              <Tn s={f.schnitt === null ? "–" : avg(f.schnitt)} />
            </span>
          }
        />
      ))}
      {daten.abgewaehlt.length ? (
        <>
          <PLab>Abgewählt</PLab>
          {daten.abgewaehlt.map((f) => (
            <RowBtn
              key={f.id}
              titel={f.name}
              sub={f.reihe}
              ziel={{ seite: "notenfach", params: { id: f.id } }}
              rechts={
                <span className="avg">
                  <Tn s={f.schnitt === null ? "–" : avg(f.schnitt)} />
                </span>
              }
            />
          ))}
        </>
      ) : null}
      <div style={{ height: 16 }} />
      <TextLine href="/noten/neu">Note eintragen</TextLine>
    </>
  );
}

export function NotenfachInhalt({ daten }: { daten: NotenfachDaten }) {
  const split = [
    daten.schriftlich !== null ? `Schriftlich ${avg(daten.schriftlich)}` : null,
    daten.muendlich !== null ? `Mündlich ${avg(daten.muendlich)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {daten.noten.length === 0 ? <p className="empty">Noch keine Noten eingetragen.</p> : null}
      {daten.noten.map((n) => (
        <Link className="grade-row" href={`/noten/${n.id}`} key={n.id} aria-label={`${n.label}, ${n.titel ?? n.art}, ${dm(n.datum)}, bearbeiten`}>
          <b>{n.label}</b>
          <span>
            {`${n.titel ? `${n.titel}, ` : ""}${dm(n.datum)}, ${n.art}${n.gewicht !== 1 ? `, zählt ${n.gewicht}-fach` : ""}`}
          </span>
        </Link>
      ))}
      {split ? (
        <p className="split">
          <Tn s={split} />
        </p>
      ) : null}
      <p className="split" style={{ marginTop: 4 }}>
        <Tn s={`Schriftlich zählt ${daten.anteil} %, mündlich ${100 - daten.anteil} %`} />
      </p>
      <Link className="textbtn" href={`/noten/neu?fach=${daten.id}`} style={{ marginTop: 14 }}>
        Note eintragen
      </Link>
      <div style={{ height: 8 }} />
      <TextLine href={`/noten/fach/${daten.id}/ziel`}>Was brauche ich für …?</TextLine>
    </>
  );
}
