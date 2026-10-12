/**
 * Der Test-Harness für die Datenbank (Modell 23, Plan Abschnitt B).
 *
 * `db` aus `@/db` öffnet ohne `DATABASE_URL` die echte lokale Datenbank unter
 * `.data/pglite`. Ein Test, der `@/db` benutzt, liefe also gegen die Daten des
 * Nutzers — und bei laufendem Server mit ZWEI PGlite-Instanzen auf denselben
 * Dateien, dem Zustand, der diese Datenbank schon einmal zerstört hat.
 *
 * Deshalb setzt dieser Harness `globalThis.__schulappDb` auf eine PGlite **im
 * Speicher**, bevor irgendein Test eine Abfrage stellt. `@/db` ist faul: es
 * liest `__schulappDb` erst bei der ersten Abfrage und nimmt dann diese
 * Instanz. Das Schema legt `pushSchema` aus `drizzle-kit/api` an, aus
 * `src/db/schema.ts` und `src/recall/schema.ts`.
 *
 * Jede Testdatei läuft unter `node --test` in einem eigenen Prozess und
 * bekommt damit eine frische Instanz.
 *
 * Benutzung in einer `*.db.test.ts` — der Harness muss der ERSTE Import sein:
 *
 *   import { dbBereit } from "@/test/db-harness";
 *   import { before } from "node:test";
 *   before(dbBereit);
 *
 * Der zweite Riegel steht in `src/db/index.ts`: mit `SCHULAPP_TESTLAUF=1`
 * (gesetzt von `npm test`) weigert sich `@/db`, eine Datei-Datenbank zu
 * öffnen. Vergisst ein Test den Harness, scheitert er laut, statt still die
 * echten Daten zu benutzen.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import type { Database } from "@/db";
import * as dbSchema from "@/db/schema";
import * as recallSchema from "@/recall/schema";

const ablage = globalThis as unknown as { __schulappDb?: Database };

if (ablage.__schulappDb) {
  throw new Error(
    "db-harness: __schulappDb war schon gesetzt — der Harness muss der erste Import der Testdatei sein.",
  );
}

/** Die PGlite im Speicher, ohne Verzeichnis. */
export const testClient = new PGlite();

/** Dieselbe Instanz, die `@/db` ab jetzt liefert. */
export const testDb = drizzle(testClient, { schema: dbSchema });

ablage.__schulappDb = testDb;

let bereit: Promise<void> | null = null;

/** Legt das Schema an; einmal je Prozess, beliebig oft aufrufbar. */
export function dbBereit(): Promise<void> {
  bereit ??= (async () => {
    const { pushSchema } = await import("drizzle-kit/api");
    const ergebnis = await pushSchema(
      { ...dbSchema, ...recallSchema },
      testDb as never,
    );
    await ergebnis.apply();
  })();
  return bereit;
}

/** Ein Nutzer für Tests, die einen Besitzer brauchen. */
export async function testNutzer(name = "Probe"): Promise<string> {
  await dbBereit();
  const [zeile] = await testDb
    .insert(dbSchema.users)
    .values({ name, passwordHash: "x" })
    .returning({ id: dbSchema.users.id });
  return zeile.id;
}
