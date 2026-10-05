/**
 * Der Google Kalender — was die Umgebung dazu sagen muss, und die Konstanten.
 *
 * Reine Rechnung: keine Datenbank, kein Netz. `readCalendarConfig()` bekommt
 * die Umgebung hereingereicht und ist deshalb ohne gesetzte Variablen prüfbar;
 * `calendarConfig()` liest `process.env` zur Aufrufzeit, nicht beim Laden des
 * Moduls — sonst fröre `next build` den Stand ohne Variablen ein.
 *
 * Fehlt eine Pflichtvariable, ist die Funktion sauber aus: Die Auslöser tun
 * nichts, die Karte in den Einstellungen sagt, was fehlt, ohne eine einzige
 * Abfrage, und der Cron antwortet 200, solange nichts verbunden ist. Dasselbe
 * Muster wie Jev ohne `TYPESAFE_API_KEY` (siehe @/lib/jev).
 *
 * ── Warum die Redirect URI nie aus dem Host-Header kommt ─────────────────────
 *
 * @/lib/oauth rechnet seine Adressen ausdrücklich aus der Anfrage — dort muss
 * die Adresse zu dem passen, was der Client gerade aufgerufen hat, sonst
 * verwirft er die Metadaten. Hier ist es umgekehrt: Die Redirect URI muss
 * Zeichen für Zeichen zu dem passen, was in der Google Cloud Console
 * eingetragen ist, und nicht zu dem, was ein Browser in den Host-Header
 * schreibt. Aus dem Header gebaut, entschiede jeder Aufrufer, wohin Google den
 * Code schickt; im besten Fall endet das in `redirect_uri_mismatch`, im
 * schlechtesten auf einer fremden Adresse. Deshalb steht sie fest im Code und
 * ist nur über `GOOGLE_REDIRECT_URI` für die lokale Entwicklung
 * überschreibbar.
 */

/**
 * Der einzige Scope: eigene Zweitkalender anlegen und nur darin Termine
 * anlegen, ändern und löschen. An die anderen Kalender des Schülers kommt die
 * App damit nicht heran — `acl.insert` und `calendarList.insert` sind damit
 * ausdrücklich nicht erlaubt, und gebraucht werden sie auch nicht.
 */
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

/** Wohin Google nach der Zustimmung zurückschickt — die Route darunter. */
export const CALLBACK_PATH = "/api/google/callback";

/** Die Adresse im Betrieb, über den Tailscale Funnel. */
export const DEFAULT_REDIRECT_URI =
  "https://treskownas.tail3a40b0.ts.net/api/google/callback";

/** So heißt der eine Kalender, den die App in Google anlegt. */
export const CALENDAR_SUMMARY = "Schule";

/** Ganztägige Termine brauchen eine Zone, damit der Tag in Berlin beginnt. */
export const CALENDAR_TIME_ZONE = "Europe/Berlin";

/** Steht in Google unter den Einstellungen des Kalenders — wirkt nur auf einen neu angelegten Kalender. */
export const CALENDAR_DESCRIPTION =
  "Klausuren, Hausaufgaben und freie Tage aus der Schulapp, dazu Termine aus IServ, die deine Klasse betreffen. " +
  "Die App hält diesen Kalender aktuell: " +
  "Was du hier änderst, überschreibt sie beim nächsten Ändern in der App; was du hier löschst, trägt sie nicht wieder ein.";

/** Die Namen der Umgebungsvariablen — an einer Stelle, damit Meldung und Lesen nicht auseinanderlaufen. */
export const ENV = {
  clientId: "GOOGLE_CLIENT_ID",
  clientSecret: "GOOGLE_CLIENT_SECRET",
  tokenKey: "GOOGLE_TOKEN_KEY",
  redirectUri: "GOOGLE_REDIRECT_URI",
} as const;

export type CalendarConfig = {
  clientId: string;
  clientSecret: string;
  /** 32 Bytes für AES-256-GCM, siehe @/lib/calendar/token-crypto */
  tokenKey: Buffer;
  /** Genau so, wie sie in der Cloud Console steht */
  redirectUri: string;
  /** Davon abgeleitet — für die Links in den Terminen zurück in die App */
  appOrigin: string;
};

export type ConfigResult =
  | { ok: true; config: CalendarConfig }
  | { ok: false; missing: string[] };

/** Standard-base64 und base64url, mit oder ohne Auffüllung. */
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Ein leerer oder nur aus Leerzeichen bestehender Wert gilt als nicht gesetzt — wie bei `wikiExportRoot()`. */
function read(
  env: Record<string, string | undefined>,
  name: string,
): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/**
 * Ist das eine Redirect URI, die hier gelten darf?
 *
 * https überall, http nur auf dem eigenen Rechner — Google selbst lässt http
 * ebenfalls nur für localhost zu. Der Pfad muss genau der der Callback-Route
 * sein, sonst käme Google an einer Adresse zurück, die es hier nicht gibt.
 * Query und Hash sind verboten: Google hängt `code` und `state` selbst an, und
 * ein Fragment überlebt die Rückkehr nicht.
 */
function validRedirectUri(value: string): boolean {
  if (value.includes("?") || value.includes("#")) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.username || url.password) return false;

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return false;
  }

  return url.pathname === CALLBACK_PATH;
}

/**
 * Liest und prüft die Umgebung. `missing` nennt jede Variable, die fehlt oder
 * nicht taugt — die Karte in den Einstellungen und der Cron geben diese Liste
 * wörtlich weiter.
 */
export function readCalendarConfig(
  env: Record<string, string | undefined>,
): ConfigResult {
  const missing: string[] = [];

  const clientId = read(env, ENV.clientId);
  if (!clientId) missing.push(ENV.clientId);

  const clientSecret = read(env, ENV.clientSecret);
  if (!clientSecret) missing.push(ENV.clientSecret);

  const rawKey = read(env, ENV.tokenKey);
  let tokenKey: Buffer | null = null;

  if (!rawKey) {
    missing.push(ENV.tokenKey);
  } else {
    const decoded = BASE64.test(rawKey) ? Buffer.from(rawKey, "base64") : null;

    if (decoded && decoded.length === 32) {
      tokenKey = decoded;
    } else {
      missing.push(`${ENV.tokenKey} (kein 32-Byte-Schlüssel in base64)`);
    }
  }

  const redirectUri = read(env, ENV.redirectUri) ?? DEFAULT_REDIRECT_URI;
  if (!validRedirectUri(redirectUri)) {
    missing.push(`${ENV.redirectUri} (ungültig)`);
  }

  if (missing.length > 0 || !clientId || !clientSecret || !tokenKey) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      clientId,
      clientSecret,
      tokenKey,
      redirectUri,
      appOrigin: new URL(redirectUri).origin,
    },
  };
}

/** Die Umgebung dieses Prozesses, zur Aufrufzeit gelesen. */
export function calendarConfig(): ConfigResult {
  return readCalendarConfig(process.env);
}

/**
 * Ist die Funktion eingeschaltet? Nur die Umgebung, keine Datenbank — die
 * Auslöser in den Server Actions fragen das bei jedem Speichern, und ohne
 * Variablen soll dort nichts weiter geschehen.
 */
export function calendarConfigured(): boolean {
  return calendarConfig().ok;
}
