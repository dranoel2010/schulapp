import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { faellig } from "@/lib/iserv/takt";

/** Ein Zeitpunkt in Berliner Winterzeit (UTC+1), Oktober nach der Umstellung: 2026-11-02. */
const winter = (hhmm: string, tag = "2026-11-02") => new Date(`${tag}T${hhmm}:00+01:00`);
/** Sommerzeit (UTC+2). */
const sommer = (hhmm: string, tag = "2026-07-01") => new Date(`${tag}T${hhmm}:00+02:00`);

const zustand = (lastAttemptAt: Date | null, failuresInRow = 0, blockedAt: Date | null = null) => ({
  lastAttemptAt,
  failuresInRow,
  blockedAt,
});

describe("faellig", () => {
  it("der erste Abruf ist zu jeder Stunde fällig — auch um 23:15", () => {
    assert.ok(faellig({ jetzt: winter("23:15"), zustand: null, anlass: "cron" }));
    assert.ok(faellig({ jetzt: winter("03:15"), zustand: zustand(null), anlass: "cron" }));
  });

  it("nachts nicht: 05:15 nein, 06:15 ja nach dem Abend davor", () => {
    const abends = winter("21:15", "2026-11-01");
    assert.ok(!faellig({ jetzt: winter("05:15"), zustand: zustand(abends), anlass: "cron" }));
    assert.ok(faellig({ jetzt: winter("06:15"), zustand: zustand(abends), anlass: "cron" }));
    assert.ok(!faellig({ jetzt: winter("22:15"), zustand: zustand(winter("12:15")), anlass: "cron" }));
    assert.ok(faellig({ jetzt: winter("21:15"), zustand: zustand(winter("18:15")), anlass: "cron" }));
  });

  it("alle drei Stunden: 170 Minuten reichen, 120 nicht", () => {
    const um9 = winter("09:15");
    assert.ok(!faellig({ jetzt: winter("10:15"), zustand: zustand(um9), anlass: "cron" }));
    assert.ok(!faellig({ jetzt: winter("11:15"), zustand: zustand(um9), anlass: "cron" }));
    assert.ok(faellig({ jetzt: winter("12:05"), zustand: zustand(um9), anlass: "cron" }));
    assert.ok(faellig({ jetzt: winter("12:15"), zustand: zustand(um9), anlass: "cron" }));
  });

  it("höchstens sechs Abrufe am Tag, wenn der Cron jede Stunde um :15 kommt", () => {
    let letzter: Date | null = winter("21:15", "2026-11-01");
    let abrufe = 0;

    for (let stunde = 0; stunde < 24; stunde += 1) {
      const jetzt = winter(`${String(stunde).padStart(2, "0")}:15`);
      if (faellig({ jetzt, zustand: zustand(letzter), anlass: "cron" })) {
        abrufe += 1;
        letzter = jetzt;
      }
    }
    assert.equal(abrufe, 6);
  });

  it("nie zweimal in einer Stunde, auch nach einem Fehlschlag", () => {
    assert.ok(!faellig({ jetzt: winter("10:00"), zustand: zustand(winter("09:15"), 1), anlass: "cron" }));
  });

  it("nach einem Fehlschlag eine Wiederholung in der nächsten Stunde, nach zweien wieder drei Stunden", () => {
    assert.ok(faellig({ jetzt: winter("10:15"), zustand: zustand(winter("09:15"), 1), anlass: "cron" }));
    assert.ok(!faellig({ jetzt: winter("11:15"), zustand: zustand(winter("10:15"), 2), anlass: "cron" }));
    assert.ok(faellig({ jetzt: winter("13:15"), zustand: zustand(winter("10:15"), 2), anlass: "cron" }));
  });

  it("blockiert nie — von Hand immer", () => {
    const blockiert = zustand(winter("06:15", "2026-10-30"), 1, winter("06:15", "2026-10-30"));
    assert.ok(!faellig({ jetzt: winter("12:15"), zustand: blockiert, anlass: "cron" }));
    assert.ok(!faellig({ jetzt: winter("12:15"), zustand: zustand(null, 0, winter("06:15")), anlass: "cron" }));
    assert.ok(faellig({ jetzt: winter("03:00"), zustand: blockiert, anlass: "hand" }));
    assert.ok(faellig({ jetzt: winter("12:16"), zustand: zustand(winter("12:15")), anlass: "hand" }));
  });

  it("rechnet die Stunde in Berlin — Sommer- und Winterzeit", () => {
    const vortag = (t: Date) => new Date(t.getTime() - 9 * 3_600_000);

    assert.ok(faellig({ jetzt: sommer("06:15"), zustand: zustand(vortag(sommer("06:15"))), anlass: "cron" }));
    assert.ok(!faellig({ jetzt: sommer("05:15"), zustand: zustand(vortag(sommer("05:15"))), anlass: "cron" }));
    assert.ok(faellig({ jetzt: sommer("21:15"), zustand: zustand(vortag(sommer("21:15"))), anlass: "cron" }));
    assert.ok(!faellig({ jetzt: sommer("22:15"), zustand: zustand(vortag(sommer("22:15"))), anlass: "cron" }));
    assert.ok(faellig({ jetzt: winter("06:15", "2026-12-01"), zustand: zustand(vortag(winter("06:15", "2026-12-01"))), anlass: "cron" }));
    assert.ok(!faellig({ jetzt: winter("05:59", "2026-12-01"), zustand: zustand(vortag(winter("05:59", "2026-12-01"))), anlass: "cron" }));
  });
});
