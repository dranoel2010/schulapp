import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { subjects, subjectTopics } from "@/db/schema";
import { protokollVomTag } from "@/lib/protokoll";
import { themaArtSetzen, themaArtZuruecknehmen } from "@/lib/themen-art";

const TAG = "2026-10-12";
const MATHE = { name: "Mathematik" };

describe("Art umstellen (Kriterium 5)", () => {
  let nutzer = "";
  let thema = "";

  before(async () => {
    await dbBereit();
    nutzer = await testNutzer();
    const [f] = await testDb
      .insert(subjects)
      .values({ userId: nutzer, name: "Mathematik", short: "M" })
      .returning({ id: subjects.id });
    const [t] = await testDb
      .insert(subjectTopics)
      .values({ userId: nutzer, subjectId: f.id, title: "Quadratische Funktionen", matchKey: "qf", lastSeenAt: TAG })
      .returning({ id: subjectTopics.id });
    thema = t.id;
  });

  const spalte = async () =>
    (await testDb.select({ art: subjectTopics.art }).from(subjectTopics).where(eq(subjectTopics.id, thema)))[0].art;

  it("schreibt die Abweichung und das Protokoll, Rückgängig nimmt beides zurück", async () => {
    const u = await themaArtSetzen(nutzer, thema, "abfragen", TAG, MATHE);
    assert.equal(await spalte(), "abfragen");
    assert.equal(u.vorher, null);
    const eintraege = await protokollVomTag(nutzer, TAG);
    assert.deepEqual(eintraege.map((e) => [e.typ, e.ref, e.daten]), [["thema_art", thema, { art: "abfragen" }]]);

    await themaArtZuruecknehmen(nutzer, thema, u);
    assert.equal(await spalte(), null);
    assert.equal((await protokollVomTag(nutzer, TAG)).length, 0);
  });

  it("zurück auf die abgeleitete Art leert die Spalte", async () => {
    await themaArtSetzen(nutzer, thema, "abfragen", TAG, MATHE);
    await themaArtSetzen(nutzer, thema, "ueben", TAG, MATHE);
    assert.equal(await spalte(), null);
  });
});
