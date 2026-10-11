/**
 * Wie eine Auskunft an ein Modell aussieht: Zahlen im Satz und die Länge des
 * Ganzen.
 *
 * Bis zum 11.10.2026 stand das in @/lib/mcp/run, privat, weil nur die
 * Werkzeuge des Web MCP einem Modell etwas sagten. Seit dem Tag gibt die App
 * den Stoff einer Klausur auch selbst an Opus (der Fragenlauf, @/lib/fragenlauf),
 * und zwar DIESELBE Auskunft, die read_exam_material im Chat gibt — Satz,
 * Warnungen, Grenze (@/lib/klausur-stoff). Damit die beiden Wege nicht
 * auseinanderlaufen, holen sich beide die Bausteine von hier.
 */

/**
 * „3 Blätter", „ein Blatt", „keine Seite" — Zahlen, die sich lesen lassen.
 *
 * Das Geschlecht steht dabei, weil es im Deutschen nicht am Wort abzulesen ist
 * und weil „ein Seite" auffällt: diese Sätze gehen an ein Modell, das dem
 * Nutzer gleich darauf antwortet, und ein schiefer Satz hier wird oben im
 * Chatfenster wiederholt. Vorgabe ist sächlich — das ist bei Blatt, Fach und
 * Thema richtig, also bei der Mehrzahl der Fälle.
 */
export function zahl(
  anzahl: number,
  einzahl: string,
  mehrzahl: string,
  genus: "m" | "f" | "n" = "n",
): string {
  const artikel = genus === "f" ? "eine" : "ein";

  if (anzahl === 0) return `k${artikel} ${einzahl}`;
  if (anzahl === 1) return `${artikel} ${einzahl}`;

  return `${anzahl} ${mehrzahl}`;
}

/**
 * 142 300 statt 142300 — mit dem Leerzeichen, das im Deutschen die Tausender
 * trennt.
 *
 * Von Hand und nicht mit `toLocaleString("de-DE")`: das hängt an den
 * Sprachdaten der Laufzeit, und eine node-Fassung ohne volle ICU-Daten schriebe
 * still „142,300" — im deutschen Satz daneben ist das Komma das Dezimalzeichen,
 * die Zahl behauptete also das Gegenteil. `formatBytes()` in @/lib/images setzt
 * seine Zahlen aus demselben Grund selbst zusammen.
 */
export function tausender(wert: number): string {
  return Math.round(wert)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
}

/**
 * Wie lang ein Datenergebnis werden darf.
 *
 * Die Schwester von `MAX_IMAGE_BYTES` in @/lib/mcp/run, von der anderen Seite
 * gerechnet: dort werden aus drei Bytes vier Base64-Zeichen, hier ist der Text
 * schon Text. Die Grenze ist dieselbe — ein Werkzeugergebnis endet in der
 * Claude-App bei rund 150 000 Zeichen —, und wie beim Bild bleiben zehntausend
 * für den JSON-RPC-Umschlag, die Feldnamen und den Satz drumherum.
 *
 * Bis zur Abschrift konnte kein Leseergebnis in die Nähe kommen: zweihundert
 * Blattzeilen wiegen ein paar Zehntausend Zeichen, und deshalb stand hier bis
 * heute nichts — der Datenzweig lief ungedeckelt in `JSON.stringify()`. Was
 * dann passiert, hängt vom Client ab: abgeschnitten, abgewiesen oder still
 * verschluckt, und keine dieser drei Antworten sagt jemandem, was los ist.
 * Eine Abschrift kann die Grenze erreichen — `MAX_PAGES` mal
 * `PROPOSAL_TRANSCRIPT_MAX` sind 96 000 —, und genau deshalb sind die beiden
 * Zahlen an der Tür so gewählt, dass sie darunter bleiben, statt sich darauf zu
 * verlassen.
 *
 * Abgeschnitten wird nichts. Ein halbes JSON ist kein JSON, und eine halbe
 * Antwort sähe aus wie eine ganze: das Modell arbeitete mit ihr weiter, und
 * niemand sähe je, dass etwas fehlt. Dieselbe Ehrlichkeit wie bei
 * `grenzeErreicht()` in @/lib/mcp/run, nur schärfer — dort steht ein Hinweis
 * unter einer vollständigen Liste, hier ein Fehler statt einer unvollständigen
 * Antwort.
 *
 * Gezählt werden Zeichen des Rohtextes; der JSON-RPC-Umschlag verlängert
 * Anführungszeichen und Zeilenumbrüche noch einmal um ein bis drei Prozent, und
 * beide kommen in einer Abschrift häufiger vor als in unseren übrigen
 * Antworten. Die zehntausend Reserve decken das — gerechnet, nicht gemessen,
 * dieselbe Ehrlichkeit wie bei `MAX_IMAGE_BYTES`.
 *
 * **Seit dem 11.10.2026 gilt sie auch für den Fragenlauf der App.** Dort geht
 * der Stoff nicht durch die Claude-App, sondern über die API, und die nähme
 * mehr. Die Grenze bleibt trotzdem dieselbe: gemessen ist der Fragenlauf nur
 * an Stoff unter ihr (12 Fragen in gut zwei Minuten, 12.9.2026), und ein Stoff,
 * den das Modell im Chat nicht ganz bekäme, soll es ohne Mensch daneben auch
 * nicht bekommen — beide Wege sollen auf dieselbe Klausur dasselbe sehen.
 */
export const MAX_DATA_CHARS = 140_000;

/**
 * Wie lang eine Auskunft ist — gezählt wie der Text, den der Route Handler
 * daraus zusammensetzt: Satz, Zeilenumbruch, JSON (`toolResult()` in
 * @/app/api/mcp/route.ts).
 */
export function auskunftZeichen(satz: string, daten: unknown): number {
  return satz.length + 1 + JSON.stringify(daten).length;
}
