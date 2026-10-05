import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { GOOGLE_SCOPE, type CalendarConfig } from "@/lib/calendar/config";
import { errorText } from "@/lib/calendar/error-text";

/**
 * Die Anmeldung bei Google — OAuth 2.0 im Web Server Flow, ohne SDK.
 *
 * Hier ist die App der CLIENT, nicht der Server wie in @/lib/oauth. Sie
 * schickt den Nutzer zu Google, bekommt einen Code zurück und tauscht ihn gegen
 * ein Refresh Token. Gesprochen wird direkt per `fetch`, wie in @/lib/jev — ein
 * Google-SDK brächte für vier Anfragen ein paar Megabyte Abhängigkeiten mit.
 *
 * `fetch` und `wait` sind hereinreichbar, damit sich alles ohne Netz prüfen
 * lässt; die Route und der Abgleich lassen sie weg.
 *
 * ── Was in welcher Anfrage steht ─────────────────────────────────────────────
 *
 * - `access_type=offline`, sonst gibt es kein Refresh Token.
 * - `prompt=consent`: Google liefert das Refresh Token nur bei der ERSTEN
 *   Zustimmung mit. Wer neu verbindet, nachdem er getrennt hat, bekäme sonst
 *   keins.
 * - Genau ein Scope und KEIN `include_granted_scopes` — die App soll nie mehr
 *   in der Hand haben als den eigenen Kalender, auch nicht über eine frühere
 *   Zustimmung.
 * - PKCE mit S256. Google erwähnt es für Web-Server-Clients nicht, nimmt es
 *   aber an; es kostet nichts und schützt den Code, falls er aus einer
 *   Adresszeile gefischt wird.
 * - `state` gegen untergeschobene Rückkehrer: Er steht mit dem PKCE-Verifier in
 *   einem httpOnly-Cookie, das nur unter /api/google mitgeht und zehn Minuten
 *   gilt.
 *
 * ── Was nie ins Protokoll kommt ──────────────────────────────────────────────
 *
 * Kein Body, kein Token, kein Code. Ein `GoogleTokenError` nennt nur den
 * Status und das Feld `error` aus Googles Antwort, also etwa
 * „invalid_grant (400)".
 */

export const OAUTH_COOKIE = "schulapp_google_oauth";

/** Das Cookie geht nur an /api/google/… mit — die Seiten der App sehen es nie. */
export const OAUTH_COOKIE_PATH = "/api/google";

/** Zehn Minuten für den Weg über Google und zurück. */
export const OAUTH_COOKIE_MAX_AGE = 600;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Länger wartet niemand auf Google — dieselbe Frist wie bei Jev. */
const TIMEOUT_MS = 15_000;

/** Das Widerrufen beim Trennen ist best effort und darf den Knopf nicht lange halten. */
const REVOKE_TIMEOUT_MS = 10_000;

/** Wartezeiten vor dem zweiten und dritten Versuch, wenn Google kurz nicht kann. */
const RETRY_DELAYS_MS = [1_000, 4_000];

/** Ein frischer Wert für `state` oder den PKCE-Verifier: 43 Zeichen base64url. */
function secret(): string {
  return randomBytes(32).toString("base64url");
}

/** Was vor dem Sprung zu Google entsteht. Der Verifier bleibt im Cookie, die Challenge geht mit. */
export function newAuthorization(): {
  state: string;
  verifier: string;
  challenge: string;
} {
  const verifier = secret();

  return { state: secret(), verifier, challenge: pkceChallenge(verifier) };
}

/** base64url(sha256(verifier)) — RFC 7636, S256. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Die Adresse, an die der Browser geschickt wird. */
export function authorizationUrl(
  config: CalendarConfig,
  auth: { state: string; challenge: string },
): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", auth.state);
  url.searchParams.set("code_challenge", auth.challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

/** `state` und Verifier in einem Cookie — der Punkt kommt in base64url nicht vor. */
export function cookieValue(state: string, verifier: string): string {
  return `${state}.${verifier}`;
}

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Liest das Cookie zurück. Alles, was nicht genau so aussieht, wie es geschrieben wurde, ist `null`. */
export function readCookieValue(
  raw: string | undefined,
): { state: string; verifier: string } | null {
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 2) return null;

  const [state, verifier] = parts;
  if (!SECRET_PATTERN.test(state) || !SECRET_PATTERN.test(verifier)) return null;

  return { state, verifier };
}

/**
 * Zeitkonstant vergleichen, nach demselben Muster wie `equals()` in
 * @/lib/oauth: Länge zuerst, weil `timingSafeEqual` bei ungleicher Länge wirft.
 */
export function sameSecret(expected: string, given: string | null): boolean {
  if (given === null) return false;

  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(given, "utf8");
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

/**
 * Hat Google den Kalender wirklich erteilt? Bei der Zustimmung kann der Nutzer
 * einzelne Haken weglassen, und dann fehlt der Scope in der Antwort. Verglichen
 * wird Wort für Wort — ein Präfix-Vergleich ließe „…app.createdX" durch.
 */
export function grantsCalendar(scope: string | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(GOOGLE_SCOPE);
}

export type TokenErrorKind =
  | "invalid_grant"
  | "invalid_client"
  | "anfrage"
  | "voruebergehend";

/** Ein Fehler beim Token-Endpunkt. Die Meldung nennt Status und `error`, nie ein Token. */
export class GoogleTokenError extends Error {
  kind: TokenErrorKind;
  status: number | null;

  constructor(kind: TokenErrorKind, status: number | null, error?: string) {
    super(
      `Google-Token: ${kind} (${status ?? "keine Antwort"}${error ? `, ${error}` : ""})`,
    );
    this.name = "GoogleTokenError";
    this.kind = kind;
    this.status = status;
  }
}

function errorField(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error: unknown }).error;
    if (typeof value === "string") return value;
  }

  return undefined;
}

/**
 * Was eine Antwort des Token-Endpunkts bedeutet.
 *
 * `invalid_grant` ist der Fall, um den es hier geht: Der Zugang wurde
 * entzogen, ist abgelaufen (im Status „Testing" nach sieben Tagen) oder der
 * Code war schon eingelöst. Dann hilft nur neu verbinden.
 */
export function classifyTokenError(
  status: number | null,
  body: unknown,
): TokenErrorKind {
  if (status === null || status === 429 || status >= 500) return "voruebergehend";

  const error = errorField(body);

  if ((status === 400 || status === 401) && error === "invalid_grant") {
    return "invalid_grant";
  }

  if (error === "invalid_client" || error === "unauthorized_client") {
    return "invalid_client";
  }

  return "anfrage";
}

export type FetchDeps = {
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

/**
 * Ein POST an den Token-Endpunkt, mit bis zu zwei Wiederholungen, wenn Google
 * vorübergehend nicht kann (Netz, Timeout, 429, 5xx).
 */
async function postToken(
  form: Record<string, string>,
  deps: FetchDeps | undefined,
): Promise<Record<string, unknown>> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const wait = deps?.wait ?? sleep;

  for (let attempt = 0; ; attempt += 1) {
    let status: number | null = null;
    let body: unknown = null;

    try {
      const response = await fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      status = response.status;
      body = await readJson(response);

      if (response.ok && body && typeof body === "object") {
        return body as Record<string, unknown>;
      }
    } catch {
      // Netz oder Timeout — `status` bleibt null und zählt als vorübergehend.
    }

    const kind =
      status !== null && status >= 200 && status < 300
        ? "anfrage" // 2xx ohne lesbaren Körper
        : classifyTokenError(status, body);

    if (kind === "voruebergehend" && attempt < RETRY_DELAYS_MS.length) {
      await wait(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    throw new GoogleTokenError(kind, status, errorField(body));
  }
}

/** Der Code aus dem Callback gegen die Token. Wirft `GoogleTokenError`. */
export async function exchangeCode(
  config: CalendarConfig,
  code: string,
  verifier: string,
  deps?: FetchDeps,
): Promise<{ accessToken: string; refreshToken: string | null; scope: string }> {
  const body = await postToken(
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    },
    deps,
  );

  if (typeof body.access_token !== "string") {
    throw new GoogleTokenError("anfrage", 200, "kein access_token");
  }

  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

/** Ein frisches Access Token. Liefert Google ein neues Refresh Token mit, kommt es zurück. */
export async function refreshAccessToken(
  config: CalendarConfig,
  refreshToken: string,
  deps?: FetchDeps,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const body = await postToken(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    deps,
  );

  if (typeof body.access_token !== "string") {
    throw new GoogleTokenError("anfrage", 200, "kein access_token");
  }

  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
  };
}

/**
 * Den Zugang bei Google zurückziehen. Best effort: `true` heißt, Google kennt
 * ihn nicht mehr (auch, wenn er schon vorher ungültig war). Wirft nie — das
 * Trennen in der App geschieht so oder so.
 */
export async function revokeToken(token: string, deps?: FetchDeps): Promise<boolean> {
  const fetchImpl = deps?.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });

    if (response.ok) return true;

    return response.status === 400 && errorField(await readJson(response)) === "invalid_token";
  } catch {
    return false;
  }
}

/**
 * Woher ein Lauf sein Access Token nimmt. `current()` holt beim ersten Mal ein
 * frisches und hält es für die Dauer des Laufs, `renew()` holt ein neues — das
 * braucht es nach einem 401.
 */
export type TokenSource = {
  current(): Promise<string>;
  renew(): Promise<string>;
};

export function createTokenSource(
  config: CalendarConfig,
  refreshToken: string,
  deps?: FetchDeps & { onRotate?: (neu: string) => Promise<void> },
): TokenSource {
  let access: string | null = null;
  let refresh = refreshToken;
  let pending: Promise<string> | null = null;

  async function erneuern(): Promise<string> {
    const result = await refreshAccessToken(config, refresh, deps);
    access = result.accessToken;

    if (result.refreshToken && result.refreshToken !== refresh) {
      refresh = result.refreshToken;

      try {
        await deps?.onRotate?.(result.refreshToken);
      } catch (fehler) {
        // Das alte Token gilt bei Google weiter; der nächste Lauf versucht es
        // mit ihm. Ins Protokoll kommt nur, dass es nicht ging, nie das Token —
        // auch nicht versiegelt: Die gescheiterte Abfrage von
        // `storeRefreshToken()` nennt in ihrer Meldung altes und neues Siegel,
        // `errorText()` lässt sie weg.
        console.error(
          "Google-Kalender: neues Refresh Token nicht gespeichert",
          errorText(fehler),
        );
      }
    }

    return result.accessToken;
  }

  function einmal(): Promise<string> {
    pending ??= erneuern().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    current: async () => access ?? einmal(),
    renew: einmal,
  };
}

/** Für das Verbinden: ein Access Token, das schon da ist und nicht erneuert werden kann. */
export function staticTokenSource(accessToken: string): TokenSource {
  return {
    current: async () => accessToken,
    renew: async () => {
      throw new GoogleTokenError("invalid_grant", null, "kein Refresh Token zur Hand");
    },
  };
}
