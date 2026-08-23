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
 * Die eine Verbindung des ganzen Prozesses — an `globalThis` und nicht nur an
 * diesem Modul.
 *
 * Ein Modul einmal pro Prozess: das klingt selbstverständlich und ist es
 * nicht. Next bündelt Seiten und Route Handler getrennt; dieselbe Datei kann
 * dadurch in zwei Bündeln landen und wird dann **zweimal ausgewertet**, mit je
 * eigenem `instance`. Beim Bauen kommen die Worker dazu. `globalThis` ist der
 * einzige Ort, den sich alle teilen.
 *
 * **Das galt bis hierher nur in der Entwicklung**, und das war ein Fehler mit
 * Ansage. Der Wächter `process.env.NODE_ENV !== "production"` ist die überall
 * abgeschriebene Formel gegen leckende Verbindungen beim Hot Reload — dort
 * geht es darum, dass sich die EINE Instanz über Neuladen hinweg rettet. Hier
 * beantwortet dieselbe Zeile eine ganz andere Frage, nämlich: gibt es die
 * Instanz überhaupt nur einmal. Im Produktionsbau (`npm run start`) fiel die
 * Antwort damit auf „nein":
 *
 * - Die Seiten öffneten `.data/pglite` in ihrem Bündel,
 * - `/api/material/<seite>` öffnete dasselbe Verzeichnis in seinem — ein
 *   zweites PGlite auf denselben Dateien.
 *
 * PGlite liest sein Verzeichnis beim Öffnen in einen eigenen Speicher ein.
 * Die zweite Instanz sah deshalb einen Stand von vorhin: **jede Anfrage nach
 * einem Blattbild antwortete „Dieses Blatt gibt es nicht mehr" (404)**, während
 * die Ablage daneben genau dieses Blatt auflistete. In der Ablage, auf der
 * Startseite und im Eingangskorb stand an jeder Stelle, an der ein Foto
 * hingehört, das kaputte Bildsymbol — und weil es in `next dev` nicht
 * passiert, fiel es beim Entwickeln nie auf.
 *
 * Gefährlicher als die 404 ist die andere Hälfte: zwei PGlite-Instanzen auf
 * denselben Dateien sind genau der Zustand, den das README als das beschreibt,
 * was diese Datenbank schon einmal unrettbar zerstört hat. Dort steht er als
 * „zwei Prozesse"; einer reicht, wenn er das Modul zweimal auswertet.
 *
 * Gegen ein echtes Postgres (DATABASE_URL) wäre eine zweite Auswertung nur ein
 * zweiter Verbindungspool — teuer, nicht tödlich. Die Zeile hilft also dort,
 * wo sie muss, und schadet nirgends: Hot Reload gibt es im Produktionsbau
 * nicht, an dem es sonst zu retten gäbe.
 */
const globalForDb = globalThis as unknown as { __schulappDb?: Database };

let instance: Database | undefined;

function getDatabase(): Database {
  if (!instance) {
    instance = globalForDb.__schulappDb ?? createDatabase();
    globalForDb.__schulappDb = instance;
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
