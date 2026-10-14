/**
 * Die Uhr der Leser (Zuteilung, Claude-Leser). Sie laufen nach der Antwort
 * weiter, ohne Anfrage und damit ohne Cookie der Testuhr. Die Anfrage, die
 * sie anstößt, merkt sich hier den Versatz ihrer App-Uhr (`uhrVersatz()` in
 * @/lib/tag), und der Leser rechnet damit, etwa für `filed_at`, wenn Jev ein
 * Blatt einordnet. Ohne Testuhr ist der Versatz 0, ein Lauf nach dem Start
 * der App (ohne Anfrage) nimmt die Uhr des Rechners.
 */

const globalForUhr = globalThis as unknown as { __schulappLeserUhr?: Map<string, number> };

function versaetze(): Map<string, number> {
  globalForUhr.__schulappLeserUhr ??= new Map();
  return globalForUhr.__schulappLeserUhr;
}

/** Merkt den Versatz der App-Uhr aus der Anfrage, die den Leser anstößt. */
export function leserUhrMerken(userId: string, versatzMs: number): void {
  if (versatzMs === 0) versaetze().delete(userId);
  else versaetze().set(userId, versatzMs);
}

/** „Jetzt“ für einen Leser dieses Nutzers: die Uhr der letzten Anfrage. */
export function leserJetzt(userId: string, real: number = Date.now()): Date {
  return new Date(real + (versaetze().get(userId) ?? 0));
}
