import { useId } from "react";

/**
 * Platz zum Rechnen oder Schreiben (Prototyp `padSvg`, Z. 4361): Kästchen
 * 5 mm für Mathe als SVG-Muster, damit sie sauber drucken, oder Linien 9 mm
 * für Sprachen. Breite 165 mm = 33 Kästchen. Bei Kästchen ist `n` die Höhe
 * in mm, bei Linien die Zahl der Linien.
 */
export function Kaestchen({ papier, n }: { papier: "kaestchen" | "linien"; n: number }) {
  const id = `k5-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const W = 165;
  if (papier === "kaestchen") {
    return (
      <svg className="a4-pad" viewBox={`0 0 ${W} ${n}`} style={{ width: `${W}mm`, height: `${n}mm` }} aria-hidden="true">
        <defs>
          <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M5 0V5H0" style={{ fill: "none", stroke: "var(--a4-grid)", strokeWidth: 0.18 }} />
          </pattern>
        </defs>
        <rect width={W} height={n} style={{ fill: `url(#${id})` }} />
        <rect x=".11" y=".11" width={W - 0.22} height={n - 0.22} style={{ fill: "none", stroke: "var(--a4-grid-edge)", strokeWidth: 0.22 }} />
      </svg>
    );
  }
  const H = n * 9 + 1;
  return (
    <svg className="a4-pad" viewBox={`0 0 ${W} ${H}`} style={{ width: `${W}mm`, height: `${H}mm` }} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <line key={i} x1="0" x2={W} y1={(i + 1) * 9} y2={(i + 1) * 9} style={{ stroke: "var(--a4-rule)", strokeWidth: 0.22 }} />
      ))}
    </svg>
  );
}
