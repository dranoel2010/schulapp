import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, gt, lte, notExists } from "drizzle-orm";

import { db } from "@/db";
import {
  oauthClients,
  oauthCodes,
  oauthTokens,
  type OauthClient,
} from "@/db/schema";
import { onlyUser } from "@/lib/auth";

/**
 * Die Anmeldung des Agenten — OAuth 2.1, so klein wie es sein darf.
 *
 * **Warum überhaupt OAuth für eine App mit einem einzigen Nutzer.** Weil die
 * Gegenseite es verlangt. Die Claude-App verbindet sich mit einem eigenen
 * MCP-Server aus Anthropics Rechenzentrum heraus, nicht vom Gerät des Nutzers;
 * beim Anlegen eines Connectors gibt es genau ein Feld — die Adresse — und
 * darunter, hinter „Advanced settings“, OAuth. Ein Kopf mit einem festen Token
 * lässt sich dort nicht eintragen. Übrig bleiben zwei Wege: ohne Anmeldung
 * (also die Noten und Blätter eines Schülers offen ins Netz), oder OAuth. Damit
 * ist die Entscheidung keine.
 *
 * **Die App ist ihr eigener Autorisierungsserver.** Sie hat schon eine
 * Anmeldung mit Passwort und Sitzungs-Cookie; `/oauth/authorize` benutzt genau
 * die. Wer nicht angemeldet ist, kommt auf die Anmeldeseite und danach zurück.
 * Ein zweiter Dienst, ein Identitätsanbieter, ein weiteres Konto — nichts
 * davon kommt dazu. Das ist derselbe Satz wie bei den Bildern in der
 * Datenbank: alle Daten liegen auf dem eigenen Server.
 *
 * **Öffentlicher Client, PKCE, ein Scope.** Ein Geheimnis, das eine fremde App
 * für uns aufbewahrt, ist keines; OAuth 2.1 nennt das einen „public client“ und
 * sichert den Tausch stattdessen über PKCE ab. Und es gibt genau einen Scope,
 * weil es genau eine Sache gibt, die der Agent darf: lesen und vorschlagen.
 * Zwei Scopes wären die Andeutung, man könne ihm mehr geben.
 *
 * **Der Agent bekommt kein Schreibrecht — und zwar nicht über einen Scope.**
 * Es gibt schlicht kein Werkzeug, das schreibt (siehe @/lib/mcp-tools). Ein
 * Scope, den man weglassen kann, ist eine Einstellung; eine Fähigkeit, die es
 * nicht gibt, ist eine Zusage.
 */

/**
 * Der eine Scope. Der Name steht in den Metadaten, in der Zustimmung und im
 * Token — überall derselbe.
 */
export const SCOPE = "schulapp";

/**
 * Wie lange ein Zugriffstoken gilt.
 *
 * Eine Stunde, wie üblich: kurz genug, dass ein abgegriffenes Token wertlos
 * wird, lang genug, dass ein Gespräch nicht mittendrin abreißt. Erneuert wird
 * mit dem Refresh-Token, ohne dass jemand etwas tun muss.
 */
const ACCESS_TTL_SECONDS = 3600;

/**
 * Wie lange ein Refresh-Token gilt: ein halbes Jahr.
 *
 * Es ist der Faden, an dem die Verbindung hängt. Reißt er, muss der Nutzer den
 * Connector in der Claude-App noch einmal verbinden — lästig, aber kein
 * Datenverlust. Ein Schuljahr wäre zu lang für etwas, das nie abläuft, wenn es
 * niemand widerruft.
 */
const REFRESH_TTL_SECONDS = 180 * 24 * 60 * 60;

/**
 * Wie lange ein Autorisierungscode gilt: eine Minute.
 *
 * Zwischen „Erlauben“ und dem Tausch beim Token-Endpunkt liegt eine Umleitung.
 * Die Spezifikation empfiehlt höchstens zehn Minuten; eine Minute reicht dafür
 * mit Abstand und macht das Zeitfenster, in dem ein abgefangener Code etwas
 * wert wäre, so klein wie möglich.
 */
const CODE_TTL_SECONDS = 60;

/** Was ein Werkzeugaufruf über den Anrufer weiß. */
export type Caller = { userId: string };

/**
 * Meldet einen Client an (Dynamic Client Registration, RFC 7591).
 *
 * Es gibt keine Prüfung, wer das darf, und das ist Absicht: RFC 7591 sieht
 * ausdrücklich einen offenen Registrierungs-Endpunkt vor, und die Zeile, die
 * dabei entsteht, kann nichts. Sie ist ein Name und eine Liste erlaubter
 * Rücksprungadressen. An Daten kommt erst, wer danach einen Menschen dazu
 * bringt, sich anzumelden und auf „Erlauben“ zu tippen.
 */
export async function registerClient(
  name: string,
  redirectUris: string[],
): Promise<OauthClient> {
  const [client] = await db
    .insert(oauthClients)
    .values({
      id: secret(),
      name: name.trim().slice(0, 120) || "Unbenannter Client",
      redirectUris,
    })
    .returning();

  if (!client) {
    throw new Error("Der Client konnte nicht angelegt werden.");
  }

  return client;
}

/**
 * Wirft die Clients weg, aus denen nie etwas geworden ist.
 *
 * Der Registrierungs-Endpunkt steht offen — so sieht RFC 7591 es vor —, und
 * eine offene Tür ohne Besen füllt sich. Weggeräumt wird nur, woran kein
 * einziges Token hängt und was älter ist als eine Woche: ein Client, den
 * jemand wirklich verbunden hat, hat mindestens ein Refresh-Token und bleibt.
 * Eine Woche, weil zwischen Anmelden und Zustimmen normalerweise eine Minute
 * liegt und ein liegengebliebener Versuch nach ein paar Tagen niemandem mehr
 * fehlt.
 */
export async function forgetUnusedClients(): Promise<void> {
  const cutoff = new Date(Date.now() - UNUSED_CLIENT_TTL_SECONDS * 1000);

  await db.delete(oauthClients).where(
    and(
      lte(oauthClients.createdAt, cutoff),
      notExists(
        db
          .select({ token: oauthTokens.token })
          .from(oauthTokens)
          .where(eq(oauthTokens.clientId, oauthClients.id)),
      ),
    ),
  );
}

/** Eine Woche — so lange bleibt ein angemeldeter, aber nie benutzter Client. */
const UNUSED_CLIENT_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function getClient(id: string): Promise<OauthClient | null> {
  if (!id) return null;

  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, id))
    .limit(1);

  return client ?? null;
}

/** Die Rücksprungadressen eines Clients, wie sie in der Datenbank stehen. */
export function redirectUrisOf(client: OauthClient): string[] {
  return Array.isArray(client.redirectUris)
    ? client.redirectUris.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

/**
 * Darf diese Adresse eine Rücksprungadresse sein?
 *
 * OAuth 2.1 lässt genau zwei Formen zu: HTTPS, oder `localhost` ohne
 * Verschlüsselung. Alles andere trüge den Code über eine Leitung, die jeder
 * mitlesen kann. Geprüft wird beim Anmelden des Clients — was hier nicht
 * durchkommt, steht gar nicht erst in der Datenbank.
 */
export function isAllowedRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // Ein Fragment im Rücksprung ist nach OAuth 2.1 verboten: der Server hängt
  // dort selbst Parameter an.
  if (url.hash !== "") return false;

  if (url.protocol === "https:") return true;

  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

/** Ein Code, ausgestellt nach der Zustimmung eines Menschen. */
export type NewCode = {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
};

export async function createAuthCode(input: NewCode): Promise<string> {
  const code = secret();

  await db.insert(oauthCodes).values({
    code,
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    // Kanonisiert schon beim Hinschreiben: verglichen wird später gegen die
    // kanonische Adresse dieses Servers, und wären nur beim Vergleich beide
    // Seiten gleich behandelt, hinge die Gültigkeit eines Tokens an einem
    // abschließenden Schrägstrich.
    resource: input.resource === null ? null : canonicalResource(input.resource),
    scope: SCOPE,
    expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
  });

  return code;
}

/**
 * Löst einen Code ein — und zwar genau einmal.
 *
 * Eingelöst wird, indem die Zeile gelöscht wird. Was nicht gelöscht werden
 * konnte, weil es die Zeile nicht mehr gab, war ein zweiter Versuch und
 * bekommt nichts. Das ist keine Prüfung, die man vergessen kann: es ist
 * dieselbe Anweisung, die den Code holt.
 *
 * Ein abgelaufener Code wird trotzdem gelöscht und danach abgelehnt — er ist
 * verbraucht, ob er nun gültig war oder nicht.
 */
export async function consumeAuthCode(code: string): Promise<{
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
} | null> {
  if (!code) return null;

  const [row] = await db
    .delete(oauthCodes)
    .where(eq(oauthCodes.code, code))
    .returning();

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  return {
    clientId: row.clientId,
    userId: row.userId,
    redirectUri: row.redirectUri,
    codeChallenge: row.codeChallenge,
    resource: row.resource,
  };
}

/** Was der Token-Endpunkt zurückgibt. */
export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export async function issueTokens(
  userId: string,
  clientId: string,
  resource: string | null,
): Promise<TokenPair> {
  const accessToken = secret();
  const refreshToken = secret();
  const now = Date.now();

  await db.insert(oauthTokens).values([
    {
      token: accessToken,
      kind: "access",
      clientId,
      userId,
      scope: SCOPE,
      resource,
      expiresAt: new Date(now + ACCESS_TTL_SECONDS * 1000),
    },
    {
      token: refreshToken,
      kind: "refresh",
      clientId,
      userId,
      scope: SCOPE,
      resource,
      expiresAt: new Date(now + REFRESH_TTL_SECONDS * 1000),
    },
  ]);

  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
}

/**
 * Tauscht ein Refresh-Token gegen ein neues Paar — und wirft das alte weg.
 *
 * Rotation: nach der Erneuerung ist das alte Refresh-Token wertlos. Wer es
 * abgegriffen hat, kommt damit nach der nächsten Erneuerung des echten Clients
 * nicht mehr weiter. Gelöscht wird auch hier mit derselben Anweisung, die das
 * Token holt — ein zweiter Versuch findet nichts.
 */
export async function rotateRefreshToken(
  token: string,
  clientId: string,
): Promise<TokenPair | null> {
  if (!token) return null;

  const [row] = await db
    .delete(oauthTokens)
    .where(
      and(
        eq(oauthTokens.token, token),
        eq(oauthTokens.kind, "refresh"),
        eq(oauthTokens.clientId, clientId),
      ),
    )
    .returning();

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  return issueTokens(row.userId, row.clientId, row.resource);
}

/**
 * Wer hinter einem Bearer-Token steckt — oder `null`.
 *
 * Zwei Arten von Token kommen hier an, und beide sind ein Bearer-Token:
 *
 * 1. Eines, das dieser Server über OAuth ausgestellt hat. Es muss gelten, es
 *    muss ein Zugriffstoken sein, und **es muss für diese Adresse ausgestellt
 *    sein** (RFC 8707). Ohne die letzte Prüfung wäre ein Token, das für einen
 *    fremden MCP-Server gedacht war, hier gültig — genau das ist der Angriff,
 *    gegen den der `resource`-Parameter erfunden wurde.
 * 2. `MCP_TOKEN` aus der Umgebung, falls gesetzt: der Weg für Claude Code und
 *    für einen Versuch mit curl. Die Claude-App braucht ihn nicht und kann ihn
 *    auch gar nicht schicken; sie erreicht ohnehin kein `localhost`. Ist die
 *    Variable leer, gibt es diesen Weg nicht.
 *
 * Verglichen wird mit `timingSafeEqual`, wie beim Erinnerungs-Endpunkt: ein
 * Vergleich, der beim ersten falschen Zeichen abbricht, verrät über viele
 * Versuche das Token.
 */
export async function verifyBearer(
  token: string,
  resource: string,
): Promise<Caller | null> {
  if (!token) return null;

  const personal = process.env.MCP_TOKEN;
  if (personal && matches(token, personal)) {
    const user = await onlyUser();
    return user ? { userId: user.id } : null;
  }

  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.token, token), eq(oauthTokens.kind, "access")))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  // Ein Token ohne Adresse stammt von einem Client, der keine genannt hat.
  // Es gilt dann für diesen Server — er hat es ausgestellt, und einen zweiten
  // gibt es nicht.
  //
  // Kanonisiert werden beide Seiten, obwohl die gespeicherte es beim
  // Hinschreiben schon war: eine Zeile aus der Zeit davor soll nicht plötzlich
  // ungültig sein, und ein Vergleich, bei dem nur eine Seite normalisiert ist,
  // ist keiner.
  if (
    row.resource &&
    canonicalResource(row.resource) !== canonicalResource(resource)
  ) {
    return null;
  }

  return { userId: row.userId };
}

/**
 * Wie viele Agenten gerade zugreifen dürfen.
 *
 * Gezählt werden die Refresh-Token: eines je Verbindung, und es ist das, was
 * die Verbindung über die Stunde hinaus am Leben hält. Zugriffstoken wären die
 * falsche Zahl — davon entsteht bei jeder Erneuerung ein neues, und abgelaufene
 * liegen herum, bis jemand aufräumt.
 */
export async function countAgentGrants(userId: string): Promise<number> {
  const rows = await db
    .select({ token: oauthTokens.token })
    .from(oauthTokens)
    .where(
      and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.kind, "refresh"),
        gt(oauthTokens.expiresAt, new Date()),
      ),
    );

  return rows.length;
}

/** Nimmt einem Nutzer alle ausgestellten Token wieder ab. */
export async function revokeTokens(userId: string): Promise<void> {
  await db.delete(oauthTokens).where(eq(oauthTokens.userId, userId));
}

/**
 * Räumt weg, was abgelaufen ist.
 *
 * Läuft beim Ausstellen eines Tokens nebenher; einen eigenen Zeitplan bekommt
 * es nicht. Ein abgelaufener Code oder ein abgelaufenes Token ist für sich
 * ungefährlich — geprüft wird die Frist bei jedem Zugriff. Es geht nur darum,
 * dass die Tabelle nicht über Jahre wächst.
 */
export async function cleanupExpired(): Promise<void> {
  const now = new Date();

  await db.delete(oauthCodes).where(lte(oauthCodes.expiresAt, now));
  await db.delete(oauthTokens).where(lte(oauthTokens.expiresAt, now));
}

/**
 * Prüft PKCE nach Verfahren S256: passt der Verifier zur Prüfsumme, die beim
 * Autorisieren hinterlegt wurde?
 *
 * Nur S256. `plain` ist in OAuth 2.1 abgeschafft, und ein Server, der es
 * anböte, hätte die ganze Absicherung wieder aufgehoben — die Prüfsumme wäre
 * dann der Verifier selbst.
 */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;

  const computed = createHash("sha256").update(verifier).digest("base64url");

  return matches(computed, challenge);
}

/**
 * Die Adresse dieses MCP-Servers in der Form, in der sie verglichen wird.
 *
 * Ein abschließender Schrägstrich macht keine andere Adresse; alles andere
 * schon. Verglichen wird deshalb genau so, wie RFC 8707 es meint: die Adresse
 * ohne Fragment und ohne Abfrage, mit dem Schrägstrich am Ende abgeschnitten.
 */
export function canonicalResource(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

/**
 * Das Metadaten-Dokument des Autorisierungsservers (RFC 8414).
 *
 * `code_challenge_methods_supported` ist der wichtigste Eintrag darin: fehlt
 * er, muss ein Client nach der Spezifikation abbrechen, weil er dann nicht
 * weiß, ob PKCE überhaupt greift.
 */
export function authServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Ein öffentlicher Client hat kein Geheimnis, mit dem er sich am
    // Token-Endpunkt ausweisen könnte — er weist sich über PKCE aus.
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  };
}

/**
 * Das Metadaten-Dokument der geschützten Ressource (RFC 9728).
 *
 * Es ist der Faden, an dem die ganze Entdeckung hängt: der Client bekommt vom
 * MCP-Endpunkt eine 401 mit einem `WWW-Authenticate`, das hierher zeigt, liest
 * hier, welcher Autorisierungsserver zuständig ist, und holt sich dort das
 * Dokument von oben.
 */
export function protectedResourceMetadata(
  origin: string,
): Record<string, unknown> {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };
}

/** 32 zufällige Bytes — dieselbe Stärke wie beim Sitzungs-Token. */
function secret(): string {
  return randomBytes(32).toString("base64url");
}

/** Vergleicht zwei Zeichenketten ohne Rückschluss über die Laufzeit. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  // timingSafeEqual verlangt gleiche Länge und wirft sonst. Die Länge selbst
  // ist kein Geheimnis: sie steht bei jedem ausgestellten Token fest.
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
