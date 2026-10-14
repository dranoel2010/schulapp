import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { eq } from "drizzle-orm";

import { materialPages, materials, subjects } from "@/db/schema";
import { autoFile } from "@/lib/auto-file";
import { createProposal, proposalInputSchema } from "@/lib/inbox";
import { leserJetzt, leserUhrMerken } from "@/lib/leser/uhr";
import { berlinZeitpunkt } from "@/lib/tag";

/**
 * Ordnet Jev ein Blatt ein, setzt `filed_at` die App-Uhr der Anfrage, die
 * das Einordnen auslöste, nicht die Uhr des Rechners. Jev ist hier ein
 * nachgebautes `fetch`, das immer das erste Fach nennt.
 */

const leer = Buffer.from([0]);
const TEXT = "Quadratische Funktionen: Scheitelpunktform, Streckung und Verschiebung der Normalparabel.";

let nutzer = "";
let fach = "";
const schluesselVorher = process.env.TYPESAFE_API_KEY;

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Einordnen Uhr");
  const [f] = await testDb.insert(subjects).values({ userId: nutzer, name: "Mathematik", short: "M" }).returning({ id: subjects.id });
  fach = f.id;
  process.env.TYPESAFE_API_KEY = "test";
  mock.method(globalThis, "fetch", async () =>
    Response.json({ answers: { fach: { type: "choice", choice: "f0", confidence: 0.9, probabilities: { f0: 0.9 } } } }),
  );
});

after(() => {
  mock.restoreAll();
  if (schluesselVorher === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = schluesselVorher;
});

async function korbblatt(uhr: Date): Promise<string> {
  const [m] = await testDb.insert(materials).values({ userId: nutzer, subjectId: fach, title: "Blatt vom 16.10.", capturedOn: "2026-10-16" }).returning({ id: materials.id });
  await testDb.insert(materialPages).values({ materialId: m.id, sortOrder: 0, width: 1, height: 1, byteSize: 1, image: leer, reading: leer, thumb: leer, transcript: TEXT });
  const id = await createProposal(nutzer, m.id, proposalInputSchema.parse({ title: "Quadratische Funktionen" }), "app");
  assert.ok(id);
  const r = await autoFile(nutzer, id, uhr);
  assert.ok(r.ok, r.ok ? "" : r.grund);
  return m.id;
}

describe("Einordnen durch Jev mit der App-Uhr", () => {
  it("autoFile setzt filed_at mit der übergebenen Uhr", async () => {
    const uhr = berlinZeitpunkt("2026-10-16", "18:05");
    const id = await korbblatt(uhr);
    const [m] = await testDb.select().from(materials).where(eq(materials.id, id));
    assert.equal(m.filedAt?.toISOString(), uhr.toISOString());
  });

  it("der Leser rechnet mit dem Versatz der Anfrage, die ihn anstieß", () => {
    const real = Date.parse("2026-10-14T12:43:00.000Z");
    const n = "leser-uhr-test";
    assert.equal(leserJetzt(n, real).getTime(), real);
    const versatz = berlinZeitpunkt("2026-10-16", "18:05").getTime() - real;
    leserUhrMerken(n, versatz);
    assert.equal(leserJetzt(n, real).toISOString(), berlinZeitpunkt("2026-10-16", "18:05").toISOString());
    // die Testuhr läuft weiter wie eine echte
    assert.equal(leserJetzt(n, real + 60_000).toISOString(), berlinZeitpunkt("2026-10-16", "18:06").toISOString());
    leserUhrMerken(n, 0);
    assert.equal(leserJetzt(n, real).getTime(), real);
  });
});
