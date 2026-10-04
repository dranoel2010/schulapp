import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  freeDates,
  freeLabel,
  freePeriodInputSchema,
  freePeriodOn,
} from "@/lib/free-days";
import { buildPlan } from "@/lib/study-plan";

const KLASSENFAHRT = {
  kind: "klassenfahrt",
  title: null,
  startsOn: "2026-10-12",
  endsOn: "2026-10-16",
};

const HERBSTFERIEN = {
  kind: "ferien",
  title: "Herbstferien",
  startsOn: "2026-10-19",
  endsOn: "2026-10-30",
};

describe("freePeriodOn", () => {
  it("zählt beide Enden mit", () => {
    assert.equal(freePeriodOn([KLASSENFAHRT], "2026-10-12"), KLASSENFAHRT);
    assert.equal(freePeriodOn([KLASSENFAHRT], "2026-10-16"), KLASSENFAHRT);
  });

  it("lässt den Tag davor und danach frei von Ferien", () => {
    assert.equal(freePeriodOn([KLASSENFAHRT], "2026-10-11"), null);
    assert.equal(freePeriodOn([KLASSENFAHRT], "2026-10-17"), null);
  });
});

describe("freeDates", () => {
  it("zählt jeden Tag einzeln auf, sortiert und ohne Doppel", () => {
    const dates = freeDates([HERBSTFERIEN, KLASSENFAHRT, KLASSENFAHRT]);

    assert.equal(dates.length, 5 + 12);
    assert.equal(dates[0], "2026-10-12");
    assert.equal(dates.at(-1), "2026-10-30");
  });

  it("schneidet ab, was vor `from` liegt", () => {
    assert.deepEqual(freeDates([KLASSENFAHRT], "2026-10-15"), [
      "2026-10-15",
      "2026-10-16",
    ]);
  });
});

describe("freeLabel", () => {
  it("nimmt den Namen, sonst die Art", () => {
    assert.equal(freeLabel(HERBSTFERIEN), "Herbstferien");
    assert.equal(freeLabel(KLASSENFAHRT), "Klassenfahrt");
    assert.equal(freeLabel({ kind: "frei", title: null }), "Schulfrei");
  });
});

describe("freePeriodInputSchema", () => {
  it("nimmt einen einzelnen Tag an und macht aus leerem Namen null", () => {
    const parsed = freePeriodInputSchema.safeParse({
      kind: "frei",
      title: "  ",
      startsOn: "2026-10-03",
      endsOn: "2026-10-03",
    });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.title, null);
  });

  it("weist ein Ende vor dem Anfang zurück", () => {
    const parsed = freePeriodInputSchema.safeParse({
      kind: "ferien",
      startsOn: "2026-10-30",
      endsOn: "2026-10-19",
    });

    assert.equal(parsed.success, false);
  });

  it("weist einen Tippfehler im Jahr zurück", () => {
    const parsed = freePeriodInputSchema.safeParse({
      kind: "ferien",
      startsOn: "2026-10-19",
      endsOn: "2027-10-30",
    });

    assert.equal(parsed.success, false);
  });
});

describe("der Lernplan mit freien Tagen", () => {
  it("legt keinen Block auf die Klassenfahrt", () => {
    // Klausur am Montag nach der Klassenfahrt, zehn Tage Vorlauf.
    const plan = buildPlan({
      examDate: "2026-10-19",
      today: "2026-10-05",
      topics: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
        { id: "c", title: "C" },
      ],
      leadDays: 10,
      minutesPerDay: 45,
      excludedDates: freeDates([KLASSENFAHRT]),
    });

    assert.ok(plan.blocks.length > 0);
    for (const block of plan.blocks) {
      assert.equal(
        freePeriodOn([KLASSENFAHRT], block.date),
        null,
        `Block am ${block.date} liegt auf der Klassenfahrt`,
      );
    }
  });
});
