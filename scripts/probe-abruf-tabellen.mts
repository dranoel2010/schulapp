import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

/**
 * Die Probe auf die Wanderung des Abrufkerns — und auf ihren Rückbau.
 *
 *   npx tsx scripts/probe-abruf-tabellen.mts
 *
 * Sie legt eine Wegwerfdatenbank im Arbeitsspeicher an, spielt darin den
 * heutigen Bestand ein, dann `scripts/abruf-tabellen.sql`, prüft die drei
 * Zusagen, die man am SQL allein nicht sieht, und räumt am Ende mit
 * `scripts/abruf-rueckbau.sql` wieder ab.
 *
 * ── Warum das nicht der Testlauf erledigt ────────────────────────────────────
 *
 * Die 707 Tests unter `npm test` fassen bewusst keine Datenbank an; sie prüfen
 * Rechnungen, nicht Tabellen. Eine CHECK-Bedingung ist aber genau das
 * Gegenteil: eine Zusage, die nur die Datenbank einlösen kann. Und `set null`
 * gegen `cascade` ist die eine Entscheidung dieses Schemas, die sich später
 * nicht mehr heilen lässt — sie verdient eine Messung und kein Zutrauen.
 *
 * ── Warum der Bestand aus der erzeugten Datei kommt ──────────────────────────
 *
 * `drizzle-kit generate` schreibt alle Tabellen in eine Datei. Hier werden
 * daraus die `recall_`-Anweisungen herausgefiltert — übrig bleibt der Bestand,
 * so wie er heute in der laufenden Datenbank steht. Die Wanderung trifft damit
 * dieselbe Ausgangslage wie auf dem NAS und nicht eine leere Datenbank, in der
 * jeder Fremdschlüssel trivial durchgeht.
 *
 * Dafür muss die erzeugte Datei da sein; sie ist es nach:
 *
 *   npx drizzle-kit generate --name abruf-tabellen
 *
 * `drizzle/` steht in .gitignore — die Datei ist ein Zwischenergebnis, der
 * gepflegte Stand liegt in scripts/.
 */

const ERZEUGT = "drizzle/0000_abruf-tabellen.sql";

let roh: string;
try {
  roh = readFileSync(ERZEUGT, "utf8");
} catch {
  console.error(
    `Es fehlt ${ERZEUGT}. Erst erzeugen:\n\n  npx drizzle-kit generate --name abruf-tabellen\n`,
  );
  process.exit(1);
}

const bestand = roh
  .split("--> statement-breakpoint")
  .map((t) => t.trim())
  .filter((t) => t && !/"recall_\w+"/.test(t));

const db = new PGlite();
const zahl = async (frage: string) =>
  (await db.query<{ n: number }>(frage)).rows[0].n;

const tabellen = (wie = "%") =>
  zahl(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name like '${wie}'`,
  );

for (const anweisung of bestand) await db.exec(anweisung);
console.log(`Bestand angelegt: ${await tabellen()} Tabellen`);

await db.exec(readFileSync("scripts/abruf-tabellen.sql", "utf8"));
console.log(
  `nach der Wanderung: ${await tabellen()} Tabellen, davon ${await tabellen("recall%")} neue`,
);

// ── Zusage 1: die Fehlererklärung darf nicht leer sein ──────────────────────
// `NOT NULL` allein nimmt den leeren String an. Dann zählte die Abnahmezahl
// „100 Prozent dreiteilige Rückmeldung" leere Erklärungen mit.

const { rows: [nutzer] } = await db.query<{ id: string }>(
  "insert into users (name, password_hash) values ('Probe', 'x') returning id",
);
const { rows: [fach] } = await db.query<{ id: string }>(
  "insert into subjects (user_id, name, short) values ($1, 'Mathematik', 'Ma') returning id",
  [nutzer.id],
);

const baustein = (fehlererklaerung: string) =>
  db.query(
    `insert into recall_items
       (user_id, subject_id, prompt_free, solution, misconception, source_quote, source_length)
     values ($1, $2, 'Was besagt die Kettenregel?', 'Äußere Ableitung mal innere Ableitung', $3,
             'Die Ableitung der äußeren Funktion mal die Ableitung der inneren', 62)`,
    [nutzer.id, fach.id, fehlererklaerung],
  );

await baustein("Wird mit der Produktregel verwechselt.");
console.log("gültiger Baustein: angelegt");

for (const [was, wert] of [
  ["leerer String", ""],
  ["nur Leerzeichen", "   "],
] as const) {
  try {
    await baustein(wert);
    console.error(`⚠ ${was} wurde ANGENOMMEN — die CHECK-Bedingung fehlt`);
    process.exit(1);
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    console.log(
      `abgewiesen (${was}): ${/check/i.test(text) ? "CHECK greift" : text}`,
    );
  }
}

// ── Zusage 2: das Protokoll überlebt seinen Baustein (A11) ──────────────────
// Die einzige Entscheidung dieses Schemas, die sich später nicht heilen lässt.

const { rows: [item] } = await db.query<{ id: string }>(
  "select id from recall_items limit 1",
);
await db.query(
  `insert into recall_attempts
     (user_id, item_id, answered_on, gap_days, answer_text, correct)
   values ($1, $2, '2026-09-11', 3, 'Innere mal äußere', true)`,
  [nutzer.id, item.id],
);
await db.query("delete from recall_items where id = $1", [item.id]);

const { rows: [versuch] } = await db.query<{ item_id: string | null }>(
  "select item_id from recall_attempts limit 1",
);
const ueberlebt = (await zahl("select count(*)::int as n from recall_attempts")) === 1;
if (!ueberlebt || versuch.item_id !== null) {
  console.error("⚠ Die Antwort hat ihren Baustein NICHT überlebt — cascade statt set null");
  process.exit(1);
}
console.log("Baustein gelöscht — die Antwort steht noch, item_id ist null");

// ── Zusage 3: der Rückbau räumt vollständig ab ──────────────────────────────

await db.exec(readFileSync("scripts/abruf-rueckbau.sql", "utf8"));
const uebrig = await tabellen("recall%");
if (uebrig !== 0) {
  console.error(`⚠ Nach dem Rückbau stehen noch ${uebrig} recall_-Tabellen`);
  process.exit(1);
}
console.log(`nach dem Rückbau: ${await tabellen()} Tabellen, keine davon recall_`);
console.log("\nAlle drei Zusagen gehalten.");
