import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { eventIdFor, homeworkEvent, type WantedEvent } from "@/lib/calendar/events";
import { executeSteps, type StepStore } from "@/lib/calendar/execute";
import { createCalendarApi } from "@/lib/calendar/google-api";
import type { TokenSource } from "@/lib/calendar/google-oauth";
import { planSync, type EventRow } from "@/lib/calendar/plan";

/**
 * Derselbe Abgleich wie in execute.test.ts, aber eine Schicht tiefer: Hier
 * spricht die echte `createCalendarApi()` per `fetch` mit einer Attrappe der
 * REST-Schnittstelle. Damit ist auch geprüft, dass die Statuscodes, die Google
 * wirklich schickt (409, 410, 412, 204), in @/lib/calendar/google-api zu genau
 * den Antworten werden, mit denen @/lib/calendar/execute rechnet — ohne Netz
 * und ohne Datenbank.
 */

const CAL = "schule@group.calendar.google.com";
const BASE = "https://www.googleapis.com/calendar/v3";
const ALL = new Set(["klausur", "hausaufgabe", "frei"]);

type Stored = { status: "confirmed" | "cancelled"; etag: string; body: Record<string, unknown> };

/** Die REST-Schnittstelle von Google, so knapp wie möglich und so genau wie nötig. */
function restGoogle() {
  const events = new Map<string, Stored>();
  const requests: string[] = [];
  const state = { calendarGone: false, validToken: "AT1", etag: 0 };

  function json(status: number, body?: unknown): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }

  function error(status: number, reason: string): Response {
    return json(status, { error: { code: status, message: reason, errors: [{ reason }] } });
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push(`${method} ${url.pathname.replace("/calendar/v3", "")}`);

    if (headers.Authorization !== `Bearer ${state.validToken}`) return error(401, "authError");

    const path = url.href.slice(BASE.length).split("?")[0];
    const match = /^\/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/.exec(path);
    assert.ok(match, `unbekannte Adresse ${path}`);
    assert.equal(decodeURIComponent(match[1]), CAL);
    if (state.calendarGone) return error(404, "notFound");

    const isEvents = path.includes("/events");
    const eventId = match[2] ? decodeURIComponent(match[2]) : null;

    if (!isEvents) return json(200, { id: CAL });

    if (method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const id = String(body.id);
      if (events.has(id)) return error(409, "duplicate");
      state.etag += 1;
      events.set(id, { status: "confirmed", etag: `"${state.etag}"`, body });
      return json(200, { id, creator: { email: "schueler@example.com" } });
    }

    assert.ok(eventId);
    const ev = events.get(eventId);

    if (method === "GET") {
      if (!ev) return error(404, "notFound");
      return json(200, { id: eventId, status: ev.status, etag: ev.etag });
    }

    if (method === "PUT") {
      if (!ev) return error(404, "notFound");
      if (headers["If-Match"] && headers["If-Match"] !== ev.etag) return error(412, "conditionNotMet");
      if (ev.status === "cancelled") return error(410, "deleted");
      state.etag += 1;
      ev.etag = `"${state.etag}"`;
      ev.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json(200, { id: eventId });
    }

    if (method === "DELETE") {
      if (!ev) return error(404, "notFound");
      if (ev.status === "cancelled") return error(410, "deleted");
      state.etag += 1;
      ev.status = "cancelled";
      ev.etag = `"${state.etag}"`;
      return new Response(null, { status: 204 });
    }

    throw new Error(`unerwartet: ${method}`);
  }) as typeof fetch;

  return { events, requests, state, fetchImpl };
}

class MemoryStore implements StepStore {
  rows = new Map<string, EventRow>();
  async saveRow(row: EventRow) {
    this.rows.set(row.key, { ...row });
  }
  async noteCreatorEmail() {}
}

function hw(title = "S. 42", dueDate = "2026-10-10"): WantedEvent {
  return homeworkEvent({
    homework: { id: "00000000-0000-4000-8000-000000000001", title, details: null, dueDate },
    subjectName: "Mathe",
    reminderHour: 17,
    appOrigin: "https://example.test",
  });
}

let google: ReturnType<typeof restGoogle>;
let store: MemoryStore;
let renewals: number;

beforeEach(() => {
  google = restGoogle();
  store = new MemoryStore();
  renewals = 0;
});

async function sync(wanted: WantedEvent[]) {
  // Wie die echte TokenSource: Nach dem Erneuern gilt das neue Token für den Rest des Laufs.
  let current = "AT1";
  const tokens: TokenSource = {
    current: async () => current,
    renew: async () => {
      renewals += 1;
      current = google.state.validToken;
      return current;
    },
  };

  const api = createCalendarApi({
    tokens,
    deadline: Date.now() + 600_000,
    fetchImpl: google.fetchImpl,
    wait: async () => {},
  });

  const plan = planSync({ wanted, complete: ALL, rows: [...store.rows.values()], today: "2026-10-05" });
  return executeSteps(plan.steps, { api, store, calendarId: CAL, deadline: Date.now() + 600_000 });
}

describe("Abgleich über die echte API-Schicht gegen eine REST-Attrappe", () => {
  it("legt an, lässt in Ruhe, ändert, nimmt heraus und legt neu an", async () => {
    const id0 = eventIdFor(hw().idBase, 0);
    const id1 = eventIdFor(hw().idBase, 1);

    assert.equal((await sync([hw()])).neu, 1);
    assert.equal(google.events.get(id0)?.body.summary, "Hausaufgabe Mathe: S. 42");

    google.requests.length = 0;
    await sync([hw()]);
    assert.deepEqual(google.requests, [], "ohne Änderung kein Aufruf");

    assert.equal((await sync([hw("S. 43")])).geaendert, 1);
    assert.equal(google.events.get(id0)?.body.summary, "Hausaufgabe Mathe: S. 43");

    assert.equal((await sync([])).entfernt, 1);
    assert.equal(google.events.get(id0)?.status, "cancelled");

    assert.equal((await sync([hw("S. 43")])).neu, 1);
    assert.equal(google.events.get(id1)?.status, "confirmed");
    assert.equal(store.rows.get(hw().key)?.generation, 1);
  });

  it("merkt eine Löschung des Nutzers am cancelled und trägt sie nie wieder ein", async () => {
    await sync([hw()]);
    const ev = google.events.get(eventIdFor(hw().idBase, 0));
    assert.ok(ev);
    ev.status = "cancelled";

    const lauf = await sync([hw("geändert")]);

    assert.equal(lauf.verworfen, 1);
    assert.equal(store.rows.get(hw().key)?.state, "verworfen");

    google.requests.length = 0;
    await sync([hw("noch einmal")]);
    assert.deepEqual(google.requests, []);
  });

  it("sieht vor dem Löschen nach und macht aus einem gelöschten Termin ein „verworfen“ — ohne DELETE", async () => {
    await sync([hw()]);
    const ev = google.events.get(eventIdFor(hw().idBase, 0));
    assert.ok(ev);
    ev.status = "cancelled";

    google.requests.length = 0;
    const lauf = await sync([]);

    assert.equal(lauf.verworfen, 1);
    assert.equal(store.rows.get(hw().key)?.state, "verworfen");
    assert.ok(!google.requests.some((request) => request.startsWith("DELETE")), "kein DELETE");
  });

  it("verwirft nach 404 vor dem Löschen erst nach der Kalender-Probe", async () => {
    await sync([hw()]);
    google.events.delete(eventIdFor(hw().idBase, 0));

    google.requests.length = 0;
    const lauf = await sync([]);

    assert.equal(lauf.verworfen, 1);
    assert.ok(google.requests.includes(`GET /calendars/${encodeURIComponent(CAL)}`), "vorher die Kalender-Probe");
    assert.ok(!google.requests.some((request) => request.startsWith("DELETE")), "kein DELETE");
  });

  it("nimmt nach 429 auf den ersten DELETE die Absicht zurück", async () => {
    await sync([hw()]);
    const echt = google.fetchImpl;
    google.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ error: { code: 429, errors: [{ reason: "rateLimitExceeded" }] } }), {
          status: 429,
        });
      }
      return echt(input, init);
    }) as typeof fetch;

    const lauf = await sync([]);

    assert.equal(lauf.stoppedBy, "drosselung");
    assert.equal(store.rows.get(hw().key)?.state, "geliefert");
  });

  it("übernimmt nach 409 einen Termin, der schon da ist", async () => {
    await sync([hw()]);
    store.rows.clear();

    const lauf = await sync([hw("neu")]);

    assert.equal(lauf.neu, 1);
    assert.equal(google.events.size, 1);
    assert.equal(
      google.events.get(eventIdFor(hw().idBase, 0))?.body.summary,
      "Hausaufgabe Mathe: neu",
    );
  });

  it("holt nach einem 401 ein frisches Token und macht weiter", async () => {
    await sync([hw()]);
    google.state.validToken = "AT2";

    const lauf = await sync([hw("nach dem Wechsel")]);

    assert.equal(lauf.geaendert, 1);
    assert.equal(renewals, 1);
  });

  it("verwirft nichts, wenn der Kalender weg ist", async () => {
    await sync([hw()]);
    google.state.calendarGone = true;

    const lauf = await sync([hw("anders")]);

    assert.equal(lauf.stoppedBy, "kalender-weg");
    assert.equal(lauf.verworfen, 0);
    assert.equal(store.rows.get(hw().key)?.state, "geliefert");
  });
});
