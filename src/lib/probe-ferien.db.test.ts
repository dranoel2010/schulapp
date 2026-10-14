import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { arbeitsblaetter, examTopics, exams, freePeriods, lessons, studyBlocks } from "@/db/schema";
import { blattFuerBlock } from "@/lib/arbeitsblatt/ablauf";
import { fachMitThema } from "@/lib/arbeitsblatt/test-saat";
import { catchUpMissed, generatePlan, moveOffFreeDays } from "@/lib/exams";
import { ladeTag } from "@/lib/kombi/tag-daten";
import { berlinZeitpunkt } from "@/lib/tag";

/**
 * Ferien bis direkt vor die Klausur (Antwort vom 14.10.2026, „am letzten Tag
 * von den Ferien“): die Probeklausur liegt am letzten Ferientag, nicht eine
 * Woche vorher am letzten Lerntag vor den Ferien. Nur sie darf in die Ferien.
 *
 * Herbstferien Sa 24.10. bis So 1.11., Klausur Montag 2.11.
 */

const KLAUSUR = "2026-11-02";
const FERIEN_VON = "2026-10-24";
const FERIEN_BIS = "2026-11-01";
const inFerien = (tag: string) => tag >= FERIEN_VON && tag <= FERIEN_BIS;

let nutzer = "";
let fach = "";
let thema = "";

async function bloecke(examId: string) {
  return testDb.select().from(studyBlocks).where(eq(studyBlocks.examId, examId));
}

async function neueKlausur(): Promise<string> {
  const [k] = await testDb
    .insert(exams)
    .values({ userId: nutzer, subjectId: fach, date: KLAUSUR, kind: "klausur", leadDays: 14, minutesPerDay: 45 })
    .returning({ id: exams.id });
  await testDb.insert(examTopics).values([
    { examId: k.id, title: "Industrialisierung", sortOrder: 0, subjectTopicId: thema },
    { examId: k.id, title: "Soziale Frage", sortOrder: 1 },
  ]);
  return k.id;
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Ferienprobe");
  const f = await fachMitThema(nutzer, "Geschichte", "Industrialisierung", "2026-10-01");
  fach = f.subjectId;
  thema = f.topicId;
  await testDb.insert(lessons).values([1, 2, 3, 4, 5].map((weekday) => ({ userId: nutzer, subjectId: fach, weekday, period: 1 })));
});

describe("Probeklausur am letzten Ferientag", () => {
  it("Ferien schon eingetragen: die Probe liegt am Sonntag 1.11., sonst nichts in den Ferien", async () => {
    await testDb.insert(freePeriods).values({ userId: nutzer, kind: "ferien", title: "Herbstferien", startsOn: FERIEN_VON, endsOn: FERIEN_BIS });
    const id = await neueKlausur();
    await generatePlan(nutzer, id, "2026-10-19");
    const b = await bloecke(id);
    assert.deepEqual(b.filter((x) => x.kind === "probe").map((x) => x.date), ["2026-11-01"]);
    assert.ok(b.filter((x) => x.kind !== "probe").every((x) => !inFerien(x.date)), "nur die Probe in den Ferien");
    assert.ok(b.some((x) => x.kind === "learn"));
  });

  it("Nachholen zieht eine alte Probe vom Freitag vor den Ferien samt Blatt auf den letzten Ferientag", async () => {
    const id = await neueKlausur();
    await generatePlan(nutzer, id, "2026-10-19");
    const probe = (await bloecke(id)).find((x) => x.kind === "probe")!;
    // So stand sie nach der Regel vom Vormittag des 14.10.2026 im Plan
    await testDb.update(studyBlocks).set({ date: "2026-10-23" }).where(eq(studyBlocks.id, probe.id));
    const zeile = (await blattFuerBlock(nutzer, probe.id))!;
    await catchUpMissed(nutzer, id, "2026-10-20");
    const [p] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, probe.id));
    assert.deepEqual([p.date, p.status], ["2026-11-01", "open"]);
    const [blatt] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, zeile.id));
    assert.equal(blatt.tag, "2026-11-01", "das wartende Blatt zieht mit");
    assert.ok((await bloecke(id)).filter((x) => x.kind !== "probe").every((x) => !inFerien(x.date)));
  });

  it("„Lernplan neu erstellen“ zieht sie ebenso, auch mitten in den Ferien", async () => {
    const id = await neueKlausur();
    await generatePlan(nutzer, id, "2026-10-19");
    const probe = (await bloecke(id)).find((x) => x.kind === "probe")!;
    await testDb.update(studyBlocks).set({ date: "2026-10-23" }).where(eq(studyBlocks.id, probe.id));
    await blattFuerBlock(nutzer, probe.id);
    await generatePlan(nutzer, id, "2026-10-27");
    const proben = (await bloecke(id)).filter((x) => x.kind === "probe" && x.status !== "skipped");
    assert.deepEqual(proben.map((x) => [x.id, x.date]), [[probe.id, "2026-11-01"]]);
  });

  it("Nachholen mitten in den Ferien: verpasste Lernblöcke rutschen nicht auf heute", async () => {
    const id = await neueKlausur();
    await generatePlan(nutzer, id, "2026-10-19");
    const probe = (await bloecke(id)).find((x) => x.kind === "probe")!;
    await testDb.update(studyBlocks).set({ date: "2026-10-23" }).where(eq(studyBlocks.id, probe.id));
    await catchUpMissed(nutzer, id, "2026-10-26");
    const b = (await bloecke(id)).filter((x) => x.status === "open");
    assert.deepEqual(b.filter((x) => x.kind === "probe").map((x) => x.date), ["2026-11-01"]);
    const rest = b.filter((x) => x.kind !== "probe");
    assert.ok(rest.length > 0);
    assert.ok(rest.every((x) => !inFerien(x.date)), "Ferien bleiben frei, nur die Probe liegt darin");
  });

  it("Ferien nachträglich eingetragen: die Probe am Sonntag bleibt, alles andere zieht aus den Ferien", async () => {
    const f = await fachMitThema(nutzer, "Physik", "Optik", "2026-10-01");
    const [k] = await testDb
      .insert(exams)
      .values({ userId: nutzer, subjectId: f.subjectId, date: "2026-11-16", kind: "test", leadDays: 10, minutesPerDay: 45 })
      .returning({ id: exams.id });
    await testDb.insert(examTopics).values({ examId: k.id, title: "Optik", sortOrder: 0, subjectTopicId: f.topicId });
    await generatePlan(nutzer, k.id, "2026-11-02");
    const probe = (await bloecke(k.id)).find((x) => x.kind === "probe")!;
    assert.equal(probe.date, "2026-11-15");
    await testDb.insert(freePeriods).values({ userId: nutzer, kind: "frei", startsOn: "2026-11-12", endsOn: "2026-11-15" });
    assert.equal(await moveOffFreeDays(nutzer, "2026-11-02"), 1);
    const b = await bloecke(k.id);
    assert.deepEqual(b.filter((x) => x.kind === "probe").map((x) => [x.id, x.date, x.status]), [[probe.id, "2026-11-15", "open"]]);
    assert.ok(b.filter((x) => x.kind !== "probe").every((x) => x.date < "2026-11-12"));
  });

  it("ein freier Dienstag vor der Donnerstagsklausur bekommt die Probe nicht, sie liegt am Mittwoch", async () => {
    const f = await fachMitThema(nutzer, "Chemie", "Säuren", "2026-10-01");
    const [k] = await testDb
      .insert(exams)
      .values({ userId: nutzer, subjectId: f.subjectId, date: "2026-11-26", kind: "klausur", leadDays: 10, minutesPerDay: 45 })
      .returning({ id: exams.id });
    await testDb.insert(examTopics).values({ examId: k.id, title: "Säuren", sortOrder: 0, subjectTopicId: f.topicId });
    await testDb.insert(freePeriods).values({ userId: nutzer, kind: "frei", startsOn: "2026-11-24", endsOn: "2026-11-24" });
    await generatePlan(nutzer, k.id, "2026-11-16");
    const probe = (await bloecke(k.id)).find((x) => x.kind === "probe")!;
    assert.equal(probe.date, "2026-11-25");
    // So stand sie nach der Regel vom Abend des 14.10.2026: Ferien eintragen zieht sie weg
    await testDb.update(studyBlocks).set({ date: "2026-11-24" }).where(eq(studyBlocks.id, probe.id));
    assert.equal(await moveOffFreeDays(nutzer, "2026-11-16"), 1);
    const b = await bloecke(k.id);
    assert.deepEqual(b.filter((x) => x.kind === "probe").map((x) => x.date), ["2026-11-25"]);
    assert.ok(b.every((x) => x.date !== "2026-11-24"), "der freie Dienstag bleibt frei");
  });

  it("Startseite: im Ferienmodus am Sonntag 1.11. die Probe, an den übrigen Ferientagen nichts", async () => {
    const sonntag = await ladeTag(nutzer, berlinZeitpunkt("2026-11-01", "10:00"));
    assert.ok(sonntag.ferien, "Ferienmodus");
    assert.equal(sonntag.lernblock?.label, "Probeklausur");
    assert.ok(sonntag.klausurBlock?.heute, "der Klausurblock zeigt die Probe von heute");
    assert.equal(sonntag.klausurBlock?.klausur?.datum, KLAUSUR);
    assert.deepEqual(sonntag.klausurBlock?.verpasst, []);

    const freitag = await ladeTag(nutzer, berlinZeitpunkt("2026-10-30", "10:00"));
    assert.ok(freitag.ferien);
    assert.equal(freitag.lernblock, null);
    assert.equal(freitag.klausurBlock, null);
  });
});
