import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DrizzleQueryError } from "drizzle-orm";

import { errorText } from "@/lib/calendar/error-text";

/**
 * Was von einem Fehler in die Karte, die Cron-Antwort und das Protokoll geht —
 * und vor allem, was nicht: die Parameter einer gescheiterten Abfrage, unter
 * denen das versiegelte Refresh Token steht.
 */

const SIEGEL = "v1.aXY.dGFn.Y2lwaGVydGV4dA";

/** Wie drizzle-orm 0.45 eine gescheiterte Abfrage meldet. */
function queryError(cause?: Error): DrizzleQueryError {
  return new DrizzleQueryError(
    'update "google_calendar_connections" set "blocked_at" = $1 where "refresh_token_enc" = $2',
    ["2026-10-05T12:00:00.000Z", SIEGEL],
    cause,
  );
}

/** Wie postgres-js einen Fehler des Servers meldet: Meldung und Code. */
function postgresError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("errorText", () => {
  it("nennt bei einer gescheiterten Abfrage den Grund, nie die Parameter", () => {
    const text = errorText(
      queryError(postgresError("terminating connection due to administrator command", "57P01")),
    );

    assert.equal(text, "terminating connection due to administrator command (57P01)");
    assert.ok(!text.includes(SIEGEL));
  });

  it("sagt ohne Grund nur, dass die Abfrage scheiterte", () => {
    const text = errorText(queryError());

    assert.equal(text, "Eine Datenbankabfrage ist gescheitert.");
  });

  it("nimmt bei PGlite die eigene Meldung, nicht die angehängten Parameter", () => {
    // PGlite hängt Abfrage und Parameter als Felder an seinen Fehler.
    const pglite = Object.assign(new Error('relation "google_calendar_events" does not exist'), {
      query: "select 1 where x = $1",
      params: [SIEGEL],
      code: "42P01",
    });

    const text = errorText(queryError(pglite));

    assert.equal(text, 'relation "google_calendar_events" does not exist (42P01)');
    assert.ok(!text.includes(SIEGEL));
  });

  it("schneidet die Parameter auch aus einer Meldung, die nicht wie drizzle aussieht", () => {
    const text = errorText(new Error(`Failed query: select $1\nparams: ${SIEGEL}`));

    assert.equal(text, "Failed query: select $1");
  });

  it("lässt gewöhnliche Meldungen stehen und kürzt lange", () => {
    assert.equal(errorText(new Error("Google nicht erreichbar.")), "Google nicht erreichbar.");
    assert.equal(errorText("schon ein Satz"), "schon ein Satz");
    assert.equal(errorText({ token: SIEGEL }), "unbekannter Fehler");

    const lang = errorText(new Error("x".repeat(1000)));
    assert.equal(lang.length, 300);
    assert.ok(lang.endsWith("…"));
  });
});
