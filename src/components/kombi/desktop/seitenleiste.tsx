"use client";

import { Icon } from "@/components/kombi/icon";
import type { TagDaten } from "@/lib/kombi/startseite";
import { offeneFuer } from "@/lib/kombi/startseite";
import { voll } from "@/lib/kombi/text";

import { BEREICHE, type Bereich } from "./bereiche";

/**
 * Die Seitenleiste am Rechner (desktop.html `.rail`): oben das Datum mit dem
 * blauen Punkt, dann die Bereiche als reine Textpunkte, unten Einstellungen.
 * Hausaufgaben zählt, was für den nächsten Schultag offen ist, mit
 * Überfälligem (dieselbe Menge wie die Startseite, `offeneFuer`); Klausuren
 * zählt die der nächsten zwei Wochen aus den TagDaten.
 *
 * Gerendert wird sie immer, mit `display:none` im style-Attribut: unter
 * 1024 px bleibt sie aus dem Bild, darüber setzt src/app/desktop/grund.css
 * sie mit !important wieder. (Das hidden-Attribut ginge nicht: Tailwind setzt
 * `[hidden]` in @layer base mit !important, und das schlägt jede Regel
 * außerhalb der Ebenen.) So rendern Server und Browser dasselbe, und am Handy
 * ändert sich nichts.
 */
/** Unter 1024 px unsichtbar; grund.css überstimmt es ab 1024 px mit !important. */
const AUS = { display: "none" } as const;

export function Seitenleiste({
  daten,
  aktiv,
  onBereich,
}: {
  daten: TagDaten | null;
  aktiv: Bereich | null;
  onBereich: (b: Bereich) => void;
}) {
  const offen = daten ? offeneFuer(daten, daten.aufgaben).length : 0;
  const klausuren = daten ? daten.klausurenBald.length : 0;
  const zahl: Partial<Record<Bereich, number>> = { hausaufgaben: offen, klausuren };
  const punkt = (b: (typeof BEREICHE)[number]) => (
    <button
      key={b.key}
      className="r-item"
      type="button"
      data-v={b.key}
      aria-current={aktiv === b.key ? "page" : undefined}
      aria-keyshortcuts={b.taste ? String(b.taste) : undefined}
      onClick={() => onBereich(b.key)}
    >
      <span>{b.label}</span>
      {b.key === "einstellungen" ? <Icon name="settings" /> : <span className="n">{zahl[b.key] ? String(zahl[b.key]) : ""}</span>}
    </button>
  );
  const nav = BEREICHE.filter((b) => b.key !== "einstellungen");
  return (
    <aside className="rail" aria-label="Navigation" style={AUS}>
      <div className="r-when">
        <span className="dot" aria-hidden="true" />
        <span>{daten ? <b>{voll(daten.tag)}</b> : null}</span>
      </div>
      <nav className="r-nav">
        {nav.slice(0, 5).map(punkt)}
        <span className="r-sep" aria-hidden="true" />
        {nav.slice(5).map(punkt)}
      </nav>
      <div className="r-foot">{BEREICHE.filter((b) => b.key === "einstellungen").map(punkt)}</div>
    </aside>
  );
}
