import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_PERIODS,
  WEEKDAYS,
  isDefaultPeriods,
  isSchoolDay,
  isoWeekNumber,
  mergeDoubleLessons,
  nextLessonDate,
  periodLabel,
  periodTimes,
  weekdayOf,
} from "@/lib/timetable";

/** Nur die Felder, die das Zusammenfassen betrachtet. */
function slot(period: number, subjectId: string) {
  return { period, subjectId };
}

describe("weekdayOf", () => {
  it("zählt von Montag bis Sonntag", () => {
    // Der 1.1.2026 ist ein Donnerstag.
    assert.equal(weekdayOf("2026-01-01"), 4);
    assert.equal(weekdayOf("2026-01-04"), 7);
    assert.equal(weekdayOf("2026-01-05"), 1);
  });

  it("kommt über den Monatswechsel", () => {
    assert.equal(weekdayOf("2026-08-31"), 1);
    assert.equal(weekdayOf("2026-09-01"), 2);
  });

  it("kommt über den Jahreswechsel", () => {
    assert.equal(weekdayOf("2026-12-31"), 4);
    assert.equal(weekdayOf("2027-01-01"), 5);
  });

  it("lässt sich von der Sommerzeit nicht verschieben", () => {
    // Umstellung 2026: 29. März (vor) und 25. Oktober (zurück), beides Sonntage.
    assert.equal(weekdayOf("2026-03-28"), 6);
    assert.equal(weekdayOf("2026-03-29"), 7);
    assert.equal(weekdayOf("2026-03-30"), 1);
    assert.equal(weekdayOf("2026-10-24"), 6);
    assert.equal(weekdayOf("2026-10-25"), 7);
    assert.equal(weekdayOf("2026-10-26"), 1);
  });
});

describe("isSchoolDay", () => {
  it("gilt von Montag bis Freitag", () => {
    assert.equal(isSchoolDay("2026-01-05"), true);
    assert.equal(isSchoolDay("2026-01-09"), true);
    assert.equal(isSchoolDay("2026-01-10"), false);
    assert.equal(isSchoolDay("2026-01-11"), false);
  });
});

describe("isoWeekNumber", () => {
  it("zählt die Woche mit dem ersten Donnerstag als erste", () => {
    // Der 1.1.2026 ist selbst ein Donnerstag, also schon Woche 1.
    assert.equal(isoWeekNumber("2026-01-01"), 1);
    assert.equal(isoWeekNumber("2026-09-07"), 37);
  });

  it("schlägt den Jahresanfang der Vorwoche zu", () => {
    // Der 1.1.2027 ist ein Freitag: seine Woche gehört noch zu 2026.
    assert.equal(isoWeekNumber("2027-01-01"), 53);
  });

  it("schlägt das Jahresende der ersten Woche zu", () => {
    // Der 29.12.2025 ist ein Montag, sein Donnerstag ist der 1.1.2026.
    assert.equal(isoWeekNumber("2025-12-29"), 1);
  });

  it("kennt Jahre mit 53 Wochen", () => {
    assert.equal(isoWeekNumber("2026-12-31"), 53);
    assert.equal(isoWeekNumber("2026-12-28"), 53);
    assert.equal(isoWeekNumber("2026-12-27"), 52);
  });

  it("zählt eine Woche lang dieselbe Zahl", () => {
    for (let day = 7; day <= 13; day += 1) {
      assert.equal(isoWeekNumber(`2026-09-${String(day).padStart(2, "0")}`), 37);
    }
  });
});

describe("nextLessonDate", () => {
  it("ohne Wochentage gibt es keinen Vorschlag", () => {
    assert.equal(nextLessonDate("2026-01-05", []), null);
  });

  it("nimmt den nächstgelegenen Tag der Liste", () => {
    // Montag, 5.1.2026: Fach am Montag und Mittwoch.
    assert.equal(nextLessonDate("2026-01-05", [1, 3]), "2026-01-07");
    assert.equal(nextLessonDate("2026-01-07", [1, 3]), "2026-01-12");
    assert.equal(nextLessonDate("2026-01-05", [5, 2]), "2026-01-06");
  });

  it("überspringt den Ausgangstag selbst", () => {
    // Heute aufgegeben, heute wieder fällig gäbe es nicht — erst nächste Woche.
    assert.equal(nextLessonDate("2026-01-05", [1]), "2026-01-12");
  });

  it("kommt über Monats-, Jahres- und Zeitumstellungsgrenzen", () => {
    assert.equal(nextLessonDate("2026-08-31", [2]), "2026-09-01");
    assert.equal(nextLessonDate("2026-12-31", [1]), "2027-01-04");
    assert.equal(nextLessonDate("2026-03-27", [1, 5]), "2026-03-30");
    assert.equal(nextLessonDate("2026-10-23", [1, 5]), "2026-10-26");
  });

  it("übergeht unmögliche Wochentage", () => {
    assert.equal(nextLessonDate("2026-01-05", [0, 9]), null);
    assert.equal(nextLessonDate("2026-01-05", [0, 3]), "2026-01-07");
  });
});

describe("mergeDoubleLessons", () => {
  it("fasst zwei aufeinanderfolgende Stunden desselben Fachs zusammen", () => {
    const blocks = mergeDoubleLessons([slot(1, "ma"), slot(2, "ma")]);

    assert.deepEqual(
      blocks.map((block) => [block.from, block.to]),
      [[1, 2]],
    );
    assert.equal(blocks[0]?.lesson.period, 1);
  });

  it("trennt bei einer Lücke im Raster", () => {
    const blocks = mergeDoubleLessons([slot(1, "ma"), slot(3, "ma")]);

    assert.deepEqual(
      blocks.map((block) => [block.from, block.to]),
      [
        [1, 1],
        [3, 3],
      ],
    );
  });

  it("trennt beim Fachwechsel", () => {
    const blocks = mergeDoubleLessons([
      slot(1, "ma"),
      slot(2, "de"),
      slot(3, "de"),
    ]);

    assert.deepEqual(
      blocks.map((block) => [block.from, block.to, block.lesson.subjectId]),
      [
        [1, 1, "ma"],
        [2, 3, "de"],
      ],
    );
  });

  it("kennt auch die Dreifachstunde", () => {
    const blocks = mergeDoubleLessons([
      slot(3, "ku"),
      slot(4, "ku"),
      slot(5, "ku"),
    ]);

    assert.deepEqual(
      blocks.map((block) => [block.from, block.to]),
      [[3, 5]],
    );
  });

  it("sortiert unsortierte Eingaben selbst", () => {
    const blocks = mergeDoubleLessons([
      slot(4, "ma"),
      slot(1, "de"),
      slot(3, "ma"),
    ]);

    assert.deepEqual(
      blocks.map((block) => [block.from, block.to, block.lesson.subjectId]),
      [
        [1, 1, "de"],
        [3, 4, "ma"],
      ],
    );
  });

  it("kommt mit einem leeren Tag zurecht", () => {
    assert.deepEqual(mergeDoubleLessons([]), []);
  });

  it("lässt die Eingabe unangetastet", () => {
    const input = [slot(2, "ma"), slot(1, "de")];
    mergeDoubleLessons(input);

    assert.equal(input[0]?.period, 2);
  });
});

describe("periodLabel", () => {
  it("nennt die einzelne Stunde", () => {
    assert.equal(periodLabel(3, 3), "3. Stunde");
  });

  it("nennt die Doppelstunde als Spanne", () => {
    assert.equal(periodLabel(3, 4), "3.–4. Stunde");
    assert.equal(periodLabel(3, 5), "3.–5. Stunde");
  });
});

describe("DEFAULT_PERIODS", () => {
  it("hat zehn lückenlos durchnummerierte Stunden", () => {
    assert.equal(DEFAULT_PERIODS.length, 10);
    assert.deepEqual(
      DEFAULT_PERIODS.map((period) => period.number),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
  });

  it("endet jede Stunde nach ihrem Beginn und vor der nächsten", () => {
    DEFAULT_PERIODS.forEach((period, index) => {
      assert.ok(period.startsAt < period.endsAt, `Stunde ${period.number}`);
      const next = DEFAULT_PERIODS[index + 1];
      if (next) assert.ok(period.endsAt < next.startsAt, `Pause nach ${period.number}`);
    });
  });
});

describe("WEEKDAYS", () => {
  it("sind Montag bis Freitag in dieser Reihenfolge", () => {
    assert.deepEqual(
      WEEKDAYS.map((day) => [day.value, day.short]),
      [
        [1, "Mo"],
        [2, "Di"],
        [3, "Mi"],
        [4, "Do"],
        [5, "Fr"],
      ],
    );
  });
});

describe("periodTimes", () => {
  it("findet die Zeile zu einer Stundennummer", () => {
    const times = periodTimes(DEFAULT_PERIODS);

    assert.equal(times.get(1)?.startsAt, "08:00");
    assert.equal(times.get(10)?.endsAt, "17:15");
  });

  it("kennt eine Stunde ohne Zeile im Raster nicht", () => {
    // Genau darauf verlassen sich die Ansichten: keine Zeile, keine Uhrzeit.
    assert.equal(periodTimes(DEFAULT_PERIODS).get(11), undefined);
    assert.equal(periodTimes([]).size, 0);
  });
});

describe("isDefaultPeriods", () => {
  it("erkennt die unveränderte Vorgabe", () => {
    assert.equal(isDefaultPeriods(DEFAULT_PERIODS), true);
  });

  it("erkennt eine geänderte Uhrzeit", () => {
    const rows = DEFAULT_PERIODS.map((period) => ({ ...period }));
    rows[0].startsAt = "07:45";

    assert.equal(isDefaultPeriods(rows), false);
  });

  it("erkennt ein gekürztes und ein verlängertes Raster", () => {
    assert.equal(isDefaultPeriods(DEFAULT_PERIODS.slice(0, 6)), false);
    assert.equal(
      isDefaultPeriods([...DEFAULT_PERIODS, DEFAULT_PERIODS[9]]),
      false,
    );
    assert.equal(isDefaultPeriods([]), false);
  });
});
