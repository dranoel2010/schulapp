/**
 * Zieht den Inhalt der lokalen PGlite in ein echtes Postgres um.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/daten-umzug.ts
 *   DATABASE_URL=postgres://… npx tsx scripts/daten-umzug.ts --trocken
 *
 * Gedacht für den einen Abend, an dem die App zum ersten Mal in die Cloud geht
 * und der Stundenplan nicht von Hand nachgetippt werden soll. Danach ist die
 * Cloud die Quelle der Wahrheit und dieses Skript liegt nur noch für den
 * Wiederaufbau da.
 *
 * **Der Entwicklungsserver muss aus sein.** Gelesen wird aus `.data/pglite`,
 * und PGlite öffnet sein Verzeichnis exklusiv — zwei Prozesse darauf machen die
 * Datenbank kaputt, das ist in diesem Projekt schon passiert.
 *
 * Drei Sicherungen sind eingebaut:
 *
 * 1. Das Ziel muss **leer** sein. Findet das Skript auch nur eine Zeile in
 *    einer der Tabellen, bricht es ab, statt zu mischen. Ein zweiter Lauf auf
 *    eine schon gefüllte Datenbank ist fast immer ein Versehen, und die Folgen
 *    (doppelte Stunden, doppelte Fächer) sieht man erst Tage später.
 * 2. Alles läuft in **einer** Transaktion. Scheitert eine Zeile, ist keine
 *    angekommen.
 * 3. `--trocken` liest und zählt, schreibt aber nichts.
 *
 * Die Reihenfolge der Tabellen ist die der Fremdschlüssel: erst der Besitzer,
 * dann was ihm gehört. `subject_topics` verweist mit `merged_into` auf sich
 * selbst — deshalb gehen die Zeilen dort zuerst ohne diesen Verweis hinein und
 * bekommen ihn in einem zweiten Durchgang.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";

/**
 * Die Tabellen in der Reihenfolge, in der sie gefüllt werden dürfen.
 *
 * Wer hier etwas einfügt, muss es hinter alles stellen, worauf es verweist.
 * Ein Fremdschlüssel auf eine Tabelle, die noch leer ist, bricht den ganzen
 * Lauf ab — was die zweite Sicherung oben zu einer sehr lauten macht.
 */
const REIHENFOLGE = [
  "users",
  "sessions",
  "subjects",
  "periods",
  "lessons",
  "subject_topics",
  "exams",
  "exam_topics",
  "study_blocks",
  "homework",
  "grades",
  "push_subscriptions",
  "materials",
  "material_pages",
  "material_topics",
  "material_proposals",
  "material_proposal_topics",
] as const;

/** Die Spalte, die auf die eigene Tabelle zeigt und deshalb nachgereicht wird. */
const NACHGEREICHT: Record<string, string> = {
  subject_topics: "merged_into",
};

type Zeile = Record<string, unknown>;

async function main() {
  const trocken = process.argv.includes("--trocken");
  const ziel = process.env.DATABASE_URL;

  if (!ziel) {
    throw new Error(
      "DATABASE_URL fehlt. Beispiel:\n" +
        "  DATABASE_URL=postgres://… npx tsx scripts/daten-umzug.ts",
    );
  }

  console.log(
    "Der Entwicklungsserver muss aus sein — zwei Prozesse auf derselben\n" +
      "PGlite machen die lokale Datenbank kaputt.\n",
  );

  const quelle = new PGlite(path.join(process.cwd(), ".data", "pglite"));
  const sql = postgres(ziel, { prepare: false });

  try {
    // Erst nachsehen, ob am Ziel überhaupt alle Tabellen stehen. Fehlt eine,
    // wurde `drizzle-kit push` vergessen — und der Lauf bräche später mittendrin
    // ab, nachdem er schon die halbe Reihenfolge durchhat.
    const vorhanden = new Set(
      (
        await sql<{ table_name: string }[]>`
          select table_name from information_schema.tables
           where table_schema = 'public'
        `
      ).map((z) => z.table_name),
    );

    const fehlend = REIHENFOLGE.filter((t) => !vorhanden.has(t));
    if (fehlend.length > 0) {
      throw new Error(
        `Am Ziel fehlen ${fehlend.length} Tabellen: ${fehlend.join(", ")}\n` +
          "Erst das Schema anlegen:  DATABASE_URL=… npx drizzle-kit push",
      );
    }

    // Das Ziel muss leer sein. Sonst mischt der Lauf zwei Bestände, und das
    // sieht man erst, wenn der Stundenplan jede Stunde doppelt zeigt.
    const belegt: string[] = [];
    for (const tabelle of REIHENFOLGE) {
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from ${sql(tabelle)}
      `;
      if (n > 0) belegt.push(`${tabelle} (${n})`);
    }

    if (belegt.length > 0 && !trocken) {
      throw new Error(
        `Am Ziel stehen schon Zeilen: ${belegt.join(", ")}.\n` +
          "Dieses Skript füllt nur eine leere Datenbank. Was jetzt richtig ist,\n" +
          "hängt davon ab, was dort steht — von Hand ansehen, nicht raten.",
      );
    }

    // Alles einlesen, bevor irgendetwas geschrieben wird: so steht die
    // Zusammenfassung auch im Trockenlauf vollständig da.
    const bestand = new Map<string, Zeile[]>();
    for (const tabelle of REIHENFOLGE) {
      const { rows } = await quelle.query<Zeile>(`select * from "${tabelle}"`);
      bestand.set(tabelle, rows);
    }

    console.log("Zu übertragen:");
    let gesamt = 0;
    for (const tabelle of REIHENFOLGE) {
      const anzahl = bestand.get(tabelle)!.length;
      gesamt += anzahl;
      if (anzahl > 0) console.log(`  ${tabelle}: ${anzahl}`);
    }
    console.log(`  ── zusammen ${gesamt} Zeilen\n`);

    if (trocken) {
      console.log("Trockenlauf — es wurde nichts geschrieben.");
      return;
    }

    // Eine Transaktion für alles. Scheitert eine Zeile, ist keine angekommen.
    await sql.begin(async (tx) => {
      for (const tabelle of REIHENFOLGE) {
        const zeilen = bestand.get(tabelle)!;
        if (zeilen.length === 0) continue;

        const nachgereicht = NACHGEREICHT[tabelle];
        const einzufuegen = nachgereicht
          ? zeilen.map((z) => ({ ...z, [nachgereicht]: null }))
          : zeilen;

        await tx`insert into ${tx(tabelle)} ${tx(einzufuegen)}`;
        console.log(`  ${tabelle}: ${zeilen.length} übertragen`);

        // Der Selbstverweis kommt erst, wenn alle Zeilen der Tabelle stehen.
        if (nachgereicht) {
          for (const zeile of zeilen) {
            if (zeile[nachgereicht] == null) continue;
            await tx`
              update ${tx(tabelle)}
                 set ${tx(nachgereicht)} = ${zeile[nachgereicht] as string}
               where id = ${zeile.id as string}
            `;
          }
        }
      }
    });

    console.log(`\nFertig: ${gesamt} Zeilen sind umgezogen.`);

    // Gegenprobe am Ziel — gezählt wird, was wirklich angekommen ist, nicht
    // was das Skript zu schreiben glaubte.
    console.log("\nGegenprobe am Ziel:");
    for (const tabelle of REIHENFOLGE) {
      const erwartet = bestand.get(tabelle)!.length;
      if (erwartet === 0) continue;
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from ${sql(tabelle)}
      `;
      console.log(`  ${tabelle}: ${n}/${erwartet}${n === erwartet ? " ✓" : "  ABWEICHUNG"}`);
    }
  } finally {
    await quelle.close();
    await sql.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((fehler: unknown) => {
    console.error("\n" + (fehler instanceof Error ? fehler.message : fehler));
    process.exit(1);
  });
}
