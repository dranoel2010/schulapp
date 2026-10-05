import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { homeworkEvent, freePeriodEvent } from "@/lib/calendar/events";
import {
  activeSources,
  collectWishes,
  iservSource,
  SOURCES,
  type CalendarSource,
} from "@/lib/calendar/sources";

/**
 * Die echten Quellen lesen die Datenbank und werden hier deshalb NICHT
 * aufgerufen — ein Aufruf öffnete PGlite auf .data, die Datenbank des
 * Nutzers. Geprüft wird, welche es gibt, und mit Attrappen, wie
 * `collectWishes()` mit einer scheiternden umgeht.
 */

const CTX = { userId: "u", reminderHour: 17, appOrigin: "https://example.test" };

const homework: CalendarSource = {
  kind: "hausaufgabe",
  wanted: async () => [
    homeworkEvent({
      homework: {
        id: "00000000-0000-4000-8000-000000000001",
        title: "x",
        details: null,
        dueDate: "2026-10-10",
      },
      subjectName: "Mathe",
      reminderHour: 17,
      appOrigin: CTX.appOrigin,
    }),
  ],
};

const free: CalendarSource = {
  kind: "frei",
  wanted: async () => [
    freePeriodEvent({
      period: {
        id: "00000000-0000-4000-8000-000000000002",
        kind: "ferien",
        title: null,
        startsOn: "2026-10-19",
        endsOn: "2026-10-30",
      },
      appOrigin: CTX.appOrigin,
    }),
  ],
};

/** Ruhig gestellt: collectWishes() protokolliert jede gescheiterte Quelle, und das soll es auch. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const laut = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = laut;
  }
}

describe("SOURCES", () => {
  it("sind Prüfungen, Hausaufgaben und freie Tage — keine Lernblöcke, kein Abruf", () => {
    assert.deepEqual(
      SOURCES.map((source) => source.kind),
      ["klausur", "hausaufgabe", "frei"],
    );
  });
});

describe("activeSources", () => {
  it("sind ohne ISERV_* genau SOURCES — und mit allen Pflichtvariablen dazu IServ", () => {
    const namen = ["ISERV_URL", "ISERV_USER", "ISERV_PASSWORD", "ISERV_KLASSE"] as const;
    const vorher = Object.fromEntries(namen.map((name) => [name, process.env[name]]));

    try {
      for (const name of namen) delete process.env[name];
      assert.equal(activeSources(), SOURCES);

      Object.assign(process.env, {
        ISERV_URL: "https://iserv.example.test",
        ISERV_USER: "test.schueler",
        ISERV_PASSWORD: "synthetisch",
        ISERV_KLASSE: "10",
      });
      assert.deepEqual(
        activeSources().map((source) => source.kind),
        ["klausur", "hausaufgabe", "frei", "iserv"],
      );
      assert.equal(activeSources()[3], iservSource);
    } finally {
      for (const name of namen) {
        if (vorher[name] === undefined) delete process.env[name];
        else process.env[name] = vorher[name];
      }
    }
  });
});

describe("collectWishes", () => {
  it("lässt „iserv“ aus `complete`, wenn IServ noch keinen Stand hat — die Termine bleiben unberührt", async () => {
    const iserv: CalendarSource = {
      kind: "iserv",
      wanted: async () => {
        throw new Error("Noch kein Stand aus IServ — der erste Abruf steht aus oder ist gescheitert (Einstellungen → IServ).");
      },
    };

    const result = await quietly(() => collectWishes(CTX, [homework, free, iserv]));

    assert.deepEqual([...result.complete].sort(), ["frei", "hausaufgabe"]);
    assert.equal(result.errors[0].kind, "iserv");
    assert.match(result.errors[0].sentence, /Noch kein Stand aus IServ/);
  });

  it("sammelt die Wünsche aller Quellen und merkt sich, welche vollständig waren", async () => {
    const result = await collectWishes(CTX, [homework, free]);

    assert.equal(result.wanted.length, 2);
    assert.deepEqual([...result.complete].sort(), ["frei", "hausaufgabe"]);
    assert.deepEqual(result.errors, []);
  });

  it("friert nur die Art einer scheiternden Quelle ein", async () => {
    const kaputt: CalendarSource = {
      kind: "klausur",
      wanted: async () => {
        throw new Error("Datenbank weg");
      },
    };

    const result = await quietly(() => collectWishes(CTX, [kaputt, homework, free]));

    assert.deepEqual([...result.complete].sort(), ["frei", "hausaufgabe"]);
    assert.equal(result.wanted.length, 2);
    assert.deepEqual(result.errors, [{ kind: "klausur", sentence: "Datenbank weg" }]);
  });

  it("nimmt keinen einzigen Wunsch einer Quelle mit doppeltem Schlüssel", async () => {
    const doppelt: CalendarSource = {
      kind: "hausaufgabe",
      wanted: async () => [...(await homework.wanted(CTX)), ...(await homework.wanted(CTX))],
    };

    const result = await quietly(() => collectWishes(CTX, [doppelt, free]));

    assert.deepEqual([...result.complete], ["frei"]);
    assert.ok(result.wanted.every((wish) => wish.kind === "frei"));
    assert.equal(result.errors[0].kind, "hausaufgabe");
    assert.match(result.errors[0].sentence, /zweimal/);
  });

  it("lehnt einen Wunsch der falschen Art ab", async () => {
    const falsch: CalendarSource = { kind: "klausur", wanted: homework.wanted };

    const result = await quietly(() => collectWishes(CTX, [falsch]));

    assert.deepEqual([...result.complete], []);
    assert.deepEqual(result.wanted, []);
  });
});
