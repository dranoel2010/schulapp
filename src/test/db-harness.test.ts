import { dbBereit, testClient, testDb } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import { db } from "@/db";

before(dbBereit);

describe("db-harness (Wächter)", () => {
  it("@/db liefert die Instanz im Speicher, nicht .data/pglite", async () => {
    const ablage = globalThis as unknown as { __schulappDb?: unknown };
    assert.equal(ablage.__schulappDb, testDb);

    // Die erste echte Abfrage über @/db: sie läuft gegen dieselbe Instanz.
    await db.execute(sql`create table harness_probe (n int)`);
    const zeilen = await testClient.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_name = 'harness_probe'",
    );
    assert.equal(zeilen.rows[0].n, 1);

    // PGlite im Speicher hat kein Verzeichnis.
    assert.equal((testClient as unknown as { dataDir?: string }).dataDir, undefined);
  });

  it("npm test setzt den Riegel gegen die Datei-Datenbank", () => {
    assert.equal(process.env.SCHULAPP_TESTLAUF, "1");
  });

  it("das Schema steht: Tabellen aus beiden Schema-Dateien", async () => {
    const zeilen = await testClient.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const namen = zeilen.rows.map((z) => z.table_name);
    for (const name of ["users", "tagesprotokoll", "arbeitsblaetter", "recall_items"]) {
      assert.ok(namen.includes(name), `${name} fehlt`);
    }
  });
});
