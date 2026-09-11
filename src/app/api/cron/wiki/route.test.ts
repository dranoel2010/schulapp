import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { GET, handoverFailure } from "@/app/api/cron/wiki/route";
import { WIKI_EXPORT_DIR_ENV, type WikiRunSummary } from "@/lib/wiki/run";

/**
 * Die Tür zur Wiki-Übergabe: die Anmeldung, die Umgebungsvariable und — der
 * eigentliche Anlass dieser Datei — die Frage, wann ein Lauf als Fehlschlag
 * gemeldet wird.
 *
 * Der Fehler, den sie festhält: `/api/cron/wiki` antwortete `{ ok: true }` mit
 * HTTP 200, auch wenn die Übergabe vollständig gescheitert war. `summary.failed`
 * wurde nirgends gelesen. Das `curl` des Auslösers auf dem NAS endete damit mit
 * 0, im Protokoll stand `exit=0` neben einem `ok: true`, und die Störungsnotiz
 * im Vault — die einzige Meldung, die von selbst auffällt — blieb aus, während
 * dort nichts ankam.
 *
 * ── Was hier NICHT geprüft werden kann ───────────────────────────────────────
 *
 * Der Weg durch `GET()` bis zu genau diesem 500 lässt sich ohne Datenbank nicht
 * gehen: `runWikiHandover()` liest die Nutzertabelle und trägt je Nutzer den
 * ganzen Bestand zusammen, und ein `failed` entsteht erst, wenn dabei etwas
 * wirft. Ein nachgebauter `@/db` wäre kein Beweis, sondern eine zweite
 * Behauptung. Deshalb zerfällt die Prüfung in zwei Hälften: `handoverFailure()`
 * ist rein und wird hier vollständig durchgespielt, und `GET()` wird auf den
 * Wegen geprüft, die vor der ersten Abfrage enden — die Anmeldung, die fehlende
 * Umgebungsvariable und der fehlende Übergabeordner (`assertHandoverRoot()`
 * läuft als Allererstes im Lauf, noch vor `db.select()`).
 */

/** Eine Zusammenfassung, wie ein sauberer Lauf sie zurückgibt. */
function summary(overrides: Partial<WikiRunSummary> = {}): WikiRunSummary {
  return {
    date: "2026-09-05",
    folder: "2026-09-05",
    users: 1,
    failed: 0,
    neu: 3,
    geaendert: 1,
    entfallen: 0,
    unveraendert: 12,
    ...overrides,
  };
}

describe("handoverFailure", () => {
  it("meldet den Totalausfall als Fehlschlag", () => {
    // Der gemessene Zustand: Bei einem einzigen Konto wirft `planForUser()`,
    // @/lib/wiki/run zählt `failed += 1`, `plans` bleibt leer, der Lauf kehrt
    // vor `writeHandover()` zurück — `folder: null, users: 1, failed: 1`.
    // Vorher war das HTTP 200 mit `ok: true`.
    const satz = handoverFailure(summary({ folder: null, failed: 1, neu: 0, geaendert: 0 }));

    assert.notEqual(satz, null);
  });

  it("nennt die Zahlen und den Weg zum Grund", () => {
    // Der Satz ist alles, was im Protokoll des Auslösers und in der
    // Störungsnotiz im Vault steht. Ohne die Zahlen wäre er eine Behauptung,
    // ohne den Verweis aufs Container-Protokoll eine Sackgasse.
    const satz = handoverFailure(
      summary({ folder: null, failed: 1, users: 1, neu: 0, geaendert: 0 }),
    );

    assert.ok(satz !== null);
    assert.ok(satz.includes("1 von 1 Konto"), satz);
    assert.ok(satz.includes("Kein Übergabeordner geschrieben"), satz);
    assert.ok(satz.includes("docker compose logs"), satz);
  });

  it("schreibt die Mehrzahl in der Mehrzahl", () => {
    const satz = handoverFailure(summary({ folder: null, failed: 2, users: 3 }));

    assert.ok(satz !== null);
    assert.ok(satz.includes("2 von 3 Konten"), satz);
  });

  it("lässt einen Tag ohne Änderungen grün", () => {
    // Kein Ordner UND kein Fehler ist der Normalfall: Es gab nichts zu
    // übergeben, und dafür wird absichtlich kein leerer Ordner angelegt.
    assert.equal(
      handoverFailure(summary({ folder: null, neu: 0, geaendert: 0, entfallen: 0 })),
      null,
    );
  });

  it("lässt den fehlenden Abdruck grün", () => {
    // `failed` aus der ZWEITEN Schleife in @/lib/wiki/run (`recordDeliveries()`)
    // heißt: Der Ordner steht, nur der Abdruck in `wiki_deliveries` fehlt. Das
    // ist die Richtung, in die dieser Vorgang irren darf — der nächste Lauf
    // liefert dieselben Dateien unter denselben Kennungen noch einmal. Ein 500
    // dafür wäre ein Fehlalarm für einen Zustand, der sich selbst heilt.
    assert.equal(handoverFailure(summary({ folder: "2026-09-05", failed: 1 })), null);
  });

  it("meldet einen sauberen Lauf als Erfolg", () => {
    assert.equal(handoverFailure(summary()), null);
  });
});

describe("GET", () => {
  const vorher = {
    secret: process.env.CRON_SECRET,
    dir: process.env[WIKI_EXPORT_DIR_ENV],
  };

  beforeEach(() => {
    process.env.CRON_SECRET = "geheim";
    delete process.env[WIKI_EXPORT_DIR_ENV];
  });

  afterEach(() => {
    setEnv("CRON_SECRET", vorher.secret);
    setEnv(WIKI_EXPORT_DIR_ENV, vorher.dir);
  });

  function anfrage(header?: string): Request {
    return new Request("http://localhost:3000/api/cron/wiki", {
      headers: header ? { authorization: header } : {},
    });
  }

  it("weist eine Anfrage ohne das Geheimnis ab", async () => {
    const antwort = await GET(anfrage());

    assert.equal(antwort.status, 401);
    assert.deepEqual(await antwort.json(), { ok: false, error: "Nicht erlaubt." });
  });

  it("weist ein falsches Geheimnis ab", async () => {
    assert.equal((await GET(anfrage("Bearer falsch"))).status, 401);
    assert.equal((await GET(anfrage("Bearer geheimer"))).status, 401);
  });

  it("antwortet mit 500, wenn CRON_SECRET fehlt", async () => {
    delete process.env.CRON_SECRET;

    const antwort = await GET(anfrage("Bearer geheim"));

    assert.equal(antwort.status, 500);
  });

  it("antwortet mit 500, wenn der Übergabeordner nicht eingetragen ist", async () => {
    // Kein „ok, nichts zu tun": Ein grüner Lauf, der jede Nacht nichts tut,
    // fiele niemandem auf.
    const antwort = await GET(anfrage("Bearer geheim"));
    const rumpf = (await antwort.json()) as { ok: boolean; error: string };

    assert.equal(antwort.status, 500);
    assert.equal(rumpf.ok, false);
    assert.ok(rumpf.error.includes(WIKI_EXPORT_DIR_ENV), rumpf.error);
  });

  it("antwortet mit 500 und dem Satz, wenn es den Ordner nicht gibt", async () => {
    // Der Wurf aus `assertHandoverRoot()` — die erste Handlung des Laufs,
    // noch vor jeder Abfrage. Der Satz aus dem Fehler ist die eigentliche
    // Auskunft; ohne das Auffangen im Handler stünde im Protokoll und in der
    // Störungsnotiz eine HTML-Seite mit einem Serverfehler.
    process.env[WIKI_EXPORT_DIR_ENV] = "/gibt/es/nicht/schulapp-uebergabe";

    // Der Handler protokolliert den Wurf, und das soll er auch. Im Testlauf
    // wäre es ein Stapelabzug mitten in der Liste der grünen Haken — genau da,
    // wo man einen echten Fehlschlag sucht.
    const laut = console.error;
    console.error = () => {};

    let antwort: Response;
    try {
      antwort = await GET(anfrage("Bearer geheim"));
    } finally {
      console.error = laut;
    }

    const rumpf = (await antwort.json()) as { ok: boolean; error: string };

    assert.equal(antwort.status, 500);
    assert.equal(rumpf.ok, false);
    assert.ok(rumpf.error.includes("/gibt/es/nicht/schulapp-uebergabe"), rumpf.error);
  });
});

/** `process.env.X = undefined` schriebe die Zeichenkette „undefined". */
function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
