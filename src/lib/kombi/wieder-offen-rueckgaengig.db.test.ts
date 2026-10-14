import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { homework, subjects } from "@/db/schema";
import { createHomework } from "@/lib/homework";
import { nachlauf } from "@/lib/homework-nachlauf";
import { aufgabeAbhaken, wiederOeffnenZuruecknehmen } from "@/lib/kombi/aufgaben-zeile";
import { protokollVomTag } from "@/lib/protokoll";
import { archivSeite } from "@/lib/seiten/archiv";

/**
 * Antwort 6: „Wieder öffnen“ im Archiv hat ein Rückgängig. Es stellt das
 * alte doneAt exakt wieder her (nicht jetzt), so steht die Aufgabe wieder im
 * Archiv. Das alte doneAt kommt vom Gerät und wird geprüft.
 */

const TAG = "2026-10-14";
const JETZT = new Date("2026-10-14T15:00:00Z");
const ALT = "2026-09-24T10:00:00.000Z";
let nutzer = "";
let fremd = "";
let fach = "";
let syncs: string[] = [];

async function archivierte(title: string): Promise<string> {
  const id = await createHomework(nutzer, { subjectId: fach, title, dueDate: "2026-09-23" });
  await testDb.update(homework).set({ doneAt: new Date(ALT) }).where(eq(homework.id, id));
  return id;
}

const doneAt = async (id: string) =>
  (await testDb.select({ d: homework.doneAt }).from(homework).where(eq(homework.id, id)))[0].d;

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Archiv-Rückgängig");
  fremd = await testNutzer("Fremd");
  const [f] = await testDb.insert(subjects).values({ userId: nutzer, name: "Mathematik", short: "M" }).returning({ id: subjects.id });
  fach = f.id;
  nachlauf.sync = (userId) => {
    syncs.push(userId);
  };
});

beforeEach(() => {
  syncs = [];
});

describe("Wieder öffnen im Archiv, Rückgängig", () => {
  it("stellt das alte doneAt exakt zurück, die Aufgabe steht wieder im Archiv, der Protokolleintrag geht", async () => {
    const id = await archivierte("Alte Aufgabe");
    assert.ok((await archivSeite(nutzer, JETZT)).aufgaben.some((a) => a.id === id));

    const o = await aufgabeAbhaken(nutzer, TAG, id, false);
    assert.ok(o.ok);
    if (!o.ok) return;
    assert.equal(await doneAt(id), null);
    assert.ok(!(await archivSeite(nutzer, JETZT)).aufgaben.some((a) => a.id === id));

    const r = await wiederOeffnenZuruecknehmen(nutzer, id, ALT, o.protokollId, JETZT);
    assert.ok(r.ok);
    assert.equal((await doneAt(id))?.toISOString(), ALT);
    const a = (await archivSeite(nutzer, JETZT)).aufgaben.find((x) => x.id === id);
    assert.ok(a?.done);
    assert.ok(!(await protokollVomTag(nutzer, TAG)).some((e) => e.ref === id));
    assert.deepEqual(syncs, [nutzer, nutzer]);
  });

  it("weist einen Zeitpunkt in der Zukunft und Unsinn ab", async () => {
    const id = await archivierte("Zukunft");
    await testDb.update(homework).set({ doneAt: null }).where(eq(homework.id, id));
    for (const falsch of ["2026-10-14T15:00:01.000Z", "gestern", "", "2026-10-14"]) {
      const r = await wiederOeffnenZuruecknehmen(nutzer, id, falsch, null, JETZT);
      assert.equal(r.ok, false, falsch);
    }
    assert.equal(await doneAt(id), null);
    assert.deepEqual(syncs, []);
  });

  it("ändert keine fremde Aufgabe", async () => {
    const id = await archivierte("Nicht deine");
    await testDb.update(homework).set({ doneAt: null }).where(eq(homework.id, id));
    const r = await wiederOeffnenZuruecknehmen(fremd, id, ALT, null, JETZT);
    assert.equal(r.ok, false);
    assert.equal(await doneAt(id), null);
  });

  it("lässt eine inzwischen wieder erledigte Aufgabe bei ihrem neueren Stand", async () => {
    const id = await archivierte("Zweiter Tab");
    const neuer = new Date("2026-10-14T14:00:00Z");
    await testDb.update(homework).set({ doneAt: neuer }).where(eq(homework.id, id));
    const r = await wiederOeffnenZuruecknehmen(nutzer, id, ALT, null, JETZT);
    assert.ok(r.ok);
    assert.equal((await doneAt(id))?.toISOString(), neuer.toISOString());
  });
});
