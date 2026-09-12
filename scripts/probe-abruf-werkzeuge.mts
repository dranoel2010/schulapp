import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";

/**
 * Der Weg der KI: von der Klausur zu den Fragen im Eingangskorb.
 *
 *   npx tsx scripts/probe-abruf-werkzeuge.mts
 *
 * ── Was diese Probe beantwortet und die anderen nicht ────────────────────────
 *
 * `probe-abruf-abend.mts` prüft den Kern: `createItem`, `vorschlagAnlegen`,
 * einen ganzen Abend. Aufgerufen wird er dort mit richtigen ids und
 * wohlgeformten Texten, weil ihn bis zum Eingangskorb nur die Oberfläche
 * gerufen hat — dort kommt jede id aus einem `<select>`.
 *
 * Seit es die zwei MCP-Werkzeuge gibt, ruft ein Modell. Es schickt, was es für
 * richtig hält: die id des Klausurthemas, wo die der Vokabel hingehört, ein
 * nacherzähltes Zitat, ein Wort statt eines Satzes, „Mathe-Klausur" als id.
 * Diese Probe geht deshalb NICHT über den Kern, sondern über `callTool()` —
 * also durch dieselbe Tür samt Argumentprüfung, Fehlerübersetzung und
 * Ergebnissatz, die auch unter /api/mcp steht.
 *
 * Am 12.9.2026 hat genau das drei geworfene Ausnahmen gefunden: `stoffZuKlausur`,
 * `vorschlagAnlegen` und `createItem` gaben bei einer id, die keine UUID ist,
 * einen englischen Postgres-Fehler zurück statt einer Antwort. Und ein Thema,
 * das nicht zum Schüler gehört, wäre als Fremdschlüsselfehler durch die Tür
 * gekommen.
 *
 * ── Warum die Datenbank untergeschoben wird ──────────────────────────────────
 *
 * Wie in der Abendprobe: `@/db` hält die eine Verbindung des Prozesses an
 * `globalThis`, und wird sie VOR dem ersten Import belegt, läuft die ganze
 * Kette gegen eine Datenbank im Arbeitsspeicher. Die Entwicklungsdatenbank
 * unter .data/pglite wird nicht angefasst.
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

(globalThis as unknown as { __schulappDb?: unknown }).__schulappDb = drizzle(pg, {
  schema,
});

const { callTool } = await import("@/lib/mcp/run");
const { offeneVorschlaege, vorschlagUebernehmen } = await import(
  "@/recall/proposals"
);
const { listItems } = await import("@/recall/items");

function pruefe(bedingung: boolean, satz: string): void {
  if (bedingung) {
    console.log(`  ✓ ${satz}`);
    return;
  }
  console.error(`  ✗ ${satz}`);
  process.exit(1);
}

/** Das Ergebnis eines Werkzeugs, wie ein Client es sieht. */
type Ergebnis = Awaited<ReturnType<typeof callTool>>;

function istFehler(e: Ergebnis): e is { art: "fehler"; satz: string } {
  return e.art === "fehler";
}

function daten(e: Ergebnis): Record<string, unknown> {
  if (e.art !== "daten") {
    console.error(`  ✗ erwartet waren Daten, gekommen ist: ${e.satz}`);
    process.exit(1);
  }
  return e.daten as Record<string, unknown>;
}

// ── Die Kulisse: ein Schüler, zwei Blätter, eine Klausur mit drei Themen ────

const ABSCHRIFT = [
  "Die Kettenregel",
  "",
  "Ist f(x) = g(h(x)), so gilt f'(x) = g'(h(x)) · h'(x).",
  "Man leitet also die äußere Funktion ab, setzt die innere ein und",
  "multipliziert mit der Ableitung der inneren Funktion.",
  "Beispiel: f(x) = sin(3x) hat die Ableitung f'(x) = 3 · cos(3x).",
  "Der Faktor 3 ist die ⟨Ableitung⟩ der inneren Funktion.",
].join("\n");

const FREMDE_ABSCHRIFT = [
  "Das Passé composé",
  "",
  "Gebildet wird es aus avoir oder être und dem participe passé.",
].join("\n");

const KLAUSUR = "2026-10-09";

const {
  rows: [nutzer],
} = await pg.query<{
  id: string;
  name: string;
  password_hash: string;
  reminder_hour: number;
  created_at: Date;
}>(
  "insert into users (name, password_hash) values ('Leo', 'x') returning *",
);

const mensch = {
  id: nutzer.id,
  name: nutzer.name,
  passwordHash: nutzer.password_hash,
  reminderHour: nutzer.reminder_hour,
  createdAt: nutzer.created_at,
};

const {
  rows: [mathe],
} = await pg.query<{ id: string }>(
  "insert into subjects (user_id, name, short) values ($1, 'Mathematik', 'Ma') returning id",
  [nutzer.id],
);
const {
  rows: [franz],
} = await pg.query<{ id: string }>(
  "insert into subjects (user_id, name, short) values ($1, 'Französisch', 'Fr') returning id",
  [nutzer.id],
);

// Zwei Vokabeln in Mathematik: eine hängt an einem Blatt, die zweite nicht.
const {
  rows: [vokKette],
} = await pg.query<{ id: string }>(
  `insert into subject_topics
     (user_id, subject_id, title, match_key, origin, last_seen_at)
   values ($1, $2, 'Kettenregel', 'kettenregel', 'blatt', '2026-09-11') returning id`,
  [nutzer.id, mathe.id],
);
const {
  rows: [vokProdukt],
} = await pg.query<{ id: string }>(
  `insert into subject_topics
     (user_id, subject_id, title, match_key, origin, last_seen_at)
   values ($1, $2, 'Produktregel', 'produktregel', 'blatt', '2026-09-11') returning id`,
  [nutzer.id, mathe.id],
);
// Und eine in Französisch — sie gehört dem Schüler, aber nicht dieser Klausur.
const {
  rows: [vokFranz],
} = await pg.query<{ id: string }>(
  `insert into subject_topics
     (user_id, subject_id, title, match_key, origin, last_seen_at)
   values ($1, $2, 'Passé composé', 'passe compose', 'blatt', '2026-09-11') returning id`,
  [nutzer.id, franz.id],
);

const leer = new Uint8Array([0]);

async function blatt(
  subjectId: string,
  titel: string,
  abschrift: string,
  vokabel: string | null,
): Promise<string> {
  const {
    rows: [b],
  } = await pg.query<{ id: string }>(
    `insert into materials (user_id, subject_id, title, captured_on)
     values ($1, $2, $3, '2026-09-11') returning id`,
    [nutzer.id, subjectId, titel],
  );
  const {
    rows: [s],
  } = await pg.query<{ id: string }>(
    `insert into material_pages
       (material_id, width, height, byte_size, image, reading, thumb, transcript)
     values ($1, 800, 1200, 1, $2, $2, $2, $3) returning id`,
    [b.id, leer, abschrift],
  );
  if (vokabel) {
    await pg.query(
      "insert into material_topics (material_id, subject_topic_id) values ($1, $2)",
      [b.id, vokabel],
    );
  }
  return s.id;
}

const seiteKette = await blatt(mathe.id, "Kettenregel", ABSCHRIFT, vokKette.id);
const seiteFranz = await blatt(
  franz.id,
  "Passé composé",
  FREMDE_ABSCHRIFT,
  vokFranz.id,
);

const {
  rows: [pruefung],
} = await pg.query<{ id: string }>(
  `insert into exams (user_id, subject_id, kind, date)
   values ($1, $2, 'klausur', $3) returning id`,
  [nutzer.id, mathe.id, KLAUSUR],
);

// Drei Klausurthemen: eines mit Blatt, eines mit Vokabel aber ohne Blatt, und
// eines als freier Text ohne Vokabel.
await pg.query(
  `insert into exam_topics (exam_id, title, sort_order, subject_topic_id)
   values ($1, 'Kettenregel', 0, $2), ($1, 'Produktregel', 1, $3),
          ($1, 'Vermischtes', 2, null)`,
  [pruefung.id, vokKette.id, vokProdukt.id],
);

console.log("Eine Klausur mit drei Themen, ein abgeschriebenes Blatt.\n");

// ── read_exam_material ──────────────────────────────────────────────────────

console.log("read_exam_material:");

for (const unsinn of ["Mathe-Klausur", "die am 9.10.", "'; drop table exams;--"]) {
  // Vor dem 12.9.2026 warf das hier eine Ausnahme mit dem ganzen SQL im Text.
  const e = await callTool(mensch, "read_exam_material", { exam: unsinn });
  pruefe(
    istFehler(e) && e.satz.includes("gibt es nicht"),
    `„${unsinn}" bekommt einen Satz und keine Ausnahme`,
  );
}

pruefe(
  istFehler(
    await callTool(mensch, "read_exam_material", {
      exam: "00000000-0000-0000-0000-000000000000",
    }),
  ),
  "eine fremde, wohlgeformte id wird abgewiesen",
);

const stoff = daten(
  await callTool(mensch, "read_exam_material", { exam: pruefung.id }),
);

const themen = stoff.topics as Array<Record<string, unknown>>;
const seiten = stoff.pages as Array<Record<string, unknown>>;

pruefe(themen.length === 3, `${themen.length} Themen kommen zurück`);
pruefe(
  themen[0].linked === true && (themen[0].pages as string[]).length === 1,
  "das verknüpfte Thema führt zu einer Seite",
);
pruefe(
  themen[1].linked === true && (themen[1].pages as string[]).length === 0,
  "die Vokabel ohne Blatt kommt verknüpft und ohne Seite zurück",
);
pruefe(
  themen[2].linked === false && themen[2].subjectTopicId === null,
  "das freie Thema kommt als NICHT verknüpft zurück, nicht als leer",
);
pruefe(
  themen[0].subjectTopicId === vokKette.id,
  "die subjectTopicId steht dabei — ohne sie könnte kein Vorschlag einordnen",
);
pruefe(
  seiten.length === 1 && seiten[0].transcript === ABSCHRIFT,
  "die Abschrift kommt im Wortlaut mit",
);
pruefe(
  !seiten.some((s) => s.id === seiteFranz),
  "das französische Blatt ist NICHT dabei — es hängt an keinem Thema dieser Klausur",
);

const satzStoff = (await callTool(mensch, "read_exam_material", {
  exam: pruefung.id,
})) as { satz: string };
pruefe(
  satzStoff.satz.includes("keine Abschrift") ||
    satzStoff.satz.includes("keine Abschrift."),
  `der Satz benennt das Thema ohne Abschrift: „${satzStoff.satz}"`,
);
pruefe(
  satzStoff.satz.includes("kein Blatt") || satzStoff.satz.includes("keinem Blatt"),
  "und das Thema ohne Blatt",
);

const vorratLeer = stoff.stock as Record<string, number>;
pruefe(
  vorratLeer.items === 0 && vorratLeer.openQuestions === 0,
  "am Anfang meldet der Vorrat null Bausteine und null offene Fragen",
);

const engEin = daten(
  await callTool(mensch, "read_exam_material", {
    exam: pruefung.id,
    topic: "Kettenregel",
  }),
);
pruefe(
  (engEin.topics as unknown[]).length === 1 &&
    (engEin.pages as unknown[]).length === 1,
  "mit `topic` kommt genau ein Thema",
);

const engLeer = daten(
  await callTool(mensch, "read_exam_material", {
    exam: pruefung.id,
    topic: "Produktregel",
  }),
);
pruefe(
  (engLeer.pages as unknown[]).length === 0,
  "und beim Thema ohne Blatt keine Seite — nicht die des Nachbarthemas",
);

pruefe(
  istFehler(
    await callTool(mensch, "read_exam_material", {
      exam: pruefung.id,
      topic: "Integralrechnung",
    }),
  ),
  "ein Thema, das nicht auf der Klausur steht, wird benannt",
);

// ── propose_questions ───────────────────────────────────────────────────────

console.log("\npropose_questions:");

const gut = {
  page: seiteKette,
  topic: vokKette.id,
  question: "Wie leitet man eine verkettete Funktion ab?",
  solution: "Äußere ableiten, innere einsetzen, mit deren Ableitung malnehmen.",
  misconception: "Wird mit der Produktregel verwechselt.",
  quote: "Man leitet also die äußere Funktion ab, setzt die innere ein und",
};

pruefe(
  istFehler(
    await callTool(mensch, "propose_questions", {
      exam: "Mathe-Klausur",
      questions: [gut],
    }),
  ),
  "eine id, die keine ist, bekommt einen Satz und keine Ausnahme",
);

pruefe(
  istFehler(
    await callTool(mensch, "propose_questions", {
      exam: pruefung.id,
      questions: [{ ...gut, quote: "und" }],
    }),
  ),
  "ein Zitat aus drei Zeichen wird abgewiesen — es bezeichnet keine Stelle",
);

pruefe(
  istFehler(
    await callTool(mensch, "propose_questions", {
      exam: pruefung.id,
      questions: [{ ...gut, misconception: "" }],
    }),
  ),
  "ohne Verwechslungssatz geht es nicht durch",
);

const fremdeSeite = await callTool(mensch, "propose_questions", {
  exam: pruefung.id,
  questions: [{ ...gut, page: "00000000-0000-0000-0000-000000000000" }],
});
pruefe(
  istFehler(fremdeSeite) && fremdeSeite.satz.includes("read_exam_material"),
  "eine fremde Seite wird abgewiesen, mit dem Weg zur richtigen id",
);

// Der Fall, der vor dem 12.9.2026 ein Fremdschlüsselfehler gewesen wäre: das
// Modell schickt die id des Klausurthemas oder eine aus einem anderen Fach.
const falschesThema = await callTool(mensch, "propose_questions", {
  exam: pruefung.id,
  questions: [{ ...gut, topic: vokFranz.id }],
});
const falschesThemaDaten = daten(falschesThema);
pruefe(
  falschesThemaDaten.topicsDropped === 1 && falschesThemaDaten.questions === 1,
  "ein Thema aus einem anderen Fach fällt weg, die Frage bleibt",
);
pruefe(
  (falschesThema as { satz: string }).satz.includes("subjectTopicId"),
  "und der Satz sagt, welche id dort hingehört",
);

// ── Der ganze Weg: Vorschlag, Eingang, Übernahme ────────────────────────────

console.log("\nDer ganze Weg:");

const vorschlag = await callTool(mensch, "propose_questions", {
  exam: pruefung.id,
  note: "Eine Stelle war unsicher, sie wurde weggelassen.",
  questions: [
    gut,
    {
      page: seiteKette,
      question: "Was ist der Faktor bei der Ableitung von sin(3x)?",
      solution: "Die 3 — die Ableitung der inneren Funktion.",
      misconception: "Wird für einen Summanden gehalten.",
      // Nacherzählt statt zitiert: muss beim ÜBERNEHMEN durchfallen, nicht
      // beim Vorschlagen — die Zahl der Abweisungen ist das Maß für den Agenten.
      quote: "Die Kettenregel besagt sinngemäß, dass man verschachtelt ableitet.",
    },
    {
      page: seiteKette,
      question: "Wie schreibt man die Kettenregel formal?",
      solution: "f'(x) = g'(h(x)) · h'(x)",
      misconception: "Die innere Ableitung wird vergessen.",
      quote: "Ist f(x) = g(h(x)), so gilt f'(x) = g'(h(x)) · h'(x).",
    },
  ],
});

const vorschlagDaten = daten(vorschlag);
pruefe(vorschlagDaten.questions === 3, "drei Fragen liegen im Korb");
pruefe(
  (vorschlag as { satz: string }).satz.includes("bis ein Mensch"),
  "der Satz sagt, dass sich noch nichts geändert hat",
);

const offen = await offeneVorschlaege(nutzer.id);
const derVorschlag = offen.find((v) => v.id === vorschlagDaten.id);
pruefe(
  derVorschlag !== undefined && derVorschlag.fragen.length === 3,
  `der Eingang zeigt ${derVorschlag?.fragen.length ?? 0} Fragen zu diesem Vorschlag`,
);
pruefe(
  derVorschlag?.note?.startsWith("Eine Stelle") === true,
  "und die Notiz des Agenten steht dabei",
);

const nachVorschlag = daten(
  await callTool(mensch, "read_exam_material", { exam: pruefung.id }),
).stock as Record<string, number>;
// Vier, nicht drei: Die Frage aus dem Thementest weiter oben liegt auch noch da.
pruefe(
  nachVorschlag.openQuestions === 4,
  `der Vorrat meldet jetzt ${nachVorschlag.openQuestions} offene Fragen — ohne diese Zahl schlägt jeder Lauf dasselbe noch einmal vor`,
);

const alleIds = derVorschlag!.fragen.map((f) => f.id);
const uebernahme = await vorschlagUebernehmen(
  nutzer.id,
  vorschlagDaten.id as string,
  alleIds,
);

pruefe(uebernahme !== null, "der Vorschlag lässt sich übernehmen");
pruefe(
  uebernahme!.uebernommen === 2,
  `${uebernahme!.uebernommen} Fragen wurden Bausteine`,
);
pruefe(
  uebernahme!.abgewiesen.length === 1 &&
    uebernahme!.abgewiesen[0].grund === "zitat-nicht-gefunden",
  "die nacherzählte Frage fällt an der Quellbindung durch — sichtbar, mit Grund",
);

const bestand = await listItems(nutzer.id);
// ZWEI, nicht drei: Die Frage aus dem Thementest weiter oben liegt noch als
// Vorschlag im Korb und wurde nie übernommen. Die Zahl stand hier zuerst auf
// drei — die Probe hat die falsche Zusage gefunden, nicht den falschen Code.
pruefe(bestand.length === 2, `${bestand.length} Bausteine im Bestand`);
pruefe(
  bestand.every((b) => ABSCHRIFT.includes(b.sourceQuote)),
  "jeder Baustein trägt ein Zitat, das wörtlich in der Abschrift steht (A5)",
);

// Die Zuordnung zum Thema steht in der Datenbank und nicht in `listItems()` —
// die Bestandsliste zeigt sie heute nicht. Deshalb hier per Abfrage.
const { rows: [mitThema] } = await pg.query<{ n: number }>(
  `select count(*)::int as n from recall_items
    where user_id = $1 and subject_topic_id = $2`,
  [nutzer.id, vokKette.id],
);
pruefe(
  mitThema.n === 1,
  `${mitThema.n} Baustein ist der Vokabel „Kettenregel" zugeordnet`,
);

// Und der Gegenbeweis: Der Termin für jeden übernommenen Baustein steht auch
// wirklich da. Ohne ihn wäre die Übernahme eine Zeile ohne Wirkung — genau die
// Art Fehler, die in der Datenbank aussieht wie Erfolg.
const { rows: [termine] } = await pg.query<{ n: number }>(
  `select count(*)::int as n from recall_schedule s
     join recall_items i on i.id = s.item_id
    where i.user_id = $1 and s.mode = 'klausur' and s.due_on < $2`,
  [nutzer.id, KLAUSUR],
);
pruefe(
  termine.n >= 8,
  `${termine.n} Übungstermine vor der Klausur — mindestens vier je Baustein (A6)`,
);

const zumSchluss = daten(
  await callTool(mensch, "read_exam_material", { exam: pruefung.id }),
).stock as Record<string, number>;
pruefe(
  zumSchluss.items === 2,
  `nach der Übernahme meldet der Vorrat ${zumSchluss.items} Bausteine`,
);
// Die drei entschiedenen Fragen sind weg, die eine aus dem Thementest bleibt.
pruefe(
  zumSchluss.openQuestions === 1,
  `und ${zumSchluss.openQuestions} offene Frage — entschiedene zählen nicht mehr mit`,
);

console.log("\nAlles durch.");
