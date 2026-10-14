import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { freePeriods } from "@/db/schema";
import { freePeriodSource } from "@/lib/calendar/sources";
import { freeDatesFrom } from "@/lib/free-days";
import { runIservFetch, type AbrufDeps } from "@/lib/iserv/abruf";
import { neuerSitzungsSpeicher } from "@/lib/iserv/client";
import { IservZugang } from "@/lib/iserv/config";
import { AUFGABEN_FEED, FEIERTAGE_FEED, fakeIserv, json, ORIGIN } from "@/lib/iserv/fixtures";
import { iservStore } from "@/lib/iserv/store";

/**
 * Zwei Fälle aus der Abnahme des Ferienabgleichs, gegen eine echte Datenbank
 * (PGlite im Speicher) und die Attrappe von IServ:
 *
 *   - Die Herbstferien stehen schon von Hand da (die Ferienseite war vom
 *     4.10.2026 an live). Nach dem Abgleich bleibt die Hand-Zeile unberührt,
 *     in Google stehen die Herbstferien trotzdem genau einmal.
 *   - Das Plugin „holiday“ kommt dreimal hintereinander leer. Die freien
 *     Tage, die nur aus dem Plugin kommen (hier erfundene Pfingstferien),
 *     bleiben stehen — eine leere Liste ist dort nie echt.
 */

const HEUTE = "2026-10-05";
/** 12:15 in Berlin */
const JETZT = new Date("2026-10-05T10:15:00Z");
const PASSWORT = "probe-passwort";
const STUNDE = 3_600_000;

const PFINGSTEN = {
  id: "holiday-vacations_de_XX-000000000199@iserv.example.test",
  title: "Pfingstferien",
  start: "2027-05-15T00:00:00+02:00",
  end: "2027-05-19T00:00:00+02:00",
  allDay: true,
  editable: false,
  plugin: "holiday",
  displayFields: [{ text: "Ferien", label: "Art" }],
};

let nutzer = "";

function plugin(holiday: unknown[]) {
  return fakeIserv({
    passwort: PASSWORT,
    routen: {
      "/iserv/calendar4/plugin": ({ url }) => {
        const art = url.searchParams.get("plugin");
        if (art === "exercise") return json(AUFGABEN_FEED);
        if (art === "holiday") return json(holiday);
        return json([], 404);
      },
    },
  });
}

function deps(fake: ReturnType<typeof fakeIserv>): AbrufDeps {
  return {
    config: {
      zugang: new IservZugang(ORIGIN, "test.schueler", PASSWORT),
      klasse: 10,
      auch: [],
      nie: [],
      klassenkalender: null,
    },
    store: iservStore,
    freieZeiten: async () => [],
    fetch: fake.fetch,
    speicher: neuerSitzungsSpeicher(),
    push: async () => undefined,
  };
}

const lauf = (jetzt: Date, fake: ReturnType<typeof fakeIserv>) =>
  runIservFetch(nutzer, { anlass: "hand", jetzt, deadline: Date.now() + 60_000 }, deps(fake));

async function zeilen() {
  return testDb
    .select()
    .from(freePeriods)
    .where(eq(freePeriods.userId, nutzer))
    .orderBy(freePeriods.startsOn);
}

async function balken() {
  const wuensche = await freePeriodSource.wanted({
    userId: nutzer,
    reminderHour: 16,
    appOrigin: "https://app.example.test",
  });
  return wuensche.map((w) => w.body.summary ?? "");
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();

  // Von Hand, wie vor Modell 23 auf der Ferienseite eingetragen
  await testDb.insert(freePeriods).values([
    { userId: nutzer, kind: "ferien", title: null, startsOn: "2026-10-26", endsOn: "2026-11-06" },
    { userId: nutzer, kind: "klassenfahrt", title: null, startsOn: "2026-10-12", endsOn: "2026-10-14" },
  ]);
});

describe("Ferienabgleich neben von Hand eingetragenen Ferien", () => {
  it("die Hand-Zeile bleibt, wie sie war — in Google stehen die Herbstferien genau einmal", async () => {
    const ergebnis = await lauf(JETZT, plugin([...FEIERTAGE_FEED, PFINGSTEN]));
    assert.equal(ergebnis.status, "gelesen", JSON.stringify(ergebnis));

    const alle = await zeilen();
    assert.deepEqual(
      alle.filter((z) => z.quelle === null).map((z) => [z.kind, z.title, z.startsOn, z.endsOn]),
      [
        ["klassenfahrt", null, "2026-10-12", "2026-10-14"],
        ["ferien", null, "2026-10-26", "2026-11-06"],
      ],
    );
    assert.ok(
      alle.some((z) => z.quelle === "iserv" && z.title === "Herbstferien" && z.startsOn === "2026-10-24"),
    );

    const titel = await balken();
    // Die Hand-Zeile hieße „Ferien“ — sie fällt weg, weil IServ sie ganz abdeckt
    assert.equal(titel.filter((t) => t === "Herbstferien" || t === "Ferien").length, 1, titel.join(" | "));
    assert.equal(titel.filter((t) => t === "Klassenfahrt").length, 1);
    for (const name of ["Weihnachtsferien", "Osterferien", "Pfingstferien"]) {
      assert.equal(titel.filter((t) => t === name).length, 1, `${name} genau einmal`);
    }
  });

  it("drei leere Antworten des Plugins nacheinander löschen keinen freien Tag", async () => {
    const vorher = await zeilen();
    assert.ok(vorher.some((z) => z.title === "Pfingstferien"));

    for (const stunden of [3, 6, 9]) {
      const ergebnis = await lauf(new Date(JETZT.getTime() + stunden * STUNDE), plugin([]));
      assert.equal(ergebnis.status, "teilweise", `nach ${stunden} Stunden: ${JSON.stringify(ergebnis)}`);
      assert.match(ergebnis.satz ?? "", /Ferien und Feiertage leer\. Der alte Stand/);
      assert.deepEqual(await zeilen(), vorher, `nach ${stunden} Stunden`);
    }

    const frei = await freeDatesFrom(nutzer, HEUTE);
    for (const tag of ["2027-05-15", "2027-05-18", "2026-10-28"]) {
      assert.ok(frei.includes(tag), `${tag} bleibt frei`);
    }
  });
});
