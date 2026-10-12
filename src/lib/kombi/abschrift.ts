/**
 * Eine Abschrift als Absätze in der Gestalt des Prototyps (`abschriftEl`,
 * Z. 3236–3241): Überschrift (`h3`), Formelzeile (`.formel`, kursiv in
 * Newsreader) oder Absatz (`p`, darin `{…}` als Formel über `fx`).
 *
 * Der Prototyp hat die Art je Absatz in seinen Daten (`['h', …]`,
 * `['f', …]`); echte Abschriften sind Text. Deshalb wird hier erkannt:
 * - „# …“ ist eine Überschrift;
 * - ein ganzer Absatz in `{…}` ist eine Formel;
 * - eine einzelne Zeile mit „=“, bis 80 Zeichen, ohne ein Wort aus fünf
 *   oder mehr Buchstaben ist eine Formel („f(x) = a(x − d)² + e“,
 *   „x = −p/2 ± √((p/2)² − q)“) — ein Satz („Der Scheitelpunkt ist …“) nie.
 * Rein und ohne DOM, damit es ein Test prüfen kann.
 */

export type AbschriftTeil = { art: "h" | "f" | "p"; text: string };

const WORT = /\p{L}{5,}/u;

export function istFormelzeile(absatz: string): boolean {
  const t = absatz.trim();
  if (!t || t.includes("\n") || t.length > 80) return false;
  if (/^\{[^{}]+\}$/.test(t)) return true;
  if (!t.includes("=")) return false;
  return !WORT.test(t);
}

export function abschriftTeile(absaetze: string[]): AbschriftTeil[] {
  return absaetze
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a): AbschriftTeil => {
      if (/^#{1,6}\s/.test(a)) return { art: "h", text: a.replace(/^#{1,6}\s+/, "") };
      if (istFormelzeile(a)) return { art: "f", text: a.replace(/^\{([^{}]+)\}$/, "$1") };
      return { art: "p", text: a };
    });
}
