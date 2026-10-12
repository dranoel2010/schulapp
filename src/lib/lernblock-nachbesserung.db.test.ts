import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { exams, studyBlocks, subjects, tagesprotokoll } from "@/db/schema";
import { catchUpMissed, missedBlocks } from "@/lib/exams";
import { lernblockUeberblick } from "@/lib/kombi/lernblock-daten";
import { blockErledigt, blockStarten, vergangeneUhrenZuruecksetzen } from "@/lib/lernblock";
import { lernblockEintraegeAbnehmen, lernblockEintraegeZurueck } from "@/lib/protokoll";

/**
 * Nachbesserung Abschnitt F: Wiederöffnen mit Rückgängig, Nachholen
 * angefangener vergangener Blöcke, Lernblöcke heute zu mehreren Klausuren.
 */

const HEUTE = "2026-10-12";
const GESTERN = "2026-10-11";
const T0 = new Date("2026-10-11T14:40:00.000Z");

let nutzer = "";
let mathe = "";
let bio = "";

async function klausur(fach: string, datum: string): Promise<string> {
  const [k] = await testDb
    .insert(exams)
    .values({ userId: nutzer, subjectId: fach, date: datum })
    .returning({ id: exams.id });
  return k.id;
}

async function block(examId: string, date: string): Promise<string> {
  const [b] = await testDb
    .insert(studyBlocks)
    .values({ examId, date, minutes: 25 })
    .returning({ id: studyBlocks.id });
  return b.id;
}

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const [m] = await testDb
    .insert(subjects)
    .values({ userId: nutzer, name: "Mathematik", short: "M" })
    .returning({ id: subjects.id });
  mathe = m.id;
  const [b] = await testDb
    .insert(subjects)
    .values({ userId: nutzer, name: "Biologie", short: "Bi" })
    .returning({ id: subjects.id });
  bio = b.id;
});

describe("Nachbesserung Abschnitt F", () => {
  it("Wiederöffnen und Rückgängig: die Einträge kommen mit derselben ID zurück", async () => {
    const k = await klausur(mathe, "2026-10-20");
    const id = await block(k, GESTERN);
    await blockStarten(nutzer, id, T0, GESTERN);
    await blockErledigt(nutzer, id, 25, GESTERN);
    const vorher = await testDb.select().from(tagesprotokoll).where(eq(tagesprotokoll.ref, id));
    assert.equal(vorher.length, 2);

    const weg = await lernblockEintraegeAbnehmen(nutzer, id);
    assert.deepEqual(weg.map((e) => e.typ), ["lernblock_gestartet", "lernblock_erledigt"]);
    assert.equal((await testDb.select().from(tagesprotokoll).where(eq(tagesprotokoll.ref, id))).length, 0);

    // wie über die Leitung: JSON hin und zurück
    await lernblockEintraegeZurueck(nutzer, id, JSON.parse(JSON.stringify(weg)));
    const danach = await testDb.select().from(tagesprotokoll).where(eq(tagesprotokoll.ref, id));
    assert.deepEqual(
      danach.map((e) => e.id).sort(),
      vorher.map((e) => e.id).sort(),
    );
    assert.deepEqual(
      danach.map((e) => e.createdAt.getTime()).sort(),
      vorher.map((e) => e.createdAt.getTime()).sort(),
    );
  });

  it("fremde Typen lassen sich nicht einschleusen", async () => {
    const k = await klausur(mathe, "2026-10-21");
    const id = await block(k, HEUTE);
    await assert.rejects(
      lernblockEintraegeZurueck(nutzer, id, [
        { id: crypto.randomUUID(), tag: HEUTE, typ: "aufgabe_geloescht", daten: null, createdAt: T0.toISOString() },
      ]),
    );
  });

  it("Nachholen: ein gestern angefangener Block wird verlegt und zählt nicht mehr als verpasst", async () => {
    const k = await klausur(bio, "2026-10-15");
    const id = await block(k, GESTERN);
    await blockStarten(nutzer, id, T0, GESTERN);
    assert.ok((await missedBlocks(nutzer, HEUTE)).some((b) => b.id === id));

    // ohne Zurücksetzen lässt catchUpMissed ihn stehen (Schutz aus Plan 3.5)
    await catchUpMissed(nutzer, k, HEUTE);
    assert.ok((await missedBlocks(nutzer, HEUTE)).some((b) => b.id === id || b.examId === k));

    assert.equal(await vergangeneUhrenZuruecksetzen(nutzer, k, HEUTE), 1);
    await catchUpMissed(nutzer, k, HEUTE);
    assert.equal((await missedBlocks(nutzer, HEUTE)).filter((b) => b.examId === k).length, 0);
  });

  it("Überblick: Lernblöcke heute zu weiteren Klausuren stehen als eigene Zeile", async () => {
    // Bio morgen ohne Block heute, Mathe später mit Block heute
    const andererNutzer = await testNutzer();
    const [bi] = await testDb
      .insert(subjects)
      .values({ userId: andererNutzer, name: "Biologie", short: "Bi" })
      .returning({ id: subjects.id });
    const [ma] = await testDb
      .insert(subjects)
      .values({ userId: andererNutzer, name: "Mathematik", short: "M" })
      .returning({ id: subjects.id });
    const [kb] = await testDb
      .insert(exams)
      .values({ userId: andererNutzer, subjectId: bi.id, date: "2026-10-13" })
      .returning({ id: exams.id });
    const [km] = await testDb
      .insert(exams)
      .values({ userId: andererNutzer, subjectId: ma.id, date: "2026-10-16" })
      .returning({ id: exams.id });
    await block(kb.id, HEUTE);
    await block(km.id, HEUTE);

    const u = await lernblockUeberblick(andererNutzer, HEUTE);
    assert.ok(u);
    assert.equal(u.klausur?.id, kb.id);
    assert.ok(u.heute);
    assert.deepEqual(u.heuteWeitere, [{ examId: km.id, kurz: "Mathe" }]);
  });

  it("Nächster Lernblock nennt die Art, nicht das Thema", async () => {
    const n = await testNutzer();
    const [ma] = await testDb
      .insert(subjects)
      .values({ userId: n, name: "Mathematik", short: "M" })
      .returning({ id: subjects.id });
    const [k] = await testDb
      .insert(exams)
      .values({ userId: n, subjectId: ma.id, date: "2026-10-16" })
      .returning({ id: exams.id });
    await testDb.insert(studyBlocks).values({ examId: k.id, date: "2026-10-14", minutes: 25, kind: "learn" });
    const u = await lernblockUeberblick(n, HEUTE);
    assert.deepEqual(u?.naechster, { tag: "2026-10-14", art: "Lernblock" });
  });
});
