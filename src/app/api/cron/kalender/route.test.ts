import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { GET } from "@/app/api/cron/kalender/route";

/**
 * Die Tür zum stündlichen Abgleich mit Google.
 *
 * Geprüft werden nur die Wege, die vor der ersten Abfrage enden: das fehlende
 * Geheimnis und die Anmeldung. Alles dahinter liest die Datenbank — und ein
 * Test, der dorthin käme, öffnete PGlite auf .data, die Datenbank des Nutzers.
 * Wann ein Lauf als Fehlschlag gilt, prüft report.test.ts an `cronFailure()`.
 */

describe("GET /api/cron/kalender", () => {
  const vorher = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "geheim";
  });

  afterEach(() => {
    if (vorher === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = vorher;
  });

  function anfrage(header?: string): Request {
    return new Request("http://localhost:3000/api/cron/kalender", {
      headers: header ? { authorization: header } : {},
    });
  }

  it("antwortet mit 500, wenn CRON_SECRET fehlt", async () => {
    delete process.env.CRON_SECRET;

    const antwort = await GET(anfrage("Bearer geheim"));

    assert.equal(antwort.status, 500);
    assert.deepEqual(await antwort.json(), { ok: false, error: "CRON_SECRET fehlt." });
  });

  it("weist eine Anfrage ohne das Geheimnis ab", async () => {
    const antwort = await GET(anfrage());

    assert.equal(antwort.status, 401);
    assert.deepEqual(await antwort.json(), { ok: false, error: "Nicht erlaubt." });
  });

  it("weist ein falsches Geheimnis ab", async () => {
    assert.equal((await GET(anfrage("Bearer falsch"))).status, 401);
    assert.equal((await GET(anfrage("Bearer geheimer"))).status, 401);
  });
});
