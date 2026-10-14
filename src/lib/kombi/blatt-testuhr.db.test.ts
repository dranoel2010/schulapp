import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { materials, subjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { blaetterVomTag } from "@/lib/kombi/blaetter";
import { blattAnlegen } from "@/lib/kombi/blatt-aufnahme";
import { berlinZeitpunkt } from "@/lib/tag";

/**
 * Schlussrunde: ein im Ablauf fotografiertes Blatt steht nach dem Neuladen in
 * Schritt 1, auch wenn die Testuhr auf einem anderen Tag steht als die Uhr der
 * Datenbank. `blaetterVomTag` sucht über `created_at`; das trägt jetzt die Uhr
 * des Aufrufers, wie `captured_on`.
 */

let nutzer = "";
// weit weg von der echten Uhr: der Default der Datenbank läge nie an diesem Tag
const JETZT = berlinZeitpunkt("2026-03-02", "14:30");
const SEITE = { mimeType: "image/jpeg", width: 10, height: 14, image: new Uint8Array([1]), reading: new Uint8Array([1]), thumb: new Uint8Array([1]) };

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("BlattTestuhr");
  await testDb.insert(subjects).values({ userId: nutzer, name: "Mathematik", short: "M" });
});

describe("Blätter mit Testuhr", () => {
  it("blattAnlegen schreibt created_at mit der Uhr des Aufrufers", async () => {
    const a = await blattAnlegen(nutzer, JETZT, SEITE);
    assert.ok(a.ok);
    const [m] = await testDb.select({ createdAt: materials.createdAt, capturedOn: materials.capturedOn }).from(materials).where(eq(materials.id, a.id));
    assert.equal(m.createdAt.toISOString(), JETZT.toISOString());
    assert.equal(m.capturedOn, "2026-03-02");
  });

  it("blaetterVomTag findet das Blatt am Tag der Testuhr", async () => {
    const b = await blattAnlegen(nutzer, JETZT, { ...SEITE, uploadKey: "testuhr-2" });
    assert.ok(b.ok);
    const ids = (await blaetterVomTag(nutzer, "2026-03-02")).map((x) => x.id);
    assert.ok(ids.includes(b.id), JSON.stringify(ids));
    assert.equal((await blaetterVomTag(nutzer, "2026-03-03")).length, 0);
  });
});
