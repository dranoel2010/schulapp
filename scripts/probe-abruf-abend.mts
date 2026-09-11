import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";

/**
 * Der Durchstich: ein ganzer Abend, von der Heftseite bis zum geschlossenen
 * Termin.
 *
 *   npx tsx scripts/probe-abruf-abend.mts
 *
 * ── Was diese Probe beantwortet und `npm test` nicht ─────────────────────────
 *
 * Die 707 Tests des Hauses fassen bewusst keine Datenbank an, und die 18 für
 * die Verteilrechnung prüfen eine reine Rechnung. Damit ist offen, was
 * zwischen ihnen liegt: ob aus einer Seite wirklich ein Baustein wird, ob die
 * Quellbindung abweist, was sie abweisen soll, ob die Musterlösung erst nach
 * dem Versuch herauskommt und ob ein danebengegangener Baustein am selben
 * Abend zurückkehrt. Das sind die vier Zusagen, an denen der ganze Bau hängt.
 *
 * ── Warum die Datenbank hier untergeschoben wird ─────────────────────────────
 *
 * `@/db` hält die eine Verbindung des Prozesses an `globalThis`, damit nie
 * zwei PGlite-Instanzen auf dieselben Dateien losgehen — die Begründung steht
 * ausführlich in src/db/index.ts, und der Fall hat diese Datenbank schon
 * einmal zerstört. Genau dieser Haken ist hier nützlich: Wird `globalThis`
 * VOR dem ersten Import von @/recall mit einer Datenbank im Arbeitsspeicher
 * belegt, läuft die ganze Kette dagegen. Die Entwicklungsdatenbank unter
 * .data/pglite wird dabei nicht angefasst — und erfundene Schulinhalte haben
 * dort auch nichts verloren.
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

const pg = new PGlite();
for (const anweisung of roh
  .split("--> statement-breakpoint")
  .map((t) => t.trim())
  .filter(Boolean)) {
  await pg.exec(anweisung);
}

// Vor dem ersten Import von @/recall — danach wäre die Verbindung schon die
// aus .data/pglite.
(globalThis as unknown as { __schulappDb?: unknown }).__schulappDb = drizzle(
  pg,
  { schema },
);

const { createItem } = await import("@/recall/items");
const { faelligHeute, tagesbericht, urteilFesthalten, versuchFesthalten } =
  await import("@/recall/sessions");

function pruefe(bedingung: boolean, satz: string): void {
  if (bedingung) {
    console.log(`  ✓ ${satz}`);
    return;
  }
  console.error(`  ✗ ${satz}`);
  process.exit(1);
}

// ── Ein Schüler, ein Fach, ein abgeschriebenes Blatt ────────────────────────

const ABSCHRIFT = [
  "Die Kettenregel",
  "",
  "Ist f(x) = g(h(x)), so gilt f'(x) = g'(h(x)) · h'(x).",
  "Man leitet also die äußere Funktion ab, setzt die innere ein und",
  "multipliziert mit der Ableitung der inneren Funktion.",
  "Beispiel: f(x) = sin(3x) hat die Ableitung f'(x) = 3 · cos(3x).",
  "Der Faktor 3 ist die ⟨Ableitung⟩ der inneren Funktion.",
].join("\n");

const { rows: [nutzer] } = await pg.query<{ id: string }>(
  "insert into users (name, password_hash) values ('Leo', 'x') returning id",
);
const { rows: [fach] } = await pg.query<{ id: string }>(
  "insert into subjects (user_id, name, short) values ($1, 'Mathematik', 'Ma') returning id",
  [nutzer.id],
);
const { rows: [blatt] } = await pg.query<{ id: string }>(
  `insert into materials (user_id, subject_id, title, captured_on)
   values ($1, $2, 'Kettenregel', '2026-09-11') returning id`,
  [nutzer.id, fach.id],
);
const leer = new Uint8Array([0]);
const { rows: [seite] } = await pg.query<{ id: string }>(
  `insert into material_pages
     (material_id, width, height, byte_size, image, reading, thumb, transcript)
   values ($1, 800, 1200, 1, $2, $2, $2, $3) returning id`,
  [blatt.id, leer, ABSCHRIFT],
);

const HEUTE = "2026-09-11";
const KLAUSUR = "2026-10-09";
await pg.query(
  `insert into exams (user_id, subject_id, kind, date)
   values ($1, $2, 'klausur', $3)`,
  [nutzer.id, fach.id, KLAUSUR],
);

console.log("Ein Blatt mit Abschrift, eine Klausur in vier Wochen.\n");

// ── Zusage 1: die Quellbindung weist ab, was sie abweisen soll (A5) ─────────

console.log("A5 — die Frage muss aus dem Heft stammen:");

const grundform = {
  pageId: seite.id,
  subjectId: fach.id,
  promptFree: "Wie leitet man eine verkettete Funktion ab?",
  solution: [
    "Äußere Funktion ableiten",
    "innere Funktion einsetzen",
    "mit der Ableitung der inneren multiplizieren",
  ].join("\n"),
  misconception:
    "Wird mit der Produktregel verwechselt — dort werden zwei Faktoren abgeleitet, hier zwei verschachtelte Funktionen.",
};

const erfunden = await createItem(
  nutzer.id,
  { ...grundform, sourceQuote: "Die Kettenregel besagt im Wesentlichen, dass man" },
  HEUTE,
);
pruefe(
  !erfunden.ok && erfunden.fehler === "zitat-nicht-gefunden",
  "ein nacherzähltes Zitat wird abgewiesen",
);

const unsicher = await createItem(
  nutzer.id,
  { ...grundform, sourceQuote: "Der Faktor 3 ist die ⟨Ableitung⟩ der inneren Funktion." },
  HEUTE,
);
pruefe(
  !unsicher.ok && unsicher.fehler === "zitat-unsicher",
  "ein Zitat mit ⟨spitzen Klammern⟩ wird abgewiesen",
);

const angelegt = await createItem(
  nutzer.id,
  {
    ...grundform,
    sourceQuote:
      "Man leitet also die äußere Funktion ab, setzt die innere ein und",
  },
  HEUTE,
);
pruefe(angelegt.ok, "ein wörtliches Zitat geht durch");
if (!angelegt.ok) process.exit(1);

// ── Zusage 2: mindestens vier Begegnungen bis zur Klausur (A6) ──────────────

console.log("\nA6 — die Dosis:");
pruefe(
  angelegt.termine >= 4,
  `${angelegt.termine} Termine bis zur Klausur geplant (mindestens vier verlangt)`,
);

const { rows: [hinter] } = await pg.query<{ n: number }>(
  `select count(*)::int as n from recall_schedule
    where mode = 'klausur' and due_on >= $1`,
  [KLAUSUR],
);
pruefe(hinter.n === 0, "kein Übungstermin liegt am Klausurtag oder danach (A7)");

// ── Zusage 3: die Lösung kommt erst nach dem Versuch (A2) ───────────────────

console.log("\nDer Abend:");

pruefe(
  (await faelligHeute(nutzer.id, HEUTE)).length === 0,
  "am Tag der Aufnahme ist noch nichts fällig — der Abend selbst war die erste Begegnung",
);

// `to_char` und nicht `due_on` roh: Der PGlite-Treiber macht aus einer
// `date`-Spalte ein JS-Date in der Zeitzone dieses Rechners. Drizzle liefert
// dank `mode: "string"` eine Zeichenkette, die rohe Abfrage hier nicht — und
// ein Date, das weiterreicht, schlägt erst drei Aufrufe später zu.
const ERSTER_TERMIN = (
  await pg.query<{ tag: string }>(
    "select to_char(due_on, 'YYYY-MM-DD') as tag from recall_schedule order by due_on limit 1",
  )
).rows[0].tag;

let faellig = await faelligHeute(nutzer.id, ERSTER_TERMIN);
pruefe(faellig.length === 1, `am ${ERSTER_TERMIN} steht ein Baustein an`);

const versuch = await versuchFesthalten(
  nutzer.id,
  {
    scheduleId: faellig[0].scheduleId,
    itemId: faellig[0].itemId,
    answerText: "Irgendwas mit Produktregel",
  },
  ERSTER_TERMIN,
);
pruefe(versuch.ok, "der Versuch wird festgehalten");
if (!versuch.ok) process.exit(1);
pruefe(
  versuch.solution.includes("Äußere Funktion ableiten"),
  "und erst JETZT kommt die Musterlösung zurück",
);

const { rows: [nachVersuch] } = await pg.query<{ n: number }>(
  "select count(*)::int as n from recall_schedule where done_at is not null",
);
pruefe(
  nachVersuch.n === 0,
  "der Termin ist noch offen — abgeschickt ist nicht gekonnt",
);

// ── Zusage 4: was danebengeht, kommt am selben Abend wieder (A6, Teil zwei) ─

console.log("\nA6 zweite Hälfte — gefragt, bis es sitzt:");

await urteilFesthalten(nutzer.id, versuch.attemptId, false);

faellig = await faelligHeute(nutzer.id, ERSTER_TERMIN);
pruefe(
  faellig.length === 1 && faellig[0].heuteDaneben === 1,
  "nach „daneben“ steht der Baustein noch am selben Abend wieder da",
);

const zweiter = await versuchFesthalten(
  nutzer.id,
  {
    scheduleId: faellig[0].scheduleId,
    itemId: faellig[0].itemId,
    answerText: "Äußere ableiten, innere einsetzen, mal Ableitung der inneren",
  },
  ERSTER_TERMIN,
);
if (!zweiter.ok) process.exit(1);
await urteilFesthalten(nutzer.id, zweiter.attemptId, true);

pruefe(
  (await faelligHeute(nutzer.id, ERSTER_TERMIN)).length === 0,
  "nach „saß“ ist der Abend durch",
);

const bericht = await tagesbericht(nutzer.id, ERSTER_TERMIN);
pruefe(
  bericht.versuche === 2 && bericht.richtig === 1 && bericht.bausteine === 1,
  `der Tagesbericht zählt ${bericht.versuche} Versuche über ${bericht.bausteine} Baustein, davon ${bericht.richtig} richtig`,
);

// ── Und der Abstand, an dem die Erfolgsmessung hängt (A11) ──────────────────

const { rows: [protokoll] } = await pg.query<{
  n: number;
  gap_days: number;
  source_page_id: string | null;
}>(
  `select count(*)::int as n, max(gap_days) as gap_days, max(source_page_id::text) as source_page_id
     from recall_attempts`,
);
pruefe(
  protokoll.n === 2 && protokoll.source_page_id === seite.id,
  "jede Antwort trägt ihre Herkunft mit — die Heftseite steht in der Zeile",
);
pruefe(
  protokoll.gap_days > 0,
  `der Abstand zur letzten Begegnung ist mitgeschrieben (${protokoll.gap_days} Tage)`,
);

console.log("\nAlle Zusagen gehalten — ein Abend läuft von der Heftseite bis zum geschlossenen Termin.");
