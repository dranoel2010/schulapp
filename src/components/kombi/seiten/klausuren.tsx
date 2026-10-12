"use client";

import { useState } from "react";

import {
  auslassenAction,
  blockSchaltenAction,
  lernplanNeuAction,
  nachholenAction,
} from "@/app/(app)/klausuren/seite-actions";
import { useKombi } from "@/components/kombi/kontext";
import { diffDays, dm, lang, TAG, TK, wd } from "@/lib/kombi/text";
import type { KlausurDaten, KlausurenDaten, PlanZeile } from "@/lib/seiten/klausuren";

import { TermineNeuZeile } from "./termine-neu";
import { BlattRow, PLab, RowBtn, TextLine } from "./zeilen";

/**
 * Klausuren und Klausur (Prototyp Z. 3106–3121, `planRows` Z. 3009). Die
 * Klausurseite trägt den ganzen Lernplan: jeder Block jedes Tages als
 * Planzeile, ein Tipp schaltet erledigt ↔ offen (mit Rückgängig), der heutige
 * Block trägt „Starten“ bzw. „Weiter“ (Plan F, Ausnahme in 1.1).
 */

export function KlausurenInhalt({ daten }: { daten: KlausurenDaten }) {
  if (!daten.klausuren.length) {
    return (
      <>
        <p className="empty">Keine Klausur eingetragen.</p>
        <TextLine href="/klausuren/neu">Klausur eintragen</TextLine>
      </>
    );
  }
  return (
    <>
      {daten.klausuren.map((k) => (
        <RowBtn key={k.id} titel={k.fach} sub={`${lang(k.datum)} · ${k.thema}`} ziel={{ seite: "klausur", params: { id: k.id } }} />
      ))}
      <div style={{ height: 16 }} />
      <TextLine href="/klausuren/neu">Klausur eintragen</TextLine>
    </>
  );
}

/** „heute“, „morgen“, „in 4 Tagen“; vorbei: „gestern“, „vor 3 Tagen“ (Prototyp `relTage`) */
export function relTage(tag: string, heute: string): string {
  const n = diffDays(heute, tag);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n > 1) return `in ${n} Tagen`;
  if (n === -1) return "gestern";
  return `vor ${-n} Tagen`;
}

export const klausurSub = (d: KlausurDaten) => `${lang(d.datum)} · ${relTage(d.datum, d.heute)}`;

function tagLabel(tag: string, heute: string): string {
  if (tag === heute) return "Heute";
  return Math.abs(diffDays(heute, tag)) <= 6 ? TK[wd(tag)] : dm(tag);
}

export function KlausurInhalt({ daten }: { daten: KlausurDaten }) {
  const kombi = useKombi();
  const [ueber, setUeber] = useState<Record<string, boolean>>({});
  const [vorher, setVorher] = useState(daten);
  if (vorher !== daten) {
    setVorher(daten);
    setUeber({});
  }
  const erledigt = (p: PlanZeile) => ueber[p.id] ?? p.erledigt;

  function schalten(p: PlanZeile, done: boolean) {
    setUeber((u) => ({ ...u, [p.id]: done }));
    blockSchaltenAction(p.id, done ? "done" : "open").then(
      (r) => {
        if (!r.ok) throw new Error("abgewiesen");
        kombi.toast(done ? "Lernblock erledigt" : "Lernblock wieder offen", () => schalten(p, !done), p.titel);
        void kombi.neuLaden();
      },
      () => {
        kombi.fehlerToast("Nicht gespeichert", () => schalten(p, done), "Erneut");
        setTimeout(() => setUeber((u) => ({ ...u, [p.id]: !done })), 300);
      },
    );
  }

  function ausfuehren(aufruf: () => Promise<{ ok: boolean }>, text: string) {
    aufruf().then(
      (r) => {
        if (!r.ok) throw new Error("abgewiesen");
        kombi.toast(text);
        void kombi.neuLaden();
      },
      () => kombi.fehlerToast("Nicht gespeichert", () => ausfuehren(aufruf, text), "Erneut"),
    );
  }

  const f = daten.fortschritt;
  const hinweise = [
    f.geplant > 0
      ? `${f.erledigt} von ${f.geplant} ${f.geplant === 1 ? "Block" : "Blöcken"} erledigt${f.gestrichen > 0 ? ` · ${f.gestrichen} gestrichen` : ""}`
      : null,
    f.geplant > 0 && daten.datum > daten.heute ? `${daten.minutenAmTag} min am Tag · ${daten.vorlauf} Tage Vorlauf` : null,
    daten.warnung,
  ].filter((x): x is string => !!x);

  return (
    <>
      <p style={{ fontSize: 17 }}>{daten.thema}</p>
      <PLab>Lernplan</PLab>
      {hinweise.map((h) => (
        <p className="p-sub" key={h}>
          {h}
        </p>
      ))}
      {daten.themenZahl === 0 ? (
        <>
          <p className="p-sub">Ohne Themen kein Plan. Sobald du einträgst, was drankommt, verteilt die App die Themen auf die Tage vor der Prüfung.</p>
          <TextLine href={`/klausuren/${daten.id}/bearbeiten`}>Themen eintragen</TextLine>
        </>
      ) : daten.ohnePlan ? (
        <>
          <p className="p-sub">{`Die Themen stehen. Die App verteilt sie auf ${daten.vorlauf} Tage vor der Prüfung, ${daten.minutenAmTag} Minuten am Tag.`}</p>
          <button className="textbtn" type="button" onClick={() => ausfuehren(() => lernplanNeuAction(daten.id), "Lernplan erstellt")}>
            Lernplan erstellen
          </button>
        </>
      ) : f.geplant === 0 && f.gestrichen > 0 ? (
        <p className="p-sub">Alle Lernblöcke sind gestrichen. Kommt ein neues Thema dazu, plant die App wieder.</p>
      ) : null}
      {daten.verpasst ? (
        <>
          <p className="p-sub">
            {daten.verpasst.tage === 1
              ? `Ein Lernblock von ${TAG[wd(daten.verpasst.letzter)]} ist offen.`
              : `An ${daten.verpasst.tage} Tagen sind ${daten.verpasst.minuten} Minuten liegen geblieben.`}
          </p>
          <div style={{ display: "flex", gap: 20 }}>
            <button className="textbtn" type="button" onClick={() => ausfuehren(() => nachholenAction(daten.id), "Auf die Tage bis zur Klausur verteilt")}>
              Nachholen
            </button>
            <button className="textbtn" type="button" onClick={() => ausfuehren(() => auslassenAction(daten.id), "Ausgelassen")}>
              Auslassen
            </button>
          </div>
        </>
      ) : null}
      <div className="plan">
        {daten.plan.map((p, i) => {
          const heute = p.tag === daten.heute;
          const done = erledigt(p);
          const ersterDesTages = i === 0 || daten.plan[i - 1].tag !== p.tag;
          return (
            <div className={`prow${heute ? " today" : ""}`} key={p.id}>
              <span className="pday" aria-label={TAG[wd(p.tag)]}>
                {ersterDesTages ? tagLabel(p.tag, daten.heute) : ""}
              </span>
              <button
                className="pbody"
                type="button"
                style={{ textAlign: "left", minHeight: 44 }}
                aria-pressed={done}
                aria-label={`${p.titel}, ${p.minuten} Minuten, ${done ? "wieder öffnen" : "als erledigt abhaken"}`}
                onClick={() => {
                  if (p.angefangen) kombi.openTisch({ mode: "block", blockId: p.id });
                  else schalten(p, !done);
                }}
              >
                <b>{p.titel}</b>
                <span>{`Lernblock, ${p.minuten} Minuten${done ? ", erledigt" : ""}`}</span>
              </button>
              {heute && !done ? (
                <button
                  className="lbbtn"
                  type="button"
                  aria-label={p.zustand === "ruhe" ? "Lernblock starten" : "Lernblock fortsetzen"}
                  onClick={() => kombi.openTisch({ mode: "block", blockId: p.id })}
                >
                  {p.zustand === "ruhe" ? "Starten" : "Weiter"}
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
        <div className="prow exday">
          <span className="pday" aria-label={TAG[wd(daten.datum)]}>
            {Math.abs(diffDays(daten.heute, daten.datum)) <= 6 ? TK[wd(daten.datum)] : dm(daten.datum)}
          </span>
          <div className="pbody">
            <b>Klausur</b>
            {daten.stunde ? <span>{`${daten.stunde}. Stunde`}</span> : null}
          </div>
          <span />
        </div>
      </div>
      {daten.noten ? (
        <>
          <div style={{ height: 16 }} />
          <RowBtn titel={`Noten in ${daten.fach}`} sub={daten.noten} ziel={{ seite: "notenfach", params: { id: daten.fachId } }} />
        </>
      ) : null}
      {daten.blaetter.length ? (
        <>
          <PLab>Blätter zum Thema</PLab>
          {daten.blaetter.map((b) => (
            <BlattRow key={b.id} b={b} />
          ))}
        </>
      ) : null}
      <PLab>Klausur</PLab>
      <RowBtn titel="Stoff und Fragen" sub="Blätter, Bausteine und Vorschläge" ziel={{ href: `/abruf/klausur?klausur=${daten.id}` }} />
      {daten.themenZahl > 0 && daten.datum > daten.heute ? (
        <RowBtn
          titel="Lernplan neu erstellen"
          sub="Erledigtes bleibt, Offenes wird neu verteilt"
          ziel={{ onClick: () => ausfuehren(() => lernplanNeuAction(daten.id), "Lernplan neu erstellt") }}
          rechts={<span />}
        />
      ) : null}
      <TermineNeuZeile />
      <RowBtn titel="Bearbeiten" sub="Datum, Themen, Lernplanung, Löschen" ziel={{ href: `/klausuren/${daten.id}/bearbeiten` }} />
    </>
  );
}
