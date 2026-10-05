import {
  CALENDAR_DESCRIPTION,
  CALENDAR_SUMMARY,
  CALENDAR_TIME_ZONE,
} from "@/lib/calendar/config";
import type { CalendarEventBody } from "@/lib/calendar/events";
import { GoogleTokenError, type TokenSource } from "@/lib/calendar/google-oauth";

/**
 * Die Google Calendar API — sechs Aufrufe, direkt per `fetch`.
 *
 * Mehr braucht der Abgleich nicht: einen Kalender anlegen, nachsehen, ob es ihn
 * noch gibt, und je Termin holen, anlegen, ändern, löschen. Eine Liste aller
 * Termine (`events.list`), `syncToken` oder `watch` gibt es ausdrücklich nicht
 * — warum, steht in @/lib/calendar/plan.
 *
 * `fetch`, `wait` und `now` sind hereinreichbar; die Tests spielen damit
 * Googles Antworten durch, ohne Netz.
 *
 * ── Wiederholen, und wann nicht ──────────────────────────────────────────────
 *
 * Drosselung (429, 403 rateLimitExceeded …), 5xx, Netz und Timeout werden bis
 * zu dreimal wiederholt, mit 1, 2 und 4 Sekunden Abstand und etwas Zufall
 * dazu; ein `Retry-After` hat Vorrang, gedeckelt auf 30 Sekunden. Wiederholt
 * wird nur, solange das Zeitbudget des Laufs dafür reicht.
 *
 * Ein wiederholtes Anlegen ist sicher: Die Event-ID steht fest, ein zweites
 * Anlegen endet mit 409, und das fängt @/lib/calendar/execute ab. Ein
 * wiederholtes Ändern ebenso, über `If-Match` und 412.
 *
 * NICHT wiederholt wird das Löschen. Ein zweiter DELETE nach einem Timeout
 * bekäme 410 („schon gelöscht") auf den eigenen ersten Versuch — und dann
 * hielte die App ihre eigene Löschung womöglich für eine des Nutzers. Das
 * Wiederholen übernimmt der nächste Lauf, über den Zustand `entfernen`.
 *
 * Ebenfalls nicht wiederholt wird das Anlegen des Kalenders nach einem
 * Timeout oder 5xx — anders als bei Terminen gibt es dafür keine feste ID, und
 * ein zweiter Versuch hinterließe womöglich zwei Kalender „Schule". Nur bei
 * Drosselung, die sicher nichts angelegt hat, wird es wiederholt.
 *
 * Bei 401 wird einmal ein frisches Access Token geholt und wiederholt; ein
 * zweites 401 ist ein Fehler der Art `token`.
 */

const BASE = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 15_000;
const BACKOFF_MS = [1_000, 2_000, 4_000];
const MAX_RETRY_AFTER_MS = 30_000;
/** Ein 404 wird nach dieser Pause einmal nachgefragt — Google empfiehlt dafür Backoff. */
const NOT_FOUND_PAUSE_MS = 2_000;

export type ApiErrorKind =
  | "token"
  | "drosselung"
  | "voruebergehend"
  | "nicht-gefunden"
  | "konflikt"
  | "weg"
  | "veraendert"
  | "api-aus"
  | "berechtigung"
  | "anfrage";

/** Ein Fehler der Calendar API, mit einem Satz für die Einstellungen. */
export class GoogleApiError extends Error {
  kind: ApiErrorKind;
  status: number | null;
  reason: string;
  sentence: string;

  constructor(
    info: { kind: ApiErrorKind; reason: string; sentence: string },
    status: number | null,
  ) {
    super(info.sentence);
    this.name = "GoogleApiError";
    this.kind = info.kind;
    this.status = status;
    this.reason = info.reason;
    this.sentence = info.sentence;
  }
}

const RATE_REASONS = [
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
];

const API_OFF_REASONS = ["accessNotConfigured", "SERVICE_DISABLED"];

const API_OFF_SENTENCE =
  "Die Google Calendar API ist im Cloud-Projekt ausgeschaltet. In der Google Cloud Console unter „APIs & Dienste“ einschalten.";

/** Ein Feld aus einem Objekt, das womöglich keins ist. */
function field(value: unknown, name: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Was im Fehlerkörper an Gründen steht — auch aus `details`, wo neuere APIs SERVICE_DISABLED hinschreiben. */
function reasons(body: unknown): { first: string; all: string[]; message: string } {
  const error = field(body, "error");
  const errors = field(error, "errors");
  const details = field(error, "details");

  const first =
    text(Array.isArray(errors) ? field(errors[0], "reason") : undefined) ||
    text(field(error, "status"));

  const all = [first];
  if (Array.isArray(details)) {
    for (const detail of details) all.push(text(field(detail, "reason")));
  }

  return { first, all: all.filter(Boolean), message: text(field(error, "message")) };
}

/** Name oder Code eines Netzfehlers, ohne den Rest der Meldung. */
function networkCode(error: unknown): string {
  const cause = field(error, "cause");
  return text(field(cause, "code")) || text(field(error, "code")) || text(field(error, "name")) || "Netzfehler";
}

/**
 * Was eine Antwort bedeutet. `status: null` heißt: keine Antwort — dann ist
 * `body` der geworfene Fehler. Ein kaputter Körper führt nie zu einem Wurf.
 */
export function classifyApiError(
  status: number | null,
  body: unknown,
): { kind: ApiErrorKind; reason: string; sentence: string } {
  if (status === null) {
    const timeout = text(field(body, "name")) === "TimeoutError";

    return {
      kind: "voruebergehend",
      reason: timeout ? "timeout" : "netz",
      sentence: timeout
        ? "Keine Antwort von Google nach 15 Sekunden."
        : `Google nicht erreichbar (${networkCode(body)}).`,
    };
  }

  const { first, all, message } = reasons(body);

  switch (status) {
    case 400:
      return {
        kind: "anfrage",
        reason: first,
        sentence: `Google lehnt den Termin ab (400)${message ? `: ${message.slice(0, 200)}` : "."}`,
      };
    case 401:
      return {
        kind: "token",
        reason: first,
        sentence: "Google nimmt den Zugang der App nicht an (401).",
      };
    case 403:
      if (all.some((reason) => RATE_REASONS.includes(reason))) {
        return {
          kind: "drosselung",
          reason: first,
          sentence: "Google bremst die App gerade (zu viele Anfragen). Der nächste Lauf macht weiter.",
        };
      }
      if (all.some((reason) => API_OFF_REASONS.includes(reason))) {
        return { kind: "api-aus", reason: first, sentence: API_OFF_SENTENCE };
      }
      return {
        kind: "berechtigung",
        reason: first,
        sentence: `Google verweigert den Zugriff (403${first ? `, ${first}` : ""}).`,
      };
    case 404:
      return {
        kind: "nicht-gefunden",
        reason: first,
        sentence: "Google kennt diesen Termin oder Kalender nicht (404).",
      };
    case 409:
      return {
        kind: "konflikt",
        reason: first,
        sentence: "Diese Termin-ID gibt es in Google schon (409).",
      };
    case 410:
      return {
        kind: "weg",
        reason: first,
        sentence: "Der Termin ist in Google gelöscht (410).",
      };
    case 412:
      return {
        kind: "veraendert",
        reason: first,
        sentence: "Der Termin wurde in Google zwischendurch geändert (412).",
      };
    case 429:
      return {
        kind: "drosselung",
        reason: first,
        sentence: "Google bremst die App gerade (zu viele Anfragen). Der nächste Lauf macht weiter.",
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        kind: "voruebergehend",
        reason: first,
        sentence: `Google hat gerade einen Fehler (${status}). Der nächste Lauf versucht es wieder.`,
      };
    default:
      return {
        kind: "anfrage",
        reason: first,
        sentence: `Google antwortet unerwartet mit ${status}.`,
      };
  }
}

/** Was die App über einen Termin in Google wissen muss — und mehr fragt sie nicht. */
export type RemoteEvent = { status: "aktiv" | "geloescht"; etag: string | null };

export type CalendarApi = {
  /** POST /calendars — gibt die ID des neuen Kalenders zurück */
  createCalendar(): Promise<string>;
  calendarState(calendarId: string): Promise<"da" | "fehlt" | "kein-zugriff">;
  /** `null` heißt: zweimal 404 — Google kennt die ID nicht (mehr) */
  getEvent(calendarId: string, eventId: string): Promise<RemoteEvent | null>;
  insertEvent(
    calendarId: string,
    eventId: string,
    body: CalendarEventBody,
  ): Promise<{ creatorEmail: string | null }>;
  updateEvent(
    calendarId: string,
    eventId: string,
    body: CalendarEventBody,
    etag: string | null,
  ): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<"geloescht" | "schon-weg">;
};

/** Wann wiederholt wird: alles Vorübergehende, nur Drosselung, oder gar nicht. */
type RetryPolicy = "alles" | "drosselung" | "nie";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const raw = await response.text();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;

  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

export function createCalendarApi(input: {
  tokens: TokenSource;
  /** Zeitpunkt in ms, bis zu dem der Lauf fertig sein will */
  deadline: number;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}): CalendarApi {
  const fetchImpl = input.fetchImpl ?? fetch;
  const wait = input.wait ?? sleep;
  const now = input.now ?? Date.now;

  /** Ein Token holen — ein Fehler dabei ist ein Fehler der Art `token`, kein unerwarteter Wurf. */
  async function token(renew: boolean): Promise<string> {
    try {
      return renew ? await input.tokens.renew() : await input.tokens.current();
    } catch (fehler) {
      if (fehler instanceof GoogleTokenError) {
        throw new GoogleApiError(
          {
            kind: fehler.kind === "voruebergehend" ? "voruebergehend" : "token",
            reason: fehler.kind,
            sentence:
              fehler.kind === "voruebergehend"
                ? "Google war beim Erneuern des Zugangs nicht erreichbar."
                : `Google nimmt den Zugang der App nicht mehr an (${fehler.kind}).`,
          },
          fehler.status,
        );
      }
      throw fehler;
    }
  }

  async function call(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { body?: unknown; ifMatch?: string | null; retry: RetryPolicy },
  ): Promise<{ status: number; body: unknown }> {
    let renewed = false;
    let accessToken = await token(false);

    for (let attempt = 0; ; ) {
      let response: Response;

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        };
        if (options.body !== undefined) headers["Content-Type"] = "application/json";
        if (options.ifMatch) headers["If-Match"] = options.ifMatch;

        response = await fetchImpl(`${BASE}${path}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (fehler) {
        const info = classifyApiError(null, fehler);
        const delay = BACKOFF_MS[attempt] + Math.floor(Math.random() * 250);

        if (options.retry === "alles" && mayRetry(attempt, delay)) {
          await wait(delay);
          attempt += 1;
          continue;
        }

        throw new GoogleApiError(info, null);
      }

      if (response.ok) {
        return { status: response.status, body: await readJson(response) };
      }

      const body = await readJson(response);

      if (response.status === 401 && !renewed) {
        renewed = true;
        accessToken = await token(true);
        continue;
      }

      const info = classifyApiError(response.status, body);
      const retryable =
        info.kind === "drosselung" ||
        (info.kind === "voruebergehend" && options.retry === "alles");

      if (retryable && options.retry !== "nie") {
        const delay =
          retryAfterMs(response.headers.get("retry-after")) ??
          BACKOFF_MS[attempt] + Math.floor(Math.random() * 250);

        if (mayRetry(attempt, delay)) {
          await wait(delay);
          attempt += 1;
          continue;
        }
      }

      throw new GoogleApiError(info, response.status);
    }
  }

  /** Noch ein Versuch? Höchstens drei, und nur, wenn danach noch eine volle Anfrage ins Budget passt. */
  function mayRetry(attempt: number, delay: number): boolean {
    return attempt < BACKOFF_MS.length && now() + delay + TIMEOUT_MS < input.deadline;
  }

  const calendarPath = (calendarId: string) =>
    `/calendars/${encodeURIComponent(calendarId)}`;
  const eventPath = (calendarId: string, eventId: string) =>
    `${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`;

  /** Einmal nachfragen, wenn Google 404 sagt — ein frisch angelegter Termin ist nicht sofort überall sichtbar. */
  async function twiceOn404<T>(once: () => Promise<T>): Promise<T | null> {
    try {
      return await once();
    } catch (fehler) {
      if (!(fehler instanceof GoogleApiError) || fehler.kind !== "nicht-gefunden") {
        throw fehler;
      }
    }

    await wait(NOT_FOUND_PAUSE_MS);

    try {
      return await once();
    } catch (fehler) {
      if (fehler instanceof GoogleApiError && fehler.kind === "nicht-gefunden") {
        return null;
      }
      throw fehler;
    }
  }

  return {
    async createCalendar() {
      const { body } = await call("POST", "/calendars", {
        body: {
          summary: CALENDAR_SUMMARY,
          description: CALENDAR_DESCRIPTION,
          timeZone: CALENDAR_TIME_ZONE,
        },
        retry: "drosselung",
      });

      const id = text(field(body, "id"));
      if (!id) {
        throw new GoogleApiError(
          {
            kind: "anfrage",
            reason: "",
            sentence: "Google hat beim Anlegen des Kalenders keine ID geliefert.",
          },
          200,
        );
      }

      return id;
    },

    async calendarState(calendarId) {
      try {
        const found = await twiceOn404(() =>
          call("GET", `${calendarPath(calendarId)}?fields=id`, { retry: "alles" }),
        );
        return found === null ? "fehlt" : "da";
      } catch (fehler) {
        if (fehler instanceof GoogleApiError && fehler.kind === "berechtigung") {
          return "kein-zugriff";
        }
        throw fehler;
      }
    },

    async getEvent(calendarId, eventId) {
      try {
        const found = await twiceOn404(() =>
          call("GET", `${eventPath(calendarId, eventId)}?fields=id,status,etag`, {
            retry: "alles",
          }),
        );
        if (found === null) return null;

        return {
          status: text(field(found.body, "status")) === "cancelled" ? "geloescht" : "aktiv",
          etag: text(field(found.body, "etag")) || null,
        };
      } catch (fehler) {
        if (fehler instanceof GoogleApiError && fehler.kind === "weg") {
          return { status: "geloescht", etag: null };
        }
        throw fehler;
      }
    },

    async insertEvent(calendarId, eventId, body) {
      const { body: created } = await call(
        "POST",
        `${calendarPath(calendarId)}/events?fields=id,creator(email)`,
        { body: { id: eventId, ...body }, retry: "alles" },
      );

      return { creatorEmail: text(field(field(created, "creator"), "email")) || null };
    },

    async updateEvent(calendarId, eventId, body, etag) {
      await call("PUT", `${eventPath(calendarId, eventId)}?fields=id`, {
        body,
        ifMatch: etag,
        retry: "alles",
      });
    },

    async deleteEvent(calendarId, eventId) {
      try {
        await call("DELETE", eventPath(calendarId, eventId), { retry: "nie" });
        return "geloescht";
      } catch (fehler) {
        if (
          fehler instanceof GoogleApiError &&
          (fehler.kind === "nicht-gefunden" || fehler.kind === "weg")
        ) {
          return "schon-weg";
        }
        throw fehler;
      }
    },
  };
}
