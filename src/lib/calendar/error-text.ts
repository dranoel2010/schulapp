/**
 * Ein Fehler als Satz, der aus der Datenbank nichts mitnimmt.
 *
 * Der Grund für diese Datei ist `DrizzleQueryError` (drizzle-orm 0.45): Seine
 * Meldung lautet „Failed query: … params: …" und enthält ALLE gebundenen Werte
 * der Abfrage. `blockConnection()` und `storeRefreshToken()` binden das
 * versiegelte Refresh Token in der WHERE-Klausel, `saveConnection()` schreibt
 * es. Scheitert eine dieser Abfragen — der Postgres-Container startet neu, die
 * Verbindung bricht ab —, stünde das Siegel sonst unter „Letzter Fehler" in der
 * Karte, in der Antwort des Crons, damit in `kalender.log` und in der
 * Störungsnotiz im Vault, und im Container-Protokoll. Ohne GOOGLE_TOKEN_KEY ist
 * es wertlos; aber es verließe die Datenbank und läge in Dateien, die anders
 * gesichert und synchronisiert werden.
 *
 * Deshalb geht im Google Kalender kein Fehler als ganzes Objekt ins Protokoll
 * und keine `message` ungeprüft in einen Satz, sondern immer `errorText()`.
 * Bei einer gescheiterten Abfrage ist das der Grund aus der Datenbank (die
 * `cause`, etwa „terminating connection due to administrator command"), nie
 * die Parameter. Auch PGlite hängt die Parameter an seine Fehler — dort als
 * Feld, nicht in der Meldung; die Meldung allein ist sauber.
 *
 * Reine Rechnung, ohne Import aus drizzle: Next kann dieselbe Bibliothek in
 * zwei Bündeln zweimal auswerten (siehe src/db/index.ts), und dann schlüge ein
 * `instanceof` fehl. Erkannt wird der Fehler deshalb an seiner Form.
 */

/** Länger wird kein Satz — er steht in der Karte und in einer Zeile von `kalender.log`. */
const MAX_LENGTH = 300;

/** Wo bei einer gescheiterten Abfrage die Parameter in der Meldung beginnen. */
const PARAMS_MARKER = "\nparams:";

/**
 * `DrizzleQueryError`: Abfrage und Parameter als Felder, und die Meldung
 * beginnt mit „Failed query:". Ein Fehler von PGlite trägt dieselben Felder,
 * aber eine eigene, saubere Meldung — er ist selbst der Grund.
 */
function isQueryError(fehler: Error): boolean {
  const felder = fehler as Error & { query?: unknown; params?: unknown };
  return (
    typeof felder.query === "string" &&
    Array.isArray(felder.params) &&
    fehler.message.startsWith("Failed query:")
  );
}

function kuerzen(text: string): string {
  const ohneParameter = text.includes(PARAMS_MARKER)
    ? text.slice(0, text.indexOf(PARAMS_MARKER))
    : text;
  const einzeilig = ohneParameter.replace(/\s+/g, " ").trim();

  return einzeilig.length > MAX_LENGTH
    ? `${einzeilig.slice(0, MAX_LENGTH - 1)}…`
    : einzeilig;
}

export function errorText(fehler: unknown): string {
  let aktuell = fehler;

  // Die gescheiterte Abfrage selbst sagt nur „Failed query: …" — der Grund
  // steht in `cause`. Höchstens drei Schritte, falls eine Kette im Kreis läuft.
  for (let schritt = 0; aktuell instanceof Error && isQueryError(aktuell); schritt += 1) {
    if (!(aktuell.cause instanceof Error) || schritt === 3) {
      return "Eine Datenbankabfrage ist gescheitert.";
    }
    aktuell = aktuell.cause;
  }

  return messageOf(aktuell);
}

function messageOf(fehler: unknown): string {
  if (!(fehler instanceof Error)) {
    return typeof fehler === "string" ? kuerzen(fehler) : "unbekannter Fehler";
  }

  const code = (fehler as Error & { code?: unknown }).code;
  const text = kuerzen(fehler.message) || fehler.name;

  // Der Code von Postgres (fünf Zeichen, etwa 57P01) hilft beim Nachschlagen.
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && !text.includes(code)
    ? `${text} (${code})`
    : text;
}
