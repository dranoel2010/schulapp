import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { berlinDay } from "@/lib/dates";
import {
  AUFGABEN_FEED,
  klassenFeed,
  LANGER_TITEL,
  oeffentlicherFeed,
  ORIGIN,
} from "@/lib/iserv/fixtures";
import { parseAufgabenFeed, parseKalenderFeed } from "@/lib/iserv/parse";
import {
  kartenTitel,
  MAX_TAGE_EINZELN,
  sprechName,
  sprechTermine,
  sprechZeit,
} from "@/lib/iserv/sprechtitel";
import type { IservItem, IservQuelle } from "@/lib/iserv/types";

// Nur erfundene Titel — die meisten aus @/lib/iserv/fixtures.

const KLASSE = 10;

const BASIS: IservItem = {
  quelle: "oeffentlich",
  fremdId: "cal|sprech@iserv.example.test|",
  kalender: "Öffentlich",
  titel: "",
  ort: null,
  beschreibung: null,
  link: null,
  ganztaegig: true,
  ersterTag: "2026-10-12",
  letzterTag: "2026-10-12",
  beginn: null,
  ende: null,
};

/** Ganztägig, von `ersterTag` bis einschließlich `letzterTag`. */
function ganztags(
  titel: string,
  ersterTag = "2026-10-12",
  letzterTag = ersterTag,
  quelle: IservQuelle = "oeffentlich",
): IservItem {
  return { ...BASIS, quelle, titel, ersterTag, letzterTag };
}

/** Mit Uhrzeit; `ende` gleich `beginn` oder null ist ein Punkt-Termin. */
function mitZeit(
  titel: string,
  beginn: string,
  ende: string | null,
  quelle: IservQuelle = "oeffentlich",
): IservItem {
  const b = new Date(beginn).toISOString();
  const e = ende === null ? null : new Date(ende).toISOString();
  return {
    ...BASIS,
    quelle,
    titel,
    ganztaegig: false,
    ersterTag: berlinDay(new Date(b)),
    letzterTag: berlinDay(new Date(e ?? b)),
    beginn: b,
    ende: e,
  };
}

/** Der einzige Titel — scheitert, wenn es mehr als ein Termin wird. */
function einTitel(item: IservItem): string {
  const termine = sprechTermine(item, KLASSE);
  assert.equal(termine.length, 1, JSON.stringify(termine));
  assert.equal(termine[0].tag, null);
  return termine[0].titel;
}

const name = (item: IservItem) => sprechName(item, KLASSE).name;

describe("sprechZeit", () => {
  it("liest volle Stunden ohne Minuten, sonst ohne führende Null", () => {
    assert.equal(sprechZeit("11:00"), "11 Uhr");
    assert.equal(sprechZeit("08:05"), "8:05 Uhr");
    assert.equal(sprechZeit("23:59"), "23:59 Uhr");
  });
});

describe("sprechName — Präfix, Trenner, Klammern", () => {
  it("macht aus „_“ eine Pause mit Komma", () => {
    assert.equal(
      einTitel(mitZeit("Adventsbasar_Schulsamstag", "2026-11-28T11:00:00+01:00", "2026-11-28T17:00:00+01:00")),
      "Adventsbasar, Schulsamstag",
    );
  });

  it("nimmt eine Klammer mit Ziffer ganz heraus, sonst wird sie ein Teil mit Pause", () => {
    assert.equal(einTitel(ganztags("Sportfest (Aula)")), "Sportfest, Aula");
    assert.equal(einTitel(ganztags("Wandertag (bei Regen Unterricht)")), "Wandertag, bei Regen Unterricht");
    assert.equal(einTitel(ganztags("Sportfest (Ersatztermin 14.10.)")), "Sportfest");
  });

  it("erkennt „frei“ auch neben einer Klammer", () => {
    assert.equal(
      einTitel(ganztags("Brückentag_unterrichtsfrei (Hort geöffnet)", "2027-05-07")),
      "Brückentag, Hort geöffnet, frei",
    );
  });

  it("nimmt einen Teil heraus, der nur Wochentage nennt", () => {
    const termine = sprechTermine(ganztags("Klassenfahrt 10. Kl. (Mo.–Fr.)", "2026-11-02", "2026-11-06"), KLASSE);
    assert.equal(termine[0].titel, "Klassenfahrt, Tag 1 von 5");
    assert.equal(einTitel(ganztags("Sporttag_Mo. - Mi.")), "Sporttag");
  });

  it("schreibt Gender-Formen aus", () => {
    assert.equal(
      einTitel(mitZeit("Treffen der Schüler*innen", "2026-10-12T14:00:00+02:00", "2026-10-12T15:00:00+02:00")),
      "Treffen der Schülerinnen und Schüler",
    );
  });
});

describe("sprechName — Klassen", () => {
  const abends = (titel: string) =>
    mitZeit(titel, "2026-10-08T18:00:00+02:00", "2026-10-08T19:30:00+02:00");

  it("lässt die eigene Klasse weg — hinein kommt ohnehin nur, was sie betrifft", () => {
    assert.equal(einTitel(abends("Kl. 10_Vorstellung der Praktikumsberichte")), "Vorstellung der Praktikumsberichte");
    assert.equal(einTitel(abends("Zehntklässler_Berufsmesse")), "Berufsmesse");
    assert.equal(einTitel(abends("Kl. 9 + 10_Theaterfahrt")), "Theaterfahrt");
    assert.equal(einTitel(abends("Kl. 10 und Kl. 11_Exkursion")), "Exkursion");
  });

  it("nimmt einen Klassenbereich und ein Lehrerkürzel heraus", () => {
    assert.equal(
      einTitel(mitZeit("Nachschreibklausur_7. - 12. Kl_Ab", "2026-10-07T15:45:00+02:00", "2026-10-07T17:15:00+02:00")),
      "Nachschreibklausur",
    );
  });

  it("schreibt eine fremde Klasse aus, wenn die eigene nicht genannt ist", () => {
    assert.equal(einTitel(ganztags("11. Kl._Berufsorientierung")), "11. Klasse, Berufsorientierung");
  });

  it("nimmt die eigene Klasse am Ende eines Satzes samt Artikel heraus", () => {
    assert.equal(einTitel(abends("Elternabend der 10. Klasse")), "Elternabend");
    assert.equal(einTitel(abends("Projekttag der Klassen 9 bis 12")), "Projekttag");
    assert.equal(einTitel(abends("Theaterbesuch für die Klassen 9 und 10")), "Theaterbesuch");
    assert.deepEqual(
      sprechTermine(ganztags("Klassenspiel der 10. Kl.", "2027-03-18", "2027-03-19"), KLASSE).map((t) => t.titel),
      ["Klassenspiel, Tag 1 von 2", "Klassenspiel, Tag 2 von 2"],
    );
  });

  it("nimmt sie am Anfang heraus, wenn ein Nomen oder ein Trenner folgt", () => {
    assert.equal(einTitel(abends("Kl. 10 Exkursion nach Musterdorf")), "Exkursion nach Musterdorf");
    assert.equal(einTitel(abends("Kl. 10: Elternabend")), "Elternabend");
  });

  it("lässt sie mitten im Satz stehen — sonst blieben Satztrümmer", () => {
    assert.equal(einTitel(abends("Die Klassen 9 und 10 haben Projekttag")), "Die Klassen 9 und 10 haben Projekttag");
    assert.equal(einTitel(abends("Kl. 10 hat Wandertag")), "Klasse 10 hat Wandertag");
    assert.equal(
      einTitel(ganztags("Für die 10. Klasse ist am Freitag unterrichtsfrei", "2027-03-19")),
      "Für die 10. Klasse ist am Freitag unterrichtsfrei",
    );
    assert.equal(
      sprechTermine(
        ganztags("Projektwoche_Für die Klassen 10 und 12 gilt der Sonderplan (Aushang beachten)", "2027-03-15", "2027-03-19"),
        KLASSE,
      )[0].titel,
      "Projektwoche, Für die Klassen 10 und 12 gilt der Sonderplan, Aushang beachten, Tag 1 von 5",
    );
  });

  it("fällt auf den sprechbaren Originaltitel zurück, wenn nichts übrig bleibt", () => {
    assert.equal(einTitel(abends("Kl. 10")), "Klasse 10");
  });
});

describe("sprechName — Datum und Uhrzeit", () => {
  it("nimmt Daten heraus, die Google ohnehin zeigt", () => {
    assert.equal(einTitel(ganztags("Wandertag am 12.11.", "2026-11-12")), "Wandertag");
    assert.equal(
      name(ganztags("10.Kl_Vermessungspraktikum in Musterdorf_14.09.-25.09.26", "2026-09-14", "2026-09-25")),
      "Vermessungspraktikum in Musterdorf",
    );
    assert.equal(
      name(
        ganztags(
          "1. + 2. Pädagogischer Tag_unterrichtsfrei  (3. Pädagogischer Tag: Mo, 30.11.26)",
          "2026-10-22",
          "2026-10-23",
        ),
      ),
      "Pädagogischer Tag",
    );
  });

  it("nimmt eine Uhrzeit heraus, die Beginn oder Ende ist", () => {
    assert.equal(
      einTitel(mitZeit("Erntedankfest_Beginn  10 Uhr", "2026-10-10T10:00:00+02:00", "2026-10-10T14:00:00+02:00")),
      "Erntedankfest",
    );
    assert.equal(
      einTitel(mitZeit("Probe_14-16 Uhr", "2026-10-13T14:00:00+02:00", "2026-10-13T16:00:00+02:00")),
      "Probe",
    );
  });

  it("lässt den Satz über den Unterricht stehen — ohne „, frei“", () => {
    assert.equal(
      einTitel(
        mitZeit(
          "Elternsprechtag_ab 14 Uhr_kein Unterricht nach der 4. Stunde",
          "2027-02-24T14:00:00+01:00",
          "2027-02-24T18:00:00+01:00",
        ),
      ),
      "Elternsprechtag, kein Unterricht nach der 4. Stunde",
    );
  });

  it("lässt eine Uhrzeit stehen, die weder Beginn noch Ende ist", () => {
    assert.equal(
      einTitel(mitZeit("Elternabend_Abholung Hort bis 16 Uhr", "2026-10-13T19:00:00+02:00", "2026-10-13T21:00:00+02:00")),
      "Elternabend, Abholung Hort bis 16 Uhr",
    );
  });

  it("nennt bei einem Punkt-Termin die Uhrzeit — einmal", () => {
    const punkt = (titel: string, wann = "2026-12-17T11:30:00+01:00") => mitZeit(titel, wann, wann);

    assert.equal(einTitel(punkt("Unterrichtsende um 11:30 Uhr")), "Unterrichtsende um 11:30 Uhr");
    assert.equal(einTitel(punkt("Abholung")), "Abholung um 11:30 Uhr");
    assert.equal(einTitel(mitZeit("Abholung", "2026-12-17T11:30:00+01:00", null)), "Abholung um 11:30 Uhr");
    assert.equal(einTitel(punkt("Abholung", "2026-12-17T11:00:00+01:00")), "Abholung um 11 Uhr");
    assert.equal(einTitel(punkt("Unterrichtsende 11h", "2026-12-17T11:00:00+01:00")), "Unterrichtsende 11 Uhr");
  });
});

describe("sprechName — frei", () => {
  it("hängt „, frei“ an, wenn ein ganzes Segment es sagt", () => {
    assert.equal(einTitel(ganztags("Brückentag_Schule und Hort geschlossen", "2027-05-07")), "Brückentag, frei");
    assert.equal(einTitel(ganztags("3.Pädagogischer Tag_unterrichtsfrei", "2026-11-30")), "3. Pädagogischer Tag, frei");
    assert.equal(einTitel(ganztags("Studientag_kein Unterricht")), "Studientag, frei");
  });

  it("lässt eine Frei-Angabe im Satz stehen, ohne „, frei“", () => {
    assert.equal(
      einTitel(ganztags("Faschingsfeier der Unterstufe_anschließend unterrichtsfrei", "2027-02-16")),
      "Faschingsfeier der Unterstufe, anschließend unterrichtsfrei",
    );
  });

  it("sagt „Unterrichtsfrei“, wenn sonst nichts dasteht — nicht „Unterrichtsfrei, frei“", () => {
    assert.equal(einTitel(ganztags("unterrichtsfrei")), "Unterrichtsfrei");
  });
});

describe("sprechName — Ferien", () => {
  it("macht aus Ferien EINEN Balken, nur mit dem Namen", () => {
    assert.deepEqual(
      sprechTermine(ganztags("Herbstferien_Sa. 24. 10. – Sa. 7. 11. 2026", "2026-10-24", "2026-11-07"), KLASSE),
      [{ tag: null, titel: "Herbstferien" }],
    );
    assert.equal(
      einTitel(
        ganztags(
          "Weihnachtsferien_Fr. 18.12.26 – Fr. 1.1.27_letzter Schultag Do. 17.12. bis 11:30 Uhr",
          "2026-12-18",
          "2027-01-02",
        ),
      ),
      "Weihnachtsferien",
    );
  });

  it("hält eine Ferien-AG, die Ferienbetreuung und das Ende der Ferien nicht für Ferien", () => {
    for (const titel of ["Ferien-AG Werken", "Ferienbetreuung im Hort", "Ende der Herbstferien"]) {
      assert.equal(sprechName(ganztags(titel, "2026-10-26", "2026-10-27"), KLASSE).ferien, false, titel);
    }
  });

  it("nimmt Ferien nur ganztägig", () => {
    const item = mitZeit("Herbstferien_Abschlussfeier", "2026-10-23T11:00:00+02:00", "2026-10-23T12:00:00+02:00");
    assert.equal(sprechName(item, KLASSE).ferien, false);
  });
});

describe("sprechTermine — mehrtägig je Tag", () => {
  it("teilt den Pädagogischen Tag in zwei Termine, frei", () => {
    const item = ganztags(
      "1. + 2. Pädagogischer Tag_unterrichtsfrei  (3. Pädagogischer Tag: Mo, 30.11.26)",
      "2026-10-22",
      "2026-10-23",
    );

    assert.deepEqual(sprechTermine(item, KLASSE), [
      { tag: "2026-10-22", titel: "Pädagogischer Tag, Tag 1 von 2, frei" },
      { tag: "2026-10-23", titel: "Pädagogischer Tag, Tag 2 von 2, frei" },
    ]);
  });

  it("lässt Ordnungszahlen stehen, die nicht die Tage zählen", () => {
    assert.equal(einTitel(ganztags("1. + 2. Stunde Ausfall")), "1. und 2. Stunde Ausfall");
  });

  it("zählt einen Bereich „1. - 3.“ als drei Tage", () => {
    for (const titel of ["1. - 3. Pädagogischer Tag_unterrichtsfrei", "1.-3. Pädagogischer Tag_unterrichtsfrei", "1. bis 3. Pädagogischer Tag_unterrichtsfrei"]) {
      assert.deepEqual(
        sprechTermine(ganztags(titel, "2026-11-02", "2026-11-04"), KLASSE).map((t) => t.titel),
        [
          "Pädagogischer Tag, Tag 1 von 3, frei",
          "Pädagogischer Tag, Tag 2 von 3, frei",
          "Pädagogischer Tag, Tag 3 von 3, frei",
        ],
        titel,
      );
    }
    assert.equal(
      sprechTermine(ganztags("1. - 3. Pädagogischer Tag", "2026-11-02", "2026-11-03"), KLASSE)[0].titel,
      "1. - 3. Pädagogischer Tag, Tag 1 von 2",
    );
  });

  it("zählt auch Wochenenden mit", () => {
    const termine = sprechTermine(
      ganztags("10.Kl_Vermessungspraktikum in Musterdorf_14.09.-25.09.26", "2026-09-14", "2026-09-25"),
      KLASSE,
    );

    assert.equal(termine.length, 12);
    assert.deepEqual(termine[0], { tag: "2026-09-14", titel: "Vermessungspraktikum in Musterdorf, Tag 1 von 12" });
    assert.deepEqual(termine[11], { tag: "2026-09-25", titel: "Vermessungspraktikum in Musterdorf, Tag 12 von 12" });
    assert.equal(new Set(termine.map((t) => t.tag)).size, 12);
  });

  it(`teilt bis ${MAX_TAGE_EINZELN} Tage, darüber bleibt es ein Balken ohne Zähler`, () => {
    assert.equal(sprechTermine(ganztags("Projektepoche", "2026-10-01", "2026-10-31"), KLASSE).length, 31);
    assert.equal(einTitel(ganztags("Projektepoche", "2026-10-01", "2026-11-01")), "Projektepoche");
  });

  it("lässt einen mehrtägigen Termin mit Uhrzeit EIN Termin", () => {
    assert.equal(
      einTitel(mitZeit("Projektwoche", "2026-10-12T08:00:00+02:00", "2026-10-16T14:00:00+02:00")),
      "Projektwoche",
    );
  });
});

describe("sprechTermine — Aufgaben", () => {
  it("schreibt „Abgabe“ davor und die Uhrzeit dahinter", () => {
    assert.equal(
      einTitel(mitZeit("Deutsch: Erörterung", "2026-10-20T23:59:00+02:00", "2026-10-20T23:59:00+02:00", "aufgaben")),
      "Abgabe Deutsch: Erörterung bis 23:59 Uhr",
    );
    assert.equal(
      einTitel(mitZeit("Bio: Protokoll", "2026-10-15T08:05:00+02:00", null, "aufgaben")),
      "Abgabe Bio: Protokoll bis 8:05 Uhr",
    );
    assert.equal(
      einTitel(ganztags("Mathe: Arbeitsblatt Funktionen", "2026-10-12", "2026-10-12", "aufgaben")),
      "Abgabe Mathe: Arbeitsblatt Funktionen",
    );
  });

  it("schreibt „Abgabe“ nicht doppelt", () => {
    assert.equal(
      einTitel(mitZeit("Abgabe Referat", "2026-10-20T23:59:00+02:00", "2026-10-20T23:59:00+02:00", "aufgaben")),
      "Abgabe Referat bis 23:59 Uhr",
    );
  });

  it("schreibt die Abgabezeit nicht doppelt und lässt einen Wochentag weg", () => {
    const bisMitternacht = (titel: string) =>
      mitZeit(titel, "2026-10-20T23:59:00+02:00", "2026-10-20T23:59:00+02:00", "aufgaben");

    assert.equal(einTitel(bisMitternacht("Abgabe bis 23:59 Uhr: Referat")), "Abgabe bis 23:59 Uhr: Referat");
    assert.equal(
      einTitel(bisMitternacht("Deutsch: Gedichtanalyse (bis Fr.)")),
      "Abgabe Deutsch: Gedichtanalyse bis 23:59 Uhr",
    );
  });

  it("teilt eine mehrtägige Aufgabe nicht", () => {
    assert.equal(
      einTitel(ganztags("Kunst: Mappe", "2026-10-12", "2026-10-16", "aufgaben")),
      "Abgabe Kunst: Mappe",
    );
  });
});

describe("sprechName — Abkürzungen", () => {
  it("schreibt aus, was ein Bot buchstabieren würde", () => {
    assert.equal(
      einTitel(mitZeit("EA 10.Kl", "2026-11-18T19:30:00+01:00", "2026-11-18T21:30:00+01:00")),
      "Elternabend",
    );
    assert.equal(einTitel(ganztags("HA Mathe S. 12 Nr. 4")), "Hausaufgabe Mathe Seite 12 Nummer 4");
  });

  it("schreibt Kürzel auch am Ende eines Teils aus, wo der Punkt schon fehlt", () => {
    assert.equal(
      einTitel(mitZeit("Unterrichtsende nach der 4. Std.", "2026-12-17T11:30:00+01:00", "2026-12-17T11:30:00+01:00")),
      "Unterrichtsende nach der 4. Stunde um 11:30 Uhr",
    );
    assert.equal(
      einTitel(mitZeit("Sprechstunde_1. Std.", "2026-10-12T08:00:00+02:00", "2026-10-12T08:45:00+02:00")),
      "Sprechstunde, 1. Stunde",
    );
    assert.equal(
      einTitel(ganztags("Wandertag_Sportzeug, Proviant usw.")),
      "Wandertag, Sportzeug, Proviant und so weiter",
    );
    assert.equal(einTitel(ganztags("Wandertag_Regenjacke ggf.")), "Wandertag, Regenjacke gegebenenfalls");
    assert.equal(einTitel(ganztags("4. Std. Ausfall")), "4. Stunde Ausfall");
  });

  it("macht Uhrzeiten sprechbar", () => {
    const abends = (titel: string) =>
      mitZeit(titel, "2026-10-13T19:00:00+02:00", "2026-10-13T21:00:00+02:00");
    assert.equal(einTitel(abends("Theater_Einlass 18.30 Uhr")), "Theater, Einlass 18:30 Uhr");
    assert.equal(einTitel(abends("Theater_Einlass 18:00 Uhr")), "Theater, Einlass 18 Uhr");
  });
});

describe("sprechName — abgeschnittene Titel", () => {
  it("lässt kein „…“ und kein Wortstück am Ende", () => {
    const item = ganztags(LANGER_TITEL, "2027-03-01", "2027-03-05");
    const n = name(item);
    const voll =
      "In der Prüfungswoche haben die Klassen 12 und 13 nur Prüfungen nach Plan, der Aushang am Brett gilt. Weitere Infos folgen";
    const letztesWort = n.split(/\s+/).at(-1) ?? "";

    assert.ok(!/…|\.\.\.|…/.test(n), n);
    assert.ok(voll.split(/[\s,.]+/).includes(letztesWort), `${letztesWort} in „${n}“`);
    // Der angefangene Satzteil „der Aushang a…“ fällt ganz weg.
    assert.ok(n.endsWith("nur Prüfungen nach Plan"), n);
  });

  it("endet beim letzten ganzen Satz, wenn danach nur ein angefangener kommt", () => {
    const voll = "Infoabend_Bitte den Ausweis mitbringen. Treffpunkt ist der Haupteingang der Schule. Danach gehen wir";
    const titel = `${voll.slice(0, 98)}…`;
    assert.equal(titel.length, 99);
    assert.equal(name(ganztags(titel)), "Infoabend, Bitte den Ausweis mitbringen. Treffpunkt ist der Haupteingang der Schule");
  });

  it("behält einen langen angefangenen Satzteil — er trägt die Nachricht", () => {
    const voll = "Elternversammlung_Wichtig, diesmal beginnt die Versammlung eine halbe Stunde früher als bei allen Treffen";
    const titel = `${voll.slice(0, 98)}…`;
    assert.equal(
      name(ganztags(titel)),
      "Elternversammlung, Wichtig, diesmal beginnt die Versammlung eine halbe Stunde früher als bei allen",
    );
  });

  it("lässt einen kurzen Titel mit Auslassungspunkten, wie er ist", () => {
    assert.equal(einTitel(ganztags("Lesung: Und dann...")), "Lesung: Und dann...");
    assert.equal(einTitel(ganztags("Lesung: Und dann…")), "Lesung: Und dann...");
  });
});

describe("Eigenschaften über alle Termine der Fixtures", () => {
  const items = [
    ...parseKalenderFeed(oeffentlicherFeed(), "oeffentlich", "Öffentlich").items,
    ...parseKalenderFeed(klassenFeed(), "klasse", "Arbeitsmaterial_10").items,
    ...parseAufgabenFeed(AUFGABEN_FEED, "Aufgaben", ORIGIN).items,
  ];

  it("kein „_“, kein „IServ“ vorn, kein Datum mit Jahr", () => {
    assert.ok(items.length > 30);
    for (const item of items) {
      for (const { titel } of sprechTermine(item, KLASSE)) {
        assert.ok(!titel.includes("_"), titel);
        assert.ok(!titel.startsWith("IServ"), titel);
        assert.ok(!/\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}/.test(titel), titel);
        assert.ok(titel.length > 0 && titel === titel.trim(), titel);
      }
    }
  });

  it("ist zweimal gerechnet gleich", () => {
    for (const item of items) {
      assert.deepEqual(sprechTermine(item, KLASSE), sprechTermine({ ...item }, KLASSE));
      assert.equal(kartenTitel(item, KLASSE), kartenTitel({ ...item }, KLASSE));
    }
  });
});

describe("kartenTitel", () => {
  it("nennt einen geteilten Termin ohne Tageszähler", () => {
    const item = ganztags(
      "1. + 2. Pädagogischer Tag_unterrichtsfrei  (3. Pädagogischer Tag: Mo, 30.11.26)",
      "2026-10-22",
      "2026-10-23",
    );
    assert.equal(kartenTitel(item, KLASSE), "Pädagogischer Tag, frei");
  });

  it("ist sonst der einzige Titel", () => {
    const punkt = mitZeit("Abholung", "2026-12-17T11:30:00+01:00", "2026-12-17T11:30:00+01:00");
    assert.equal(kartenTitel(punkt, KLASSE), "Abholung um 11:30 Uhr");
    assert.equal(kartenTitel(ganztags("Herbstferien_26.10.", "2026-10-24", "2026-11-07"), KLASSE), "Herbstferien");
  });
});
