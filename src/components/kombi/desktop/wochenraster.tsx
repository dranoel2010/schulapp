"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { useBlock, zustand } from "@/components/kombi/lernblock/uhr";
import { useAufgaben } from "@/components/kombi/seiten/aufgabe";
import { TextLine } from "@/components/kombi/seiten/zeilen";
import { Tn } from "@/components/kombi/tn";
import { addDays } from "@/lib/dates";
import { E, reduce } from "@/lib/kombi/motion";
import { dm, TAG, wd } from "@/lib/kombi/text";
import type { AufgabeDaten } from "@/lib/seiten/gemeinsam";
import type { LernEintrag, WocheDaten } from "@/lib/seiten/woche";

import { perTaste } from "./tasten";

/**
 * Die Woche am Rechner (desktop.html `RENDER_woche`, `miniTask`): ein Raster
 * Mo bis Fr. Oben „Abgeben“ (abhakbar, mit Rückgängig) und „Lernen“ (der
 * Lernplan aller Klausuren, ohne Uhrzeit, „Starten“ unter dem Text), darunter
 * die Stunden mit Zeitspalte. Eine Ferienwoche ist eine einzige Zeile.
 *
 * Die Pfeile holen die Nachbarwoche selbst (`/api/seite/woche?tag=`) und
 * schreiben die Adresse per replaceState, damit Neuladen dieselbe Woche zeigt.
 * Mit der Maus schiebt das Raster 200 ms und 12 px, mit der Tastatur steht es.
 */

const montagVon = (d: WocheDaten) => d.tage[0].tag;

async function wocheHolen(tag: string | null): Promise<WocheDaten> {
  const res = await fetch(`/api/seite/woche${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Woche: ${res.status}`);
  const json = (await res.json()) as { ok: boolean; daten?: WocheDaten };
  if (!json.ok || !json.daten) throw new Error("Woche abgewiesen");
  return json.daten;
}

/** Die Adresse folgt der gezeigten Woche; der Eintrag der Shell bleibt, nur die Woche darin wechselt. */
function adresseSetzen(tag: string | null) {
  const url = tag ? `/stundenplan?tag=${encodeURIComponent(tag)}` : "/stundenplan";
  const st = (window.history.state ?? {}) as { stapel?: { art: string; params: Record<string, string> }[] };
  const stapel = st.stapel?.map((e, i, a) =>
    i === a.length - 1 && e.art === "woche" ? { ...e, params: tag ? { ...e.params, tag } : {} } : e,
  );
  window.history.replaceState(stapel ? { ...st, stapel } : st, "", url);
}

export function Wochenraster({ daten: vomShell }: { daten: WocheDaten }) {
  const kombi = useKombi();
  // Die gezeigte Woche: anfangs die der Shell, nach den Pfeilen die geholte
  const [geholt, setGeholt] = useState<WocheDaten | null>(null);
  const ansicht = geholt && montagVon(geholt) !== montagVon(vomShell) ? geholt : vomShell;
  const { stand: daten, anwenden, schalten } = useAufgaben(ansicht);
  const gridRef = useRef<HTMLDivElement>(null);
  const richtung = useRef(0);
  const lauf = useRef(0);

  const wechseln = useCallback(
    function wechseln(ziel: string | null, dir: number) {
      const nr = ++lauf.current;
      wocheHolen(ziel).then(
        (d) => {
          if (nr !== lauf.current) return;
          richtung.current = perTaste() ? 0 : dir;
          setGeholt(d);
          adresseSetzen(ziel && montagVon(d) !== d.dieseWoche ? montagVon(d) : null);
        },
        () => {
          if (nr === lauf.current) kombi.toast("Keine Verbindung", () => wechseln(ziel, dir), "Keine Verbindung", "Erneut");
        },
      );
    },
    [kombi],
  );

  // Nach einer Action lädt die Shell ihre Woche neu; steht hier eine andere, holt sie sich selbst frisch
  const shellVorher = useRef(vomShell);
  useEffect(() => {
    if (shellVorher.current === vomShell) return;
    shellVorher.current = vomShell;
    if (geholt && montagVon(geholt) !== montagVon(vomShell)) {
      const nr = ++lauf.current;
      const tag = montagVon(geholt);
      wocheHolen(tag).then(
        (d) => {
          if (nr === lauf.current) setGeholt(d);
        },
        () => {},
      );
    }
  }, [vomShell, geholt]);

  // Wochenwechsel: 200 ms und 12 px aus der Richtung des Pfeils; reduziert nur Überblenden
  const montag = montagVon(daten);
  const montagVorher = useRef(montag);
  useLayoutEffect(() => {
    if (montagVorher.current === montag) return;
    montagVorher.current = montag;
    const dir = richtung.current;
    richtung.current = 0;
    const g = gridRef.current;
    if (!g || dir === 0) return;
    g.animate(
      reduce() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: `translateX(${dir * 12}px)` }, { opacity: 1, transform: "none" }],
      { duration: 200, easing: E.out },
    );
  }, [montag]);

  const tage = daten.tage;
  const istDiese = montag === daten.dieseWoche;
  const ferien = tage.every((t) => !!t.frei);
  const ferienName = ferien && tage.every((t) => t.frei === tage[0].frei) ? tage[0].frei! : "Ferien";
  const ersteStunde = 4;
  const zeiten = ferien ? [] : daten.zeiten;
  const td = (tag: string) => (tag === daten.heute ? " td" : "");
  const platz = (zeile: number, spalte: number | string, hoehe = 1): CSSProperties => ({
    gridRow: hoehe > 1 ? `${zeile} / span ${hoehe}` : zeile,
    gridColumn: spalte,
  });

  return (
    <div className="wkd">
      <div className="d-head">
        <div>
          <h2 className="d-h1">Woche</h2>
          <p className="d-sub">
            <Tn s={`${dm(tage[0].tag)} bis ${dm(tage[4].tag)}`} />
          </p>
        </div>
        <div className="wk-nav">
          <button
            className="textbtn"
            type="button"
            aria-hidden={istDiese}
            tabIndex={istDiese ? -1 : undefined}
            onClick={() => {
              if (!istDiese) wechseln(null, montag > daten.dieseWoche ? -1 : 1);
            }}
          >
            Diese Woche
          </button>
          <button className="icb" type="button" aria-label="Vorige Woche" onClick={() => wechseln(addDays(montag, -7), -1)}>
            <Icon name="chevron_left" />
          </button>
          <button className="icb" type="button" aria-label="Nächste Woche" onClick={() => wechseln(addDays(montag, 7), 1)}>
            <Icon name="chevron_right" />
          </button>
        </div>
      </div>

      <div className="wk" ref={gridRef} role="group" aria-label={`Woche vom ${dm(tage[0].tag)} bis ${dm(tage[4].tag)}`}>
        <div className="wk-h wk-corner" style={platz(1, 1)} />
        {tage.map((t, i) => (
          <div key={t.tag} className={`wk-h${td(t.tag)}`} style={platz(1, i + 2)}>
            <b>{TAG[wd(t.tag)]}</b>
            <span>
              <Tn s={t.tag === daten.heute ? `${dm(t.tag)} · heute` : dm(t.tag)} />
            </span>
          </div>
        ))}

        <div className="wk-lab" style={platz(2, 1)}>
          Abgeben
        </div>
        {tage.map((t, i) => (
          <div key={t.tag} className={`wk-x${td(t.tag)}`} style={platz(2, i + 2)}>
            {anwenden(t.abgeben).map((a) => (
              <MiniAufgabe key={a.id} a={a} onSchalten={schalten} />
            ))}
          </div>
        ))}

        <div className="wk-lab" style={platz(3, 1)}>
          Lernen
        </div>
        {tage.map((t, i) => (
          <div key={t.tag} className={`wk-x${td(t.tag)}`} style={platz(3, i + 2)}>
            {t.lernen.map((e) => (
              <MiniLernen key={e.block.id} e={e} heute={daten.heute} />
            ))}
          </div>
        ))}

        {ferien ? (
          <>
            <div className="wk-t" style={platz(ersteStunde, 1)} />
            <div className="wk-free" style={platz(ersteStunde, "2 / -1")}>
              {ferienName}
            </div>
          </>
        ) : zeiten.length === 0 ? (
          // Kein Stundenplan eingetragen: derselbe Satz wie auf Heute, der Weg dorthin daneben.
          // Die Zellen darunter tragen die Markierung von heute weiter.
          <>
            <div className="wk-t" style={platz(ersteStunde, 1)} />
            {tage.map((t, i) => (
              <div key={t.tag} className={`wk-c wk-c-leer${td(t.tag)}`} style={platz(ersteStunde, i + 2)} aria-hidden="true" />
            ))}
            <div className="wk-free wk-leer" style={platz(ersteStunde, "2 / -1")}>
              <span>Keine Stunden eingetragen</span>
              <Link className="textbtn" href="/stundenplan/bearbeiten">
                Stundenplan bearbeiten
              </Link>
            </div>
          </>
        ) : (
          <>
            {zeiten.map((z, r) => (
              <div key={z.nr} className="wk-t" style={platz(ersteStunde + r, 1)}>
                {z.von ? <Tn s={z.von} /> : `${z.nr}.`}
                {z.bis ? (
                  <span className="end">
                    <Tn s={z.bis} />
                  </span>
                ) : null}
              </div>
            ))}
            {tage.map((t, i) => {
              if (t.frei) {
                return (
                  <div key={t.tag} className={`wk-c wk-c-frei${td(t.tag)}`} style={platz(ersteStunde, i + 2, zeiten.length)}>
                    <em>{t.frei}</em>
                  </div>
                );
              }
              const zellen = [];
              for (let r = 0; r < zeiten.length; r++) {
                const nr = zeiten[r].nr;
                const l = t.stunden.find((s) => s.nr === nr);
                if (!l && t.stunden.some((s) => s.nr < nr && s.bisNr >= nr)) continue;
                const hoehe = l ? Math.min(l.bisNr, zeiten[zeiten.length - 1].nr) - nr + 1 : 1;
                zellen.push(
                  <div key={`${t.tag}-${nr}`} className={`wk-c${td(t.tag)}`} style={platz(ersteStunde + r, i + 2, hoehe)}>
                    {l ? (
                      <>
                        <b>{l.fach}</b>
                        {l.hu || l.raum ? <em>{l.hu ? `Hauptunterricht${l.raum ? ` · ${l.raum}` : ""}` : l.raum}</em> : null}
                        {l.klausur ? <span className="tag">{`Klausur: ${l.klausur}`}</span> : null}
                      </>
                    ) : null}
                  </div>,
                );
              }
              return zellen;
            })}
          </>
        )}
      </div>

      {zeiten.length === 0 && !ferien ? null : (
        <div className="wk-edit">
          <TextLine href="/stundenplan/bearbeiten">Stundenplan bearbeiten</TextLine>
        </div>
      )}
    </div>
  );
}

/** Eine Aufgabe im Raster (desktop.html `miniTask`): Ring zum Abhaken, Fach fett vor dem Text. */
function MiniAufgabe({ a, onSchalten }: { a: AufgabeDaten; onSchalten: (a: AufgabeDaten, done: boolean) => void }) {
  return (
    <div className={`mt${a.done ? " done" : ""}`}>
      <button
        className="check"
        type="button"
        aria-pressed={a.done}
        aria-label={`${a.fach}, ${a.text}, ${a.done ? "wieder öffnen" : "abhaken"}`}
        onClick={() => onSchalten(a, !a.done)}
      >
        <span className="ring">
          <span className="cfill">
            <Icon name="check" />
          </span>
        </span>
      </button>
      <p title={`${a.fach} ${a.text}`}>
        <b>{a.fach}</b>
        <span>{a.text}</span>
      </p>
    </div>
  );
}

/**
 * Ein Planeintrag im Raster, ohne Uhrzeit. Heute trägt er „Starten“ oder
 * „Weiter“ unter dem Text; der Tisch wächst aus dem Knopf.
 */
function MiniLernen({ e, heute }: { e: LernEintrag; heute: string }) {
  const kombi = useKombi();
  const b = useBlock(e.block)!;
  const z = zustand(b);
  const erledigt = b.status === "done";
  const istHeute = b.tag === heute;
  return (
    <div className="ml">
      <p title={b.titel}>
        <span className="ml-t">{b.titel}</span>
        <span>{`${e.kurz}, ${b.minuten} Minuten${erledigt ? ", erledigt" : ""}`}</span>
      </p>
      {istHeute && !erledigt ? (
        <button
          className="lbbtn"
          type="button"
          aria-label={`${e.kurz}, ${b.titel}: ${z === "ruhe" ? "Lernblock starten" : "Lernblock fortsetzen"}`}
          onClick={(ev) =>
            kombi.openTisch({
              mode: "block",
              origin: ev.currentTarget,
              blockId: b.id,
              fach: e.fach,
              klausurDatum: e.klausurDatum,
              blatt: b.art === "probe" || (!!b.blatt && !b.blatt.fehlgeschlagen),
            })
          }
        >
          {z === "ruhe" ? "Starten" : "Weiter"}
        </button>
      ) : null}
    </div>
  );
}
