/**
 * Womit eine Probeklausur geschrieben wird (Antwort vom 14.10.2026): in
 * Mathematik und Physik mit Taschenrechner, in allen anderen Fächern ohne
 * Hilfsmittel. Das Fach wird am Namen erkannt, gleich ob groß oder klein
 * geschrieben und ob mit Zusatz („Mathe LK“, „Physik (Epoche)“).
 *
 * Reine Rechnung ohne Datenbank, damit Planzeile, Zeile und der Auftrag an
 * Opus dieselbe Regel lesen.
 */

const MIT_TASCHENRECHNER = new Set(["mathe", "mathematik", "physik"]);

export function probeMitTaschenrechner(fach: string | null | undefined): boolean {
  if (!fach) return false;
  return fach
    .toLocaleLowerCase("de")
    .split(/[^\p{L}]+/u)
    .some((wort) => MIT_TASCHENRECHNER.has(wort));
}

/** „mit Taschenrechner“ oder „ohne Hilfsmittel“, für die Unterzeile der Probeklausur. */
export function probeHilfsmittel(fach: string | null | undefined): "mit Taschenrechner" | "ohne Hilfsmittel" {
  return probeMitTaschenrechner(fach) ? "mit Taschenrechner" : "ohne Hilfsmittel";
}
