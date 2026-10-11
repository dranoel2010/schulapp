import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import {
  antwortEinordnen,
  antwortText,
  auswerten,
  dollar,
  fehlerEinordnen,
  messungAus,
  messungZeile,
  ohneNullzeichen,
  preisFuer,
} from "@/lib/claude/ergebnis";

/**
 * Was aus einem Aufruf wird — jeder Ausgang einmal, ohne Netz und ohne Geld.
 *
 * Die Fälle sind die, an denen der Postbote gelernt hat: ein Schlüsselfehler,
 * der als „nichts“ gemerkt wurde (4.10.2026), ein Inhaltsfilter, der das Blatt
 * für immer liegen ließ, eine abgeschnittene Antwort. Hier stehen sie als
 * Tabelle, damit jede neue Fehlerart eine Zeile bekommt und keine still in
 * den falschen Ausgang rutscht.
 */

const ANGEFRAGT = "claude-opus-5-5";

/** Eine Fehlerantwort der API, wie das SDK sie aus Status und Körper baut. */
function apiFehler(status: number, typ: string, meldung = `erfunden: ${typ}`): APIError {
  return APIError.generate(
    status,
    { type: "error", error: { type: typ, message: meldung } },
    undefined,
    new Headers(),
  );
}

/** Ein Fehler mitten im Strom: ohne Status, nur mit `type`. */
function stromFehler(typ: string): APIError {
  return new APIError(
    undefined,
    { type: "error", error: { type: typ, message: "mitten im Strom" } },
    undefined,
    new Headers(),
    typ as APIError["type"],
  );
}

/** Eine Antwort mit allem, was der Typ verlangt — das Übrige setzt der Test. */
function nachricht(
  teil: {
    content?: unknown[];
    stop_reason?: string | null;
    stop_details?: { category: string | null; recommended_model?: string | null } | null;
    model?: string;
    usage?: Partial<BetaUsage>;
  } = {},
): BetaMessage {
  return {
    id: "msg_erfunden",
    type: "message",
    role: "assistant",
    container: null,
    context_management: null,
    diagnostics: null,
    model: teil.model ?? ANGEFRAGT,
    content: (teil.content ?? [text(JSON.stringify({ ok: true }))]) as BetaContentBlock[],
    stop_reason: (teil.stop_reason === undefined ? "end_turn" : teil.stop_reason) as BetaMessage["stop_reason"],
    stop_sequence: null,
    stop_details: (teil.stop_details ?? null) as BetaMessage["stop_details"],
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      inference_geo: null,
      input_tokens: 1_000,
      iterations: null,
      output_tokens: 500,
      output_tokens_details: { thinking_tokens: 200 },
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
      ...teil.usage,
    } as BetaUsage,
  } as unknown as BetaMessage;
}

function text(inhalt: string) {
  return { type: "text", text: inhalt, citations: null };
}

function rueckfallBlock(von: string, nach: string) {
  return {
    type: "fallback",
    from: { model: von },
    to: { model: nach },
    trigger: { type: "refusal", category: "bio" },
  };
}

const SCHEMA = z.object({ ok: z.boolean() }).strict();

describe("fehlerEinordnen", () => {
  const faelle: [string, unknown, "pause" | "spaeter" | "nichts"][] = [
    ["keine Verbindung", new APIConnectionError({ message: "fetch failed" }), "pause"],
    ["Zeitüberschreitung beim Verbinden", new APIConnectionTimeoutError(), "spaeter"],
    ["abgebrochen, ohne dass die Frist ablief", new APIUserAbortError(), "spaeter"],
    ["401 Schlüssel falsch", apiFehler(401, "authentication_error"), "pause"],
    ["403 kein Recht", apiFehler(403, "permission_error"), "pause"],
    ["402 Abrechnung", apiFehler(402, "billing_error"), "pause"],
    ["400 mit Abrechnungsfehler", apiFehler(400, "billing_error"), "pause"],
    ["404 Modell nicht verfügbar", apiFehler(404, "not_found_error"), "pause"],
    ["429 Grenze", apiFehler(429, "rate_limit_error"), "pause"],
    ["500 gestört", apiFehler(500, "api_error"), "pause"],
    ["529 überlastet", apiFehler(529, "overloaded_error"), "pause"],
    // Ein 400 ist nicht sicher eine Eigenschaft des Blattes: nicht merken.
    ["400 ungültige Anfrage", apiFehler(400, "invalid_request_error"), "spaeter"],
    // So meldete die API ein leeres Guthaben — das trifft jedes Blatt.
    [
      "400 Guthaben zu niedrig",
      apiFehler(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
      "pause",
    ],
    [
      "400 Ausgabelimit erreicht",
      apiFehler(400, "invalid_request_error", "You have reached your specified workspace API usage limits."),
      "pause",
    ],
    ["413 zu groß", apiFehler(413, "request_too_large"), "nichts"],
    ["422 nicht zu verarbeiten", apiFehler(422, "invalid_request_error"), "nichts"],
    ["409, den niemand erwartet", apiFehler(409, "conflict_error"), "spaeter"],
    ["mitten im Strom überlastet", stromFehler("overloaded_error"), "pause"],
    ["mitten im Strom API-Fehler", stromFehler("api_error"), "pause"],
    ["mitten im Strom Grenze", stromFehler("rate_limit_error"), "pause"],
    ["mitten im Strom ungültig", stromFehler("invalid_request_error"), "spaeter"],
    ["mitten im Strom Zeitüberschreitung", stromFehler("timeout_error"), "spaeter"],
    ["Strom abgerissen", new AnthropicError("terminated"), "pause"],
    ["etwas ganz anderes", new TypeError("x is undefined"), "pause"],
  ];

  for (const [name, fehler, erwartet] of faelle) {
    it(`${name} → ${erwartet}`, () => {
      const ergebnis = fehlerEinordnen(fehler, false);
      assert.equal(ergebnis.art, erwartet, ergebnis.grund);
      assert.equal(ergebnis.grund.length > 0, true);
    });
  }

  it("macht aus der eigenen Frist immer „später“ — gleich, wie das SDK den Abbruch meldet", () => {
    for (const fehler of [new APIUserAbortError(), apiFehler(429, "rate_limit_error"), new Error("x")]) {
      assert.equal(fehlerEinordnen(fehler, true).art, "spaeter");
    }
  });

  it("nennt einen Abbruch nur bezahlt, wenn der Strom schon begonnen hatte", () => {
    // Die Abnahme vom 11.10.2026: ein 400 vor dem Strom — eine abgelöste
    // Beta-Kennung — kostet nichts und darf kein Blatt stilllegen.
    const vierhundert = apiFehler(400, "invalid_request_error", "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header.");
    assert.deepEqual(
      { ...fehlerEinordnen(vierhundert, false, false), grund: "" },
      { art: "spaeter", grund: "", abbruch: null, pauseAmBlatt: false },
    );
    // Die eigene Frist, nachdem der Strom begann: bezahlt.
    assert.equal(fehlerEinordnen(new APIUserAbortError(), true, true).abbruch, "frist");
    // Die Frist lief ab, ohne dass die API je antwortete: nichts bezahlt.
    assert.equal(fehlerEinordnen(new APIUserAbortError(), true, false).abbruch, null);
    // Mitten im Strom abgerissen: bezahlt, und eine Pause.
    const abgerissen = fehlerEinordnen(new AnthropicError("terminated"), false, true);
    assert.deepEqual([abgerissen.art, abgerissen.abbruch], ["pause", "strom"]);
    // Ein 429 vor dem Strom: eine Pause, die nichts kostet.
    assert.equal(fehlerEinordnen(apiFehler(429, "rate_limit_error"), false, false).abbruch, null);
    // Ein „nichts“ ist gemerkt und nie ein Abbruch.
    assert.equal(fehlerEinordnen(apiFehler(413, "request_too_large"), false, true).abbruch, null);
  });

  it("trennt bezahlte Abbrüche, die am Blatt liegen können (strom), von einem Ausfall der API (ausfall)", () => {
    // Die Regression vom 11.10.2026: ein Strom, der an einem Blatt jedes Mal
    // abreißt, nachdem das Modell schrieb, zählte nicht auf die Grenze — und
    // wurde bei jedem Anstoß neu bezahlt. Jetzt zählt `strom`, `ausfall` nie.
    const amBlattMoeglich: [string, unknown, string][] = [
      ["api_error im Strom", stromFehler("api_error"), "pause"],
      ["400 im Strom", stromFehler("invalid_request_error"), "spaeter"],
      ["Zeitüberschreitung im Strom", stromFehler("timeout_error"), "spaeter"],
      ["Strom abgerissen (das SDK verpackt es)", new AnthropicError("terminated"), "pause"],
      ["Strom abgerissen, roh", new TypeError("terminated"), "pause"],
    ];
    for (const [name, fehler, art] of amBlattMoeglich) {
      const e = fehlerEinordnen(fehler, false, true);
      assert.deepEqual([e.art, e.abbruch], [art, "strom"], name);
    }

    const ausfall: string[] = [
      "overloaded_error",
      "rate_limit_error",
      "billing_error",
      "authentication_error",
      "permission_error",
      "not_found_error",
    ];
    for (const typ of ausfall) {
      const e = fehlerEinordnen(stromFehler(typ), false, true);
      assert.deepEqual([e.art, e.abbruch], ["pause", "ausfall"], typ);
    }

    // Was einen Status trägt oder gar keine Verbindung bekam, kam vor dem
    // Inhalt — auch wenn `begonnen` gesetzt wäre: nie bezahlt.
    for (const fehler of [
      apiFehler(500, "api_error"),
      apiFehler(529, "overloaded_error"),
      apiFehler(400, "invalid_request_error"),
      apiFehler(402, "billing_error"),
      new APIConnectionError({ message: "getaddrinfo ENOTFOUND" }),
    ]) {
      assert.equal(fehlerEinordnen(fehler, false, true).abbruch, null, String(fehler));
    }
    // Dieselben Fehler mitten im Strom, bevor ein Inhalt kam: nicht bezahlt.
    assert.equal(fehlerEinordnen(stromFehler("api_error"), false, false).abbruch, null);
    // Die eigene Frist geht vor der Art: bezahlt ist bezahlt.
    assert.equal(fehlerEinordnen(stromFehler("overloaded_error"), true, true).abbruch, "frist");
  });

  it("rechnet eine Pause nur dann dem Blatt zu, wenn sie an der Anfrage liegen kann", () => {
    // Die Nachprüfung vom 11.10.2026: Abrechnung, Schlüssel, Grenzen, Netz und
    // Last treffen jedes Blatt gleich — sie dürfen keines ruhen lassen.
    const nieAmBlatt: [string, unknown, boolean][] = [
      ["keine Verbindung", new APIConnectionError({ message: "getaddrinfo ENOTFOUND" }), false],
      ["keine Verbindung, nachdem es schrieb", new APIConnectionError({ message: "fetch failed" }), true],
      ["401", apiFehler(401, "authentication_error"), false],
      ["403", apiFehler(403, "permission_error"), false],
      ["402", apiFehler(402, "billing_error"), false],
      ["400 Abrechnung", apiFehler(400, "billing_error"), false],
      ["400 Guthaben", apiFehler(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."), false],
      ["404 Modell", apiFehler(404, "not_found_error"), false],
      ["429", apiFehler(429, "rate_limit_error"), false],
      ["503", apiFehler(503, "api_error"), false],
      ["529 überlastet", apiFehler(529, "overloaded_error"), false],
      ["im Strom überlastet", stromFehler("overloaded_error"), true],
      ["im Strom Grenze", stromFehler("rate_limit_error"), true],
      ["im Strom Abrechnung", stromFehler("billing_error"), true],
      ["Strom abgerissen, bevor es schrieb", new AnthropicError("terminated"), false],
    ];
    for (const [name, fehler, begonnen] of nieAmBlatt) {
      const e = fehlerEinordnen(fehler, false, begonnen);
      assert.equal(e.art, "pause", name);
      assert.equal(e.pauseAmBlatt, false, name);
    }

    const kannAmBlatt: [string, unknown, boolean][] = [
      ["500", apiFehler(500, "api_error"), false],
      ["502", apiFehler(502, "api_error"), false],
      ["im Strom API-Fehler", stromFehler("api_error"), true],
      ["Strom abgerissen, nachdem es schrieb", new AnthropicError("terminated"), true],
    ];
    for (const [name, fehler, begonnen] of kannAmBlatt) {
      const e = fehlerEinordnen(fehler, false, begonnen);
      assert.equal(e.art, "pause", name);
      assert.equal(e.pauseAmBlatt, true, name);
    }

    // Kein anderer Ausgang trägt die Frage.
    assert.equal(fehlerEinordnen(apiFehler(400, "invalid_request_error"), false, true).pauseAmBlatt, false);
    assert.equal(fehlerEinordnen(apiFehler(413, "request_too_large"), false, true).pauseAmBlatt, false);
  });

  it("macht aus keinem Schlüssel-, Konto- oder Verbindungsfehler je ein „nichts“", () => {
    // Die Lehre vom 4.10.2026: der Postbote merkte sich jedes Blatt eines
    // Ausfalls als erledigt. Ein „nichts“ hier hieße: nie wieder gelesen.
    for (const fehler of [
      apiFehler(401, "authentication_error"),
      apiFehler(403, "permission_error"),
      apiFehler(402, "billing_error"),
      apiFehler(429, "rate_limit_error"),
      apiFehler(529, "overloaded_error"),
      new APIConnectionError({ message: "getaddrinfo ENOTFOUND" }),
    ]) {
      assert.notEqual(fehlerEinordnen(fehler, false).art, "nichts");
    }
  });
});

describe("antwortEinordnen", () => {
  it("nimmt eine Antwort, die zur Form passt", () => {
    const ergebnis = antwortEinordnen(nachricht(), SCHEMA);
    assert.deepEqual(ergebnis, { art: "antwort", antwort: { ok: true } });
  });

  it("macht aus einer Ablehnung „nichts“ und nennt die Kategorie", () => {
    const ergebnis = antwortEinordnen(
      nachricht({ stop_reason: "refusal", stop_details: { category: "bio" }, content: [] }),
      SCHEMA,
    );
    assert.equal(ergebnis.art, "nichts");
    assert.match(ergebnis.art === "nichts" ? ergebnis.grund : "", /bio/);
  });

  it("macht eine Ablehnung, deren Rückfall gerade ausgelastet war, zu „später“ — nicht zu einem gemerkten „nichts“", () => {
    // SDK 0.128: `recommended_model` steht da, wenn der Rückfall nicht
    // versucht werden konnte (Grenze des Rückfallmodells, überlastet).
    const ausgelastet = antwortEinordnen(
      nachricht({
        stop_reason: "refusal",
        stop_details: { category: "bio", recommended_model: "claude-opus-5" },
        content: [],
      }),
      SCHEMA,
    );
    assert.equal(ausgelastet.art, "spaeter");
    assert.match(ausgelastet.art === "spaeter" ? ausgelastet.grund : "", /claude-opus-5 war gerade ausgelastet/);

    // Ohne Empfehlung — es gab für die Kategorie keinen Rückfall — bleibt es „nichts“.
    const ohne = antwortEinordnen(
      nachricht({ stop_reason: "refusal", stop_details: { category: "bio", recommended_model: null }, content: [] }),
      SCHEMA,
    );
    assert.equal(ohne.art, "nichts");

    // Als Ganzes: bezahlt (es wurde gelesen) und nicht gemerkt.
    const ganz = auswerten(
      {
        art: "nachricht",
        nachricht: nachricht({
          stop_reason: "refusal",
          stop_details: { category: "bio", recommended_model: "claude-opus-5" },
          content: [],
        }),
        wandMs: 3,
      },
      SCHEMA,
      ANGEFRAGT,
    );
    assert.equal(ganz.art, "spaeter");
    assert.equal(ganz.art === "spaeter" && ganz.abbruch, "rueckfall");
    assert.notEqual(ganz.messung, null);
  });

  it("nimmt kein Nullzeichen aus der Antwort mit — Postgres nähme es nirgends an", () => {
    const schema = z.object({ grund: z.string(), liste: z.array(z.object({ text: z.string() })) }).strict();
    const ergebnis = antwortEinordnen(
      nachricht({
        content: [text('{"grund":"unscharf\\u0000","liste":[{"text":"a\\u0000b"}]}')],
      }),
      schema,
    );
    assert.deepEqual(ergebnis, { art: "antwort", antwort: { grund: "unscharf", liste: [{ text: "ab" }] } });
    assert.deepEqual(ohneNullzeichen({ "a\u0000": ["\u0000x", 1, null] }), { a: ["x", 1, null] });
  });

  it("nimmt eine abgeschnittene Antwort nicht — auch wenn sie zufällig gültiges JSON ist", () => {
    const ergebnis = antwortEinordnen(nachricht({ stop_reason: "max_tokens" }), SCHEMA);
    assert.equal(ergebnis.art, "nichts");
  });

  it("weist kein JSON ab", () => {
    const ergebnis = antwortEinordnen(nachricht({ content: [text("Gerne! {")] }), SCHEMA);
    assert.equal(ergebnis.art, "nichts");
  });

  it("weist eine Antwort ab, die nicht zur Form passt, und nennt die Stelle", () => {
    const ergebnis = antwortEinordnen(
      nachricht({ content: [text(JSON.stringify({ ok: "ja" }))] }),
      SCHEMA,
    );
    assert.equal(ergebnis.art, "nichts");
    assert.match(ergebnis.art === "nichts" ? ergebnis.grund : "", /„ok“/);
  });

  it("reicht kein Feld durch, das das Schema nicht kennt", () => {
    const ergebnis = antwortEinordnen(
      nachricht({ content: [text(JSON.stringify({ ok: true, loesche: "alles" }))] }),
      SCHEMA,
    );
    assert.equal(ergebnis.art, "nichts");
  });

  it("weist eine leere Antwort ab", () => {
    assert.equal(antwortEinordnen(nachricht({ content: [] }), SCHEMA).art, "nichts");
  });

  it("liest nach einem Rückfall nur, was hinter dem Wechsel steht", () => {
    const ergebnis = antwortEinordnen(
      nachricht({
        model: "claude-opus-4-8",
        content: [
          text('{"ok": tr'),
          rueckfallBlock(ANGEFRAGT, "claude-opus-4-8"),
          text(JSON.stringify({ ok: false })),
        ],
      }),
      SCHEMA,
    );
    assert.deepEqual(ergebnis, { art: "antwort", antwort: { ok: false } });
  });
});

describe("antwortText", () => {
  it("setzt mehrere Textblöcke zusammen und lässt Denken weg", () => {
    const n = nachricht({
      content: [
        { type: "thinking", thinking: "", signature: "x" },
        text('{"ok":'),
        text("true}"),
      ],
    });
    assert.equal(antwortText(n), '{"ok":true}');
  });
});

describe("preisFuer", () => {
  it("unterscheidet Opus 5 von Opus 5.5 — ein Präfix ist kein Preis", () => {
    assert.equal(preisFuer("claude-opus-5-5")?.eingabe, 4);
    assert.equal(preisFuer("claude-opus-5")?.eingabe, 5);
  });

  it("nimmt eine id mit Datum dahinter, aber keinen anderen Anhang", () => {
    assert.equal(preisFuer("claude-opus-4-8-20260101")?.ausgabe, 25);
    assert.equal(preisFuer("claude-opus-5-5-fast"), null);
    assert.equal(preisFuer("claude-sonnet-5-5"), null);
  });
});

describe("messungAus", () => {
  it("rechnet einen gewöhnlichen Aufruf zu den Preisen von Opus 5.5", () => {
    const messung = messungAus(nachricht(), 42_000, ANGEFRAGT);

    assert.equal(messung.modell, ANGEFRAGT);
    assert.equal(messung.rueckfall, false);
    assert.equal(messung.eingabe, 1_000);
    assert.equal(messung.ausgabe, 500);
    assert.equal(messung.denken, 200);
    // 1 000 × 4 $ + 500 × 20 $ je Million
    assert.equal(messung.kostenUsd, (1_000 * 4 + 500 * 20) / 1_000_000);
    assert.deepEqual(messung.ohnePreis, []);
    assert.equal(messung.wandMs, 42_000);
  });

  it("rechnet Cache lesen und schreiben mit ihren eigenen Sätzen", () => {
    const messung = messungAus(
      nachricht({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 1_000_000,
          cache_creation_input_tokens: 3_000_000,
          cache_creation: {
            ephemeral_5m_input_tokens: 2_000_000,
            ephemeral_1h_input_tokens: 1_000_000,
          },
        },
      }),
      0,
      ANGEFRAGT,
    );

    // lesen 0,20 $; schreiben 5 min 1,25 × 4 $, 1 h 2 × 4 $
    assert.equal(messung.kostenUsd, 0.2 + 2 * 5 + 1 * 8);
    assert.equal(messung.cacheGelesen, 1_000_000);
    assert.equal(messung.cacheGeschrieben, 3_000_000);
  });

  it("zählt nach einem Rückfall beide Anläufe, jeden zu seinem Preis", () => {
    const messung = messungAus(
      nachricht({
        model: "claude-opus-4-8",
        content: [rueckfallBlock(ANGEFRAGT, "claude-opus-4-8"), text('{"ok":true}')],
        usage: {
          input_tokens: 2_000,
          output_tokens: 1_000,
          iterations: [
            {
              type: "message",
              model: ANGEFRAGT,
              input_tokens: 2_000,
              output_tokens: 100,
              cache_creation: null,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            {
              type: "fallback_message",
              model: "claude-opus-4-8",
              input_tokens: 2_000,
              output_tokens: 1_000,
              cache_creation: null,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          ],
        },
      }),
      0,
      ANGEFRAGT,
    );

    assert.equal(messung.modell, "claude-opus-4-8");
    assert.equal(messung.rueckfall, true);
    assert.deepEqual(messung.abgelehntVon, [ANGEFRAGT]);
    assert.equal(messung.eingabe, 4_000);
    assert.equal(messung.ausgabe, 1_100);
    const erwartet = (2_000 * 4 + 100 * 20 + 2_000 * 5 + 1_000 * 25) / 1_000_000;
    assert.equal(Math.abs((messung.kostenUsd ?? 0) - erwartet) < 1e-12, true);
  });

  it("nennt die Kosten unbekannt, wenn ein Modell ohne Preis geantwortet hat — nicht null", () => {
    const messung = messungAus(nachricht({ model: "claude-unbekannt-9" }), 0, ANGEFRAGT);
    assert.equal(messung.kostenUsd, null);
    assert.deepEqual(messung.ohnePreis, ["claude-unbekannt-9"]);
  });

  it("hält bei einer Ablehnung die Kategorie fest", () => {
    const messung = messungAus(
      nachricht({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }),
      0,
      ANGEFRAGT,
    );
    assert.equal(messung.stopGrund, "refusal");
    assert.equal(messung.ablehnung, "cyber");
  });
});

describe("auswerten", () => {
  it("gibt einem Fehler keine Messung — ohne Antwort gibt es keine `usage`", () => {
    const ergebnis = auswerten(
      { art: "fehler", fehler: apiFehler(429, "rate_limit_error"), fristAbgelaufen: false, begonnen: false, wandMs: 5 },
      SCHEMA,
      ANGEFRAGT,
    );
    assert.equal(ergebnis.art, "pause");
    assert.equal(ergebnis.messung, null);
    assert.equal(ergebnis.art === "pause" && ergebnis.abbruch, null);
    assert.equal(ergebnis.wandMs, 5);
  });

  it("misst auch eine Antwort, die nichts taugt — die ist es, die man sehen will", () => {
    const ergebnis = auswerten(
      { art: "nachricht", nachricht: nachricht({ stop_reason: "max_tokens" }), wandMs: 9 },
      SCHEMA,
      ANGEFRAGT,
    );
    assert.equal(ergebnis.art, "nichts");
    assert.equal(ergebnis.messung?.stopGrund, "max_tokens");
  });
});

describe("messungZeile", () => {
  it("nennt Modell, Tokens, Wanduhr und Kosten — und den Stopp nur, wenn er etwas sagt", () => {
    const zeile = messungZeile(messungAus(nachricht(), 42_400, ANGEFRAGT));

    assert.match(zeile, /^claude-opus-5-5, Eingabe 1\.000 Tok, Ausgabe 500 Tok \(davon Denken 200\)/);
    assert.match(zeile, /Wand 42 s/);
    assert.match(zeile, /0,014 \$/);
    assert.doesNotMatch(zeile, /Stopp/);
    assert.doesNotMatch(zeile, /Rückfall/);
  });

  it("zeigt einen Rückfall und eine Ablehnung", () => {
    const zeile = messungZeile(
      messungAus(
        nachricht({
          model: "claude-opus-4-8",
          stop_reason: "refusal",
          stop_details: { category: "bio" },
          content: [rueckfallBlock(ANGEFRAGT, "claude-opus-4-8")],
          usage: {
            iterations: [
              {
                type: "fallback_message",
                model: "claude-opus-4-8",
                input_tokens: 1,
                output_tokens: 1,
                cache_creation: null,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            ],
          },
        }),
        0,
        ANGEFRAGT,
      ),
    );

    assert.match(zeile, /Rückfall: claude-opus-5-5 lehnte ab, claude-opus-4-8 schrieb/);
    assert.match(zeile, /Stopp: refusal \(bio\)/);
  });

  it("sagt „unbekannt“ statt einer Null, wenn ein Preis fehlt", () => {
    const zeile = messungZeile(messungAus(nachricht({ model: "claude-unbekannt-9" }), 0, ANGEFRAGT));
    assert.match(zeile, /Kosten unbekannt \(kein Preis für claude-unbekannt-9\)/);
  });
});

describe("dollar", () => {
  it("schreibt drei Stellen nach dem Komma, deutsch", () => {
    assert.equal(dollar(0.3125), "0,313 $");
    assert.equal(dollar(1.28), "1,280 $");
  });
});
