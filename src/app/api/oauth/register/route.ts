import {
  checkRegistration,
  registerClient,
  splitRedirectUris,
  sweepGrants,
  OAUTH_SCOPE,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * Die Anmeldung eines Clients (Dynamic Client Registration, RFC 7591).
 *
 * **Diese Adresse verlangt kein Passwort, und das ist so gemeint.** Ein Client
 * meldet sich an, bevor irgendjemand ihn gesehen hat; erst danach schickt er
 * den Menschen zur Zustimmung. Ohne diesen Weg müsste man in der Claude-App von
 * Hand eine Client-Kennung eintragen, die es vorher gar nicht geben kann.
 *
 * Was sie deshalb NICHT tut: irgendetwas erlauben. Eine Zeile in
 * `oauth_clients` ist ein Name und eine Rückadresse — kein Nutzer, kein
 * Zugriff, kein Token. Zugang entsteht erst, wenn ein Mensch auf `/verbinden`
 * zustimmt. Wer diese Adresse missbraucht, sammelt also nichts als leere
 * Zeilen; abgelaufene Verbindungen werden bei der Gelegenheit gleich
 * weggeräumt.
 *
 * Die einzige Prüfung, die wirklich zählt, ist die der Rückadressen — dorthin
 * geht später der Zustimmungs-Code. Sie steht in `checkRegistration()` in
 * @/lib/oauth und wird dort auch geprüft.
 *
 * Der Körper der Anfrage ist JSON (RFC 7591 §3.1) — anders als beim
 * Token-Endpunkt nebenan, der Formulardaten will. Diese Ungleichheit ist keine
 * Laune dieser App, sondern steht so in zwei verschiedenen RFCs.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const checked = checkRegistration(body);

  if (!checked.ok) {
    return Response.json(
      { error: checked.error, error_description: checked.description },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const client = await registerClient(checked.client);
  await sweepGrants();

  // RFC 7591 §3.2.1: zurück kommt die vergebene Kennung und alles, was
  // angemeldet wurde — auch das, was der Server selbst festgelegt hat. Ein
  // Client soll daran ablesen können, womit er es zu tun hat, statt es zu
  // vermuten. `client_secret` fehlt und muss fehlen: dies ist ein öffentlicher
  // Client, gesichert über PKCE.
  return Response.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: splitRedirectUris(client.redirectUris),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPE,
    },
    {
      status: 201,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    },
  );
}
