"use client";

import type { FachEintrag } from "@/lib/kombi/fach-alias";

/**
 * Fachpillen über den Tokens (Prototyp `renderFachPills`, Z. 2706): stehen
 * da, solange beim Eintragen das Fach fehlt. Ein Tipp setzt das Fach in den
 * Kontext der Zeile; der Fokus bleibt im Feld (mousedown verhindert).
 */
export function Fachpillen({ faecher, onWahl }: { faecher: readonly FachEintrag[]; onWahl: (f: FachEintrag) => void }) {
  return (
    <>
      {faecher.map((f) => (
        <button
          key={f.id}
          className="fp"
          type="button"
          aria-pressed="false"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onWahl(f)}
        >
          {f.name}
        </button>
      ))}
    </>
  );
}
