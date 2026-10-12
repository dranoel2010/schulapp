import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blockAngefangen,
  blockMinuten,
  blockRest,
  blockZustand,
  fmtRest,
  type BlockUhr,
} from "@/lib/lernblock";

const T0 = new Date("2026-10-12T14:40:00.000Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

function block(teil: Partial<BlockUhr> = {}): BlockUhr {
  return {
    minutes: 25,
    status: "open",
    laeuftSeit: null,
    pausiertSeit: null,
    pauseMs: 0,
    minutenGelernt: null,
    ...teil,
  };
}

describe("Lernblock-Uhr (Plan 3.5)", () => {
  it("in Ruhe: volle Zeit, nicht angefangen", () => {
    const b = block();
    assert.equal(blockZustand(b), "ruhe");
    assert.equal(blockRest(b, T0), 25 * MIN);
    assert.equal(blockAngefangen({ laeuftSeit: null, pauseMs: 0 }), false);
  });

  it("läuft: Restzeit sinkt mit der Zeit", () => {
    const b = block({ laeuftSeit: T0 });
    assert.equal(blockZustand(b), "laeuft");
    assert.equal(blockRest(b, plus(48_000)), 25 * MIN - 48_000);
    assert.equal(fmtRest(blockRest(b, plus(48_000))), "24:12");
    assert.equal(blockAngefangen(b), true);
  });

  it("Restzeit über Pause und Neuladen: nur der gespeicherte Stand zählt", () => {
    // 5 min gelaufen, dann pausiert …
    const pausiert = block({ laeuftSeit: T0, pausiertSeit: plus(5 * MIN) });
    assert.equal(blockZustand(pausiert), "pausiert");
    // … die Pause dauert 10 min: die Uhr steht.
    assert.equal(blockRest(pausiert, plus(15 * MIN)), 20 * MIN);
    // Fortgesetzt nach 10 min Pause (Neuladen liest denselben Stand) …
    const weiter = block({ laeuftSeit: T0, pauseMs: 10 * MIN });
    assert.equal(blockRest(weiter, plus(15 * MIN)), 20 * MIN);
    // … und läuft wieder.
    assert.equal(blockRest(weiter, plus(17 * MIN)), 18 * MIN);
    assert.equal(blockMinuten(weiter, plus(17 * MIN)), 7);
  });

  it("nie unter null, Minuten höchstens die Dauer", () => {
    const b = block({ laeuftSeit: T0 });
    assert.equal(blockRest(b, plus(90 * MIN)), 0);
    assert.equal(blockMinuten(b, plus(90 * MIN)), 25);
  });

  it("erledigt: die Uhr steht bei den gezählten Minuten", () => {
    const b = block({ laeuftSeit: T0, status: "done", minutenGelernt: 23 });
    assert.equal(blockZustand(b), "erledigt");
    assert.equal(blockRest(b, plus(90 * MIN)), 2 * MIN);
  });

  it("eine Pause allein macht ihn angefangen", () => {
    assert.equal(blockAngefangen({ laeuftSeit: null, pauseMs: 1 }), true);
  });
});
