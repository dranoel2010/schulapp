import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays } from "@/lib/dates";
import { dueLabel, dueTone } from "@/lib/due-label";

/** Montag, 14.9.2026 — von hier zählen alle Fälle vorwärts und rückwärts. */
const TODAY = "2026-09-14";

/** Liest sich unten wie das, was der Nutzer denkt: "in drei Tagen". */
function inDays(days: number): string {
  return addDays(TODAY, days);
}

describe("dueLabel", () => {
  it("nennt die drei nahen Tage beim Namen", () => {
    assert.equal(dueLabel(TODAY, TODAY), "heute");
    assert.equal(dueLabel(inDays(1), TODAY), "morgen");
    assert.equal(dueLabel(inDays(-1), TODAY), "gestern");
  });

  it("nimmt bis Tag sechs den Wochentag", () => {
    assert.equal(dueLabel(inDays(2), TODAY), "Mi");
    assert.equal(dueLabel(inDays(3), TODAY), "Do");
    assert.equal(dueLabel(inDays(6), TODAY), "So");
  });

  it("wechselt an Tag sieben auf das Datum", () => {
    // Ab hier wäre "Mo" nicht mehr eindeutig — es gibt zwei davon in Sicht.
    assert.equal(dueLabel(inDays(7), TODAY), "21.9.");
    assert.equal(dueLabel(inDays(8), TODAY), "22.9.");
  });

  it("gibt Überfälligem sein Datum, nicht seinen Wochentag", () => {
    // "Sa" für einen vergangenen Samstag läse sich wie ein Termin, der kommt.
    assert.equal(dueLabel(inDays(-2), TODAY), "12.9.");
    assert.equal(dueLabel(inDays(-9), TODAY), "5.9.");
  });

  it("kommt über den Monatswechsel", () => {
    assert.equal(dueLabel("2026-10-01", "2026-09-30"), "morgen");
    assert.equal(dueLabel("2026-09-30", "2026-10-01"), "gestern");
    assert.equal(dueLabel("2026-10-08", "2026-09-30"), "8.10.");
  });

  it("verschiebt an der Zeitumstellung keinen Tag", () => {
    // Nacht zum 29.3.2026: eine Stunde weniger, morgen bleibt morgen.
    assert.equal(dueLabel("2026-03-29", "2026-03-28"), "morgen");
    assert.equal(dueLabel("2026-10-25", "2026-10-24"), "morgen");
  });
});

describe("dueTone", () => {
  it("warnt nur vor Überfälligem", () => {
    assert.equal(dueTone(inDays(-1), TODAY, false), "overdue");
    assert.equal(dueTone(inDays(-30), TODAY, false), "overdue");
  });

  it("hält heute für einen eigenen Fall", () => {
    assert.equal(dueTone(TODAY, TODAY, false), "today");
  });

  it("zieht die Grenze zwischen soon und later bei sieben Tagen", () => {
    // Dieselbe Grenze wie in dueLabel: "soon" ist genau das, was als
    // Wochentag dasteht, "later" das, was als Datum dasteht.
    assert.equal(dueTone(inDays(1), TODAY, false), "soon");
    assert.equal(dueTone(inDays(6), TODAY, false), "soon");
    assert.equal(dueTone(inDays(7), TODAY, false), "later");
    assert.equal(dueTone(inDays(70), TODAY, false), "later");
  });

  it("lässt erledigt alles andere schlagen", () => {
    for (const days of [-30, -1, 0, 1, 6, 7, 70]) {
      assert.equal(
        dueTone(inDays(days), TODAY, true),
        "done",
        `Tag ${days} ist abgehakt, also fertig und nicht überfällig`,
      );
    }
  });
});
