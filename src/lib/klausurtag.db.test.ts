import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { exams, studyBlocks, subjects } from "@/db/schema";
import { catchUpMissed, missedBlocks } from "@/lib/exams";
import { lernblockUeberblick } from "@/lib/kombi/lernblock-daten";

/**
 * Am Klausurtag wird nicht mehr geübt (Abnahmerunde 11): verpasste Blöcke
 * dieser Klausur fragen nicht mehr nach, und Nachholen legt nichts auf den
 * Nachmittag nach der Klausur.
 */

const KLAUSURTAG = "2026-10-16";

let nutzer = "";
let fach = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const [f] = await testDb
    .insert(subjects)
    .values({ userId: nutzer, name: "Mathematik", short: "M" })
    .returning({ id: subjects.id });
  fach = f.id;
});

describe("der Klausurtag", () => {
  it("bietet keine verpassten Blöcke an und verteilt beim Nachholen nichts auf heute", async () => {
    const [k] = await testDb
      .insert(exams)
      .values({ userId: nutzer, subjectId: fach, date: KLAUSURTAG })
      .returning({ id: exams.id });
    const tage = ["2026-10-13", "2026-10-14", "2026-10-15"];
    for (const date of tage) await testDb.insert(studyBlocks).values({ examId: k.id, date, minutes: 25 });

    // am Vortag: noch verpasst und nachholbar
    assert.equal((await missedBlocks(nutzer, "2026-10-15")).filter((b) => b.examId === k.id).length, 2);

    // am Klausurtag: nichts mehr
    assert.equal((await missedBlocks(nutzer, KLAUSURTAG)).filter((b) => b.examId === k.id).length, 0);
    const ueberblick = await lernblockUeberblick(nutzer, KLAUSURTAG);
    assert.equal(ueberblick?.verpasst.some((v) => v.examId === k.id) ?? false, false);

    await catchUpMissed(nutzer, k.id, KLAUSURTAG);
    const danach = await testDb.select().from(studyBlocks).where(eq(studyBlocks.examId, k.id));
    assert.deepEqual(danach.map((b) => b.date).sort(), tage);
    assert.ok(danach.every((b) => b.status === "open"));

    // und keine Zeile „Noch ein Lernblock heute“ für die Klausur von heute
    await testDb.insert(studyBlocks).values({ examId: k.id, date: KLAUSURTAG, minutes: 25 });
    const mitHeute = await lernblockUeberblick(nutzer, KLAUSURTAG);
    assert.equal(mitHeute?.heuteWeitere.some((h) => h.examId === k.id) ?? false, false);
  });
});
