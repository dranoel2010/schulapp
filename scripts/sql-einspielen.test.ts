import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { beanstandung, getauschteBedingungen, istBedingungsTausch, tauschArtPruefen } from "./sql-einspielen";

describe("sql-einspielen: Tausch einer Bedingung (Plan 3.6)", () => {
  it("DROP CONSTRAINT mit unmittelbar folgendem ADD CONSTRAINT gleichen Namens geht durch", () => {
    const sql = `
      ALTER TABLE "leser_laeufe" DROP CONSTRAINT "leser_laeufe_art_check";
      ALTER TABLE "leser_laeufe" ADD CONSTRAINT "leser_laeufe_art_check" CHECK ("leser_laeufe"."art" in ('a', 'b'));
    `;
    assert.equal(beanstandung(sql), null);
  });

  it("die echte Datei kombi-arbeitsblaetter-checks.sql geht durch", () => {
    const text = readFileSync(
      path.join(process.cwd(), "scripts", "kombi-arbeitsblaetter-checks.sql"),
      "utf8",
    );
    assert.equal(beanstandung(text), null);
  });

  it("ein nacktes DROP CONSTRAINT wird abgewiesen", () => {
    const sql = `ALTER TABLE "leser_laeufe" DROP CONSTRAINT "leser_laeufe_art_check";`;
    assert.match(beanstandung(sql) ?? "", /drop constraint/i);
  });

  it("DROP CONSTRAINT mit anderem Namen dahinter wird abgewiesen", () => {
    const sql = `
      ALTER TABLE "t" DROP CONSTRAINT "x";
      ALTER TABLE "t" ADD CONSTRAINT "y" CHECK (true);
    `;
    assert.notEqual(beanstandung(sql), null);
  });

  it("DROP CONSTRAINT mit ADD auf einer anderen Tabelle wird abgewiesen", () => {
    assert.equal(
      istBedingungsTausch(
        'ALTER TABLE "a" DROP CONSTRAINT "x"',
        'ALTER TABLE "b" ADD CONSTRAINT "x" CHECK (true)',
      ),
      false,
    );
  });

  it("Tausch nur gegen einen CHECK: FK, PK oder UNIQUE gleichen Namens wird abgewiesen", () => {
    for (const neu of [
      'FOREIGN KEY ("u") REFERENCES "users"("id")',
      'PRIMARY KEY ("id")',
      'UNIQUE ("a")',
    ]) {
      assert.notEqual(
        beanstandung(`ALTER TABLE "t" DROP CONSTRAINT "x_fk"; ALTER TABLE "t" ADD CONSTRAINT "x_fk" ${neu};`),
        null,
        neu,
      );
    }
  });

  it("FK→CHECK: der Text nennt die getauschte Bedingung, damit der Katalog ihre Art prüft", () => {
    assert.deepEqual(
      getauschteBedingungen(`ALTER TABLE "t" DROP CONSTRAINT "x_fk"; ALTER TABLE "t" ADD CONSTRAINT "x_fk" CHECK (true);`),
      [{ tabelle: "t", name: "x_fk" }],
    );
  });

  it("FK→CHECK wird im Katalog abgewiesen", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    await db.exec(`create table "u"("id" int primary key); create table "t"("u" int, constraint "x_fk" foreign key ("u") references "u"("id"));`);
    const tausch = `ALTER TABLE "t" DROP CONSTRAINT "x_fk"; ALTER TABLE "t" ADD CONSTRAINT "x_fk" CHECK (true);`;
    await assert.rejects(tauschArtPruefen(db, tausch), /keine CHECK-Bedingung/);
    await db.exec(`alter table "t" add constraint "c_ok" check ("u" > 0);`);
    await tauschArtPruefen(db, `ALTER TABLE "t" DROP CONSTRAINT "c_ok"; ALTER TABLE "t" ADD CONSTRAINT "c_ok" CHECK ("u" >= 0);`);
    await db.close();
  });

  it("DROP CONSTRAINT … CASCADE oder IF EXISTS bleibt verboten", () => {
    assert.notEqual(
      beanstandung(`ALTER TABLE "t" DROP CONSTRAINT "x" CASCADE; ALTER TABLE "t" ADD CONSTRAINT "x" CHECK (true);`),
      null,
    );
    assert.notEqual(
      beanstandung(`ALTER TABLE "t" DROP CONSTRAINT IF EXISTS "x"; ALTER TABLE "t" ADD CONSTRAINT "x" CHECK (true);`),
      null,
    );
  });

  it("DROP CONSTRAINT erst zwei Anweisungen vor dem ADD wird abgewiesen", () => {
    const sql = `
      ALTER TABLE "t" DROP CONSTRAINT "x";
      ALTER TABLE "t" ADD COLUMN "n" integer;
      ALTER TABLE "t" ADD CONSTRAINT "x" CHECK (true);
    `;
    assert.notEqual(beanstandung(sql), null);
  });

  it("DROP TABLE wird weiter abgewiesen", () => {
    assert.notEqual(beanstandung(`DROP TABLE "users";`), null);
    assert.notEqual(beanstandung(`ALTER TABLE "users" DROP COLUMN "name";`), null);
  });

  it("alle kombi-*.sql gehen durch", () => {
    for (const datei of [
      "kombi-tagesprotokoll.sql",
      "kombi-lernblock-uhr.sql",
      "kombi-suche.sql",
      "kombi-themen-art.sql",
      "kombi-arbeitsblaetter.sql",
    ]) {
      const text = readFileSync(path.join(process.cwd(), "scripts", datei), "utf8");
      assert.equal(beanstandung(text), null, datei);
    }
  });
});
