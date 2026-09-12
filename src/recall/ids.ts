/**
 * Ist das überhaupt eine id?
 *
 * ── Warum das eine eigene Datei ist ─────────────────────────────────────────
 *
 * Weil der Kern seit dem Eingangskorb Aufrufer hat, die sich nicht an das
 * Datenmodell halten müssen. Bis dahin kam jede id aus einem `<select>` oder
 * einem Link der App: sie war immer echt, und die Abfragen konnten sie
 * ungeprüft in ein `where id = $1` stellen. Ein Agent schickt „Mathe-Klausur",
 * und dann antwortet nicht die App, sondern Postgres — auf Englisch, mit dem
 * ganzen SQL im Text, als geworfene Ausnahme mitten in einem Werkzeugaufruf.
 * Gemessen am 12.9.2026: `stoffZuKlausur`, `vorschlagAnlegen` und `createItem`
 * warfen alle drei.
 *
 * Eine fehlgeformte id ist deshalb ab hier dasselbe wie eine, die es nicht
 * gibt — „diese Prüfung gibt es nicht" ist die richtige Antwort auf beides,
 * und sie ist ein Ergebnis und keine Ausnahme.
 *
 * ── Und warum sie hier noch einmal steht ────────────────────────────────────
 *
 * Dieselbe Regel liegt privat in @/lib/materials, @/lib/inbox, @/lib/oauth,
 * @/lib/exams und @/lib/mcp/resolve. Eine weitere Kopie ist der Preis der
 * Grenze des Abrufkerns: Er darf aus der Schulapp nur vier Module importieren,
 * und diese Zeile aufzunehmen hieße, die Grenze für eine Zeichenkettenprüfung
 * zu öffnen. Wer eine ändert, ändert die anderen mit — das gilt hier wie dort.
 */

const UUID_MUSTER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function istId(wert: string): boolean {
  return UUID_MUSTER.test(wert.trim());
}
