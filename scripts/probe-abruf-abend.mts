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
const { stoffZuKlausur } = await import("@/recall/source");
const {
  offeneVorschlaege,
  vorschlagAnlegen,
  vorschlagUebernehmen,
  vorschlagVerwerfen,
} = await import("@/recall/proposals");
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
// `vorKlausur` und nicht die Gesamtzahl: Die Erhaltungstermine liegen NACH der
// Klausur und zählen für A6 ausdrücklich nicht mit. Genau diese Vermischung war
// der Fehler, den die Abnahme am 11.9.2026 gefunden hat.
pruefe(
  angelegt.vorKlausur >= 4,
  `${angelegt.vorKlausur} Abrufe vor der Klausur geplant (mindestens vier verlangt), dazu ${angelegt.nachKlausur} zum Behalten danach`,
);
pruefe(
  angelegt.warnungen.length === 0,
  `die Planung meldet keine Warnung${angelegt.warnungen.length ? ": " + angelegt.warnungen.join(", ") : ""}`,
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

// ── Zusage 5: ein Rückstand täuscht keine Dosis vor ─────────────────────────
//
// Der Befund der Abnahme vom 11.9.2026, und der schwerste: Stehen mehrere
// Termine desselben Bausteins offen, kamen sie alle in denselben Abend. Nach
// dem ersten Mal stand die Musterlösung auf dem Bildschirm, die übrigen Termine
// schlossen sich trivial — und in der Datenbank sah es aus, als wären die vier
// Begegnungen aus A6 erfüllt. Sie fanden massiert an einem Abend statt.

console.log("\nDer Rückstand — mehrere offene Termine desselben Bausteins:");

const { rows: [offen] } = await pg.query<{ n: number }>(
  "select count(*)::int as n from recall_schedule where done_at is null",
);
pruefe(offen.n >= 3, `${offen.n} weitere Termine stehen noch offen`);

// Ein Tag weit in der Zukunft: dann sind alle übrigen Termine überfällig.
const SPAET = "2026-10-08";
const rueckstand = await faelligHeute(nutzer.id, SPAET);

pruefe(
  rueckstand.length === 1,
  `am ${SPAET} ist trotz ${offen.n} offener Termine genau EIN Baustein fällig`,
);

const { rows: [immerNochOffen] } = await pg.query<{ n: number }>(
  "select count(*)::int as n from recall_schedule where done_at is null",
);
pruefe(
  immerNochOffen.n === offen.n,
  "die übrigen Termine verfallen dabei nicht — sie warten auf die nächsten Abende",
);

// ── Zusage 6: eine einzelne ⟨Klammer⟩ genügt zum Abweisen (A5) ──────────────
//
// Ebenfalls aus der Abnahme: Wer mit der Maus MITTEN in einer Markierung zu
// kopieren anfängt, erwischt nur deren schließende Klammer. Das Zitat steht
// dann wörtlich in der Abschrift, trägt aber unsicheren Text.

console.log("\nA5 — auch die halbe Markierung:");

const halb = await createItem(
  nutzer.id,
  { ...grundform, sourceQuote: "Ableitung⟩ der inneren Funktion." },
  HEUTE,
);
pruefe(
  !halb.ok && halb.fehler === "zitat-unsicher",
  "ein Zitat mit nur EINER spitzen Klammer wird abgewiesen",
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

// ── Zusage 7: von der Klausur zu ihrem Stoff (der Weg, den der Nutzer will) ──
//
// Nicht „wähle ein Blatt", sondern: Die Klausur sagt, was geprüft wird, ihre
// Themen sind der Schlüssel, und darüber sind die Blätter erreichbar. Die Kette
// bestand schon vor dem Abrufkern — hier wird sie zum ersten Mal in dieser
// Richtung gelesen, und geprüft wird auch der Fall, den man sonst erst in den
// echten Daten merkt: ein Klausurthema, das mit keiner Vokabel verknüpft ist.

console.log("\nVon der Klausur zum Stoff:");

const { rows: [vokabel] } = await pg.query<{ id: string }>(
  `insert into subject_topics (user_id, subject_id, title, match_key, origin, last_seen_at)
   values ($1, $2, 'Kettenregel', 'kettenregel', 'blatt', $3) returning id`,
  [nutzer.id, fach.id, HEUTE],
);
await pg.query(
  "insert into material_topics (material_id, subject_topic_id) values ($1, $2)",
  [blatt.id, vokabel.id],
);

const { rows: [pruefung] } = await pg.query<{ id: string }>(
  `select id from exams where subject_id = $1 limit 1`,
  [fach.id],
);
// Ein verknüpftes Thema und ein freies, damit beide Fälle im Ergebnis stehen.
await pg.query(
  `insert into exam_topics (exam_id, title, sort_order, subject_topic_id)
   values ($1, 'Kettenregel', 0, $2), ($1, 'Nur hingeschrieben', 1, null)`,
  [pruefung.id, vokabel.id],
);

const stoff = await stoffZuKlausur(nutzer.id, pruefung.id);
pruefe(stoff !== null, "die Klausur wird gefunden");
if (!stoff) process.exit(1);

pruefe(stoff.themen.length === 2, `${stoff.themen.length} Themen an der Klausur`);
// EINE Seite: Das Probeblatt oben hat genau eine. Die Zahl stand hier zuerst
// auf zwei — aus dem Saatgut-Skript übernommen, das ein zweiseitiges Blatt
// anlegt. Die Probe hat die falsche Zusage gefunden, nicht den falschen Code.
pruefe(
  stoff.themen[0].verknuepft && stoff.themen[0].seiten.length === 1,
  `das verknüpfte Thema führt zu ${stoff.themen[0].seiten.length} Seite`,
);
pruefe(
  !stoff.themen[1].verknuepft && stoff.themen[1].seiten.length === 0,
  "das freie Thema kommt als NICHT verknüpft zurück, nicht als leer",
);
pruefe(
  stoff.seitenGesamt.length === 1 && stoff.zeichenGesamt > 200,
  `der Vorrat: ${stoff.seitenGesamt.length} Seite, ${stoff.zeichenGesamt} Zeichen`,
);

// Dieselbe Seite an zwei Themen darf im Vorrat nur einmal stehen — sonst
// zählt die Zeichenzahl doppelt und der Agent liest sie zweimal.
const { rows: [zweite] } = await pg.query<{ id: string }>(
  `insert into subject_topics (user_id, subject_id, title, match_key, origin, last_seen_at)
   values ($1, $2, 'Ableiten', 'ableiten', 'blatt', $3) returning id`,
  [nutzer.id, fach.id, HEUTE],
);
await pg.query(
  "insert into material_topics (material_id, subject_topic_id) values ($1, $2)",
  [blatt.id, zweite.id],
);
await pg.query(
  `insert into exam_topics (exam_id, title, sort_order, subject_topic_id)
   values ($1, 'Ableiten', 2, $2)`,
  [pruefung.id, zweite.id],
);

const nochmal = await stoffZuKlausur(nutzer.id, pruefung.id);
pruefe(
  nochmal?.seitenGesamt.length === 1 && nochmal?.themen.length === 3,
  "dieselbe Seite hängt jetzt an zwei Themen und steht im Vorrat trotzdem nur einmal",
);

// ── Zusage 8: die Quellbindung gilt auch für die KI ─────────────────────────
//
// Die wichtigste Zusage des ganzen Agenten. Ein Vorschlag wird NICHT in den
// Bestand kopiert, sondern durch createItem() geschickt — dieselbe Tür wie eine
// von Hand angelegte Frage. Eine Frage, deren Zitat nicht wörtlich in der
// Abschrift steht, fällt durch, ganz gleich wer sie vorgeschlagen hat. Und sie
// fällt SICHTBAR durch: mit Grund, nicht gelöscht, denn die Zahl der
// Abweisungen ist das einzige Maß dafür, wie zuverlässig der Agent arbeitet.

console.log("\nDer Agent schlägt vor, der Mensch übernimmt:");

const vorgeschlagen = await vorschlagAnlegen(
  nutzer.id,
  pruefung.id,
  [
    {
      pageId: seite.id,
      promptFree: "Was besagt die Kettenregel?",
      solution: "Äußere Ableitung mal innere Ableitung",
      misconception: "Wird mit der Produktregel verwechselt.",
      sourceQuote: "Ist f(x) = g(h(x)), so gilt f'(x) = g'(h(x)) · h'(x).",
    },
    {
      pageId: seite.id,
      promptFree: "Was ist der Faktor bei sin(3x)?",
      solution: "Die Ableitung der inneren Funktion",
      misconception: "Wird mit dem Wert verwechselt.",
      // Nacherzählt statt zitiert — muss beim Übernehmen durchfallen.
      sourceQuote: "Die Kettenregel besagt sinngemäß, dass man verschachtelt ableitet.",
    },
    {
      pageId: seite.id,
      promptFree: "Wofür gilt die Produktregel?",
      solution: "Für ein Produkt zweier Funktionen",
      misconception: "Wird mit der Kettenregel verwechselt.",
      sourceQuote: "Man leitet also die äußere Funktion ab, setzt die innere ein und",
    },
  ],
  "Eine Stelle war unsicher, sie wurde weggelassen.",
);
pruefe(
  vorgeschlagen.ok && vorgeschlagen.fragen === 3,
  `der Vorschlag liegt mit ${vorgeschlagen.ok ? vorgeschlagen.fragen : 0} Fragen im Eingang`,
);
if (!vorgeschlagen.ok) process.exit(1);

// Ein Vorschlag auf eine fremde Seite ist kein schwacher Vorschlag, sondern
// ein Angriff — und wird gar nicht abgelegt.
// Alle vier Texte sind ausformuliert, und zwar mit Absicht: „egal" hat vier
// Zeichen und fiele seit dem 12.9.2026 schon an der Längenprüfung durch. Die
// Zusage hier wäre damit still zu einer anderen geworden — abgelehnt ja, aber
// aus dem falschen Grund. Deshalb steht der Grund jetzt in der Prüfung.
const fremd = await vorschlagAnlegen(nutzer.id, pruefung.id, [
  {
    pageId: "00000000-0000-0000-0000-000000000000",
    promptFree: "Frage zu einer fremden Seite",
    solution: "Die Antwort spielt hier keine Rolle.",
    misconception: "Auch der Verwechslungssatz nicht.",
    sourceQuote: "Ist f(x) = g(h(x)), so gilt",
  },
]);
pruefe(
  !fremd.ok && fremd.grund === "fremde-seiten",
  `ein Vorschlag auf eine fremde Seite wird abgelehnt${fremd.ok ? "" : ` (${fremd.grund})`}`,
);

// Und die Längenprüfung selbst, an dem Feld, an dem es darauf ankommt: Für den
// leeren Verwechslungssatz steht in der Datenbank eine CHECK-Regel, und die
// käme sonst als englischer Postgres-Fehler durch die MCP-Tür zurück.
const knapp = await vorschlagAnlegen(nutzer.id, pruefung.id, [
  {
    pageId: seite.id,
    promptFree: "Was besagt die Kettenregel?",
    solution: "Äußere mal innere Ableitung.",
    misconception: "",
    sourceQuote: "Ist f(x) = g(h(x)), so gilt",
  },
]);
pruefe(
  !knapp.ok && knapp.grund === "zu-kurz",
  "eine Frage ohne Verwechslungssatz wird abgewiesen, bevor Postgres es tut",
);

const eingang = await offeneVorschlaege(nutzer.id);
pruefe(
  eingang.length === 1 && eingang[0].fragen.length === 3,
  `im Eingang liegt ${eingang.length} Vorschlag mit ${eingang[0]?.fragen.length} Fragen`,
);
pruefe(
  eingang[0].note !== null && eingang[0].fragen[0].blattTitel === "Kettenregel",
  "jede Frage weiß, aus welchem Blatt sie stammt, und die Notiz des Laufs steht dabei",
);

// Zwei von drei wählen: die gute und die nacherzählte. Die dritte abwählen.
const ergebnis = await vorschlagUebernehmen(
  nutzer.id,
  vorgeschlagen.proposalId,
  [eingang[0].fragen[0].id, eingang[0].fragen[1].id],
  HEUTE,
);
pruefe(ergebnis !== null, "das Übernehmen läuft");
if (!ergebnis) process.exit(1);

pruefe(
  ergebnis.uebernommen === 1,
  `${ergebnis.uebernommen} Frage übernommen (die mit dem wörtlichen Zitat)`,
);
pruefe(
  ergebnis.abgewiesen.length === 1 &&
    ergebnis.abgewiesen[0].grund === "zitat-nicht-gefunden",
  "die nacherzählte Frage wird abgewiesen — die Quellbindung gilt auch für die KI",
);
pruefe(
  ergebnis.abgewaehlt === 1,
  `${ergebnis.abgewaehlt} Frage vom Menschen abgewählt`,
);

const { rows: [grund] } = await pg.query<{ n: number }>(
  "select count(*)::int as n from recall_proposal_items where rejected_reason is not null",
);
pruefe(
  grund.n === 2,
  "beide nicht übernommenen Fragen bleiben MIT GRUND stehen, statt zu verschwinden",
);

pruefe(
  (await offeneVorschlaege(nutzer.id)).length === 0,
  "der abgearbeitete Vorschlag liegt nicht mehr im Eingang",
);

// Und der Weg, der nichts übernimmt.
const zweiterVorschlag = await vorschlagAnlegen(nutzer.id, pruefung.id, [
  {
    pageId: seite.id,
    promptFree: "Noch eine Frage",
    solution: "Antwort",
    misconception: "Verwechslung",
    sourceQuote: "multipliziert mit der Ableitung der inneren Funktion.",
  },
]);
if (!zweiterVorschlag.ok) process.exit(1);
pruefe(
  await vorschlagVerwerfen(nutzer.id, zweiterVorschlag.proposalId),
  "ein ganzer Vorschlag lässt sich verwerfen",
);
pruefe(
  (await offeneVorschlaege(nutzer.id)).length === 0,
  "danach ist der Eingang wieder leer",
);

console.log("\nAlle Zusagen gehalten — ein Abend läuft von der Heftseite bis zum geschlossenen Termin.");
