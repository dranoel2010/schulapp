import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, daysBetween } from "@/lib/dates";
import {
  buildPlan,
  replanOpen,
  studyDaysFor,
  type PlanInput,
  type PlanKind,
  type PlannedBlock,
  type PlanTopic,
} from "@/lib/study-plan";

function topics(count: number): PlanTopic[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `t${index + 1}`,
    title: `Thema ${index + 1}`,
  }));
}

function plan(overrides: Partial<PlanInput> & { examDate: string }): PlanInput {
  return {
    today: "2026-05-01",
    topics: topics(5),
    leadDays: 10,
    minutesPerDay: 45,
    ...overrides,
  };
}

/** Alle Tage von `from` bis `to`, beide eingeschlossen. */
function range(from: string, to: string): string[] {
  const days: string[] = [];
  for (let i = 0; i <= daysBetween(from, to); i += 1) days.push(addDays(from, i));
  return days;
}

function datesOf(blocks: PlannedBlock[], kind?: PlanKind): string[] {
  return blocks.filter((b) => !kind || b.kind === kind).map((b) => b.date);
}

function byDay(blocks: PlannedBlock[]): Map<string, PlannedBlock[]> {
  const map = new Map<string, PlannedBlock[]>();
  for (const block of blocks) {
    const list = map.get(block.date);
    if (list) list.push(block);
    else map.set(block.date, [block]);
  }
  return map;
}

/**
 * R5: kein Block unter zehn Minuten, und ein Tag wird nicht länger als geplant.
 * Nur der überfüllte Tag darf überziehen — dort gewinnt die Zehn-Minuten-Grenze,
 * sonst stünden Fünf-Minuten-Blöcke im Plan.
 */
function assertMinutes(blocks: PlannedBlock[], minutesPerDay: number): void {
  for (const [date, dayBlocks] of byDay(blocks)) {
    const sum = dayBlocks.reduce((total, b) => total + b.minutes, 0);
    for (const block of dayBlocks) {
      assert.ok(block.minutes >= 10, `${date}: Block unter 10 Minuten`);
      assert.equal(block.minutes % 5, 0, `${date}: keine vollen 5 Minuten`);
    }
    const overfull = dayBlocks.every((b) => b.minutes === 10);
    assert.ok(
      sum <= minutesPerDay || overfull,
      `${date}: ${sum} Minuten statt höchstens ${minutesPerDay}`,
    );
  }
}

/** R6: sortOrder zählt je Tag bei 0 hoch, Lernen vor Wiederholen. */
function assertSortOrder(blocks: PlannedBlock[]): void {
  for (const [date, dayBlocks] of byDay(blocks)) {
    const sorted = [...dayBlocks].sort((a, b) => a.sortOrder - b.sortOrder);
    sorted.forEach((block, index) => {
      assert.equal(block.sortOrder, index, `${date}: Lücke in der Reihenfolge`);
    });
    const firstReview = sorted.findIndex((b) => b.kind === "review");
    if (firstReview >= 0) {
      assert.ok(
        sorted.slice(firstReview).every((b) => b.kind === "review"),
        `${date}: Wiederholung vor dem Lernen`,
      );
    }
  }
}

describe("studyDaysFor", () => {
  it("nimmt die zehn Tage vor der Prüfung, ohne den Prüfungstag", () => {
    const days = studyDaysFor({
      examDate: "2026-05-15",
      today: "2026-05-01",
      leadDays: 10,
    });

    assert.deepEqual(days, range("2026-05-05", "2026-05-14"));
    assert.ok(!days.includes("2026-05-15"));
  });

  it("beginnt heute, wenn der Vorlauf schon angebrochen ist", () => {
    const days = studyDaysFor({
      examDate: "2026-05-15",
      today: "2026-05-11",
      leadDays: 10,
    });

    assert.deepEqual(days, range("2026-05-11", "2026-05-14"));
  });

  it("gibt nichts zurück, wenn die Prüfung heute oder vorbei ist", () => {
    const base = { today: "2026-05-15", leadDays: 10 };
    assert.deepEqual(studyDaysFor({ ...base, examDate: "2026-05-15" }), []);
    assert.deepEqual(studyDaysFor({ ...base, examDate: "2026-05-10" }), []);
  });

  it("lässt ausgeschlossene Tage weg", () => {
    const days = studyDaysFor({
      examDate: "2026-05-15",
      today: "2026-05-01",
      leadDays: 10,
      excludedDates: ["2026-05-07", "2026-05-08", "2026-06-01"],
    });

    assert.equal(days.length, 8);
    assert.ok(!days.includes("2026-05-07"));
    assert.ok(!days.includes("2026-05-08"));
    assert.deepEqual(days, [...days].sort());
  });

  it("zählt über den Monatswechsel", () => {
    assert.deepEqual(
      studyDaysFor({ examDate: "2026-06-03", today: "2026-05-01", leadDays: 10 }),
      range("2026-05-24", "2026-06-02"),
    );
  });

  it("zählt über den Jahreswechsel", () => {
    assert.deepEqual(
      studyDaysFor({ examDate: "2027-01-05", today: "2026-12-01", leadDays: 10 }),
      range("2026-12-26", "2027-01-04"),
    );
  });

  it("nimmt den 29. Februar im Schaltjahr mit", () => {
    const days = studyDaysFor({
      examDate: "2028-03-05",
      today: "2028-02-01",
      leadDays: 10,
    });

    assert.deepEqual(days, range("2028-02-24", "2028-03-04"));
    assert.ok(days.includes("2028-02-29"));
    assert.equal(days.length, 10);
  });

  it("verschiebt bei der Umstellung auf Sommerzeit keinen Tag", () => {
    const days = studyDaysFor({
      examDate: "2026-04-02",
      today: "2026-03-01",
      leadDays: 10,
    });

    // Der 29.3. ist der Umstellungstag und muss genau einmal vorkommen.
    assert.deepEqual(days, range("2026-03-23", "2026-04-01"));
    assert.equal(days.filter((d) => d === "2026-03-29").length, 1);
    assert.equal(new Set(days).size, 10);
  });

  it("verschiebt bei der Umstellung auf Winterzeit keinen Tag", () => {
    const days = studyDaysFor({
      examDate: "2026-10-30",
      today: "2026-10-01",
      leadDays: 10,
    });

    assert.deepEqual(days, range("2026-10-20", "2026-10-29"));
    assert.equal(days.filter((d) => d === "2026-10-25").length, 1);
    assert.equal(new Set(days).size, 10);
  });
});

describe("buildPlan — Normalfall", () => {
  const input = plan({ examDate: "2026-05-15" });
  const result = buildPlan(input);

  it("hat zehn Lerntage, davon zwei zum Wiederholen", () => {
    assert.equal(result.studyDays.length, 10);
    assert.deepEqual(result.reviewDays, ["2026-05-13", "2026-05-14"]);
    assert.deepEqual(result.warnings, []);
  });

  it("lernt jedes Thema einmal und wiederholt es einmal", () => {
    assert.equal(result.blocks.length, 10);
    for (const topic of input.topics) {
      const own = result.blocks.filter((b) => b.topicId === topic.id);
      assert.equal(own.filter((b) => b.kind === "learn").length, 1);
      assert.equal(own.filter((b) => b.kind === "review").length, 1);
    }
  });

  it("legt keinen Block auf den Prüfungstag oder danach", () => {
    for (const block of result.blocks) {
      assert.ok(
        daysBetween(block.date, input.examDate) > 0,
        `${block.date} liegt nicht vor der Prüfung`,
      );
    }
  });

  it("wiederholt nur an den Wiederholungstagen", () => {
    for (const block of result.blocks) {
      const isReviewDay = result.reviewDays.includes(block.date);
      assert.equal(block.kind === "review", isReviewDay);
    }
  });

  it("verteilt die Themen über den ganzen Zeitraum", () => {
    const learnDates = [...new Set(datesOf(result.blocks, "learn"))].sort();

    // Nicht alles vorne: der letzte Lernblock liegt in der zweiten Hälfte.
    assert.ok(learnDates.length >= 4);
    assert.ok(
      daysBetween(result.studyDays[0], learnDates[learnDates.length - 1]) >= 5,
      "die Themen kleben am Anfang",
    );
    // Und kein Tag trägt mehr als einen Lernblock, solange Platz ist.
    for (const dates of byDay(result.blocks).values()) {
      assert.ok(dates.filter((b) => b.kind === "learn").length <= 1);
    }
  });

  it("hält sich an Minuten und Reihenfolge", () => {
    assertMinutes(result.blocks, input.minutesPerDay);
    assertSortOrder(result.blocks);
  });
});

describe("buildPlan — knappe Zeiträume", () => {
  it("Prüfung morgen: ein Lerntag, keine Wiederholung, Warnung", () => {
    const result = buildPlan(plan({ examDate: "2026-05-02" }));

    assert.deepEqual(result.studyDays, ["2026-05-01"]);
    assert.deepEqual(result.reviewDays, []);
    assert.deepEqual(result.warnings, ["tight"]);
    assert.equal(result.blocks.length, 5);
    assert.ok(result.blocks.every((b) => b.kind === "learn"));
    assert.ok(result.blocks.every((b) => b.date === "2026-05-01"));
    assertSortOrder(result.blocks);
  });

  it("Prüfung übermorgen: ein Lerntag und ein Wiederholungstag", () => {
    const result = buildPlan(plan({ examDate: "2026-05-03" }));

    assert.deepEqual(result.studyDays, ["2026-05-01", "2026-05-02"]);
    assert.deepEqual(result.reviewDays, ["2026-05-02"]);
    assert.deepEqual(result.warnings, []);
    assert.equal(datesOf(result.blocks, "learn").length, 5);
    assert.equal(datesOf(result.blocks, "review").length, 5);
    assert.ok(datesOf(result.blocks, "learn").every((d) => d === "2026-05-01"));
    assert.ok(datesOf(result.blocks, "review").every((d) => d === "2026-05-02"));
  });

  it("drei Lerntage: nur der letzte ist Wiederholungstag", () => {
    const result = buildPlan(plan({ examDate: "2026-05-04" }));

    assert.deepEqual(result.studyDays, [
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
    assert.deepEqual(result.reviewDays, ["2026-05-03"]);
  });

  it("vier Lerntage: die letzten zwei sind Wiederholungstage", () => {
    const result = buildPlan(plan({ examDate: "2026-05-05" }));

    assert.deepEqual(result.reviewDays, ["2026-05-03", "2026-05-04"]);
  });

  it("Prüfung heute: leerer Plan", () => {
    const result = buildPlan(plan({ examDate: "2026-05-01" }));

    assert.deepEqual(result.blocks, []);
    assert.deepEqual(result.studyDays, []);
    assert.deepEqual(result.warnings, ["no-days"]);
  });

  it("Prüfung vorbei: leerer Plan", () => {
    const result = buildPlan(plan({ examDate: "2026-04-20" }));

    assert.deepEqual(result.blocks, []);
    assert.deepEqual(result.warnings, ["no-days"]);
  });
});

describe("buildPlan — Themen", () => {
  it("ohne Themen bleibt der Plan leer", () => {
    const result = buildPlan(plan({ examDate: "2026-05-15", topics: [] }));

    assert.deepEqual(result.blocks, []);
    assert.deepEqual(result.warnings, ["no-topics"]);
    assert.equal(result.studyDays.length, 10);
  });

  it("ein einziges Thema wird gelernt und wiederholt", () => {
    const result = buildPlan(plan({ examDate: "2026-05-15", topics: topics(1) }));

    assert.equal(result.blocks.length, 2);
    assert.deepEqual(
      result.blocks.map((b) => b.kind),
      ["learn", "review"],
    );
    assert.equal(result.blocks[0].date, "2026-05-05");
    assert.equal(result.blocks[1].date, "2026-05-13");
    assert.ok(result.blocks.every((b) => b.minutes === 45));
  });

  it("mehr Themen als Lerntage: mehrere Blöcke pro Tag", () => {
    const input = plan({ examDate: "2026-05-05", topics: topics(7) });
    const result = buildPlan(input);

    assert.equal(result.studyDays.length, 4);
    assert.equal(result.blocks.length, 14);
    for (const topic of input.topics) {
      assert.equal(result.blocks.filter((b) => b.topicId === topic.id).length, 2);
    }
    assertMinutes(result.blocks, input.minutesPerDay);
    assertSortOrder(result.blocks);
  });

  it("überfüllter Tag: jeder Block behält seine zehn Minuten", () => {
    const input = plan({ examDate: "2026-05-03", topics: topics(6) });
    const result = buildPlan(input);

    const firstDay = result.blocks.filter((b) => b.date === "2026-05-01");
    assert.equal(firstDay.length, 6);
    assert.ok(firstDay.every((b) => b.minutes === 10));
    assertMinutes(result.blocks, input.minutesPerDay);
  });

  it("verteilt viele Themen gleichmäßig statt vorne gedrängt", () => {
    const result = buildPlan(plan({ examDate: "2026-05-15", topics: topics(8) }));
    const learnPerDay = result.studyDays
      .filter((d) => !result.reviewDays.includes(d))
      .map((d) => result.blocks.filter((b) => b.date === d && b.kind === "learn").length);

    // Acht Themen auf acht Lerntage: genau einer pro Tag.
    assert.deepEqual(learnPerDay, [1, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe("buildPlan — Minuten und Ausschlusstage", () => {
  it("teilt die Tagesminuten unter den Blöcken auf", () => {
    const input = plan({ examDate: "2026-05-15", minutesPerDay: 60 });
    const result = buildPlan(input);
    const reviewDay = result.blocks.filter((b) => b.date === "2026-05-13");

    assert.equal(reviewDay.length, 3);
    assert.ok(reviewDay.every((b) => b.minutes === 20));
    assertMinutes(result.blocks, 60);
  });

  it("hält die Tagessumme auch bei krummen Zeiten ein", () => {
    for (const minutesPerDay of [30, 45, 50, 60, 90]) {
      for (const count of [1, 2, 3, 4, 5, 9]) {
        const input = plan({
          examDate: "2026-05-15",
          minutesPerDay,
          topics: topics(count),
        });
        assertMinutes(buildPlan(input).blocks, minutesPerDay);
      }
    }
  });

  it("plant nicht an ausgeschlossenen Tagen", () => {
    const input = plan({
      examDate: "2026-05-15",
      excludedDates: ["2026-05-06", "2026-05-13"],
    });
    const result = buildPlan(input);

    assert.equal(result.studyDays.length, 8);
    assert.ok(!result.blocks.some((b) => b.date === "2026-05-06"));
    assert.ok(!result.blocks.some((b) => b.date === "2026-05-13"));
    assert.deepEqual(result.reviewDays, ["2026-05-12", "2026-05-14"]);
  });
});

describe("buildPlan — Kalendergrenzen", () => {
  it("plant über den Jahreswechsel", () => {
    const result = buildPlan(plan({ examDate: "2027-01-05", today: "2026-12-20" }));

    assert.deepEqual(result.studyDays, range("2026-12-26", "2027-01-04"));
    assert.equal(result.blocks.length, 10);
    assert.ok(result.blocks.some((b) => b.date.startsWith("2027-01")));
  });

  it("plant über den 29. Februar", () => {
    const result = buildPlan(plan({ examDate: "2028-03-05", today: "2028-02-20" }));

    assert.ok(result.studyDays.includes("2028-02-29"));
    assert.equal(result.studyDays.length, 10);
  });

  it("plant über die Zeitumstellung ohne Lücke oder Dopplung", () => {
    for (const [examDate, today] of [
      ["2026-04-02", "2026-03-20"],
      ["2026-10-30", "2026-10-15"],
    ]) {
      const result = buildPlan(plan({ examDate, today }));
      assert.equal(result.studyDays.length, 10);
      assert.equal(new Set(result.studyDays).size, 10);
      result.studyDays.forEach((day, index) => {
        if (index > 0) {
          assert.equal(day, addDays(result.studyDays[index - 1], 1));
        }
      });
    }
  });
});

describe("buildPlan — Verlässlichkeit", () => {
  it("liefert bei gleicher Eingabe immer dasselbe Ergebnis", () => {
    const input = plan({ examDate: "2026-05-15", topics: topics(6) });
    assert.deepEqual(buildPlan(input), buildPlan(input));
  });

  it("gibt die Blöcke nach Datum und Reihenfolge sortiert zurück", () => {
    const result = buildPlan(plan({ examDate: "2026-05-15", topics: topics(9) }));

    result.blocks.forEach((block, index) => {
      if (index === 0) return;
      const before = result.blocks[index - 1];
      const step = daysBetween(before.date, block.date);
      assert.ok(step > 0 || (step === 0 && block.sortOrder > before.sortOrder));
    });
  });
});

describe("replanOpen", () => {
  const open = [
    { id: "b1", topicId: "t1", kind: "learn" as const },
    { id: "b2", topicId: "t2", kind: "learn" as const },
    { id: "b3", topicId: "t3", kind: "learn" as const },
    { id: "b4", topicId: "t1", kind: "review" as const },
    { id: "b5", topicId: "t2", kind: "review" as const },
  ];

  it("verteilt offene Blöcke auf die verbleibenden Tage", () => {
    const result = replanOpen({
      ...plan({ examDate: "2026-05-15", today: "2026-05-10" }),
      open,
    });

    assert.deepEqual(
      result.map((b) => b.id),
      ["b1", "b2", "b3", "b4", "b5"],
    );
    assert.deepEqual(
      result.map((b) => b.date),
      [
        "2026-05-10",
        "2026-05-11",
        "2026-05-12",
        "2026-05-13",
        "2026-05-14",
      ],
    );
    assert.ok(result.every((b) => b.sortOrder === 0));
    assert.ok(result.every((b) => b.minutes === 45));
  });

  it("rührt erledigte Blöcke nicht an", () => {
    const result = replanOpen({
      ...plan({ examDate: "2026-05-15", today: "2026-05-10" }),
      open: [open[0], open[3]],
    });

    assert.deepEqual(
      result.map((b) => b.id),
      ["b1", "b4"],
    );
  });

  it("legt Wiederholungen auf die Wiederholungstage", () => {
    const result = replanOpen({
      ...plan({ examDate: "2026-05-15", today: "2026-05-10" }),
      open,
    });
    const dates = new Map(result.map((b) => [b.id, b.date]));

    assert.deepEqual([dates.get("b4"), dates.get("b5")], [
      "2026-05-13",
      "2026-05-14",
    ]);
  });

  it("behält die Reihenfolge der Eingabe bei", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      id: `n${index}`,
      topicId: `t${index}`,
      kind: "learn" as const,
    }));
    const result = replanOpen({
      ...plan({ examDate: "2026-05-15", today: "2026-05-11" }),
      open: many,
    });

    assert.deepEqual(
      result.map((b) => b.id),
      many.map((b) => b.id),
    );
    result.forEach((block, index) => {
      if (index === 0) return;
      const before = result[index - 1];
      const step = daysBetween(before.date, block.date);
      assert.ok(step > 0 || (step === 0 && block.sortOrder > before.sortOrder));
    });
  });

  it("bringt bei wenig Zeit alles auf den letzten Tagen unter", () => {
    const result = replanOpen({
      ...plan({ examDate: "2026-05-12", today: "2026-05-11" }),
      open,
    });

    // Nur noch der 11.5. ist übrig — dann liegt eben alles dort.
    assert.ok(result.every((b) => b.date === "2026-05-11"));
    assert.deepEqual(
      result.map((b) => b.sortOrder),
      [0, 1, 2, 3, 4],
    );
    assert.ok(result.every((b) => b.minutes >= 10));
  });

  it("legt alles auf heute, wenn die Prüfung schon läuft", () => {
    const result = replanOpen({
      ...plan({ examDate: "2026-05-11", today: "2026-05-11" }),
      open,
    });

    assert.ok(result.every((b) => b.date === "2026-05-11"));
    assert.equal(result.length, 5);
  });

  it("gibt ohne offene Blöcke nichts zurück", () => {
    const result = replanOpen({
      ...plan({ examDate: "2026-05-15", today: "2026-05-10" }),
      open: [],
    });

    assert.deepEqual(result, []);
  });

  it("hält auch beim Nachholen die Minutenregel ein", () => {
    const result = replanOpen({
      ...plan({ examDate: "2026-05-14", today: "2026-05-11" }),
      open,
    });

    for (const [, blocks] of byDay(
      result.map((b) => ({ ...b, topicId: null, kind: "learn" as const })),
    )) {
      const sum = blocks.reduce((total, b) => total + b.minutes, 0);
      assert.ok(blocks.every((b) => b.minutes >= 10 && b.minutes % 5 === 0));
      assert.ok(sum <= 45 || blocks.every((b) => b.minutes === 10));
    }
  });
});

describe("belegte Tage", () => {
  const base = {
    examDate: "2026-09-14",
    today: "2026-09-08",
    leadDays: 10,
    minutesPerDay: 45,
    topics: topics(3),
  };

  it("weicht auf freie Tage aus, wenn ein Tag schon voll gelernt ist", () => {
    const open = [
      { id: "a", topicId: "t1", kind: "learn" as PlanKind },
      { id: "b", topicId: "t2", kind: "learn" as PlanKind },
    ];

    const ohne = replanOpen({ ...base, open });
    assert.ok(
      ohne.some((slot) => slot.date === "2026-09-08"),
      "ohne Belegung wird heute mitgeplant",
    );

    // Heute wurden die 45 Minuten schon verbraucht.
    const mit = replanOpen({
      ...base,
      open,
      occupied: { "2026-09-08": 45 },
    });
    assert.ok(
      mit.every((slot) => slot.date !== "2026-09-08"),
      "der volle Tag bleibt frei",
    );
  });

  it("hält das Tagesbudget ein, wenn ein Tag halb belegt ist", () => {
    // Nur ein einziger Lerntag übrig, und der ist zur Hälfte verbraucht.
    const slots = replanOpen({
      ...base,
      examDate: "2026-09-09",
      today: "2026-09-08",
      open: [{ id: "a", topicId: "t1", kind: "learn" }],
      occupied: { "2026-09-08": 30 },
    });

    assert.equal(slots.length, 1);
    assert.equal(slots[0].date, "2026-09-08");
    assert.equal(slots[0].minutes, 15, "30 verbraucht + 15 neu = 45");
  });

  it("plant trotzdem, wenn jeder verbleibende Tag voll ist", () => {
    const slots = replanOpen({
      ...base,
      examDate: "2026-09-09",
      today: "2026-09-08",
      open: [{ id: "a", topicId: "t1", kind: "learn" }],
      occupied: { "2026-09-08": 45 },
    });

    assert.equal(slots.length, 1, "ein Thema geht nie verloren");
    assert.equal(slots[0].date, "2026-09-08");
    assert.equal(slots[0].minutes, 10, "wenigstens die Untergrenze");
  });

  it("verkleinert auch in buildPlan die Blöcke eines belegten Tages", () => {
    const plan = buildPlan({
      ...base,
      examDate: "2026-09-09",
      today: "2026-09-08",
      topics: topics(1),
      occupied: { "2026-09-08": 25 },
    });

    assert.equal(plan.blocks.length, 1);
    assert.equal(plan.blocks[0].minutes, 20, "45 minus 25 verbraucht");
  });
});
