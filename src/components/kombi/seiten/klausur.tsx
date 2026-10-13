"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";

import {
  auslassenAction,
  blockStatusAction,
  blockZurueckAction,
  lernplanNeuAction,
  nachholenAction,
  termineNeuAction,
} from "@/app/(app)/lernblock-actions";
import { Icon } from "@/components/kombi/icon";
import { useKombi } from "@/components/kombi/kontext";
import { TextLine } from "@/components/kombi/seiten/zeilen";
import { blockMerken, useBlock, zustand } from "@/components/kombi/lernblock/uhr";
import { useOptimistischeAktion } from "@/lib/kombi/aktion";
import { klausurPlanAnsicht, planBrauchtDatum } from "@/lib/kombi/archiv";
import type { BlockVorher } from "@/app/(app)/lernblock-actions";
import type { BlockDaten } from "@/lib/kombi/lernblock-daten";
import { E, moveTo, reduce, rubber } from "@/lib/kombi/motion";
import { cap, diffDays, dm, lang, TAG, TK, wd, weekdayOrDate, zahl } from "@/lib/kombi/text";
import type { KlausurenSeite, KlausurSeite } from "@/lib/seiten/klausur";

/**
 * Die Klausurseite (Prototyp `PAGES.klausur`, Z. 3112; V2 9.2) mit dem ganzen
 * Lernplan von `/lernen` (Plan 1.1 Ausnahme, Abschnitt F):
 *
 * - Titel Fachname, darunter „Freitag, 16.10. · in 4 Tagen“, das Thema;
 * - „Lernplan“ als schlichte Liste (`planRows`, Z. 3009): Wochentag links,
 *   heute kräftig mit „Starten“/„Weiter“, die Klausur unter einer Haarlinie;
 * - jede Planzeile schaltet per Tipp oder Linkswisch erledigt ↔ offen, mit
 *   Toast und Rückgängig; ein angefangener Block öffnet stattdessen die Uhr;
 * - Fortschritt, Minuten am Tag, Vorlauf und Warnungen als `.p-sub`, der
 *   Leerzustand mit „Themen eintragen“, verpasste Blöcke mit „Nachholen“ und
 *   „Auslassen“;
 * - „Noten in Mathematik“, „Blätter zum Thema“, dann „Lernplan neu
 *   erstellen“, „Termine neu rechnen“ mit Erklärsatz, „Stoff und Fragen“ und
 *   „Bearbeiten“.
 */

export const relTageSeite = (heute: string, datum: string): string => {
  const n = diffDays(heute, datum);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n > 1) return `in ${n} Tagen`;
  if (n === -1) return "gestern";
  return `vor ${-n} Tagen`;
};

export const klausurTitel = (_p: Record<string, string>, d: unknown): string =>
  (d as KlausurSeite | undefined)?.fach ?? "Klausur";

export const klausurUntertitel = (_p: Record<string, string>, d: unknown): string | null => {
  const k = d as KlausurSeite | undefined;
  return k ? `${lang(k.datum)} · ${relTageSeite(k.heute, k.datum)}` : null;
};

/**
 * Der Tag links in der Planzeile, wie im Prototyp (`planRows`): nur das
 * Kürzel oder „Heute“; die Blässe sagt, dass ein Tag vorbei ist. Hat der Plan
 * zwei Tage mit demselben Kürzel (`planBrauchtDatum`), steht in allen Zeilen
 * darunter das Datum, auf einer festen zweiten Zeile.
 */
function PlanTag({ tag, heute, mitDatum }: { tag: string; heute: string; mitDatum: boolean }) {
  return (
    <>
      {tag === heute ? "Heute" : TK[wd(tag)]}
      {mitDatum ? <span className="pdat">{dm(tag)}</span> : null}
    </>
  );
}

/** Unterzeile einer Planzeile (Prototyp `planRows`). */
function planUnterzeile(b: BlockDaten): string {
  const erledigt = b.status === "done" ? ", erledigt" : "";
  if (b.art === "review") return `${b.thema ?? "Alle Themen"}, ${b.minuten} Minuten${erledigt}`;
  if (b.art === "probe") return `ohne Hilfsmittel, ${b.minuten} Minuten${erledigt}`;
  return `${b.blatt && !b.blatt.fehlgeschlagen ? "Lernblock mit Arbeitsblatt" : "Lernblock"}, ${b.minuten} Minuten${erledigt}`;
}

type Schalten = { id: string; status: "open" | "done" };

export function KlausurInhalt({ daten }: { params: Record<string, string>; daten: KlausurSeite }) {
  const kombi = useKombi();
  const [bloecke, setBloecke] = useState(daten.bloecke);
  const [vorher, setVorher] = useState(daten);
  if (vorher !== daten) {
    // neue Daten vom Server (neuLaden): sie gelten
    setVorher(daten);
    setBloecke(daten.bloecke);
  }
  const [sicht, ausfuehren] = useOptimistischeAktion<BlockDaten[], Schalten>(
    bloecke,
    (s, a) => s.map((b) => (b.id === a.id ? { ...b, status: a.status } : b)),
    kombi.fehlerToast,
  );
  const [arbeitet, setArbeitet] = useState<string | null>(null);

  const heute = daten.heute;
  const kommend = diffDays(heute, daten.datum) > 0;
  // Vorbei (Archiv, unten in „Klausuren“): kein Planen mehr, nur noch der Rückblick
  const ansicht = klausurPlanAnsicht({ datum: daten.datum, heute, themen: daten.themen, bloecke: sicht.length });
  const geplant = sicht.length;
  const erledigt = sicht.filter((b) => b.status === "done").length;

  /** `still`: aus dem Rückgängig des Toasts — kein neuer Toast (Prototyp hideToast vor u()) */
  function schalten(b: BlockDaten, still = false) {
    const status = b.status === "done" ? "open" : "done";
    ausfuehren(
      { id: b.id, status },
      () => blockStatusAction(b.id, status),
      (r) => {
        const { block: neu, vorher } = r as Extract<Awaited<ReturnType<typeof blockStatusAction>>, { ok: true }>;
        setBloecke((l) => l.map((x) => (x.id === b.id ? neu : x)));
        blockMerken(neu);
        // Rückgängig stellt den alten Stand ganz her: nach dem Wiederöffnen
        // auch die gelernten Minuten, den Uhrstand und die Einträge im Protokoll
        if (!still) {
          kombi.toast(
            status === "done" ? "Lernblock erledigt" : "Lernblock wieder offen",
            vorher ? () => zurueck(neu, vorher) : () => schalten(neu, true),
            b.titel,
          );
        }
        void kombi.neuLaden();
      },
    );
  }

  function zurueck(b: BlockDaten, vorher: BlockVorher) {
    ausfuehren(
      { id: b.id, status: "done" },
      () => blockZurueckAction(b.id, vorher),
      (r) => {
        const neu = (r as { ok: true; block: BlockDaten }).block;
        setBloecke((l) => l.map((x) => (x.id === b.id ? neu : x)));
        blockMerken(neu);
        void kombi.neuLaden();
      },
    );
  }

  async function mitToast(name: string, aufruf: () => Promise<{ ok: boolean }>, text: (r: never) => string) {
    if (arbeitet) return;
    setArbeitet(name);
    try {
      const r = await aufruf();
      if (!r.ok) throw new Error("abgewiesen");
      kombi.toast(text(r as never));
      await kombi.neuLaden();
    } catch {
      kombi.fehlerToast("Nicht gespeichert", () => void mitToast(name, aufruf, text), "Erneut");
    } finally {
      setArbeitet(null);
    }
  }

  // Erster Block je Tag trägt den Wochentag (Prototyp: Wochentag links)
  const ersteJeTag = new Set<string>();
  const tageGesehen = new Set<string>();
  for (const b of sicht) {
    if (!tageGesehen.has(b.tag)) {
      tageGesehen.add(b.tag);
      ersteJeTag.add(b.id);
    }
  }
  const mitDatum = planBrauchtDatum([...tageGesehen, daten.datum]);

  return (
    <>
      {daten.thema ? <p style={{ fontSize: 17 }}>{daten.thema}</p> : null}
      {ansicht.lernplan ? <h3 className="p-lab">Lernplan</h3> : null}

      {!ansicht.lernplan ? null : daten.themen === 0 ? (
        <>
          <p className="p-sub">
            Die App verteilt die Themen auf die Tage vor der Prüfung. Sobald du einträgst, was drankommt, steht der Plan.
          </p>
          <Link className="textline" href={`/klausuren/${daten.id}/bearbeiten`}>
            Themen eintragen
            <Icon name="chevron_right" />
          </Link>
        </>
      ) : (
        <>
          {geplant > 0 ? (
            <p className="p-sub">
              {erledigt} von {geplant} {geplant === 1 ? "Block" : "Blöcken"} erledigt
              {daten.gestrichen > 0 ? ` · ${daten.gestrichen} gestrichen` : ""}
            </p>
          ) : null}
          {geplant > 0 && kommend ? (
            <p className="p-sub">
              {daten.minutenProTag}&nbsp;min am Tag · {daten.vorlauf} Tage Vorlauf
            </p>
          ) : null}
          {daten.warnung ? <p className="p-sub">{daten.warnung}</p> : null}
          {daten.verpasst ? (
            <>
              <p className="p-sub">
                {daten.verpasst.anzahl === 1
                  ? `Ein Lernblock von ${weekdayOrDate(daten.verpasst.tag, heute)} ist offen.`
                  : `${cap(zahl(daten.verpasst.anzahl))} Lernblöcke sind offen.`}{" "}
                {daten.verpasst.anzahl === 1
                  ? "Nachholen verteilt ihn auf die Tage bis zur Klausur, Auslassen streicht ihn."
                  : "Nachholen verteilt sie auf die Tage bis zur Klausur, Auslassen streicht sie."}
              </p>
              <div style={{ display: "flex", gap: 24 }}>
                <button
                  className="textbtn"
                  type="button"
                  disabled={!!arbeitet}
                  onClick={() => void mitToast("nachholen", () => nachholenAction(daten.id), () => "Auf die Tage bis zur Klausur verteilt")}
                >
                  Nachholen
                </button>
                <button
                  className="textbtn"
                  type="button"
                  disabled={!!arbeitet}
                  onClick={() => void mitToast("auslassen", () => auslassenAction(daten.id), () => "Ausgelassen")}
                >
                  Auslassen
                </button>
              </div>
            </>
          ) : null}

          {geplant === 0 ? (
            <p className="p-sub">
              {daten.gestrichen > 0
                ? "Alle Lernblöcke sind gestrichen. Kommt ein neues Thema dazu, plant die App wieder."
                : kommend
                  ? `Die Themen stehen. Die App verteilt sie auf ${daten.vorlauf} Tage vor der Prüfung, ${daten.minutenProTag} Minuten am Tag.`
                  : "Für diese Prüfung gibt es keinen Lernplan."}
            </p>
          ) : null}

          <div className="plan">
            {sicht.map((b) => (
              <PlanZeile
                key={b.id}
                block={b}
                geschaltet={b.status !== bloecke.find((x) => x.id === b.id)?.status}
                heute={heute}
                zeigeTag={ersteJeTag.has(b.id)}
                mitDatum={mitDatum}
                fach={daten.fach}
                klausurDatum={daten.datum}
                onSchalten={() => schalten(b)}
              />
            ))}
            <div className="prow exday">
              <span className="pday" aria-label={TAG[wd(daten.datum)]}>
                <PlanTag tag={daten.datum} heute={heute} mitDatum={mitDatum} />
              </span>
              <div className="pbody">
                <b>{daten.art}</b>
                {daten.stunde ? <span>{daten.stunde}. Stunde</span> : null}
              </div>
              <span />
            </div>
          </div>
        </>
      )}

      {daten.noten ? (
        <>
          <div style={{ height: 16 }} />
          <button
            className="lrow plain"
            type="button"
            onPointerDown={() => kombi.vorladen("notenfach", { id: daten.fachId })}
            onClick={() => kombi.openPage("notenfach", { id: daten.fachId })}
          >
            <span>
              <b>Noten in {daten.fach}</b>
              <span className="s">{daten.noten}</span>
            </span>
            <Icon name="chevron_right" />
          </button>
        </>
      ) : null}

      {daten.blaetter.length ? (
        <>
          <h3 className="p-lab">Blätter zum Thema</h3>
          {daten.blaetter.map((b) => (
            <button
              key={b.id}
              className="lrow"
              type="button"
              onPointerDown={() => kombi.vorladen("blatt", { id: b.id })}
              onClick={() => kombi.openPage("blatt", { id: b.id })}
            >
              <span
                className="mini"
                style={b.deckblatt ? { backgroundImage: `url("/api/material/${b.deckblatt}/vorschau")` } : undefined}
              />
              <span>
                <b>{b.titel}</b>
                <span className="s">
                  {dm(b.datum)}, {b.thema}
                </span>
              </span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </>
      ) : null}

      <div style={{ height: 16 }} />
      {kommend && daten.themen > 0 ? (
        <button
          className="lrow plain"
          type="button"
          disabled={!!arbeitet}
          onClick={() =>
            void mitToast("plan", () => lernplanNeuAction(daten.id), () => (geplant > 0 ? "Lernplan neu erstellt" : "Lernplan erstellt"))
          }
        >
          <span>
            <b>{geplant > 0 ? "Lernplan neu erstellen" : "Lernplan erstellen"}</b>
          </span>
          <span />
        </button>
      ) : null}
      {ansicht.termineNeu ? (
        <>
          <button
            className="lrow plain"
            type="button"
            disabled={!!arbeitet}
            onClick={() =>
              void mitToast("termine", termineNeuAction, (r: { termine: number }) =>
                r.termine === 0 ? "Keine offenen Termine" : r.termine === 1 ? "Ein Termin neu gelegt" : `${r.termine} Termine neu gelegt`,
              )
            }
          >
            <span>
              <b>Termine neu rechnen</b>
            </span>
            <span />
          </button>
          <p className="p-sub">
            Nach einer neuen oder verschobenen Klausur: legt die Wiederholungstermine wieder vor die Klausur. Am Takt ändert sich
            nichts.
          </p>
        </>
      ) : null}
      <Link className="lrow plain" href={`/abruf/klausur?id=${daten.id}`}>
        <span>
          <b>Stoff und Fragen</b>
        </span>
        <Icon name="chevron_right" />
      </Link>
      <Link className="lrow plain" href={`/klausuren/${daten.id}/bearbeiten`}>
        <span>
          <b>Bearbeiten</b>
        </span>
        <Icon name="chevron_right" />
      </Link>
    </>
  );
}

/**
 * Eine Planzeile (Prototyp `planRows`). Tipp oder Linkswisch schaltet
 * erledigt ↔ offen; der heutige Block trägt „Starten“/„Weiter“, ein
 * angefangener öffnet die Uhr.
 */
function PlanZeile({
  block: vomServer,
  geschaltet,
  heute,
  zeigeTag,
  mitDatum,
  fach,
  klausurDatum,
  onSchalten,
}: {
  block: BlockDaten;
  /** Der Status ist gerade optimistisch geschaltet (Tipp/Wisch auf dieser Seite) */
  geschaltet: boolean;
  heute: string;
  zeigeTag: boolean;
  /** Alle Zeilen tragen das Datum unter dem Kürzel (`planBrauchtDatum`) */
  mitDatum: boolean;
  fach: string;
  klausurDatum: string;
  onSchalten: () => void;
}) {
  const kombi = useKombi();
  const block = useBlock(vomServer)!;
  // Die Uhr und der Status kommen aus dem Speicher, den auch der Tisch
  // schreibt („Als erledigt zählen?“ → Ja steht sofort hier); nur solange ein
  // Tipp auf dieser Seite optimistisch schaltet, gilt der Status der Seite.
  const b = geschaltet ? { ...block, status: vomServer.status } : block;
  const z = zustand(b);
  const istHeute = b.tag === heute;
  const angefangen = b.status === "open" && !!b.laeuftSeit;
  const rowRef = useRef<HTMLDivElement>(null);
  const wisch = useRef<{ x0: number; y0: number; dx: number; aktiv: boolean } | null>(null);
  const geschluckt = useRef(false);

  const uhrOeffnen = (origin: HTMLElement) =>
    kombi.openTisch({ mode: "block", origin, blockId: b.id, fach, klausurDatum, blatt: b.art === "probe" || (!!b.blatt && !b.blatt.fehlgeschlagen) });

  const tippen = () => {
    if (geschluckt.current) {
      geschluckt.current = false;
      return;
    }
    if (angefangen) uhrOeffnen(rowRef.current!.querySelector<HTMLElement>(".lbbtn") ?? rowRef.current!);
    else onSchalten();
  };

  const runter = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".lbbtn")) return;
    wisch.current = { x0: e.clientX, y0: e.clientY, dx: 0, aktiv: false };
  };
  const ziehen = (e: RPointerEvent<HTMLDivElement>) => {
    const w = wisch.current;
    const el = rowRef.current;
    if (!w || !el) return;
    const dx = e.clientX - w.x0;
    const dy = e.clientY - w.y0;
    if (!w.aktiv) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        wisch.current = null;
        return;
      }
      if (dx > -10) return;
      w.aktiv = true;
      el.setPointerCapture(e.pointerId);
    }
    w.dx = Math.min(0, dx);
    el.style.transform = `translateX(${w.dx < -80 ? -80 - rubber(-w.dx - 80, 120, 0.55) : w.dx}px)`;
  };
  const los = () => {
    const w = wisch.current;
    const el = rowRef.current;
    wisch.current = null;
    if (!w?.aktiv || !el) return;
    geschluckt.current = true;
    setTimeout(() => (geschluckt.current = false), 0);
    moveTo(el, { transform: "translateX(0px)" }, reduce() ? { duration: 0 } : { duration: 260, easing: E.out });
    if (w.dx < -64) {
      if (angefangen) uhrOeffnen(el);
      else onSchalten();
    }
  };

  return (
    <div
      className={`prow${istHeute ? " today" : ""}${b.status === "done" ? " done" : ""}`}
      ref={rowRef}
      role="button"
      tabIndex={0}
      aria-pressed={b.status === "done"}
      aria-label={`${b.titel}, ${planUnterzeile(b)}${angefangen ? ", Uhr öffnen" : b.status === "done" ? ", wieder öffnen" : ", abhaken"}`}
      // Vergangene Tage treten zurück, wie bisher auf /lernen (opacity .6)
      style={{ touchAction: "pan-y", opacity: b.tag < heute ? 0.6 : undefined }}
      onClick={tippen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          tippen();
        }
      }}
      onPointerDown={runter}
      onPointerMove={ziehen}
      onPointerUp={los}
      onPointerCancel={los}
    >
      <span className="pday" aria-label={TAG[wd(b.tag)]}>
        {zeigeTag ? <PlanTag tag={b.tag} heute={heute} mitDatum={mitDatum} /> : ""}
      </span>
      <div className="pbody">
        <b>{b.titel}</b>
        <span>{planUnterzeile(b)}</span>
      </div>
      {istHeute && b.status !== "done" ? (
        <button
          className="lbbtn"
          type="button"
          aria-label={z === "ruhe" ? "Lernblock starten" : "Lernblock fortsetzen"}
          onClick={(e) => {
            e.stopPropagation();
            uhrOeffnen(e.currentTarget);
          }}
        >
          {z === "ruhe" ? "Starten" : "Weiter"}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// ── Klausuren ─────────────────────────────────────────────────────────────────

/**
 * Die Liste der Klausuren (Prototyp `PAGES.klausuren`, Z. 3106): kommende
 * zuerst, darunter blasser die vergangenen der letzten 14 Tage (Antwort 11).
 */
export function KlausurenInhalt({ daten }: { params: Record<string, string>; daten: KlausurenSeite }) {
  const kombi = useKombi();
  return (
    <>
      {daten.klausuren.length === 0 ? <p className="empty">Noch keine Klausur eingetragen.</p> : null}
      {/* eigener Behälter: die letzte Zeile bleibt :last-child, ohne Strich (Prototyp Z. 415) */}
      <div>
        {daten.klausuren.map((k) => (
          <button
            key={k.id}
            className={`lrow plain${k.vorbei ? " vorbei" : ""}`}
            type="button"
            onPointerDown={() => kombi.vorladen("klausur", { id: k.id })}
            onClick={() => kombi.openPage("klausur", { id: k.id })}
          >
            <span>
              <b>{k.fach}</b>
              <span className="s">
                {lang(k.datum)} · {k.thema}
              </span>
            </span>
            <Icon name="chevron_right" />
          </button>
        ))}
      </div>
      {/* wie „Fach anlegen“ auf der Fächer-Seite (Plan 2.3: Textzeile mit Chevron) */}
      {daten.klausuren.length ? <div style={{ height: 16 }} /> : null}
      <TextLine href="/klausuren/neu">Klausur eintragen</TextLine>
      {/* Antwort 11: ab Tag 15 nach dem Klausurtag steht eine Klausur im Archiv */}
      {daten.archiv ? <TextLine onClick={() => kombi.openPage("archiv")}>Archiv</TextLine> : null}
    </>
  );
}

