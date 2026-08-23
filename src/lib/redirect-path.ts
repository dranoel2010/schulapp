/**
 * Wohin die App nach einer Anmeldung weiterschicken darf.
 *
 * Reine Rechnung: keine Datenbank, kein Next. Gebraucht wird sie an zwei
 * Stellen — auf der Anmeldeseite, die den Parameter aus der Adresse liest, und
 * in der Server Action, die das versteckte Feld daraus bekommt. Zwei Fassungen
 * hießen: eine wird eines Tages nachgeschärft und die andere nicht.
 *
 * **Warum das überhaupt geprüft wird.** Der Parameter existiert für genau
 * einen Fall: die Anmeldung eines Agenten schickt auf
 * `/login?weiter=/oauth/authorize?…`, damit der Nutzer danach dort weitermacht,
 * wo er unterbrochen wurde. Wer den Parameter setzen kann, bestimmt aber, wohin
 * eine echte Anmeldeseite dieser App am Ende führt — und eine Umleitung von
 * einer echten Anmeldeseite auf eine nachgebaute ist genau die Falle, für die
 * Anmeldeseiten benutzt werden.
 *
 * **Geprüft wird mit dem URL-Parser und nicht mit einer Zeichenliste.** Eine
 * Liste verbotener Zeichen ist ein Wettlauf, den man verliert: `//host` ist
 * bekannt, `/\host` ist es weniger — der WHATWG-Parser behandelt den
 * Rückwärts-Schrägstrich in einem http-Schema wie einen gewöhnlichen, und
 * `new URL("/\\\\example.com", …)` landet auf `example.com`. Statt die nächste
 * Schreibweise zu erraten, wird der Wert vor genau demselben Parser aufgelöst,
 * der ihn später im Browser auflöst: bleibt der Ursprung dabei nicht der
 * eigene, ist es kein Pfad auf diesem Server.
 */

/** Ein Ursprung, den es nicht gibt — nur als Maßstab für die Auflösung. */
const PROBE_ORIGIN = "https://schulapp.invalid";

/**
 * Der Pfad, wenn er einer ist — sonst die Startseite.
 *
 * Angenommen wird nur, was mit einem Schrägstrich beginnt **und** vor dem
 * URL-Parser auf dem eigenen Ursprung bleibt. Der zweite Teil ist der
 * eigentliche Schutz; der erste hält Unsinn wie `mailto:…` schon vorher ab,
 * der zwar nicht auf einen fremden Ursprung zeigt, aber auch kein Pfad ist.
 */
export function safeNextPath(value: string | undefined | null): string {
  if (typeof value !== "string") return "/";

  const wanted = value.trim();
  if (!wanted.startsWith("/")) return "/";

  let resolved: URL;
  try {
    resolved = new URL(wanted, PROBE_ORIGIN);
  } catch {
    return "/";
  }

  if (resolved.origin !== PROBE_ORIGIN) return "/";

  // Zurückgegeben wird, was der Parser daraus gemacht hat, und nicht der
  // Eingabetext: so steht in der Umleitung genau die Adresse, die auch geprüft
  // wurde. Ein `/a/../b` wird dadurch zu `/b` — dasselbe Ziel, nur
  // unmissverständlich.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
