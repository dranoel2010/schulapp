import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  eventHash,
  eventIdFor,
  examEvent,
  homeworkEvent,
  type WantedEvent,
} from "@/lib/calendar/events";
import { planSync, type EventRow, type RowState, type Step } from "@/lib/calendar/plan";

const ORIGIN = "https://treskownas.tail3a40b0.ts.net";
const TODAY = "2026-10-05";
const ALL = new Set(["klausur", "hausaufgabe", "frei"]);

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function hw(n: number, dueDate = "2026-10-10", title = `Aufgabe ${n}`): WantedEvent {
  return homeworkEvent({
    homework: { id: uuid(n), title, details: null, dueDate },
    subjectName: "Mathe",
    reminderHour: 17,
    appOrigin: ORIGIN,
  });
}

function ex(n: number, date = "2026-11-12"): WantedEvent {
  return examEvent({
    exam: { id: uuid(n), kind: "klausur", title: null, date, notes: null },
    subjectName: "Mathe",
    topics: [],
    appOrigin: ORIGIN,
  });
}

function rowFor(
  wish: WantedEvent,
  state: RowState,
  options: { generation?: number; hash?: string } = {},
): EventRow {
  const generation = options.generation ?? 0;

  return {
    key: wish.key,
    kind: wish.kind,
    eventId: eventIdFor(wish.idBase, generation),
    generation,
    hash: options.hash ?? eventHash(wish.body),
    state,
    title: wish.body.summary,
  };
}

function plan(wanted: WantedEvent[], rows: EventRow[], complete = ALL) {
  return planSync({ wanted, complete, rows, today: TODAY });
}

function only(steps: Step[]): Step {
  assert.equal(steps.length, 1, JSON.stringify(steps.map((s) => s.op)));
  return steps[0];
}

describe("planSync — die Tabelle", () => {
  it("keine Zeile, Wunsch da: anlegen mit Generation 0", () => {
    const wish = hw(1);
    const step = only(plan([wish], []).steps);

    assert.equal(step.op, "anlegen");
    assert.equal(step.eventId, eventIdFor(wish.idBase, 0));
    assert.equal(step.generation, 0);
    assert.equal(step.hash, eventHash(wish.body));
    assert.equal(step.title, wish.body.summary);
  });

  it("keine Zeile, kein Wunsch: nichts", () => {
    assert.deepEqual(plan([], []).steps, []);
  });

  it("geliefert, gleicher Hash: nichts", () => {
    const wish = hw(1);
    const result = plan([wish], [rowFor(wish, "geliefert")]);

    assert.deepEqual(result.steps, []);
    assert.equal(result.unveraendert, 1);
  });

  it("geliefert, anderer Hash: ändern unter der alten ID", () => {
    const wish = hw(1);
    const row = rowFor(wish, "geliefert", { generation: 2, hash: "alt" });
    const step = only(plan([wish], [row]).steps);

    assert.equal(step.op, "aendern");
    assert.ok(step.op === "aendern");
    assert.equal(step.eventId, row.eventId);
    assert.equal(step.generation, 2);
    assert.equal(step.nachEntfernen, null);
  });

  it("geliefert, Wunsch fehlt: löschen, erster Versuch", () => {
    const row = rowFor(hw(1), "geliefert");
    const step = only(plan([], [row]).steps);

    assert.equal(step.op, "loeschen");
    assert.ok(step.op === "loeschen");
    assert.equal(step.erneut, false);
    assert.equal(step.eventId, row.eventId);
    assert.equal(step.title, row.title);
  });

  it("entfernen, Wunsch da: ändern, und falls weg neu mit Generation + 1", () => {
    const wish = hw(1);
    const row = rowFor(wish, "entfernen", { generation: 1 });
    const step = only(plan([wish], [row]).steps);

    assert.ok(step.op === "aendern");
    assert.equal(step.eventId, row.eventId);
    assert.deepEqual(step.nachEntfernen, {
      eventId: eventIdFor(wish.idBase, 2),
      generation: 2,
    });
  });

  it("entfernen, Wunsch fehlt: löschen mit erneut", () => {
    const step = only(plan([], [rowFor(hw(1), "entfernen")]).steps);

    assert.ok(step.op === "loeschen");
    assert.equal(step.erneut, true);
  });

  it("entfernt, Wunsch da: anlegen mit Generation + 1 und neuer ID", () => {
    const wish = hw(1);
    const row = rowFor(wish, "entfernt", { generation: 0 });
    const step = only(plan([wish], [row]).steps);

    assert.equal(step.op, "anlegen");
    assert.equal(step.generation, 1);
    assert.equal(step.eventId, eventIdFor(wish.idBase, 1));
    assert.notEqual(step.eventId, row.eventId);
  });

  it("entfernt, Wunsch fehlt: nichts", () => {
    assert.deepEqual(plan([], [rowFor(hw(1), "entfernt")]).steps, []);
  });

  it("verworfen bleibt verworfen — auch bei geändertem Inhalt", () => {
    const wish = hw(1);
    const result = plan([wish], [rowFor(wish, "verworfen", { hash: "ganz-anders" })]);

    assert.deepEqual(result.steps, []);
    assert.equal(result.verworfenBekannt, 1);
  });

  it("verworfen, Wunsch fehlt: nichts", () => {
    assert.deepEqual(plan([], [rowFor(hw(1), "verworfen")]).steps, []);
  });
});

describe("planSync — Abwesenheit nur aus einer vollständigen Quelle", () => {
  it("fasst Zeilen einer unvollständigen Art nicht an", () => {
    const rows = [rowFor(hw(1), "geliefert"), rowFor(hw(2), "entfernen")];
    const result = plan([ex(3)], rows, new Set(["klausur", "frei"]));

    assert.deepEqual(
      result.steps.map((step) => step.op),
      ["anlegen"],
      "nur die Klausur — keine Hausaufgabe wird gelöscht",
    );
  });

  it("fasst Zeilen einer Art nicht an, die es im Code nicht mehr gibt", () => {
    const row: EventRow = { ...rowFor(hw(1), "geliefert"), kind: "blatt", key: "blatt-x" };

    assert.deepEqual(plan([], [row]).steps, []);
  });

  it("wirft bei einem Wunsch aus einer unvollständigen Quelle", () => {
    assert.throws(() => plan([hw(1)], [], new Set(["klausur"])));
  });
});

describe("planSync — Abhaken und wieder öffnen", () => {
  it("ergibt Generation + 1 mit neuer ID", () => {
    const wish = hw(1);

    // Abhaken: der Wunsch fehlt, die geliefert-Zeile wird gelöscht.
    const abhaken = only(plan([], [rowFor(wish, "geliefert")]).steps);
    assert.equal(abhaken.op, "loeschen");

    // Danach steht die Zeile auf „entfernt" — wieder öffnen legt neu an.
    const oeffnen = only(plan([wish], [rowFor(wish, "entfernt")]).steps);
    assert.equal(oeffnen.op, "anlegen");
    assert.equal(oeffnen.eventId, eventIdFor(wish.idBase, 1));
  });
});

describe("planSync — Fehler", () => {
  it("wirft bei einem doppelten Schlüssel", () => {
    assert.throws(() => plan([hw(1), hw(1)], []), /zweimal/);
  });

  it("wirft bei einem unbekannten Zustand", () => {
    const row = { ...rowFor(hw(1), "geliefert"), state: "irgendwas" as RowState };

    assert.throws(() => plan([hw(1)], [row]), /Unbekannter Zustand/);
    assert.throws(() => plan([], [row]), /Unbekannter Zustand/);
  });
});

describe("planSync — Reihenfolge", () => {
  it("löscht zuerst, ändert dann und legt zuletzt an", () => {
    const changed = hw(2);
    const result = plan(
      [hw(1), changed],
      [rowFor(hw(9), "geliefert"), rowFor(changed, "geliefert", { hash: "alt" })],
    );

    assert.deepEqual(
      result.steps.map((step) => step.op),
      ["loeschen", "aendern", "anlegen"],
    );
  });

  it("legt Kommendes aufsteigend an, danach Vergangenes absteigend", () => {
    const wishes = [
      hw(1, "2026-09-01"),
      hw(2, "2026-10-20"),
      hw(3, TODAY),
      hw(4, "2026-09-30"),
      hw(5, "2026-10-06"),
    ];
    const result = plan(wishes, []);

    assert.deepEqual(
      result.steps.map((step) => (step.op === "loeschen" ? "" : step.firstDay)),
      [TODAY, "2026-10-06", "2026-10-20", "2026-09-30", "2026-09-01"],
    );
  });

  it("sortiert auch das Ändern nach Dringlichkeit", () => {
    const bald = hw(1, "2026-10-07");
    const spaeter = hw(2, "2026-12-01");
    const vorbei = hw(3, "2026-09-01");
    const result = plan(
      [spaeter, vorbei, bald],
      [bald, spaeter, vorbei].map((wish) => rowFor(wish, "geliefert", { hash: "alt" })),
    );

    assert.deepEqual(
      result.steps.map((step) => step.key),
      [bald.key, spaeter.key, vorbei.key],
    );
  });
});
