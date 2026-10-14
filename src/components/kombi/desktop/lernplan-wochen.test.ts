import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { montagVon, streifenWochen } from "./lernplan-wochen";

/**
 * Der Lernplan als Wochenstreifen am Rechner: kein Block fällt heraus, auch
 * wenn der Plan eine Woche vor der Klausur beginnt oder am Wochenende liegt.
 */
describe("Lernplan-Streifen: Wochen", () => {
  it("Montag einer Woche", () => {
    assert.equal(montagVon("2026-10-14"), "2026-10-12");
    assert.equal(montagVon("2026-10-12"), "2026-10-12");
    assert.equal(montagVon("2026-10-18"), "2026-10-12");
  });

  it("alles in der Klausurwoche: ein Streifen Mo bis Fr", () => {
    const w = streifenWochen(["2026-10-12", "2026-10-13", "2026-10-14"], "2026-10-16");
    assert.deepEqual(w, [["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]]);
  });

  it("Vorlauf ab der Woche davor: zwei Streifen, das Wochenende nur mit Eintrag", () => {
    const tage = ["2026-10-08", "2026-10-09", "2026-10-11", "2026-10-12"];
    const w = streifenWochen(tage, "2026-10-14");
    assert.equal(w.length, 2);
    assert.deepEqual(w[0], ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-11"]);
    assert.deepEqual(w[1], ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    // jeder Tag mit Block steht in genau einem Streifen
    for (const t of tage) assert.equal(w.flat().filter((d) => d === t).length, 1, t);
  });

  it("Klausur am Montag, Probe am Sonntag davor", () => {
    const w = streifenWochen(["2026-10-15", "2026-10-16", "2026-10-18"], "2026-10-19");
    assert.deepEqual(w[0].slice(-1), ["2026-10-18"]);
    assert.equal(w[1][0], "2026-10-19");
  });

  it("ohne Blöcke: nur die Klausurwoche", () => {
    assert.deepEqual(streifenWochen([], "2026-10-21"), [["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]]);
  });
});
