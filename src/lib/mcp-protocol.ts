/**
 * Das Model Context Protocol, so weit ein reiner Werkzeug-Server es braucht.
 *
 * Reine Rechnung: keine Datenbank, kein Next, keine Werkzeuge. Diese Datei
 * kennt JSON-RPC, Kopfzeilen und Fehlercodes — sonst nichts. Genau deshalb
 * liegt sie hier und lässt sich Zeile für Zeile prüfen, ohne dass ein Test
 * einen Server starten müsste.
 *
 * **Von Hand und ohne SDK.** Der Umfang, den ein Server mit Werkzeugen und
 * ohne Ressourcen, Prompts und Rückfragen abdecken muss, ist klein: fünf
 * Methoden, ein Umschlag, eine Handvoll Kopfzeilen. Dafür ein Paket samt
 * Abhängigkeiten hereinzuholen wäre in diesem Projekt der Fremdkörper — es
 * hält seine Bilder in derselben Datenbank wie alles andere, um sich keinen
 * zweiten Dienst einzuhandeln.
 *
 * **Zwei Protokoll-Zeitalter nebeneinander.** Die Revision `2026-07-28` hat den
 * `initialize`-Handschlag, die Protokoll-Sitzung, den `Mcp-Session-Id`-Kopf und
 * den GET-Strom abgeschafft: jede Anfrage trägt ihre Version selbst, der Server
 * merkt sich zwischen zwei Anfragen nichts. Ältere Clients sprechen weiter das
 * alte Verfahren, und sie können nicht nach vorn ausweichen — ein Server, der
 * nur die neue Revision kennt, ist für sie tot. Deshalb bedient diese Datei
 * beide:
 *
 * - `initialize` wählt das alte Zeitalter. Danach kommen Anfragen ohne `_meta`,
 *   ihre Version steht im Kopf `MCP-Protocol-Version` (oder gar nirgends, dann
 *   gilt `2025-03-26`).
 * - Ein `_meta` mit `io.modelcontextprotocol/protocolVersion` wählt das neue —
 *   und ebenso eine moderne Revision im Kopf. Dort sind die Kopfzeilen Pflicht.
 *
 * **Widerspricht ein Kopf dem Rumpf, wird abgewiesen — in beiden Zeitaltern.**
 * Pflicht sind die Kopfzeilen nur im neuen; verglichen wird jede, die da ist.
 * Sonst ließe sich die Prüfung abwählen, indem man das `_meta` weglässt.
 *
 * **Warum die Kopfzeilen überhaupt geprüft werden.** Sie wiederholen, was im
 * Rumpf steht — Methode und Werkzeugname —, damit ein Vermittler unterwegs
 * (Lastverteiler, CDN) weiterleiten kann, ohne den Rumpf zu lesen. Genau daraus
 * entsteht die Lücke: entscheidet der eine nach dem Kopf und der andere nach
 * dem Rumpf, lässt sich beides auseinanderziehen. Deshalb verlangt die
 * Spezifikation, dass der Server die Anfrage zurückweist, sobald die beiden
 * nicht übereinstimmen — und dass ein fehlender Pflichtkopf ebenso zählt.
 */

/** Die Revisionen, die dieser Server bedient — die neueste zuerst. */
export const SUPPORTED_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

export type ProtocolVersion = (typeof SUPPORTED_VERSIONS)[number];

/** Die Revision, in der dieser Server zu Hause ist. */
export const LATEST_VERSION: ProtocolVersion = "2026-07-28";

/**
 * Die Revision für einen Client, der gar keine nennt.
 *
 * Vor `2025-06-18` gab es den Kopf `MCP-Protocol-Version` noch nicht; die
 * Spezifikation erlaubt ausdrücklich, eine Anfrage ohne ihn als `2025-03-26`
 * zu behandeln.
 */
const ASSUMED_VERSION: ProtocolVersion = "2025-03-26";

/** Wer diesen Server bedient — steht in jeder Antwort auf eine Erkundung. */
export const SERVER_INFO = {
  name: "schulapp",
  title: "Schulapp",
  version: "1.0.0",
} as const;

/**
 * Die JSON-RPC-Fehlercodes.
 *
 * Die beiden über `-32020` sind MCP-eigen. Der Bereich `-32000` bis `-32019`
 * bleibt leer: er gehört alten Implementierungen, und die Spezifikation
 * verbietet, dort neue Bedeutungen zu vergeben.
 */
export const ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_VERSION: -32022,
} as const;

/** Eine JSON-RPC-Nachricht, so weit sie hier geprüft ist. */
export type RpcMessage = {
  id: string | number | null;
  method: string;
  params: Record<string, unknown>;
  /** Ohne `id` ist es eine Benachrichtigung: sie bekommt keine Antwort. */
  isNotification: boolean;
};

/** In welchem Zeitalter eine Anfrage gestellt ist. */
export type Era = "modern" | "legacy";

export type Envelope = {
  jsonrpc: "2.0";
  id: string | number | null;
  [key: string]: unknown;
};

/** Was aus einer Prüfung wird: weitermachen, oder eine fertige Absage. */
export type Rejection = {
  /** Der HTTP-Status, mit dem die Absage hinausgeht. */
  status: number;
  code: number;
  message: string;
  data?: unknown;
};

/**
 * Liest den Rumpf einer Anfrage.
 *
 * Geprüft wird nur, was JSON-RPC 2.0 für eine Anfrage verlangt: `jsonrpc`,
 * `method`, und dass `id` — wenn da — eine Zahl oder eine Zeichenkette ist.
 * `params` darf fehlen; ein Werkzeug ohne Parameter ist ein gewöhnlicher Fall.
 *
 * Eine Antwort (also ein Rumpf mit `result` oder `error`) weist der Server ab:
 * ein Client schickt keine Antworten an einen Server.
 *
 * **Ein Stapel — ein Feld mehrerer Nachrichten — wird abgewiesen.** Seit
 * `2025-06-18` verlangt die Spezifikation ohnehin genau eine Nachricht je
 * POST; nur die älteste hier bediente Revision kannte Stapel. Ein Client, der
 * einen schickt, bekommt `-32600` und einen Satz — und nicht etwa die erste
 * Nachricht beantwortet und den Rest verschluckt.
 */
export function readMessage(
  body: unknown,
): { ok: true; message: RpcMessage } | { ok: false; rejection: Rejection } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return invalid("Der Rumpf ist keine einzelne JSON-RPC-Nachricht.");
  }

  const raw = body as Record<string, unknown>;

  if (raw.jsonrpc !== "2.0") {
    return invalid('Es fehlt "jsonrpc": "2.0".');
  }

  if ("result" in raw || "error" in raw) {
    return invalid("Ein Server nimmt keine JSON-RPC-Antworten entgegen.");
  }

  if (typeof raw.method !== "string" || raw.method === "") {
    return invalid('Es fehlt eine Methode.');
  }

  const hasId = "id" in raw && raw.id !== null;
  if (hasId && typeof raw.id !== "string" && typeof raw.id !== "number") {
    return invalid("Die id muss eine Zeichenkette oder eine Zahl sein.");
  }

  const params =
    typeof raw.params === "object" &&
    raw.params !== null &&
    !Array.isArray(raw.params)
      ? (raw.params as Record<string, unknown>)
      : {};

  return {
    ok: true,
    message: {
      id: hasId ? (raw.id as string | number) : null,
      method: raw.method,
      params,
      isNotification: !hasId,
    },
  };
}

function invalid(message: string): { ok: false; rejection: Rejection } {
  return {
    ok: false,
    rejection: { status: 400, code: ERROR.INVALID_REQUEST, message },
  };
}

/** Das `_meta` einer modernen Anfrage, falls eines dabei ist. */
function metaOf(message: RpcMessage): Record<string, unknown> | null {
  const meta = message.params._meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return null;
  }

  return meta as Record<string, unknown>;
}

/**
 * In welchem Zeitalter diese Anfrage gestellt ist.
 *
 * `initialize` gibt es nur im alten — es ist der Handschlag, den das neue
 * abgeschafft hat. Sonst zählt zweierlei: eine Protokollversion im `_meta`,
 * **oder** eine moderne Revision im Kopf `MCP-Protocol-Version`.
 *
 * **Warum der Kopf mitzählt, obwohl das `_meta` die eigentliche Angabe ist.**
 * Sähe nur das `_meta` her, ließe sich die Kopfprüfung abwählen: eine Anfrage
 * mit `Mcp-Method: tools/list` im Kopf und `tools/call` im Rumpf, aber ohne
 * `_meta`, gälte als alt — und im alten Zeitalter wird der Kopf nicht gegen
 * den Rumpf geprüft. Genau die Lücke, für die es die Prüfung gibt, stünde
 * damit jedem offen, der das `_meta` weglässt. Wer die moderne Revision im
 * Kopf nennt, wird deshalb daran gemessen; fehlt ihm dann das `_meta`, sagt
 * `checkHeaders()` das mit einer eigenen Meldung.
 */
export function eraOf(message: RpcMessage, headers: Headers): Era {
  if (message.method === "initialize") return "legacy";

  const version = metaOf(message)?.["io.modelcontextprotocol/protocolVersion"];
  if (typeof version === "string") return "modern";

  const header = headers.get("mcp-protocol-version");

  return header !== null && isModern(header) ? "modern" : "legacy";
}

/**
 * Ist das eine Revision aus dem neuen Zeitalter?
 *
 * Verglichen wird als Zeichenkette, und das geht: die Revisionen sind Daten in
 * der Form `YYYY-MM-DD`, und die sortieren sich als Text genau wie als Datum.
 * Eine künftige Revision zählt damit von selbst als modern, ohne dass jemand
 * diese Liste nachziehen müsste.
 */
function isModern(version: string): boolean {
  return version >= FIRST_MODERN_VERSION;
}

/** Die erste Revision ohne Handschlag und ohne Sitzung. */
const FIRST_MODERN_VERSION = "2026-07-28";

/**
 * Welche Revision diese Anfrage spricht — oder `null`, wenn sie eine nennt,
 * die dieser Server nicht bedient.
 *
 * Drei Quellen, je nach Zeitalter: das `_meta` einer modernen Anfrage, die
 * `params.protocolVersion` eines `initialize`, sonst der Kopf
 * `MCP-Protocol-Version`. Fehlt auch der, gilt `2025-03-26`.
 */
export function versionOf(
  message: RpcMessage,
  headers: Headers,
): { ok: true; version: ProtocolVersion } | { ok: false; requested: string } {
  const wanted = requestedVersion(message, headers);

  if (isSupported(wanted)) return { ok: true, version: wanted };

  return { ok: false, requested: wanted };
}

function requestedVersion(message: RpcMessage, headers: Headers): string {
  // Der Handschlag zuerst: er nennt seine Version in `params.protocolVersion`,
  // und die ist das, worüber verhandelt wird. Ein `_meta` daneben — manche
  // Clients schicken es aus Gewohnheit mit — darf sie nicht überstimmen, sonst
  // antwortete der Server mit einer Version, die niemand angefragt hat.
  if (message.method === "initialize") {
    const asked = message.params.protocolVersion;
    // Ein alter Client, der eine Version nennt, die dieser Server nicht kennt,
    // bekommt in `initialize` keine Absage, sondern die neueste, die beide
    // können — so schreibt es das alte Verfahren vor. Deshalb fällt hier alles
    // Unbekannte auf die neueste zurück, statt zurückgewiesen zu werden.
    if (typeof asked === "string") {
      return isSupported(asked) ? asked : LATEST_VERSION;
    }
    return LATEST_VERSION;
  }

  const meta = metaOf(message)?.["io.modelcontextprotocol/protocolVersion"];
  if (typeof meta === "string") return meta;

  const header = headers.get("mcp-protocol-version");

  return header ?? ASSUMED_VERSION;
}

function isSupported(value: string): value is ProtocolVersion {
  return (SUPPORTED_VERSIONS as readonly string[]).includes(value);
}

/**
 * Die Absage für eine Revision, die dieser Server nicht bedient. Sie nennt,
 * was er kann — sonst müsste der Client raten.
 */
export function unsupportedVersion(requested: string): Rejection {
  return {
    status: 400,
    code: ERROR.UNSUPPORTED_VERSION,
    message: "Unsupported protocol version",
    data: { supported: [...SUPPORTED_VERSIONS], requested },
  };
}

/**
 * Der Kennzeichen-Umschlag für Kopfzeilen, die kein reines ASCII tragen
 * können: `=?base64?…?=`.
 *
 * Ein Werkzeugname darf nach der Spezifikation ohnehin nur ASCII enthalten,
 * ein Parameterwert nicht unbedingt. Dekodiert wird trotzdem hier und für alle
 * Kopfzeilen gleich: verglichen wird gegen den Rumpf, und dort steht der
 * Klartext.
 */
export function decodeHeaderValue(value: string): string {
  const match = /^=\?base64\?(.*)\?=$/.exec(value);
  if (!match) return value;

  const packed = match[1] ?? "";

  // `Buffer.from(…, "base64")` wirft nicht, sondern überliest, was kein
  // Base64 ist — aus „???“ würde eine leere Zeichenkette. Ein kaputter
  // Umschlag bliebe damit unbemerkt und stünde als „" im Vergleich mit dem
  // Rumpf. Deshalb erst die Zeichen prüfen: was kein Base64 ist, bleibt, wie
  // es ist, und passt dann nicht zum Rumpf — genau die richtige Antwort.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(packed)) return value;

  return Buffer.from(packed, "base64").toString("utf8");
}

/**
 * Prüft die Pflicht-Kopfzeilen einer modernen Anfrage gegen ihren Rumpf.
 *
 * Drei Fälle führen zur selben Absage (`400` und `-32020`): ein Pflichtkopf
 * fehlt, ein Kopf widerspricht dem Rumpf, oder die Version im Kopf ist eine
 * andere als die im `_meta`. Warum das streng gehandhabt wird, steht im Kopf
 * dieser Datei.
 *
 * `Mcp-Name` ist nur bei den Methoden Pflicht, die einen Namen tragen — bei
 * `tools/list` gibt es keinen, und ein Kopf, den niemand schicken kann, darf
 * nicht verlangt werden.
 */
export function checkHeaders(
  message: RpcMessage,
  headers: Headers,
  era: Era,
): Rejection | null {
  const required = era === "modern";
  const version = metaOf(message)?.["io.modelcontextprotocol/protocolVersion"];
  const headerVersion = headers.get("mcp-protocol-version");

  if (required) {
    if (!headerVersion) {
      return headerMismatch("Der Kopf MCP-Protocol-Version fehlt.");
    }
    if (typeof version !== "string") {
      return headerMismatch(
        "Es fehlt io.modelcontextprotocol/protocolVersion im _meta.",
      );
    }
    if (headerVersion !== version) {
      return headerMismatch(
        "MCP-Protocol-Version steht im Kopf anders als im _meta.",
      );
    }
  }

  const method = headers.get("mcp-method");
  if (required && !method) {
    return headerMismatch("Der Kopf Mcp-Method fehlt.");
  }
  if (method !== null && decodeHeaderValue(method) !== message.method) {
    return headerMismatch("Mcp-Method steht im Kopf anders als im Rumpf.");
  }

  if (!NAMED_METHODS.has(message.method)) return null;

  const name = headers.get("mcp-name");
  if (required && !name) {
    return headerMismatch("Der Kopf Mcp-Name fehlt.");
  }

  const wanted = message.params.name ?? message.params.uri;
  if (name !== null && decodeHeaderValue(name) !== wanted) {
    return headerMismatch("Mcp-Name steht im Kopf anders als im Rumpf.");
  }

  return null;
}

/** Die Methoden, deren Anfragen einen Namen tragen und ihn im Kopf spiegeln. */
const NAMED_METHODS = new Set([
  "tools/call",
  "resources/read",
  "prompts/get",
]);

function headerMismatch(message: string): Rejection {
  return { status: 400, code: ERROR.HEADER_MISMATCH, message };
}

/**
 * Ein Ergebnis im Umschlag der jeweiligen Revision.
 *
 * `resultType` gibt es erst seit `2026-07-28`. Ein alter Client kennt das Feld
 * nicht; es stünde für ihn nur unnütz da. Deshalb kommt es nur ins moderne
 * Ergebnis — und der Server, der von sich selbst behauptet, beide Zeitalter zu
 * bedienen, antwortet damit auch in beiden so, wie es dort vereinbart ist.
 */
export function result(
  id: string | number | null,
  era: Era,
  payload: Record<string, unknown>,
): Envelope {
  if (era === "legacy") {
    return { jsonrpc: "2.0", id, result: payload };
  }

  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      ...payload,
      _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    },
  };
}

/**
 * Die Zwischenspeicher-Angaben, die eine moderne Liste tragen muss.
 *
 * `private` und nicht `public`, obwohl die Werkzeugliste dieses Servers für
 * jeden gleich aussieht: ein `public` erlaubt dem Client, dieselbe Antwort in
 * einem anderen Berechtigungszusammenhang wiederzuverwenden. Diese App gehört
 * genau einem Menschen; sie gewinnt durch geteiltes Zwischenspeichern nichts
 * und hätte im Irrtumsfall alles zu verlieren.
 *
 * Im alten Zeitalter kommt gar nichts: die beiden Felder gibt es erst seit
 * `2026-07-28`. Sie einem Client von 2025 mitzuschicken wäre dasselbe wie ein
 * `resultType` in seinem Umschlag — ein Feld, das er nicht kennt und über das
 * ein strenger Prüfer stolpert.
 */
export function cacheHints(era: Era): Record<string, unknown> {
  if (era === "legacy") return {};

  return { ttlMs: CACHE_TTL_MS, cacheScope: "private" };
}

/** Eine Stunde — die Werkzeugliste ändert sich nur mit einem Deploy. */
const CACHE_TTL_MS = 3_600_000;

export function errorEnvelope(
  id: string | number | null,
  rejection: Rejection,
): Envelope {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: rejection.code,
      message: rejection.message,
      ...(rejection.data === undefined ? {} : { data: rejection.data }),
    },
  };
}

/**
 * Prüft den Ursprung einer Anfrage gegen DNS-Rebinding.
 *
 * Die Spezifikation verlangt: ist ein `Origin` da und passt er nicht, muss der
 * Server mit `403` absagen. **Fehlt er, ist das kein Ablehnungsgrund** — ein
 * MCP-Client ist kein Browser und schickt keinen.
 *
 * Was passt, ist der eigene Ursprung. Der Angriff, um den es geht, läuft über
 * eine Webseite im Browser des Nutzers, die eine Adresse auf den lokalen
 * Rechner auflösen lässt und dann dorthin schreibt; ihr `Origin` ist der der
 * Webseite und damit nie der eigene.
 *
 * **Der eigene Ursprung stammt seinerseits aus der Anfrage**, solange `APP_URL`
 * nicht gesetzt ist — verglichen werden dann zwei Angaben desselben Absenders.
 * Für den Angriff, um den es hier geht, trägt das trotzdem: den `Origin` setzt
 * der Browser, und Skript im Browser kann ihn nicht fälschen. Wer beide selbst
 * setzen kann, sitzt nicht in einem Browser — und lässt den `Origin` dann
 * einfach weg, wogegen keine Prüfung dieser Art hilft. Wo es darauf ankommt,
 * nagelt `APP_URL` die eigene Adresse fest; dann steht auf der einen Seite des
 * Vergleichs ein Wert, den keine Anfrage bewegen kann.
 */
export function checkOrigin(headers: Headers, origin: string): boolean {
  const sent = headers.get("origin");
  if (!sent) return true;

  return sent === origin;
}
