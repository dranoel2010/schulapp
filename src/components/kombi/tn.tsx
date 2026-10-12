/**
 * Ziffern mit eigenen Trennzeichen (Prototyp `tn`). Schibsted Grotesk setzt
 * mit `tabular-nums` auch Komma, Punkt und Doppelpunkt auf Ziffernbreite; die
 * Klasse `.c` stellt sie auf ihre eigene Breite zurück.
 */
export function Tn({ s }: { s: string }) {
  return (
    <>
      {s.split(/([:.,])/).map((t, i) =>
        /^[:.,]$/.test(t) ? (
          <span className="c" key={i}>
            {t}
          </span>
        ) : (
          t
        ),
      )}
    </>
  );
}
