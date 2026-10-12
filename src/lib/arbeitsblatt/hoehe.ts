import { MIN_AUFGABEN, type Aufgabe } from "./schema";

/**
 * Passt Seite 1 auf ein A4? (Befund der Abnahme von H, 12.10.2026)
 *
 * Erlaubt sind bis zu acht Aufgaben mit `platz` bis 120 — zusammen weit mehr,
 * als auf eine Seite geht. Das PDF verkleinert höchstens auf 85 %, und `.a4`
 * schneidet in Vorschau, Lupe und Druck still ab. Deshalb setzt
 * `blattErgebnis` dieses Höhenbudget durch, bevor ein Blatt gespeichert
 * wird: erst `platz` anteilig kürzen (bis auf die Hälfte), dann hinten
 * Aufgaben kappen — nie unter `MIN_AUFGABEN`.
 *
 * Ob eine Seite passt, sagt `passt` — im Betrieb der echte Satz des PDF
 * (`seiteEinsPasst` in @/lib/pdf/arbeitsblatt-document), keine Schätzung:
 * das Beispiel des Prototyps füllt die Seite bis auf 4 mm, eine Schätzung
 * hätte es schon gekürzt.
 */

/** Richtwerte für den Auftrag: so viel Platz passt neben den Texten auf die Seite. */
export const PLATZ_SUMME_MM = 150;
export const LINIEN_SUMME = 16;

/** Bis auf die Hälfte wird `platz` gekürzt; reicht das nicht, fällt hinten eine Aufgabe weg. */
const SCHRITTE = [0.9, 0.8, 0.7, 0.6, 0.5];

/** `platz` mit Faktor `f`: Kästchen auf ganze 5 mm, Linien ganz; nie unter 10 mm bzw. eine Linie. */
export function platzGekuerzt(a: Aufgabe, f: number, papier: "kaestchen" | "linien"): Aufgabe {
  if (!a.platz || f >= 1) return a;
  const platz =
    papier === "kaestchen"
      ? Math.max(Math.min(a.platz, 10), Math.floor((a.platz * f) / 5) * 5)
      : Math.max(Math.min(a.platz, 1), Math.floor(a.platz * f));
  return platz === a.platz ? a : { ...a, platz };
}

export type Eingepasst = { aufgaben: Aufgabe[]; gekappt: number; gekuerzt: boolean };

/**
 * Setzt das Höhenbudget von Seite 1 durch. Passt alles, bleibt alles, wie es
 * ist. Sonst `platz` schrittweise kürzen bis auf die Hälfte; reicht das
 * nicht, hinten eine Aufgabe weg und von vorn. Mit `MIN_AUFGABEN` Aufgaben
 * wird bis auf die Mindesthöhen gekürzt; was dann noch fehlt, holt das PDF
 * mit seinem Maßstab (bis 85 %).
 */
export function aufSeiteEins(
  aufgaben: readonly Aufgabe[],
  papier: "kaestchen" | "linien",
  passt: (aufgaben: Aufgabe[]) => boolean,
): Eingepasst {
  let liste = [...aufgaben];
  if (passt(liste)) return { aufgaben: liste, gekappt: 0, gekuerzt: false };
  while (true) {
    const letzte = liste.length <= MIN_AUFGABEN;
    for (const f of letzte ? [...SCHRITTE, 0.35, 0.2, 0] : SCHRITTE) {
      const neu = liste.map((a) => platzGekuerzt(a, f, papier));
      if (passt(neu) || (letzte && f === 0)) {
        return { aufgaben: neu, gekappt: aufgaben.length - neu.length, gekuerzt: f < 1 };
      }
    }
    liste = liste.slice(0, -1);
    if (passt(liste)) return { aufgaben: liste, gekappt: aufgaben.length - liste.length, gekuerzt: false };
  }
}
