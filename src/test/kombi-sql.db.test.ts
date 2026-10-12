/**
 * Die SQL-Wanderungen von Modell 23 gegen den Stand VOR der Änderung
 * (Plan Abschnitt B und 3.3).
 *
 * Basis ist das Schema von `main`, als Kopie unter src/test/schema-basis/,
 * per `pushSchema` in eine PGlite im Speicher gelegt. Darauf werden die
 * scripts/kombi-*.sql in der Reihenfolge aus Plan 5.1 eingespielt — mit
 * derselben Prüfung wie `scripts/sql-einspielen.ts`. Danach muss die
 * Datenbank genau so aussehen wie eine, die `pushSchema` frisch aus dem NEUEN
 * Schema anlegt. Das prüft zugleich die Namen der Fremdschlüssel, CHECKs und
 * Indizes: ein Name, der nicht der von drizzle-kit ist, stünde hier als
 * Unterschied da.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as dbSchema from "@/db/schema";
import * as recallSchema from "@/recall/schema";
import * as basisDb from "@/test/schema-basis/schema";
import * as basisRecall from "@/test/schema-basis/schema-recall";

import { beanstandung, ohneKommentare } from "../../scripts/sql-einspielen";

export const KOMBI_SQL = [
  "kombi-tagesprotokoll.sql",
  "kombi-lernblock-uhr.sql",
  "kombi-suche.sql",
  "kombi-themen-art.sql",
  "kombi-arbeitsblaetter.sql",
  "kombi-arbeitsblaetter-checks.sql",
] as const;

async function basisMitWanderungen(): Promise<PGlite> {
  const { pushSchema } = await import("drizzle-kit/api");
  const client = new PGlite();
  const basis = drizzle(client);
  const vorher = await pushSchema({ ...basisDb, ...basisRecall }, basis as never);
  await vorher.apply();

  for (const datei of KOMBI_SQL) {
    const text = readFileSync(path.join(process.cwd(), "scripts", datei), "utf8");
    assert.equal(beanstandung(text), null, `${datei} wird abgewiesen`);
    await client.exec(`begin;\n${ohneKommentare(text)}\ncommit;`);
  }

  return client;
}

/**
 * Der Stand einer Datenbank als vergleichbarer Text: Spalten, Bedingungen
 * (Name und Definition) und Indizes (Name und Definition).
 *
 * Verglichen wird über den Katalog und nicht über ein zweites `pushSchema`:
 * das bricht auf einer schon gefüllten Datenbank an einer bekannten
 * Fehlrückfrage ab (es will `lessons` leeren, siehe scripts/sql-einspielen.ts)
 * und beendet dabei den Prozess. Der Katalog ist ohnehin die strengere Probe —
 * er vergleicht Namen UND Definitionen.
 */
async function stand(client: PGlite): Promise<string[]> {
  const spalten = await client.query<{ z: string }>(`
    select table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as z
    from information_schema.columns where table_schema = 'public'`);
  const bedingungen = await client.query<{ z: string }>(`
    select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as z
    from pg_constraint where connamespace = 'public'::regnamespace`);
  const indizes = await client.query<{ z: string }>(`
    select indexname || ' ' || indexdef as z from pg_indexes where schemaname = 'public'`);
  return [...spalten.rows, ...bedingungen.rows, ...indizes.rows]
    .map((zeile) => zeile.z)
    .sort();
}

describe("kombi-*.sql gegen die Basis von main", () => {
  it("ergibt genau den Stand, den pushSchema aus dem neuen Schema anlegt", async () => {
    const { pushSchema } = await import("drizzle-kit/api");
    const gewandert = await basisMitWanderungen();

    const frisch = new PGlite();
    const neu = await pushSchema(
      { ...dbSchema, ...recallSchema },
      drizzle(frisch) as never,
    );
    await neu.apply();

    assert.deepEqual(await stand(gewandert), await stand(frisch));
  });

  it("ein Arbeitsblatt-Lauf: mit arbeitsblatt_id rein, mit material_id raus", async () => {
    const client = await basisMitWanderungen();
    const nutzer = await client.query<{ id: string }>(
      "insert into users (name, password_hash) values ('Probe', 'x') returning id",
    );
    const userId = nutzer.rows[0].id;
    const fach = await client.query<{ id: string }>(
      "insert into subjects (user_id, name, short) values ($1, 'Mathematik', 'M') returning id",
      [userId],
    );
    const thema = await client.query<{ id: string }>(
      "insert into subject_topics (user_id, subject_id, title, match_key, last_seen_at) values ($1, $2, 'Quadratische Funktionen', 'quadratische funktionen', '2026-10-12') returning id",
      [userId, fach.rows[0].id],
    );
    const blatt = await client.query<{ id: string }>(
      "insert into arbeitsblaetter (user_id, subject_topic_id, tag) values ($1, $2, '2026-10-12') returning id",
      [userId, thema.rows[0].id],
    );

    await client.query(
      "insert into leser_laeufe (user_id, art, ergebnis, arbeitsblatt_id) values ($1, 'arbeitsblatt', 'laeuft', $2)",
      [userId, blatt.rows[0].id],
    );

    const material = await client.query<{ id: string }>(
      "insert into materials (user_id, subject_id, title, captured_on) values ($1, $2, 'Blatt', '2026-10-12') returning id",
      [userId, fach.rows[0].id],
    );
    await assert.rejects(
      client.query(
        "insert into leser_laeufe (user_id, art, ergebnis, arbeitsblatt_id, material_id) values ($1, 'arbeitsblatt', 'laeuft', $2, $3)",
        [userId, blatt.rows[0].id, material.rows[0].id],
      ),
      /leser_laeufe_ziel_check/,
    );

    // Die alten Arten verhalten sich wie vorher.
    await client.query(
      "insert into leser_laeufe (user_id, art, ergebnis, material_id) values ($1, 'einordnen', 'laeuft', $2)",
      [userId, material.rows[0].id],
    );
  });
});
