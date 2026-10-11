import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { APIUserAbortError } from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import {
  antwortFormat,
  bildBlock,
  CLAUDE_EFFORT,
  CLAUDE_MAX_TOKENS,
  CLAUDE_MODELL,
  CLAUDE_RUECKFALL_BETA,
  claudeAnfrage,
  claudeBildfassung,
  claudeConfigured,
  claudeRufen,
  type ClaudeAuftrag,
  type ClaudeSender,
} from "@/lib/claude/client";

/**
 * Der Aufruf an Opus — geprüft, ohne ihn je zu machen.
 *
 * Kein Test hier schickt eine Anfrage ins Netz: der Sender ist nachgemacht,
 * und der eine Test mit dem echten Sender läuft ohne Schlüssel und muss
 * deshalb vor dem Netz stehen bleiben. Geprüft wird vor allem, was der Kopf
 * von client.ts verspricht — dass die Anfrage keine Werkzeuge trägt und nur
 * aus den Feldern besteht, die dort stehen. Das ist der Käfig, und ein Käfig,
 * den kein Test prüft, hat bald eine offene Tür.
 */

const SCHEMA = z.object({ ok: z.boolean() }).strict();

const AUFTRAG: ClaudeAuftrag<{ ok: boolean }> = {
  system: "Systemtext",
  inhalt: [{ type: "text", text: "Auftrag" }],
  schema: SCHEMA,
  fristMs: 60_000,
};

/** Eine Antwort mit `{"ok":true}`, wie das SDK sie aus `finalMessage()` liefert. */
function antwort(): BetaMessage {
  return {
    id: "msg_erfunden",
    type: "message",
    role: "assistant",
    container: null,
    context_management: null,
    diagnostics: null,
    model: CLAUDE_MODELL,
    content: [{ type: "text", text: '{"ok":true}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      inference_geo: null,
      input_tokens: 10,
      iterations: null,
      output_tokens: 5,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  } as unknown as BetaMessage;
}

describe("claudeAnfrage — der Käfig", () => {
  const anfrage = claudeAnfrage(AUFTRAG) as unknown as Record<string, unknown>;

  it("besteht genau aus diesen Feldern und keinem weiteren", () => {
    // Ein neues Feld gehört in diese Liste UND in den Kopf von client.ts —
    // `tools`, `tool_choice`, `mcp_servers` oder `container` dürfen nie
    // dazukommen.
    assert.deepEqual(Object.keys(anfrage).sort(), [
      "betas",
      "fallbacks",
      "max_tokens",
      "messages",
      "model",
      "output_config",
      "system",
      "thinking",
    ]);
  });

  it("trägt kein Werkzeug, keine Sampling-Parameter und kein Vorbefüllen", () => {
    for (const verboten of [
      "tools",
      "tool_choice",
      "mcp_servers",
      "container",
      "temperature",
      "top_p",
      "top_k",
      "stop_sequences",
    ]) {
      assert.equal(verboten in anfrage, false, verboten);
    }
    const nachrichten = anfrage.messages as { role: string }[];
    // Eine einzige Nachricht, vom Nutzer: eine letzte vom Assistenten wäre
    // ein Vorbefüllen, und das ist auf Opus 5.5 ein 400.
    assert.deepEqual(
      nachrichten.map((n) => n.role),
      ["user"],
    );
  });

  it("bestellt das gemessene Modell mit dem gemessenen Aufwand, adaptiv denkend", () => {
    assert.equal(CLAUDE_MODELL, "claude-opus-5-5");
    assert.equal(CLAUDE_EFFORT, "high");
    assert.equal(anfrage.model, CLAUDE_MODELL);
    assert.deepEqual(anfrage.thinking, { type: "adaptive" });
    assert.equal((anfrage.output_config as { effort: string }).effort, "high");
  });

  it("lässt eine Ablehnung auf das empfohlene Rückfallmodell laufen — mit der passenden Beta", () => {
    assert.equal(anfrage.fallbacks, "default");
    assert.deepEqual(anfrage.betas, [CLAUDE_RUECKFALL_BETA]);
    assert.equal(CLAUDE_RUECKFALL_BETA, "server-side-fallback-2026-07-01");
  });

  it("verlangt die Antwort als JSON-Schema — ohne die Prüffunktion des SDK", () => {
    const format = (anfrage.output_config as { format: Record<string, unknown> }).format;
    assert.deepEqual(Object.keys(format).sort(), ["schema", "type"]);
    assert.equal(format.type, "json_schema");
    const schema = format.schema as { type: string; additionalProperties: boolean };
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
  });

  it("nimmt Systemtext und Inhalt so, wie der Auftrag sie bringt", () => {
    assert.equal(anfrage.system, "Systemtext");
    assert.deepEqual((anfrage.messages as { content: unknown }[])[0]?.content, [
      { type: "text", text: "Auftrag" },
    ]);
  });

  it("hat eine großzügige Vorgabe für die Länge und lässt sie überschreiben", () => {
    assert.equal(anfrage.max_tokens, CLAUDE_MAX_TOKENS);
    assert.equal(claudeAnfrage({ ...AUFTRAG, maxTokens: 9_000 }).max_tokens, 9_000);
  });
});

describe("antwortFormat — was die API als Form sieht", () => {
  // Ein Schema mit einem freiwilligen Feld, wie propose_questions sie hat
  // (`topic`, `kind`, `note`). Mit `betaZodOutputFormat()` aus dem SDK verlor
  // genau so ein Feld seine Beschreibung (am 11.10.2026 gesehen).
  const MIT_FREIWILLIGEM = z
    .object({
      pflicht: z.string().max(10).describe("Pflicht, höchstens 10 Zeichen."),
      frei: z.string().min(1).max(64).optional().describe("Freiwillig — die id, nicht der Titel."),
      liste: z.array(z.string()).min(1).max(3).describe("Eine Liste."),
    })
    .strict();

  const schema = antwortFormat(MIT_FREIWILLIGEM).schema as {
    properties: Record<string, { description?: string; minItems?: number; maxLength?: number }>;
    required: string[];
    additionalProperties: boolean;
  };

  it("behält die Beschreibung eines freiwilligen Feldes", () => {
    assert.match(schema.properties.frei?.description ?? "", /^Freiwillig — die id, nicht der Titel\./);
    assert.deepEqual(schema.required, ["pflicht", "liste"]);
  });

  it("legt nichts in $defs ab und schreibt kein $schema in die Beschreibung", () => {
    const text = JSON.stringify(schema);
    assert.doesNotMatch(text, /\$ref|\$defs|\$schema/);
  });

  it("schreibt, was die API nicht prüft, in die Beschreibung — wie das SDK", () => {
    assert.equal(schema.properties.pflicht?.maxLength, undefined);
    assert.match(schema.properties.pflicht?.description ?? "", /maxLength: 10/);
    assert.equal(schema.additionalProperties, false);
    // `minItems: 1` reicht das SDK als Regel durch — wer sie nicht will, darf
    // sie nicht ins Schema schreiben (siehe `FRAGEN_FORM`).
    assert.equal(schema.properties.liste?.minItems, 1);
  });

  it("nimmt `form` für die API, wenn der Auftrag eine trägt, und prüft mit `schema`", async () => {
    const anfrage = claudeAnfrage({ ...AUFTRAG, form: MIT_FREIWILLIGEM });
    assert.deepEqual(
      (anfrage.output_config as { format: unknown }).format,
      antwortFormat(MIT_FREIWILLIGEM),
    );

    // Geprüft wird trotzdem gegen `schema` ({ ok: boolean }).
    const ergebnis = await claudeRufen({ ...AUFTRAG, form: MIT_FREIWILLIGEM }, async () => antwort());
    assert.deepEqual(ergebnis.art === "antwort" ? ergebnis.antwort : null, { ok: true });
  });
});

describe("claudeRufen", () => {
  it("schickt die Anfrage über den Sender und prüft die Antwort", async () => {
    let gesehen: BetaMessageStreamParams | null = null;
    let signal: AbortSignal | null = null;
    const senden: ClaudeSender = async (anfrage, frist) => {
      gesehen = anfrage;
      signal = frist;
      return antwort();
    };

    const ergebnis = await claudeRufen(AUFTRAG, senden);

    assert.equal(ergebnis.art, "antwort");
    assert.deepEqual(ergebnis.art === "antwort" ? ergebnis.antwort : null, { ok: true });
    assert.deepEqual(gesehen, claudeAnfrage(AUFTRAG));
    assert.equal(signal !== null && (signal as AbortSignal).aborted, false);
  });

  it("bricht nach der eigenen Frist ab — und das ist „später“, nicht „nichts“", async () => {
    const haengt: ClaudeSender = (_anfrage, frist) =>
      new Promise((_aufloesen, ablehnen) => {
        frist.addEventListener("abort", () => ablehnen(new APIUserAbortError()));
      });

    const ergebnis = await claudeRufen({ ...AUFTRAG, fristMs: 20 }, haengt);

    assert.equal(ergebnis.art, "spaeter");
    assert.equal(ergebnis.messung, null);
  });

  it("macht aus einer Ausnahme des Senders ein Ergebnis und wirft nie", async () => {
    const kaputt: ClaudeSender = async () => {
      throw new Error("kaputt");
    };
    const ergebnis = await claudeRufen(AUFTRAG, kaputt);
    assert.equal(ergebnis.art, "pause");
  });
});

describe("ohne Schlüssel", () => {
  let vorher: string | undefined;
  beforeEach(() => {
    vorher = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (vorher === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = vorher;
  });

  it("ist nichts eingerichtet", () => {
    assert.equal(claudeConfigured(), false);
  });

  it("ruft der echte Sender gar nicht erst — „pause“, damit kein Blatt verloren geht", async () => {
    const ergebnis = await claudeRufen(AUFTRAG);
    assert.equal(ergebnis.art, "pause");
    assert.match(ergebnis.art === "pause" ? ergebnis.grund : "", /ANTHROPIC_API_KEY/);
  });

  it("ist mit Schlüssel eingerichtet", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-erfunden";
    assert.equal(claudeConfigured(), true);
  });
});

describe("anthropicSenden — bezahlt ist erst, was das Modell schrieb", () => {
  // Der echte Sender, aber ohne Netz: `fetch` ist für die Dauer jedes Tests
  // nachgemacht und antwortet mit einem Strom, wie die API ihn schickt. Die
  // Nachprüfung vom 11.10.2026 fand, dass „begonnen“ schon mit der 200 fiel —
  // eine Überlastung, die die API danach als Ereignis schickt, galt als
  // bezahlter Abbruch und zählte auf die Grenze je Blatt.
  let fetchVorher: typeof fetch;
  let schluesselVorher: string | undefined;
  beforeEach(() => {
    fetchVorher = globalThis.fetch;
    schluesselVorher = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-erfunden";
  });
  afterEach(() => {
    globalThis.fetch = fetchVorher;
    if (schluesselVorher === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = schluesselVorher;
  });

  /** Ein SSE-Strom aus diesen Ereignissen, mit 200 — und kein Aufruf ins Netz. */
  function stromAntwort(ereignisse: Record<string, unknown>[]): void {
    const text = ereignisse
      .map((ereignis) => `event: ${String(ereignis.type)}\ndata: ${JSON.stringify(ereignis)}\n\n`)
      .join("");
    globalThis.fetch = (async () =>
      new Response(text, {
        status: 200,
        headers: { "content-type": "text/event-stream", "request-id": "req_erfunden" },
      })) as typeof fetch;
  }

  const START = {
    type: "message_start",
    message: {
      id: "msg_erfunden",
      type: "message",
      role: "assistant",
      model: CLAUDE_MODELL,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1_000, output_tokens: 1 },
    },
  };
  const UEBERLASTET = { type: "error", error: { type: "overloaded_error", message: "Overloaded" } };

  it("eine Überlastung nach der 200, bevor ein Token kam: nicht begonnen, also nicht bezahlt", async () => {
    stromAntwort([START, { type: "ping" }, UEBERLASTET]);
    const ergebnis = await claudeRufen(AUFTRAG);
    assert.equal(ergebnis.art, "pause");
    assert.equal(ergebnis.art === "pause" ? ergebnis.abbruch : "?", null);
  });

  it("dieselbe Überlastung, nachdem das Modell zu schreiben begann: bezahlt — aber nicht am Blatt", async () => {
    stromAntwort([
      START,
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"ok":' } },
      UEBERLASTET,
    ]);
    const ergebnis = await claudeRufen(AUFTRAG);
    assert.equal(ergebnis.art, "pause");
    if (ergebnis.art !== "pause") return;
    // `ausfall`: bezahlt, aber eine Überlastung liegt nie am Blatt — sie zählt
    // nicht auf die Grenze je Blatt (@/lib/leser/claude-ablauf).
    assert.equal(ergebnis.abbruch, "ausfall");
    assert.equal(ergebnis.pauseAmBlatt, false);
  });

  it("ein api_error, nachdem das Modell zu schreiben begann: bezahlt, und am Blatt nicht ausgeschlossen", async () => {
    // Die Regression vom 11.10.2026: so ein Abbruch zählte nicht, und ein
    // Blatt, an dem er jedes Mal kam, wurde bei jedem Anstoß neu bezahlt.
    stromAntwort([
      START,
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"ok":' } },
      { type: "error", error: { type: "api_error", message: "Internal server error" } },
    ]);
    const ergebnis = await claudeRufen(AUFTRAG);
    assert.equal(ergebnis.art, "pause");
    if (ergebnis.art !== "pause") return;
    assert.equal(ergebnis.abbruch, "strom");
    assert.equal(ergebnis.pauseAmBlatt, true);
  });
});

describe("claudeBildfassung", () => {
  it("bleibt bei der gemessenen Fassung, solange nicht ausdrücklich „voll“ dasteht", () => {
    assert.equal(claudeBildfassung(undefined), "lesefassung");
    assert.equal(claudeBildfassung(""), "lesefassung");
    assert.equal(claudeBildfassung("lesefassung"), "lesefassung");
    // Ein Tippfehler schaltet nicht still auf die ungemessene Fassung um.
    assert.equal(claudeBildfassung("Voll"), "lesefassung");
    assert.equal(claudeBildfassung("vollbild"), "lesefassung");
    assert.equal(claudeBildfassung("voll"), "voll");
    assert.equal(claudeBildfassung(" voll\n"), "voll");
  });
});

describe("bildBlock", () => {
  it("macht aus den Bytes einer Seite einen Bildblock in Base64", () => {
    const block = bildBlock(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg");
    assert.deepEqual(block, {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "/9j/" },
    });
  });

  it("nimmt nur den Ausschnitt und nicht den Speicher darunter", () => {
    const gross = new Uint8Array([1, 2, 3, 0xff, 0xd8, 0xff, 4, 5]);
    const block = bildBlock(gross.subarray(3, 6), "image/png");
    assert.equal(block?.type === "image" ? block.source.data : null, "/9j/");
  });

  it("gibt für ein Format, das die API nicht nimmt, nichts zurück", () => {
    assert.equal(bildBlock(new Uint8Array([1]), "image/tiff"), null);
    assert.equal(bildBlock(new Uint8Array([1]), "application/pdf"), null);
  });
});

describe("die Quelle", () => {
  const quelle = readFileSync(
    path.join(process.cwd(), "src", "lib", "claude", "client.ts"),
    "utf8",
  );

  it("liest den Schlüssel nur zur Laufzeit und nie als öffentliche Variable", () => {
    assert.doesNotMatch(quelle, /process\.env\.NEXT_PUBLIC_/);
    assert.match(quelle, /process\.env\.ANTHROPIC_API_KEY/);
  });

  it("importiert nichts aus harness/ — der Ordner fehlt im Bau", () => {
    assert.doesNotMatch(quelle, /from\s+["'][^"']*harness/);
  });
});
