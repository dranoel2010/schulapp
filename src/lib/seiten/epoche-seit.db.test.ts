import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { lessons, subjects } from "@/db/schema";
import { zeilenVorrat } from "@/lib/kombi/zeilen-vorrat";
import { switchEpoch } from "@/lib/timetable";

import { schulKalender } from "./gemeinsam";

/**
 * Abnahme 15: „Epoche seit …“ nennt nach „Epoche wechseln“ den Tag des
 * Wechsels und nicht den Tag, an dem der Stundenplan angelegt wurde.
 */

let nutzer = "";
let ge = "";
let bio = "";
// Dienstag, 3.11.2026, 17:00 in Berlin
const WECHSEL = new Date("2026-11-03T16:00:00Z");

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Epoche seit");
  [{ id: ge }] = await testDb.insert(subjects).values({ userId: nutzer, name: "Geschichte", short: "Ge" }).returning({ id: subjects.id });
  [{ id: bio }] = await testDb.insert(subjects).values({ userId: nutzer, name: "Biologie", short: "Bio" }).returning({ id: subjects.id });
  // Der Plan wurde am 13.10. angelegt
  await testDb.insert(lessons).values(
    [1, 2, 3, 4, 5].map((weekday) => ({ userId: nutzer, subjectId: ge, weekday, period: 1, createdAt: new Date("2026-10-13T08:00:00Z") })),
  );
});

describe("Epoche seit", () => {
  it("vor dem Wechsel: der Tag, an dem der Plan angelegt wurde", async () => {
    const kal = await schulKalender(nutzer, "2026-10-20");
    assert.equal(kal.epoche, ge);
    assert.equal(kal.epocheSeit, "2026-10-13");
  });

  it("nach „Epoche wechseln“: der Tag des Wechsels, in Kalender und Zeile", async () => {
    const slots = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, period: 1 }));
    assert.equal(await switchEpoch(nutzer, ge, bio, slots, WECHSEL), 5);

    const kal = await schulKalender(nutzer, "2026-11-03");
    assert.equal(kal.epoche, bio);
    assert.equal(kal.epocheSeit, "2026-11-03");

    const vorrat = await zeilenVorrat(nutzer, WECHSEL);
    assert.deepEqual(vorrat.epoche, { fachId: bio, seit: "2026-11-03" });
  });
});
