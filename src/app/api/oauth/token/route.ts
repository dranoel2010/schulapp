import { exchangeCode, refreshTokens, type TokenResult } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * Der Tausch: Zustimmungs-Code gegen Token, und später Erneuerung gegen
 * Erneuerung.
 *
 * Beide Wege enden in derselben Antwort und unterscheiden sich nur im
 * `grant_type`. Die Rechnung dahinter steht in @/lib/oauth; hier steht, wie
 * eine Anfrage gelesen und eine Antwort gebaut wird.
 *
 * **Formulardaten, kein JSON.** RFC 6749 §4.1.3 schreibt
 * `application/x-www-form-urlencoded` vor, und Claude hält sich daran. Ein
 * Server, der hier JSON erwartet, bekommt eine leere Anfrage und antwortet
 * „invalid_request" auf etwas, das völlig richtig war.
 *
 * **`Cache-Control: no-store` ist Pflicht** (RFC 6749 §5.1): in dieser Antwort
 * stehen zwei Geheimnisse im Klartext. Ein Zwischenspeicher, der sie aufhebt,
 * gibt sie irgendwann jemand anderem.
 *
 * Fehler gehen als 400 mit einem `error`-Feld zurück, so wie es die
 * Spezifikation verlangt — mit einer Ausnahme: `invalid_client` gehört
 * eigentlich zu einer 401. Hier ist es trotzdem eine 400, weil es an dieser
 * Adresse gar keine Client-Anmeldung gibt, die man mit einem
 * `WWW-Authenticate` einfordern könnte: der Client ist öffentlich und weist
 * sich mit PKCE aus, nicht mit einem Geheimnis.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);

  if (!form) {
    return failure({
      ok: false,
      error: "invalid_request",
      description: "Diese Anfrage war kein Formular.",
    });
  }

  const grantType = field(form, "grant_type");
  const clientId = field(form, "client_id");

  // Die Adresse, für die das Token gelten soll (RFC 8707). Sie kommt aus der
  // Anfrage, wird aber nicht geglaubt: @/lib/oauth vergleicht sie mit der, der
  // der Mensch zugestimmt hat. Fehlt sie, gilt eben diese — die Spezifikation
  // verlangt vom Client, sie zu schicken, und ein Server, der deswegen
  // abbricht, sperrt sich gegen Clients ohne Not aus.
  const resource = form.get("resource");
  const wanted = typeof resource === "string" && resource.length > 0 ? resource : null;

  if (grantType === "authorization_code") {
    return answer(
      await exchangeCode({
        code: field(form, "code"),
        clientId,
        redirectUri: field(form, "redirect_uri"),
        codeVerifier: field(form, "code_verifier"),
        resource: wanted,
      }),
    );
  }

  if (grantType === "refresh_token") {
    return answer(
      await refreshTokens({
        refreshToken: field(form, "refresh_token"),
        clientId,
        resource: wanted,
      }),
    );
  }

  return failure({
    ok: false,
    error: "unsupported_grant_type",
    description:
      "Dieser Server kann authorization_code und refresh_token, sonst nichts.",
  });
}

/**
 * Die Antwort ist an beiden Wegen dieselbe. `token_type: "Bearer"` steht mit
 * großem B da, weil RFC 6750 es so schreibt — Clients vergleichen es teils
 * wörtlich.
 *
 * Und der Aussteller nennt hier ausdrücklich den Umfang, auch wenn der Client
 * denselben angefragt hat: er ist die Stelle, die darüber entscheidet, und ein
 * Client soll seine Rechte aus der Antwort lesen und nicht aus seiner Frage.
 */
function answer(result: TokenResult): Response {
  if (!result.ok) return failure(result);

  return Response.json(
    {
      access_token: result.tokens.accessToken,
      token_type: "Bearer",
      expires_in: result.tokens.expiresIn,
      refresh_token: result.tokens.refreshToken,
      scope: result.tokens.scope,
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

function failure(result: Extract<TokenResult, { ok: false }>): Response {
  return Response.json(
    { error: result.error, error_description: result.description },
    { status: 400, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

/** Ein Formularfeld als Text; alles andere (etwa eine Datei) zählt als leer. */
function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
