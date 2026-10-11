/**
 * Ein Rauchtest für den Fragenlauf der App (11.10.2026) — gegen eine ECHTE
 * Datenbank und nicht gegen Typen, mit einem nachgemachten Sender und ohne
 * Netz.
 *
 * Warum es ihn gibt: ob ein Lauf überhaupt fragt, entscheidet der Vorrat in
 * der Datenbank (`vorratZuKlausur()`), was aus der Antwort wird, entscheidet
 * `vorschlagAnlegen()` mit seiner Prüfung gegen den Stoff, und was der Lauf
 * hinterlässt, steht in `leser_laeufe` unter einer CHECK-Bedingung. Nichts
 * davon prüft `npm test`; dort gibt es keine Datenbank. Dazu die Sperre je
 * Klausur, die nur mit einem Aufruf zu sehen ist, der dauert — und die
 * Auskunft von read_exam_material, die seit dem Umbau aus derselben Funktion
 * kommt wie der Stoff des Fragenlaufs.
 *
 * Die Datenbank liegt im Arbeitsspeicher (PGlite ohne Verzeichnis); das
 * Schema ist das ganze heutige, aus `drizzle-kit generate` über beide
 * Schema-Dateien in einem Ordner P außerhalb des Repos:
 *
 *   mkdir -p P/db && ln -s "$PWD/node_modules" P/node_modules
 *   cp src/db/schema.ts P/db/schema.ts
 *   sed 's#"@/db/schema"#"./db/schema"#' src/recall/schema.ts > P/recall-schema.ts
 *   printf 'export * from "./db/schema";\nexport * from "./recall-schema";\n' > P/alle.ts
 *   (cd P && ./node_modules/.bin/drizzle-kit generate --dialect postgresql \
 *     --schema ./alle.ts --out ./out --name voll)
 *   npx tsx scripts/probe-fragenlauf.mts P/out/0000_voll.sql
 *
 * (Zwei `--schema` nimmt drizzle-kit nicht — es nähme nur das letzte, daher
 * die Datei, die beide weiterreicht.) Eine gesetzte `DATABASE_URL` hält die
 * Probe an. Kein Aufruf geht ins Netz: der Sender ist nachgemacht, `fetch`
 * wirft, und die Schlüssel aus der Umgebung dieses Rechners sind gelöscht.
 * Alle Texte sind erfunden; echte Schülerseiten gehören nie hierher.
 *
 * Am 11.10.2026 gelaufen: 45 von 45 — read_exam_material und der Fragenlauf
 * sehen denselben Stoff, ein Lauf legt genau einen Vorschlag an und nichts in
 * den Bestand, danach ruft keiner mehr, bis der Mensch entschieden hat, ein
 * zweiter Druck während des Laufs stößt nichts an, und „kein-vorschlag“ und
 * Pause stehen in `leser_laeufe`. Nach der Abnahme vom selben Tag 48 von 48:
 * ein Strom, der abreißt, steht als bezahlter Abbruch da, und die Summe des
 * Monats sagt danach „mindestens“. Nach der zweiten Nachprüfung reißt dieser
 * Strom wirklich ab (vorher schickte er eine Überlastung, und die heißt
 * seitdem `ausfall`): 48 von 48.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { PGlite } from "@electric-sql/pglite";
import type {
  BetaMessage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";
import * as recall from "@/recall/schema";

const [schemaDatei] = process.argv.slice(2);
if (!schemaDatei) {
  console.error("Aufruf: npx tsx scripts/probe-fragenlauf.mts <0000_voll.sql>");
  process.exit(1);
}

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt — die Probe läuft nur gegen ihre eigene Datenbank im Speicher.");
  process.exit(1);
}

for (const name of [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "TYPESAFE_API_KEY",
  "DOCLING_URL",
  "LESER_REGEL",
  "CLAUDE_BILD",
]) {
  delete process.env[name];
}

/**
 * Die Fehlerklasse des SDK aus DERSELBEN Fassung, die @/lib/claude/ergebnis
 * sieht — diese Datei ist ESM, die App lädt tsx als CommonJS (siehe
 * scripts/probe-claude-leser.mts, wo das am 11.10.2026 einen 429 zum
 * „unerwarteten Fehler“ machte).
 */
const { AnthropicError, APIError } = createRequire(import.meta.url)(
  "@anthropic-ai/sdk",
) as typeof import("@anthropic-ai/sdk");

const pg = new PGlite();

let fehler = 0;
let proben = 0;
function pruefe(name: string, bedingung: boolean, gesehen?: unknown) {
  proben += 1;
  if (bedingung) {
    console.log(`  ✓ ${name}`);
  } else {
    fehler += 1;
    console.log(`  ✗ ${name}`);
    if (gesehen !== undefined) console.log(`      gesehen: ${JSON.stringify(gesehen)}`);
  }
}

console.log("\n── 0. Das Schema ──");
await pg.exec(readFileSync(schemaDatei, "utf8").replaceAll("--> statement-breakpoint", ""));
{
  const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from leser_laeufe`);
  pruefe("leser_laeufe steht und ist leer", rows[0]?.n === 0, rows);
}

globalThis.fetch = (() => {
  throw new Error("Die Probe geht nicht ins Netz.");
}) as typeof fetch;

const probe = drizzle(pg, { schema });
(globalThis as unknown as { __schulappDb?: unknown }).__schulappDb = probe;

const { fragenBauen, fragenLaufen, fragenLaufenGerade, fragenStand } = await import("@/lib/fragenlauf");
const { FRAGEN_SYSTEM } = await import("@/lib/fragenlauf-auftrag");
const { stoffAuskunft } = await import("@/lib/klausur-stoff");
const { letzterFragenLauf, laufKostenSeit } = await import("@/lib/leser/laeufe");
const { kostenSatz, laufAnzeige } = await import("@/lib/leser/claude-ablauf");
const { callTool } = await import("@/lib/mcp/run");
const { vorschlagVerwerfen } = await import("@/recall/proposals");
const { stoffZuKlausur } = await import("@/recall/source");
const { addDays, todayInBerlin } = await import("@/lib/dates");
const { blaetterStand } = await import("@/lib/materials");

type Prozess = { wecker: Map<string, ReturnType<typeof setTimeout>>; pauseBis: number };
const prozess = () =>
  (globalThis as unknown as { __schulappClaude?: Prozess }).__schulappClaude;

/** Alle Wecker des Abschreibers aus — sonst stieße einer nach der Probe den echten Sender an. */
function weckerAus() {
  const p = prozess();
  if (!p) return;
  for (const wecker of p.wecker.values()) clearTimeout(wecker);
  p.wecker.clear();
}

// ── Die Kulisse ──────────────────────────────────────────────────────────────

const heute = todayInBerlin();
const bild = Buffer.from([0xff, 0xd8, 0x01]);

async function nutzer(name: string): Promise<string> {
  const [zeile] = await probe
    .insert(schema.users)
    .values({ name, passwordHash: "x" })
    .returning({ id: schema.users.id });
  return zeile.id;
}

async function fach(userId: string, name: string, short: string): Promise<string> {
  const [zeile] = await probe
    .insert(schema.subjects)
    .values({ userId, name, short })
    .returning({ id: schema.subjects.id });
  return zeile.id;
}

async function vokabel(userId: string, subjectId: string, title: string): Promise<string> {
  const [zeile] = await probe
    .insert(schema.subjectTopics)
    .values({ userId, subjectId, title, matchKey: title.toLowerCase(), lastSeenAt: heute })
    .returning({ id: schema.subjectTopics.id });
  return zeile.id;
}

async function klausur(
  userId: string,
  subjectId: string,
  themen: { title: string; vokabel: string | null }[],
): Promise<string> {
  const [zeile] = await probe
    .insert(schema.exams)
    .values({ userId, subjectId, date: addDays(heute, 10) })
    .returning({ id: schema.exams.id });
  for (const [i, t] of themen.entries()) {
    await probe
      .insert(schema.examTopics)
      .values({ examId: zeile.id, title: t.title, sortOrder: i, subjectTopicId: t.vokabel });
  }
  return zeile.id;
}

/** Ein eingeordnetes Blatt an einer Vokabel, mit abgeschriebenen Seiten. */
async function blatt(
  userId: string,
  subjectId: string,
  vokabelId: string,
  seiten: { transcript: string; maschinell?: boolean }[],
): Promise<string[]> {
  const [zeile] = await probe
    .insert(schema.materials)
    .values({ userId, subjectId, title: "Hefteintrag", capturedOn: heute, filedAt: new Date() })
    .returning({ id: schema.materials.id });
  await probe.insert(schema.materialTopics).values({ materialId: zeile.id, subjectTopicId: vokabelId });

  const ids: string[] = [];
  for (const [i, s] of seiten.entries()) {
    const [seite] = await probe
      .insert(schema.materialPages)
      .values({
        materialId: zeile.id,
        sortOrder: i,
        mimeType: "image/jpeg",
        width: 100,
        height: 100,
        byteSize: 3,
        image: bild,
        reading: bild,
        thumb: bild,
        leser: s.maschinell ? "docling" : "claude",
        transcript: s.transcript,
        maschinell: s.maschinell ?? false,
      })
      .returning({ id: schema.materialPages.id });
    ids.push(seite.id);
  }
  return ids;
}

const NINO = [
  "El Niño",
  "",
  "Alle 2 bis 7 Jahre erwärmt sich der Ostpazifik ungewöhnlich stark.",
  "Die Passatwinde schwächen sich ab, und warmes Wasser strömt nach Osten.",
].join("\n");
const NINO_DRUCK = "Folgen: Dürre in Australien, Starkregen in Peru.";
const STANDORT = [
  "Standortfaktoren",
  "",
  "Harte Standortfaktoren lassen sich in Geld messen, etwa Löhne und Steuern.",
].join("\n");

const u = await nutzer("Leo");
const geo = await fach(u, "Geografie", "Ge");
const franz = await fach(u, "Französisch", "F");
const vNino = await vokabel(u, geo, "El Niño");
const vStandort = await vokabel(u, geo, "Standortwahl");
const vLeer = await vokabel(u, geo, "Leer");
const vRiesig = await vokabel(u, geo, "Riesig");
const vPasse = await vokabel(u, franz, "Passé composé");

const [p1, p2] = await blatt(u, geo, vNino, [
  { transcript: NINO },
  { transcript: NINO_DRUCK, maschinell: true },
]);
const [p3] = await blatt(u, geo, vStandort, [{ transcript: STANDORT }]);
const [p4] = await blatt(u, franz, vPasse, [{ transcript: "Gebildet mit avoir oder être." }]);
await blatt(
  u,
  geo,
  vRiesig,
  Array.from({ length: 19 }, (_, i) => ({ transcript: `${i} ${"Viel Text. ".repeat(720)}` })),
);

const K = await klausur(u, geo, [
  { title: "El Niño", vokabel: vNino },
  { title: "Standortwahl", vokabel: vStandort },
  { title: "Smart Cities", vokabel: null },
]);
const K2 = await klausur(u, geo, [{ title: "El Niño", vokabel: vNino }]);
const K_OHNE_THEMEN = await klausur(u, geo, []);
const K_OHNE_SEITEN = await klausur(u, geo, [{ title: "Leer", vokabel: vLeer }]);
const K_RIESIG = await klausur(u, geo, [{ title: "Riesig", vokabel: vRiesig }]);

const fremd = await nutzer("Fremd");

// ── Der nachgemachte Sender ──────────────────────────────────────────────────

type Verhalten = "fragen" | "kein" | "429" | "langsam" | "abgerissen";
let verhalten: Verhalten = "fragen";
const gesehen: BetaMessageStreamParams[] = [];

function nachricht(json: unknown): BetaMessage {
  return {
    id: "msg_probe",
    type: "message",
    role: "assistant",
    container: null,
    context_management: null,
    diagnostics: null,
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify(json), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      inference_geo: null,
      input_tokens: 6_000,
      iterations: null,
      output_tokens: 4_000,
      output_tokens_details: { thinking_tokens: 1_500 },
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  } as unknown as BetaMessage;
}

/** Eine Frage, an der alles stimmt — auf eine Seite, mit einem Zitat daraus. */
function frage(page: string, quote: string, extra: Record<string, unknown> = {}) {
  return {
    page,
    question: "Was passiert bei El Niño mit dem Ostpazifik?",
    solution: "Er erwärmt sich ungewöhnlich stark, alle 2 bis 7 Jahre.",
    misconception: "Verwechselt mit La Niña, bei der er kälter wird.",
    quote,
    ...extra,
  };
}

async function senden(
  anfrage: BetaMessageStreamParams,
  _signal?: AbortSignal,
  begonnen?: () => void,
): Promise<BetaMessage> {
  gesehen.push(anfrage);

  if (verhalten === "abgerissen") {
    // Das Modell schreibt schon — und die Verbindung reißt ab, so wie das SDK
    // es meldet (ein `AnthropicError`): bezahlt, ohne Messung. Bis zur zweiten
    // Nachprüfung vom 11.10.2026 stand hier eine Überlastung im Strom; die ist
    // seitdem `ausfall` — bezahlt, aber nie am Blatt.
    begonnen?.();
    throw new AnthropicError("terminated");
  }

  if (verhalten === "429") {
    throw APIError.generate(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "erfunden" } },
      undefined,
      new Headers(),
    );
  }
  if (verhalten === "kein") {
    return nachricht({ questions: [], ergebnis: "kein-vorschlag", grund: "Die Abschriften sind nur Überschriften." });
  }
  if (verhalten === "langsam") {
    await new Promise((fertig) => setTimeout(fertig, 300));
    return nachricht({
      questions: [frage(p1, "Die Passatwinde schwächen sich ab")],
      ergebnis: "vorschlag",
      grund: "",
    });
  }

  return nachricht({
    questions: [
      frage(p1, "erwärmt sich der Ostpazifik ungewöhnlich stark", { topic: vNino }),
      frage(p2, "Dürre in Australien, Starkregen in Peru", { topic: vNino }),
      frage(p3, "Harte Standortfaktoren lassen sich in Geld messen", { topic: vStandort, kind: "verfahren" }),
      frage(p1, "x".repeat(1001)),
      frage(p4, "Gebildet mit avoir oder être."),
      frage(p3, "etwa Löhne und Steuern", { topic: vPasse }),
      frage(p1, "warmes Wasser strömt nach Osten", { kind: "meinung" }),
    ],
    note: "Zu Smart Cities gibt es kein Blatt.",
    ergebnis: "vorschlag",
    grund: "mehr war nicht drin",
  });
}

const deps = { senden, konfiguriert: true };

async function laeufe(examId: string) {
  return probe
    .select()
    .from(schema.leserLaeufe)
    .where(eq(schema.leserLaeufe.examId, examId))
    .orderBy(schema.leserLaeufe.createdAt);
}

async function vorschlaege(examId: string) {
  return probe
    .select()
    .from(recall.recallProposals)
    .where(and(eq(recall.recallProposals.userId, u), eq(recall.recallProposals.examId, examId)));
}

async function fragenIm(proposalId: string) {
  return probe
    .select()
    .from(recall.recallProposalItems)
    .where(eq(recall.recallProposalItems.proposalId, proposalId))
    .orderBy(recall.recallProposalItems.sortOrder);
}

// ── 1. Die Auskunft — eine für beide Wege ───────────────────────────────────

console.log("\n── 1. Der Stoff, wie read_exam_material und der Fragenlauf ihn sehen ──");
{
  const stoff = await stoffZuKlausur(u, K);
  const stand = stoff ? await fragenStand(u, stoff) : null;
  pruefe("zwölf Fragen wären dran", stand !== null && "wieviele" in stand.was && stand.was.wieviele === 12, stand?.was);
  pruefe("drei Seiten im Stoff, die französische nicht", stand?.auskunft.daten.pages.map((s) => s.id).sort().join() === [p1, p2, p3].sort().join());
  pruefe("der Satz warnt vor der maschinell gelesenen Seite", /maschinell gelesen/.test(stand?.auskunft.satz ?? ""), stand?.auskunft.satz);

  const werkzeug = await callTool({ id: u } as never, "read_exam_material", { exam: K });
  pruefe(
    "read_exam_material liefert denselben Satz und dieselben Daten",
    werkzeug.art === "daten" &&
      werkzeug.satz === stand?.auskunft.satz &&
      JSON.stringify(werkzeug.daten) === JSON.stringify(stand?.auskunft.daten),
    werkzeug.art === "daten" ? werkzeug.satz : werkzeug,
  );

  const eng = await callTool({ id: u } as never, "read_exam_material", { exam: K, topic: "El Niño" });
  const engeSeiten = eng.art === "daten" ? (eng.daten as { pages: { id: string }[] }).pages.map((s) => s.id) : [];
  pruefe("mit `topic` nur die Seiten dieses Themas", engeSeiten.sort().join() === [p1, p2].sort().join(), engeSeiten);

  const riesig = await callTool({ id: u } as never, "read_exam_material", { exam: K_RIESIG });
  pruefe("ein zu großer Stoff ist im Chat weiter ein Fehler mit dem Rat zu `topic`", riesig.art === "fehler" && /nimmt `topic`/.test(riesig.satz), riesig);

  if (stoff) {
    const direkt = await stoffAuskunft(u, stoff, stoff.themen);
    pruefe("und zählt genau wie ein Werkzeugergebnis", direkt.zeichen === `${direkt.satz}\n${JSON.stringify(direkt.daten)}`.length);
  }
}

// ── 2. Ein Lauf mit Vorschlag ────────────────────────────────────────────────

console.log("\n── 2. Ein Lauf: Fragen in den Eingang, nichts in den Bestand ──");
let vorschlagId = "";
{
  verhalten = "fragen";
  const vorher = gesehen.length;
  const standVorher = (await blaetterStand(u)).stand;
  const ergebnis = await fragenBauen(u, K, deps);
  pruefe("ein Aufruf", gesehen.length - vorher === 1);
  pruefe(
    "der Fingerabdruck der Blätter bleibt — ein Fragenlauf ändert an keinem Blatt etwas",
    (await blaetterStand(u)).stand === standVorher,
  );
  pruefe("Ergebnis „vorschlag“, vermerkt", ergebnis.gelaufen && ergebnis.ergebnis === "vorschlag" && ergebnis.vermerkt, ergebnis);

  const anfrage = gesehen.at(-1) as unknown as Record<string, unknown>;
  pruefe("die Anfrage trägt kein Werkzeug", !("tools" in anfrage) && !("tool_choice" in anfrage) && !("mcp_servers" in anfrage));
  pruefe("mit dem Systemtext des Fragenlaufs", anfrage.system === FRAGEN_SYSTEM);
  const format = (anfrage.output_config as { format: { schema: { properties: Record<string, { minItems?: number }> } } }).format;
  pruefe(
    "die Form: questions, note, ergebnis, grund — ohne exam, ohne Mindestzahl",
    Object.keys(format.schema.properties).join() === "questions,note,ergebnis,grund" &&
      format.schema.properties.questions?.minItems === undefined,
    Object.keys(format.schema.properties),
  );
  const inhalt = (anfrage.messages as { content: { type: string; text: string }[] }[])[0]?.content ?? [];
  pruefe(
    "der Inhalt: Auftrag und Stoff als Text, mit den Seiten-ids und dem Wortlaut",
    inhalt.length === 2 &&
      inhalt.every((b) => b.type === "text") &&
      /schreib 12 Fragen dazu/.test(inhalt[0]?.text ?? "") &&
      (inhalt[1]?.text ?? "").includes(p3) &&
      (inhalt[1]?.text ?? "").includes("Harte Standortfaktoren") &&
      !(inhalt[1]?.text ?? "").includes(p4),
  );

  const liste = await vorschlaege(K);
  pruefe("genau ein Vorschlag, von „agent“", liste.length === 1 && liste[0]?.origin === "agent", liste);
  vorschlagId = liste[0]?.id ?? "";
  pruefe(
    "die Notiz sagt, dass die App eine Frage weggelassen hat",
    /^Zu Smart Cities gibt es kein Blatt\. Die App hat eine Frage weggelassen/.test(liste[0]?.note ?? ""),
    liste[0]?.note,
  );

  const fragen = await fragenIm(vorschlagId);
  pruefe("fünf Fragen: zu lang und fremde Seite fehlen", fragen.length === 5, fragen.length);
  pruefe("keine Frage auf der französischen Seite", !fragen.some((f) => f.pageId === p4));
  pruefe(
    "das fremde Thema ist weg, die Frage bleibt; die falsche Art ist „begriff“",
    fragen.filter((f) => f.pageId === p3).some((f) => f.subjectTopicId === null) &&
      fragen.some((f) => f.sourceQuote === "warmes Wasser strömt nach Osten" && f.materialKind === "begriff") &&
      fragen.some((f) => f.materialKind === "verfahren" && f.subjectTopicId === vStandort),
    fragen.map((f) => [f.sourceQuote, f.subjectTopicId, f.materialKind]),
  );

  const { rows: bestand } = await pg.query<{ n: number }>(`select count(*)::int as n from recall_items`);
  pruefe("im Bestand steht nichts — übernehmen kann nur ein Mensch", bestand[0]?.n === 0);

  const [lauf] = await laeufe(K);
  pruefe(
    "der Vermerk: art fragen, an der Klausur, ohne Blatt und Schlüssel",
    lauf?.art === "fragen" && lauf.examId === K && lauf.materialId === null && lauf.schluessel === "",
    lauf,
  );
  pruefe("mit Modell und Kosten", lauf?.modell === "claude-opus-5-5" && typeof lauf.kostenUsd === "number" && lauf.kostenUsd > 0, lauf?.kostenUsd);
  pruefe(
    "und einem Grund, der zählt statt glaubt",
    /^5 Fragen liegen im Eingang \(bestellt waren 12\); 1 auf einer Seite außerhalb des Stoffs weggelassen; bei 1 das Thema verworfen/.test(lauf?.grund ?? "") &&
      /Frage 4 weggelassen/.test(lauf?.grund ?? "") &&
      /Frage 7: Art verworfen/.test(lauf?.grund ?? "") &&
      /Claude: mehr war nicht drin$/.test(lauf?.grund ?? ""),
    lauf?.grund,
  );

  const letzter = await letzterFragenLauf(u, K);
  pruefe("die Klausurseite zeigt ihn: „Fragen vorgeschlagen“", letzter !== null && /: Fragen vorgeschlagen — 5 Fragen/.test(laufAnzeige(letzter)), letzter && laufAnzeige(letzter));

  const kosten = await laufKostenSeit(u, new Date(Date.now() - 60_000));
  pruefe("die Monatssumme der Einstellungen zählt ihn mit", kosten.laeufe === 1 && kosten.usd > 0, kosten);
}

// ── 3. Danach: nichts, bis der Mensch entschieden hat ───────────────────────

console.log("\n── 3. Kein zweiter Vorschlag auf denselben Stoff ──");
{
  const vorher = gesehen.length;
  const ergebnis = await fragenBauen(u, K, deps);
  pruefe(
    "offene Fragen im Eingang: kein Aufruf, kein Vermerk",
    !ergebnis.gelaufen && /5 Fragen liegen noch unentschieden im Eingang/.test(ergebnis.grund) && gesehen.length === vorher && (await laeufe(K)).length === 1,
    ergebnis,
  );

  await vorschlagVerwerfen(u, vorschlagId);
  const stoff = await stoffZuKlausur(u, K);
  const stand = stoff ? await fragenStand(u, stoff) : null;
  pruefe(
    "nach dem Verwerfen: der Mensch hat Nein gesagt — auch kein Aufruf",
    stand !== null && "nichts" in stand.was && /schon abgelehnt/.test(stand.was.nichts),
    stand?.was,
  );
  const nochmal = await fragenBauen(u, K, deps);
  pruefe("und der Lauf sagt dasselbe", !nochmal.gelaufen && gesehen.length === vorher, nochmal);
}

// ── 4. kein-vorschlag und Pause ──────────────────────────────────────────────

console.log("\n── 4. „kein-vorschlag“ steht jetzt in der Datenbank, eine Pause auch ──");
{
  verhalten = "kein";
  const ergebnis = await fragenBauen(u, K2, deps);
  const [lauf] = await laeufe(K2);
  pruefe(
    "„kein-vorschlag“ mit dem Grund des Modells, ohne Vorschlag",
    ergebnis.gelaufen && ergebnis.ergebnis === "kein-vorschlag" && lauf?.grund === "Die Abschriften sind nur Überschriften." && (await vorschlaege(K2)).length === 0,
    { ergebnis, lauf },
  );

  verhalten = "429";
  await fragenLaufen(u, K2, deps);
  weckerAus();
  const zuletzt = (await laeufe(K2)).at(-1);
  pruefe("429: „pause“, vermerkt, ohne Messung", zuletzt?.ergebnis === "pause" && zuletzt.messung === null && zuletzt.kostenUsd === null, zuletzt);
  pruefe("und der Abschreiber hält mit an — derselbe Schlüssel", (prozess()?.pauseBis ?? 0) > Date.now());
  const anzeige = await letzterFragenLauf(u, K2);
  pruefe("die Klausurseite sagt „angehalten“", anzeige !== null && /: angehalten — Grenze der API erreicht/.test(laufAnzeige(anzeige)), anzeige && laufAnzeige(anzeige));
  pruefe("ein 429 vor dem Strom ist kein bezahlter Abbruch", zuletzt?.abbruch === null, zuletzt);

  // Abgerissen, nachdem der Strom begann: bezahlt, und die Summe des Monats
  // ist danach eine Untergrenze (Abnahme vom 11.10.2026).
  const kostenVorher = await laufKostenSeit(u, new Date(0));
  verhalten = "abgerissen";
  await fragenLaufen(u, K2, deps);
  weckerAus();
  const abgerissen = (await laeufe(K2)).at(-1);
  pruefe(
    "mitten im Strom abgerissen: „pause“, bezahlt (strom), ohne Messung",
    abgerissen?.ergebnis === "pause" && abgerissen.abbruch === "strom" && abgerissen.messung === null,
    abgerissen,
  );
  const kostenNachher = await laufKostenSeit(u, new Date(0));
  pruefe(
    "die Monatssumme zählt ihn als abgebrochen — „mindestens“",
    kostenNachher.abgebrochen === kostenVorher.abgebrochen + 1 && /^mindestens /.test(kostenSatz(kostenNachher)),
    { kostenNachher, satz: kostenSatz(kostenNachher) },
  );
}

// ── 5. Die Sperre ────────────────────────────────────────────────────────────

console.log("\n── 5. Ein zweiter Druck während des Laufs stößt nichts an ──");
{
  verhalten = "langsam";
  const vorher = gesehen.length;
  const erster = fragenLaufen(u, K2, deps);
  await new Promise((fertig) => setTimeout(fertig, 100));
  pruefe("der erste läuft", fragenLaufenGerade(u, K2) && gesehen.length - vorher === 1);

  await fragenLaufen(u, K2, deps);
  await erster;
  await new Promise((fertig) => setTimeout(fertig, 400));
  weckerAus();

  pruefe("ein Aufruf, nicht zwei", gesehen.length - vorher === 1, gesehen.length - vorher);
  pruefe("ein Vorschlag, nicht zwei", (await vorschlaege(K2)).length === 1);
  pruefe("und danach ist die Klausur frei", !fragenLaufenGerade(u, K2));
}

// ── 6. Wann gar nicht gefragt wird ───────────────────────────────────────────

console.log("\n── 6. Ohne Themen, ohne Seiten, zu groß, fremd, ohne Schlüssel ──");
{
  verhalten = "fragen";
  const vorher = gesehen.length;
  const zeilenVorher = (await probe.select().from(schema.leserLaeufe)).length;

  const ohneThemen = await fragenBauen(u, K_OHNE_THEMEN, deps);
  pruefe("ohne Themen", !ohneThemen.gelaufen && /keine Themen/.test(ohneThemen.grund), ohneThemen);

  const ohneSeiten = await fragenBauen(u, K_OHNE_SEITEN, deps);
  pruefe("ohne abgeschriebene Seite", !ohneSeiten.gelaufen && /keine abgeschriebene Seite/.test(ohneSeiten.grund), ohneSeiten);

  const riesig = await fragenBauen(u, K_RIESIG, deps);
  pruefe("zu groß für eine Auskunft", !riesig.gelaufen && /länger als die 140 000/.test(riesig.grund), riesig);

  const anderer = await fragenBauen(fremd, K, deps);
  pruefe("die Klausur eines anderen gibt es nicht", !anderer.gelaufen && /gibt es nicht/.test(anderer.grund), anderer);

  const ohneSchluessel = await fragenBauen(u, K2);
  pruefe("ohne Schlüssel kein Aufruf", !ohneSchluessel.gelaufen && /ANTHROPIC_API_KEY/.test(ohneSchluessel.grund), ohneSchluessel);

  pruefe("in keinem dieser Fälle ein Aufruf", gesehen.length === vorher);
  pruefe("und kein Vermerk", (await probe.select().from(schema.leserLaeufe)).length === zeilenVorher);
}

// ── 7. propose_questions im Chat — dieselbe Übersetzung ─────────────────────

console.log("\n── 7. propose_questions über callTool, nach dem Umbau ──");
{
  const antwort = await callTool({ id: u } as never, "propose_questions", {
    exam: K2,
    questions: [frage(p1, "erwärmt sich der Ostpazifik ungewöhnlich stark", { topic: vNino, kind: "ereignis" })],
  });
  const liste = await vorschlaege(K2);
  const neueste = liste.find((v) => v.id === (antwort.art === "daten" ? (antwort.daten as { id: string }).id : ""));
  const fragen = neueste ? await fragenIm(neueste.id) : [];
  pruefe(
    "eine Frage, mit Seite, Thema und Art",
    antwort.art === "daten" && fragen.length === 1 && fragen[0]?.pageId === p1 && fragen[0]?.subjectTopicId === vNino && fragen[0]?.materialKind === "ereignis",
    { antwort, fragen },
  );
}

weckerAus();
console.log(`\n${proben - fehler} von ${proben} Proben bestanden.`);
await pg.close();
process.exit(fehler === 0 ? 0 : 1);
