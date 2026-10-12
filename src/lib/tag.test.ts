import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LessonWithSubject } from "@/lib/timetable";
import {
  ansichtRechnen,
  appTag,
  berlinZeitpunkt,
  istSchultag,
  naechsterSchultagIn,
  schlussZeit,
  testuhrAusParametern,
  testuhrLesen,
  type Schulkalender,
} from "@/lib/tag";

/** Der Stundenplan aus V2 2.1: Mo bis 13:10, Di bis 14:15. */
function kalender(frei: Schulkalender["frei"] = []): Schulkalender {
  const stunde = (weekday: number, period: number): LessonWithSubject =>
    ({ weekday, period, subject: { id: `f${period}` } }) as unknown as LessonWithSubject;
  const plan: Record<number, number[]> = { 1: [1, 2, 3], 2: [1, 2, 3, 4], 3: [1, 2, 3], 4: [1, 2, 3], 5: [1, 2, 3] };
  return {
    stunden: new Map(Object.entries(plan).map(([w, ps]) => [Number(w), ps.map((p) => stunde(Number(w), p))])),
    raster: new Map([
      [1, { startsAt: "08:00", endsAt: "09:30" }],
      [2, { startsAt: "09:50", endsAt: "11:20" }],
      [3, { startsAt: "11:40", endsAt: "13:10" }],
      [4, { startsAt: "13:30", endsAt: "14:15" }],
    ]),
    frei,
  };
}

const um = (tag: string, hhmm: string) => berlinZeitpunkt(tag, hhmm);

describe("appTag", () => {
  it("wechselt um 04:00 Berliner Zeit", () => {
    assert.equal(appTag(um("2026-10-13", "00:30")), "2026-10-12");
    assert.equal(appTag(um("2026-10-13", "03:59")), "2026-10-12");
    assert.equal(appTag(um("2026-10-13", "04:01")), "2026-10-13");
  });

  it("berlinZeitpunkt rechnet Sommer- und Winterzeit", () => {
    assert.equal(um("2026-10-12", "07:10").toISOString(), "2026-10-12T05:10:00.000Z");
    assert.equal(um("2026-11-02", "07:10").toISOString(), "2026-11-02T06:10:00.000Z");
  });
});

describe("Schultag und Schulschluss", () => {
  const k = kalender([{ kind: "ferien", title: null, startsOn: "2026-10-26", endsOn: "2026-10-30" }]);

  it("Mo–Fr mit Stunden ist Schultag, Samstag und Ferien nicht", () => {
    assert.equal(istSchultag(k, "2026-10-12"), true);
    assert.equal(istSchultag(k, "2026-10-17"), false);
    assert.equal(istSchultag(k, "2026-10-27"), false);
  });

  it("Schulschluss ist das Ende der spätesten Stunde", () => {
    assert.equal(schlussZeit(k, "2026-10-12"), "13:10");
    assert.equal(schlussZeit(k, "2026-10-13"), "14:15");
    assert.equal(schlussZeit(k, "2026-10-17"), null);
  });

  it("der nächste Schultag überspringt Wochenende und Ferien", () => {
    assert.equal(naechsterSchultagIn(k, "2026-10-16"), "2026-10-19");
    assert.equal(naechsterSchultagIn(k, "2026-10-23"), "2026-11-02");
  });
});

describe("ansicht (V2 3.2, Kriterien 1–8)", () => {
  const k = kalender([{ kind: "ferien", title: null, startsOn: "2026-10-26", endsOn: "2026-10-30" }]);

  it("Mo 07:10 und 13:09 Morgens, 13:11 Ablauf", () => {
    assert.equal(ansichtRechnen(k, um("2026-10-12", "07:10"), null), "morgens");
    assert.equal(ansichtRechnen(k, um("2026-10-12", "13:09"), null), "morgens");
    assert.equal(ansichtRechnen(k, um("2026-10-12", "13:11"), null), "ablauf");
  });

  it("nach Überspringen oder Fertig der Überblick, auch um 23:50", () => {
    for (const z of ["16:40", "19:30", "23:50"]) {
      assert.equal(ansichtRechnen(k, um("2026-10-12", z), "übersprungen"), "ueberblick");
      assert.equal(ansichtRechnen(k, um("2026-10-12", z), "erledigt"), "ueberblick");
    }
  });

  it("Di 00:30 zeigt den Überblick von Montag, 04:01 Morgens von Dienstag", () => {
    assert.equal(ansichtRechnen(k, um("2026-10-13", "00:30"), "erledigt"), "ueberblick");
    assert.equal(ansichtRechnen(k, um("2026-10-13", "04:01"), null), "morgens");
  });

  it("Samstag und Ferien: nur der Überblick", () => {
    assert.equal(ansichtRechnen(k, um("2026-10-17", "09:00"), null), "ueberblick");
    assert.equal(ansichtRechnen(k, um("2026-10-27", "07:10"), null), "ueberblick");
  });
});

describe("Testuhr", () => {
  it("liest ?zeit, ?tag und ?jetzt als Berliner Zeit", () => {
    assert.equal(testuhrAusParametern(new URLSearchParams("zeit=07:10"))?.toISOString(), "2026-10-12T05:10:00.000Z");
    assert.equal(
      testuhrAusParametern(new URLSearchParams("zeit=7:20&tag=2026-10-13"))?.toISOString(),
      "2026-10-13T05:20:00.000Z",
    );
    assert.equal(
      testuhrAusParametern(new URLSearchParams("jetzt=2026-10-12T16:40"))?.toISOString(),
      "2026-10-12T14:40:00.000Z",
    );
    assert.equal(testuhrAusParametern(new URLSearchParams("zeit=quatsch")), null);
  });

  it("läuft ab dem gestellten Zeitpunkt weiter", () => {
    const start = Date.UTC(2026, 9, 12, 11, 5);
    const wert = encodeURIComponent(JSON.stringify({ start, gestellt: 1000 }));
    assert.equal(testuhrLesen(wert, 1000 + 6 * 60_000)?.getTime(), start + 6 * 60_000);
    assert.equal(testuhrLesen("kaputt"), null);
    assert.equal(testuhrLesen(undefined), null);
  });
});
