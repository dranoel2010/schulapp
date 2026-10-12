import type { Aufgabe } from "@/lib/arbeitsblatt/schema";

import { Mx, Teile } from "./seite";

/**
 * Die Lösung einer Aufgabe auf Seite 2 (Prototyp `block`, Z. 4401): Satz,
 * Teile, Umformung am Gleichheitszeichen ausgerichtet, Ergebnis und
 * „Achtung:“ aus den Verwechslungssätzen.
 */
export function Loesung({ teile, kursiv }: { teile: Aufgabe["l"]; kursiv: boolean }) {
  return (
    <>
      {teile.map((t, i) => {
        switch (t[0]) {
          case "p":
            return (
              <p key={i}>
                <Mx text={t[1]} />
              </p>
            );
          case "teile":
            return <Teile key={i} liste={t[1]} kursiv={kursiv} />;
          case "eq":
            return (
              <div key={i} className="a4-eqs">
                {t[1].map(([l, r], j) => (
                  <span key={j} style={{ display: "contents" }}>
                    <span>
                      <Mx text={l} />
                    </span>
                    <span className="eq">=</span>
                    <span>
                      <Mx text={r} />
                    </span>
                  </span>
                ))}
              </div>
            );
          case "erg":
            return (
              <p key={i} className="a4-erg">
                <Mx text={t[1]} />
              </p>
            );
          case "hint":
            return (
              <p key={i} className="a4-hint">
                <b>Achtung:</b> <Mx text={t[1]} />
              </p>
            );
        }
      })}
    </>
  );
}
