import {
  SCOPE,
  cleanupExpired,
  consumeAuthCode,
  getClient,
  issueTokens,
  pkceMatches,
  redirectUrisOf,
  rotateRefreshToken,
  type TokenPair,
} from "@/lib/oauth";

/**
 * Der Token-Endpunkt: hier wird aus einem Autorisierungscode ein Token, und
 * aus einem alten Refresh-Token ein neues Paar.
 *
 * Zwei Arten von Anfrage, beide als `application/x-www-form-urlencoded`, so
 * wie OAuth es vorschreibt:
 *
 * - `grant_type=authorization_code` mit `code`, `redirect_uri`, `client_id`
 *   und `code_verifier`.
 * - `grant_type=refresh_token` mit `refresh_token` und `client_id`.
 *
 * **Vier Prüfungen beim Code, und jede fängt einen eigenen Angriff ab:**
 *
 * 1. Der Code gilt genau einmal. Eingelöst wird er, indem seine Zeile gelöscht
 *    wird — ein zweiter Versuch findet nichts. Damit ist ein abgefangener und
 *    schon benutzter Code wertlos.
 * 2. Er gehört diesem Client. Sonst könnte ein anderer, ebenfalls angemeldeter
 *    Client einen fremden Code einlösen.
 * 3. Die Rücksprungadresse ist dieselbe wie beim Autorisieren. Sonst ließe
 *    sich der Code nachträglich auf eine andere Adresse umbiegen.
 * 4. PKCE: der Verifier passt zur Prüfsumme von vorhin. Das ist die Prüfung,
 *    die den Code an genau den Browser bindet, der ihn angefordert hat — und
 *    der Grund, warum ein öffentlicher Client hier ohne Geheimnis auskommt.
 *
 * **Kein Client-Geheimnis, und deshalb auch keine Client-Authentifizierung.**
 * Die `client_id` sagt, wer fragt; dass er es wirklich ist, sagt PKCE.
 *
 * Alle Antworten tragen `Cache-Control: no-store` — ein Token, das irgendwo
 * zwischengespeichert läge, wäre kein Token mehr.
 */

export async function POST(request: Request) {
  const form = await readForm(request);
  if (!form) {
    return problem(
      "invalid_request",
      "Erwartet wird application/x-www-form-urlencoded.",
    );
  }

  const grantType = form.get("grant_type") ?? "";
  const clientId = form.get("client_id") ?? "";

  const client = await getClient(clientId);
  if (!client) {
    return problem("invalid_client", "Diesen Client kennt der Server nicht.", 401);
  }

  if (grantType === "authorization_code") {
    return exchangeCode(form, clientId, redirectUrisOf(client));
  }

  if (grantType === "refresh_token") {
    const pair = await rotateRefreshToken(
      form.get("refresh_token") ?? "",
      clientId,
    );
    if (!pair) {
      return problem(
        "invalid_grant",
        "Dieses Refresh-Token gilt nicht mehr. Verbinde den Connector neu.",
      );
    }

    // Auch hier aufräumen: die Erneuerung ist der Vorgang, der über die Jahre
    // am häufigsten läuft. Bliebe sie außen vor, wüchse die Tabelle genau
    // dort, wo am meisten ausgestellt wird.
    await cleanupExpired();

    return tokens(pair);
  }

  return problem(
    "unsupported_grant_type",
    "Dieser Server kennt authorization_code und refresh_token.",
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

async function exchangeCode(
  form: URLSearchParams,
  clientId: string,
  allowedRedirects: string[],
): Promise<Response> {
  const grant = await consumeAuthCode(form.get("code") ?? "");
  if (!grant) {
    return problem(
      "invalid_grant",
      "Dieser Code gilt nicht mehr — er war schon eingelöst oder ist abgelaufen.",
    );
  }

  if (grant.clientId !== clientId) {
    return problem("invalid_grant", "Dieser Code gehört einem anderen Client.");
  }

  const redirectUri = form.get("redirect_uri") ?? "";
  if (redirectUri !== grant.redirectUri) {
    return problem(
      "invalid_grant",
      "Die Rücksprungadresse ist eine andere als beim Autorisieren.",
    );
  }

  // Doppelt geprüft, und das mit Absicht: die Liste des Clients kann sich seit
  // dem Autorisieren geändert haben, und ein Code soll nicht auf eine Adresse
  // hinauslaufen, die heute nicht mehr eingetragen ist.
  if (!allowedRedirects.includes(redirectUri)) {
    return problem(
      "invalid_grant",
      "Diese Rücksprungadresse steht nicht mehr beim Client.",
    );
  }

  if (!pkceMatches(form.get("code_verifier") ?? "", grant.codeChallenge)) {
    return problem("invalid_grant", "Der code_verifier passt nicht.");
  }

  const pair = await issue(grant.userId, clientId, grant.resource);

  return tokens(pair);
}

/**
 * Stellt das Paar aus und räumt bei der Gelegenheit Abgelaufenes weg.
 *
 * Das Aufräumen hängt hier und nicht an einem eigenen Zeitplan: es ist der
 * einzige Vorgang, der ohnehin selten läuft und dabei schreibt. Ein
 * abgelaufenes Token ist für sich ungefährlich — die Frist wird bei jedem
 * Zugriff geprüft; es geht nur darum, dass die Tabelle nicht über Jahre wächst.
 */
async function issue(
  userId: string,
  clientId: string,
  resource: string | null,
): Promise<TokenPair> {
  const pair = await issueTokens(userId, clientId, resource);

  await cleanupExpired();

  return pair;
}

function tokens(pair: TokenPair): Response {
  return Response.json(
    {
      access_token: pair.accessToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
      refresh_token: pair.refreshToken,
      scope: SCOPE,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

/** Der Rumpf als Formulardaten — alles andere ist keine Token-Anfrage. */
async function readForm(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded")) return null;

  try {
    return new URLSearchParams(await request.text());
  } catch {
    return null;
  }
}

/** Die Fehlerform aus OAuth 2.1: ein Kennwort und ein Satz dazu. */
function problem(
  error: string,
  description: string,
  status = 400,
): Response {
  return Response.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
