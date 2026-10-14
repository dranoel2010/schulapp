import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { and, eq, gte, lte } from "drizzle-orm";

import { exams, freePeriods, studyBlocks, subjects } from "@/db/schema";
import { generatePlan, setTopics } from "@/lib/exams";
import { freieTageNachgezogen } from "@/lib/frei-nachlauf";
import { freeDatesFrom } from "@/lib/free-days";
import { runIservFetch, type AbrufDeps } from "@/lib/iserv/abruf";
import { neuerSitzungsSpeicher } from "@/lib/iserv/client";
import { IservZugang } from "@/lib/iserv/config";
import type { FerienWunsch } from "@/lib/iserv/ferien";
import { fakeIserv, json, ORIGIN } from "@/lib/iserv/fixtures";
import { iservStore } from "@/lib/iserv/store";
import { sperrtageAb } from "@/recall/source";

/**
 * Der Ferienabgleich gegen eine echte Datenbank (PGlite im Speicher) und die
 * Attrappe von IServ: Die Herbstferien landen in `free_periods`, eine von
 * Hand eingetragene Klassenfahrt bleibt unberührt, ein zweiter Lauf ändert
 * nichts, und danach liegt kein Lernblock und kein Abruf-Sperrtag mehr falsch.
 */

const HEUTE = "2026-10-05";
/** 12:15 in Berlin */
const JETZT = new Date("2026-10-05T10:15:00Z");
const PASSWORT = "probe-passwort";
const HERBST = { von: "2026-10-24", bis: "2026-11-07" };

let nutzer = "";
let klausur = "";

function deps(fake = fakeIserv({ passwort: PASSWORT })): AbrufDeps {
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
    nachFerien: async (userId) => {
      await freieTageNachgezogen(userId, HEUTE);
    },
  };
}

const lauf = (jetzt: Date, d: AbrufDeps) =>
  runIservFetch(nutzer, { anlass: "hand", jetzt, deadline: Date.now() + 60_000 }, d);

async function zeilen() {
  return testDb
    .select()
    .from(freePeriods)
    .where(eq(freePeriods.userId, nutzer))
    .orderBy(freePeriods.startsOn);
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();

  // Von Hand: eine Klassenfahrt — die fasst der Abgleich nie an.
  await testDb.insert(freePeriods).values({
    userId: nutzer,
    kind: "klassenfahrt",
    title: null,
    startsOn: "2026-10-12",
    endsOn: "2026-10-14",
  });

  // Eine Klausur nach den Herbstferien, geplant, als die App sie noch nicht kannte.
  const [f] = await testDb
    .insert(subjects)
    .values({ userId: nutzer, name: "Mathematik", short: "M" })
    .returning({ id: subjects.id });
  const [k] = await testDb
    .insert(exams)
    .values({ userId: nutzer, subjectId: f.id, date: "2026-11-12", leadDays: 28, minutesPerDay: 45 })
    .returning({ id: exams.id });
  klausur = k.id;
  await setTopics(nutzer, klausur, ["Scheitelpunktform", "Nullstellen", "Parabeln verschieben"]);
  await generatePlan(nutzer, klausur, HEUTE);
});

async function bloeckeInDenHerbstferien() {
  return testDb
    .select()
    .from(studyBlocks)
    .where(
      and(
        eq(studyBlocks.examId, klausur),
        gte(studyBlocks.date, HERBST.von),
        lte(studyBlocks.date, HERBST.bis),
      ),
    );
}

describe("Ferienabgleich mit IServ in der Datenbank", () => {
  it("vorher: der Lernplan legt Blöcke in die Herbstferien", async () => {
    assert.ok((await bloeckeInDenHerbstferien()).length > 0);
  });

  it("legt die freien Tage aus IServ an, die Klassenfahrt bleibt, wie sie war", async () => {
    const ergebnis = await lauf(JETZT, deps());
    assert.equal(ergebnis.status, "gelesen", JSON.stringify(ergebnis));

    const alle = await zeilen();
    const hand = alle.filter((z) => z.quelle === null);
    const iserv = alle.filter((z) => z.quelle === "iserv");

    assert.deepEqual(
      hand.map((z) => [z.kind, z.title, z.startsOn, z.endsOn, z.iservKey]),
      [["klassenfahrt", null, "2026-10-12", "2026-10-14", null]],
    );
    assert.deepEqual(
      iserv.map((z) => [z.kind, z.title, z.startsOn, z.endsOn]),
      [
        ["frei", "Pädagogischer Tag", "2026-10-22", "2026-10-23"],
        ["ferien", "Herbstferien", HERBST.von, HERBST.bis],
        ["frei", "3. Pädagogischer Tag", "2026-11-30", "2026-11-30"],
        ["ferien", "Weihnachtsferien", "2026-12-18", "2027-01-02"],
        ["ferien", "Osterferien", "2027-03-20", "2027-04-04"],
        ["frei", "Brückentag", "2027-05-07", "2027-05-07"],
      ],
    );
    assert.ok(iserv.every((z) => z.iservKey));
  });

  it("danach: kein Lernblock in den Herbstferien, und der Abruf sperrt sie", async () => {
    assert.deepEqual(await bloeckeInDenHerbstferien(), []);

    const sperr = await sperrtageAb(nutzer, HEUTE);
    for (const tag of ["2026-10-24", "2026-10-26", "2026-11-06", "2026-11-07", "2026-10-12"]) {
      assert.ok(sperr.includes(tag), `${tag} ist gesperrt`);
    }
    assert.ok((await freeDatesFrom(nutzer, HEUTE)).includes("2026-10-30"));
  });

  it("ein zweiter Lauf ändert nichts — dieselben Zeilen, dieselben ids", async () => {
    const vorher = await zeilen();
    const ergebnis = await lauf(new Date(JETZT.getTime() + 3 * 3_600_000), deps());
    assert.equal(ergebnis.status, "gelesen");
    assert.deepEqual(await zeilen(), vorher);
  });

  it("eine leere Antwort des Plugins und ein leerer öffentlicher Kalender löschen nichts", async () => {
    const vorher = await zeilen();
    const leer = fakeIserv({
      passwort: PASSWORT,
      routen: {
        "/iserv/calendar/feed/calendar": () => json([]),
        "/iserv/calendar4/plugin": () => json([]),
      },
    });

    const ergebnis = await lauf(new Date(JETZT.getTime() + 6 * 3_600_000), deps(leer));
    assert.equal(ergebnis.status, "fehler");
    assert.deepEqual(await zeilen(), vorher);
  });

  it("der CHECK lässt keine IServ-Zeile ohne Schlüssel zu", async () => {
    await assert.rejects(
      testDb.insert(freePeriods).values({
        userId: nutzer,
        kind: "ferien",
        startsOn: "2027-07-01",
        endsOn: "2027-08-10",
        quelle: "iserv",
      }),
    );
  });
});

// ── Ein Schlüssel wandert: der Index darf nie kurz zwei Zeilen sehen ─────────

/**
 * IServ vergibt einen Schlüssel ein Jahr später wieder, und die laufende
 * Zeile der neuen Ferien trägt einen anderen. Postgres prüft
 * `free_periods_iserv_key_idx` bei jeder Anweisung — die alte Zeile muss
 * ihren Schlüssel abgeben, BEVOR die neue ihn bekommt. Sonst scheitert die
 * ganze Transaktion von `saveRun` (auch Snapshots und Zustand), bei jedem
 * Abruf wieder.
 */
describe("saveRun: ein Schlüssel wandert zu den neuen Ferien", () => {
  async function fall(
    name: string,
    alt: { key: string; von: string; bis: string },
    laufend: { key: string; von: string; bis: string },
    wunsch: FerienWunsch,
    heute: string,
  ) {
    const userId = await testNutzer(name);
    const zeile = (z: { key: string; von: string; bis: string }) => ({
      userId,
      quelle: "iserv",
      iservKey: z.key,
      kind: "ferien",
      title: "Herbstferien",
      startsOn: z.von,
      endsOn: z.bis,
    });
    await testDb.insert(freePeriods).values([zeile(alt), zeile(laufend)]);

    const lauf = () =>
      iservStore.saveRun(userId, {
        attemptAt: new Date(`${heute}T10:00:00Z`),
        success: true,
        snapshots: [],
        error: null,
        warning: null,
        ferien: { wuensche: [wunsch], heute },
      });

    assert.deepEqual(await lauf(), { ferienGeaendert: true });
    const danach = await testDb
      .select()
      .from(freePeriods)
      .where(eq(freePeriods.userId, userId))
      .orderBy(freePeriods.startsOn);
    // Und der nächste Lauf hat nichts mehr zu tun
    assert.deepEqual(await lauf(), { ferienGeaendert: false });
    return danach.map((z) => [z.iservKey, z.startsOn, z.endsOn]);
  }

  it("Plugin-Schlüssel von den Vorjahresferien, die laufende Zeile hat einen Schlüssel, den IServ nicht mehr meldet", async () => {
    const zeilen = await fall(
      "Wandert-1",
      { key: "ferien|1", von: "2025-10-25", bis: "2025-11-08" },
      { key: "oeff|alt", von: "2026-10-24", bis: "2026-11-07" },
      {
        schluessel: "ferien|1",
        alleSchluessel: ["ferien|1", "oeff|neu"],
        kind: "ferien",
        title: "Herbstferien",
        startsOn: "2026-10-24",
        endsOn: "2026-11-07",
      },
      "2026-10-20",
    );
    assert.deepEqual(zeilen, [
      ["ferien|1@2025-10-25", "2025-10-25", "2025-11-08"],
      ["ferien|1", "2026-10-24", "2026-11-07"],
    ]);
  });

  it("derselbe Schlüssel ein Jahr später, die laufende Zeile hat ihren gewechselt", async () => {
    const zeilen = await fall(
      "Wandert-2",
      { key: "K", von: "2025-10-20", bis: "2025-11-01" },
      { key: "P", von: "2026-10-24", bis: "2026-11-07" },
      {
        schluessel: "K",
        alleSchluessel: ["K"],
        kind: "ferien",
        title: "Herbstferien",
        startsOn: "2026-10-24",
        endsOn: "2026-11-07",
      },
      "2026-10-05",
    );
    assert.deepEqual(zeilen, [
      ["K@2025-10-20", "2025-10-20", "2025-11-01"],
      ["K", "2026-10-24", "2026-11-07"],
    ]);
  });
});
