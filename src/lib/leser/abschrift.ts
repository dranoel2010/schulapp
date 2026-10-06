import type { Leser } from "@/db/schema";

/**
 * Aus Doclings Markdown wird eine Abschrift — reine Rechnung, ohne Netz und
 * ohne Datenbank (seit dem 6.10.2026).
 *
 * Eine Abschrift ist Text, wie er auf dem Blatt steht, und kein Markdown: das
 * Fach-PDF setzt sie Zeile für Zeile, das Wiki schreibt sie wörtlich unter
 * „## Seite N“, und Jev liest sie zum Einordnen. Ein `## ` am Zeilenanfang
 * wäre im Wiki eine neue Überschrift mitten in der Seite, ein `&amp;` im PDF
 * ein Fehler, der nie auf dem Blatt stand. Deshalb wird hier das Wenige
 * abgebaut, was Docling an Auszeichnung schreibt — gemessen an den 37
 * Docling-Ausgaben vom 5.10.2026: Überschriften (19), `<!-- image -->` (19),
 * `&amp;`/`&lt;`/`&gt;`, Tabellen (3) und `\_`.
 *
 * **Keine ⟨⟩ um Wörter.** Claude markiert, was es beim Abschreiben nicht
 * sicher lesen konnte; Docling kennt diese Unsicherheit nicht, und sie aus
 * einem Wörterbuch nachzurechnen ist bewusst nicht gebaut (Entscheidung 2:
 * kein Hunspell, kein Wörterbuch). Dass ein Lesefehler hier ohne Klammer
 * steht, sagt stattdessen die Kennzeichnung `maschinell` an der Seite.
 */

/** Doclings Platzhalter für ein Bild auf dem Blatt. */
const BILD_KOMMENTAR = /<!--\s*image\s*-->/g;

/** Jeder andere HTML-Kommentar — `formula-not-decoded` und Verwandte. */
const KOMMENTAR = /<!--[\s\S]*?-->/g;

/**
 * Die Entities, die vorkommen können. Ein einziger Durchlauf, damit ein
 * `&amp;lt;` zu `&lt;` wird und nicht weiter zu `<` — so stand es da.
 */
const ENTITY = /&(?:amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/g;

const BENANNT: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  // Ein gewöhnliches Leerzeichen und nicht U+00A0: in einer Abschrift ist ein
  // geschütztes Leerzeichen unsichtbar und ließe eine Suche nach zwei Wörtern
  // ins Leere laufen.
  "&nbsp;": " ",
};

/**
 * Überschriftsmarke am Zeilenanfang. Leerzeichen und Tab, nicht `\s`: das
 * fräße einen Zeilenumbruch mit, und eine leere Marke „#“ zöge die nächste
 * Zeile zu sich herauf.
 */
const UEBERSCHRIFT = /^#{1,6}[ \t]+/gm;

/** Eine Trennzeile unter dem Tabellenkopf: `|---|:--:|`. */
const TABELLEN_TRENNER = /^\|(?:\s*:?-+:?\s*\|)+$/;

/** Die Escapes, die Docling vor Markdown-Zeichen setzt. */
const ESCAPE = /\\([_*#|])/g;

/** Entities dekodieren — Zahlen nur, wenn sie ein gültiges Zeichen ergeben. */
export function entitiesDekodieren(text: string): string {
  return text.replace(ENTITY, (entity) => {
    const benannt = BENANNT[entity];
    if (benannt !== undefined) return benannt;

    const hex = entity[2] === "x" || entity[2] === "X";
    const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);

    // Ein Surrogat allein oder eine Zahl jenseits von Unicode ist kein
    // Zeichen; dann bleibt stehen, was dastand, statt ein Ersatzzeichen zu
    // erfinden.
    if (
      !Number.isInteger(code) ||
      code <= 0 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      return entity;
    }

    return String.fromCodePoint(code);
  });
}

/**
 * Eine Tabellenzeile als Text: Zellen getrimmt, mit „ | “ verbunden, ohne die
 * Pipes am Rand. Ein `\|` in einer Zelle trennt nicht.
 */
function tabellenZeile(zeile: string): string {
  const innen = zeile.trim().slice(1, -1);

  return innen
    .split(/(?<!\\)\|/)
    .map((zelle) => zelle.trim())
    .join(" | ");
}

/**
 * Doclings Markdown einer Seite als Abschrift.
 *
 * Die Reihenfolge der Schritte zählt an einer Stelle: die Entities kommen
 * NACH den Kommentaren. Andersherum würde aus einem `&lt;!-- … --&gt;`, das
 * als Text auf dem Blatt stand, erst ein Kommentar und dann nichts.
 *
 * Tabellen werden zeilenweise zu Text, Zelle neben Zelle — eine Tabelle im
 * Fließtext liest sich so, wie man sie vorlesen würde, und das PDF setzt sie
 * ohne Spaltenrechnung.
 */
export function doclingZuAbschrift(markdown: string): string {
  const ohneKommentare = markdown
    .replace(BILD_KOMMENTAR, "⟨Bild⟩")
    .replace(KOMMENTAR, "");

  const zeilen = entitiesDekodieren(ohneKommentare)
    .replace(UEBERSCHRIFT, "")
    .split("\n")
    .flatMap((zeile) => {
      const rand = zeile.trim();
      if (TABELLEN_TRENNER.test(rand)) return [];
      if (rand.length > 1 && rand.startsWith("|") && rand.endsWith("|")) {
        return [tabellenZeile(rand)];
      }
      return [zeile];
    })
    .map((zeile) => zeile.replace(ESCAPE, "$1").trimEnd());

  return zeilen
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Die erste Überschrift in Doclings Markdown — der Titel eines Blattes, das
 * Docling allein gelesen hat.
 *
 * Wörtlich, nur dekodiert und ohne Escapes; nichts wird umformuliert. Ist sie
 * länger als `max`, wird am letzten Leerzeichen davor gekürzt (sonst hart),
 * ohne Auslassungszeichen — ein Titel ist ein Griff zum Wiederfinden, und
 * „…“ am Ende behauptete eine Fortsetzung, die niemand mehr sucht.
 * Überschriften, die nach dem Säubern leer sind, zählen nicht.
 */
export function ersteUeberschrift(markdown: string, max: number): string | null {
  for (const treffer of markdown.matchAll(/^#{1,6}[ \t]+(.+)$/gm)) {
    const text = entitiesDekodieren((treffer[1] ?? "").replace(KOMMENTAR, " "))
      .replace(ESCAPE, "$1")
      .replace(/\s+/g, " ")
      .trim();

    if (text === "") continue;
    if (text.length <= max) return text;

    const schnitt = text.lastIndexOf(" ", max);
    return schnitt > 0 ? text.slice(0, schnitt).trimEnd() : text.slice(0, max);
  }

  return null;
}

/**
 * Der Titel aus der ersten Seite — oder `null`, wenn er nicht dran ist.
 *
 * Nur, wenn am Blatt noch der Platzhalter steht („Blatt vom 6.10.“) — einen
 * Titel, den ein Mensch getippt oder Claude gefunden hat, ersetzt keine
 * Überschrift. Nur, wenn die erste Seite eine Docling-Seite ist: von einer
 * Claude-Seite kennt die App keinen Text außer der Abschrift, und den Titel
 * daraus zu finden ist Claudes Sache. Und nur, wenn Docling dort eine
 * Überschrift gesehen hat.
 */
export function titelAusErsterSeite(
  aktuell: string,
  platzhalter: string,
  ersteSeite: { leser: Leser | null; doclingText: string | null } | null,
  max: number,
): string | null {
  if (aktuell !== platzhalter) return null;
  if (!ersteSeite || ersteSeite.leser !== "docling") return null;
  if (!ersteSeite.doclingText) return null;

  return ersteUeberschrift(ersteSeite.doclingText, max);
}
