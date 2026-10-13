import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { homework } from "@/db/schema";
import { addDays, todayInBerlin } from "@/lib/dates";
import { createExam, generatePlan, setTopics } from "@/lib/exams";
import { createGrade } from "@/lib/grades";
import { createHomework, listHomework, setHomeworkDone } from "@/lib/homework";
import { seitenLoader } from "@/lib/seiten";
import { createSubject, setArchived } from "@/lib/subjects";
import { saveLesson, savePeriods } from "@/lib/timetable";

/**
 * Die Loader der Nachschlage-Seiten (Plan G, „Tests“) gegen den Harness:
 * Jede Seite liefert reines JSON (keine Drizzle-Objekte, kein Date), die
 * Hausaufgaben zeigen Erledigtes nur zwei Tage, die Fächer führen
 * archivierte getrennt, Noten stehen älteste zuerst.
 */

let nutzer = "";
const ids: Record<string, string> = {};

/** Serialisierbar heißt: JSON hin und zurück ergibt dasselbe. */
function reinesJson(wert: unknown) {
  assert.deepEqual(JSON.parse(JSON.stringify(wert)), wert);
}

async function laden(art: string, params: Record<string, string> = {}) {
  const loader = seitenLoader(art);
  assert.ok(loader, `Loader für ${art}`);
  return loader(nutzer, params);
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const heute = todayInBerlin();

  for (const [name, short] of [
    ["Mathematik", "Ma"],
    ["Geschichte", "Ge"],
    ["Latein", "La"],
  ]) {
    const s = await createSubject(nutzer, {
      name,
      short,
      color: "blue",
      teacher: null,
      room: null,
      weightWritten: 60,
    } as never);
    ids[name] = s.id;
  }
  await setArchived(nutzer, ids.Latein, true);

  await savePeriods(nutzer, [
    { number: 1, startsAt: "08:00", endsAt: "08:45" },
    { number: 2, startsAt: "08:45", endsAt: "09:30" },
    { number: 3, startsAt: "09:50", endsAt: "10:35" },
  ]);
  for (let wd = 1; wd <= 5; wd++) {
    await saveLesson(nutzer, { weekday: wd, period: 1, subjectId: ids.Geschichte, room: "R. 104", note: null } as never);
    await saveLesson(nutzer, { weekday: wd, period: 2, subjectId: ids.Geschichte, room: "R. 104", note: null } as never);
    await saveLesson(nutzer, { weekday: wd, period: 3, subjectId: ids.Mathematik, room: "R. 208", note: null } as never);
  }

  await createHomework(nutzer, { subjectId: ids.Mathematik, title: "offen später", dueDate: addDays(heute, 9) });
  await createHomework(nutzer, { subjectId: ids.Mathematik, title: "gerade erledigt", dueDate: heute });
  await createHomework(nutzer, { subjectId: ids.Mathematik, title: "lange erledigt", dueDate: addDays(heute, -5) });
  for (const a of await listHomework(nutzer)) {
    if (a.title === "gerade erledigt") await setHomeworkDone(nutzer, a.id, true);
    if (a.title === "lange erledigt") {
      await setHomeworkDone(nutzer, a.id, true);
      await testDb
        .update(homework)
        .set({ doneAt: new Date(Date.now() - 3 * 864e5) })
        .where(eq(homework.id, a.id));
    }
  }

  const exam = await createExam(nutzer, {
    subjectId: ids.Mathematik,
    title: "Quadratische Funktionen",
    kind: "klausur",
    date: addDays(heute, 6),
    leadDays: 5,
    minutesPerDay: 25,
    notes: null,
  });
  ids.klausur = exam.id;
  await setTopics(nutzer, exam.id, ["Scheitelpunktform", "Nullstellen"]);
  await generatePlan(nutzer, exam.id, heute);

  await createGrade(nutzer, { subjectId: ids.Mathematik, value: 20, kind: "schriftlich", weight: 1, date: "2026-09-01", title: "Test" });
  await createGrade(nutzer, { subjectId: ids.Mathematik, value: 23, kind: "muendlich", weight: 1, date: "2026-09-20", title: "Mitarbeit" });
});

describe("Loader der Nachschlage-Seiten", () => {
  it("liefern reines JSON", async () => {
    for (const [art, params] of [
      ["woche", {}],
      ["hausaufgaben", {}],
      ["klausuren", {}],
      ["klausur", { id: ids.klausur }],
      ["noten", {}],
      ["notenfach", { id: ids.Mathematik }],
      ["ablage", {}],
      ["faecher", {}],
      ["fach", { id: ids.Mathematik }],
      ["einstellungen", {}],
      ["archiv", {}],
    ] as const) {
      const daten = await laden(art, params);
      assert.ok(daten, `${art} liefert Daten`);
      reinesJson(daten);
    }
  });

  it("Hausaufgaben: Erledigtes nur zwei Tage", async () => {
    const d = (await laden("hausaufgaben")) as { erledigt: { text: string }[]; spaeter: { text: string }[] };
    const erledigt = d.erledigt.map((a) => a.text);
    assert.ok(erledigt.includes("gerade erledigt"));
    assert.ok(!erledigt.includes("lange erledigt"));
    assert.deepEqual(
      d.spaeter.map((a) => a.text),
      ["offen später"],
    );
  });

  it("Fächer: archivierte getrennt", async () => {
    const d = (await laden("faecher")) as { faecher: { name: string }[]; archiviert: { name: string }[] };
    assert.ok(!d.faecher.some((f) => f.name === "Latein"));
    assert.deepEqual(
      d.archiviert.map((f) => f.name),
      ["Latein"],
    );
  });

  it("Woche: fünf Tage, Doppelstunden zusammengefasst, Hauptunterricht erkannt", async () => {
    const d = (await laden("woche")) as {
      tage: { stunden: { fach: string; von: string; bis: string; hu: boolean }[] }[];
    };
    assert.equal(d.tage.length, 5);
    const tag = d.tage.find((t) => t.stunden.length > 0)!;
    assert.deepEqual(
      tag.stunden.map((s) => [s.fach, s.von, s.bis, s.hu]),
      [
        ["Geschichte", "08:00", "09:30", true],
        ["Mathematik", "09:50", "10:35", false],
      ],
    );
  });

  it("Klausur: Lernplan mit allen Blöcken und Fortschritt", async () => {
    const d = (await laden("klausur", { id: ids.klausur })) as {
      bloecke: unknown[];
      erledigt: number;
      thema: string | null;
    };
    assert.equal(d.thema, "Quadratische Funktionen");
    assert.ok(d.bloecke.length > 0);
    assert.equal(d.erledigt, 0);
  });

  it("Noten: älteste zuerst, Gewichtung des Fachs", async () => {
    const d = (await laden("notenfach", { id: ids.Mathematik })) as {
      noten: { label: string }[];
      anteil: number;
    };
    assert.deepEqual(
      d.noten.map((n) => n.label),
      ["2", "2−"],
    );
    assert.equal(d.anteil, 60);
  });

  it("unbekannte IDs ergeben null", async () => {
    assert.equal(await laden("klausur", { id: "00000000-0000-4000-8000-000000000000" }), null);
    assert.equal(await laden("blatt", { id: "kein-uuid" }), null);
    assert.equal(await laden("fach", { id: "00000000-0000-4000-8000-000000000000" }), null);
  });
});
