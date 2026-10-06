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
  iservEvents,
  iservIdentity,
  stableStringify,
} from "@/lib/calendar/events";
import type { IservItem } from "@/lib/iserv/types";

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

  it("schreibt Hausaufgaben als „Hausaufgabe Fach: Titel“ — „HA“ buchstabierte ein Sprach-Bot", () => {
    // Der Titel des Nutzers bleibt wörtlich, auch seine Kürzel.
    assert.equal(homework().body.summary, "Hausaufgabe Mathematik: S. 42 Nr. 3–7");
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

describe("Die Termine der drei Arten bleiben, wie sie waren", () => {
  // Vor der Erweiterung um IServ (Uhrzeit, Ort) einmal ausgerechnet und hier
  // festgehalten. Ändert sich einer dieser Hashes, schriebe der nächste Lauf
  // JEDEN Termin in Google neu — und überschriebe dabei, was der Nutzer dort
  // geändert hat.
  //
  // Die Hausaufgabe am 6.10.2026 bewusst neu ausgerechnet: „HA …“ heißt seitdem
  // „Hausaufgabe …“, weil ein Sprach-Bot die Titel vorliest. Jeder
  // Hausaufgaben-Termin wird damit einmal geändert; Klausur und frei nicht.
  const APP = "https://schulapp.example.test";

  const klausur = () =>
    examEvent({
      exam: {
        id: "11111111-2222-4333-8444-555555555555",
        kind: "klausur",
        title: "Analysis",
        date: "2026-11-12",
        notes: "Taschenrechner",
      },
      subjectName: "Mathematik",
      topics: ["Kettenregel"],
      appOrigin: APP,
    });
  const hausaufgabe = () =>
    homeworkEvent({
      homework: {
        id: "22222222-2222-4333-8444-555555555555",
        title: "S. 42 Nr. 3–7",
        details: "Mit Rechenweg",
        dueDate: "2026-10-08",
      },
      subjectName: "Mathematik",
      reminderHour: 17,
      appOrigin: APP,
    });
  const frei = () =>
    freePeriodEvent({
      period: {
        id: "33333333-2222-4333-8444-555555555555",
        kind: "ferien",
        title: "Herbstferien",
        startsOn: "2026-10-19",
        endsOn: "2026-10-30",
      },
      appOrigin: APP,
    });

  it("haben denselben Hash wie vor der Änderung", () => {
    assert.equal(eventHash(klausur().body), "4e19d49613ddacafa3f76deefb14beb639350e8a696d7d5bf0e020a44ac12229");
    assert.equal(eventHash(hausaufgabe().body), "5052f8bb4c71c7a4c0be572f4a8f0c89e2524b625b0e3192666ef82a715aab15");
    assert.equal(eventHash(frei().body), "e1119af1330f1e2ecc1d02f2d8ede7374bae8bc2c18f953664f7ed5bd5b78943");
  });

  it("tragen keinen Ort und keine Uhrzeit", () => {
    for (const event of [klausur(), hausaufgabe(), frei()]) {
      assert.ok(!("location" in event.body));
      assert.ok(!("dateTime" in event.body.start));
      assert.ok("date" in event.body.start);
    }
  });
});

describe("iservIdentity", () => {
  it("ist fest, gehasht und base32hex", () => {
    const eins = iservIdentity("cal|uid-1@iserv.example.test|20261013T150000Z");

    assert.deepEqual(eins, iservIdentity("cal|uid-1@iserv.example.test|20261013T150000Z"));
    assert.match(eins.key, /^iserv-[0-9a-f]{32}$/);
    assert.match(eins.idBase, /^sai[0-9a-f]{32}$/);
    assert.equal(eins.key.slice(6), eins.idBase.slice(3));
    assert.notEqual(eins.key, iservIdentity("cal|uid-1@iserv.example.test|20261110T160000Z").key);
    assert.equal(CALENDAR_KINDS.iserv.colorId, "7");
  });

  it("behält den Schlüssel für Tag 1 — sonst würde jeder Termin in Google gelöscht und neu angelegt", () => {
    const fremdId = "cal|uid-1@iserv.example.test|20261013T150000Z";

    assert.equal(iservIdentity(fremdId).key, "iserv-e9c3f950f0785845dd3374e5d077a0da");
    assert.deepEqual(iservIdentity(fremdId, 1), iservIdentity(fremdId));
  });

  it("gibt ab Tag 2 jedem Tag eine eigene Kennung, die nicht mit Tag 1 zusammenstößt", () => {
    const fremdId = "cal|uid-1@iserv.example.test|";
    const tag1 = iservIdentity(fremdId);
    const tag2 = iservIdentity(fremdId, 2);
    const tag3 = iservIdentity(fremdId, 3);

    assert.equal(new Set([tag1.key, tag2.key, tag3.key]).size, 3);
    assert.deepEqual(tag2, iservIdentity(fremdId, 2));
    assert.notEqual(tag2.key, iservIdentity("cal|uid-2@iserv.example.test|", 2).key);
    assert.match(tag2.key, /^iserv-[0-9a-f]{32}$/);
    assert.match(tag2.idBase, /^sai[0-9a-f]{32}$/);
  });
});

describe("iservEvents", () => {
  const APP = "https://schulapp.example.test";
  const ISERV = "https://iserv.example.test";

  const basis: IservItem = {
    quelle: "oeffentlich",
    fremdId: "cal|20260610-145225-0015aa@iserv.example.test|",
    kalender: "Öffentlich",
    titel: "1. + 2. Pädagogischer Tag_unterrichtsfrei  (3. Pädagogischer Tag: Mo, 30.11.26)",
    ort: null,
    beschreibung: null,
    link: null,
    ganztaegig: true,
    ersterTag: "2026-10-22",
    letzterTag: "2026-10-23",
    beginn: null,
    ende: null,
  };
  const bauen = (item: IservItem = basis) =>
    iservEvents({ item, klasse: 10, iservOrigin: ISERV, appOrigin: APP });

  it("macht aus einem mehrtägigen Termin einen je Tag, ganztägig an genau diesem Tag", () => {
    const termine = bauen();

    assert.deepEqual(
      termine.map((t) => [t.firstDay, t.body.start, t.body.end, t.body.summary]),
      [
        ["2026-10-22", { date: "2026-10-22" }, { date: "2026-10-23" }, "Pädagogischer Tag, Tag 1 von 2, frei"],
        ["2026-10-23", { date: "2026-10-23" }, { date: "2026-10-24" }, "Pädagogischer Tag, Tag 2 von 2, frei"],
      ],
    );
    assert.deepEqual(
      termine.map((t) => t.key),
      [iservIdentity(basis.fremdId).key, iservIdentity(basis.fremdId, 2).key],
    );
    for (const t of termine) {
      assert.equal(t.kind, "iserv");
      assert.equal(t.idBase, `sai${t.key.slice(6)}`);
      assert.equal(t.body.extendedProperties.private.schulapp, t.key);
      assert.equal(t.body.colorId, "7");
      assert.equal(t.body.description, termine[0].body.description);
    }
  });

  it("behält die Schlüssel, wenn IServ den Termin verschiebt — was der Nutzer gelöscht hat, bleibt gelöscht", () => {
    const verschoben = bauen({ ...basis, ersterTag: "2026-11-05", letzterTag: "2026-11-06" });

    assert.deepEqual(verschoben.map((t) => t.key), bauen().map((t) => t.key));
    assert.deepEqual(verschoben.map((t) => t.firstDay), ["2026-11-05", "2026-11-06"]);
  });

  it("gibt Tag 1 den Schlüssel des ungeteilten Termins", () => {
    const eintaegig = bauen({ ...basis, letzterTag: basis.ersterTag });
    const dreitaegig = bauen({ ...basis, letzterTag: "2026-10-24" });

    assert.equal(eintaegig.length, 1);
    assert.equal(eintaegig[0].key, bauen()[0].key);
    assert.deepEqual(dreitaegig.slice(0, 2).map((t) => t.key), bauen().map((t) => t.key));
    assert.equal(dreitaegig[2].key, iservIdentity(basis.fremdId, 3).key);
  });

  it("ist über zwei Aufrufe gleich — Schlüssel und Hash", () => {
    const eins = bauen();
    const zwei = bauen({ ...basis });

    assert.deepEqual(zwei.map((t) => t.key), eins.map((t) => t.key));
    assert.deepEqual(zwei.map((t) => eventHash(t.body)), eins.map((t) => eventHash(t.body)));
  });

  it("schreibt den Titel aus IServ als erste Zeile in die Beschreibung", () => {
    const [termin] = bauen();

    assert.ok(
      termin.body.description.startsWith(`Titel in IServ: „${basis.titel}“\n\nAus IServ, Kalender „Öffentlich“`),
      termin.body.description,
    );
  });

  it("behält bei einem Termin, der nicht geteilt wird, Schlüssel, Uhrzeit und Ort", () => {
    const item: IservItem = {
      ...basis,
      fremdId: "cal|20260610-145225-0009aa@iserv.example.test|",
      titel: "Kl. 10_Vorstellung der Praktikumsberichte",
      ort: "Aula",
      ganztaegig: false,
      ersterTag: "2026-10-08",
      letzterTag: "2026-10-08",
      beginn: "2026-10-08T16:00:00.000Z",
      ende: "2026-10-08T17:30:00.000Z",
    };
    const termine = bauen(item);

    assert.equal(termine.length, 1);
    assert.equal(termine[0].key, iservIdentity(item.fremdId).key);
    assert.equal(termine[0].firstDay, "2026-10-08");
    assert.equal(termine[0].body.summary, "Vorstellung der Praktikumsberichte");
    assert.deepEqual(termine[0].body.start, { dateTime: "2026-10-08T16:00:00.000Z", timeZone: "Europe/Berlin" });
    assert.deepEqual(termine[0].body.end, { dateTime: "2026-10-08T17:30:00.000Z", timeZone: "Europe/Berlin" });
    assert.equal(termine[0].body.location, "Aula");
  });

  it("kürzt den Titel auf 250 Zeichen", () => {
    const item: IservItem = {
      ...basis,
      titel: `Projekt ${"sehr ".repeat(80)}lang`,
      ersterTag: "2026-10-12",
      letzterTag: "2026-10-12",
    };
    const [termin] = bauen(item);

    assert.equal(termin.body.summary.length, 250);
    assert.ok(termin.body.summary.endsWith("…"));
  });
});
