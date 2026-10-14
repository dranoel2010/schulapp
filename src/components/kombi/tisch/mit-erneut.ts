/**
 * Eine Anfrage mit „Erneut“: scheitert sie, bekommt `fehler` eine Funktion,
 * die genau diese Anfrage noch einmal stellt (für den Toast „Keine
 * Verbindung · Erneut“). Wie `holen` beim Wiederholen (tisch/index.tsx).
 * Gibt die Ladefunktion zurück; sie ist schon einmal gelaufen.
 */
export function mitErneut<T>(
  holen: () => Promise<T>,
  fertig: (r: T) => void,
  fehler: (erneut: () => void) => void,
): () => void {
  const laden = () => {
    holen().then(fertig, () => fehler(laden));
  };
  laden();
  return laden;
}
