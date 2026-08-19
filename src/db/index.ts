import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PgliteDatabase<typeof schema>;

/**
 * Lokal läuft die Datenbank als Datei im Projekt (PGlite) — kein Server, kein
 * Docker. In der Cloud steht DATABASE_URL, dann verbinden wir uns mit einem
 * echten Postgres. Beide sprechen dieselbe SQL-Sprache, der Code bleibt gleich.
 */
function createDatabase(): Database {
  const url = process.env.DATABASE_URL;

  if (url) {
    const client = postgres(url, { prepare: false });
    return drizzlePostgres(client, { schema }) as unknown as Database;
  }

  const dataDir = path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dataDir, { recursive: true });
  return drizzlePglite(new PGlite(dataDir), { schema });
}

/**
 * Beim Neuladen im Entwicklungsmodus würde sonst jedes Mal eine neue
 * Verbindung entstehen, bis die Datei gesperrt ist.
 */
const globalForDb = globalThis as unknown as { __schulappDb?: Database };

let instance: Database | undefined;

function getDatabase(): Database {
  if (!instance) {
    instance = globalForDb.__schulappDb ?? createDatabase();
    if (process.env.NODE_ENV !== "production") {
      globalForDb.__schulappDb = instance;
    }
  }
  return instance;
}

/**
 * Bewusst faul: die Verbindung entsteht erst bei der ersten echten Abfrage,
 * nicht schon beim Importieren dieser Datei. Sonst würde jeder Build-Worker
 * beim Einlesen eines Moduls eine eigene PGlite-Instanz auf dasselbe
 * Verzeichnis loslassen — das ist genau das Rennen, das beim Bauen zu
 * "PGlite failed to initialize" führt.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const value = Reflect.get(getDatabase(), property, receiver);
    return typeof value === "function" ? value.bind(getDatabase()) : value;
  },
});

export { schema };
