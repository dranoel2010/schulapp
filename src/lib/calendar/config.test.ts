import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_REDIRECT_URI,
  readCalendarConfig,
  type ConfigResult,
} from "@/lib/calendar/config";

/** 32 Bytes in base64 — so, wie `openssl rand -base64 32` sie ausgibt. */
const KEY = Buffer.alloc(32, 7).toString("base64");

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "geheim",
    GOOGLE_TOKEN_KEY: KEY,
    ...overrides,
  };
}

function missing(result: ConfigResult): string[] {
  assert.equal(result.ok, false);
  return result.ok ? [] : result.missing;
}

describe("readCalendarConfig", () => {
  it("nimmt ohne GOOGLE_REDIRECT_URI die Funnel-Adresse", () => {
    const result = readCalendarConfig(env());

    assert.ok(result.ok);
    assert.equal(result.config.redirectUri, DEFAULT_REDIRECT_URI);
    assert.equal(result.config.appOrigin, "https://treskownas.tail3a40b0.ts.net");
    assert.equal(result.config.tokenKey.length, 32);
  });

  it("lässt sich für die Entwicklung überschreiben", () => {
    const result = readCalendarConfig(
      env({ GOOGLE_REDIRECT_URI: "http://localhost:3000/api/google/callback" }),
    );

    assert.ok(result.ok);
    assert.equal(result.config.redirectUri, "http://localhost:3000/api/google/callback");
    assert.equal(result.config.appOrigin, "http://localhost:3000");
  });

  it("nimmt auch 127.0.0.1 mit http", () => {
    const result = readCalendarConfig(
      env({ GOOGLE_REDIRECT_URI: "http://127.0.0.1:3000/api/google/callback" }),
    );

    assert.ok(result.ok);
  });

  it("behandelt nur Leerzeichen wie nicht gesetzt", () => {
    const result = readCalendarConfig(env({ GOOGLE_REDIRECT_URI: "   " }));

    assert.ok(result.ok);
    assert.equal(result.config.redirectUri, DEFAULT_REDIRECT_URI);
  });

  it("schneidet Leerzeichen um die Werte ab", () => {
    const result = readCalendarConfig(
      env({ GOOGLE_CLIENT_ID: "  id  ", GOOGLE_TOKEN_KEY: ` ${KEY}\n` }),
    );

    assert.ok(result.ok);
    assert.equal(result.config.clientId, "id");
  });

  it("lehnt http auf einem fremden Host ab", () => {
    assert.deepEqual(
      missing(
        readCalendarConfig(
          env({ GOOGLE_REDIRECT_URI: "http://treskownas.tail3a40b0.ts.net/api/google/callback" }),
        ),
      ),
      ["GOOGLE_REDIRECT_URI (ungültig)"],
    );
  });

  it("lehnt einen falschen Pfad, eine Query, einen Hash und Unlesbares ab", () => {
    for (const uri of [
      "https://treskownas.tail3a40b0.ts.net/api/google/callback/",
      "https://treskownas.tail3a40b0.ts.net/callback",
      "https://treskownas.tail3a40b0.ts.net/api/google/callback?x=1",
      "https://treskownas.tail3a40b0.ts.net/api/google/callback?",
      "https://treskownas.tail3a40b0.ts.net/api/google/callback#oben",
      "keine adresse",
      "ftp://localhost/api/google/callback",
    ]) {
      assert.deepEqual(
        missing(readCalendarConfig(env({ GOOGLE_REDIRECT_URI: uri }))),
        ["GOOGLE_REDIRECT_URI (ungültig)"],
        uri,
      );
    }
  });

  it("verlangt genau 32 Bytes als Schlüssel", () => {
    for (const length of [31, 33, 16]) {
      assert.deepEqual(
        missing(
          readCalendarConfig(
            env({ GOOGLE_TOKEN_KEY: Buffer.alloc(length, 1).toString("base64") }),
          ),
        ),
        ["GOOGLE_TOKEN_KEY (kein 32-Byte-Schlüssel in base64)"],
        `${length} Bytes`,
      );
    }
  });

  it("lehnt einen Schlüssel ab, der kein base64 ist", () => {
    assert.deepEqual(
      missing(readCalendarConfig(env({ GOOGLE_TOKEN_KEY: `${"ä".repeat(43)}=` }))),
      ["GOOGLE_TOKEN_KEY (kein 32-Byte-Schlüssel in base64)"],
    );
  });

  it("nimmt den Schlüssel auch als base64url", () => {
    const result = readCalendarConfig(
      env({ GOOGLE_TOKEN_KEY: Buffer.alloc(32, 255).toString("base64url") }),
    );

    assert.ok(result.ok);
    assert.deepEqual(result.config.tokenKey, Buffer.alloc(32, 255));
  });

  it("nennt jede fehlende Variable, leere zählen als fehlend", () => {
    assert.deepEqual(
      missing(
        readCalendarConfig({
          GOOGLE_CLIENT_ID: "",
          GOOGLE_CLIENT_SECRET: "  ",
        }),
      ),
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY"],
    );
  });
});
