/**
 * Was beim Start der App einmal geschieht (seit dem 11.10.2026).
 *
 * Next ruft `register()` genau einmal, wenn eine Server-Instanz entsteht, und
 * nimmt erst danach Anfragen an (node_modules/next/dist/docs/01-app/
 * 03-api-reference/03-file-conventions/instrumentation.md). Beim Bauen ruft es
 * sie nicht.
 *
 * Hier steht ein einziger Anstoß: das Netz nach einem Neustart für die beiden
 * Leser (`leserBeimStart()` in @/lib/leser/zuteilung). Bis zu diesem Tag war
 * das Netz der Postbote, dessen `read_inbox` alle fünfzehn Sekunden die
 * Zuteilung anstieß; seit die App Opus selbst ruft, gibt es ihn nicht mehr,
 * und ohne diesen Anstoß bliebe nach jedem `nas.sh hoch` liegen, was ein
 * Neustart mitten im Lesen unterbrochen hat.
 *
 * **Angestoßen, nie abgewartet.** `register()` muss fertig sein, bevor der
 * Server die erste Anfrage annimmt; wer hier auf die Datenbank oder auf einen
 * Aufruf an Opus wartete, hielte den Start der App auf — Minuten lang. Abgewartet
 * wird nur das Laden des Moduls.
 *
 * **Nur unter Node.** Next ruft `register()` in jeder Laufzeit, die es gibt;
 * die Leser brauchen die Datenbank und das Dateisystem, und die gibt es nur
 * dort. Der Import steht deshalb in der Bedingung und nicht oben in der Datei
 * — so, wie es der Leitfaden zu instrumentation verlangt.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { leserBeimStart } = await import("@/lib/leser/zuteilung");
  leserBeimStart();
}
