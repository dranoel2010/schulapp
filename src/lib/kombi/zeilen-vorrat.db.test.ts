import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { exams, grades, homework, lessons, subjects } from "@/db/schema";
import { zeilenVorrat } from "@/lib/kombi/zeilen-vorrat";

let nutzer = "";
// Montag, 12.10.2026, 16:40 in Berlin
const JETZT = new Date("2026-10-12T14:40:00Z");

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const [ma] = await testDb.insert(subjects).values({ userId: nutzer, name: "Mathematik", short: "M" }).returning({ id: subjects.id });
  const [ge] = await testDb.insert(subjects).values({ userId: nutzer, name: "Geschichte", short: "Ge" }).returning({ id: subjects.id });
  for (const w of [1, 2, 3, 4, 5]) await testDb.insert(lessons).values({ userId: nutzer, weekday: w, period: 1, subjectId: ge.id, room: "R. 104" });
  await testDb.insert(lessons).values({ userId: nutzer, weekday: 2, period: 2, subjectId: ma.id });
  await testDb.insert(lessons).values({ userId: nutzer, weekday: 2, period: 3, subjectId: ma.id });
  await testDb.insert(homework).values({ userId: nutzer, subjectId: ma.id, title: "S. 84", dueDate: "2026-10-13" });
  await testDb.insert(homework).values({ userId: nutzer, subjectId: ma.id, title: "alt", dueDate: "2026-09-01", doneAt: new Date("2026-09-01T10:00:00Z") });
  await testDb.insert(exams).values({ userId: nutzer, subjectId: ma.id, date: "2026-10-16", title: "Quadratische Funktionen" });
  await testDb.insert(grades).values({ userId: nutzer, subjectId: ma.id, value: 20, date: "2026-09-17", title: "Klausur" });
});

describe("zeilenVorrat", () => {
  it("liefert den Tag, die Fächer mit kurz und Alias und den Stundenplan", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    assert.equal(v.heute, "2026-10-12");
    const ma = v.faecher.find((f) => f.name === "Mathematik")!;
    assert.equal(ma.kurz, "Mathe");
    assert.ok(ma.alias.includes("mathe"));
    assert.equal(ma.k2, "ma");
    // Doppelstunde Mathe am Dienstag zusammengefasst, Hauptunterricht erkannt
    assert.equal(v.stunden["2"].length, 2);
    assert.equal(v.stunden["2"][0].hu, true);
    assert.equal(v.epoche?.fachId, v.faecher.find((f) => f.name === "Geschichte")!.id);
  });

  it("nimmt alte erledigte Aufgaben nicht mit, Klausur und Noten schon", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    assert.deepEqual(v.aufgaben.map((a) => a.text), ["S. 84"]);
    assert.equal(v.klausuren[0].thema, "Quadratische Funktionen");
    const ma = v.faecher.find((f) => f.name === "Mathematik")!.id;
    assert.deepEqual(v.noten[ma], [{ label: "2", titel: "Klausur", datum: "2026-09-17" }]);
    // Montag nach Schulschluss, Ablauf noch offen
    assert.equal(v.ansicht, "ablauf");
  });

  it("ist serialisierbar und klein", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    const json = JSON.stringify(v);
    assert.deepEqual(JSON.parse(json), v);
    assert.ok(json.length < 30_000);
  });
});
