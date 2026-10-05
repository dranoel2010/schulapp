import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { homeworkEvent, freePeriodEvent } from "@/lib/calendar/events";
import { collectWishes, SOURCES, type CalendarSource } from "@/lib/calendar/sources";

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

describe("collectWishes", () => {
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
