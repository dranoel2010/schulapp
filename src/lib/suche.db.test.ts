import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { materialPages, materials, materialTopics, subjects, subjectTopics } from "@/db/schema";
import { schreibweisen, sucheBlaetter } from "@/lib/suche";

let nutzer = "";
let fremd = "";
const leer = Buffer.from([0]);
const themen = new Map<string, string>();

async function blatt(userId: string, fachId: string, titel: string, text: string, datum = "2026-10-01", thema?: string) {
  const [m] = await testDb.insert(materials).values({ userId, subjectId: fachId, title: titel, capturedOn: datum }).returning({ id: materials.id });
  await testDb.insert(materialPages).values({ materialId: m.id, sortOrder: 0, width: 1, height: 1, byteSize: 1, image: leer, reading: leer, thumb: leer, transcript: text });
  if (thema) {
    const key = `${fachId}:${thema}`;
    let tid = themen.get(key);
    if (!tid) {
      const [t] = await testDb
        .insert(subjectTopics)
        .values({ userId, subjectId: fachId, title: thema, matchKey: thema.toLowerCase(), lastSeenAt: datum })
        .returning({ id: subjectTopics.id });
      tid = t.id;
      themen.set(key, tid);
    }
    await testDb.insert(materialTopics).values({ materialId: m.id, subjectTopicId: tid });
  }
  return m.id;
}

let dampf = "";
let fabrik = "";
let kaese = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  fremd = await testNutzer("Fremd");
  const [ge] = await testDb.insert(subjects).values({ userId: nutzer, name: "Geschichte", short: "Ge" }).returning({ id: subjects.id });
  const [bio] = await testDb.insert(subjects).values({ userId: nutzer, name: "Biologie", short: "Bi" }).returning({ id: subjects.id });
  const [fge] = await testDb.insert(subjects).values({ userId: fremd, name: "Geschichte", short: "Ge" }).returning({ id: subjects.id });
  dampf = await blatt(nutzer, ge.id, "Die Dampfmaschine", "Die Industrialisierung begann um 1760 in England. James Watt verbesserte sie 1769.", "2026-09-30", "Industrialisierung in England");
  fabrik = await blatt(nutzer, ge.id, "Arbeit in der Fabrik", "Ein Arbeitstag dauerte 12 bis 16 Stunden. Viele zogen in die Städte zu den Fabriken, angetrieben von der Dampfmaschine.", "2026-10-06", "Industrialisierung in England");
  kaese = await blatt(nutzer, bio.id, "Bakterien", "Milchsäurebakterien machen aus Milch Käse und Joghurt.", "2026-10-07");
  await blatt(fremd, fge.id, "Fremde Dampfmaschine", "Dampfmaschine", "2026-10-08");
});

describe("sucheBlaetter (Volltext über die Abschriften)", () => {
  it("findet »dampf« in der Abschrift „Die Dampfmaschine“, Titel vor Text", async () => {
    const r = await sucheBlaetter(nutzer, ["dampf"]);
    assert.deepEqual(r.map((x) => x.id), [dampf, fabrik]);
    assert.ok(r[0].rang > r[1].rang);
    assert.equal(r[0].seiteId !== null, true);
  });

  it("Treffer im Thema zählt vor Treffer nur im Text", async () => {
    const r = await sucheBlaetter(nutzer, ["industrialisierung"]);
    // beide tragen das Thema; der Text von „Dampfmaschine“ nennt es auch
    assert.equal(r.length, 2);
    assert.ok(r.every((x) => x.rang === 2));
  });

  it("alle Wörter müssen treffen — auch über Titel, Fach und Text hinweg", async () => {
    assert.deepEqual((await sucheBlaetter(nutzer, ["geschichte", "watt"])).map((x) => x.id), [dampf]);
    assert.deepEqual(await sucheBlaetter(nutzer, ["dampf", "joghurt"]), []);
  });

  it("ä/ae: »kaese« findet „Käse“, »käse« auch", async () => {
    assert.deepEqual((await sucheBlaetter(nutzer, ["kaese"])).map((x) => x.id), [kaese]);
    assert.deepEqual((await sucheBlaetter(nutzer, ["käse"])).map((x) => x.id), [kaese]);
    assert.ok(schreibweisen("kaese").includes("käse"));
  });

  it("Ausschnitt wie im Prototyp: drei Wörter davor, sechs danach", async () => {
    const [r] = await sucheBlaetter(nutzer, ["watt"], 8, ["watt"]);
    assert.equal(r.ausschnitt, "… in England. James Watt verbesserte sie 1769.");
  });

  it("nur die eigenen Blätter", async () => {
    const r = await sucheBlaetter(nutzer, ["fremde"]);
    assert.deepEqual(r, []);
  });
});
