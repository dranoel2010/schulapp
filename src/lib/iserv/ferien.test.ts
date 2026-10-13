import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { freePeriodEvent } from "@/lib/calendar/events";
import { iservAuswahl } from "@/lib/iserv/auswahl";
import {
  ferienAusIserv,
  ferienPlan,
  planTutEtwas,
  type FerienWunsch,
  type IservFreiZeile,
} from "@/lib/iserv/ferien";
import { FEIERTAGE_FEED, iservTermin, klassenFeed, oeffentlicherFeed } from "@/lib/iserv/fixtures";
import type { FilterConfig } from "@/lib/iserv/klasse";
import { parseFerienFeed, parseKalenderFeed } from "@/lib/iserv/parse";
import type { IservItem } from "@/lib/iserv/types";

/**
 * Der Ferienabgleich als Rechnung — an der Attrappe (@/lib/iserv/fixtures),
 * ohne Datenbank. Die Zeilen der App spielt hier ein Array.
 */

const K10: FilterConfig = { klasse: 10, auch: [], nie: [] };
const HEUTE = "2026-10-05";

function alleItems(): IservItem[] {
  return [
    ...parseKalenderFeed(oeffentlicherFeed(), "oeffentlich", "Öffentlich").items,
    ...parseKalenderFeed(klassenFeed(), "klasse", "Arbeitsmaterial_10").items,
    ...parseFerienFeed(FEIERTAGE_FEED, "Ferien & Feiertage").items,
  ];
}

function kurz(w: FerienWunsch) {
  return [w.title, w.kind, w.startsOn, w.endsOn];
}

describe("ferienAusIserv", () => {
  it("nimmt Ferien und unterrichtsfreie Tage für alle, führt Plugin und Schulkalender zusammen", () => {
    const wuensche = ferienAusIserv({ items: alleItems(), filter: K10, heute: HEUTE });

    assert.deepEqual(wuensche.map(kurz), [
      ["Pädagogischer Tag", "frei", "2026-10-22", "2026-10-23"],
      // Plugin Mo 26.10.–Fr 6.11., Schulkalender Sa 24.10.–Sa 7.11.: ein Zeitraum
      ["Herbstferien", "ferien", "2026-10-24", "2026-11-07"],
      ["3. Pädagogischer Tag", "frei", "2026-11-30", "2026-11-30"],
      // Der 1. Weihnachtsfeiertag geht in den Weihnachtsferien auf
      ["Weihnachtsferien", "ferien", "2026-12-18", "2027-01-02"],
      ["Osterferien", "ferien", "2027-03-20", "2027-04-04"],
      // „Schule und Hort geschlossen“: knapp trotz Hort — die Schule ist zu
      ["Brückentag", "frei", "2027-05-07", "2027-05-07"],
    ]);
  });

  it("gibt dem Zusammengeführten den Schlüssel des Plugins und merkt sich alle", () => {
    const herbst = ferienAusIserv({ items: alleItems(), filter: K10, heute: HEUTE })[1];

    assert.equal(herbst.schluessel, "ferien|holiday-vacations_de_XX-000000000101@iserv.example.test");
    assert.deepEqual(herbst.alleSchluessel, [
      "cal|20260610-145225-0016aa@iserv.example.test|",
      "ferien|holiday-vacations_de_XX-000000000101@iserv.example.test",
    ]);
  });

  it("lässt Hort, Ferienbetreuung, fremde Stufen, Termine mit Uhrzeit und Vergangenes draußen", () => {
    const titel = ferienAusIserv({ items: alleItems(), filter: K10, heute: HEUTE }).map((w) => w.title);

    for (const draussen of ["Ferienbetreuung", "Hort", "Fasching", "Unterrichtsende", "Tag der Deutschen Einheit"]) {
      assert.ok(!titel.some((t) => t.includes(draussen)), `${draussen} gehört nicht zu den freien Tagen`);
    }
  });

  it("nimmt nichts aus dem Klassenkalender und nichts, was ISERV_NIE ausschließt", () => {
    const klasse = parseKalenderFeed(
      [iservTermin({ uid: "k-1", title: "Klassenfahrt-Ferien", start: "2026-10-12T00:00:00+02:00", end: "2026-10-14T00:00:00+02:00", allDay: true })],
      "klasse",
      "K",
    ).items;
    assert.deepEqual(ferienAusIserv({ items: klasse, filter: K10, heute: HEUTE }), []);

    const ohneBrueckentag = ferienAusIserv({
      items: alleItems(),
      filter: { ...K10, nie: ["brückentag"] },
      heute: HEUTE,
    });
    assert.ok(!ohneBrueckentag.some((w) => w.title === "Brückentag"));
  });

  it("nimmt eine Frei-Meldung, die die eigene Klasse nennt, aber keine einer anderen Klasse", () => {
    const items = parseKalenderFeed(
      [
        iservTermin({ uid: "e-1", title: "Kl. 10_unterrichtsfrei", start: "2026-10-15T00:00:00+02:00", end: "2026-10-16T00:00:00+02:00", allDay: true }),
        iservTermin({ uid: "e-2", title: "Kl. 9_unterrichtsfrei", start: "2026-10-16T00:00:00+02:00", end: "2026-10-17T00:00:00+02:00", allDay: true }),
      ],
      "oeffentlich",
      "Ö",
    ).items;

    assert.deepEqual(
      ferienAusIserv({ items, filter: K10, heute: HEUTE }).map((w) => [w.startsOn, w.kind]),
      [["2026-10-15", "frei"]],
    );
  });

  it("hält laufende Ferien, aber nicht die schon vorbei sind", () => {
    const mitten = ferienAusIserv({ items: alleItems(), filter: K10, heute: "2026-10-30" });
    assert.deepEqual(mitten[0].title, "Herbstferien");
    assert.deepEqual(mitten[0].startsOn, "2026-10-24");
  });
});

// ── ferienPlan ───────────────────────────────────────────────────────────────

const HERBST: FerienWunsch = {
  schluessel: "ferien|h",
  alleSchluessel: ["cal|u16|", "ferien|h"],
  kind: "ferien",
  title: "Herbstferien",
  startsOn: "2026-10-24",
  endsOn: "2026-11-07",
};

function zeile(teil: Partial<IservFreiZeile> & Pick<IservFreiZeile, "id" | "iservKey">): IservFreiZeile {
  return { kind: "ferien", title: "Herbstferien", startsOn: "2026-10-24", endsOn: "2026-11-07", ...teil };
}

describe("ferienPlan", () => {
  it("legt an, was es noch nicht gibt", () => {
    const plan = ferienPlan([], [HERBST], HEUTE);
    assert.deepEqual(plan, { neu: [HERBST], aendern: [], loeschen: [] });
  });

  it("tut nichts, wenn alles schon stimmt — auch beim zweiten Lauf", () => {
    const plan = ferienPlan([zeile({ id: "a", iservKey: "ferien|h" })], [HERBST], HEUTE);
    assert.equal(planTutEtwas(plan), false);
  });

  it("verschiebt eine Zeile in derselben Zeile, statt sie neu anzulegen", () => {
    const plan = ferienPlan(
      [zeile({ id: "a", iservKey: "cal|u16|", startsOn: "2026-10-26", endsOn: "2026-11-06" })],
      [HERBST],
      HEUTE,
    );
    assert.deepEqual(plan.neu, []);
    assert.deepEqual(plan.loeschen, []);
    assert.deepEqual(plan.aendern, [
      { id: "a", iservKey: "cal|u16|", kind: "ferien", title: "Herbstferien", startsOn: "2026-10-24", endsOn: "2026-11-07" },
    ]);
  });

  it("erkennt eine Zeile an der Überschneidung wieder, wenn der Schlüssel wechselt", () => {
    const plan = ferienPlan([zeile({ id: "a", iservKey: "ferien|alt" })], [HERBST], HEUTE);
    assert.deepEqual(plan.neu, []);
    assert.deepEqual(plan.aendern.map((a) => [a.id, a.iservKey]), [["a", "ferien|h"]]);
  });

  it("zwei Zeilen für dieselben Ferien werden eine", () => {
    const plan = ferienPlan(
      [zeile({ id: "a", iservKey: "cal|u16|" }), zeile({ id: "b", iservKey: "ferien|h" })],
      [HERBST],
      HEUTE,
    );
    assert.deepEqual(plan.neu, []);
    assert.deepEqual(plan.loeschen, ["b"]);
  });

  it("nimmt künftige Zeilen weg, die IServ nicht mehr meldet", () => {
    const plan = ferienPlan([zeile({ id: "a", iservKey: "ferien|h" })], [], HEUTE);
    assert.deepEqual(plan, { neu: [], aendern: [], loeschen: ["a"] });
  });

  it("vergangene freie Tage bleiben stehen", () => {
    const sommer = zeile({ id: "s", iservKey: "cal|sommer|", title: "Sommerferien", startsOn: "2026-07-09", endsOn: "2026-08-22" });
    const plan = ferienPlan([sommer], [], HEUTE);
    assert.equal(planTutEtwas(plan), false);
  });

  it("laufende Ferien, die IServ nicht mehr meldet, enden gestern — die Tage davor bleiben frei", () => {
    const laufend = zeile({ id: "a", iservKey: "ferien|h" });
    const plan = ferienPlan([laufend], [], "2026-10-28");
    assert.deepEqual(plan.loeschen, []);
    assert.deepEqual(plan.aendern, [{ ...laufend, endsOn: "2026-10-27" }]);
  });

  it("der Anfang laufender Ferien rückt nicht nach vorn", () => {
    const laufend = zeile({ id: "a", iservKey: "ferien|h" });
    const plan = ferienPlan([laufend], [{ ...HERBST, startsOn: "2026-10-29" }], "2026-10-28");
    assert.equal(planTutEtwas(plan), false);
  });

  it("eine Zeile, die vor heute endete, wird höchstens verlängert", () => {
    const vorbei = zeile({ id: "a", iservKey: "ferien|h", startsOn: "2026-10-24", endsOn: "2026-10-27" });
    const plan = ferienPlan([vorbei], [{ ...HERBST, endsOn: "2026-11-07" }], "2026-10-29");
    assert.deepEqual(plan.aendern.map((a) => [a.startsOn, a.endsOn]), [["2026-10-24", "2026-11-07"]]);
  });
});

// ── Google: die Ferien genau einmal ──────────────────────────────────────────

describe("Ferien im Google Kalender", () => {
  it("stehen genau einmal: als Balken der freien Tage, nicht noch einmal als IServ-Termin", () => {
    const items = alleItems();
    const zeitraeume = ferienAusIserv({ items, filter: K10, heute: HEUTE }).map((w, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      quelle: "iserv",
      kind: w.kind,
      title: w.title,
      startsOn: w.startsOn,
      endsOn: w.endsOn,
    }));

    const iserv = iservAuswahl({
      items,
      filter: K10,
      freieZeiten: zeitraeume,
      iservOrigin: "https://iserv.example.test",
      appOrigin: "https://app.example.test",
    });
    const frei = zeitraeume.map((period) => freePeriodEvent({ period, appOrigin: "https://app.example.test" }));
    const alle = [...iserv.wuensche, ...frei].map((w) => w.body.summary ?? "");

    for (const name of ["Herbstferien", "Weihnachtsferien", "Osterferien"]) {
      assert.equal(alle.filter((t) => t.includes(name)).length, 1, `${name} genau einmal`);
    }
    assert.equal(alle.filter((t) => t.includes("Pädagogischer Tag")).length, 2, "der 1.+2. und der 3.");
    assert.equal(alle.filter((t) => t.includes("Brückentag")).length, 1);
    // Das Plugin selbst kommt nie als IServ-Termin
    assert.ok(!iserv.wuensche.some((w) => w.body.summary === "Tag der Deutschen Einheit"));
    // Und der Balken sagt, woher er kommt
    assert.match(frei[1].body.description ?? "", /Aus IServ übernommen/);
  });

  it("ohne freie Tage der App steht die Ferienmeldung als IServ-Termin da — lieber doppelt als gar nicht", () => {
    const iserv = iservAuswahl({
      items: alleItems(),
      filter: K10,
      freieZeiten: [],
      iservOrigin: "https://iserv.example.test",
      appOrigin: "https://app.example.test",
    });
    assert.ok(iserv.wuensche.some((w) => w.body.summary === "Herbstferien"));
  });
});
