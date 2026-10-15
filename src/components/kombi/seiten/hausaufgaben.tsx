"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAuswahl } from "@/components/kombi/desktop/auswahl";
import { tipptGerade, ueberlagert } from "@/components/kombi/desktop/tasten";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { addDays } from "@/lib/dates";
import { cap, lang, TAG, wd, zahl } from "@/lib/kombi/text";
import type { HausaufgabenDaten } from "@/lib/seiten/hausaufgaben";

import { AufgabeZeile, useAufgaben, type ZeilenModus } from "./aufgabe";
import { TextLine } from "./zeilen";
// Das Detail einer Aufgabe am Rechner meldet sich beim Laden dieses Moduls an
import "@/components/kombi/desktop/aufgabe-detail";

/**
 * Hausaufgaben (Prototyp `PAGES.hausaufgaben` und `hausaufgabenGroups`,
 * Z. 3026–3105): „Für ⟨Tag⟩“, „Später“, „Erledigt“ — davor „Heute“ mit
 * den heute fälligen, noch offenen Aufgaben (sonst fänden sie sich nach der
 * Schule nur über das Fach), bis Schulschluss auch den überfälligen. Danach
 * stehen die überfälligen unter „Für ⟨Tag⟩“ wie im Überblick. Ist „Für ⟨Tag⟩“ leer,
 * steht dort „Für ⟨Tag⟩ ist nichts offen.“ Darunter der Weg zum Formular mit
 * Details (Plan 2.2) und, sobald etwas darin steht, zum Archiv (Antwort 11).
 *
 * Am Rechner (desktop.html `RENDER_hausaufgaben`) ist dieselbe Seite die
 * Liste links: der Text einer Zeile wählt aus, das Detail steht rechts
 * (desktop/aufgabe-detail.tsx), X hakt die gewählte Aufgabe ab oder öffnet
 * sie wieder, und „Archiv“ ist eine Zeile, die das Archiv im Detail öffnet.
 */

/** „Dienstag“, wenn es morgen ist, sonst „Montag, 19.10.“ (Prototyp `tagName`) */
export const tagName = (tag: string, heute: string) =>
  tag === addDays(heute, 1) ? TAG[wd(tag)] : lang(tag);

export function HausaufgabenInhalt({ daten: vomServer }: { daten: HausaufgabenDaten }) {
  // gezeigt wird der Stand, den der FLIP-Lauf übernommen hat (useAufgaben)
  const kombi = useKombi();
  const auswahl = useAuswahl();
  const pfad = usePathname();
  const { stand: daten, anwenden, schalten, loeschen, ankerRef } = useAufgaben(vomServer);
  const fuer = `Für ${tagName(daten.ns, daten.heute)}`;
  // [Überschrift, Liste, Modus, leer zeigen]: „Heute“ nur, wenn etwas offen ist
  const gruppen: [string, HausaufgabenDaten["fuer"], ZeilenModus, boolean][] = [
    ["Heute", anwenden(daten.heuteFaellig ?? []), "page", false],
    [fuer, anwenden(daten.fuer), "page", true],
    ["Später", anwenden(daten.spaeter), "page-sp", false],
    ["Erledigt", anwenden(daten.erledigt), "page", false],
  ];

  // Am Rechner: X hakt die gewählte Aufgabe ab (oder öffnet sie wieder)
  const alle = gruppen.flatMap(([, liste]) => liste);
  const tasteRef = useRef({ alle, schalten, sel: auswahl?.sel ?? null });
  useEffect(() => {
    tasteRef.current = { alle, schalten, sel: auswahl?.sel ?? null };
  });
  const amRechner = !!auswahl;
  useEffect(() => {
    if (!amRechner) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "x") return;
      if (tipptGerade() || ueberlagert()) return;
      const { alle: liste, schalten: s, sel } = tasteRef.current;
      const a = sel ? liste.find((x) => x.id === sel) : undefined;
      if (!a) return;
      e.preventDefault();
      s(a, !a.done);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [amRechner]);

  // Am Rechner steht ohne Auswahl die erste Aufgabe im Detail (desktop.html),
  // nicht aber neben dem Archiv oder dem Formular („Mit Details eintragen“)
  const erste = alle[0]?.id ?? null;
  useEffect(() => {
    if (!amRechner || auswahl?.sel || !erste || pfad !== "/hausaufgaben") return;
    if (new URLSearchParams(window.location.search).get("sel")) return;
    kombi.zeigeBereich("hausaufgaben", { sel: erste }, { ersetzen: true, vonSelbst: true });
  }, [amRechner, auswahl?.sel, erste, pfad, kombi]);

  const archivGewaehlt = amRechner && pfad === "/archiv";

  return (
    <>
      <div ref={ankerRef}>
        {gruppen.map(([l, liste, modus, leerZeigen]) => (
          <div className="group" data-g={l} key={l} hidden={!liste.length && !leerZeigen}>
            {/* am Rechner sagt es der Satz allein („Für Dienstag ist nichts offen.“), ohne Überschrift darüber */}
            {amRechner && !liste.length ? null : <h3 className="lab">{l}</h3>}
            <div>
              {!liste.length && leerZeigen ? <p className="empty">{`${fuer} ist nichts offen.`}</p> : null}
              {liste.map((a) => (
                <AufgabeZeile
                  key={a.id}
                  a={a}
                  modus={modus}
                  heute={daten.heute}
                  onSchalten={schalten}
                  onLoeschen={loeschen}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 16 }} />
      <TextLine href="/hausaufgaben/neu">Mit Details eintragen</TextLine>
      {/* Antwort 11: was länger als zwei Tage erledigt ist, steht im Archiv */}
      {daten.archiv && amRechner ? (
        // am Rechner eine Zeile der Liste: das Archiv steht im Detail
        <button
          className={`lrow plain d-arch${archivGewaehlt ? " sel" : ""}`}
          type="button"
          aria-current={archivGewaehlt ? "true" : undefined}
          onPointerDown={() => kombi.vorladen("archiv")}
          onClick={() => kombi.zeigeBereich("archiv")}
        >
          <span>
            <b>Archiv</b>
            <span className="s">{`${cap(zahl(daten.archiv))} erledigte ${daten.archiv === 1 ? "Aufgabe" : "Aufgaben"}`}</span>
          </span>
          <Icon name="chevron_right" />
        </button>
      ) : daten.archiv ? (
        <TextLine onClick={() => kombi.openPage("archiv")}>Archiv</TextLine>
      ) : null}
    </>
  );
}
