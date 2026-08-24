import {
  discoverResult,
  initializeResult,
  listCaching,
  readEnvelope,
  rpcError,
  rpcResult,
  type Envelope,
} from "@/lib/mcp/protocol";
import { callTool } from "@/lib/mcp/run";
import { isToolName, toolList } from "@/lib/mcp/tools";
import {
  canonicalResource,
  originFrom,
  resourceMetadataUrl,
  userForToken,
  OAUTH_SCOPE,
} from "@/lib/oauth";
import type { User } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Der MCP-Server: die eine Adresse, an der ein Agent mit dieser App spricht.
 *
 * Alles Fachliche liegt woanders — @/lib/mcp/protocol liest den Umschlag,
 * @/lib/mcp/tools führt das Verzeichnis, @/lib/mcp/run tut die Arbeit auf
 * derselben @/lib wie die Oberfläche. Hier steht nur, was eine Adresse im Netz
 * ausmacht: Anmeldung, Statuscodes, Kopfzeilen.
 *
 * **Die 401 ist der Anfang und kein Fehler.** Ein Client, der diese App noch
 * nicht kennt, ruft sie ohne Token auf; er bekommt eine 401 mit einem
 * `WWW-Authenticate`, in dem steht, wo die Beschreibung des geschützten Servers
 * liegt — und von dort findet er über zwei weitere Dokumente den Weg zur
 * Zustimmungsseite. Genau deshalb muss die Absage auf HTTP-Ebene stehen: ein
 * Ergebnis mit `isError: true` wäre für den Client eine Antwort und für den
 * Menschen eine Sackgasse, weil keine Anmeldung angeboten würde.
 *
 * **Kein Cookie, nirgends.** Diese Adresse liest ausschließlich das
 * Bearer-Token; die Sitzung des Browsers gilt hier nicht. Das ist der Grund,
 * warum darunter kein CSRF-Schutz nötig ist und warum die Prüfung des
 * `Origin`-Kopfes, die die Spezifikation für lokale Server verlangt, hier
 * nichts rettete: ein fremder Browser kann keine Anfrage stellen, die von
 * selbst berechtigt wäre. Was hier zählt, ist das Token — und dass es für
 * GENAU DIESE Adresse ausgestellt wurde.
 *
 * **Antwort ist immer JSON.** Die Spezifikation erlaubt daneben einen
 * SSE-Strom; der wäre für Werkzeuge gut, die lange rechnen und unterwegs
 * berichten. Hier rechnet nichts lange: die teuerste Antwort ist ein Bild aus
 * der Datenbank.
 */

/** Wie sich diese Adresse einem Client vorstellt, der noch kein Token hat. */
function challenge(origin: string, error?: { code: string; note: string }): string {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl(origin)}"`];

  // Ohne Token steht kein `error` dabei — RFC 6750 §3.1 sagt ausdrücklich, dass
  // eine Anfrage ganz ohne Anmeldung keinen Fehlercode bekommt: es ist nichts
  // schiefgegangen, es hat nur noch nichts angefangen.
  if (error) {
    parts.push(`error="${error.code}"`, `error_description="${error.note}"`);
  }

  parts.push(`scope="${OAUTH_SCOPE}"`);

  return parts.join(", ");
}

/**
 * Die Kopfzeilen, die an jeder Antwort stehen.
 *
 * `Access-Control-Allow-Origin: *` ist hier ungefährlich und für Clients im
 * Browser nötig: ohne die Zeile kann eine Webanwendung diese Adresse nicht
 * ansprechen. Gefährlich wäre sie nur zusammen mit einer Anmeldung, die der
 * Browser von selbst mitschickt — also mit Cookies. Die gibt es hier nicht.
 */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

export async function POST(request: Request) {
  const origin = originFrom(
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  );

  if (!origin) {
    return json(rpcError(null, -32603, "Diese App kennt ihre eigene Adresse nicht."), 500);
  }

  const token = bearer(request.headers.get("authorization"));

  if (!token) {
    return unauthorized(challenge(origin));
  }

  const auth = await userForToken(token, canonicalResource(origin));

  if (!auth) {
    return unauthorized(
      challenge(origin, {
        code: "invalid_token",
        note: "Dieses Token gilt hier nicht mehr.",
      }),
    );
  }

  const body = await request.json().catch(() => null);

  const envelope = readEnvelope(
    body,
    request.headers.get("mcp-protocol-version"),
    request.headers.get("mcp-method"),
  );

  if (envelope.kind === "notification") {
    // Eine Mitteilung bekommt keine Antwort, nur die Quittung, dass sie
    // angekommen ist. Ein Körper wäre hier ein Protokollfehler.
    return new Response(null, { status: 202, headers: CORS });
  }

  if (envelope.kind === "reject") {
    return json(envelope.body, envelope.status);
  }

  try {
    return await dispatch(envelope, auth.user);
  } catch (cause) {
    // Was hier ankommt, ist nichts, womit ein Modell etwas anfangen könnte —
    // eine abgerissene Datenbankverbindung, ein Fehler im Code. Der englische
    // Text gehört ins Serverlog und nicht in die Antwort.
    console.error("MCP:", cause);

    return json(
      rpcError(envelope.id, -32603, "Auf dem Server ist etwas schiefgegangen."),
      200,
    );
  }
}

/**
 * Die Methoden, die dieser Server kennt.
 *
 * `initialize` ist die Begrüßung der alten Fassung, `server/discover` die
 * Auskunft der neuen — beide beantworten dieselbe Frage, und beide stehen hier,
 * weil beide Zeitalter nebeneinander bedient werden. `ping` ist in der neuen
 * Fassung abgeschafft und wird trotzdem beantwortet: es kostet eine Zeile, und
 * ein alter Client hält den Server sonst für tot.
 */
async function dispatch(
  envelope: Extract<Envelope, { kind: "request" }>,
  user: User,
): Promise<Response> {
  const { id, method, params, modern } = envelope;

  if (method === "initialize") {
    return json(rpcResult(id, initializeResult(params.protocolVersion), modern), 200);
  }

  if (method === "server/discover") {
    return json(rpcResult(id, discoverResult(), modern), 200);
  }

  if (method === "ping") {
    return json(rpcResult(id, {}, modern), 200);
  }

  if (method === "tools/list") {
    return json(
      rpcResult(id, { tools: toolList(), ...(modern ? listCaching() : {}) }, modern),
      200,
    );
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";

    // Ein Werkzeug, das es nicht gibt, ist kein Fehler BEIM Ausführen, sondern
    // einer beim Finden — und der gehört als Protokollfehler zurück. Die
    // Spezifikation nennt genau diesen Fall als Beispiel.
    if (!isToolName(name)) {
      return json(rpcError(id, -32602, `Dieses Werkzeug gibt es nicht: ${name}`), 200);
    }

    const outcome = await callTool(user, name, params.arguments);

    return json(rpcResult(id, toolResult(outcome), modern), 200);
  }

  // In der modernen Fassung MUSS eine unbekannte Methode auch im Statuscode
  // eine sein — daran unterscheidet ein Client sie von einer 404 des alten
  // Transports. In der alten Fassung steht der Fehler im Körper einer 200.
  return json(
    rpcError(id, -32601, `Diese Methode kennt der Server nicht: ${method}`),
    modern ? 404 : 200,
  );
}

/**
 * Aus dem Ergebnis eines Werkzeugs wird MCP-Inhalt.
 *
 * Der Satz steht immer vorn, auch beim Bild: ein Modell soll erst lesen, was es
 * bekommt, und dann hineinsehen. Bei Daten folgt das JSON in derselben
 * Textblase — zwei Blasen wären zwei Absätze über dieselbe Sache.
 */
function toolResult(
  outcome: Awaited<ReturnType<typeof callTool>>,
): Record<string, unknown> {
  if (outcome.art === "fehler") {
    return { content: [{ type: "text", text: outcome.satz }], isError: true };
  }

  if (outcome.art === "bild") {
    return {
      content: [
        { type: "text", text: outcome.satz },
        { type: "image", data: outcome.base64, mimeType: outcome.mimeType },
      ],
      isError: false,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `${outcome.satz}\n${JSON.stringify(outcome.daten)}`,
      },
    ],
    isError: false,
  };
}

/**
 * Ein Strom über GET gibt es hier nicht, und Sitzungen, die man über DELETE
 * beenden könnte, auch nicht. 405 ist die vorgesehene Antwort darauf und
 * ausdrücklich kein Mangel.
 */
export async function GET() {
  return notAllowed();
}

export async function DELETE() {
  return notAllowed();
}

/** Eine 405 nennt, was stattdessen ginge — das verlangt HTTP, und es hilft. */
function notAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: { ...CORS, Allow: "POST, OPTIONS" },
  });
}

/** Die Vorfrage eines Browsers, bevor er die eigentliche Anfrage schickt. */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Das Token aus „Authorization: Bearer …". Alles andere zählt als keines. */
function bearer(header: string | null): string | null {
  if (!header) return null;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return null;

  const token = rest.join("");
  return token.length > 0 ? token : null;
}

function unauthorized(header: string): Response {
  return new Response(null, {
    status: 401,
    headers: { ...CORS, "WWW-Authenticate": header, "Cache-Control": "no-store" },
  });
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS, "Cache-Control": "no-store" },
  });
}
