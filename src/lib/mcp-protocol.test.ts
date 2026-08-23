import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ERROR,
  LATEST_VERSION,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  cacheHints,
  checkHeaders,
  checkOrigin,
  decodeHeaderValue,
  eraOf,
  errorEnvelope,
  readMessage,
  result,
  unsupportedVersion,
  versionOf,
  type RpcMessage,
} from "@/lib/mcp-protocol";

/**
 * Das Protokoll ist reine Rechnung — es fasst weder Datenbank noch Netz an,
 * und genau deshalb lässt es sich hier Fall für Fall prüfen.
 *
 * Warum ausgerechnet diese Fälle: sie sind die Stellen, an denen ein
 * handgeschriebener Server erfahrungsgemäß danebenliegt. Das Zeitalter einer
 * Anfrage falsch zu bestimmen heißt, einem alten Client eine Antwort zu geben,
 * die er nicht lesen kann. Die Kopfzeilen nicht gegen den Rumpf zu prüfen
 * heißt, genau die Lücke offen zu lassen, für die es sie gibt. Und ein
 * `resultType` im falschen Umschlag ist ein Feld, das mal fehlt und mal zu viel
 * ist — beides fällt erst beim echten Client auf.
 */

/** Eine Anfrage, wie `readMessage()` sie herausgibt. */
function message(overrides: Partial<RpcMessage> = {}): RpcMessage {
  return {
    id: 1,
    method: "tools/list",
    params: {},
    isNotification: false,
    ...overrides,
  };
}

/** Das `_meta`, mit dem eine Anfrage modern wird. */
function meta(version = LATEST_VERSION) {
  return {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": version,
      "io.modelcontextprotocol/clientInfo": { name: "Probe", version: "1.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("readMessage", () => {
  it("liest eine gewöhnliche Anfrage", () => {
    const parsed = readMessage({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "read_faecher" },
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.message.id, 7);
    assert.equal(parsed.ok && parsed.message.method, "tools/call");
    assert.equal(parsed.ok && parsed.message.isNotification, false);
  });

  it("nimmt eine Zeichenketten-id an", () => {
    const parsed = readMessage({ jsonrpc: "2.0", id: "abc", method: "ping" });

    assert.equal(parsed.ok && parsed.message.id, "abc");
  });

  it("erkennt eine Benachrichtigung an der fehlenden id", () => {
    for (const body of [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: null, method: "notifications/initialized" },
    ]) {
      const parsed = readMessage(body);
      assert.equal(parsed.ok && parsed.message.isNotification, true);
    }
  });

  it("macht aus fehlenden params ein leeres Objekt", () => {
    // Ein Werkzeug ohne Parameter ist ein gewöhnlicher Fall — der Aufrufer
    // soll nicht auf undefined stoßen.
    const parsed = readMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    assert.deepEqual(parsed.ok && parsed.message.params, {});
  });

  it("weist ab, was keine JSON-RPC-Anfrage ist", () => {
    const bad: unknown[] = [
      null,
      "tools/list",
      42,
      [],
      [{ jsonrpc: "2.0", id: 1, method: "ping" }],
      { id: 1, method: "ping" },
      { jsonrpc: "1.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 1 },
      { jsonrpc: "2.0", id: 1, method: "" },
      { jsonrpc: "2.0", id: {}, method: "ping" },
    ];

    for (const body of bad) {
      const parsed = readMessage(body);
      assert.equal(parsed.ok, false, JSON.stringify(body));
      assert.equal(
        !parsed.ok && parsed.rejection.code,
        ERROR.INVALID_REQUEST,
        JSON.stringify(body),
      );
    }
  });

  it("weist eine Antwort ab — die schickt kein Client an einen Server", () => {
    for (const body of [
      { jsonrpc: "2.0", id: 1, method: "ping", result: {} },
      { jsonrpc: "2.0", id: 1, method: "ping", error: { code: -1 } },
    ]) {
      assert.equal(readMessage(body).ok, false);
    }
  });
});

describe("eraOf", () => {
  it("hält initialize für das alte Zeitalter", () => {
    // Es ist der Handschlag, den das neue Zeitalter abgeschafft hat — wer ihn
    // schickt, spricht das alte.
    assert.equal(eraOf(message({ method: "initialize" }), headers({})), "legacy");
  });

  it("hält eine Anfrage mit Protokollversion im _meta für modern", () => {
    assert.equal(eraOf(message({ params: meta() }), headers({})), "modern");
  });

  it("hält eine Anfrage ohne _meta und ohne modernen Kopf für alt", () => {
    assert.equal(eraOf(message(), headers({})), "legacy");
    assert.equal(eraOf(message({ params: { _meta: {} } }), headers({})), "legacy");
    assert.equal(eraOf(message({ params: { _meta: null } }), headers({})), "legacy");
    assert.equal(
      eraOf(message(), headers({ "MCP-Protocol-Version": "2025-11-25" })),
      "legacy",
    );
  });

  it("hält eine moderne Revision im Kopf für modern, auch ohne _meta", () => {
    // Die Lücke, um die es geht: sähe nur das _meta her, ließe sich die
    // Kopfprüfung abwählen, indem man es weglässt.
    for (const version of ["2026-07-28", "2027-01-01"]) {
      assert.equal(
        eraOf(message(), headers({ "MCP-Protocol-Version": version })),
        "modern",
        version,
      );
    }
  });

  it("lässt sich von einem initialize mit _meta nicht umstimmen", () => {
    // Ein Client, der beides schickt, meint den Handschlag — sonst hätte er
    // ihn weggelassen.
    assert.equal(
      eraOf(message({ method: "initialize", params: meta() }), headers({})),
      "legacy",
    );
  });
});

describe("versionOf", () => {
  it("liest die Version aus dem _meta", () => {
    const found = versionOf(message({ params: meta("2026-07-28") }), headers({}));

    assert.equal(found.ok && found.version, "2026-07-28");
  });

  it("liest sie beim Handschlag aus den params", () => {
    const found = versionOf(
      message({ method: "initialize", params: { protocolVersion: "2025-06-18" } }),
      headers({}),
    );

    assert.equal(found.ok && found.version, "2025-06-18");
  });

  it("antwortet einem Handschlag mit unbekannter Version mit der neuesten", () => {
    // So schreibt es das alte Verfahren vor: der Server nennt eine Version, die
    // er kann, statt abzuweisen.
    const found = versionOf(
      message({ method: "initialize", params: { protocolVersion: "1999-01-01" } }),
      headers({}),
    );

    assert.equal(found.ok && found.version, LATEST_VERSION);
  });

  it("liest sie sonst aus dem Kopf", () => {
    const found = versionOf(
      message(),
      headers({ "MCP-Protocol-Version": "2025-11-25" }),
    );

    assert.equal(found.ok && found.version, "2025-11-25");
  });

  it("nimmt ohne jede Angabe 2025-03-26 an", () => {
    // Vor 2025-06-18 gab es den Kopf noch nicht; die Spezifikation erlaubt
    // ausdrücklich, eine Anfrage ohne ihn so zu behandeln.
    const found = versionOf(message(), headers({}));

    assert.equal(found.ok && found.version, "2025-03-26");
  });

  it("weist eine Revision ab, die dieser Server nicht bedient", () => {
    const found = versionOf(
      message(),
      headers({ "MCP-Protocol-Version": "2024-11-05" }),
    );

    assert.equal(found.ok, false);
    assert.equal(!found.ok && found.requested, "2024-11-05");
  });

  it("nennt in der Absage, was es gibt", () => {
    const rejection = unsupportedVersion("1999-01-01");

    assert.equal(rejection.status, 400);
    assert.equal(rejection.code, ERROR.UNSUPPORTED_VERSION);
    assert.deepEqual(rejection.data, {
      supported: [...SUPPORTED_VERSIONS],
      requested: "1999-01-01",
    });
  });
});

describe("decodeHeaderValue", () => {
  it("lässt einen gewöhnlichen Wert stehen", () => {
    assert.equal(decodeHeaderValue("tools/call"), "tools/call");
  });

  it("packt den Base64-Umschlag aus", () => {
    const packed = `=?base64?${Buffer.from("Kettenregel", "utf8").toString("base64")}?=`;

    assert.equal(decodeHeaderValue(packed), "Kettenregel");
  });

  it("lässt einen kaputten Umschlag, wie er ist", () => {
    // Dann stimmt er nicht mit dem Rumpf überein — und genau das ist die
    // richtige Antwort, kein Absturz.
    assert.equal(decodeHeaderValue("=?base64?????="), "=?base64?????=");
  });
});

describe("checkHeaders", () => {
  const call = message({
    method: "tools/call",
    params: { name: "read_faecher", ...meta() },
  });

  const good = {
    "MCP-Protocol-Version": LATEST_VERSION,
    "Mcp-Method": "tools/call",
    "Mcp-Name": "read_faecher",
  };

  it("lässt eine vollständige Anfrage durch", () => {
    assert.equal(checkHeaders(call, headers(good), "modern"), null);
  });

  it("verlangt Mcp-Name nur, wo es einen Namen gibt", () => {
    const list = message({ params: meta() });

    assert.equal(
      checkHeaders(
        list,
        headers({
          "MCP-Protocol-Version": LATEST_VERSION,
          "Mcp-Method": "tools/list",
        }),
        "modern",
      ),
      null,
    );
  });

  it("weist jede fehlende Pflicht-Kopfzeile ab", () => {
    for (const missing of Object.keys(good)) {
      const rest = { ...good };
      delete rest[missing as keyof typeof good];

      const rejection = checkHeaders(call, headers(rest), "modern");

      assert.notEqual(rejection, null, missing);
      assert.equal(rejection?.code, ERROR.HEADER_MISMATCH, missing);
      assert.equal(rejection?.status, 400, missing);
    }
  });

  it("weist ab, wenn Kopf und Rumpf auseinandergehen", () => {
    // Der Angriff, für den die Prüfung da ist: ein Vermittler leitet nach dem
    // Kopf weiter, der Server führt nach dem Rumpf aus.
    const abweichend = [
      { ...good, "Mcp-Method": "tools/list" },
      { ...good, "Mcp-Name": "propose_hausaufgabe" },
      { ...good, "MCP-Protocol-Version": "2025-11-25" },
    ];

    for (const entries of abweichend) {
      const rejection = checkHeaders(call, headers(entries), "modern");

      assert.equal(rejection?.code, ERROR.HEADER_MISMATCH, JSON.stringify(entries));
    }
  });

  it("vergleicht den Namen nach dem Auspacken des Umschlags", () => {
    const packed = `=?base64?${Buffer.from("read_faecher", "utf8").toString("base64")}?=`;

    assert.equal(
      checkHeaders(call, headers({ ...good, "Mcp-Name": packed }), "modern"),
      null,
    );
  });

  it("verlangt im alten Zeitalter keine Kopfzeile", () => {
    const alt = message({ method: "tools/call", params: { name: "read_faecher" } });

    assert.equal(checkHeaders(alt, headers({}), "legacy"), null);
  });

  it("vergleicht im alten Zeitalter aber jede Kopfzeile, die da ist", () => {
    // Sonst ließe sich die Prüfung abwählen, indem man das _meta weglässt:
    // Kopf sagt tools/list, Rumpf ruft ein propose_* auf.
    const alt = message({
      method: "tools/call",
      params: { name: "propose_klausur" },
    });

    const abweichend: Record<string, string>[] = [
      { "Mcp-Method": "tools/list" },
      { "Mcp-Name": "read_faecher" },
    ];

    for (const entries of abweichend) {
      const rejection = checkHeaders(alt, headers(entries), "legacy");

      assert.equal(
        rejection?.code,
        ERROR.HEADER_MISMATCH,
        JSON.stringify(entries),
      );
    }
  });

  it("verlangt im neuen Zeitalter die Version im _meta", () => {
    // Wer die moderne Revision im Kopf nennt, wird daran gemessen — auch dann,
    // wenn er das _meta weggelassen hat.
    const ohneMeta = message({
      method: "tools/call",
      params: { name: "read_faecher" },
    });

    const rejection = checkHeaders(ohneMeta, headers(good), "modern");

    assert.equal(rejection?.code, ERROR.HEADER_MISMATCH);
  });
});

describe("result", () => {
  it("packt ein modernes Ergebnis mit resultType und serverInfo", () => {
    const envelope = result(1, "modern", { tools: [] });
    const payload = envelope.result as Record<string, unknown>;

    assert.equal(payload.resultType, "complete");
    assert.deepEqual(payload._meta, {
      "io.modelcontextprotocol/serverInfo": SERVER_INFO,
    });
  });

  it("lässt beides im alten Zeitalter weg", () => {
    // Ein Client von 2025 kennt weder resultType noch serverInfo im _meta —
    // beides stünde dort nur unnütz herum.
    const envelope = result(1, "legacy", { tools: [] });

    assert.deepEqual(envelope.result, { tools: [] });
  });

  it("trägt die id der Anfrage", () => {
    assert.equal(result("abc", "modern", {}).id, "abc");
    assert.equal(result(null, "legacy", {}).id, null);
  });
});

describe("cacheHints", () => {
  it("gibt einer modernen Liste eine Frist und einen privaten Bereich", () => {
    const hints = cacheHints("modern");

    assert.equal(typeof hints.ttlMs, "number");
    assert.ok((hints.ttlMs as number) >= 0);
    // "public" erlaubte dem Client, dieselbe Antwort in einem anderen
    // Berechtigungszusammenhang wiederzuverwenden.
    assert.equal(hints.cacheScope, "private");
  });

  it("lässt im alten Zeitalter beides weg", () => {
    // Beide Felder gibt es erst seit 2026-07-28.
    assert.deepEqual(cacheHints("legacy"), {});
  });
});

describe("errorEnvelope", () => {
  it("baut einen JSON-RPC-Fehler", () => {
    const envelope = errorEnvelope(3, {
      status: 404,
      code: ERROR.METHOD_NOT_FOUND,
      message: "gibt es nicht",
    });

    assert.deepEqual(envelope, {
      jsonrpc: "2.0",
      id: 3,
      error: { code: ERROR.METHOD_NOT_FOUND, message: "gibt es nicht" },
    });
  });

  it("hängt data nur an, wenn es welche gibt", () => {
    const mit = errorEnvelope(1, unsupportedVersion("x"));

    assert.ok((mit.error as Record<string, unknown>).data);
  });
});

describe("checkOrigin", () => {
  const origin = "https://schule.example";

  it("lässt eine Anfrage ohne Origin durch", () => {
    // Ein MCP-Client ist kein Browser und schickt keinen. Ein fehlender
    // Origin ist deshalb ausdrücklich kein Ablehnungsgrund.
    assert.equal(checkOrigin(headers({}), origin), true);
  });

  it("lässt den eigenen Ursprung durch", () => {
    assert.equal(checkOrigin(headers({ Origin: origin }), origin), true);
  });

  it("weist einen fremden Ursprung ab", () => {
    for (const fremd of [
      "https://boese.example",
      "http://schule.example",
      "https://schule.example.boese.example",
      "null",
    ]) {
      assert.equal(checkOrigin(headers({ Origin: fremd }), origin), false, fremd);
    }
  });
});
