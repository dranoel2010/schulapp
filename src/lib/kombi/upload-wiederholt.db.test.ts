import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { materialPages, materials, subjects, tagesprotokoll } from "@/db/schema";
import { blattAnlegen, seiteAnhaengen, uploadSchluessel } from "@/lib/kombi/blatt-aufnahme";

/**
 * Abnahmerunde 16: Der Browser wiederholt einen Foto-Upload, wenn die
 * Antwort ausbleibt. Kam die Seite trotzdem an, darf die Wiederholung kein
 * zweites Blatt anlegen und keine Seite zweimal anhängen. Erkannt wird sie an
 * uid der Aufnahme und Seitennummer (`material_pages.upload_key`).
 */

const SEITE = {
  mimeType: "image/jpeg",
  width: 10,
  height: 14,
  image: new Uint8Array([1, 2, 3]),
  reading: new Uint8Array([1, 2]),
  thumb: new Uint8Array([1]),
};
const JETZT = new Date("2026-10-12T12:10:00Z");

let nutzer = "";
let andere = "";

const blaetter = async (wer: string) => (await testDb.select({ id: materials.id }).from(materials).where(eq(materials.userId, wer))).length;
const seitenVon = async (id: string) => (await testDb.select({ id: materialPages.id }).from(materialPages).where(eq(materialPages.materialId, id))).length;
const protokoll = async (wer: string, typ: string) =>
  (await testDb.select().from(tagesprotokoll).where(and(eq(tagesprotokoll.userId, wer), eq(tagesprotokoll.typ, typ)))).length;

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Upload");
  andere = await testNutzer("Andere");
  await testDb.insert(subjects).values([
    { userId: nutzer, name: "Mathematik", short: "M" },
    { userId: andere, name: "Mathematik", short: "M" },
  ]);
});

describe("Wiederholter Upload derselben Seite", () => {
  it("uploadSchluessel nimmt nur eine uid und eine Seite im Rahmen", () => {
    assert.equal(uploadSchluessel("n", "6f1c2b0a-1111-4222-8333-944455556666", "0"), "n:6f1c2b0a-1111-4222-8333-944455556666:0");
    assert.equal(uploadSchluessel("n", "", "0"), null);
    assert.equal(uploadSchluessel("n", "kurz", "0"), null);
    assert.equal(uploadSchluessel("n", "a b c d e f g h", "0"), null);
    assert.equal(uploadSchluessel("n", "6f1c2b0a-1111-4222-8333-944455556666", ""), null);
    assert.equal(uploadSchluessel("n", "6f1c2b0a-1111-4222-8333-944455556666", "99"), null);
  });

  it("neues Blatt: die Wiederholung gibt dasselbe Blatt zurück, kein zweites, ein Protokolleintrag", async () => {
    const uid = randomUUID();
    const vorher = await blaetter(nutzer);
    const log = await protokoll(nutzer, "blatt_abgelegt");
    const erste = await blattAnlegen(nutzer, JETZT, { ...SEITE, uploadKey: uploadSchluessel(nutzer, uid, "0") }, { seiten: 2 });
    const zweite = await blattAnlegen(nutzer, JETZT, { ...SEITE, uploadKey: uploadSchluessel(nutzer, uid, "0") }, { seiten: 2 });
    assert.ok(erste.ok && zweite.ok);
    assert.equal(zweite.id, erste.id);
    assert.equal(zweite.wiederholt, true);
    assert.equal(await blaetter(nutzer), vorher + 1);
    assert.equal(await protokoll(nutzer, "blatt_abgelegt"), log + 1);

    // die zweite Seite derselben Aufnahme, auch sie wiederholt
    const s2 = { ...SEITE, uploadKey: uploadSchluessel(nutzer, uid, "1") };
    const a = await seiteAnhaengen(nutzer, JETZT, erste.id, s2, { folge: true });
    const b = await seiteAnhaengen(nutzer, JETZT, erste.id, s2, { folge: true });
    assert.ok(a.ok && b.ok && b.wiederholt);
    assert.equal(await seitenVon(erste.id), 2);
  });

  it("„Seite dazu“: dieselbe Seite hängt nur einmal am Blatt, seite_dazu nur einmal im Protokoll", async () => {
    const blatt = await blattAnlegen(nutzer, JETZT, SEITE);
    assert.ok(blatt.ok);
    const uid = randomUUID();
    const log = await protokoll(nutzer, "seite_dazu");
    const seite = { ...SEITE, uploadKey: uploadSchluessel(nutzer, uid, "0") };
    await seiteAnhaengen(nutzer, JETZT, blatt.id, seite);
    const zweimal = await seiteAnhaengen(nutzer, JETZT, blatt.id, seite);
    assert.ok(zweimal.ok && zweimal.wiederholt);
    assert.equal(zweimal.id, blatt.id);
    assert.equal(await seitenVon(blatt.id), 2);
    assert.equal(await protokoll(nutzer, "seite_dazu"), log + 1);
  });

  it("zwei Anfragen zugleich (Proxy gab 504, der Server schreibt noch): ein Blatt", async () => {
    const uid = randomUUID();
    const vorher = await blaetter(nutzer);
    const seite = { ...SEITE, uploadKey: uploadSchluessel(nutzer, uid, "0") };
    const [x, y] = await Promise.all([blattAnlegen(nutzer, JETZT, seite), blattAnlegen(nutzer, JETZT, seite)]);
    assert.ok(x.ok && y.ok);
    assert.equal(x.id, y.id);
    assert.equal(await blaetter(nutzer), vorher + 1);
  });

  it("ohne Schlüssel (alte App) bleibt es wie bisher; dieselbe uid eines anderen Nutzers stört nicht", async () => {
    const vorher = await blaetter(nutzer);
    await blattAnlegen(nutzer, JETZT, SEITE);
    await blattAnlegen(nutzer, JETZT, { ...SEITE, uploadKey: null });
    assert.equal(await blaetter(nutzer), vorher + 2);

    const uid = randomUUID();
    const meins = await blattAnlegen(nutzer, JETZT, { ...SEITE, uploadKey: uploadSchluessel(nutzer, uid, "0") });
    const fremd = await blattAnlegen(andere, JETZT, { ...SEITE, uploadKey: uploadSchluessel(andere, uid, "0") });
    assert.ok(meins.ok && fremd.ok);
    assert.notEqual(meins.id, fremd.id);
    assert.equal(fremd.wiederholt, undefined);
  });
});
