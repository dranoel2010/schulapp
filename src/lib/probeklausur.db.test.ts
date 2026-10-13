import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { arbeitsblaetter, examTopics, exams, freePeriods, leserLaeufe, studyBlocks, subjects } from "@/db/schema";
import { blattAuswerten, blattFuerBlock, blattStand } from "@/lib/arbeitsblatt/ablauf";
import { blattErgebnis } from "@/lib/arbeitsblatt/auftrag";
import { blockZiel, quelleFuerBlock } from "@/lib/arbeitsblatt/quelle";
import { ABSCHRIFT_MATHE, UEBUNG_MATHE } from "@/lib/arbeitsblatt/beispiel";
import { bauFertig, wertungSetzen } from "@/lib/arbeitsblatt/stand";
import { blattMitAbschrift, fachMitThema, frageMitTerminen } from "@/lib/arbeitsblatt/test-saat";
import { catchUpMissed, deleteExam, generatePlan, moveOffFreeDays } from "@/lib/exams";
import { deleteSubject } from "@/lib/subjects";
import { recallSchedule } from "@/recall/schema";

/**
 * Die Probeklausur im Lernplan (Antwort 4 vom 13.10.2026): Klausur und Test
 * bekommen sie beim Neuberechnen des Plans, ein bis zwei Tage vorher; sie
 * ist in jedem Fach ein Arbeitsblatt aus dem Stoff der Klausur, und ihre
 * Auswertung zählt wie eine Kartenrunde.
 */

const HEUTE = "2026-10-12"; // Montag
const KLAUSUR = "2026-10-23"; // Freitag
const um = (tag: string, hhmm = "16:40") => new Date(`${tag}T${hhmm}:00+02:00`);

let nutzer = "";
let fach = "";
let thema = "";
let material = "";
let klausur = "";
const fragen: string[] = [];

async function bloecke(examId: string) {
  return testDb.select().from(studyBlocks).where(eq(studyBlocks.examId, examId));
}

async function neueKlausur(kind: string, datum = KLAUSUR): Promise<string> {
  const [k] = await testDb
    .insert(exams)
    .values({ userId: nutzer, subjectId: fach, date: datum, kind, leadDays: 10, minutesPerDay: 45 })
    .returning({ id: exams.id });
  await testDb.insert(examTopics).values({ examId: k.id, title: "Industrialisierung", sortOrder: 0, subjectTopicId: thema });
  return k.id;
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  // Geschichte ist ein Abfrage-Fach: Lernblöcke laufen dort mit Karten, nicht mit Blatt
  const f = await fachMitThema(nutzer, "Geschichte", "Industrialisierung", "2026-10-01");
  fach = f.subjectId;
  thema = f.topicId;
  material = await blattMitAbschrift(nutzer, fach, thema, "Dampfmaschine", "2026-10-08", ABSCHRIFT_MATHE);
  klausur = await neueKlausur("klausur");
  fragen.push(await frageMitTerminen(nutzer, fach, thema, ["2026-10-19", "2026-10-21", "2026-10-22"], klausur));
});

describe("Probeklausur im Lernplan", () => {
  it("Klausur: eine Probeklausur zwei Tage vorher, allein an ihrem Tag", async () => {
    await generatePlan(nutzer, klausur, HEUTE);
    const b = await bloecke(klausur);
    const probe = b.filter((x) => x.kind === "probe");
    assert.equal(probe.length, 1);
    assert.equal(probe[0].date, "2026-10-21");
    assert.equal(probe[0].minutes, 45);
    assert.equal(probe[0].topicId, null);
    assert.deepEqual(b.filter((x) => x.date === "2026-10-21").map((x) => x.kind), ["probe"]);
  });

  it("Referat und Mündliches bekommen keine", async () => {
    for (const kind of ["referat", "muendlich"]) {
      const id = await neueKlausur(kind);
      await generatePlan(nutzer, id, HEUTE);
      assert.ok(!(await bloecke(id)).some((x) => x.kind === "probe"), kind);
    }
  });

  it("eine bestehende Klausur ohne Probe bekommt sie beim Neuberechnen, erledigte Blöcke bleiben", async () => {
    const id = await neueKlausur("test");
    const [et] = await testDb.select().from(examTopics).where(eq(examTopics.examId, id));
    // Alter Plan vor Antwort 4: ein erledigter Lernblock, keine Probe
    await testDb.insert(studyBlocks).values({ examId: id, date: HEUTE, minutes: 45, kind: "learn", topicId: et.id, status: "done" });
    await generatePlan(nutzer, id, HEUTE);
    const b = await bloecke(id);
    assert.equal(b.filter((x) => x.kind === "probe").length, 1);
    assert.equal(b.filter((x) => x.kind === "learn").length, 1, "der erledigte Lernblock deckt den neuen ab");
    // Noch einmal: keine zweite Probe
    await generatePlan(nutzer, id, HEUTE);
    assert.equal((await bloecke(id)).filter((x) => x.kind === "probe").length, 1);
  });

  it("Nachholen am Vortag der Klausur: die verpasste Probe rückt auf den Vortag, nie auf den Klausurtag", async () => {
    const id = await neueKlausur("klausur", "2026-10-16");
    await generatePlan(nutzer, id, HEUTE);
    const [probe] = (await bloecke(id)).filter((x) => x.kind === "probe");
    assert.equal(probe.date, "2026-10-14");
    // Das Blatt wurde am Vortag schon angelegt, aber noch nicht gebaut
    const zeile = (await blattFuerBlock(nutzer, probe.id))!;
    assert.equal(zeile.tag, "2026-10-14");
    await catchUpMissed(nutzer, id, "2026-10-15");
    const [danach] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, probe.id));
    assert.equal(danach.status, "open");
    assert.equal(danach.date, "2026-10-15");
    const [blatt] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, zeile.id));
    assert.equal(blatt.tag, "2026-10-15", "das wartende Blatt zieht mit");
  });

  describe("eine Probe, die schon im Plan steht, bleibt an ihrem Tag", () => {
    /** Klausur am Montag 19.10., Plan vom 12.10.: Probe am Freitag 16.10., Lernen davor erledigt. */
    async function freitagsProbe(mitBlatt: boolean, gelernt = true) {
      const id = await neueKlausur("klausur", "2026-10-19");
      await generatePlan(nutzer, id, HEUTE);
      const probe = (await bloecke(id)).find((x) => x.kind === "probe")!;
      assert.equal(probe.date, "2026-10-16");
      if (gelernt) {
        await testDb
          .update(studyBlocks)
          .set({ status: "done" })
          .where(and(eq(studyBlocks.examId, id), eq(studyBlocks.kind, "learn")));
      }
      if (mitBlatt) await blattFuerBlock(nutzer, probe.id);
      return { id, probeId: probe.id };
    }
    const probeVon = async (id: string) =>
      (await bloecke(id)).filter((x) => x.kind === "probe").map((x) => [x.date, x.status]);

    it("Nachholen am Freitag: die Probe bleibt offen am Freitag", async () => {
      const { id, probeId } = await freitagsProbe(true);
      await catchUpMissed(nutzer, id, "2026-10-16");
      const [p] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, probeId));
      assert.deepEqual([p.date, p.status], ["2026-10-16", "open"]);
    });

    it("„Lernplan neu erstellen“ am Freitag: mit Blatt bleibt dieselbe Probe, ohne Blatt kommt sie wieder auf Freitag", async () => {
      const a = await freitagsProbe(true);
      await generatePlan(nutzer, a.id, "2026-10-16");
      assert.deepEqual(await probeVon(a.id), [["2026-10-16", "open"]]);
      assert.ok((await bloecke(a.id)).some((x) => x.id === a.probeId && x.status === "open"));

      const b = await freitagsProbe(false);
      await generatePlan(nutzer, b.id, "2026-10-16");
      assert.deepEqual(await probeVon(b.id), [["2026-10-16", "open"]]);
      // und noch einmal: keine zweite, keine gestrichene
      await generatePlan(nutzer, b.id, "2026-10-16");
      assert.deepEqual(await probeVon(b.id), [["2026-10-16", "open"]]);
    });

    it("„Lernplan neu erstellen“ am Freitag ohne Erledigtes: die Probe von heute bleibt, das Lernen kommt danach", async () => {
      const { id } = await freitagsProbe(false, false);
      await generatePlan(nutzer, id, "2026-10-16");
      const b = await bloecke(id);
      assert.deepEqual(await probeVon(id), [["2026-10-16", "open"]]);
      const offen = b.filter((x) => x.kind !== "probe" && x.date >= "2026-10-16");
      assert.ok(offen.some((x) => x.kind === "learn"));
      assert.ok(offen.every((x) => x.date > "2026-10-16"), "die Probe ist allein an ihrem Tag");
    });

    it("Nachholen am Probetag mit weniger als vier Lerntagen: Tag und Status bleiben", async () => {
      // Klausur Freitag 23.10., Plan vom 12.10.: Probe am Mittwoch 21.10.
      const id = await neueKlausur("klausur", "2026-10-23");
      await generatePlan(nutzer, id, HEUTE);
      const probe = (await bloecke(id)).find((x) => x.kind === "probe")!;
      assert.equal(probe.date, "2026-10-21");
      const zeile = (await blattFuerBlock(nutzer, probe.id))!;
      await catchUpMissed(nutzer, id, "2026-10-21");
      const [p] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, probe.id));
      assert.deepEqual([p.date, p.status], ["2026-10-21", "open"]);
      const [blatt] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, zeile.id));
      assert.equal(blatt.tag, "2026-10-21");
    });

    it("Ferien eintragen: an einem anderen Tag bleibt die Probe, an ihrem Tag rückt sie mit Blatt auf den nächstfrüheren Schultag", async () => {
      const f = await fachMitThema(nutzer, "Physik", "Optik", "2026-10-01");
      const [k] = await testDb
        .insert(exams)
        .values({ userId: nutzer, subjectId: f.subjectId, date: "2026-11-06", kind: "klausur", leadDays: 10, minutesPerDay: 45 })
        .returning({ id: exams.id });
      await testDb.insert(examTopics).values({ examId: k.id, title: "Optik", sortOrder: 0, subjectTopicId: f.topicId });
      await generatePlan(nutzer, k.id, "2026-10-28");
      const probe = (await bloecke(k.id)).find((x) => x.kind === "probe")!;
      assert.equal(probe.date, "2026-11-04");
      const zeile = (await blattFuerBlock(nutzer, probe.id))!;

      // Der Dienstag davor wird frei, dort liegt die Wiederholung: die Probe bleibt
      // (neu gerechnet ergäben die übrigen drei Lerntage einen Tag Abstand, also Donnerstag)
      const dienstag = (await bloecke(k.id)).find((x) => x.kind !== "probe" && x.date === "2026-11-03");
      assert.ok(dienstag);
      await testDb.insert(freePeriods).values({ userId: nutzer, kind: "frei", startsOn: "2026-11-03", endsOn: "2026-11-03" });
      await moveOffFreeDays(nutzer, "2026-11-02");
      assert.equal((await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, probe.id)))[0].date, "2026-11-04");

      // Ihr eigener Tag wird auch frei: der Abstand bleibt zwei Tage, Dienstag
      // ist frei, also der Montag
      await testDb.insert(freePeriods).values({ userId: nutzer, kind: "frei", startsOn: "2026-11-04", endsOn: "2026-11-04" });
      await moveOffFreeDays(nutzer, "2026-11-02");
      const [p] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, probe.id));
      assert.deepEqual([p.date, p.status], ["2026-11-02", "open"]);
      const [blatt] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, zeile.id));
      assert.equal(blatt.tag, "2026-11-02", "das wartende Blatt zieht mit");
    });
  });

  it("Nachholen am Sonntag vor der Klausur am Montag: kein Schultag mehr, die Probe fällt weg", async () => {
    const id = await neueKlausur("klausur", "2026-10-19");
    await generatePlan(nutzer, id, HEUTE);
    const [probe] = (await bloecke(id)).filter((x) => x.kind === "probe");
    assert.equal(probe.date, "2026-10-16");
    await catchUpMissed(nutzer, id, "2026-10-18");
    const [danach] = await testDb.select().from(studyBlocks).where(eq(studyBlocks.id, probe.id));
    assert.equal(danach.status, "skipped");
    assert.equal(danach.date, "2026-10-16");
  });

  it("die Probe ist auch im Abfrage-Fach ein Arbeitsblatt, der Lernblock dort nicht", async () => {
    const b = await bloecke(klausur);
    const probe = b.find((x) => x.kind === "probe")!;
    const lernen = b.find((x) => x.kind === "learn")!;
    assert.equal(await blattFuerBlock(nutzer, lernen.id), null);
    const zeile = await blattFuerBlock(nutzer, probe.id);
    assert.ok(zeile);
    assert.equal(zeile.studyBlockId, probe.id);
    assert.equal(zeile.subjectTopicId, null);
    assert.equal(zeile.tag, "2026-10-21");
    const stand = await blattStand(nutzer, zeile.id, um("2026-10-21"));
    // Die Überschrift nennt den Stoff, nicht noch einmal „Probeklausur“
    assert.equal(stand?.thema, "Industrialisierung");
    // Mit Titel steht der Titel der Klausur im Kopf, auch in der Quelle für den Bau
    await testDb.update(exams).set({ title: "Industrielle Revolution" }).where(eq(exams.id, klausur));
    assert.equal((await blattStand(nutzer, zeile.id, um("2026-10-21")))?.thema, "Industrielle Revolution");
    const ziel = (await blockZiel(nutzer, probe.id))!;
    assert.equal((await quelleFuerBlock(nutzer, ziel)).thema, "Industrielle Revolution");
    await testDb.update(exams).set({ title: null }).where(eq(exams.id, klausur));
    assert.equal(stand?.block?.label, "Probeklausur");
    assert.equal(stand?.fach, "Geschichte");
  });

  it("Auswerten zählt wie eine Kartenrunde: fällige Termine bekommen done_at, die Probe ist erledigt", async () => {
    const probe = (await bloecke(klausur)).find((x) => x.kind === "probe")!;
    const zeile = (await blattFuerBlock(nutzer, probe.id))!;
    const e = blattErgebnis(
      UEBUNG_MATHE,
      { fach: "Geschichte", thema: "Probeklausur", blaetter: [{ materialId: material, titel: "Dampfmaschine", datum: "2026-10-08", seiten: [ABSCHRIFT_MATHE] }] },
      "linien",
    );
    if (e.art !== "fertig") throw new Error("Beispiel ungültig");
    await bauFertig(nutzer, zeile.id, e.inhalt, um("2026-10-21", "06:00"));
    for (let nr = 1; nr <= e.inhalt.aufgaben.length; nr += 1) await wertungSetzen(nutzer, zeile.id, nr, nr !== 2);

    const a = await blattAuswerten(nutzer, zeile.id, um("2026-10-21"), true);
    assert.equal(a.blockErledigt, true);
    assert.deepEqual(a.falsch, [2]);
    assert.equal(a.termineErledigt, 2);
    assert.equal(a.wiederDran, "2026-10-22");

    const termine = await testDb.select().from(recallSchedule).where(inArray(recallSchedule.itemId, fragen));
    for (const t of termine) assert.equal(t.doneAt !== null, t.dueOn <= "2026-10-21", t.dueOn);
    const [b] = await testDb.select().from(studyBlocks).where(and(eq(studyBlocks.id, probe.id)));
    assert.equal(b.status, "done");
  });

  it("Neuplanen, Klausur löschen, Fach löschen: das Blatt der Probe hängt nur am Block und hält nichts auf", async () => {
    const f = await fachMitThema(nutzer, "Englisch", "Unit 3", "2026-10-01");
    const [k] = await testDb
      .insert(exams)
      .values({ userId: nutzer, subjectId: f.subjectId, date: KLAUSUR, kind: "klausur", leadDays: 10, minutesPerDay: 45 })
      .returning({ id: exams.id });
    await testDb.insert(examTopics).values({ examId: k.id, title: "Unit 3", sortOrder: 0, subjectTopicId: f.topicId });
    await generatePlan(nutzer, k.id, HEUTE);
    const probe = (await bloecke(k.id)).find((x) => x.kind === "probe")!;
    const zeile = (await blattFuerBlock(nutzer, probe.id))!;
    // gebaut: mit einem Baulauf, wie ihn die Einstellungen zählen
    await testDb.insert(leserLaeufe).values({ userId: nutzer, art: "arbeitsblatt", arbeitsblattId: zeile.id, ergebnis: "vorschlag" });

    // „Lernplan neu erstellen“: die Probe mit ihrem Blatt bleibt stehen, keine zweite
    await generatePlan(nutzer, k.id, "2026-10-13");
    const neu = (await bloecke(k.id)).filter((x) => x.kind === "probe");
    assert.deepEqual(neu.map((x) => x.id), [probe.id]);

    await deleteExam(nutzer, k.id);
    assert.equal((await testDb.select().from(exams).where(eq(exams.id, k.id))).length, 0);
    assert.equal((await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, zeile.id))).length, 0);

    // dasselbe über das Fach
    const [k2] = await testDb
      .insert(exams)
      .values({ userId: nutzer, subjectId: f.subjectId, date: KLAUSUR, kind: "test", leadDays: 10, minutesPerDay: 45 })
      .returning({ id: exams.id });
    await testDb.insert(examTopics).values({ examId: k2.id, title: "Unit 3", sortOrder: 0, subjectTopicId: f.topicId });
    await generatePlan(nutzer, k2.id, HEUTE);
    const p2 = (await bloecke(k2.id)).find((x) => x.kind === "probe")!;
    const z2 = (await blattFuerBlock(nutzer, p2.id))!;
    await testDb.insert(leserLaeufe).values({ userId: nutzer, art: "arbeitsblatt", arbeitsblattId: z2.id, ergebnis: "vorschlag" });
    await deleteSubject(nutzer, f.subjectId);
    assert.equal((await testDb.select().from(subjects).where(eq(subjects.id, f.subjectId))).length, 0);
  });

  describe("Klausur verschoben, nachdem das Blatt der Probe angelegt ist", () => {
    async function mitBlatt(gebaut: boolean) {
      const f = await fachMitThema(nutzer, "Englisch", `Unit ${gebaut ? 5 : 4}`, "2026-10-01");
      const [k] = await testDb
        .insert(exams)
        .values({ userId: nutzer, subjectId: f.subjectId, date: KLAUSUR, kind: "test", leadDays: 10, minutesPerDay: 45 })
        .returning({ id: exams.id });
      await testDb.insert(examTopics).values({ examId: k.id, title: "Unit", sortOrder: 0, subjectTopicId: f.topicId });
      await generatePlan(nutzer, k.id, HEUTE);
      const probe = (await bloecke(k.id)).find((x) => x.kind === "probe")!;
      assert.equal(probe.date, "2026-10-21");
      const zeile = (await blattFuerBlock(nutzer, probe.id))!;
      if (gebaut) await testDb.update(arbeitsblaetter).set({ status: "fertig" }).where(eq(arbeitsblaetter.id, zeile.id));
      return { examId: k.id, probeId: probe.id, blattId: zeile.id };
    }
    const verschieben = (examId: string, datum: string) =>
      testDb.update(exams).set({ date: datum }).where(eq(exams.id, examId));

    it("vorverlegt: die Probe zieht samt Blatt auf den neuen Tag, nie auf den Klausurtag", async () => {
      const { examId, probeId, blattId } = await mitBlatt(false);
      await verschieben(examId, "2026-10-21");
      await generatePlan(nutzer, examId, "2026-10-20");
      const b = await bloecke(examId);
      const proben = b.filter((x) => x.kind === "probe" && x.status !== "skipped");
      assert.deepEqual(proben.map((x) => [x.id, x.date]), [[probeId, "2026-10-20"]]);
      assert.ok(b.every((x) => x.date !== "2026-10-21"), "nichts am Klausurtag");
      assert.deepEqual(b.filter((x) => x.date === "2026-10-20").map((x) => x.kind), ["probe"]);
      const [blatt] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, blattId));
      assert.equal(blatt.studyBlockId, probeId);
      assert.equal(blatt.tag, "2026-10-20", "ungebautes Blatt bekommt den neuen Tag");
    });

    it("nach hinten verschoben: die Probe rückt mit, Lernen und Wiederholen meiden ihren Tag", async () => {
      const { examId, probeId, blattId } = await mitBlatt(true);
      await verschieben(examId, "2026-10-30");
      await generatePlan(nutzer, examId, "2026-10-13");
      const b = await bloecke(examId);
      const proben = b.filter((x) => x.kind === "probe" && x.status !== "skipped");
      assert.deepEqual(proben.map((x) => [x.id, x.date]), [[probeId, "2026-10-28"]]);
      assert.deepEqual(b.filter((x) => x.date === "2026-10-28").map((x) => x.kind), ["probe"]);
      assert.ok(b.filter((x) => x.kind === "learn").every((x) => x.date < "2026-10-28"));
      const [blatt] = await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, blattId));
      assert.equal(blatt.studyBlockId, probeId, "das gebaute Blatt bleibt");
      assert.equal(blatt.tag, "2026-10-21", "gebautes Blatt behält seinen Kopf");
    });

    it("kein Tag mehr frei: die Probe wird gestrichen, das Blatt bleibt", async () => {
      const { examId, probeId, blattId } = await mitBlatt(true);
      await verschieben(examId, "2026-10-19"); // Montag, heute Sonntag
      await generatePlan(nutzer, examId, "2026-10-18");
      const [p] = (await bloecke(examId)).filter((x) => x.id === probeId);
      assert.equal(p.status, "skipped");
      assert.ok((await bloecke(examId)).every((x) => x.status === "skipped" || x.date === "2026-10-18"));
      assert.equal((await testDb.select().from(arbeitsblaetter).where(eq(arbeitsblaetter.id, blattId))).length, 1);
    });
  });
});
