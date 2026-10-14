"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  abschreibenAction,
  blattFachAction,
  blattLoeschenAction,
  inDenKorbAction,
} from "@/app/(app)/material/seite-actions";
import { dazuAn, dazuStore } from "@/components/kombi/ablauf/blaetter-store";
import { seitenAnhaengen, useErsteAuswahl } from "@/components/kombi/desktop/ablegen";
import { useAuswahl } from "@/components/kombi/desktop/auswahl";
import { istDesktop, useDesktop } from "@/components/kombi/desktop/use-desktop";
import { useKombi } from "@/components/kombi/kontext";
import { formatGerman } from "@/lib/dates";
import { BLATT_VOLL_HINWEIS, MAX_PAGES } from "@/lib/images";
import { dm, fliesstext } from "@/lib/kombi/text";
import type { AblageDaten, BlattDaten } from "@/lib/seiten/ablage";
import type { FachDaten, ThemaZeile } from "@/lib/seiten/faecher";

import { Bestaetigung, BlattRow, PLab, RowBtn, TextLine } from "./zeilen";

/**
 * Blatt und Ablage (Prototyp Z. 3146–3174): Abschrift oder Original, „Fach
 * und Thema“ mit den Fachpillen zum Umlegen, darunter die Wege, die es
 * bisher auf der Blattseite gab — Bearbeiten (alle Felder, auch die Abschrift
 * von Hand), Seite dazu, Abschreiben lassen mit Lauf- und Kostenzeile, zurück
 * in den Eingangskorb, Vorschlag anlegen, Blatt löschen (Plan 2.2).
 *
 * Am Rechner (desktop.html `RENDER_ablage`, `blattDetail`) ist die Ablage die
 * Liste links, mit Fachpillen (`.d-fil`) darüber; das Blatt steht rechts im
 * Detail. Ab 1440 px liegt das Original als eigene Spalte neben der Abschrift
 * (`.bl-orig`). Unter „Fach und Thema“ stehen dort „Thema üben“ oder „Thema
 * abfragen“ und „Seite dazu“ (Bilder aus dem Ordner statt der Kamera). Am
 * Handy ändert sich nichts: was nur am Rechner steht, rendert erst, wenn
 * `useDesktop()` es sagt (nach dem Mount, ab 1024 px).
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
  // Ein volles Blatt nimmt keine Seite mehr: derselbe Satz wie unter „Blatt bearbeiten“
  if (seiten.length >= MAX_PAGES && !dazu) return <p className="p-sub">{BLATT_VOLL_HINWEIS}</p>;
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
  const desktop = useDesktop();
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

  /** Rückgängig nach dem Umlegen (am Rechner): das vorige Fach mit seinen Themen, ohne neuen Toast. */
  const zuruecklegen = (alt: string, themen: string[]) => {
    setFach(alt);
    blattFachAction(daten.id, alt, themen).then(
      (r) => {
        if (!r.ok) throw new Error("abgewiesen");
        void kombi.neuLaden();
      },
      () => kombi.fehlerToast("Nicht gespeichert", () => zuruecklegen(alt, themen), "Erneut"),
    );
  };

  const umlegen = (id: string, name: string) => {
    if (id === fach) return;
    const alt = fach;
    // die Themen fallen beim Umlegen ab; Rückgängig bringt sie wieder
    const themen = alt === daten.fachId ? daten.themen.map((t) => t.titel) : [];
    setFach(id);
    blattFachAction(daten.id, id).then(
      (r) => {
        if (!r.ok) throw new Error("abgewiesen");
        // am Rechner mit Rückgängig (desktop.html `blattDetail`), am Handy wie bisher
        kombi.toast(`Nach ${name} verschoben`, istDesktop() && alt ? () => zuruecklegen(alt, themen) : undefined);
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

  const originale = daten.seiten.map((s) => (
    <div
      key={s.id}
      className="original"
      role="img"
      aria-label="Foto der Seite"
      style={{ backgroundImage: `url("/api/material/${s.id}")`, marginBottom: 14 }}
    />
  ));
  const abschrift = (
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
  );

  const inhalt = (
    <>
      <div className="seg2 bl-seg" role="group" aria-label="Ansicht">
        <button type="button" aria-pressed={!original} onClick={() => setOriginal(false)}>
          Abschrift
        </button>
        <button type="button" aria-pressed={original} onClick={() => setOriginal(true)}>
          Original
        </button>
      </div>
      {desktop ? (
        // Am Rechner stehen beide im Baum; ab 1440 px zeigt die Mitte immer
        // die Abschrift, und das Original hat seine eigene Spalte (ablage.css)
        <div>
          <div className={original ? "bl-ab bl-aus" : "bl-ab"}>{abschrift}</div>
          <div className={original ? "bl-og" : "bl-og bl-aus"}>{originale}</div>
        </div>
      ) : (
        <div>{original ? originale : abschrift}</div>
      )}

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
      {desktop ? <BlattFuss daten={daten} fach={fach} /> : null}

      <PLab>Blatt</PLab>
      <RowBtn titel="Blatt bearbeiten" sub="Fach, Titel, Datum, Notiz, Themen, Abschrift, Seiten" ziel={{ href: `/material/${daten.id}/bearbeiten` }} />
      {desktop ? null : <SeiteDazu id={daten.id} seiten={daten.seiten.map((x) => x.id)} />}
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
              // am Rechner bleibt die Ablage stehen, ein anderes Blatt rückt ins Detail
              if (istDesktop()) kombi.zeigeBereich("ablage", {}, { ersetzen: true });
              else kombi.popPage();
              setTimeout(() => void kombi.neuLaden(), 450);
            });
          }}
        />
      ) : null}
    </>
  );

  if (!desktop) return inhalt;
  return (
    <>
      <div className="bl-main">{inhalt}</div>
      <aside className="bl-orig" aria-label="Original">
        <p className="bl-cap">Original</p>
        {originale}
      </aside>
    </>
  );
}

/** Die Themen eines Fachs mit ihrer Art, am Rechner für „Thema üben“ oder „Thema abfragen“ nachgeholt. */
function useFachThemen(fachId: string | null): ThemaZeile[] | null {
  const [stand, setStand] = useState<{ id: string; themen: ThemaZeile[] } | null>(null);
  useEffect(() => {
    if (!fachId) return;
    let weg = false;
    fetch(`/api/seite/fach?id=${encodeURIComponent(fachId)}`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean; daten?: FachDaten }>) : null))
      .then((j) => {
        if (!weg && j?.ok && j.daten) setStand({ id: fachId, themen: j.daten.themen });
      })
      .catch(() => {});
    return () => {
      weg = true;
    };
  }, [fachId]);
  return stand && stand.id === fachId ? stand.themen : null;
}

/**
 * Am Rechner unter „Fach und Thema“ (desktop.html `blattDetail`): „Thema
 * üben“ öffnet das Arbeitsblatt des Themas auf dem Tisch, „Thema abfragen“
 * die Karten des Fachs; „Seite dazu“ hängt Bilder aus dem Ordner an.
 */
function BlattFuss({ daten, fach }: { daten: BlattDaten; fach: string | null }) {
  const kombi = useKombi();
  const datei = useRef<HTMLInputElement>(null);
  const eingeordnet = !daten.warte && fach === daten.fachId;
  const themen = useFachThemen(eingeordnet && daten.themen.length ? daten.fachId : null);
  const thema = themen ? (daten.themen.map((t) => themen.find((x) => x.id === t.id)).find((x) => !!x) ?? null) : null;
  const dazu = dazuAn(useSyncExternalStore(dazuStore.subscribe, dazuStore.get, dazuStore.leer), daten.id);
  const voll = daten.seiten.length >= MAX_PAGES && !dazu;

  let lernen: ReactNode = null;
  if (thema && eingeordnet) {
    const ueben = thema.art === "ueben";
    lernen = (
      <button
        className="btn quiet"
        type="button"
        onClick={(e) =>
          kombi.openTisch(
            ueben ? { thema: thema.id, origin: e.currentTarget } : { mode: "wh", fach: daten.fachId, origin: e.currentTarget },
          )
        }
      >
        {ueben ? "Thema üben" : "Thema abfragen"}
      </button>
    );
  }
  return (
    <>
      <div className="d-foot bl-foot">
        {lernen}
        {voll ? null : (
          <button className="btn quiet" type="button" onClick={() => datei.current?.click()}>
            Seite dazu
          </button>
        )}
      </div>
      {voll ? <p className="p-sub bl-hinweis">{BLATT_VOLL_HINWEIS}</p> : null}
      {dazu ? (
        <p className="p-sub bl-hinweis">{dazu.lokal === "haengt" ? "Seite dazu hängt, wird erneut versucht" : "Seite dazu wird hochgeladen"}</p>
      ) : null}
      <input
        ref={datei}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const dateien = [...(e.target.files ?? [])];
          e.target.value = "";
          if (dateien.length) void seitenAnhaengen(daten.id, dateien, kombi);
        }}
      />
    </>
  );
}

export const ablageSub = (d: AblageDaten) =>
  d.filter ? (d.filter.art === "thema" ? `Thema: ${d.filter.titel}` : `Nur ${d.filter.titel}`) : null;

/**
 * Der Fachfilter der Ablage am Rechner (desktop.html `ui.filter`): Zustand
 * des Fensters, nicht der Adresse. Er bleibt, wenn ein Blatt im Detail steht
 * und die Liste daneben neu rendert.
 */
let filterJetzt: string | null = null;
const filterHoerer = new Set<() => void>();
const filterStore = {
  get: () => filterJetzt,
  leer: () => null,
  subscribe(f: () => void) {
    filterHoerer.add(f);
    return () => filterHoerer.delete(f);
  },
  setzen(id: string | null) {
    filterJetzt = id;
    filterHoerer.forEach((f) => f());
  },
};

export function AblageInhalt({ daten }: { daten: AblageDaten }) {
  const kombi = useKombi();
  // am Rechner in der Liste (sonst null): Fachpillen, Filter im Fenster
  const auswahl = useAuswahl();
  const gesetzt = useSyncExternalStore(filterStore.subscribe, filterStore.get, filterStore.leer);
  const pillen = !!auswahl && !daten.filter && daten.gruppen.length > 0;
  const aktiv = pillen && daten.gruppen.some((g) => g.fachId === gesetzt) ? gesetzt : null;
  const gruppen = aktiv ? daten.gruppen.filter((g) => g.fachId === aktiv) : daten.gruppen;
  const faecher = pillen ? daten.gruppen.map((g) => ({ id: g.fachId, name: g.fach })).sort((a, b) => a.name.localeCompare(b.name, "de")) : [];
  const erstes = gruppen[0]?.blaetter[0]?.id ?? null;
  useErsteAuswahl("/material", erstes ? { art: "blatt", params: { id: erstes } } : null);

  return (
    <>
      {pillen ? (
        <div className="d-fil" role="group" aria-label="Fach">
          <button className="fp" type="button" aria-pressed={!aktiv} onClick={() => filterStore.setzen(null)}>
            Alle
          </button>
          {faecher.map((f) => (
            <button key={f.id} className="fp" type="button" aria-pressed={aktiv === f.id} onClick={() => filterStore.setzen(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      ) : null}
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
      {gruppen.map((g) => (
        <Fragment key={g.fachId}>
          {daten.filter?.art === "fach" ? (
            <h3 className="p-lab">{g.fach}</h3>
          ) : (
            <h3 className="p-lab">
              <button
                type="button"
                style={{ minHeight: 44, margin: "-12px 0", display: "inline-flex", alignItems: "center", font: "inherit", color: "inherit" }}
                // am Rechner filtert der Kopf wie die Pille, am Handy öffnet er die gefilterte Ablage
                onClick={() => (pillen ? filterStore.setzen(g.fachId) : kombi.openPage("ablage", { fach: g.fachId }))}
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
