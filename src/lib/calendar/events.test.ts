import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CALENDAR_KINDS,
  EVENT_FOOTER,
  calendarKey,
  eventHash,
  eventIdFor,
  examEvent,
  freePeriodEvent,
  homeworkEvent,
  homeworkReminderMinutes,
  idBaseFor,
  stableStringify,
} from "@/lib/calendar/events";

const ORIGIN = "https://treskownas.tail3a40b0.ts.net";
const UUID = "6F1C2A8E-0B44-4C55-9D2A-1B7E3F9A0C11";
const HEX = "6f1c2a8e0b444c559d2a1b7e3f9a0c11";

function exam(overrides: Partial<Parameters<typeof examEvent>[0]["exam"]> = {}) {
  return examEvent({
    exam: {
      id: "11111111-2222-4333-8444-555555555555",
      kind: "klausur",
      title: "Analysis",
      date: "2026-11-12",
      notes: null,
      ...overrides,
    },
    subjectName: "Mathematik",
    topics: [],
    appOrigin: ORIGIN,
  });
}

function homework(reminderHour = 17, overrides: Record<string, unknown> = {}) {
  return homeworkEvent({
    homework: {
      id: "22222222-2222-4333-8444-555555555555",
      title: "S. 42 Nr. 3–7",
      details: null,
      dueDate: "2026-10-08",
      ...overrides,
    },
    subjectName: "Mathematik",
    reminderHour,
    appOrigin: ORIGIN,
  });
}

function free(startsOn: string, endsOn: string, title: string | null = null) {
  return freePeriodEvent({
    period: {
      id: "33333333-2222-4333-8444-555555555555",
      kind: "ferien",
      title,
      startsOn,
      endsOn,
    },
    appOrigin: ORIGIN,
  });
}

describe("Event-IDs", () => {
  it("baut Präfix, 32 Hex und die Generation in base32hex", () => {
    const base = idBaseFor("klausur", UUID);

    assert.equal(base, `sak${HEX}`);
    assert.equal(eventIdFor(base, 0), `sak${HEX}0`);
    assert.equal(eventIdFor(base, 1), `sak${HEX}1`);
    assert.equal(eventIdFor(base, 31), `sak${HEX}v`);
    assert.equal(eventIdFor(base, 32), `sak${HEX}10`);
  });

  it("hält sich an Googles Regel: nur a–v und 0–9, 5 bis 1024 Zeichen", () => {
    for (const kind of ["klausur", "hausaufgabe", "frei"] as const) {
      const id = eventIdFor(idBaseFor(kind, UUID), 1234);
      assert.match(id, /^[0-9a-v]{5,1024}$/);
    }
  });

  it("schreibt Großbuchstaben der UUID klein", () => {
    assert.equal(idBaseFor("frei", UUID), idBaseFor("frei", UUID.toLowerCase()));
  });

  it("wirft bei etwas, das keine UUID ist", () => {
    assert.throws(() => idBaseFor("klausur", "nicht-eine-uuid"));
    assert.throws(() => idBaseFor("klausur", `${UUID}0`));
    assert.throws(() => idBaseFor("klausur", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"));
  });

  it("wirft bei einer Generation, die keine ganze Zahl ab 0 ist", () => {
    const base = idBaseFor("klausur", UUID);

    assert.throws(() => eventIdFor(base, -1));
    assert.throws(() => eventIdFor(base, 1.5));
    assert.throws(() => eventIdFor(base, Number.NaN));
    assert.throws(() => eventIdFor("ab", 0), "zu kurz");
    assert.throws(() => eventIdFor("xyz12", 0), "w–z gibt es in base32hex nicht");
  });

  it("lässt drei Arten mit derselben UUID nicht zusammenstoßen", () => {
    const ids = new Set(
      (["klausur", "hausaufgabe", "frei"] as const).map((kind) =>
        eventIdFor(idBaseFor(kind, UUID), 0),
      ),
    );

    assert.equal(ids.size, 3);
  });

  it("baut den Schlüssel wie die doc_id der Wiki-Übergabe", () => {
    assert.equal(calendarKey("hausaufgabe", "abc"), "hausaufgabe-abc");
  });

  it("hat Präfixe nur aus a–v", () => {
    for (const { prefix } of Object.values(CALENDAR_KINDS)) {
      assert.match(prefix, /^[a-v]+$/);
    }
  });
});

describe("homeworkReminderMinutes", () => {
  it("erinnert am Vortag zur Erinnerungsstunde", () => {
    assert.equal(homeworkReminderMinutes(17), 420);
    assert.equal(homeworkReminderMinutes(6), 1080);
    assert.equal(homeworkReminderMinutes(22), 120);
  });

  it("fällt außerhalb von 6 bis 22 und bei Unsinn auf 17 Uhr zurück", () => {
    for (const hour of [3, 23, Number.NaN, 1.5, -1]) {
      assert.equal(homeworkReminderMinutes(hour), 420, String(hour));
    }
  });
});

describe("Ganztägig, Ende exklusiv", () => {
  it("setzt das Ende auf den Tag danach", () => {
    assert.deepEqual(exam().body.start, { date: "2026-11-12" });
    assert.deepEqual(exam().body.end, { date: "2026-11-13" });
    assert.deepEqual(homework().body.end, { date: "2026-10-09" });
  });

  it("rechnet über Monats- und Jahresgrenzen", () => {
    assert.equal(exam({ date: "2026-10-31" }).body.end.date, "2026-11-01");
    assert.equal(exam({ date: "2026-12-31" }).body.end.date, "2027-01-01");
    assert.equal(exam({ date: "2028-02-28" }).body.end.date, "2028-02-29");
    assert.equal(exam({ date: "2028-02-29" }).body.end.date, "2028-03-01");
  });

  it("zählt beim freien Zeitraum beide Enden mit", () => {
    const einTag = free("2026-10-05", "2026-10-05");
    assert.deepEqual(einTag.body.start, { date: "2026-10-05" });
    assert.deepEqual(einTag.body.end, { date: "2026-10-06" });

    const ferien = free("2026-10-19", "2026-10-30", "Herbstferien");
    assert.deepEqual(ferien.body.start, { date: "2026-10-19" });
    assert.deepEqual(ferien.body.end, { date: "2026-10-31" });
    assert.equal(ferien.firstDay, "2026-10-19");
  });
});

describe("Inhalt der Termine", () => {
  it("benennt jede Prüfungsart, mit und ohne Titel", () => {
    assert.equal(exam().body.summary, "Klausur Mathematik: Analysis");
    assert.equal(exam({ title: null }).body.summary, "Klausur Mathematik");
    assert.equal(exam({ title: "  " }).body.summary, "Klausur Mathematik");
    assert.equal(exam({ kind: "test", title: null }).body.summary, "Test Mathematik");
    assert.equal(exam({ kind: "referat" }).body.summary, "Referat Mathematik: Analysis");
    assert.equal(
      exam({ kind: "muendlich", title: null }).body.summary,
      "Mündliche Prüfung Mathematik",
    );
    assert.equal(exam({ kind: "seltsam", title: null }).body.summary, "Prüfung Mathematik");
  });

  it("schreibt Hausaufgaben als „HA Fach: Titel“", () => {
    assert.equal(homework().body.summary, "HA Mathematik: S. 42 Nr. 3–7");
  });

  it("nennt freie Tage wie die App", () => {
    assert.equal(free("2026-10-19", "2026-10-30", "Herbstferien").body.summary, "Herbstferien");
    assert.equal(free("2026-10-19", "2026-10-30").body.summary, "Ferien");
  });

  it("schreibt Themen, Notiz, Link und Fußzeile in die Beschreibung", () => {
    const event = examEvent({
      exam: {
        id: "11111111-2222-4333-8444-555555555555",
        kind: "klausur",
        title: null,
        date: "2026-11-12",
        notes: "Taschenrechner mitbringen",
      },
      subjectName: "Mathematik",
      topics: ["Kettenregel", "Produktregel"],
      appOrigin: ORIGIN,
    });

    assert.equal(
      event.body.description,
      [
        "Themen: Kettenregel, Produktregel",
        "Taschenrechner mitbringen",
        `In der Schulapp: ${ORIGIN}/klausuren/11111111-2222-4333-8444-555555555555`,
        EVENT_FOOTER,
      ].join("\n\n"),
    );
  });

  it("lässt leere Teile der Beschreibung weg", () => {
    assert.equal(
      exam().body.description,
      [
        `In der Schulapp: ${ORIGIN}/klausuren/11111111-2222-4333-8444-555555555555`,
        EVENT_FOOTER,
      ].join("\n\n"),
    );

    assert.equal(
      homework(17, { details: "Mit Rechenweg" }).body.description,
      [
        "Mit Rechenweg",
        `In der Schulapp: ${ORIGIN}/hausaufgaben/22222222-2222-4333-8444-555555555555`,
        EVENT_FOOTER,
      ].join("\n\n"),
    );

    assert.equal(
      free("2026-10-19", "2026-10-30").body.description,
      [`In der Schulapp: ${ORIGIN}/einstellungen`, EVENT_FOOTER].join("\n\n"),
    );
  });

  it("erinnert nur an Hausaufgaben", () => {
    assert.deepEqual(homework(18).body.reminders, {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 360 }],
    });
    assert.deepEqual(exam().body.reminders, { useDefault: false, overrides: [] });
    assert.deepEqual(free("2026-10-19", "2026-10-30").body.reminders, {
      useDefault: false,
      overrides: [],
    });
  });

  it("macht alle drei durchsichtig und färbt sie je Art", () => {
    for (const event of [exam(), homework(), free("2026-10-19", "2026-10-30")]) {
      assert.equal(event.body.transparency, "transparent");
    }

    assert.equal(exam().body.colorId, "11");
    assert.equal(homework().body.colorId, "9");
    assert.equal(free("2026-10-19", "2026-10-30").body.colorId, "10");
  });

  it("trägt den Schlüssel in extendedProperties.private", () => {
    const event = homework();

    assert.equal(event.key, "hausaufgabe-22222222-2222-4333-8444-555555555555");
    assert.deepEqual(event.body.extendedProperties, { private: { schulapp: event.key } });
  });

  it("enthält keinen Zeitstempel und kein status", () => {
    const text = JSON.stringify([exam().body, homework().body]);

    assert.ok(!("status" in exam().body));
    assert.ok(!/\d{2}:\d{2}/.test(text), "keine Uhrzeit im Termin");
    assert.ok(!/T\d{2}/.test(text), "kein ISO-Zeitpunkt im Termin");
  });
});

describe("eventHash", () => {
  it("hängt nicht an der Reihenfolge der Schlüssel", () => {
    assert.equal(
      stableStringify({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: 3 } }),
      stableStringify({ a: { c: 3, d: [2, { x: 2, y: 1 }] }, b: 1 }),
    );

    const body = exam().body;
    const umgestellt = Object.fromEntries(Object.entries(body).reverse()) as typeof body;

    assert.equal(eventHash(umgestellt), eventHash(body));
  });

  it("ist stabil über zwei Aufrufe", () => {
    assert.equal(eventHash(exam().body), eventHash(exam().body));
    assert.match(eventHash(exam().body), /^[0-9a-f]{64}$/);
  });

  it("ändert sich mit Erinnerungsstunde, Datum, Thema und Fachname", () => {
    const basis = eventHash(homework(17).body);

    assert.notEqual(eventHash(homework(18).body), basis);
    assert.notEqual(eventHash(homework(17, { dueDate: "2026-10-09" }).body), basis);

    const ohneThema = eventHash(exam().body);
    const mitThema = examEvent({
      exam: {
        id: "11111111-2222-4333-8444-555555555555",
        kind: "klausur",
        title: "Analysis",
        date: "2026-11-12",
        notes: null,
      },
      subjectName: "Mathematik",
      topics: ["Kettenregel"],
      appOrigin: ORIGIN,
    });
    assert.notEqual(eventHash(mitThema.body), ohneThema);

    const anderesFach = examEvent({
      exam: {
        id: "11111111-2222-4333-8444-555555555555",
        kind: "klausur",
        title: "Analysis",
        date: "2026-11-12",
        notes: null,
      },
      subjectName: "Physik",
      topics: [],
      appOrigin: ORIGIN,
    });
    assert.notEqual(eventHash(anderesFach.body), ohneThema);
  });
});
