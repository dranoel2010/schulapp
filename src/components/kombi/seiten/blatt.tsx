"use client";

import { Fragment, useEffect, useState, useSyncExternalStore } from "react";

import {
  abschreibenAction,
  blattFachAction,
  blattLoeschenAction,
  inDenKorbAction,
} from "@/app/(app)/material/seite-actions";
import { dazuAn, dazuStore } from "@/components/kombi/ablauf/blaetter-store";
import { useKombi } from "@/components/kombi/kontext";
import { formatGerman } from "@/lib/dates";
import { dm, fliesstext } from "@/lib/kombi/text";
import type { AblageDaten, BlattDaten } from "@/lib/seiten/ablage";

import { Bestaetigung, BlattRow, PLab, RowBtn, TextLine } from "./zeilen";

/**
 * Blatt und Ablage (Prototyp Z. 3146–3174): Abschrift oder Original, „Fach
 * und Thema“ mit den Fachpillen zum Umlegen, darunter die Wege, die es
 * bisher auf der Blattseite gab — Bearbeiten (alle Felder, auch die Abschrift
 * von Hand), Seite dazu, Abschreiben lassen mit Lauf- und Kostenzeile, zurück
 * in den Eingangskorb, Vorschlag anlegen, Blatt löschen (Plan 2.2).
 */

/** Solange das Blatt nicht eingeordnet ist, steht statt des Fachs sein Stand (Plan 3.8). */
const WARTE = { einordnen: "Wird eingeordnet …", im_korb: "Liegt im Eingangskorb" } as const;

export const blattSub = (d: BlattDaten) =>
  `${d.warte ? WARTE[d.warte] : d.fach}, ${dm(d.datum)}, ${d.seiten.length} ${d.seiten.length === 1 ? "Seite" : "Seiten"}`;

/**
 * Eine Abschrift als Absätze (Prototyp `abschriftEl`): Leerzeilen trennen;
 * „# …“ oder eine einzelne kurze Zeile ohne Satzzeichen am Ende ist eine
 * Überschrift — so stehen Überschriften auf den Blättern.
 */
const istUeberschrift = (b: string) =>
  /^#{1,6}\s/.test(b) || (!b.includes("\n") && b.length <= 60 && !/[.:;,!?)\]]$/.test(b));

function Abschrift({ text }: { text: string }) {
  const bloecke = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <>
      {bloecke.map((b, i) =>
        istUeberschrift(b) ? (
          <h3 key={i}>{b.replace(/^#{1,6}\s+/, "")}</h3>
        ) : (
          // Was nach fliesstext() noch an Umbrüchen steht, ist gewollt
          // (Listenpunkt, Formelzeile); alle anderen fließen.
          <p key={i} style={{ whiteSpace: "pre-line" }}>
            {fliesstext(b)}
          </p>
        ),
      )}
    </>
  );
}

/**
 * „Seite dazu“: öffnet die Kamera der Shell mit dem Blatt als Ziel, auf der
 * Blattseite und unter „Blatt bearbeiten“. Ist eine Seite ohne Netz
 * fotografiert, sagt die Zeile es, bis der Server sie hat.
 */
export function SeiteDazu({ id, seiten }: { id: string; seiten: string[] }) {
  const kombi = useKombi();
  const dazu = dazuAn(useSyncExternalStore(dazuStore.subscribe, dazuStore.get, dazuStore.leer), id);
  return (
    <RowBtn
      titel="Seite dazu"
      sub={
        dazu?.lokal === "haengt"
          ? "Hängt, wird erneut versucht"
          : dazu
            ? "Wird hochgeladen"
            : "Noch eine Seite zu diesem Blatt fotografieren"
      }
      ziel={{
        onClick: () =>
          kombi.openCam({
            ziel: { kind: "attach", materialId: id },
            attach: { id, seiten: seiten.length, bild: seiten[0] ? `/api/material/${seiten[0]}/vorschau` : null },
          }),
      }}
    />
  );
}

export function BlattInhalt({ daten }: { daten: BlattDaten }) {
  const kombi = useKombi();
  const [original, setOriginal] = useState(false);
  // Nicht eingeordnet: das vorläufige Fach ist keins, keine Pille ist gedrückt (Plan 3.8)
  const [fach, setFach] = useState<string | null>(daten.warte ? null : daten.fachId);
  const [vorher, setVorher] = useState(daten);
  const [loeschen, setLoeschen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  if (vorher !== daten) {
    setVorher(daten);
    setFach(daten.warte ? null : daten.fachId);
    setLaeuft(false);
  }

  const fertig = (aufruf: () => Promise<{ ok: boolean }>, text: string | null, danach?: () => void) => {
    aufruf().then(
      (r) => {
        if (!r.ok) throw new Error("abgewiesen");
        if (text) kombi.toast(text);
        if (danach) danach();
        else void kombi.neuLaden();
      },
      () => kombi.fehlerToast("Nicht gespeichert", () => fertig(aufruf, text, danach), "Erneut"),
    );
  };

  const umlegen = (id: string, name: string) => {
    if (id === fach) return;
    const alt = fach;
    setFach(id);
    blattFachAction(daten.id, id).then(
      (r) => {
        if (!r.ok) throw new Error("abgewiesen");
        kombi.toast(`Nach ${name} verschoben`);
        void kombi.neuLaden();
      },
      () => {
        kombi.fehlerToast("Nicht gespeichert", () => umlegen(id, name), "Erneut");
        setTimeout(() => setFach(alt), 300);
      },
    );
  };

  // Solange Claude liest, fragt die Seite nach, bis die Abschrift da ist.
  // Ebenso, solange Jev einordnet: danach steht das Fach da.
  const liest = laeuft || daten.liestGerade || (daten.eingeplant && daten.fuerClaude > 0) || daten.warte === "einordnen";
  useEffect(() => {
    if (!liest) return;
    const t = setInterval(() => void kombi.neuLaden(), 4000);
    return () => clearInterval(t);
  }, [liest, kombi]);

  const abschreiben = () => {
    setLaeuft(true);
    fertig(() => abschreibenAction(daten.id, daten.letzterLaufId), null);
  };

  const sortiert = daten.faecher.slice().sort((x, y) => Number(y.id === fach) - Number(x.id === fach));
  const leer = daten.stand !== "da";

  return (
    <>
      <div className="seg2" role="group" aria-label="Ansicht">
        <button type="button" aria-pressed={!original} onClick={() => setOriginal(false)}>
          Abschrift
        </button>
        <button type="button" aria-pressed={original} onClick={() => setOriginal(true)}>
          Original
        </button>
      </div>
      <div>
        {original ? (
          daten.seiten.map((s) => (
            <div
              key={s.id}
              className="original"
              role="img"
              aria-label="Foto der Seite"
              style={{ backgroundImage: `url("/api/material/${s.id}")`, marginBottom: 14 }}
            />
          ))
        ) : (
          <div className="abschrift">
            {leer ? (
              <>
                <p className="p-sub">
                  {laeuft || daten.liestGerade
                    ? "Wird abgeschrieben …"
                    : daten.stand === "fehler"
                      ? "Abschrift fehlgeschlagen"
                      : "Abschrift folgt"}
                </p>
                {daten.stand === "fehler" && !laeuft && daten.knopf ? (
                  <button className="retry" type="button" onClick={abschreiben}>
                    Erneut versuchen
                  </button>
                ) : null}
              </>
            ) : (
              daten.seiten.map((s) => (s.abschrift ? <Abschrift key={s.id} text={s.abschrift} /> : null))
            )}
          </div>
        )}
      </div>

      <PLab>Fach und Thema</PLab>
      <div className="refile" role="group" aria-label="Fach ändern">
        {sortiert.map((f) => (
          <button key={f.id} className="fp" type="button" aria-pressed={f.id === fach} onClick={() => umlegen(f.id, f.name)}>
            {f.name}
          </button>
        ))}
      </div>
      {daten.themen.length && fach === daten.fachId ? (
        daten.themen.map((t) => (
          <TextLine key={t.id} onClick={() => kombi.openPage("ablage", { thema: t.id })}>
            {t.titel}
          </TextLine>
        ))
      ) : (
        <p className="p-sub" style={{ marginTop: 8 }}>
          Thema folgt
        </p>
      )}

      <PLab>Blatt</PLab>
      <RowBtn titel="Blatt bearbeiten" sub="Fach, Titel, Datum, Notiz, Themen, Abschrift, Seiten" ziel={{ href: `/material/${daten.id}/bearbeiten` }} />
      <SeiteDazu id={daten.id} seiten={daten.seiten.map((x) => x.id)} />
      {daten.knopf && !laeuft ? (
        <RowBtn
          titel="Abschreiben lassen"
          sub={`${daten.fuerClaude === 1 ? "Eine Seite" : `${daten.fuerClaude} Seiten`} ohne Abschrift. Claude schreibt sie vom Foto ab, jeder Lauf kostet Geld vom API-Schlüssel.`}
          ziel={{ onClick: abschreiben }}
          rechts={<span />}
        />
      ) : null}
      {laeuft || daten.liestGerade ? <p className="p-sub">Claude liest gerade …</p> : null}
      {daten.eingeplant && daten.fuerClaude > 0 ? <p className="p-sub">Claude liest dieses Blatt gleich von selbst.</p> : null}
      {daten.lauf ? <p className="p-sub">{daten.lauf}</p> : null}
      {daten.kosten ? <p className="p-sub">{daten.kosten}</p> : null}
      {daten.vorschlag && daten.fuerClaude > 0 ? (
        <p className="p-sub">Am Blatt liegt ein Vorschlag im Eingangskorb. Fehlt danach noch eine Abschrift, lässt sie sich hier abschreiben.</p>
      ) : null}
      {!daten.konfiguriert && daten.fuerClaude > 0 ? (
        <p className="p-sub">Auf diesem Server liest niemand Handschrift von selbst (es fehlt ANTHROPIC_API_KEY). Du kannst die Abschrift unter „Blatt bearbeiten“ abtippen.</p>
      ) : null}
      {daten.durchgesehen ? (
        <RowBtn
          titel="Wieder in den Eingangskorb"
          sub={`Durchgesehen am ${formatGerman(daten.durchgesehen)}`}
          ziel={{ onClick: () => fertig(() => inDenKorbAction(daten.id, true), "Liegt wieder im Eingangskorb") }}
          rechts={<span />}
        />
      ) : (
        <RowBtn
          titel="Als durchgesehen abhaken"
          sub="Liegt noch im Eingangskorb"
          ziel={{ onClick: () => fertig(() => inDenKorbAction(daten.id, false), "Durchgesehen") }}
          rechts={<span />}
        />
      )}
      <RowBtn titel="Vorschlag anlegen" sub="Fach, Titel und Themen für den Eingangskorb" ziel={{ href: `/material/eingang/neu?blatt=${daten.id}` }} />
      <RowBtn titel="Blatt löschen" sub="Mit allen Seiten und Abschriften" ziel={{ onClick: () => setLoeschen(true) }} rechts={<span />} />
      {loeschen ? (
        <Bestaetigung
          titel="Blatt löschen?"
          text={`${daten.titel}, ${daten.seiten.length === 1 ? "eine Seite" : `${daten.seiten.length} Seiten`}. Das lässt sich nicht zurücknehmen.`}
          ja="Löschen"
          onNein={() => setLoeschen(false)}
          onJa={() => {
            setLoeschen(false);
            fertig(() => blattLoeschenAction(daten.id), "Gelöscht", () => {
              kombi.popPage();
              setTimeout(() => void kombi.neuLaden(), 450);
            });
          }}
        />
      ) : null}
    </>
  );
}

export const ablageSub = (d: AblageDaten) =>
  d.filter ? (d.filter.art === "thema" ? `Thema: ${d.filter.titel}` : `Nur ${d.filter.titel}`) : null;

export function AblageInhalt({ daten }: { daten: AblageDaten }) {
  const kombi = useKombi();
  return (
    <>
      {daten.eingang > 0 ? (
        <TextLine href="/material/eingang">
          {daten.eingang === 1 ? "Eingangskorb · ein Blatt" : `Eingangskorb · ${daten.eingang} Blätter`}
        </TextLine>
      ) : null}
      {daten.filter ? <TextLine onClick={() => kombi.openPage("ablage", {})}>Alle Blätter</TextLine> : null}
      {daten.themen.length > 1 || (daten.themen.length === 1 && daten.filter?.art === "fach") ? (
        <div className="refile" role="group" aria-label="Nach Thema filtern" style={{ marginTop: 8 }}>
          {daten.themen.map((t) => (
            <button key={t.id} className="fp" type="button" aria-pressed={t.aktiv} onClick={() => kombi.openPage("ablage", { thema: t.id })}>
              {t.titel}
            </button>
          ))}
        </div>
      ) : null}
      {daten.gruppen.length === 0 ? <p className="empty">Noch keine Blätter abgelegt.</p> : null}
      {daten.gruppen.map((g) => (
        <Fragment key={g.fachId}>
          {daten.filter?.art === "fach" ? (
            <h3 className="p-lab">{g.fach}</h3>
          ) : (
            <h3 className="p-lab">
              <button
                type="button"
                style={{ minHeight: 44, margin: "-12px 0", display: "inline-flex", alignItems: "center", font: "inherit", color: "inherit" }}
                onClick={() => kombi.openPage("ablage", { fach: g.fachId })}
                aria-label={`Nur ${g.fach} zeigen`}
              >
                {g.fach}
              </button>
            </h3>
          )}
          {g.blaetter.map((b) => (
            <BlattRow key={b.id} b={b} />
          ))}
        </Fragment>
      ))}
    </>
  );
}
