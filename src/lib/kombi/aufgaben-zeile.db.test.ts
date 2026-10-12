import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { homework, subjects } from "@/db/schema";
import { nachlauf } from "@/lib/homework-nachlauf";
import {
  abhakenZuruecknehmen,
  aufgabeAbhaken,
  aufgabeAendern,
  aufgabeEintragen,
  eintragenZuruecknehmen,
} from "@/lib/kombi/aufgaben-zeile";
import { protokollVomTag } from "@/lib/protokoll";

const TAG = "2026-10-12";
let nutzer = "";
let fach = "";
let syncs: string[] = [];

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const [f] = await testDb.insert(subjects).values({ userId: nutzer, name: "Mathematik", short: "M" }).returning({ id: subjects.id });
  fach = f.id;
  // Spion statt echtem Google-Abgleich
  nachlauf.sync = (userId) => {
    syncs.push(userId);
  };
});

beforeEach(() => {
  syncs = [];
});

describe("Aufgaben aus der Zeile", () => {
  it("Eintragen legt an, protokolliert und stößt den Kalender an", async () => {
    const r = await aufgabeEintragen(nutzer, TAG, { subjectId: fach, title: "S. 90, Nr. 1–4", dueDate: "2026-10-13" });
    assert.ok(r.ok);
    if (!r.ok) return;
    const [a] = await testDb.select().from(homework);
    assert.equal(a.id, r.id);
    assert.equal(a.title, "S. 90, Nr. 1–4");
    const log = await protokollVomTag(nutzer, TAG);
    assert.deepEqual(log.map((e) => [e.typ, e.ref]), [["aufgabe_eingetragen", r.id]]);
    assert.deepEqual(syncs, [nutzer]);

    // Rückgängig: weg, ohne Spur, und wieder ein Abgleich
    await eintragenZuruecknehmen(nutzer, r.id, r.protokollId);
    assert.equal((await testDb.select().from(homework)).length, 0);
    assert.equal((await protokollVomTag(nutzer, TAG)).length, 0);
    assert.deepEqual(syncs, [nutzer, nutzer]);
  });

  it("weist ein fremdes oder leeres Fach ab", async () => {
    const r = await aufgabeEintragen(nutzer, TAG, { subjectId: "00000000-0000-4000-8000-000000000000", title: "x", dueDate: "2026-10-13" });
    assert.equal(r.ok, false);
    assert.deepEqual(syncs, []);
  });

  it("Abhaken und Rückgängig, beide mit Abgleich", async () => {
    const r = await aufgabeEintragen(nutzer, TAG, { subjectId: fach, title: "Heft", dueDate: "2026-10-13" });
    assert.ok(r.ok);
    if (!r.ok) return;
    const h = await aufgabeAbhaken(nutzer, TAG, r.id, true);
    assert.ok(h.ok);
    if (!h.ok) return;
    assert.ok((await testDb.select().from(homework))[0].doneAt);
    await abhakenZuruecknehmen(nutzer, r.id, false, h.protokollId);
    assert.equal((await testDb.select().from(homework))[0].doneAt, null);
    const typen = (await protokollVomTag(nutzer, TAG)).map((e) => e.typ);
    assert.ok(!typen.includes("aufgabe_abgehakt"));
    assert.equal(syncs.length, 3);
  });

  it("Ändern schreibt kein Protokoll, stößt aber den Abgleich an", async () => {
    const r = await aufgabeEintragen(nutzer, TAG, { subjectId: fach, title: "Alt", dueDate: "2026-10-13" });
    assert.ok(r.ok);
    if (!r.ok) return;
    const vorher = (await protokollVomTag(nutzer, TAG)).length;
    const e = await aufgabeAendern(nutzer, r.id, { subjectId: fach, title: "Neu", dueDate: "2026-10-14" });
    assert.ok(e.ok);
    const a = (await testDb.select().from(homework)).find((x) => x.id === r.id)!;
    assert.equal(a.title, "Neu");
    assert.equal(a.dueDate, "2026-10-14");
    assert.equal((await protokollVomTag(nutzer, TAG)).length, vorher);
    assert.equal(syncs.length, 2);
  });
});
