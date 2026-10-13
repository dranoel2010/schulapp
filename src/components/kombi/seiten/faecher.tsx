"use client";

import { Fragment, useState } from "react";

import { themaArtAction, themaArtZurueckAction, wiederAufnehmenAction } from "@/app/(app)/faecher/seite-actions";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { lang } from "@/lib/kombi/text";
import type { FachDaten, FaecherDaten, ThemaZeile } from "@/lib/seiten/faecher";

import { AufgabeZeile, useAufgaben } from "./aufgabe";
import { BlattRow, PLab, RowBtn, TextLine } from "./zeilen";

/**
 * Fächer und Fach (Prototyp Z. 3175–3193, `themaArtRow` Z. 3203). Archivierte
 * Fächer stehen zugeklappt unter „Archiviert · n“, in der Gestalt der Zeile
 * „Erledigt“ der Hausaufgaben-Seite (Plan 2.2).
 */

export function FaecherInhalt({ daten }: { daten: FaecherDaten }) {
  const [auf, setAuf] = useState(false);
  return (
    <>
      {daten.faecher.length === 0 ? <p className="empty">Noch keine Fächer angelegt.</p> : null}
      {/* eigener Behälter: die letzte Zeile bleibt :last-child, ohne Strich (Prototyp Z. 415) */}
      <div>
        {daten.faecher.map((f) => (
          <RowBtn key={f.id} titel={f.name} sub={f.sub} ziel={{ seite: "fach", params: { id: f.id } }} />
        ))}
      </div>
      {daten.archiviert.length ? (
        <div className="group">
          <button
            className="lab"
            type="button"
            aria-expanded={auf}
            style={{ width: "100%", height: 44, alignItems: "center", paddingBottom: 0 }}
            onClick={() => setAuf((x) => !x)}
          >
            <span>{`Archiviert · ${daten.archiviert.length}`}</span>
            <Icon name="expand_more" className="s18" />
          </button>
          {auf
            ? daten.archiviert.map((f) => (
                <RowBtn key={f.id} titel={f.name} sub={f.sub} ziel={{ seite: "fach", params: { id: f.id } }} />
              ))
            : null}
        </div>
      ) : null}
      <div style={{ height: 16 }} />
      <TextLine href="/faecher/neu">Fach anlegen</TextLine>
    </>
  );
}

function artText(t: ThemaZeile, art: ThemaZeile["art"]): string {
  const base =
    art === "ueben"
      ? t.blatt
        ? "Üben mit Arbeitsblatt zum Ausdrucken"
        : "Üben, Arbeitsblatt folgt"
      : `Abfragen mit ${t.fragen} ${t.fragen === 1 ? "Frage" : "Fragen"}`;
  return art === t.abgeleitet ? base : `${base}, von dir umgestellt`;
}

function ThemaArtRow({ t }: { t: ThemaZeile }) {
  const kombi = useKombi();
  const [art, setArt] = useState(t.art);
  const [vorher, setVorher] = useState(t);
  if (vorher !== t) {
    setVorher(t);
    setArt(t.art);
  }

  const waehlen = (v: ThemaZeile["art"]) => {
    if (v === art) return;
    const alt = art;
    setArt(v);
    themaArtAction(t.id, v).then(
      (r) => {
        if (!r.ok || !r.umstellung) throw new Error("abgewiesen");
        const u = r.umstellung;
        kombi.toast(v === "ueben" ? "Ab jetzt mit Arbeitsblatt" : "Ab jetzt mit Karten", () => {
          setArt(alt);
          themaArtZurueckAction(t.id, u).then(
            () => void kombi.neuLaden(),
            () => kombi.fehlerToast("Nicht gespeichert", () => waehlen(alt), "Erneut"),
          );
        });
      },
      () => {
        kombi.fehlerToast("Nicht gespeichert", () => waehlen(v), "Erneut");
        setTimeout(() => setArt(alt), 300);
      },
    );
  };

  return (
    <div className="lrow plain" style={{ cursor: "default", display: "block" }}>
      <span>
        <b>{t.name}</b>
        <span className="s">{artText(t, art)}</span>
      </span>
      <div className="seg2" role="group" aria-label={`Art von ${t.name}`} style={{ margin: "8px 0 2px" }}>
        <button type="button" aria-pressed={art === "abfragen"} onClick={() => waehlen("abfragen")}>
          Abfragen
        </button>
        <button type="button" aria-pressed={art === "ueben"} onClick={() => waehlen("ueben")}>
          Üben
        </button>
      </div>
    </div>
  );
}

export function FachInhalt({ daten: vomServer }: { daten: FachDaten }) {
  const kombi = useKombi();
  // gezeigt wird der Stand, den der FLIP-Lauf übernommen hat (useAufgaben);
  // eine eben abgehakte Zeile bleibt 350 ms stehen
  const { stand: daten, anwenden, schalten, loeschen, halten, ankerRef } = useAufgaben(vomServer);
  const offen = anwenden(daten.offen).filter((a) => !a.done || halten.has(a.id));

  // Benannt, damit „Erneut“ im Fehlertoast denselben Weg noch einmal geht
  // (Plan 2.4 Punkt 9), wie umlegen() und schalten().
  const wiederAufnehmen = () => {
    wiederAufnehmenAction(daten.id).then(
      (r) => {
        if (!r.ok) throw new Error("abgewiesen");
        kombi.toast(`${daten.name} wieder aufgenommen`);
        void kombi.neuLaden();
      },
      () => kombi.fehlerToast("Nicht gespeichert", wiederAufnehmen, "Erneut"),
    );
  };

  return (
    <>
      <div hidden ref={ankerRef} />
      {offen.length ? (
        <>
          <PLab>Offen</PLab>
          {offen.map((a) => (
            <AufgabeZeile key={a.id} a={a} modus="page-sp" heute={daten.heute} onSchalten={schalten} onLoeschen={loeschen} />
          ))}
        </>
      ) : null}
      {daten.klausuren.map((k) => (
        <Fragment key={k.id}>
          <PLab>Klausur</PLab>
          <RowBtn titel={`Klausur am ${lang(k.datum)}`} sub={k.thema} ziel={{ seite: "klausur", params: { id: k.id } }} />
        </Fragment>
      ))}
      {daten.themen.length ? (
        <>
          <PLab>Themen</PLab>
          {daten.themen.map((t) => (
            <ThemaArtRow key={t.id} t={t} />
          ))}
        </>
      ) : null}
      {daten.blaetter.length ? (
        <>
          <PLab>Blätter</PLab>
          {daten.blaetter.map((b) => (
            <BlattRow key={b.id} b={b} />
          ))}
        </>
      ) : null}
      <PLab>Fach</PLab>
      {daten.archiviert ? (
        <RowBtn
          titel="Wieder aufnehmen"
          sub="Das Fach steht dann wieder in allen Listen"
          rechts={<span />}
          ziel={{ onClick: wiederAufnehmen }}
        />
      ) : null}
      <RowBtn titel="Themen verwalten" sub="Schreibweisen zusammenlegen, eigene Themen ergänzen" ziel={{ href: `/faecher/${daten.id}/themen` }} />
      <RowBtn titel="Fragen und Bausteine" sub="Was in diesem Fach abgefragt wird" ziel={{ href: `/abruf/bausteine?fach=${daten.id}` }} />
      <RowBtn titel="Alle Abschriften als PDF" sub="Nach Thema geordnet, mit Foto" ziel={{ href: `/api/fach/${daten.id}/pdf`, download: true }} />
      {daten.istEpoche ? <RowBtn titel="Epoche wechseln" sub="Den Hauptunterricht auf ein anderes Fach umtragen" ziel={{ href: "/stundenplan/epoche" }} /> : null}
      <RowBtn titel="Fach bearbeiten" sub="Kürzel, Farbe, Lehrer, Raum, Gewichtung, Archivieren, Löschen" ziel={{ href: `/faecher/${daten.id}/bearbeiten` }} />
    </>
  );
}
