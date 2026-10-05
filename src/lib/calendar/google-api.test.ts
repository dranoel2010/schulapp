import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { homeworkEvent } from "@/lib/calendar/events";
import {
  classifyApiError,
  createCalendarApi,
  GoogleApiError,
} from "@/lib/calendar/google-api";
import { GoogleTokenError, type TokenSource } from "@/lib/calendar/google-oauth";

type Antwort =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | Error;

const CAL = "abc123@group.calendar.google.com";
const BODY = homeworkEvent({
  homework: {
    id: "22222222-2222-4333-8444-555555555555",
    title: "S. 42",
    details: null,
    dueDate: "2026-10-08",
  },
  subjectName: "Mathe",
  reminderHour: 17,
  appOrigin: "https://example.test",
}).body;

function errorBody(reason: string, message = "") {
  return { error: { code: 0, message, errors: [{ reason, message }] } };
}

/** Google als Queue von Antworten, mit Mitschrift jeder Anfrage. */
function setup(antworten: Antwort[], options: { deadline?: number; nowMs?: number } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const waits: number[] = [];
  const tokens = { current: 0, renew: 0, failRenew: false };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const next = antworten.shift();
    if (!next) throw new Error("keine Antwort mehr vorbereitet");
    if (next instanceof Error) throw next;

    const leer = next.body === undefined || next.status === 204;
    return new Response(leer ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  }) as typeof fetch;

  const source: TokenSource = {
    current: async () => {
      tokens.current += 1;
      return tokens.renew > 0 ? `AT${tokens.renew + 1}` : "AT1";
    },
    renew: async () => {
      tokens.renew += 1;
      if (tokens.failRenew) throw new GoogleTokenError("invalid_grant", 400, "invalid_grant");
      return `AT${tokens.renew + 1}`;
    },
  };

  const now = options.nowMs ?? 1_000_000;
  const api = createCalendarApi({
    tokens: source,
    deadline: options.deadline ?? now + 600_000,
    fetchImpl,
    wait: async (ms) => {
      waits.push(ms);
    },
    now: () => now,
  });

  return { api, calls, waits, tokens };
}

describe("classifyApiError", () => {
  const cases: [number, unknown, string][] = [
    [400, errorBody("invalid", "Missing end time."), "anfrage"],
    [401, errorBody("authError"), "token"],
    [403, errorBody("rateLimitExceeded"), "drosselung"],
    [403, errorBody("userRateLimitExceeded"), "drosselung"],
    [403, errorBody("quotaExceeded"), "drosselung"],
    [403, errorBody("dailyLimitExceeded"), "drosselung"],
    [403, errorBody("accessNotConfigured"), "api-aus"],
    [403, { error: { status: "SERVICE_DISABLED" } }, "api-aus"],
    [
      403,
      { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } },
      "api-aus",
    ],
    [403, errorBody("forbidden"), "berechtigung"],
    [404, errorBody("notFound"), "nicht-gefunden"],
    [409, errorBody("duplicate"), "konflikt"],
    [410, errorBody("deleted"), "weg"],
    [412, errorBody("conditionNotMet"), "veraendert"],
    [429, errorBody("rateLimitExceeded"), "drosselung"],
    [500, null, "voruebergehend"],
    [502, null, "voruebergehend"],
    [503, null, "voruebergehend"],
    [504, null, "voruebergehend"],
    [418, null, "anfrage"],
  ];

  for (const [status, body, kind] of cases) {
    it(`${status} ${JSON.stringify(body)?.slice(0, 60)} → ${kind}`, () => {
      assert.equal(classifyApiError(status, body).kind, kind);
    });
  }

  it("liest den Grund aus errors[0].reason, sonst aus status", () => {
    assert.equal(classifyApiError(403, errorBody("forbidden")).reason, "forbidden");
    assert.equal(classifyApiError(403, { error: { status: "PERMISSION_DENIED" } }).reason, "PERMISSION_DENIED");
    assert.equal(classifyApiError(403, {}).reason, "");
  });

  it("nimmt die Meldung bei 400 in den Satz, gekürzt", () => {
    const satz = classifyApiError(400, errorBody("invalid", "x".repeat(500))).sentence;

    assert.ok(satz.includes("x".repeat(200)));
    assert.ok(!satz.includes("x".repeat(201)));
  });

  it("schreibt einen Handgriff, wenn die API aus ist", () => {
    assert.ok(classifyApiError(403, errorBody("accessNotConfigured")).sentence.includes("APIs & Dienste"));
  });

  it("wirft nie, auch nicht an einem kaputten Körper", () => {
    for (const body of [null, undefined, "text", 42, [], { error: 7 }, { error: { errors: "x" } }]) {
      assert.doesNotThrow(() => classifyApiError(403, body));
      assert.doesNotThrow(() => classifyApiError(400, body));
    }
  });

  it("unterscheidet Timeout und Netzfehler", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    assert.deepEqual(
      [classifyApiError(null, timeout).kind, classifyApiError(null, timeout).sentence],
      ["voruebergehend", "Keine Antwort von Google nach 15 Sekunden."],
    );

    const netz = new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    assert.equal(classifyApiError(null, netz).sentence, "Google nicht erreichbar (ENOTFOUND).");
  });
});

describe("createCalendarApi — Zugang", () => {
  it("holt nach einem 401 einmal ein frisches Token und wiederholt", async () => {
    const google = setup([
      { status: 401, body: errorBody("authError") },
      { status: 200, body: { id: "x", status: "confirmed", etag: '"1"' } },
    ]);

    const event = await google.api.getEvent(CAL, "sah1");

    assert.deepEqual(event, { status: "aktiv", etag: '"1"' });
    assert.equal(google.tokens.renew, 1);
    assert.equal(google.calls[0].headers.Authorization, "Bearer AT1");
    assert.equal(google.calls[1].headers.Authorization, "Bearer AT2");
  });

  it("macht aus einem zweiten 401 einen Fehler der Art token", async () => {
    const google = setup([
      { status: 401, body: errorBody("authError") },
      { status: 401, body: errorBody("authError") },
    ]);

    await assert.rejects(
      google.api.getEvent(CAL, "sah1"),
      (fehler: unknown) => fehler instanceof GoogleApiError && fehler.kind === "token",
    );
    assert.equal(google.tokens.renew, 1);
  });

  it("macht aus invalid_grant beim Erneuern einen Fehler der Art token", async () => {
    const google = setup([{ status: 401, body: errorBody("authError") }]);
    google.tokens.failRenew = true;

    await assert.rejects(
      google.api.updateEvent(CAL, "sah1", BODY, '"1"'),
      (fehler: unknown) => fehler instanceof GoogleApiError && fehler.kind === "token",
    );
  });
});

describe("createCalendarApi — Wiederholen", () => {
  it("wiederholt 503, 503 und hat dann Erfolg", async () => {
    const google = setup([
      { status: 503 },
      { status: 503 },
      { status: 200, body: { id: "sah1", creator: { email: "schueler@example.com" } } },
    ]);

    const created = await google.api.insertEvent(CAL, "sah1", BODY);

    assert.deepEqual(created, { creatorEmail: "schueler@example.com" });
    assert.equal(google.calls.length, 3);
    assert.equal(google.waits.length, 2);
    assert.ok(google.waits[0] >= 1000 && google.waits[0] < 1250, String(google.waits[0]));
    assert.ok(google.waits[1] >= 2000 && google.waits[1] < 2250, String(google.waits[1]));
  });

  it("lässt Retry-After Vorrang, gedeckelt auf 30 Sekunden", async () => {
    const google = setup([
      { status: 429, headers: { "Retry-After": "5" } },
      { status: 403, body: errorBody("rateLimitExceeded"), headers: { "Retry-After": "120" } },
      { status: 200, body: { id: "x" } },
    ]);

    await google.api.updateEvent(CAL, "sah1", BODY, null);

    assert.deepEqual(google.waits, [5000, 30_000]);
  });

  it("gibt nach drei Wiederholungen auf", async () => {
    const google = setup([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }]);

    await assert.rejects(
      google.api.insertEvent(CAL, "sah1", BODY),
      (fehler: unknown) => fehler instanceof GoogleApiError && fehler.kind === "voruebergehend",
    );
    assert.equal(google.calls.length, 4);
  });

  it("wiederholt nicht, wenn das Zeitbudget nicht reicht", async () => {
    const google = setup([{ status: 503 }], { nowMs: 0, deadline: 10_000 });

    await assert.rejects(
      google.api.insertEvent(CAL, "sah1", BODY),
      (fehler: unknown) => fehler instanceof GoogleApiError && fehler.kind === "voruebergehend",
    );
    assert.equal(google.calls.length, 1);
    assert.deepEqual(google.waits, []);
  });

  it("wiederholt nach einem Netzfehler", async () => {
    const google = setup([
      new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }),
      { status: 200, body: { id: "x" } },
    ]);

    await google.api.insertEvent(CAL, "sah1", BODY);

    assert.equal(google.calls.length, 2);
  });

  it("wiederholt einen 400 nicht", async () => {
    const google = setup([{ status: 400, body: errorBody("invalid", "Bad") }]);

    await assert.rejects(
      google.api.insertEvent(CAL, "sah1", BODY),
      (fehler: unknown) => fehler instanceof GoogleApiError && fehler.kind === "anfrage",
    );
    assert.equal(google.calls.length, 1);
  });
});

describe("createCalendarApi — deleteEvent", () => {
  it("wiederholt ein 503 NICHT — das übernimmt der nächste Lauf", async () => {
    const google = setup([{ status: 503 }, { status: 204 }]);

    await assert.rejects(
      google.api.deleteEvent(CAL, "sah1"),
      (fehler: unknown) => fehler instanceof GoogleApiError && fehler.kind === "voruebergehend",
    );
    assert.equal(google.calls.length, 1);
    assert.deepEqual(google.waits, []);
  });

  it("wiederholt auch einen Timeout nicht", async () => {
    const google = setup([new DOMException("timeout", "TimeoutError"), { status: 204 }]);

    await assert.rejects(google.api.deleteEvent(CAL, "sah1"));
    assert.equal(google.calls.length, 1);
  });

  it("204 heißt gelöscht, 404 und 410 heißen schon weg", async () => {
    assert.equal(await setup([{ status: 204 }]).api.deleteEvent(CAL, "sah1"), "geloescht");
    assert.equal(await setup([{ status: 200 }]).api.deleteEvent(CAL, "sah1"), "geloescht");
    assert.equal(
      await setup([{ status: 404, body: errorBody("notFound") }]).api.deleteEvent(CAL, "sah1"),
      "schon-weg",
    );
    assert.equal(
      await setup([{ status: 410, body: errorBody("deleted") }]).api.deleteEvent(CAL, "sah1"),
      "schon-weg",
    );
  });
});

describe("createCalendarApi — Termine", () => {
  it("setzt If-Match beim Ändern und schickt den ganzen Termin", async () => {
    const google = setup([{ status: 200, body: { id: "sah1" } }]);

    await google.api.updateEvent(CAL, "sah1", BODY, '"etag-7"');

    assert.equal(google.calls[0].method, "PUT");
    assert.equal(google.calls[0].headers["If-Match"], '"etag-7"');
    assert.deepEqual(google.calls[0].body, BODY);
  });

  it("lässt If-Match ohne etag weg", async () => {
    const google = setup([{ status: 200, body: { id: "sah1" } }]);

    await google.api.updateEvent(CAL, "sah1", BODY, null);

    assert.equal(google.calls[0].headers["If-Match"], undefined);
  });

  it("legt mit der eigenen ID an", async () => {
    const google = setup([{ status: 200, body: { id: "sah1" } }]);

    const created = await google.api.insertEvent(CAL, "sah1", BODY);

    assert.equal(google.calls[0].method, "POST");
    assert.deepEqual(google.calls[0].body, { id: "sah1", ...BODY });
    assert.equal(created.creatorEmail, null);
  });

  it("kodiert die Kalender-ID mit @ in der Adresse", async () => {
    const google = setup([{ status: 200, body: { id: "x", status: "confirmed", etag: '"1"' } }]);

    await google.api.getEvent(CAL, "sah1");

    assert.ok(
      google.calls[0].url.startsWith(
        "https://www.googleapis.com/calendar/v3/calendars/abc123%40group.calendar.google.com/events/sah1?",
      ),
      google.calls[0].url,
    );
  });

  it("getEvent: cancelled heißt gelöscht", async () => {
    const google = setup([{ status: 200, body: { id: "x", status: "cancelled", etag: '"2"' } }]);

    assert.deepEqual(await google.api.getEvent(CAL, "sah1"), { status: "geloescht", etag: '"2"' });
  });

  it("getEvent: 410 heißt gelöscht", async () => {
    const google = setup([{ status: 410, body: errorBody("deleted") }]);

    assert.deepEqual(await google.api.getEvent(CAL, "sah1"), { status: "geloescht", etag: null });
  });

  it("getEvent: zweimal 404 im Abstand von 2 Sekunden heißt null", async () => {
    const google = setup([
      { status: 404, body: errorBody("notFound") },
      { status: 404, body: errorBody("notFound") },
    ]);

    assert.equal(await google.api.getEvent(CAL, "sah1"), null);
    assert.deepEqual(google.waits, [2000]);
    assert.equal(google.calls.length, 2);
  });

  it("getEvent: 404, dann 200 heißt aktiv", async () => {
    const google = setup([
      { status: 404, body: errorBody("notFound") },
      { status: 200, body: { id: "x", status: "confirmed", etag: '"3"' } },
    ]);

    assert.deepEqual(await google.api.getEvent(CAL, "sah1"), { status: "aktiv", etag: '"3"' });
  });
});

describe("createCalendarApi — Kalender", () => {
  it("calendarState: 200 heißt da", async () => {
    assert.equal(await setup([{ status: 200, body: { id: CAL } }]).api.calendarState(CAL), "da");
  });

  it("calendarState: zweimal 404 heißt fehlt", async () => {
    const google = setup([
      { status: 404, body: errorBody("notFound") },
      { status: 404, body: errorBody("notFound") },
    ]);

    assert.equal(await google.api.calendarState(CAL), "fehlt");
    assert.deepEqual(google.waits, [2000]);
  });

  it("calendarState: 403 heißt kein Zugriff", async () => {
    assert.equal(
      await setup([{ status: 403, body: errorBody("forbidden") }]).api.calendarState(CAL),
      "kein-zugriff",
    );
  });

  it("calendarState: wirft, wenn die API aus ist", async () => {
    await assert.rejects(
      setup([{ status: 403, body: errorBody("accessNotConfigured") }]).api.calendarState(CAL),
      (fehler: unknown) => fehler instanceof GoogleApiError && fehler.kind === "api-aus",
    );
  });

  it("createCalendar legt „Schule“ in Europe/Berlin an", async () => {
    const google = setup([{ status: 200, body: { id: CAL } }]);

    assert.equal(await google.api.createCalendar(), CAL);
    assert.equal(google.calls[0].url, "https://www.googleapis.com/calendar/v3/calendars");
    assert.deepEqual(
      { ...(google.calls[0].body as Record<string, unknown>), description: "…" },
      { summary: "Schule", timeZone: "Europe/Berlin", description: "…" },
    );
  });

  it("createCalendar wiederholt einen 503 NICHT — sonst stünden womöglich zwei „Schule“ da", async () => {
    const google = setup([{ status: 503 }, { status: 200, body: { id: CAL } }]);

    await assert.rejects(google.api.createCalendar());
    assert.equal(google.calls.length, 1);
  });

  it("createCalendar wiederholt bei Drosselung", async () => {
    const google = setup([{ status: 429 }, { status: 200, body: { id: CAL } }]);

    assert.equal(await google.api.createCalendar(), CAL);
    assert.equal(google.calls.length, 2);
  });
});
