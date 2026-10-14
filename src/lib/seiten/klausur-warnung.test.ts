import assert from "node:assert/strict";
import { test } from "node:test";

import { planWarnungen, warnungText, type PlanBlockStand } from "./klausur";

const lern = (date: string, topicId: string, status = "open"): PlanBlockStand => ({ date, kind: "learn", status, topicId });
const wdh = (date: string, topicId: string, status = "open"): PlanBlockStand => ({ date, kind: "review", status, topicId });
const probe = (date: string, status = "open"): PlanBlockStand => ({ date, kind: "probe", status, topicId: null });

test("nur ein Lerntag, und er gehört schon der Probeklausur: keine Warnung", () => {
  const w = planWarnungen(["tight"], [probe("2026-10-15")], "2026-10-15", "2026-10-16", 2);
  assert.deepEqual(w, []);
  assert.equal(warnungText(w), null);
});

test("heute alle Themen als offene Lernblöcke, sonst nichts: die Warnung bleibt", () => {
  const bloecke = [lern("2026-10-18", "a"), lern("2026-10-18", "b")];
  assert.deepEqual(planWarnungen(["tight"], bloecke, "2026-10-18", "2026-10-19", 2), ["tight"]);
});

test("Sonntag vor einer Montagsklausur, heute kein Block geplant: keine Warnung", () => {
  // Plan: Mi Lernblock, Fr Probeklausur, Sa Wiederholung. Heute ist So.
  const bloecke = [lern("2026-10-14", "a"), probe("2026-10-16"), wdh("2026-10-17", "a")];
  assert.deepEqual(planWarnungen(["tight"], bloecke, "2026-10-18", "2026-10-19", 1), []);
});

test("alle Blöcke ausgelassen: keine Warnung über „Alle Lernblöcke sind gestrichen.“", () => {
  const bloecke = [lern("2026-10-14", "a", "skipped"), probe("2026-10-16", "skipped"), wdh("2026-10-17", "a", "skipped")];
  assert.deepEqual(planWarnungen(["tight"], bloecke, "2026-10-18", "2026-10-19", 1), []);
});

test("heute eine Wiederholung am letzten Tag: keine Warnung", () => {
  const bloecke = [lern("2026-10-15", "a", "done"), wdh("2026-10-17", "a")];
  assert.deepEqual(planWarnungen(["tight"], bloecke, "2026-10-17", "2026-10-18", 1), []);
});

test("heutiger Lernblock schon erledigt oder nicht alle Themen heute: keine Warnung", () => {
  assert.deepEqual(planWarnungen(["tight"], [lern("2026-10-18", "a", "done")], "2026-10-18", "2026-10-19", 1), []);
  assert.deepEqual(planWarnungen(["tight"], [lern("2026-10-18", "a")], "2026-10-18", "2026-10-19", 2), []);
});

test("andere Warnungen bleiben unberührt", () => {
  assert.deepEqual(planWarnungen(["no-days"], [], "2026-10-15", "2026-10-16", 1), ["no-days"]);
});

test("kein Tag zum Durcharbeiten, nur die Probe in den Ferien: ein Hinweis", () => {
  const w = planWarnungen(["no-days"], [lern("2026-10-22", "a"), probe("2026-11-01")], "2026-10-28", "2026-11-02", 1);
  assert.deepEqual(w, ["no-days"]);
  assert.equal(warnungText(w), "Bis zur Prüfung bleibt kein Tag zum Durcharbeiten mehr.");
});

test("„no-days“, aber ab heute steht noch ein offener Lernblock: kein Hinweis", () => {
  const bloecke = [lern("2026-11-02", "a"), probe("2026-11-02")];
  assert.deepEqual(planWarnungen(["no-days"], bloecke, "2026-10-28", "2026-11-03", 1), []);
});

test("alles durchgearbeitet und wiederholt, nur die Probe offen: kein Hinweis", () => {
  // Bild a: 6 von 7 Blöcken erledigt, die Probe am letzten Ferientag steht noch.
  const bloecke = [
    lern("2026-10-19", "a", "done"), lern("2026-10-20", "b", "done"), lern("2026-10-21", "c", "done"),
    wdh("2026-10-22", "a", "done"), wdh("2026-10-22", "b", "done"), wdh("2026-10-23", "c", "done"),
    probe("2026-11-01"),
  ];
  assert.deepEqual(planWarnungen(["no-days"], bloecke, "2026-10-28", "2026-11-02", 3), []);
});

test("verpasster Lernblock vor den Ferien, sonst alles erledigt: der Hinweis bleibt", () => {
  const bloecke = [lern("2026-10-21", "a"), wdh("2026-10-23", "a", "done"), probe("2026-11-01")];
  assert.deepEqual(planWarnungen(["no-days"], bloecke, "2026-10-28", "2026-11-02", 1), ["no-days"]);
});
