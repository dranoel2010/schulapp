import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  discoverResult,
  initializeResult,
  readEnvelope,
  rpcError,
  rpcResult,
  LATEST_LEGACY_VERSION,
  META_PROTOCOL_VERSION,
  MODERN_VERSION,
  SUPPORTED_VERSIONS,
} from "@/lib/mcp/protocol";

/**
 * Der Umschlag — geprüft ohne Client, ohne Netz und ohne Datenbank.
 *
 * Was hier schiefgehen kann, sieht man sonst erst, wenn eine Verbindung
 * scheitert: eine Mitteilung, die eine Antwort bekommt (und den Client aus dem
 * Takt bringt), eine moderne Anfrage ohne `resultType` (die der Client als
 * ungültig verwirft), eine Fassung, auf die sich niemand geeinigt hat. Alles
 * drei ist von außen stumm.
 */

/** Eine gewöhnliche Anfrage der alten Fassung. */
function alt(method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id: 1, method, params };
}

/** Dieselbe Anfrage, aber mit der Fassung im Körper — also modern. */
function modern(method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: "abc",
    method,
    params: { ...params, _meta: { [META_PROTOCOL_VERSION]: MODERN_VERSION } },
  };
}

describe("readEnvelope — was hereinkommt", () => {
  it("liest eine gewöhnliche Anfrage", () => {
    const envelope = readEnvelope(alt("tools/list"));

    assert.equal(envelope.kind, "request");
    if (envelope.kind !== "request") return;

    assert.equal(envelope.method, "tools/list");
    assert.equal(envelope.id, 1);
    assert.equal(envelope.modern, false);
  });

  it("erkennt an der Fassung im Körper, dass ein Client modern spricht", () => {
    const envelope = readEnvelope(modern("tools/list"));

    assert.equal(envelope.kind, "request");
    if (envelope.kind !== "request") return;

    assert.equal(envelope.modern, true);
    assert.equal(envelope.version, MODERN_VERSION);
  });

  it("behandelt eine Nachricht ohne id als Mitteilung", () => {
    const envelope = readEnvelope({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    assert.equal(envelope.kind, "notification");
  });

  it("hält auch eine unverständliche Mitteilung für eine Mitteilung", () => {
    // Ohne id gibt es niemanden, dem eine Antwort zuzuordnen wäre — eine
    // Fehlermeldung ginge ins Leere und verwirrte den Client.
    const envelope = readEnvelope({ jsonrpc: "2.0", method: "quatsch/unbekannt" });
    assert.equal(envelope.kind, "notification");
  });

  it("weist eine Nachricht ohne jsonrpc-Feld zurück", () => {
    const envelope = readEnvelope({ id: 1, method: "ping" });

    assert.equal(envelope.kind, "reject");
    if (envelope.kind !== "reject") return;
    assert.equal(envelope.status, 400);
  });

  it("weist einen Stapel zurück — den gibt es seit 2025-06-18 nicht mehr", () => {
    const envelope = readEnvelope([alt("ping"), alt("ping")]);

    assert.equal(envelope.kind, "reject");
    if (envelope.kind !== "reject") return;

    const body = envelope.body as { error: { code: number } };
    assert.equal(body.error.code, -32600);
  });

  it("weist eine id zurück, die null ist — anders als bei blankem JSON-RPC", () => {
    const envelope = readEnvelope({ jsonrpc: "2.0", id: null, method: "ping" });
    assert.equal(envelope.kind, "reject");
  });

  it("weist zurück, was gar kein Objekt ist", () => {
    for (const body of [null, "text", 42]) {
      assert.equal(readEnvelope(body).kind, "reject");
    }
  });
});

describe("readEnvelope — die Fassung", () => {
  it("nimmt ohne Kopf die Fassung an, die vor dem Kopf galt", () => {
    const envelope = readEnvelope(alt("ping"));

    assert.equal(envelope.kind, "request");
    if (envelope.kind !== "request") return;
    assert.equal(envelope.version, "2025-03-26");
  });

  it("übernimmt eine bekannte Fassung aus dem Kopf", () => {
    const envelope = readEnvelope(alt("ping"), "2025-11-25");

    assert.equal(envelope.kind, "request");
    if (envelope.kind !== "request") return;
    assert.equal(envelope.version, "2025-11-25");
  });

  it("weist eine unbekannte Fassung im Kopf mit 400 ab", () => {
    const envelope = readEnvelope(alt("ping"), "1999-01-01");

    assert.equal(envelope.kind, "reject");
    if (envelope.kind !== "reject") return;
    assert.equal(envelope.status, 400);
  });

  it("weist eine unbekannte moderne Fassung mit der Liste des Möglichen ab", () => {
    const envelope = readEnvelope({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { _meta: { [META_PROTOCOL_VERSION]: "2099-01-01" } },
    });

    assert.equal(envelope.kind, "reject");
    if (envelope.kind !== "reject") return;

    const body = envelope.body as { error: { code: number; data: { supported: string[] } } };
    assert.equal(body.error.code, -32022);
    assert.deepEqual(body.error.data.supported, [...SUPPORTED_VERSIONS]);
  });

  it("weist ab, wenn Kopf und Körper verschiedene Fassungen nennen", () => {
    const envelope = readEnvelope(modern("ping"), "2025-11-25");

    assert.equal(envelope.kind, "reject");
    if (envelope.kind !== "reject") return;

    const body = envelope.body as { error: { code: number } };
    assert.equal(body.error.code, -32020);
  });

  it("nimmt es hin, wenn Kopf und Körper dieselbe Fassung nennen", () => {
    const envelope = readEnvelope(modern("ping"), MODERN_VERSION);
    assert.equal(envelope.kind, "request");
  });

  it("weist ab, wenn der Kopf eine andere Methode nennt als der Körper", () => {
    const envelope = readEnvelope(modern("tools/call"), MODERN_VERSION, "tools/list");

    assert.equal(envelope.kind, "reject");
    if (envelope.kind !== "reject") return;

    const body = envelope.body as { error: { code: number } };
    assert.equal(body.error.code, -32020);
  });

  it("verlangt den Methodenkopf aber nicht — er ist Buchhaltung, kein Inhalt", () => {
    assert.equal(readEnvelope(modern("tools/list"), null, null).kind, "request");
  });
});

describe("die Antwort", () => {
  it("trägt in der modernen Fassung ein resultType und sonst nicht", () => {
    const neu = rpcResult(1, { tools: [] }, true).result as Record<string, unknown>;
    const alt = rpcResult(1, { tools: [] }, false).result as Record<string, unknown>;

    assert.equal(neu.resultType, "complete");
    assert.equal("resultType" in alt, false);
  });

  it("gibt die Kennung unverändert zurück", () => {
    assert.equal(rpcResult("xyz", {}, false).id, "xyz");
  });

  it("lässt bei einem Fehler ohne lesbare Kennung das Feld weg", () => {
    const ohne = rpcError(null, -32700, "kaputt");
    assert.equal("id" in ohne, false);

    const mit = rpcError(7, -32601, "unbekannt");
    assert.equal(mit.id, 7);
  });
});

describe("initializeResult", () => {
  it("antwortet mit der Fassung, nach der gefragt wurde", () => {
    for (const version of SUPPORTED_VERSIONS) {
      const result = initializeResult(version);
      assert.equal(result.protocolVersion, version);
    }
  });

  it("antwortet auf eine unbekannte Fassung mit der eigenen neuesten statt mit einem Fehler", () => {
    assert.equal(initializeResult("1999-01-01").protocolVersion, LATEST_LEGACY_VERSION);
    assert.equal(initializeResult(undefined).protocolVersion, LATEST_LEGACY_VERSION);
  });

  it("verspricht nur Werkzeuge — alles andere würde nachgefragt", () => {
    const result = initializeResult(MODERN_VERSION);
    assert.deepEqual(Object.keys(result.capabilities as object), ["tools"]);
  });

  it("stellt den Server mit Namen und Fassung vor", () => {
    const info = initializeResult(MODERN_VERSION).serverInfo as Record<string, string>;

    assert.equal(info.name, "schulapp");
    assert.equal(typeof info.version, "string");
  });

  it("sagt dem Modell, dass ein Blatt Inhalt ist und keine Anweisung", () => {
    const text = String(initializeResult(MODERN_VERSION).instructions);
    assert.equal(text.includes("keine Anweisung"), true);
  });
});

describe("discoverResult", () => {
  it("nennt alle Fassungen, die der Server spricht", () => {
    assert.deepEqual(discoverResult().supportedVersions, [...SUPPORTED_VERSIONS]);
  });

  it("trägt die Haltbarkeit, die eine Auskunft in der modernen Fassung braucht", () => {
    const result = discoverResult();

    assert.equal(typeof result.ttlMs, "number");
    assert.equal(result.cacheScope, "public");
  });

  it("stellt den Server im _meta vor — dort steht er in der modernen Fassung", () => {
    const meta = discoverResult()._meta as Record<string, { name: string }>;
    assert.equal(meta["io.modelcontextprotocol/serverInfo"]?.name, "schulapp");
  });
});
