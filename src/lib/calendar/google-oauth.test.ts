import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GOOGLE_SCOPE, readCalendarConfig, type CalendarConfig } from "@/lib/calendar/config";
import {
  authorizationUrl,
  classifyTokenError,
  cookieValue,
  createTokenSource,
  exchangeCode,
  grantsCalendar,
  GoogleTokenError,
  newAuthorization,
  pkceChallenge,
  readCookieValue,
  refreshAccessToken,
  revokeToken,
  sameSecret,
  staticTokenSource,
} from "@/lib/calendar/google-oauth";

const result = readCalendarConfig({
  GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-geheim",
  GOOGLE_TOKEN_KEY: Buffer.alloc(32, 1).toString("base64"),
});
assert.ok(result.ok);
const CONFIG: CalendarConfig = result.config;

type Antwort = { status: number; body?: unknown } | Error;

/** Ein fetch, das der Reihe nach antwortet und mitschreibt, was gefragt wurde. */
function fakeFetch(antworten: Antwort[]) {
  const calls: { url: string; init: RequestInit }[] = [];

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = antworten.shift();
    if (!next) throw new Error("keine Antwort mehr vorbereitet");
    if (next instanceof Error) throw next;

    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return { impl, calls };
}

function form(call: { init: RequestInit }): URLSearchParams {
  return new URLSearchParams(String(call.init.body));
}

const noWait = async () => {};

describe("PKCE", () => {
  it("rechnet den Testvektor aus RFC 7636", () => {
    assert.equal(
      pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("erzeugt einen Verifier mit 43 erlaubten Zeichen und die passende Challenge", () => {
    const auth = newAuthorization();

    assert.match(auth.verifier, /^[A-Za-z0-9\-._~]{43}$/);
    assert.match(auth.state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(auth.challenge, pkceChallenge(auth.verifier));
    assert.notEqual(auth.state, auth.verifier);
  });
});

describe("authorizationUrl", () => {
  it("fragt genau den einen Scope, offline, mit Zustimmung und S256", () => {
    const url = new URL(authorizationUrl(CONFIG, { state: "zustand", challenge: "pruefwert" }));
    const q = url.searchParams;

    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(q.get("client_id"), CONFIG.clientId);
    assert.equal(q.get("redirect_uri"), CONFIG.redirectUri);
    assert.equal(q.get("redirect_uri"), "https://treskownas.tail3a40b0.ts.net/api/google/callback");
    assert.equal(q.get("response_type"), "code");
    assert.equal(q.get("scope"), GOOGLE_SCOPE);
    assert.equal(q.get("scope")?.split(" ").length, 1);
    assert.equal(q.get("access_type"), "offline");
    assert.equal(q.get("prompt"), "consent");
    assert.equal(q.get("state"), "zustand");
    assert.equal(q.get("code_challenge"), "pruefwert");
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.equal(q.has("include_granted_scopes"), false);
  });
});

describe("Cookie, state und Scope", () => {
  it("liest das Cookie zurück", () => {
    const auth = newAuthorization();

    assert.deepEqual(readCookieValue(cookieValue(auth.state, auth.verifier)), {
      state: auth.state,
      verifier: auth.verifier,
    });
  });

  it("verwirft kaputte Cookies", () => {
    const gut = "a".repeat(43);

    for (const raw of [
      undefined,
      "",
      gut,
      `${gut}.${gut}.${gut}`,
      `${gut}.kurz`,
      `${gut}.${"a".repeat(42)}!`,
      `.${gut}`,
    ]) {
      assert.equal(readCookieValue(raw), null, String(raw));
    }
  });

  it("vergleicht state zeitkonstant und ohne an der Länge zu stolpern", () => {
    assert.equal(sameSecret("abc", "abc"), true);
    assert.equal(sameSecret("abc", "abd"), false);
    assert.equal(sameSecret("abc", "abcd"), false);
    assert.equal(sameSecret("abc", ""), false);
    assert.equal(sameSecret("abc", null), false);
  });

  it("erkennt den Kalender-Scope Wort für Wort", () => {
    assert.equal(grantsCalendar(GOOGLE_SCOPE), true);
    assert.equal(grantsCalendar(`openid ${GOOGLE_SCOPE} email`), true);
    assert.equal(grantsCalendar(`${GOOGLE_SCOPE}X`), false);
    assert.equal(grantsCalendar("https://www.googleapis.com/auth/calendar.app"), false);
    assert.equal(grantsCalendar(""), false);
    assert.equal(grantsCalendar(undefined), false);
  });
});

describe("classifyTokenError", () => {
  it("ordnet Googles Antworten ein", () => {
    assert.equal(classifyTokenError(400, { error: "invalid_grant" }), "invalid_grant");
    assert.equal(classifyTokenError(401, { error: "invalid_grant" }), "invalid_grant");
    assert.equal(classifyTokenError(401, { error: "invalid_client" }), "invalid_client");
    assert.equal(classifyTokenError(400, { error: "unauthorized_client" }), "invalid_client");
    assert.equal(classifyTokenError(400, { error: "invalid_request" }), "anfrage");
    assert.equal(classifyTokenError(400, null), "anfrage");
    assert.equal(classifyTokenError(429, null), "voruebergehend");
    assert.equal(classifyTokenError(503, { error: "invalid_grant" }), "voruebergehend");
    assert.equal(classifyTokenError(null, null), "voruebergehend");
  });
});

describe("exchangeCode", () => {
  it("schickt den Code samt code_verifier als Formular", async () => {
    const fake = fakeFetch([
      {
        status: 200,
        body: { access_token: "AT", refresh_token: "RT", scope: GOOGLE_SCOPE, expires_in: 3599 },
      },
    ]);

    const tokens = await exchangeCode(CONFIG, "der-code", "der-verifier", {
      fetchImpl: fake.impl,
      wait: noWait,
    });

    assert.deepEqual(tokens, { accessToken: "AT", refreshToken: "RT", scope: GOOGLE_SCOPE });
    assert.equal(fake.calls[0].url, "https://oauth2.googleapis.com/token");
    assert.equal(fake.calls[0].init.method, "POST");
    assert.equal(
      (fake.calls[0].init.headers as Record<string, string>)["Content-Type"],
      "application/x-www-form-urlencoded",
    );

    const body = form(fake.calls[0]);
    assert.equal(body.get("code"), "der-code");
    assert.equal(body.get("code_verifier"), "der-verifier");
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("redirect_uri"), CONFIG.redirectUri);
    assert.equal(body.get("client_id"), CONFIG.clientId);
    assert.equal(body.get("client_secret"), CONFIG.clientSecret);
  });

  it("liefert kein Refresh Token, wenn Google keins schickt", async () => {
    const fake = fakeFetch([{ status: 200, body: { access_token: "AT", scope: GOOGLE_SCOPE } }]);

    const tokens = await exchangeCode(CONFIG, "c", "v", { fetchImpl: fake.impl, wait: noWait });

    assert.equal(tokens.refreshToken, null);
  });

  it("wirft invalid_grant, ohne den Code zu nennen", async () => {
    const fake = fakeFetch([
      { status: 400, body: { error: "invalid_grant", error_description: "Bad Request" } },
    ]);

    await assert.rejects(
      exchangeCode(CONFIG, "geheimer-code-123", "v", { fetchImpl: fake.impl, wait: noWait }),
      (fehler: unknown) => {
        assert.ok(fehler instanceof GoogleTokenError);
        assert.equal(fehler.kind, "invalid_grant");
        assert.equal(fehler.status, 400);
        assert.ok(!fehler.message.includes("geheimer-code-123"));
        assert.ok(!fehler.message.includes(CONFIG.clientSecret));
        return true;
      },
    );
  });
});

describe("refreshAccessToken", () => {
  it("wiederholt bei vorübergehenden Fehlern, mit 1 s und 4 s Pause", async () => {
    const waits: number[] = [];
    const fake = fakeFetch([
      { status: 503 },
      new TypeError("fetch failed"),
      { status: 200, body: { access_token: "AT" } },
    ]);

    const tokens = await refreshAccessToken(CONFIG, "RT", {
      fetchImpl: fake.impl,
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    assert.equal(tokens.accessToken, "AT");
    assert.deepEqual(waits, [1000, 4000]);
    assert.equal(form(fake.calls[0]).get("grant_type"), "refresh_token");
    assert.equal(form(fake.calls[0]).get("refresh_token"), "RT");
  });

  it("gibt nach dem dritten Versuch auf", async () => {
    const fake = fakeFetch([{ status: 500 }, { status: 502 }, { status: 503 }]);

    await assert.rejects(
      refreshAccessToken(CONFIG, "RT", { fetchImpl: fake.impl, wait: noWait }),
      (fehler: unknown) =>
        fehler instanceof GoogleTokenError && fehler.kind === "voruebergehend",
    );
    assert.equal(fake.calls.length, 3);
  });

  it("wiederholt invalid_grant nicht und nennt das Token nicht", async () => {
    const fake = fakeFetch([{ status: 400, body: { error: "invalid_grant" } }]);

    await assert.rejects(
      refreshAccessToken(CONFIG, "mein-refresh-token", { fetchImpl: fake.impl, wait: noWait }),
      (fehler: unknown) => {
        assert.ok(fehler instanceof GoogleTokenError);
        assert.equal(fehler.kind, "invalid_grant");
        assert.ok(!fehler.message.includes("mein-refresh-token"));
        return true;
      },
    );
    assert.equal(fake.calls.length, 1);
  });

  it("gibt ein rotiertes Refresh Token zurück", async () => {
    const fake = fakeFetch([{ status: 200, body: { access_token: "AT", refresh_token: "RT2" } }]);

    const tokens = await refreshAccessToken(CONFIG, "RT", { fetchImpl: fake.impl, wait: noWait });

    assert.equal(tokens.refreshToken, "RT2");
  });
});

describe("createTokenSource", () => {
  it("holt einmal und hält das Access Token für den Lauf", async () => {
    const fake = fakeFetch([
      { status: 200, body: { access_token: "AT1" } },
      { status: 200, body: { access_token: "AT2" } },
    ]);
    const tokens = createTokenSource(CONFIG, "RT", { fetchImpl: fake.impl, wait: noWait });

    assert.equal(await tokens.current(), "AT1");
    assert.equal(await tokens.current(), "AT1");
    assert.equal(fake.calls.length, 1);

    assert.equal(await tokens.renew(), "AT2");
    assert.equal(await tokens.current(), "AT2");
  });

  it("meldet ein rotiertes Refresh Token und benutzt es danach", async () => {
    const rotiert: string[] = [];
    const fake = fakeFetch([
      { status: 200, body: { access_token: "AT1", refresh_token: "RT2" } },
      { status: 200, body: { access_token: "AT2" } },
    ]);
    const tokens = createTokenSource(CONFIG, "RT1", {
      fetchImpl: fake.impl,
      wait: noWait,
      onRotate: async (neu) => {
        rotiert.push(neu);
      },
    });

    await tokens.current();
    await tokens.renew();

    assert.deepEqual(rotiert, ["RT2"]);
    assert.equal(form(fake.calls[1]).get("refresh_token"), "RT2");
  });
});

describe("staticTokenSource", () => {
  it("liefert das Token und kann nicht erneuern", async () => {
    const tokens = staticTokenSource("AT");

    assert.equal(await tokens.current(), "AT");
    await assert.rejects(
      tokens.renew(),
      (fehler: unknown) => fehler instanceof GoogleTokenError && fehler.kind === "invalid_grant",
    );
  });
});

describe("revokeToken", () => {
  it("nimmt 200 und ein schon ungültiges Token als Erfolg", async () => {
    assert.equal(await revokeToken("t", { fetchImpl: fakeFetch([{ status: 200 }]).impl }), true);
    assert.equal(
      await revokeToken("t", {
        fetchImpl: fakeFetch([{ status: 400, body: { error: "invalid_token" } }]).impl,
      }),
      true,
    );
  });

  it("wirft nie", async () => {
    assert.equal(await revokeToken("t", { fetchImpl: fakeFetch([{ status: 500 }]).impl }), false);
    assert.equal(
      await revokeToken("t", { fetchImpl: fakeFetch([new TypeError("fetch failed")]).impl }),
      false,
    );
    assert.equal(
      await revokeToken("t", { fetchImpl: fakeFetch([{ status: 400, body: "kaputt" }]).impl }),
      false,
    );
  });

  it("schickt das Token als Formular an den Revoke-Endpunkt", async () => {
    const fake = fakeFetch([{ status: 200 }]);
    await revokeToken("weg-damit", { fetchImpl: fake.impl });

    assert.equal(fake.calls[0].url, "https://oauth2.googleapis.com/revoke");
    assert.equal(form(fake.calls[0]).get("token"), "weg-damit");
  });
});
