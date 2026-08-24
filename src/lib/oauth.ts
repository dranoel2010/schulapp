import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, isNull, lte, notExists, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  oauthClients,
  oauthCodes,
  oauthGrants,
  users,
  type OauthClient,
  type User,
} from "@/db/schema";

/**
 * Der eigene kleine OAuth-Server — womit sich ein Agent an dieser App anmeldet.
 *
 * **Warum die App das selbst macht.** Ein entfernter MCP-Server, der etwas zu
 * schützen hat, wird nach der Spezifikation über OAuth 2.1 geschützt; einen
 * festen Token im Kopf einer Anfrage nimmt die Claude-App heute nur in einer
 * Beta an, die man bei Anthropic beantragen muss, und „ohne Anmeldung" ist für
 * abfotografierte Schulblätter keine Antwort. Bleibt der vorgesehene Weg — und
 * der ist für einen einzigen Nutzer kleiner, als sein Name vermuten lässt: eine
 * Anmeldung ohne Passwort für den Client, eine Seite mit einem Knopf für den
 * Menschen, ein Tausch von Code gegen Token.
 *
 * **Reine Rechnung und Datenzugriff, kein HTTP.** Hier steht keine `Response`
 * und kein Header; die Adressen unter src/app/api/oauth rufen diese Funktionen
 * und bauen daraus ihre Antwort. Dieselbe Trennung wie überall sonst in
 * @/lib — und der Grund, warum `originFrom()` hier eine Zeichenkette bekommt
 * und nicht eine Anfrage.
 *
 * **Was diese Datei absichtlich NICHT kann:**
 *
 * - *Client ID Metadata Documents* (CIMD), den Weg, den die Spezifikation seit
 *   2026-07-28 bevorzugt. Er verlangt, dass der Server eine URL abruft, die der
 *   Client ihm nennt — eine ausgehende Verbindung an eine fremde Adresse, also
 *   genau die Art Loch, gegen die diese App sonst dichthält. Die Claude-App
 *   meldet sich ohnehin über die dynamische Anmeldung (RFC 7591) an; solange
 *   das so ist, gibt es für CIMD nichts zu gewinnen.
 * - *Vertrauliche Clients.* Ein `client_secret` läge in fremder Hand und
 *   schützte nichts, was PKCE nicht besser schützt. `token_endpoint_auth_method`
 *   ist deshalb immer "none".
 * - *Mehrere Umfänge.* Es gibt genau einen (`OAUTH_SCOPE`), und was er erlaubt,
 *   steht im Werkzeugkasten des Agenten: lesen und vorschlagen. Ein Recht,
 *   das kein Tool ausübt, wäre ein Versprechen ohne Deckung.
 */

/**
 * Der eine Umfang. „mcp" und nicht „lesen" oder „alles": er benennt den Zugang,
 * nicht die Erlaubnis. Was ein Agent tun darf, entscheidet die Liste der Tools
 * und nicht ein Wort in einer Adresszeile — dort stünde sonst ein Versprechen,
 * an das sich niemand halten müsste.
 */
export const OAUTH_SCOPE = "mcp";

/** Wo der MCP-Server steht. Von hier hängt jede Adresse in den Metadaten ab. */
export const MCP_PATH = "/api/mcp";

/**
 * Wie lange ein Zustimmungs-Code gilt.
 *
 * Eine Minute, weil zwischen dem Klick auf „Erlauben" und dem Tausch nichts
 * liegt als eine Umleitung: der Client löst ihn im selben Atemzug ein. Alles
 * darüber wäre ein Zeitfenster, das nur jemandem nützt, der den Code aus der
 * Adresszeile fischt.
 */
const CODE_TTL_SECONDS = 60;

/**
 * Wie lange ein Zugriffs-Token gilt.
 *
 * Eine Stunde. Kurz genug, dass ein abgefangenes Token verfällt, bevor jemand
 * damit etwas anfängt; lang genug, dass eine Unterhaltung mit dem Agenten nicht
 * mitten im Blatt stehen bleibt. Die Claude-App erneuert von selbst, und zwar
 * schon fünf Minuten vor Ablauf — der Nutzer merkt davon nichts.
 */
const ACCESS_TTL_SECONDS = 60 * 60;

/**
 * Wie lange ein Erneuerungs-Token gilt: ein Vierteljahr.
 *
 * Es ist die eigentliche Lebensdauer der Verbindung. Kürzer hieße, dass die
 * Zustimmung mitten im Schuljahr abläuft und der Agent ohne Vorwarnung nichts
 * mehr sieht; länger hieße, dass eine vergessene Verbindung ewig offen steht.
 * Ein Vierteljahr ist ungefähr ein Halbjahr Schule geteilt durch zwei — und
 * getrennt wird ohnehin in den Einstellungen, nicht durch Warten.
 */
const REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Wie viele Rückadressen ein Client anmelden darf. */
const MAX_REDIRECT_URIS = 5;

/** Wie lang der Name eines Clients höchstens sein darf. */
const MAX_CLIENT_NAME = 200;

/**
 * Wie lang eine einzelne Rückadresse höchstens sein darf.
 *
 * 512 Zeichen sind großzügig für jede echte Rückadresse (die von Claude hat
 * 42) und schließen den Fall, dass jemand über die offene Anmeldung Megabyte
 * in die Datenbank schreibt. Ohne diese Zeile wäre die Länge nur durch die
 * Geduld des Absenders begrenzt.
 */
const MAX_REDIRECT_URI = 512;

/**
 * Die Adresse, unter der diese App gerade angesprochen wird — aus dem Kopf der
 * Anfrage und nicht aus einer Umgebungsvariablen.
 *
 * Das ist eine bewusste Entscheidung und keine Bequemlichkeit. Alle drei
 * Angaben, die OAuth aneinanderbindet — der Aussteller in den Metadaten, die
 * Adresse in der Ressourcen-Beschreibung und die Adresse, für die ein Token
 * gilt — müssen ZEICHENGLEICH dieselbe sein wie die, die der Client aufgerufen
 * hat; sonst verwirft er die Metadaten (RFC 9728 §3.3). Aus der Anfrage
 * gerechnet stimmen sie immer überein, auch unter der Vorschau-Adresse eines
 * Deployments. Stünde hier eine feste Adresse, wäre jede andere kaputt — und
 * zwar stumm.
 *
 * Vercel setzt `x-forwarded-proto`; lokal steht dort nichts, dann entscheidet
 * der Name: `localhost` und `127.0.0.1` sprechen http, alles andere https. Ohne
 * Host gibt es keine Adresse und damit auch keine Metadaten — `null` ist hier
 * ein ehrliches „weiß ich nicht" und wird von den Adressen als 500 beantwortet,
 * statt eine falsche Adresse in ein Dokument zu schreiben, das ein Client
 * ungeprüft glaubt.
 */
export function originFrom(
  host: string | null | undefined,
  forwardedProto?: string | null,
): string | null {
  const name = host?.trim();
  if (!name) return null;

  // Ein Host mit Schrägstrich, Leerzeichen oder Zeilenumbruch ist kein Host,
  // sondern ein Versuch. Er landete sonst wörtlich in einer Adresse, die
  // Clients weiterverfolgen.
  if (/[^A-Za-z0-9.:\-[\]]/.test(name)) return null;

  const proto = forwardedProto?.split(",")[0]?.trim();
  if (proto === "http" || proto === "https") return `${proto}://${name}`;

  const local =
    name === "localhost" ||
    name.startsWith("localhost:") ||
    name.startsWith("127.0.0.1") ||
    name.startsWith("[::1]");

  return `${local ? "http" : "https"}://${name}`;
}

/**
 * Die kanonische Adresse des MCP-Servers — die Zeichenkette, für die ein Token
 * gilt und gegen die bei jeder Anfrage verglichen wird.
 *
 * Ohne Schrägstrich am Ende, weil die Spezifikation genau diese Form empfiehlt
 * und weil ein Vergleich zweier Schreibweisen derselben Adresse keiner ist.
 */
export function canonicalResource(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${MCP_PATH}`;
}

/**
 * Die Adresse der Ressourcen-Beschreibung, wie sie im `WWW-Authenticate`-Kopf
 * einer 401 steht.
 *
 * Der Pfad des Servers wird dabei HINTER das well-known geschoben und nicht
 * davor: aus `/api/mcp` wird
 * `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728 §3). Das sieht
 * verdreht aus und ist so gemeint — ein Client, der nur die Adresse des Servers
 * kennt, baut sich daraus dieselbe Adresse zusammen.
 */
export function resourceMetadataUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/**
 * Die Ressourcen-Beschreibung: „hier ist ein geschützter Server, und das ist
 * die Stelle, bei der man sich Zugang holt."
 *
 * `authorization_servers` trägt Aussteller-Kennungen und keine Endpunkte — der
 * Client baut sich daraus selbst die Adresse der Server-Beschreibung. Der
 * Aussteller ist diese App, deshalb steht dort die eigene Adresse ohne Pfad.
 *
 * `offline_access` steht ausdrücklich NICHT unter den Umfängen, obwohl es
 * Erneuerungs-Token gibt: die Spezifikation sagt, dass ein Erneuerungs-Token
 * kein Recht an der Ressource ist und in dieser Liste nichts zu suchen hat.
 */
export function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: canonicalResource(origin),
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Schulapp",
  };
}

/**
 * Die Beschreibung des Ausstellers — welche Adressen es gibt und was er kann.
 *
 * Zwei Zeilen darin sind keine Höflichkeit, sondern Bedingung:
 *
 * - `code_challenge_methods_supported` MUSS dastehen. Fehlt es, schließt ein
 *   Client daraus, dass dieser Server kein PKCE kann, und bricht ab — die
 *   Verbindung käme nie zustande.
 * - `token_endpoint_auth_methods_supported: ["none"]` ebenso. Ohne die Zeile
 *   gilt die Vorgabe aus RFC 8414, nämlich `client_secret_basic`, und ein
 *   öffentlicher Client hätte kein Geheimnis, mit dem er sich ausweisen könnte.
 *
 * `issuer` muss zeichengleich die Adresse sein, über die dieses Dokument
 * gefunden wurde; deshalb steht dort dieselbe Herkunft, aus der es gebaut wird.
 */
export function authorizationServerMetadata(
  origin: string,
): Record<string, unknown> {
  const base = origin.replace(/\/+$/, "");

  return {
    issuer: base,
    authorization_endpoint: `${base}/verbinden`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
    // Die Antwort trägt den Aussteller mit; ein Client kann damit erkennen, ob
    // ihm jemand die Antwort eines anderen Servers untergeschoben hat.
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * Taugt diese Rückadresse überhaupt?
 *
 * Zwei Formen sind erlaubt, und beide stehen so in der Spezifikation: https für
 * alles, was im Netz steht, und http nur auf dem eigenen Rechner — das ist der
 * Weg, den Programme ohne Browserfenster nehmen (RFC 8252), etwa Claude Code
 * mit einem Port, den es sich beim Start aussucht.
 *
 * Alles andere fliegt raus, und das ist die wichtigste Zeile dieser Datei: eine
 * Rückadresse ist die Stelle, an die der Zustimmungs-Code geschickt wird. Wer
 * hier `javascript:` oder eine fremde Seite unterbringen darf, bekommt den Code
 * eines fremden Nutzers.
 */
export function isAllowedRedirectUri(value: string): boolean {
  // Kein Leerzeichen, kein Steuerzeichen — und das ist hier nicht Kosmetik:
  // die angemeldeten Adressen stehen in EINER Spalte, durch Leerzeichen
  // getrennt (`splitRedirectUris()`). Eine Adresse mit einem Leerzeichen darin
  // zerfiele beim Lesen in zwei Bruchstücke, und verglichen würde danach gegen
  // etwas, das nie jemand angemeldet hat. In einer echten Rückadresse steht ein
  // Leerzeichen ohnehin als %20; roh gehört es nicht hinein.
  if (/[\u0000-\u0020\u007f]/.test(value)) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // Ein Fragment am Ende ist nach RFC 6749 §3.1.2 verboten; der Code hinge
  // sonst hinter einem Zeichen, das der Browser nicht mitschickt.
  if (url.hash) return false;

  if (url.protocol === "https:") return true;

  if (url.protocol === "http:") {
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1"
    );
  }

  return false;
}

/**
 * Ist das eine der angemeldeten Rückadressen?
 *
 * Verglichen wird Zeichen für Zeichen und ohne Sternchen — so verlangt es
 * OAuth 2.1 §2.3.1. Die einzige Ausnahme ist der eigene Rechner: dort darf der
 * Port abweichen, weil ein Programm ohne Browserfenster sich seinen Port erst
 * beim Start aussucht und ihn vorher nicht anmelden kann. Alles andere an der
 * Adresse — Schema, Name, Pfad, Abfrage — muss auch dort gleich sein.
 */
export function redirectUriMatches(
  registered: readonly string[],
  candidate: string,
): boolean {
  if (registered.some((uri) => uri === candidate)) return true;

  let wanted: URL;
  try {
    wanted = new URL(candidate);
  } catch {
    return false;
  }

  const loopback =
    wanted.protocol === "http:" &&
    (wanted.hostname === "localhost" ||
      wanted.hostname === "127.0.0.1" ||
      wanted.hostname === "[::1]");

  if (!loopback) return false;

  return registered.some((uri) => {
    let known: URL;
    try {
      known = new URL(uri);
    } catch {
      return false;
    }

    return (
      known.protocol === wanted.protocol &&
      known.hostname === wanted.hostname &&
      known.pathname === wanted.pathname &&
      known.search === wanted.search
    );
  });
}

/**
 * PKCE, die Prüfung: passt das Geheimnis zu dem Abdruck, der beim Zustimmen
 * hinterlegt wurde?
 *
 * `code_challenge = base64url(sha256(code_verifier))`, und mehr ist es nicht.
 * Verglichen wird trotzdem zeitkonstant: die Länge ist bekannt und der
 * Vergleich läuft gegen eine Zeichenkette, die ein Angreifer stellt — genau die
 * Lage, in der ein früh abbrechender Vergleich ein Zeichen nach dem anderen
 * verrät.
 *
 * Nur S256. „plain" wäre ein Prüfwert, der aus sich selbst besteht.
 */
export function verifyPkce(challenge: string, verifier: string): boolean {
  // Die Spezifikation lässt 43 bis 128 Zeichen aus einem engen Vorrat zu. Was
  // dort nicht hineinpasst, ist kein Prüfwert und wird gar nicht erst gehasht.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;

  const expected = createHash("sha256").update(verifier, "ascii").digest("base64url");

  return equals(expected, challenge);
}

/** Zwei Zeichenketten zeitkonstant vergleichen, ohne bei Längen zu stolpern. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

/** Die angemeldeten Rückadressen einer Zeile als Liste. */
export function splitRedirectUris(value: string): string[] {
  return value.split(" ").filter((uri) => uri.length > 0);
}

/**
 * Wohin die Anmeldung zurückführt — oder `null`, wenn das keine Adresse in
 * dieser App ist.
 *
 * Es gibt diese Funktion nur wegen der Zustimmungsseite. Claude öffnet
 * `/verbinden?...` mit einem guten Dutzend Parametern; ist gerade niemand
 * angemeldet, führt der Weg über `/login` — und ohne diese Parameter käme der
 * Nutzer danach auf der Startseite an, während der Agent auf eine Antwort
 * wartet, die nie kommt.
 *
 * Angenommen wird deshalb ausschließlich ein Pfad innerhalb dieser App, und
 * geprüft wird nicht auf das, was verboten ist, sondern auf das, was erlaubt
 * ist: ein einzelner Schrägstrich, danach kein zweiter und kein Backslash.
 * `//example.com` und `/\example.com` sind für einen Browser vollwertige
 * Adressen zu einem fremden Server — wer sie durchließe, hätte aus der eigenen
 * Anmeldeseite eine Weiterleitung für andere Leute gebaut. Ein Schema
 * (`https:`, `javascript:`) fällt an derselben Regel.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  // Kein Steuerzeichen, kein Leerzeichen. Ein Zeilenumbruch versucht eine
  // zweite Kopfzeile; Tabulator, Wagenrücklauf und Zeilenvorschub entfernt
  // jeder Browser aus einer Adresse, BEVOR er sie auswertet — aus "/\t/fremd.de"
  // wird so "//fremd.de", und das ist wieder ein fremder Server. Die Regel oben
  // sähe den Schrägstrich einzeln und ließe es durch.
  if (/[\u0000-\u0020\u007f]/.test(value)) return null;

  return value;
}

/**
 * Was bei der Anmeldung eines Clients ankommt — und was davon zählt.
 *
 * Ein Client schickt nach RFC 7591 ein Dutzend Felder; gelesen werden zwei. Der
 * Rest ist entweder Geschmack (`logo_uri`, `client_uri`) oder etwas, das dieser
 * Server ohnehin festlegt (`grant_types`, `token_endpoint_auth_method`). Was
 * nicht gelesen wird, kann auch nichts anrichten.
 */
export type ClientRegistration = {
  name: string;
  redirectUris: string[];
};

/**
 * Warum eine Anmeldung abgelehnt wurde — in der Sprache, die RFC 7591 dafür
 * vorsieht. Der Fehlercode ist Teil des Protokolls und wird vom Client
 * gelesen; der Satz daneben ist für den Menschen, der ins Log sieht.
 */
export type RegistrationError = {
  error: "invalid_redirect_uri" | "invalid_client_metadata";
  description: string;
};

/**
 * Prüft, was ein Client bei der Anmeldung mitschickt.
 *
 * Reine Rechnung, damit sie sich ohne Datenbank prüfen lässt: hier entscheidet
 * sich, welche Rückadressen später gültig sind, und das ist die Stelle, an der
 * ein Fehler am teuersten wäre.
 */
export function checkRegistration(
  body: unknown,
): { ok: true; client: ClientRegistration } | { ok: false } & RegistrationError {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "Die Anmeldung war kein JSON-Objekt.",
    };
  }

  const raw = body as Record<string, unknown>;
  const uris = raw.redirect_uris;

  if (!Array.isArray(uris) || uris.length === 0) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "Ohne redirect_uris gibt es nichts anzumelden.",
    };
  }

  if (uris.length > MAX_REDIRECT_URIS) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: `Höchstens ${MAX_REDIRECT_URIS} Rückadressen.`,
    };
  }

  const redirectUris: string[] = [];

  for (const uri of uris) {
    if (
      typeof uri !== "string" ||
      uri.length > MAX_REDIRECT_URI ||
      !isAllowedRedirectUri(uri)
    ) {
      return {
        ok: false,
        error: "invalid_redirect_uri",
        description:
          "Eine Rückadresse muss https sein — oder http auf dem eigenen Rechner.",
      };
    }

    if (!redirectUris.includes(uri)) redirectUris.push(uri);
  }

  const rawName = typeof raw.client_name === "string" ? raw.client_name.trim() : "";
  // Ein Name ohne Inhalt wäre auf der Zustimmungsseite eine leere Stelle in
  // einem Satz, der eine Frage stellt. Dann lieber ein ehrliches Wort.
  const name = rawName.length > 0 ? rawName.slice(0, MAX_CLIENT_NAME) : "Ein Programm";

  return { ok: true, client: { name, redirectUris } };
}

/** Legt einen Client an und gibt seine id zurück — die ist zugleich seine `client_id`. */
export async function registerClient(
  registration: ClientRegistration,
): Promise<OauthClient> {
  const [created] = await db
    .insert(oauthClients)
    .values({
      name: registration.name,
      redirectUris: registration.redirectUris.join(" "),
    })
    .returning();

  if (!created) {
    throw new Error("Der Client konnte nicht angemeldet werden.");
  }

  return created;
}

/**
 * Schlägt einen Client nach. `null` heißt: die id ist keine, oder es gibt ihn
 * nicht — für den Aufrufer dasselbe.
 */
export async function findClient(clientId: string): Promise<OauthClient | null> {
  if (!isUuid(clientId)) return null;

  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);

  return row ?? null;
}

/**
 * Legt den Zustimmungs-Code an und gibt ihn im Klartext zurück — das eine Mal,
 * dass er außerhalb dieser Funktion existiert.
 *
 * Beim gleichen Zug werden abgelaufene Codes weggeräumt. Dieselbe
 * Gelegenheitsarbeit wie bei den Sitzungen in @/lib/session: es gibt keinen
 * Aufräum-Dienst in dieser App, und die Zeilen, um die es geht, sind winzig und
 * selten.
 */
export async function issueCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
}): Promise<string> {
  const code = randomToken();

  await db.insert(oauthCodes).values({
    clientId: input.clientId,
    userId: input.userId,
    codeHash: hash(code),
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: OAUTH_SCOPE,
    resource: input.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
  });

  await db
    .delete(oauthCodes)
    .where(lte(oauthCodes.expiresAt, new Date(Date.now() - 60 * 60 * 1000)));

  return code;
}

/**
 * Die Token, die ein Client bekommt. `expiresIn` in Sekunden, so wie es über
 * die Leitung geht.
 */
export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

/**
 * Warum ein Tausch am Token-Endpunkt nicht geklappt hat — in der Sprache von
 * OAuth 2.1 (RFC 6749 §5.2).
 *
 * `invalid_grant` steht dabei für auffällig viele verschiedene Fälle: Code
 * unbekannt, abgelaufen, schon eingelöst, falscher Client, falsche Rückadresse,
 * falscher PKCE-Prüfwert. Das ist Absicht und kein Faulheitsfehler — wer einen
 * Code errät, soll nicht auch noch erfahren, welcher Teil seiner Vermutung
 * stimmte.
 */
export type TokenError = {
  error:
    | "invalid_request"
    | "invalid_grant"
    | "invalid_client"
    | "unsupported_grant_type"
    | "invalid_target";
  description: string;
};

export type TokenResult =
  | { ok: true; tokens: IssuedTokens }
  | ({ ok: false } & TokenError);

/**
 * Code gegen Token: der eigentliche Tausch.
 *
 * Die Reihenfolge der Prüfungen ist die Reihenfolge, in der sie billig sind —
 * und am Ende steht die einzige, die wirklich zählt: PKCE. Wer den Code aus der
 * Adresszeile abgefangen hat, scheitert dort, weil ihm das Geheimnis fehlt, aus
 * dem der hinterlegte Abdruck gerechnet wurde.
 *
 * **Eingelöst wird mit `where redeemed_at is null`**, und ob die Zeile getroffen
 * wurde, entscheidet die Datenbank. Zwei gleichzeitige Versuche mit demselben
 * Code können sich damit nicht überholen: einer schreibt, der andere sieht
 * nichts mehr und bekommt `invalid_grant`. Ein vorheriges Lesen und späteres
 * Schreiben hätte genau dieses Fenster offen gelassen.
 *
 * Die Zeile bleibt danach stehen, statt gelöscht zu werden. Ein zweiter Versuch
 * mit demselben Code ist der Verdachtsfall, den OAuth 2.1 beschreibt — ein
 * abgefangener Code —, und beantworten kann ihn nur, wer die Zeile noch hat.
 */
export async function exchangeCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string | null;
}): Promise<TokenResult> {
  if (!isUuid(input.clientId)) {
    return { ok: false, error: "invalid_client", description: "Diesen Client gibt es nicht." };
  }

  const [row] = await db
    .select()
    .from(oauthCodes)
    .where(eq(oauthCodes.codeHash, hash(input.code)))
    .limit(1);

  const invalid: TokenResult = {
    ok: false,
    error: "invalid_grant",
    description: "Dieser Code gilt nicht (mehr).",
  };

  if (!row) return invalid;
  if (row.clientId !== input.clientId) return invalid;
  if (row.redirectUri !== input.redirectUri) return invalid;
  if (row.redeemedAt !== null) return invalid;
  if (row.expiresAt.getTime() <= Date.now()) return invalid;

  // Der Client darf sagen, wofür er das Token haben will — dann muss es
  // dasselbe sein, dem der Mensch zugestimmt hat. Schweigt er, gilt das, was
  // auf der Zustimmungsseite stand.
  if (input.resource !== null && !sameResource(input.resource, row.resource)) {
    return {
      ok: false,
      error: "invalid_target",
      description: "Für diese Adresse wurde nicht zugestimmt.",
    };
  }

  if (!verifyPkce(row.codeChallenge, input.codeVerifier)) return invalid;

  const [redeemed] = await db
    .update(oauthCodes)
    .set({ redeemedAt: new Date() })
    .where(and(eq(oauthCodes.id, row.id), isNull(oauthCodes.redeemedAt)))
    .returning({ id: oauthCodes.id });

  if (!redeemed) return invalid;

  const tokens = await createTokens({
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    resource: row.resource,
  });

  return { ok: true, tokens };
}

/**
 * Erneuern: ein neues Zugriffs-Token, und ein neues Erneuerungs-Token dazu.
 *
 * Beide Abdrücke werden in derselben Zeile überschrieben. Das ist die von
 * OAuth 2.1 für öffentliche Clients verlangte Rotation, und sie hat einen
 * sichtbaren Nutzen: ein abgefangenes altes Erneuerungs-Token passt danach auf
 * keine Zeile mehr. Der rechtmäßige Client bekommt dann ebenfalls
 * `invalid_grant` und fragt neu nach Zustimmung — der Mensch sieht, dass etwas
 * nicht stimmt, statt dass jemand still mitliest.
 *
 * Geschrieben wird mit dem alten Abdruck in der `where`-Klausel, nicht mit der
 * id: zwei gleichzeitige Erneuerungen können sich damit nicht beide bedienen.
 */
export async function refreshTokens(input: {
  refreshToken: string;
  clientId: string;
  resource: string | null;
}): Promise<TokenResult> {
  if (!isUuid(input.clientId)) {
    return { ok: false, error: "invalid_client", description: "Diesen Client gibt es nicht." };
  }

  const [row] = await db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.refreshTokenHash, hash(input.refreshToken)))
    .limit(1);

  const invalid: TokenResult = {
    ok: false,
    error: "invalid_grant",
    description: "Diese Verbindung gilt nicht mehr. Melde dich neu an.",
  };

  if (!row) {
    // Kein Treffer heißt nicht unbedingt „kenne ich nicht": es kann auch das
    // Token von letztem Mal sein. Genau dafür steht der vorige Abdruck an der
    // Zeile. Kommt er zurück, ist etwas faul — entweder hat der Client die
    // Antwort auf sein letztes Erneuern verloren, oder jemand anderes hat das
    // Token. Beides beantwortet OAuth 2.1 gleich: die ganze Verbindung fällt.
    // Der ehrliche Client fragt danach neu nach Zustimmung, und ein Dieb steht
    // ebenfalls vor der Tür — ohne diese Zeilen behielte er seine Kette.
    await db
      .update(oauthGrants)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(oauthGrants.previousRefreshTokenHash, hash(input.refreshToken)),
          isNull(oauthGrants.revokedAt),
        ),
      );

    return invalid;
  }
  if (row.clientId !== input.clientId) return invalid;
  if (row.revokedAt !== null) return invalid;
  if (row.refreshExpiresAt.getTime() <= Date.now()) return invalid;

  if (input.resource !== null && !sameResource(input.resource, row.resource)) {
    return {
      ok: false,
      error: "invalid_target",
      description: "Für diese Adresse gilt diese Verbindung nicht.",
    };
  }

  const accessToken = randomToken();
  const refreshToken = randomToken();
  const now = Date.now();

  const [updated] = await db
    .update(oauthGrants)
    .set({
      accessTokenHash: hash(accessToken),
      refreshTokenHash: hash(refreshToken),
      previousRefreshTokenHash: hash(input.refreshToken),
      expiresAt: new Date(now + ACCESS_TTL_SECONDS * 1000),
      refreshExpiresAt: new Date(now + REFRESH_TTL_SECONDS * 1000),
    })
    .where(
      and(
        eq(oauthGrants.id, row.id),
        eq(oauthGrants.refreshTokenHash, hash(input.refreshToken)),
        isNull(oauthGrants.revokedAt),
      ),
    )
    .returning({ id: oauthGrants.id });

  if (!updated) return invalid;

  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      scope: row.scope,
    },
  };
}

/**
 * Wer da anfragt — oder `null`.
 *
 * Die eine Tür, durch die jede MCP-Anfrage geht. Geprüft wird alles, was OAuth
 * 2.1 §5.2 verlangt, und die dritte Prüfung ist die, die man am ehesten
 * vergisst: **das Token muss für DIESE Adresse ausgestellt sein.** Ein Token
 * für einen anderen Server, das jemand hierher weiterreicht, ist kein Zugang —
 * sonst wäre jeder MCP-Server, bei dem der Nutzer angemeldet ist, ein Schlüssel
 * zu allen anderen.
 *
 * Zurück kommt der Nutzer selbst und keine id: jede Funktion in @/lib will die
 * `userId`, und ein zweiter Weg, sie zu beschaffen, wäre ein zweiter Weg, sie
 * falsch zu beschaffen.
 */
export async function userForToken(
  token: string,
  resource: string,
): Promise<{ user: User; grantId: string } | null> {
  if (token.length === 0) return null;

  const [row] = await db
    .select({ grant: oauthGrants, user: users })
    .from(oauthGrants)
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .where(eq(oauthGrants.accessTokenHash, hash(token)))
    .limit(1);

  if (!row) return null;
  if (row.grant.revokedAt !== null) return null;
  if (row.grant.expiresAt.getTime() <= Date.now()) return null;
  if (!sameResource(row.grant.resource, resource)) return null;

  return { user: row.user, grantId: row.grant.id };
}

/** Eine bestehende Verbindung, wie sie in den Einstellungen steht. */
export type Connection = {
  id: string;
  clientName: string;
  createdAt: Date;
  expiresAt: Date;
  refreshExpiresAt: Date;
};

/**
 * Die Verbindungen eines Nutzers, die neueste zuerst — für die Einstellungen.
 *
 * Zurückgezogene stehen nicht dabei. Eine getrennte Verbindung ist keine
 * Verbindung, und eine Liste, in der beides steht, verlangt vom Leser, jede
 * Zeile erst zu entziffern.
 */
export async function listConnections(userId: string): Promise<Connection[]> {
  const rows = await db
    .select({
      id: oauthGrants.id,
      clientName: oauthClients.name,
      createdAt: oauthGrants.createdAt,
      expiresAt: oauthGrants.expiresAt,
      refreshExpiresAt: oauthGrants.refreshExpiresAt,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
    .orderBy(oauthGrants.createdAt);

  return rows.reverse();
}

/**
 * Trennt eine Verbindung. Falsch heißt: es gibt sie nicht (mehr), oder sie
 * gehört jemand anderem — für den Nutzer dasselbe.
 *
 * Gesetzt wird ein Zeitpunkt, gelöscht wird nichts. Ab dann findet
 * `userForToken()` zwar noch die Zeile, gibt aber niemanden zurück: das
 * Zugriffs-Token ist im selben Moment wertlos, nicht erst nach Ablauf.
 */
export async function revokeConnection(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!isUuid(id)) return false;

  const [row] = await db
    .update(oauthGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthGrants.id, id),
        eq(oauthGrants.userId, userId),
        isNull(oauthGrants.revokedAt),
      ),
    )
    .returning({ id: oauthGrants.id });

  return row !== undefined;
}

/**
 * Legt die beiden Token einer neuen Verbindung an.
 *
 * Eine bestehende Verbindung desselben Clients für denselben Nutzer wird dabei
 * zurückgezogen. Sonst sammelte jede erneute Zustimmung eine weitere Zeile an,
 * die Einstellungsseite zeigte dreimal „Claude", und „trennen" träfe nur eine
 * davon — die anderen läsen weiter mit.
 */
async function createTokens(input: {
  clientId: string;
  userId: string;
  scope: string;
  resource: string;
}): Promise<IssuedTokens> {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const now = Date.now();

  await db
    .update(oauthGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthGrants.userId, input.userId),
        eq(oauthGrants.clientId, input.clientId),
        isNull(oauthGrants.revokedAt),
      ),
    );

  await db.insert(oauthGrants).values({
    clientId: input.clientId,
    userId: input.userId,
    accessTokenHash: hash(accessToken),
    refreshTokenHash: hash(refreshToken),
    scope: input.scope,
    resource: input.resource,
    expiresAt: new Date(now + ACCESS_TTL_SECONDS * 1000),
    refreshExpiresAt: new Date(now + REFRESH_TTL_SECONDS * 1000),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    scope: input.scope,
  };
}

/**
 * Zwei Adressen, die dasselbe meinen.
 *
 * Schema und Name werden kleingeschrieben verglichen, ein Schrägstrich am Ende
 * fällt weg — beides steht so in der Spezifikation („Server SHOULD accept
 * uppercase scheme and host"). Der Pfad bleibt, wie er ist: `/api/mcp` und
 * `/api/MCP` sind zwei verschiedene Adressen, und das entscheidet nicht dieser
 * Server, sondern die Adressvergabe im Netz.
 */
function sameResource(a: string, b: string): boolean {
  return normalizeResource(a) === normalizeResource(b);
}

function normalizeResource(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "");

    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

/**
 * Ein Token: 32 zufällige Bytes als base64url — dieselbe Machart wie das
 * Sitzungs-Token in @/lib/session. 256 Bit Zufall sind nicht zu raten, und die
 * Form kommt ohne Zeichen aus, die in einer Kopfzeile oder Adresse stören.
 */
function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Der Abdruck, unter dem ein Geheimnis in der Datenbank steht. Nie das Geheimnis selbst. */
function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Eine kaputte id aus einer Adresszeile würde Postgres sonst mit einem
 * Typfehler quittieren — hier wird daraus ein sauberes „gibt es nicht".
 *
 * Dieselbe Regel wie `isId()` in @/lib/materials und @/lib/inbox; sie ist dort
 * privat, und eine dritte Fassung derselben Prüfung ist der Preis dafür. Wer
 * eine ändert, ändert die anderen mit.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Räumt auf: alte Verbindungen und Clients, an denen nie etwas hing.
 *
 * Wird beim Anmelden eines Clients mitgerufen, aus demselben Grund wie das
 * Wegräumen alter Sitzungen: es gibt keinen Dienst, der das sonst täte, und die
 * Gelegenheit ist die richtige, weil an dieser Stelle ohnehin geschrieben wird.
 *
 * **Der zweite Teil ist die Antwort auf die offene Anmeldung.** Jeder im Netz
 * darf einen Client anmelden, und keine dieser Zeilen bedeutet einen Zugang —
 * aber liegenbleiben würden sie trotzdem für immer. Weg kommt, woran weder eine
 * Verbindung noch ein offener Code hängt: was ein Mensch bestätigt hat, bleibt,
 * alles andere war ein Versuch.
 *
 * **Dieselbe Frist wie oben, dreißig Tage, und nicht ein Tag.** Ein Client
 * merkt sich seine Kennung; die Claude-App meldet sich einmal an und benutzt
 * die Zeile danach jedes Mal wieder, auch nach einem Trennen und Neuverbinden.
 * Eine kurze Frist träfe deshalb irgendwann genau den Fall, der aussieht wie
 * ein Fehler in dieser App: „Diesen Zugang gibt es nicht" beim Verbinden, ohne
 * dass jemand etwas getan hätte. Ein paar liegengebliebene Zeilen sind der
 * billigere Preis — sie kosten Bytes, nicht Vertrauen.
 *
 * Ganz ausgeschlossen ist der Fall damit nicht: wer einen Monat lang getrennt
 * bleibt, verliert mit der Verbindung auch die Zeile des Clients. Das ist die
 * richtige Reihenfolge — eine Kennung ohne jede Verbindung ist nichts, was
 * aufzuheben wäre —, und ein Client, der wiederkommt, meldet sich neu an. Das
 * kostet ihn einen Aufruf und niemanden eine Entscheidung.
 */
export async function sweepGrants(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  await db
    .delete(oauthGrants)
    .where(
      or(
        lte(oauthGrants.refreshExpiresAt, cutoff),
        lte(oauthGrants.revokedAt, cutoff),
      ),
    );

  await db
    .delete(oauthClients)
    .where(
      and(
        lte(oauthClients.createdAt, cutoff),
        notExists(
          db
            .select({ eins: sql`1` })
            .from(oauthGrants)
            .where(eq(oauthGrants.clientId, oauthClients.id)),
        ),
        notExists(
          db
            .select({ eins: sql`1` })
            .from(oauthCodes)
            .where(eq(oauthCodes.clientId, oauthClients.id)),
        ),
      ),
    );
}
