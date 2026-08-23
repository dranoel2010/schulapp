import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  berlinDay,
  daysBetween,
  formatCountdown,
  formatGerman,
  germanShortParts,
  isCalendarDate,
  isPast,
  timeInBerlin,
  todayInBerlin,
  weekdayIndex,
} from "@/lib/dates";

/**
 * `berlinDay()` und `todayInBerlin()` rechnen dasselbe und heißen verschieden.
 * Geprüft wird deshalb hier vor allem, dass sie sich nicht auseinander
 * entwickeln — und der eine Fall, für den es den zweiten Namen gibt: ein
 * Zeitpunkt, der ausdrücklich nicht „jetzt" ist.
 */
describe("berlinDay", () => {
  it("rechnet in Berliner Zeit, nicht in UTC", () => {
    // 23:30 UTC ist in Berlin schon der nächste Tag — im Sommer wie im Winter.
    // Genau daran hängt, ob ein um halb eins nachts abgehaktes Blatt den
    // richtigen Tag trägt.
    assert.equal(berlinDay(new Date("2026-08-19T23:30:00Z")), "2026-08-20");
    assert.equal(berlinDay(new Date("2026-01-01T23:30:00Z")), "2026-01-02");
    assert.equal(berlinDay(new Date("2026-08-19T21:00:00Z")), "2026-08-19");
  });

  it("liefert einen Kalendertag, wie ihn isCalendarDate() annimmt", () => {
    const tag = berlinDay(new Date("2026-02-28T12:00:00Z"));

    assert.equal(tag, "2026-02-28");
    assert.equal(isCalendarDate(tag), true);
  });

  it("ist mit todayInBerlin() dieselbe Rechnung", () => {
    const jetzt = new Date("2026-08-19T23:30:00Z");

    assert.equal(berlinDay(jetzt), todayInBerlin(jetzt));
  });
});

describe("todayInBerlin", () => {
  it("liefert ein Datum im Format YYYY-MM-DD", () => {
    assert.match(todayInBerlin(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("rechnet in Berliner Zeit, nicht in UTC", () => {
    // 23:30 UTC ist in Berlin schon der nächste Tag — im Sommer wie im Winter.
    assert.equal(todayInBerlin(new Date("2026-08-19T23:30:00Z")), "2026-08-20");
    assert.equal(todayInBerlin(new Date("2026-01-01T23:30:00Z")), "2026-01-02");
    assert.equal(todayInBerlin(new Date("2026-08-19T21:00:00Z")), "2026-08-19");
  });
});

describe("timeInBerlin", () => {
  it("liefert eine Uhrzeit im Format HH:MM", () => {
    assert.match(timeInBerlin(), /^([01]\d|2[0-3]):[0-5]\d$/);
  });

  it("rechnet in Berliner Zeit, im Sommer wie im Winter", () => {
    // Sommerzeit: UTC+2, Winterzeit: UTC+1.
    assert.equal(timeInBerlin(new Date("2026-08-20T12:37:00Z")), "14:37");
    assert.equal(timeInBerlin(new Date("2026-01-20T12:37:00Z")), "13:37");
  });

  it("schreibt die führende Null, wie sie im Stundenraster steht", () => {
    // "08:00" muss sich mit den Zeiten aus periods vergleichen lassen —
    // "8:00" wäre größer als "10:00", sobald man Zeichen für Zeichen prüft.
    assert.equal(timeInBerlin(new Date("2026-08-20T06:00:00Z")), "08:00");
    assert.equal(timeInBerlin(new Date("2026-08-19T22:05:00Z")), "00:05");
  });
});

describe("addDays", () => {
  it("zählt vorwärts und rückwärts", () => {
    assert.equal(addDays("2026-09-14", 0), "2026-09-14");
    assert.equal(addDays("2026-09-14", 1), "2026-09-15");
    assert.equal(addDays("2026-09-14", -10), "2026-09-04");
  });

  it("kommt über den Monatswechsel", () => {
    assert.equal(addDays("2026-09-30", 1), "2026-10-01");
    assert.equal(addDays("2026-10-01", -1), "2026-09-30");
    assert.equal(addDays("2026-05-31", 31), "2026-07-01");
  });

  it("kommt über den Jahreswechsel", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2027-01-01", -1), "2026-12-31");
    assert.equal(addDays("2026-12-26", 10), "2027-01-05");
  });

  it("kennt den 29. Februar im Schaltjahr", () => {
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2028-02-29", 1), "2028-03-01");
    assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  });

  it("überspringt den 29. Februar im normalen Jahr", () => {
    assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  });

  it("verschiebt bei der Umstellung auf Sommerzeit keinen Tag", () => {
    // Letzter Sonntag im März 2026: 29.3.
    assert.equal(addDays("2026-03-28", 1), "2026-03-29");
    assert.equal(addDays("2026-03-29", 1), "2026-03-30");
    assert.equal(addDays("2026-03-28", 7), "2026-04-04");
  });

  it("verschiebt bei der Umstellung auf Winterzeit keinen Tag", () => {
    // Letzter Sonntag im Oktober 2026: 25.10.
    assert.equal(addDays("2026-10-24", 1), "2026-10-25");
    assert.equal(addDays("2026-10-25", 1), "2026-10-26");
    assert.equal(addDays("2026-10-20", 10), "2026-10-30");
  });

  it("weist kaputte Eingaben ab", () => {
    assert.throws(() => addDays("14.09.2026", 1), RangeError);
    assert.throws(() => addDays("2026-13-01", 1), RangeError);
  });
});

describe("daysBetween", () => {
  it("zählt ganze Tage, auch negativ", () => {
    assert.equal(daysBetween("2026-09-14", "2026-09-14"), 0);
    assert.equal(daysBetween("2026-09-01", "2026-09-15"), 14);
    assert.equal(daysBetween("2026-09-15", "2026-09-01"), -14);
  });

  it("zählt über Monats- und Jahreswechsel", () => {
    assert.equal(daysBetween("2026-12-26", "2027-01-05"), 10);
    assert.equal(daysBetween("2028-02-27", "2028-03-01"), 3);
    assert.equal(daysBetween("2027-02-27", "2027-03-01"), 2);
  });

  it("zählt über beide Zeitumstellungen richtig", () => {
    assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
    assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
    assert.equal(daysBetween("2026-03-01", "2026-11-01"), 245);
  });
});

describe("weekdayIndex", () => {
  it("beginnt bei Montag", () => {
    assert.equal(weekdayIndex("2026-09-14"), 0); // Montag
    assert.equal(weekdayIndex("2026-08-19"), 2); // Mittwoch
    assert.equal(weekdayIndex("2026-03-29"), 6); // Sonntag
  });
});

describe("formatGerman", () => {
  it("schreibt den Tag lang aus", () => {
    assert.equal(formatGerman("2022-09-14"), "Mittwoch, 14. September");
    assert.equal(formatGerman("2026-09-14", "lang"), "Montag, 14. September");
    assert.equal(formatGerman("2026-01-01", "lang"), "Donnerstag, 1. Januar");
  });

  it("kürzt für Listen", () => {
    assert.equal(formatGerman("2022-09-14", "kurz"), "Mi, 14.9.");
    assert.equal(formatGerman("2026-12-31", "kurz"), "Do, 31.12.");
    assert.equal(formatGerman("2028-02-29", "kurz"), "Di, 29.2.");
  });
});

describe("germanShortParts", () => {
  it("trennt Wochentag und Kurzdatum", () => {
    assert.deepEqual(germanShortParts("2022-09-14"), {
      weekday: "Mi",
      dayMonth: "14.9.",
    });
    assert.deepEqual(germanShortParts("2026-12-31"), {
      weekday: "Do",
      dayMonth: "31.12.",
    });
  });

  it("kennt auch das Wochenende", () => {
    assert.equal(germanShortParts("2026-09-12").weekday, "Sa");
    assert.equal(germanShortParts("2026-09-13").weekday, "So");
  });

  it("setzt sich wieder zur Kurzform zusammen", () => {
    // Wer beide Teile nimmt, bekommt genau das, was formatGerman liefert —
    // sonst wären es doch wieder zwei Schreibweisen.
    const parts = germanShortParts("2026-09-07");

    assert.equal(
      `${parts.weekday}, ${parts.dayMonth}`,
      formatGerman("2026-09-07", "kurz"),
    );
  });
});

describe("formatCountdown", () => {
  it("nennt die nahen Tage beim Namen", () => {
    assert.equal(formatCountdown("2026-09-14", "2026-09-14"), "heute");
    assert.equal(formatCountdown("2026-09-14", "2026-09-15"), "morgen");
    assert.equal(formatCountdown("2026-09-14", "2026-09-16"), "übermorgen");
    assert.equal(formatCountdown("2026-09-14", "2026-09-13"), "gestern");
  });

  it("zählt weiter entfernte Tage", () => {
    assert.equal(formatCountdown("2026-09-14", "2026-09-19"), "in 5 Tagen");
    assert.equal(formatCountdown("2026-09-14", "2026-09-12"), "vor 2 Tagen");
    assert.equal(formatCountdown("2026-12-28", "2027-01-04"), "in 7 Tagen");
  });
});

describe("isPast", () => {
  it("gilt nur für Tage vor heute", () => {
    assert.equal(isPast("2026-09-13", "2026-09-14"), true);
    assert.equal(isPast("2026-09-14", "2026-09-14"), false);
    assert.equal(isPast("2026-09-15", "2026-09-14"), false);
  });
});
