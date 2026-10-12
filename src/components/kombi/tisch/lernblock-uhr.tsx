"use client";

import { Icon } from "@/components/kombi/icon";
import { fmtRest, restMs, zustand } from "@/components/kombi/lernblock/uhr";
import type { BlockDaten } from "@/lib/kombi/lernblock-daten";
import { tn } from "@/lib/kombi/text";

/**
 * Die Uhr oben rechts auf dem Tisch im Lernblock (Prototyp `#tClock`,
 * `clockLoop`, Z. 950, 4209–4228): „24:12“ in 15/560 mit
 * tabellarischen Ziffern; pausiert steht das Pause-Zeichen davor, und die
 * Uhr wird blasser. Ein Tipp hält an oder lässt weiterlaufen.
 */
export function LernblockUhr({
  block,
  jetzt,
  verborgen,
  onTipp,
}: {
  block: BlockDaten;
  jetzt: number;
  verborgen?: boolean;
  onTipp: () => void;
}) {
  const z = zustand(block);
  const pause = z === "pausiert";
  return (
    <button
      className={`t-clock${pause ? " paused" : ""}`}
      id="tClock"
      type="button"
      hidden={verborgen}
      aria-label={pause ? "Uhr fortsetzen" : "Uhr anhalten"}
      onClick={onTipp}
    >
      {pause ? <Icon name="pause" id="tClockIcon" /> : null}
      <span id="tClockText" dangerouslySetInnerHTML={{ __html: tn(fmtRest(restMs(block, jetzt))) }} />
    </button>
  );
}
