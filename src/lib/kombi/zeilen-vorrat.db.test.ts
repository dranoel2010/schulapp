import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { exams, grades, homework, lessons, subjects, subjectTopics } from "@/db/schema";
import { blattMitAbschrift, fachMitThema, frageMitTerminen } from "@/lib/arbeitsblatt/test-saat";
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
  // Tag 14 nach dem Klausurtag steht noch in der Liste, Tag 15 im Archiv
  await testDb.insert(exams).values({ userId: nutzer, subjectId: ge.id, date: "2026-09-28", title: "Tag vierzehn" });
  await testDb.insert(exams).values({ userId: nutzer, subjectId: ge.id, date: "2026-09-27", title: "Tag fuenfzehn" });
  await testDb.insert(grades).values({ userId: nutzer, subjectId: ma.id, value: 20, date: "2026-09-17", title: "Klausur" });

  // Grammatik (Antwort 5): zwei Englisch-Themen mit Blatt, eins ohne, eine Vokabelliste, ein Alias
  const en = await fachMitThema(nutzer, "Englisch", "Simple past", "2026-10-01");
  await blattMitAbschrift(nutzer, en.subjectId, en.topicId, "Simple past", "2026-10-01", "Regel: Verb + ed.");
  const thema = async (title: string, mergedInto: string | null = null) => {
    const [t] = await testDb
      .insert(subjectTopics)
      .values({ userId: nutzer, subjectId: en.subjectId, title, matchKey: title.toLowerCase(), lastSeenAt: "2026-10-05", mergedInto })
      .returning({ id: subjectTopics.id });
    return t.id;
  };
  const pp = await thema("Present perfect");
  await blattMitAbschrift(nutzer, en.subjectId, pp, "Present perfect", "2026-10-05", "have + past participle");
  await frageMitTerminen(nutzer, en.subjectId, pp, ["2026-10-20"]);
  const alias = await thema("Simple past tense", en.topicId);
  await frageMitTerminen(nutzer, en.subjectId, alias, ["2026-10-13"]);
  await thema("Reported speech");
  const vok = await thema("Vokabeln Unit 3");
  await blattMitAbschrift(nutzer, en.subjectId, vok, "Unit 3", "2026-10-05", "to arrive – ankommen");
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
    assert.ok(v.klausuren.some((k) => k.thema === "Quadratische Funktionen"));
    const ma = v.faecher.find((f) => f.name === "Mathematik")!.id;
    assert.deepEqual(v.noten[ma], [{ label: "2", titel: "Klausur", datum: "2026-09-17" }]);
    // Montag nach Schulschluss, Ablauf noch offen
    assert.equal(v.ansicht, "ablauf");
  });

  it("findet vergangene Klausuren bis Tag 14, ab Tag 15 nur noch im Archiv", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    const themen = v.klausuren.map((k) => k.thema);
    assert.ok(themen.includes("Tag vierzehn"));
    assert.ok(!themen.includes("Tag fuenfzehn"));
    // einen Tag später ist auch Tag 14 im Archiv
    const morgen = await zeilenVorrat(nutzer, new Date(JETZT.getTime() + 864e5));
    assert.ok(!morgen.klausuren.some((k) => k.thema === "Tag vierzehn"));
  });

  it("nennt die Fächer mit Klausuren im Archiv, nur die", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    const name = (id: string) => v.faecher.find((f) => f.id === id)?.name;
    assert.deepEqual((v.archivFaecher ?? []).map(name), ["Geschichte"]);
  });

  it("liefert die Grammatikthemen mit Blatt, fälligstes zuerst, Aliase beim Ziel", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    assert.deepEqual(
      v.grammatik.map((t) => `${t.name} ${t.sprache} ${t.faellig}`),
      ["Simple past en 2026-10-13", "Present perfect en 2026-10-20"],
    );
  });

  it("ist serialisierbar und klein", async () => {
    const v = await zeilenVorrat(nutzer, JETZT);
    const json = JSON.stringify(v);
    assert.deepEqual(JSON.parse(json), v);
    assert.ok(json.length < 30_000);
  });
});
