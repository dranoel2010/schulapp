/**
 * Unter welcher Adresse dieser Server gerade erreicht wird.
 *
 * **Warum das eine Frage ist.** OAuth und MCP hängen an Adressen: der
 * Aussteller in den Metadaten, die Rücksprungadresse, und vor allem die
 * Adresse, für die ein Token gilt (RFC 8707). Alle drei müssen dieselbe sein,
 * sonst passt am Ende ein Token nicht zu dem Server, der es ausgestellt hat.
 * Fest eintragen lässt sie sich nicht: lokal ist es `http://localhost:3000`,
 * in der Cloud die Domain, und in einer Vorschau-Bereitstellung eine dritte.
 *
 * **`APP_URL` gewinnt, wenn sie gesetzt ist.** Sie ist die Antwort für den
 * Fall, dass die App hinter etwas steht, das die Kopfzeilen nicht durchreicht
 * — oder dass jemand sie unter zwei Domains erreichen kann und nur eine davon
 * gelten soll. Ohne sie wird die Adresse aus der Anfrage gelesen.
 *
 * **Ist das Lesen aus der Anfrage nicht fälschbar?** Ja, ein `Host`-Kopf lässt
 * sich setzen. Er nützt nur nichts: ein Token wird an die Adresse gebunden, mit
 * der es ausgestellt wurde, und das geschieht im Browser eines angemeldeten
 * Menschen auf der echten Domain. Wer den Kopf fälscht, bekommt daraufhin ein
 * Nein für sein eigenes Token — er verschafft sich nichts, er schließt sich
 * selbst aus.
 *
 * `x-forwarded-*` steht vor `host`, weil hinter einem Vercel-Deployment genau
 * dort die Adresse steht, die der Nutzer in der Adresszeile sieht.
 */
export function requestOrigin(request: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const headers = request.headers;
  const host =
    headers.get("x-forwarded-host") ?? headers.get("host") ?? null;

  if (!host) return new URL(request.url).origin;

  // Ein weitergereichter Kopf kann eine Liste sein ("a, b") — es gilt der
  // erste, also der, den der Nutzer angesprochen hat.
  const first = (value: string) => (value.split(",")[0] ?? "").trim();
  const proto = headers.get("x-forwarded-proto");

  return `${proto ? first(proto) : new URL(request.url).protocol.replace(":", "")}://${first(host)}`;
}

/** Die Adresse des MCP-Endpunkts — die „Ressource“, für die Token gelten. */
export function mcpResource(request: Request): string {
  return `${requestOrigin(request)}/api/mcp`;
}
