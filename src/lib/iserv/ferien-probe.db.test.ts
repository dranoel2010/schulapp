import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { examTopics, exams, freePeriods, lessons, studyBlocks } from "@/db/schema";
import { fachMitThema } from "@/lib/arbeitsblatt/test-saat";
import { generatePlan } from "@/lib/exams";
import { freieTageNachgezogen } from "@/lib/frei-nachlauf";
import { runIservFetch, type AbrufDeps } from "@/lib/iserv/abruf";
import { neuerSitzungsSpeicher } from "@/lib/iserv/client";
import { IservZugang } from "@/lib/iserv/config";
import { FEIERTAGE_FEED, fakeIserv, json, ORIGIN } from "@/lib/iserv/fixtures";
import { iservStore } from "@/lib/iserv/store";

/**
 * Zusammenführung von iserv-ferien und Modell 23: Die Probeklausur am letzten
 * Ferientag (study-plan.ts, Antwort vom 14.10.2026) liest die Ferien aus
 * `free_periods`. Seit es die Ferienseite nicht mehr gibt, legt nur noch der
 * Abgleich mit IServ diese Zeilen an. Hier läuft der Weg ganz: IServ meldet
 * die Herbstferien, der Abruf schreibt sie (quelle = 'iserv'), und der
 * Lernplan legt die Probe auf ihren letzten Tag.
 *
 * Damit der Ferientag sich vom Wochenende unterscheidet, reichen die Ferien
 * hier bis Montag 9.11. (öffentlicher Kalender Sa 24.10. bis Sa 7.11., das
 * Plugin Mo 26.10. bis Mo 9.11.; zusammengeführt Sa 24.10. bis Mo 9.11.). Der
 * Test ist am Dienstag 10.11. Ohne Ferien läge die Probe zwei Tage vorher am
 * Sonntag 8.11.; mit ihnen gehört sie auf Montag 9.11.
 */

const HEUTE = "2026-10-05";
const JETZT = new Date("2026-10-05T10:15:00Z");
const PASSWORT = "probe-passwort";
const TEST = "2026-11-10";
const FERIEN = { von: "2026-10-24", bis: "2026-11-09" };
const inFerien = (tag: string) => tag >= FERIEN.von && tag <= FERIEN.bis;

/** Das Plugin wie in den Fixtures, nur die Herbstferien einen Tag länger (Ende exklusiv). */
const PLUGIN = FEIERTAGE_FEED.map((eintrag) =>
  eintrag.title === "Herbstferien" ? { ...eintrag, end: "2026-11-10T00:00:00+01:00" } : eintrag,
);

function deps(): AbrufDeps {
  const fake = fakeIserv({
    passwort: PASSWORT,
    routen: {
      "/iserv/calendar4/plugin": ({ url }) => {
        const plugin = url.searchParams.get("plugin");
        if (plugin === "holiday") return json(PLUGIN);
        return json([]);
      },
    },
  });
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

async function neuerTest(name: string): Promise<{ nutzer: string; examId: string }> {
  const nutzer = await testNutzer(name);
  const f = await fachMitThema(nutzer, "Physik", "Optik", "2026-10-01");
  await testDb.insert(lessons).values([1, 2, 3, 4, 5].map((weekday) => ({ userId: nutzer, subjectId: f.subjectId, weekday, period: 1 })));
  const [k] = await testDb
    .insert(exams)
    .values({ userId: nutzer, subjectId: f.subjectId, date: TEST, kind: "test", leadDays: 21, minutesPerDay: 45 })
    .returning({ id: exams.id });
  await testDb.insert(examTopics).values({ examId: k.id, title: "Optik", sortOrder: 0, subjectTopicId: f.topicId });
  return { nutzer, examId: k.id };
}

async function abruf(nutzer: string) {
  const ergebnis = await runIservFetch(nutzer, { anlass: "hand", jetzt: JETZT, deadline: Date.now() + 60_000 }, deps());
  assert.equal(ergebnis.status, "gelesen", JSON.stringify(ergebnis));
}

async function offeneBloecke(examId: string) {
  return (await testDb.select().from(studyBlocks).where(eq(studyBlocks.examId, examId))).filter(
    (b) => b.status === "open",
  );
}

before(dbBereit);

describe("Probe am letzten Ferientag mit Ferien aus IServ", () => {
  it("der Abgleich legt die Herbstferien bis Montag 9.11. in free_periods an", async () => {
    const { nutzer } = await neuerTest("Ferien-Probe-1");
    await abruf(nutzer);
    const zeilen = await testDb.select().from(freePeriods).where(eq(freePeriods.userId, nutzer));
    const herbst = zeilen.filter((z) => z.kind === "ferien" && z.startsOn <= "2026-11-01" && z.endsOn >= "2026-10-26");
    assert.deepEqual(
      herbst.map((z) => [z.quelle, z.startsOn, z.endsOn]),
      [["iserv", FERIEN.von, FERIEN.bis]],
    );
  });

  it("Plan nach dem Abgleich: die Probe liegt am Montag 9.11., sonst nichts in den Ferien", async () => {
    const { nutzer, examId } = await neuerTest("Ferien-Probe-2");
    await abruf(nutzer);
    await generatePlan(nutzer, examId, HEUTE);
    const b = await offeneBloecke(examId);
    assert.deepEqual(b.filter((x) => x.kind === "probe").map((x) => x.date), [FERIEN.bis]);
    const rest = b.filter((x) => x.kind !== "probe");
    assert.ok(rest.length > 0);
    assert.ok(rest.every((x) => !inFerien(x.date)), "nur die Probe liegt in den Ferien");
  });

  it("Plan vor dem Abgleich: der Abruf zieht die Probe vom Sonntag auf den letzten Ferientag", async () => {
    const { nutzer, examId } = await neuerTest("Ferien-Probe-3");
    await generatePlan(nutzer, examId, HEUTE);
    const vorher = await offeneBloecke(examId);
    assert.deepEqual(vorher.filter((x) => x.kind === "probe").map((x) => x.date), ["2026-11-08"], "ohne Ferien zwei Tage vorher");
    assert.ok(vorher.some((x) => x.kind !== "probe" && inFerien(x.date)), "ohne Ferien liegt Lernen in den späteren Ferientagen");

    await abruf(nutzer);

    const b = await offeneBloecke(examId);
    assert.deepEqual(b.filter((x) => x.kind === "probe").map((x) => x.date), [FERIEN.bis]);
    assert.ok(b.filter((x) => x.kind !== "probe").every((x) => !inFerien(x.date)), "der Abruf räumt die Ferien frei");
  });
});
