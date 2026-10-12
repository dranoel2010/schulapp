import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { homework, subjects } from "@/db/schema";
import { abgleich } from "@/lib/homework-nachlauf";
import {
  aufgabeAbhaken,
  aufgabeAendern,
  aufgabeEintragen,
  aufgabeLoeschen,
  aufgabeWiederherstellen,
} from "@/lib/kombi/aufgaben";
import { eingetragenHeute, protokollVomTag } from "@/lib/protokoll";

const TAG = "2026-10-12";
let nutzer = "";
let fach = "";
let anstoesse: string[] = [];

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const [f] = await testDb
    .insert(subjects)
    .values({ userId: nutzer, name: "Mathematik", short: "Ma" })
    .returning({ id: subjects.id });
  fach = f.id;
  // Spion auf den Kalender-Abgleich (requestCalendarSync)
  abgleich.anstossen = (userId) => {
    anstoesse.push(userId);
  };
});

beforeEach(() => {
  anstoesse = [];
});

const eingabe = { subjectId: fach, title: "S. 84, Nr. 3–5", dueDate: "2026-10-13" };

describe("Aufgaben aus der neuen Oberfläche (Plan 3.3, 3.9)", () => {
  it("Löschen → Rückgängig: dieselbe id, eingetragenHeute zählt sie einmal, kein aufgabe_geloescht", async () => {
    const { id } = await aufgabeEintragen(nutzer, TAG, { ...eingabe, subjectId: fach, details: "Heft" });
    await aufgabeAbhaken(nutzer, TAG, id, true);
    const [vorher] = await testDb.select().from(homework).where(eq(homework.id, id));

    const geloescht = await aufgabeLoeschen(nutzer, TAG, id);
    assert.ok(geloescht);
    assert.equal((await testDb.select().from(homework).where(eq(homework.id, id))).length, 0);
    assert.deepEqual(await eingetragenHeute(nutzer, TAG), []);

    await aufgabeWiederherstellen(nutzer, geloescht.zeile, geloescht.protokollId);
    const [nachher] = await testDb.select().from(homework).where(eq(homework.id, id));
    assert.equal(nachher.id, vorher.id);
    assert.equal(nachher.details, "Heft");
    assert.equal(nachher.doneAt?.getTime(), vorher.doneAt?.getTime());
    assert.equal(nachher.createdAt.getTime(), vorher.createdAt.getTime());
    assert.deepEqual(await eingetragenHeute(nutzer, TAG), [id]);
    const typen = (await protokollVomTag(nutzer, TAG)).map((e) => e.typ);
    assert.ok(!typen.includes("aufgabe_geloescht"));
  });

  it("Abhaken schreibt aufgabe_abgehakt, Rückgängig löscht genau diesen Eintrag", async () => {
    const { id } = await aufgabeEintragen(nutzer, TAG, { ...eingabe, subjectId: fach });
    const vorher = (await protokollVomTag(nutzer, TAG)).length;
    const r = await aufgabeAbhaken(nutzer, TAG, id, true);
    assert.ok(r.protokollId);
    assert.equal((await protokollVomTag(nutzer, TAG)).length, vorher + 1);
    await aufgabeAbhaken(nutzer, TAG, id, false, r.protokollId);
    assert.equal((await protokollVomTag(nutzer, TAG)).length, vorher);
    const [zeile] = await testDb.select().from(homework).where(eq(homework.id, id));
    assert.equal(zeile.doneAt, null);
  });

  it("alle vier Wege und beide Rückgängig stoßen den Kalender-Abgleich an", async () => {
    const { id } = await aufgabeEintragen(nutzer, TAG, { ...eingabe, subjectId: fach });
    assert.equal(anstoesse.length, 1, "Eintragen");
    const hak = await aufgabeAbhaken(nutzer, TAG, id, true);
    assert.equal(anstoesse.length, 2, "Abhaken");
    await aufgabeAbhaken(nutzer, TAG, id, false, hak.protokollId);
    assert.equal(anstoesse.length, 3, "Rückgängig nach Abhaken");
    await aufgabeAendern(nutzer, id, { ...eingabe, subjectId: fach, title: "S. 85" });
    assert.equal(anstoesse.length, 4, "Ändern");
    const weg = await aufgabeLoeschen(nutzer, TAG, id);
    assert.equal(anstoesse.length, 5, "Löschen");
    await aufgabeWiederherstellen(nutzer, weg!.zeile, weg!.protokollId);
    assert.equal(anstoesse.length, 6, "Rückgängig nach Löschen");
    assert.ok(anstoesse.every((u) => u === nutzer));
  });

  it("eine fremde oder unbekannte Aufgabe ändert nichts", async () => {
    const fremd = await testNutzer("Fremd");
    const { id } = await aufgabeEintragen(nutzer, TAG, { ...eingabe, subjectId: fach });
    assert.deepEqual(await aufgabeAbhaken(fremd, TAG, id, true), { ok: false, protokollId: null });
    assert.equal(await aufgabeLoeschen(fremd, TAG, id), null);
    assert.equal((await protokollVomTag(fremd, TAG)).length, 0);
  });
});
