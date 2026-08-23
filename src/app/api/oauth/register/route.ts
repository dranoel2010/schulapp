import {
  SCOPE,
  forgetUnusedClients,
  isAllowedRedirect,
  registerClient,
} from "@/lib/oauth";

/**
 * Dynamic Client Registration (RFC 7591): hier meldet sich Claude selbst an.
 *
 * Der Weg dahin: der Nutzer trägt in der Claude-App die Adresse des
 * MCP-Servers ein, Claude findet über die Metadaten diesen Endpunkt, meldet
 * sich an und bekommt eine `client_id`. Erst danach beginnt der eigentliche
 * Ablauf mit `/oauth/authorize`.
 *
 * **Offen und ohne Anmeldung — mit Absicht.** So sieht RFC 7591 es vor, und
 * die Zeile, die dabei entsteht, kann nichts: ein Name und eine Liste
 * erlaubter Rücksprungadressen. An Daten kommt erst, wer danach einen Menschen
 * dazu bringt, sich anzumelden und auf „Erlauben“ zu tippen. Wer den Endpunkt
 * mit erfundenen Clients zumüllt, füllt eine Tabelle mit Zeilen, die nie
 * jemand bestätigt.
 *
 * **Kein Client-Geheimnis.** Ein Geheimnis, das eine App auf fremder
 * Infrastruktur aufbewahrt, ist keines; OAuth 2.1 nennt das einen „public
 * client“ und sichert den Tausch über PKCE ab. Die Antwort sagt das mit
 * `token_endpoint_auth_method: "none"`.
 *
 * **Die Rücksprungadressen werden geprüft, bevor sie in der Datenbank landen.**
 * Erlaubt ist HTTPS oder `localhost`; alles andere trüge den Autorisierungscode
 * über eine Leitung, die jeder mitlesen kann. Ein Client, der so etwas
 * einträgt, bekommt hier ein Nein und nicht erst beim Autorisieren eines.
 */

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("invalid_client_metadata", "Der Rumpf ist kein JSON.");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return problem("invalid_client_metadata", "Der Rumpf ist kein Objekt.");
  }

  const raw = body as Record<string, unknown>;
  const uris = Array.isArray(raw.redirect_uris)
    ? raw.redirect_uris.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  if (uris.length === 0) {
    return problem("invalid_redirect_uri", "Es fehlt redirect_uris.");
  }

  if (uris.some((uri) => uri.length > MAX_REDIRECT_LENGTH)) {
    return problem(
      "invalid_redirect_uri",
      `Eine Rücksprungadresse ist höchstens ${MAX_REDIRECT_LENGTH} Zeichen lang.`,
    );
  }

  if (!uris.every(isAllowedRedirect)) {
    return problem(
      "invalid_redirect_uri",
      "Eine Rücksprungadresse muss https sein oder auf localhost zeigen, und sie darf kein Fragment tragen.",
    );
  }

  // Mehr als das brauchte niemand je eintragen — und mehr Zeilen hieße mehr,
  // was jemand hineinschreiben kann.
  if (uris.length > MAX_REDIRECT_URIS) {
    return problem(
      "invalid_redirect_uri",
      `Höchstens ${MAX_REDIRECT_URIS} Rücksprungadressen.`,
    );
  }

  // Vor dem Anlegen wegräumen, was nie benutzt wurde. Dieser Endpunkt steht
  // offen — so will es RFC 7591 —, und eine offene Tür ohne Besen füllt sich.
  // Weggeräumt wird nur, woran kein einziges Token hängt und was älter ist als
  // eine Woche: ein Client, den jemand wirklich verbunden hat, bleibt.
  await forgetUnusedClients();

  const name = typeof raw.client_name === "string" ? raw.client_name : "";
  const client = await registerClient(name, uris);

  return Response.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    },
    {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

const MAX_REDIRECT_URIS = 8;

/** Eine Adresse, die länger ist, ist keine Adresse mehr, sondern eine Nutzlast. */
const MAX_REDIRECT_LENGTH = 512;

/** Die Fehlerform aus RFC 7591: ein Kennwort und ein Satz dazu. */
function problem(error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
