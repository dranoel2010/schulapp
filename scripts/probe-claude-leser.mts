/**
 * Ein Rauchtest für den Claude-Leser der App (11.10.2026) — gegen eine ECHTE
 * Datenbank und nicht gegen Typen, mit einem nachgemachten Sender und ohne
 * Netz.
 *
 * Warum es ihn gibt: was der Leser liest, entscheiden Abfragen
 * (`claudeKandidaten()`, das Gedächtnis in `leser_laeufe`, `listPageActivity()`),
 * was er sich merkt, hält ein eindeutiger Teilindex fest, und was aus einer
 * Antwort wird, entscheidet die Tür mit `autoFile()` dahinter. Nichts davon
 * prüft `npm test`; dort gibt es keine Datenbank. Und hier kostet ein Fehler
 * Geld: ein Blatt, das nach einem Verwerfen oder einem Neustart noch einmal
 * gelesen wird, ist ein zweites Mal bezahlt.
 *
 * Die Datenbank baut die Probe selbst: das Schema VOR der Tabelle
 * `leser_laeufe` (aus `drizzle-kit generate` über den Stand vor dem Umbau),
 * dann scripts/leser-laeufe-tabelle.sql darüber — so ist die Wanderung gleich
 * mitgeprüft. P ist ein Ordner außerhalb des Repos; BASIS ist heute `main`,
 * nach dem Commit des Umbaus dessen Vorgänger:
 *
 *   mkdir -p P && ln -s "$PWD/node_modules" P/node_modules
 *   git show BASIS:src/db/schema.ts > P/schema.ts
 *   (cd P && ./node_modules/.bin/drizzle-kit generate --dialect postgresql \
 *     --schema ./schema.ts --out ./out --name basis)
 *   npx tsx scripts/probe-claude-leser.mts P/db P/out/0000_basis.sql
 *
 * Das Datenbank-Verzeichnis muss neu sein, und es DARF NICHT `.data/pglite`
 * sein; eine gesetzte `DATABASE_URL` hält die Probe an. Kein Aufruf geht ins
 * Netz: der Sender ist nachgemachter, `fetch` wirft, und die Schlüssel aus der
 * Umgebung dieses Rechners sind gelöscht. Alle Texte sind erfunden; echte
 * Schülerseiten gehören nie hierher.
 *
 * Am 11.10.2026 gelaufen: 72 von 72 — der Leser liest jedes Blatt einmal, nach
 * Verwerfen und ohne neue Seite kein zweites Mal, nie eine alte Seite eines
 * Altblattes von selbst, und Pause, Frist und „nichts“ landen, wo sie hingehören.
 * Mit Abschnitt 11 (der trockene Lauf für scripts/abschrift-messen.mts) am
 * selben Tag: 81 von 81 — gemessen wird mit demselben Aufruf, und die Datenbank
 * sieht danach aus wie vorher.
 *
 * Nach der Abnahme vom selben Tag kamen die Abschnitte 12 bis 21 dazu, je einer
 * für einen Befund, der sich am echten Ablauf zeigt (die Nachweise der Prüfer
 * lagen unter /tmp/pruef-api/, hier sind sie dauerhaft): eine Seite, die
 * während des Aufrufs gelöscht wird; ein 400 vor dem Strom, der kein Blatt
 * stilllegen darf; der Knopf, während der Leser an einem anderen Blatt sitzt;
 * das Gedächtnis über Einordnen und Nachlese hinweg; ein Blatt, an dem jede
 * Pause hängt; die Kosten bezahlter Abbrüche; die Zeile „laeuft“ vor dem
 * Aufruf und nach einem Neustart; ein Nullzeichen in der Antwort; eine Seite,
 * die während des Laufs dazukommt; ein ausgelasteter Rückfall. Gelaufen:
 * 125 von 125. Abschnitt 5 zählt seitdem nur noch bezahlte Abbrüche auf die
 * Grenze — der nachgemachte Sender meldet dafür wie das SDK, wann das Modell
 * zu schreiben begann.
 *
 * Nach der Nachprüfung vom selben Tag kamen die Abschnitte 22 bis 26 dazu
 * (die Proben der Nachprüfer lagen in /tmp, je Gruppe ein Ordner pruef-…): ein Ausfall der API
 * über den Strom, der kein Blatt stilllegen darf; Pausen von Konto und Netz,
 * die kein Blatt ruhen lassen; zwei Knopfdrücke, während die Uhr der
 * Datenbank vorgeht — bis dahin fiel der zweite in jedem dritten Lauf weg,
 * und Abschnitt 6 wackelte; Vorschläge von außen, die ein Mensch verwirft;
 * und ein Korbblatt, an dem während des Laufs eine Docling-Seite dazukommt.
 * Abschnitt 5 und 18 zählen seitdem den Abbruch im Strom NICHT mehr auf die
 * Grenze, sondern eine Frist und einen ausgelasteten Rückfall. Gelaufen: 153
 * von 153, dreimal hintereinander; gegen den Stand davor 135 von 153.
 *
 * Nach der zweiten Nachprüfung kamen die Abschnitte 27 und 28 dazu: ein
 * Strom, der an einem Blatt jedes Mal abreißt, nachdem das Modell schrieb —
 * er kostete seit Abschnitt 22 jeden Anstoß aufs Neue (zwanzig von zwanzig),
 * jetzt höchstens zwei Aufrufe —; und mehrere verworfene Vorschläge am
 * selben Stand, in beiden Reihenfolgen und als Wettlauf mit einem Lauf des
 * Lesers. Abschnitt 5 zählt seitdem den Abbruch im Strom wieder, nur einen
 * Ausfall der API nicht (`ausfall`), und Abschnitt 22 prüft nur noch solche
 * Ausfälle; der 400 im Strom steht in Abschnitt 27. Gelaufen: 184 von 184,
 * dreimal hintereinander; gegen den Stand davor 168 von 184.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import type {
  BetaMessage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";

const [verzeichnis, basisDatei] = process.argv.slice(2);
if (!verzeichnis || !basisDatei) {
  console.error(
    "Aufruf: npx tsx scripts/probe-claude-leser.mts <neues-verzeichnis> <0000_basis.sql>",
  );
  process.exit(1);
}

if (path.resolve(verzeichnis).includes(path.join(".data", "pglite"))) {
  console.error("Nicht gegen .data/pglite — das ist die eigene Datenbank.");
  process.exit(1);
}

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt — die Probe läuft nur gegen ihre eigene Datei-Datenbank.");
  process.exit(1);
}

if (existsSync(verzeichnis) && readdirSync(verzeichnis).length > 0) {
  console.error(`${verzeichnis} ist nicht leer — die Probe braucht eine frische Datenbank.`);
  process.exit(1);
}

// Nichts aus der Umgebung dieses Rechners: kein Schlüssel, der Geld kosten
// könnte, kein Jev, kein Docling, keine Notbremse, keine andere Bildfassung.
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

const HIER = path.dirname(fileURLToPath(import.meta.url));

/**
 * Die Fehlerklassen des SDK aus DERSELBEN Fassung, die @/lib/claude/ergebnis
 * sieht. Diese Datei ist ESM (.mts) und bekäme mit `import` die ESM-Fassung
 * des Pakets; die .ts-Dateien der App lädt tsx als CommonJS und damit die
 * andere — zwei Klassen gleichen Namens, und `instanceof` sagte zu jedem
 * nachgemachten Fehler nein (am 11.10.2026 so gesehen: ein 429 wurde zu
 * „Unerwarteter Fehler“). In der App gibt es das nicht: dort wirft das SDK
 * selbst, aus derselben Fassung, die ergebnis.ts importiert.
 */
const { APIConnectionError, APIError } = createRequire(import.meta.url)(
  "@anthropic-ai/sdk",
) as typeof import("@anthropic-ai/sdk");
const pg = new PGlite(verzeichnis);

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

/** Eine SQL-Datei, wie drizzle-kit sie schreibt, in einem Zug. */
async function einspielen(datei: string, transaktion: boolean) {
  const text = readFileSync(datei, "utf8").replaceAll("--> statement-breakpoint", "");
  await pg.exec(transaktion ? `BEGIN;\n${text}\nCOMMIT;` : text);
}

console.log("\n── 0. Die Tabelle auf das alte Schema ──");

await einspielen(basisDatei, false);
await einspielen(path.join(HIER, "leser-laeufe-tabelle.sql"), true);
{
  const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from leser_laeufe`);
  pruefe("leser_laeufe steht und ist leer", rows[0]?.n === 0, rows);
}

// Ab hier geht nichts mehr ins Netz — auch nicht aus Versehen. Erst jetzt,
// weil PGlite beim Öffnen seine eigenen Dateien lädt.
globalThis.fetch = (() => {
  throw new Error("Die Probe geht nicht ins Netz.");
}) as typeof fetch;

const probe = drizzle(pg, { schema });
(globalThis as unknown as { __schulappDb?: unknown }).__schulappDb = probe;

const { blattAbschreiben, claudeKnopfMoeglich, claudeLaufen, claudeVonHand } = await import(
  "@/lib/leser/claude-leser"
);
const { claudeBeschaeftigt, claudeEingeplant, claudeLiestGerade } = await import(
  "@/lib/leser/claude-zustand"
);
const {
  blattKosten,
  claudeKandidaten,
  laufAbschliessen,
  laufBeginnen,
  laufKostenSeit,
  laufVermerken,
  letzterLauf,
  nutzerMitLeserArbeit,
} = await import("@/lib/leser/laeufe");
const { ABSCHREIBER_SYSTEM } = await import("@/lib/abschrift-regeln");
const { blaetterStand, defaultMaterialTitle, deletePage, listPageActivity } = await import(
  "@/lib/materials"
);
const { createProposal, deleteProposal, listInbox, markFiled } = await import("@/lib/inbox");
const { blattVorschlagen } = await import("@/lib/blatt-vorschlag");
const { VERWORFEN_GRUND } = await import("@/lib/leser/laeufe");
const { PAUSEN_JE_BLATT, PAUSE_ANFANG_MS, SPAETER_HOECHSTENS } = await import(
  "@/lib/leser/claude-ablauf"
);
const { RUHE_MS } = await import("@/lib/leser/regel");

type Prozess = {
  wecker: Map<string, ReturnType<typeof setTimeout>>;
  pauseBis: number;
  naechstePauseMs: number;
  wartenAufPause: Set<string>;
  spaeterBis: Map<string, number>;
  pausenFolge: { materialId: string; anzahl: number } | null;
};
const prozess = () =>
  (globalThis as unknown as { __schulappClaude: Prozess }).__schulappClaude;

/** Alle Wecker aus — sonst stieße einer nach der Probe den echten Sender an. */
function weckerAus() {
  const p = prozess();
  if (!p) return;
  for (const wecker of p.wecker.values()) clearTimeout(wecker);
  p.wecker.clear();
}

// ── Nutzer, Fächer, Blätter ──────────────────────────────────────────────────

async function nutzer(name: string): Promise<string> {
  const [zeile] = await probe
    .insert(schema.users)
    .values({ name, passwordHash: "x" })
    .returning({ id: schema.users.id });
  return zeile.id;
}

async function fach(userId: string): Promise<string> {
  const [zeile] = await probe
    .insert(schema.subjects)
    .values({ userId, name: "Geografie", short: "Ge" })
    .returning({ id: schema.subjects.id });
  return zeile.id;
}

const bild = Buffer.from([0xff, 0xd8, 0x01]);

type SeitenAngabe = {
  leser: schema.Leser | null;
  /** So lange ist die Seite schon da. */
  vorMs?: number;
  /** Eine Abschrift steht schon da (auch die leere). */
  transcript?: string | null;
  maschinell?: boolean;
  /** Ein fester Zeitpunkt statt `vorMs`. */
  am?: Date;
};

async function blatt(
  userId: string,
  subjectId: string,
  optionen: { filedAt?: Date | null; seiten: SeitenAngabe[] },
): Promise<{ id: string; pages: string[] }> {
  const capturedOn = "2026-10-01";
  const [zeile] = await probe
    .insert(schema.materials)
    .values({
      userId,
      subjectId,
      title: defaultMaterialTitle(capturedOn),
      capturedOn,
      filedAt: optionen.filedAt ?? null,
    })
    .returning({ id: schema.materials.id });

  const pages: string[] = [];
  for (const [i, s] of optionen.seiten.entries()) {
    pages.push(await seiteAnhaengen(zeile.id, i, s));
  }
  return { id: zeile.id, pages };
}

async function seiteAnhaengen(materialId: string, sortOrder: number, s: SeitenAngabe) {
  const [seite] = await probe
    .insert(schema.materialPages)
    .values({
      materialId,
      sortOrder,
      mimeType: "image/jpeg",
      width: 100,
      height: 100,
      byteSize: 3,
      image: bild,
      reading: bild,
      thumb: bild,
      leser: s.leser,
      transcript: s.transcript ?? null,
      maschinell: s.maschinell ?? false,
      createdAt: s.am ?? new Date(Date.now() - (s.vorMs ?? 60_000)),
    })
    .returning({ id: schema.materialPages.id });
  return seite.id;
}

async function transcript(pageId: string) {
  const [zeile] = await probe
    .select({ transcript: schema.materialPages.transcript, maschinell: schema.materialPages.maschinell })
    .from(schema.materialPages)
    .where(eq(schema.materialPages.id, pageId));
  return zeile;
}

async function laeufe(materialId: string) {
  return probe
    .select()
    .from(schema.leserLaeufe)
    .where(eq(schema.leserLaeufe.materialId, materialId))
    .orderBy(schema.leserLaeufe.createdAt);
}

async function vorschlaegeAm(userId: string, materialId: string) {
  const korb = await listInbox(userId);
  return korb.find((eintrag) => eintrag.id === materialId)?.proposals ?? [];
}

// ── Der nachgemachte Sender ──────────────────────────────────────────────────

type Verhalten =
  | "abschreiben"
  | "ablehnen"
  | "429"
  | "zeit"
  | "fremd"
  | "400"
  | "500"
  | "ueberlastet"
  | "abrechnung"
  | "netz";
let verhalten: Verhalten = "abschreiben";

/**
 * Was ein Abschnitt zusätzlich mit einem Aufruf tut, bevor die Antwort kommt —
 * eine Seite löschen, eine dazulegen, nachsehen, was in der Tabelle steht —,
 * oder welche Antwort er selbst gibt. Ohne Rückgabe gilt `verhalten`. Wirft
 * er, nachdem er `begonnen` gerufen hat, ist das ein Abbruch mitten im Strom,
 * wie das SDK ihn meldet: das Modell hatte schon geschrieben.
 */
let waehrend:
  | ((
      g: Gesehen,
      begonnen?: () => void,
    ) => Promise<BetaMessage | undefined | void> | BetaMessage | undefined | void)
  | null = null;

type Gesehen = {
  anfrage: BetaMessageStreamParams;
  /** Die Seiten, wie die Zeilen vor den Fotos sie nennen. */
  seiten: { nummer: number; id: string }[];
  bilder: number;
  auftrag: string;
  felder: string[];
  liestGerade: boolean;
  beschaeftigt: boolean;
  inArbeit: boolean | null;
};
const gesehen: Gesehen[] = [];
let waehrendBeschaeftigtFuer: { userId: string; materialId: string } | null = null;

function nachricht(
  json: unknown,
  stop: "end_turn" | "refusal" = "end_turn",
  empfohlen: string | null = null,
): BetaMessage {
  return {
    id: "msg_probe",
    type: "message",
    role: "assistant",
    container: null,
    context_management: null,
    diagnostics: null,
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify(json), citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    stop_details:
      stop === "refusal" ? { category: "bio", explanation: null, recommended_model: empfohlen } : null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      inference_geo: null,
      input_tokens: 2_000,
      iterations: null,
      output_tokens: 800,
      output_tokens_details: { thinking_tokens: 300 },
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  } as unknown as BetaMessage;
}

/** Ein Fehler mitten im Strom: ohne Status, nur mit `type` (wie im SDK). */
function stromFehler(typ: string): Error {
  return new APIError(
    undefined,
    { type: "error", error: { type: typ, message: "mitten im Strom" } },
    undefined,
    new Headers(),
    typ as never,
  );
}

async function senden(
  anfrage: BetaMessageStreamParams,
  _signal?: AbortSignal,
  begonnen?: () => void,
): Promise<BetaMessage> {
  const inhalt = anfrage.messages[0]?.content as { type: string; text?: string }[];
  const seiten = inhalt.flatMap((block) => {
    const treffer = block.type === "text" ? /^Seite (\d+) — id (\S+)$/.exec(block.text ?? "") : null;
    return treffer ? [{ nummer: Number(treffer[1]), id: treffer[2] }] : [];
  });
  const format = (anfrage.output_config as { format?: { schema?: { properties?: object } } })
    ?.format;
  const felder = Object.keys(format?.schema?.properties ?? {});

  const w = waehrendBeschaeftigtFuer;
  const g: Gesehen = {
    anfrage,
    seiten,
    bilder: inhalt.filter((block) => block.type === "image").length,
    auftrag: inhalt[0]?.text ?? "",
    felder,
    liestGerade: w ? claudeLiestGerade(w.materialId) : false,
    beschaeftigt: w ? claudeBeschaeftigt(w.userId) : false,
    inArbeit: w ? (await blaetterStand(w.userId)).inArbeit : null,
  };
  gesehen.push(g);

  const eigene = waehrend ? await waehrend(g, begonnen) : undefined;
  if (eigene) {
    begonnen?.();
    return eigene;
  }

  if (verhalten === "400") {
    // Vor dem Strom abgewiesen: `begonnen` fällt nie — das kostet nichts.
    throw APIError.generate(
      400,
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header.",
        },
      },
      undefined,
      new Headers(),
    );
  }
  if (verhalten === "500") {
    throw APIError.generate(500, { type: "error", error: { type: "api_error", message: "erfunden" } }, undefined, new Headers());
  }
  if (verhalten === "429") {
    throw APIError.generate(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "erfunden" } },
      undefined,
      new Headers(),
    );
  }
  // Ein leeres Guthaben (so kam es lange als 400) und ein Netz ohne
  // Namensauflösung: vor jeder Antwort, für jedes Blatt gleich.
  if (verhalten === "abrechnung") {
    throw APIError.generate(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
      undefined,
      new Headers(),
    );
  }
  if (verhalten === "netz") {
    throw new APIConnectionError({ message: "getaddrinfo ENOTFOUND api.anthropic.com" });
  }
  // Mitten im Strom: das Modell hatte zu schreiben begonnen, und dann bricht
  // es ab — bezahlt.
  if (verhalten === "zeit") {
    begonnen?.();
    throw stromFehler("timeout_error");
  }
  if (verhalten === "ueberlastet") {
    begonnen?.();
    throw stromFehler("overloaded_error");
  }
  begonnen?.();
  if (verhalten === "ablehnen") return nachricht({}, "refusal");

  const abschriften = seiten.map((seite) => ({ page: seite.id, text: `Erfundene Abschrift von Seite ${seite.nummer}.` }));
  if (verhalten === "fremd") {
    abschriften.push({ page: "00000000-0000-4000-8000-000000000000", text: "fremd" });
  }

  return nachricht(
    felder.length === 3
      ? { transcripts: abschriften, ergebnis: "vorschlag", grund: "" }
      : {
          transcripts: abschriften,
          title: verhalten === "fremd" ? "T".repeat(200) : null,
          topics: ["Häfen"],
          captured_on: null,
          note: null,
          ergebnis: "vorschlag",
          grund: "",
        },
  );
}

const deps = { senden, konfiguriert: true };

/** Ein Lauf, und wie oft dabei gesendet wurde. */
async function laufen(userId: string): Promise<number> {
  const vorher = gesehen.length;
  await claudeLaufen(userId, deps);
  weckerAus();
  return gesehen.length - vorher;
}

// ── 1. Die Kandidaten ────────────────────────────────────────────────────────

console.log("\n── 1. Wo es etwas zu lesen gibt ──");
{
  const u = await nutzer("Kandidaten");
  const f = await fach(u);
  const gemischt = await blatt(u, f, {
    seiten: [
      { leser: "docling", transcript: "Druck", maschinell: true },
      { leser: "claude" },
    ],
  });
  const nach = await blatt(u, f, {
    filedAt: new Date(Date.now() - 3_600_000),
    seiten: [{ leser: "claude", transcript: "Vorderseite", vorMs: 7_200_000 }, { leser: "claude" }],
  });
  const alt = await blatt(u, f, {
    filedAt: new Date("2026-08-25T10:00:00Z"),
    seiten: [
      { leser: null, am: new Date("2026-08-20T10:00:00Z") },
      { leser: null, am: new Date("2026-08-20T10:01:00Z") },
    ],
  });
  const druck = await blatt(u, f, { seiten: [{ leser: "docling", transcript: "Druck", maschinell: true }] });
  const offen = await blatt(u, f, { seiten: [{ leser: "offen" }, { leser: "claude" }] });

  const kandidaten = new Map((await claudeKandidaten(u)).map((k) => [k.materialId, k]));
  pruefe(
    "genau die Blätter mit einer ungelesenen Seite für Claude",
    kandidaten.size === 4 && !kandidaten.has(druck.id),
    [...kandidaten.keys()],
  );
  pruefe("das gemischte Blatt: eine Seite für Claude, im Korb", kandidaten.get(gemischt.id)?.fuerClaude === 1 && !kandidaten.get(gemischt.id)?.eingeordnet);
  pruefe(
    "das eingeordnete Blatt nennt die nachgereichte Seite",
    JSON.stringify(kandidaten.get(nach.id)?.nachgereicht) === JSON.stringify([nach.pages[1]]),
    kandidaten.get(nach.id),
  );
  pruefe("das Altblatt nennt keine", kandidaten.get(alt.id)?.nachgereicht.length === 0, kandidaten.get(alt.id));
  pruefe("die offene Seite wird gezählt", kandidaten.get(offen.id)?.offen === 1);

  const aktivitaet = await listPageActivity(u, [gemischt.id]);
  pruefe(
    "der Schlüssel ist Zeichen für Zeichen der von listPageActivity",
    kandidaten.get(gemischt.id)?.lastPageAt === aktivitaet.get(gemischt.id)?.lastPageAt,
  );
  pruefe(
    "das Alter der jüngsten Seite rechnet die Datenbank",
    (kandidaten.get(gemischt.id)?.seitLetzterSeiteMs ?? 0) >= 59_000,
    kandidaten.get(gemischt.id),
  );
}

// ── 2. Einordnen, und das Gedächtnis ─────────────────────────────────────────

console.log("\n── 2. Ein Korbblatt: einmal gelesen, nicht zweimal bezahlt ──");
{
  const u = await nutzer("Einordnen");
  const f = await fach(u);
  const korb = await blatt(u, f, {
    seiten: [
      { leser: "docling", transcript: "Gedruckter Kopf", maschinell: true },
      { leser: "claude" },
    ],
  });

  waehrendBeschaeftigtFuer = { userId: u, materialId: korb.id };
  pruefe("ein Lauf, ein Aufruf", (await laufen(u)) === 1);
  waehrendBeschaeftigtFuer = null;
  const g = gesehen[gesehen.length - 1]!;
  const anfrage = g.anfrage as unknown as Record<string, unknown>;

  pruefe("ohne Werkzeuge, mit dem Systemtext der Regeln", !("tools" in anfrage) && anfrage.system === ABSCHREIBER_SYSTEM);
  pruefe(
    "nur das Foto der Claude-Seite, mit Nummer und id davor",
    g.bilder === 1 && g.seiten.length === 1 && g.seiten[0]?.id === korb.pages[1] && g.seiten[0]?.nummer === 2,
    g.seiten,
  );
  pruefe(
    "Teilblatt ohne erste Seite: der Auftrag sagt beides",
    /schon selbst gelesen/.test(g.auftrag) && /title bleibt null/.test(g.auftrag),
  );
  pruefe("das Schema zum Einordnen", g.felder.includes("title") && g.felder.includes("note"), g.felder);
  pruefe("während des Aufrufs: liest gerade, beschäftigt, in Arbeit", g.liestGerade && g.beschaeftigt && g.inArbeit === true, g);
  pruefe("danach liest niemand mehr", !claudeLiestGerade(korb.id) && !claudeBeschaeftigt(u));

  const vorschlaege = await vorschlaegeAm(u, korb.id);
  pruefe(
    "ein Vorschlag im Korb, als „agent“, ohne Fach",
    vorschlaege.length === 1 && vorschlaege[0]?.origin === "agent" && vorschlaege[0]?.subjectId === null,
    vorschlaege,
  );
  const [lauf, ...mehr] = await laeufe(korb.id);
  const aktivitaet = (await listPageActivity(u, [korb.id])).get(korb.id);
  pruefe(
    "vermerkt: einordnen, vorschlag, unter lastPageAt, mit Modell und Kosten",
    mehr.length === 0 &&
      lauf?.art === "einordnen" &&
      lauf.ergebnis === "vorschlag" &&
      lauf.schluessel === aktivitaet?.lastPageAt &&
      lauf.modell === "claude-opus-5-5" &&
      Math.abs(Number(lauf.kostenUsd) - 0.024) < 1e-9 &&
      lauf.messung?.eingabe === 2_000,
    lauf,
  );
  pruefe(
    "der Grund sagt, wo der Vorschlag liegt und was abgeschrieben ist",
    /Vorschlag liegt im Korb: Jev ist nicht eingerichtet/.test(lauf?.grund ?? "") &&
      /Abschrift 1 von 1 Seite/.test(lauf?.grund ?? ""),
    lauf?.grund,
  );

  pruefe("ein zweiter Lauf ruft nicht", (await laufen(u)) === 0);

  const id = vorschlaege[0]?.id ?? "";
  pruefe("Vorschlag verworfen", await deleteProposal(u, id));
  pruefe("Verwerfen löst kein neues, bezahltes Lesen aus", (await laufen(u)) === 0);

  // Eine neue Seite macht einen neuen Fall — ruhig, aber jünger als die alten.
  await seiteAnhaengen(korb.id, 2, { leser: "claude", vorMs: RUHE_MS + 5_000 });
  pruefe("eine neue Seite macht einen neuen Fall", (await laufen(u)) === 1);
  pruefe(
    "und der Lauf liest beide ungelesenen Claude-Seiten",
    gesehen[gesehen.length - 1]?.seiten.length === 2,
    gesehen[gesehen.length - 1]?.seiten,
  );
  pruefe("zwei Läufe stehen da, unter zwei Schlüsseln", new Set((await laeufe(korb.id)).map((l) => l.schluessel)).size === 2);
}

// ── 3. Ruhe und offene Seiten ────────────────────────────────────────────────

console.log("\n── 3. Ein frisches Blatt wartet, eine offene Seite hält an ──");
{
  const u = await nutzer("Ruhe");
  const f = await fach(u);
  const frisch = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 2_000 }] });
  const offen = await blatt(u, f, { seiten: [{ leser: "offen", vorMs: 120_000 }, { leser: "claude", vorMs: 120_000 }] });

  const vorher = gesehen.length;
  await claudeLaufen(u, deps);
  const wecker = new Set(prozess().wecker.keys());
  weckerAus();
  pruefe("kein Aufruf", gesehen.length === vorher);
  pruefe("ein Wecker für das frische Blatt, keiner für das offene", wecker.has(frisch.id) && !wecker.has(offen.id), [...wecker]);
  pruefe("nichts vermerkt", (await laeufe(frisch.id)).length === 0 && (await laeufe(offen.id)).length === 0);
}

// ── 4. Nachlese ──────────────────────────────────────────────────────────────

console.log("\n── 4. Nachgereichte Seiten: nur diese, und gleich übernommen ──");
{
  const u = await nutzer("Nachlese");
  const f = await fach(u);
  const altMitRueckseite = await blatt(u, f, {
    filedAt: new Date("2026-08-25T10:00:00Z"),
    seiten: [{ leser: null, am: new Date("2026-08-20T10:00:00Z") }, { leser: "claude" }],
  });

  pruefe("ein Aufruf", (await laufen(u)) === 1);
  const g = gesehen[gesehen.length - 1]!;
  pruefe(
    "nur die nachgereichte Seite, nie die alte des Altblattes",
    g.seiten.length === 1 && g.seiten[0]?.id === altMitRueckseite.pages[1],
    g.seiten,
  );
  pruefe("das Schema der Nachlese hat drei Felder", JSON.stringify([...g.felder].sort()) === '["ergebnis","grund","transcripts"]', g.felder);
  pruefe("der Auftrag sagt „nachgereicht“", /nachgereicht/.test(g.auftrag));

  const rueckseite = await transcript(altMitRueckseite.pages[1]!);
  const alte = await transcript(altMitRueckseite.pages[0]!);
  pruefe(
    "die Abschrift steht an der Seite, nicht maschinell",
    rueckseite?.transcript === "Erfundene Abschrift von Seite 2." && !rueckseite.maschinell,
    rueckseite,
  );
  pruefe("die alte Seite bleibt ungelesen", alte?.transcript === null, alte);
  const [lauf] = await laeufe(altMitRueckseite.id);
  pruefe(
    "vermerkt, an den Seiten gezählt",
    lauf?.art === "nachlese" && lauf.ergebnis === "vorschlag" && /1 von 1 Seite übernommen/.test(lauf.grund),
    lauf,
  );
  pruefe("kein Vorschlag bleibt liegen", (await vorschlaegeAm(u, altMitRueckseite.id)).length === 0);
  pruefe("danach gibt es nichts mehr zu lesen", (await laufen(u)) === 0);

  // Ein Vorschlag, jünger als die letzte Seite, hält die Nachlese an.
  const wartet = await blatt(u, f, {
    filedAt: new Date(Date.now() - 3_600_000),
    seiten: [{ leser: "claude", transcript: "Vorderseite", vorMs: 7_200_000 }, { leser: "claude" }],
  });
  await createProposal(u, wartet.id, { subjectId: null, title: "Von Hand", capturedOn: null, note: null, topics: [], transcripts: null }, "manuell");
  pruefe("ein jüngerer Vorschlag: kein Lauf", (await laufen(u)) === 0);
  pruefe("und nichts vermerkt", (await laeufe(wartet.id)).length === 0);
}

// ── 5. Pause, Frist, nichts ──────────────────────────────────────────────────

console.log("\n── 5. Was nicht am Blatt liegt, wird nicht gemerkt ──");
{
  const u = await nutzer("Fehler");
  const f = await fach(u);

  const kontingent = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  verhalten = "429";
  pruefe("429: ein Aufruf", (await laufen(u)) === 1);
  const [pause] = await laeufe(kontingent.id);
  pruefe("vermerkt als pause, ohne Messung", pause?.ergebnis === "pause" && pause.messung === null && pause.kostenUsd === null, pause);
  pruefe(
    "die Pause gilt, und die nächste wird doppelt so lang",
    prozess().pauseBis > Date.now() && prozess().naechstePauseMs === 2 * PAUSE_ANFANG_MS,
    { bis: prozess().pauseBis, naechste: prozess().naechstePauseMs },
  );
  verhalten = "abschreiben";
  pruefe("in der Pause ruft kein Lauf", (await laufen(u)) === 0);

  // Die Pause von Hand beenden, wie der Wecker es täte.
  prozess().pauseBis = 0;
  prozess().wartenAufPause.clear();
  pruefe("nach der Pause: das Blatt war nicht gemerkt und läuft", (await laufen(u)) === 1);
  pruefe("ein Ergebnis setzt die Pause auf den Anfang", prozess().naechstePauseMs === PAUSE_ANFANG_MS);

  const zaeh = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  verhalten = "zeit";
  pruefe("Abbruch mitten im Strom: ein Aufruf", (await laufen(u)) === 1);
  const [abgebrochen] = await laeufe(zaeh.id);
  pruefe(
    "vermerkt als spaeter, bezahlt abgebrochen, ohne Messung",
    abgebrochen?.ergebnis === "spaeter" && abgebrochen.abbruch === "strom" && abgebrochen.messung === null,
    abgebrochen,
  );
  verhalten = "abschreiben";
  pruefe("danach ruht das Blatt im Prozess", (await laufen(u)) === 0);

  // Auf die Grenze zählt jeder bezahlte Abbruch, der am Blatt liegen kann —
  // der im Strom von eben auch (Regression vom 11.10.2026: bis dahin zählte er
  // nicht, und so ein Blatt kostete jeden Anstoß aufs Neue). Ein Ausfall der
  // API mitten im Strom zählt nie: eine Überlastung dazwischen ändert nichts.
  prozess().spaeterBis.clear();
  verhalten = "ueberlastet";
  const warnVorher = console.warn;
  console.warn = () => {};
  pruefe("eine Überlastung mitten im Strom: ein Aufruf, eine Pause", (await laufen(u)) === 1);
  console.warn = warnVorher;
  pruefe(
    "vermerkt als pause, bezahlt, aber „ausfall“",
    (await laeufe(zaeh.id)).at(-1)?.abbruch === "ausfall",
    (await laeufe(zaeh.id)).at(-1),
  );
  prozess().pauseBis = 0;
  prozess().wartenAufPause.clear();
  prozess().naechstePauseMs = PAUSE_ANFANG_MS;
  verhalten = "zeit";
  pruefe("der Ausfall zählt nicht auf die Grenze: noch ein Versuch", (await laufen(u)) === 1);
  verhalten = "abschreiben";
  prozess().spaeterBis.clear();
  pruefe(`nach ${SPAETER_HOECHSTENS} bezahlten Abbrüchen im Strom: nur noch von Hand`, (await laufen(u)) === 0);

  const filter = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  verhalten = "ablehnen";
  pruefe("Ablehnung: ein Aufruf", (await laufen(u)) === 1);
  const [abgelehnt] = await laeufe(filter.id);
  pruefe(
    "vermerkt als nichts, mit Messung und Grund",
    abgelehnt?.ergebnis === "nichts" && abgelehnt.messung !== null && /Abgelehnt \(bio\)/.test(abgelehnt.grund),
    abgelehnt,
  );
  verhalten = "abschreiben";
  pruefe("„nichts“ ist gemerkt: kein zweiter Aufruf", (await laufen(u)) === 0);

  // ── Von Hand ──
  console.log("\n── 6. Von Hand: am Gedächtnis vorbei, aber nie neben einem Vorschlag ──");
  const vorher = gesehen.length;
  await claudeVonHand(u, filter.id, deps);
  pruefe("der Knopf liest trotz „nichts“", gesehen.length === vorher + 1);
  const vonHand = (await laeufe(filter.id)).at(-1);
  pruefe("vermerkt als von-hand", vonHand?.art === "von-hand" && vonHand.ergebnis === "vorschlag", vonHand);
  await claudeVonHand(u, filter.id, deps);
  pruefe("mit liegendem Vorschlag: kein Aufruf", gesehen.length === vorher + 1);

  verhalten = "ablehnen";
  await claudeVonHand(u, zaeh.id, deps);
  await claudeVonHand(u, zaeh.id, deps);
  const zweimal = (await laeufe(zaeh.id)).filter((l) => l.art === "von-hand");
  pruefe("zweimal von Hand: zwei Zeilen unter demselben Schlüssel", zweimal.length === 2 && zweimal[0]?.schluessel === zweimal[1]?.schluessel, zweimal.length);
  verhalten = "abschreiben";

  prozess().pauseBis = Date.now() + 60_000;
  const inDerPause = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  const vorPause = gesehen.length;
  await claudeVonHand(u, inDerPause.id, deps);
  pruefe("der Knopf wartet keine Pause ab", gesehen.length === vorPause + 1);
  prozess().pauseBis = 0;
  pruefe("nach dem Lauf ist kein Druck mehr vorgemerkt", !claudeLiestGerade(inDerPause.id));
  weckerAus();
}

console.log("\n── 7. Ein Altblatt von Hand: alle alten Seiten, und der Vorschlag bleibt für den Menschen ──");
{
  const u = await nutzer("Altblatt");
  const f = await fach(u);
  const alt = await blatt(u, f, {
    filedAt: new Date("2026-08-25T10:00:00Z"),
    seiten: [
      { leser: null, am: new Date("2026-08-20T10:00:00Z") },
      { leser: null, am: new Date("2026-08-20T10:01:00Z") },
    ],
  });

  pruefe("von selbst liest niemand ein Altblatt", (await laufen(u)) === 0);
  const ergebnis = await blattAbschreiben(u, alt.id, "von-hand", deps);
  const g = gesehen[gesehen.length - 1]!;
  pruefe(
    "von Hand: beide Seiten, Schema der Nachlese, ohne „nachgereicht“",
    g.seiten.length === 2 && g.felder.length === 3 && !/nachgereicht/.test(g.auftrag),
    g.seiten,
  );
  pruefe(
    "der Vorschlag bleibt im Korb, die Seiten bleiben ungelesen",
    ergebnis.gelaufen &&
      ergebnis.ergebnis === "vorschlag" &&
      /nichts übernommen/.test(ergebnis.grund) &&
      (await vorschlaegeAm(u, alt.id)).length === 1 &&
      (await transcript(alt.pages[0]!))?.transcript === null,
    ergebnis,
  );
}

console.log("\n── 8. Eine Antwort, die nicht ganz passt: nur das Passende kommt durch ──");
{
  const u = await nutzer("Prüfung");
  const f = await fach(u);
  const zwei = await blatt(u, f, { seiten: [{ leser: "claude" }, { leser: "claude" }] });

  verhalten = "fremd";
  pruefe("ein Aufruf", (await laufen(u)) === 1);
  verhalten = "abschreiben";
  const [vorschlag] = await vorschlaegeAm(u, zwei.id);
  const [lauf] = await laeufe(zwei.id);
  pruefe(
    "angelegt, ohne den zu langen Titel",
    lauf?.ergebnis === "vorschlag" && vorschlag !== undefined && vorschlag.title === null,
    { lauf, vorschlag },
  );
  pruefe(
    "der Grund nennt, was wegfiel",
    /nicht im Auftrag stand/.test(lauf?.grund ?? "") && /Titel verworfen — zu lang/.test(lauf?.grund ?? ""),
    lauf?.grund,
  );
}

// ── 9. Der Stand der Blätter ─────────────────────────────────────────────────

console.log("\n── 9. Der Stand der Blätter kennt die Läufe ──");
{
  const u = await nutzer("Stand");
  const f = await fach(u);
  const neu = await blatt(u, f, { seiten: [{ leser: "claude" }] });

  // Ein Schlüssel nur für die Frage „liest überhaupt jemand?“ — kein Lauf
  // benutzt ihn: alle Wecker sind aus, und `fetch` wirft ohnehin.
  process.env.ANTHROPIC_API_KEY = "probe-nie-benutzt";
  const vorher = await blaetterStand(u);
  delete process.env.ANTHROPIC_API_KEY;
  const ohneSchluessel = await blaetterStand(u);
  pruefe("eine frische Claude-Seite ist in Arbeit", vorher.inArbeit, vorher);
  // Ohne Schlüssel zählt weder die Seite noch das frische Korbblatt als in
  // Arbeit: an einem Blatt mit ungelesener Claude-Seite arbeitet dann niemand
  // (seit dem Durchklicken vom 11.10.2026 — vorher stand „wird gerade
  // gelesen“ neben „diese Seiten liest niemand“).
  pruefe(
    "ohne Schlüssel wartet weder die Seite noch das frische Korbblatt auf jemanden",
    !ohneSchluessel.inArbeit && ohneSchluessel.stand !== vorher.stand,
  );

  verhalten = "ablehnen";
  await laufen(u);
  verhalten = "abschreiben";
  process.env.ANTHROPIC_API_KEY = "probe-nie-benutzt";
  const nachher = await blaetterStand(u);
  delete process.env.ANTHROPIC_API_KEY;
  pruefe("ein Lauf ohne Vorschlag bewegt den Fingerabdruck", nachher.stand !== vorher.stand);
  pruefe("nach „nichts“ ist nichts mehr in Arbeit", !nachher.inArbeit, nachher);

  const letzter = await letzterLauf(u, neu.id);
  pruefe(
    "der letzte Lauf fürs Blatt, mit Kosten als Zahl",
    letzter?.ergebnis === "nichts" && typeof letzter.kostenUsd === "number",
    letzter,
  );
  const kosten = await laufKostenSeit(u, new Date(0));
  pruefe("die Kosten des Monats", kosten.laeufe === 1 && Math.abs(kosten.usd - 0.024) < 1e-9 && kosten.unbekannt === 0, kosten);
}

console.log("\n── 10. Der Start der App und die Tabelle selbst ──");
{
  const nurDruck = await nutzer("Nur Druck");
  const f = await fach(nurDruck);
  await blatt(nurDruck, f, { seiten: [{ leser: "docling", transcript: "Druck", maschinell: true }] });
  const arbeit = await nutzerMitLeserArbeit();
  const [altblatt] = await probe
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.name, "Altblatt"));
  pruefe(
    "beim Start: Nutzer mit ungelesenen Seiten ja, mit nur Gelesenem nein",
    arbeit.includes(altblatt!.id) && !arbeit.includes(nurDruck),
    arbeit.length,
  );

  const [einLauf] = await probe
    .select()
    .from(schema.leserLaeufe)
    .where(and(eq(schema.leserLaeufe.art, "einordnen"), eq(schema.leserLaeufe.ergebnis, "vorschlag")))
    .limit(1);
  const doppelt = await laufVermerken({
    userId: einLauf!.userId,
    materialId: einLauf!.materialId!,
    art: "einordnen",
    schluessel: einLauf!.schluessel,
    ergebnis: "nichts",
    grund: "zweiter Lauf",
    messung: null,
  });
  pruefe("ein zweites Ergebnis für denselben Stand wird nicht geschrieben", doppelt === false);

  let abgewiesen = false;
  try {
    await pg.query(
      `insert into leser_laeufe (user_id, material_id, art, ergebnis) values ($1, $2, 'fragen', 'nichts')`,
      [einLauf!.userId, einLauf!.materialId],
    );
  } catch {
    abgewiesen = true;
  }
  pruefe("der Fragenlauf hängt nie an einem Blatt (CHECK)", abgewiesen);
}

console.log("\n── 11. Trocken gemessen: gelesen, nichts geschrieben ──");
{
  const { seiteTrockenLesen } = await import("@/lib/leser/claude-trocken");
  const u = await nutzer("Messung");
  const f = await fach(u);
  // Ein eingeordnetes Blatt mit einer schon gelesenen und einer ungelesenen
  // Seite, und ein Korbblatt: gemessen werden darf an beiden, und keines
  // darf danach anders aussehen.
  const eingeordnet = await blatt(u, f, {
    filedAt: new Date(Date.now() - 3_600_000),
    seiten: [{ leser: "claude", transcript: "Schon gelesen" }, { leser: "claude" }],
  });
  const korb = await blatt(u, f, { seiten: [{ leser: "claude" }] });

  const zaehlen = async () => {
    const { rows } = await pg.query<{ laeufe: number; vorschlaege: number; abschriften: number }>(
      `select (select count(*)::int from leser_laeufe) as laeufe,
              (select count(*)::int from material_proposals) as vorschlaege,
              (select count(*)::int from material_pages where transcript is not null) as abschriften`,
    );
    return rows[0]!;
  };
  const vorher = await zaehlen();
  const vorherGesehen = gesehen.length;

  const erste = await seiteTrockenLesen(u, eingeordnet.id, eingeordnet.pages[0]!, "voll", "einordnen", senden);
  const zweite = await seiteTrockenLesen(u, eingeordnet.id, eingeordnet.pages[1]!, "lesefassung", "nachlese", senden);
  const dritte = await seiteTrockenLesen(u, korb.id, korb.pages[0]!, "lesefassung", "einordnen", senden);
  const nachher = await zaehlen();

  pruefe("drei Aufrufe, je einer mit genau einem Foto", gesehen.length - vorherGesehen === 3 && gesehen.slice(-3).every((g) => g.bilder === 1));
  pruefe(
    "kein Vermerk, kein Vorschlag, keine Abschrift — die Datenbank wie vorher",
    JSON.stringify(nachher) === JSON.stringify(vorher),
    { vorher, nachher },
  );
  pruefe(
    "die Zeile trägt den Text des Modells und daneben die gespeicherte Abschrift",
    erste.gelaufen &&
      erste.zeile.text === "Erfundene Abschrift von Seite 1." &&
      erste.zeile.bisher === "Schon gelesen" &&
      erste.zeile.fassung === "voll" &&
      erste.zeile.ergebnis === "vorschlag" &&
      erste.zeile.messung?.kostenUsd === 0.024,
    erste,
  );
  const g = gesehen.slice(-3);
  pruefe(
    "derselbe Aufruf wie im Betrieb: Systemtext der Regeln, die Zeile vor dem Foto, die Felder je Art",
    g.every((x) => x.anfrage.system === ABSCHREIBER_SYSTEM) &&
      g[0]!.felder.length === 7 &&
      g[1]!.felder.length === 3 &&
      g[1]!.seiten[0]?.nummer === 2,
    g.map((x) => ({ felder: x.felder, seiten: x.seiten })),
  );
  // Die erste Seite eines zweiseitigen Blattes ist ein Teilblatt mit Titel;
  // die zweite eines ohne — wie im Betrieb, wenn nur sie für Claude wäre.
  await seiteTrockenLesen(u, eingeordnet.id, eingeordnet.pages[1]!, "lesefassung", "einordnen", senden);
  const ohneErste = gesehen[gesehen.length - 1]!.auftrag;
  pruefe(
    "eine Seite allein ist ein Teilblatt, und ohne erste Seite gibt es keinen Titel",
    /übrigen Seiten dieses Blattes/.test(g[0]!.auftrag) &&
      !/title bleibt null/.test(g[0]!.auftrag) &&
      /title bleibt null/.test(ohneErste),
  );
  pruefe(
    "eine ungelesene Seite: bisher leer, und sie bleibt es",
    zweite.gelaufen && zweite.zeile.bisher === null && (await transcript(eingeordnet.pages[1]!))?.transcript === null,
    zweite,
  );
  pruefe(
    "ein Korbblatt bleibt ohne Vorschlag im Korb",
    dritte.gelaufen && (await vorschlaegeAm(u, korb.id)).length === 0 && (await laeufe(korb.id)).length === 0,
  );

  const fremd = await seiteTrockenLesen(u, korb.id, eingeordnet.pages[0]!, "lesefassung", "einordnen", senden);
  pruefe("eine Seite eines anderen Blattes: kein Aufruf", !fremd.gelaufen);

  verhalten = "429";
  const pause = await seiteTrockenLesen(u, korb.id, korb.pages[0]!, "lesefassung", "einordnen", senden);
  verhalten = "abschreiben";
  pruefe(
    "Pause ist eine Zeile wie jede andere — und setzt im Leser keine Pause",
    pause.gelaufen && pause.zeile.ergebnis === "pause" && pause.zeile.text === null && (prozess()?.pauseBis ?? 0) === 0,
    pause,
  );
}

// ── 12.–21. Die Befunde der Abnahme vom 11.10.2026 ──────────────────────────

/** Ein Lauf eines Nutzers, mit eigenem Sender-Verhalten nur für ihn. */
async function laufenMit(
  userId: string,
  eigen: NonNullable<typeof waehrend>,
): Promise<number> {
  waehrend = eigen;
  try {
    return await laufen(userId);
  } finally {
    waehrend = null;
  }
}

/** Die Abschriften an einem Vorschlag, wie sie in der Tabelle stehen. */
async function abschriftenAm(proposalId: string) {
  const { rows } = await pg.query<{ page_id: string; transcript: string }>(
    `select page_id, transcript from material_proposal_transcripts where proposal_id = $1`,
    [proposalId],
  );
  return rows;
}

/** Die Antwort zum Einordnen: jede gesehene Seite abgeschrieben, sonst nichts. */
function einordnenAntwort(g: Gesehen, teil: Record<string, unknown> = {}): BetaMessage {
  return nachricht({
    transcripts: g.seiten.map((s) => ({ page: s.id, text: `Abschrift ${s.nummer}` })),
    title: null,
    topics: [],
    captured_on: null,
    note: null,
    ergebnis: "vorschlag",
    grund: "",
    ...teil,
  });
}

console.log("\n── 12. Eine Seite wird gelöscht, während Claude liest ──");
{
  const u = await nutzer("Löschen");
  const f = await fach(u);
  const zwei = await blatt(u, f, {
    seiten: [
      { leser: "claude", vorMs: 120_000 },
      { leser: "claude", vorMs: 60_000 },
    ],
  });
  const [a, b] = zwei.pages as [string, string];

  pruefe(
    "ein Aufruf, und mittendrin löscht der Mensch die ältere Seite",
    (await laufenMit(u, async (g) => {
      await deletePage(u, a);
      return einordnenAntwort(g);
    })) === 1,
  );
  const [lauf, ...mehr] = await laeufe(zwei.id);
  pruefe(
    "kein gemerktes „nichts“ — ein Vorschlag, und der Grund nennt die gelöschte Seite",
    mehr.length === 0 && lauf?.ergebnis === "vorschlag" && /Seite 1 während des Laufs gelöscht/.test(lauf.grund),
    lauf,
  );
  const [vorschlag] = await vorschlaegeAm(u, zwei.id);
  const abschriften = vorschlag ? await abschriftenAm(vorschlag.id) : [];
  pruefe(
    "die Abschrift der übrigen Seite liegt im Vorschlag, und nur sie",
    abschriften.length === 1 && abschriften[0]?.page_id === b,
    abschriften,
  );
  pruefe("vermerkt, welche Seite abgeschrieben ist", JSON.stringify(lauf?.abgeschrieben) === JSON.stringify([b]), lauf?.abgeschrieben);
}

console.log("\n── 13. Ein 400 vor dem Strom legt kein Blatt still ──");
{
  const u = await nutzer("Vierhundert");
  const f = await fach(u);
  const blaetter = [];
  for (let i = 0; i < 3; i += 1) blaetter.push(await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 120_000 }] }));

  verhalten = "400";
  let aufrufe = 0;
  for (let anstoss = 1; anstoss <= 3; anstoss += 1) {
    aufrufe += await laufen(u);
    prozess().spaeterBis.clear(); // die Stunde Ruhe ist um
  }
  verhalten = "abschreiben";
  pruefe("drei Anstöße, je drei Aufrufe — alle abgewiesen", aufrufe === 9, aufrufe);
  const zeilen = (await Promise.all(blaetter.map((b) => laeufe(b.id)))).flat();
  pruefe(
    "jede Zeile „später“ ohne Abbruch — nichts davon hat gekostet",
    zeilen.length === 9 && zeilen.every((z) => z.ergebnis === "spaeter" && z.abbruch === null),
    zeilen.map((z) => [z.ergebnis, z.abbruch]),
  );
  pruefe("nach der Behebung liest der nächste Anstoß jedes Blatt", (await laufen(u)) === 3);
}

console.log("\n── 14. Der Knopf, während der Leser an einem anderen Blatt sitzt ──");
{
  const u = await nutzer("Knopf");
  const f = await fach(u);
  const y = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 600_000 }] });
  const x = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 120_000 }] });

  let freigeben: () => void = () => {};
  const yFertig = new Promise<void>((fertig) => {
    freigeben = fertig;
  });
  const je = new Map<string, number>();
  let waehrendY: { eingeplant: boolean; knopf: boolean } | null = null;
  waehrend = async (g) => {
    const wer = g.seiten.some((s) => s.id === y.pages[0]) ? "Y" : "X";
    je.set(wer, (je.get(wer) ?? 0) + 1);
    if (wer === "Y") {
      waehrendY = { eingeplant: claudeEingeplant(x.id), knopf: claudeKnopfMoeglich(x.id) };
      await yFertig;
      return einordnenAntwort(g);
    }
    return nachricht({}, "refusal");
  };
  const lauf = claudeLaufen(u, deps);
  await new Promise((r) => setTimeout(r, 50));
  const knopf = claudeVonHand(u, x.id, deps);
  await new Promise((r) => setTimeout(r, 50));
  freigeben();
  await lauf;
  await knopf;
  waehrend = null;
  weckerAus();

  pruefe(
    "während Y gelesen wird: X ist eingeplant, und die Seite zeigt keinen Knopf",
    JSON.stringify(waehrendY) === JSON.stringify({ eingeplant: true, knopf: false }),
    waehrendY,
  );
  pruefe("X wird genau einmal gelesen — vom Knopf", je.get("X") === 1 && je.get("Y") === 1, Object.fromEntries(je));
  const anX = await laeufe(x.id);
  pruefe("ein Lauf an X, von Hand", anX.length === 1 && anX[0]?.art === "von-hand", anX.map((l) => [l.art, l.ergebnis]));

  // Ein zweiter Tab, der die Seite vor diesem Lauf gezeichnet hat: sein Druck
  // ändert nichts — der Lauf, den er nicht gesehen hat, steht schon da.
  const vorher = gesehen.length;
  await claudeVonHand(u, x.id, deps, null);
  pruefe("ein Druck aus einem veralteten Tab ruft nicht", gesehen.length === vorher);
  // Wer den letzten Lauf gesehen hat und noch einmal drückt, bekommt den Lauf.
  verhalten = "ablehnen";
  await claudeVonHand(u, x.id, deps, anX[0]!.id);
  verhalten = "abschreiben";
  pruefe("ein Druck, der den letzten Lauf kennt, ruft", gesehen.length === vorher + 1);
}

console.log("\n── 15. Das Gedächtnis über Einordnen und Nachlese hinweg ──");
{
  const u = await nutzer("Gedächtnis");
  const f = await fach(u);

  // a) Verworfen und abgehakt: die Nachlese liest nicht noch einmal, was das
  //    Einordnen abgeschrieben hatte.
  const verworfen = await blatt(u, f, {
    seiten: [
      { leser: "claude", vorMs: 180_000 },
      { leser: "claude", vorMs: 120_000 },
    ],
  });
  pruefe("eingeordnet: ein Aufruf", (await laufen(u)) === 1);
  const [vorschlag] = await vorschlaegeAm(u, verworfen.id);
  pruefe("verworfen", await deleteProposal(u, vorschlag!.id));
  pruefe("abgehakt", (await markFiled(u, verworfen.id, true)) === "gesetzt");
  pruefe(
    "die Seiten gelten als nachgereicht …",
    ((await listPageActivity(u, [verworfen.id])).get(verworfen.id)?.unreadAttachedPageIds.length ?? 0) === 2,
  );
  pruefe("… und trotzdem: kein neues, bezahltes Lesen", (await laufen(u)) === 0);

  // b) Nachlese ohne Vorschlag, dann „wieder in den Korb“: kein Einordnen.
  const zurueck = await blatt(u, f, {
    filedAt: new Date(Date.now() - 3_600_000),
    seiten: [
      { leser: "claude", transcript: "Vorderseite", vorMs: 7_200_000 },
      { leser: "claude", vorMs: 1_800_000 },
    ],
  });
  pruefe(
    "Nachlese der unlesbaren Rückseite: ein Aufruf",
    (await laufenMit(u, () => nachricht({ transcripts: [], ergebnis: "kein-vorschlag", grund: "zu unscharf" }))) === 1,
  );
  pruefe("wieder in den Korb", (await markFiled(u, zurueck.id, false)) === "gesetzt");
  pruefe("danach kein bezahltes Einordnen", (await laufen(u)) === 0);

  // c) Ein Altblatt „wieder in den Korb“: seine Seiten ohne Leser liest nur der Knopf.
  const alt = await blatt(u, f, {
    filedAt: new Date("2026-08-25T10:00:00Z"),
    seiten: [
      { leser: null, am: new Date("2026-08-20T10:00:00Z") },
      { leser: null, am: new Date("2026-08-20T10:01:00Z") },
    ],
  });
  pruefe("Altblatt zurück in den Korb", (await markFiled(u, alt.id, false)) === "gesetzt");
  pruefe("von selbst liest niemand seine alten Seiten", (await laufen(u)) === 0);

  // d) Die Ausnahme: eine Seite, die das Einordnen nicht lesen konnte,
  //    bekommt am eingeordneten Blatt ihren zweiten Versuch — und nur sie.
  const halb = await blatt(u, f, {
    seiten: [
      { leser: "claude", vorMs: 180_000 },
      { leser: "claude", vorMs: 120_000 },
    ],
  });
  const [h1, h2] = halb.pages as [string, string];
  pruefe(
    "eingeordnet, nur Seite 1 lesbar",
    (await laufenMit(u, (g) =>
      g.seiten.length === 2
        ? nachricht({
            transcripts: [{ page: h1, text: "Seite 1" }],
            title: null,
            topics: [],
            captured_on: null,
            note: "Seite 2 unlesbar",
            ergebnis: "vorschlag",
            grund: "",
          })
        : undefined,
    )) === 1,
  );
  const [halbVorschlag] = await vorschlaegeAm(u, halb.id);
  await deleteProposal(u, halbVorschlag!.id);
  await markFiled(u, halb.id, true);
  pruefe("die Nachlese: ein Aufruf", (await laufen(u)) === 1);
  const nach = gesehen[gesehen.length - 1]!;
  pruefe(
    "… nur über die Seite, die das Einordnen nicht abschreiben konnte",
    nach.seiten.length === 1 && nach.seiten[0]?.id === h2 && nach.felder.length === 3,
    nach.seiten,
  );
  pruefe("danach ist der Stand für beide erledigt", (await laufen(u)) === 0);
}

console.log("\n── 16. Ein Blatt, an dem jede Pause hängt, hält die übrigen nicht an ──");
{
  const u = await nutzer("Kopf");
  const f = await fach(u);
  const x = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 600_000 }] });
  await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 120_000 }] });
  const je = { X: 0, Y: 0 };
  const fehlerVorher = console.warn;
  console.warn = () => {};
  let ruheWecker = false;
  for (let i = 1; i <= PAUSEN_JE_BLATT + 1; i += 1) {
    waehrend = (g) => {
      if (g.seiten.some((s) => s.id === x.pages[0])) {
        je.X += 1;
        throw APIError.generate(500, { type: "error", error: { type: "api_error", message: "erfunden" } }, undefined, new Headers());
      }
      je.Y += 1;
      return einordnenAntwort(g);
    };
    await claudeLaufen(u, deps);
    waehrend = null;
    ruheWecker ||= prozess().wecker.has(`ruhe:${x.id}`);
    weckerAus();
    prozess().pauseBis = 0; // die Pause ist um
    prozess().wartenAufPause.clear();
  }
  console.warn = fehlerVorher;
  pruefe(
    `nach ${PAUSEN_JE_BLATT} Pausen in Folge an X ruht X, und Y wird gelesen`,
    je.X === PAUSEN_JE_BLATT && je.Y === 1,
    je,
  );
  pruefe("X ruht im Prozess, nicht in der Datenbank", prozess().spaeterBis.has(x.id));
  pruefe(
    "und ein Wecker stößt nach der Ruhe wieder an — unter eigenem Namen, der Knopf an X bleibt",
    ruheWecker && claudeKnopfMoeglich(x.id),
  );
  prozess().spaeterBis.clear();
  prozess().pausenFolge = null;
  prozess().naechstePauseMs = PAUSE_ANFANG_MS;
}

console.log("\n── 17. Bezahlte Abbrüche machen die Summe zur Untergrenze ──");
{
  const u = await nutzer("Kosten");
  const f = await fach(u);
  const b = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  verhalten = "ablehnen";
  await laufen(u);
  verhalten = "abschreiben";
  // Ein Abbruch mitten im Strom und eine verwaiste „laeuft“-Zeile (Neustart).
  const stand = (await listPageActivity(u, [b.id])).get(b.id)!;
  await laufVermerken({
    userId: u, materialId: b.id, art: "von-hand", schluessel: stand.lastPageAt,
    ergebnis: "spaeter", grund: "erfunden", messung: null, abbruch: "frist",
  });
  await laufBeginnen({ userId: u, materialId: b.id, art: "von-hand", schluessel: stand.lastPageAt, fristMs: -1_000 });
  // Und eine Pause vor dem Strom: kostet nichts, zählt nicht.
  await laufVermerken({
    userId: u, materialId: b.id, art: "einordnen", schluessel: stand.lastPageAt,
    ergebnis: "pause", grund: "429", messung: null,
  });
  const monat = await laufKostenSeit(u, new Date(0));
  pruefe(
    "der Monat: ein Lauf mit Antwort, zwei abgebrochene ohne Messung",
    monat.laeufe === 1 && monat.abgebrochen === 2 && Math.abs(monat.usd - 0.024) < 1e-9,
    monat,
  );
  const amBlatt = await blattKosten(u, b.id);
  pruefe("am Blatt dieselbe Zählung", JSON.stringify(amBlatt) === JSON.stringify(monat), amBlatt);
}

console.log("\n── 18. Die Zeile „laeuft“: vor dem Aufruf, und nach einem Neustart ──");
{
  const u = await nutzer("Läuft");
  const f = await fach(u);
  const b = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  let waehrendDesAufrufs: { ergebnis: string; fristBis: Date | null }[] = [];
  await laufenMit(u, async (g) => {
    waehrendDesAufrufs = (await laeufe(b.id)).map((l) => ({ ergebnis: l.ergebnis, fristBis: l.fristBis }));
    return einordnenAntwort(g);
  });
  pruefe(
    "während des Aufrufs steht die Zeile schon da, als „laeuft“ mit Frist",
    waehrendDesAufrufs.length === 1 && waehrendDesAufrufs[0]?.ergebnis === "laeuft" && waehrendDesAufrufs[0]?.fristBis !== null,
    waehrendDesAufrufs,
  );
  const [danach, ...mehr] = await laeufe(b.id);
  pruefe("danach trägt DIESELBE Zeile das Ergebnis", mehr.length === 0 && danach?.ergebnis === "vorschlag", danach);

  // Ein Neustart mitten im Aufruf: die Zeile bleibt „laeuft“. Solange ihre
  // Frist läuft, nimmt niemand das Blatt; danach zählt sie als bezahlter
  // Abbruch — zwei davon, und das Blatt liest nur noch der Knopf.
  const neu = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  const stand = (await listPageActivity(u, [neu.id])).get(neu.id)!;
  await laufBeginnen({ userId: u, materialId: neu.id, art: "einordnen", schluessel: stand.lastPageAt, fristMs: 60_000 });
  const vorher = gesehen.length;
  await claudeLaufen(u, deps);
  const wecker = new Set(prozess().wecker.keys());
  weckerAus();
  pruefe("frisch: kein zweiter Aufruf, ein Wecker auf das Ende der Frist", gesehen.length === vorher && wecker.has(neu.id), [...wecker]);

  await pg.query(`update leser_laeufe set frist_bis = now() - interval '1 second' where material_id = $1`, [neu.id]);
  // Der nächste Versuch bricht wieder bezahlt ab, und zwar am Blatt: eine
  // Ablehnung, deren Rückfall ausgelastet war. (Ein Abbruch im Strom zählte
  // hier bis zur Nachprüfung vom 11.10.2026 mit; er liegt an der API.)
  pruefe(
    "verwaist: ein neuer Versuch",
    (await laufenMit(u, () => nachricht({}, "refusal", "claude-opus-5"))) === 1,
  );
  prozess().spaeterBis.clear();
  pruefe(
    `nach ${SPAETER_HOECHSTENS} bezahlten Abbrüchen (einer davon der Neustart) liest es nur noch der Knopf`,
    (await laufen(u)) === 0,
  );
  const letzter = await letzterLauf(u, neu.id);
  pruefe("die Blattseite kennt den Abbruch", letzter?.abbruch === "rueckfall" && letzter.gemessen === true, letzter);

  // Zwei Läufe überschneiden sich (zwei Prozesse nach einem Neustart): der
  // zweite stößt mit seinem Ergebnis an den eindeutigen Teilindex. Seine
  // Zeile endet als „später“ ohne Abbruch, und das erste Ergebnis bleibt.
  const doppelt = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  const standDoppelt = (await listPageActivity(u, [doppelt.id])).get(doppelt.id)!;
  const zweiterLauf = await laufBeginnen({ userId: u, materialId: doppelt.id, art: "einordnen", schluessel: standDoppelt.lastPageAt, fristMs: 60_000 });
  await laufVermerken({ userId: u, materialId: doppelt.id, art: "einordnen", schluessel: standDoppelt.lastPageAt, ergebnis: "kein-vorschlag", grund: "der erste", messung: null });
  const eingetragen = await laufAbschliessen(zweiterLauf, { ergebnis: "nichts", grund: "der zweite", messung: null, abbruch: null, abgeschrieben: [] });
  const beide = (await laeufe(doppelt.id)).map((l) => [l.ergebnis, l.abbruch, l.grund.slice(0, 80)]);
  pruefe(
    "überschnitten: das zweite Ergebnis wird nicht eingetragen, die Zeile endet als „später“",
    eingetragen === false &&
      beide.some(([e, , g]) => e === "kein-vorschlag" && g === "der erste") &&
      beide.some(([e, a, g]) => e === "spaeter" && a === null && /schon ein Ergebnis da/.test(String(g))),
    beide,
  );
}

console.log("\n── 19. Ein Nullzeichen in der Antwort ──");
{
  const u = await nutzer("Nullzeichen");
  const f = await fach(u);
  const leer = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  const antwort = () =>
    nachricht({ transcripts: [], title: null, topics: [], captured_on: null, note: null, ergebnis: "kein-vorschlag", grund: "unscharf\u0000" });
  const fehlerVorher = console.error;
  const gemeldet: string[] = [];
  console.error = (...teile: unknown[]) => gemeldet.push(teile.join(" "));
  const erste = await laufenMit(u, antwort);
  prozess().spaeterBis.clear();
  const zweite = await laufenMit(u, antwort);
  console.error = fehlerVorher;
  const [lauf] = await laeufe(leer.id);
  pruefe(
    "vermerkt — ohne das Nullzeichen —, und kein zweiter Aufruf",
    erste === 1 && zweite === 0 && lauf?.ergebnis === "kein-vorschlag" && lauf.grund === "unscharf",
    { erste, zweite, lauf: lauf?.grund, gemeldet },
  );

  const text = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  await laufenMit(u, (g) =>
    einordnenAntwort(g, {
      transcripts: g.seiten.map((s) => ({ page: s.id, text: "Ab\u0000schrift" })),
      note: "Notiz\u0000",
    }),
  );
  const [v] = await vorschlaegeAm(u, text.id);
  const texte = v ? await abschriftenAm(v.id) : [];
  pruefe(
    "der Vorschlag steht, ohne Nullzeichen",
    texte[0]?.transcript === "Abschrift" && v?.note === "Notiz",
    { v, texte },
  );
}

console.log("\n── 20. Eine Seite, die während des Laufs dazukommt, wartet ──");
{
  const u = await nutzer("Dazu");
  const f = await fach(u);
  const b = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 120_000 }] });
  process.env.ANTHROPIC_API_KEY = "probe-nie-benutzt";
  await laufenMit(u, async () => {
    await seiteAnhaengen(b.id, 1, { leser: "claude", vorMs: 0 });
    return nachricht({ transcripts: [], title: null, topics: [], captured_on: null, note: null, ergebnis: "kein-vorschlag", grund: "unscharf" });
  });
  const stand = await blaetterStand(u);
  delete process.env.ANTHROPIC_API_KEY;
  pruefe("der Lauf endete ohne Vorschlag, unter dem ALTEN Stand", (await laeufe(b.id))[0]?.ergebnis === "kein-vorschlag");
  pruefe("die neue Seite gilt als in Arbeit — „wird gelesen“", stand.inArbeit, stand);
}

console.log("\n── 21. Abgelehnt, und der Rückfall war ausgelastet ──");
{
  const u = await nutzer("Rückfall");
  const f = await fach(u);
  const b = await blatt(u, f, { seiten: [{ leser: "claude" }] });
  pruefe("ein Aufruf", (await laufenMit(u, () => nachricht({}, "refusal", "claude-opus-5"))) === 1);
  const [lauf] = await laeufe(b.id);
  pruefe(
    "„später“, bezahlt (rueckfall), mit Messung — nicht gemerkt",
    lauf?.ergebnis === "spaeter" && lauf.abbruch === "rueckfall" && lauf.messung !== null,
    lauf,
  );
  prozess().spaeterBis.clear();
  pruefe("nach der Ruhe ein neuer Versuch", (await laufen(u)) === 1);
}

// ── 22.–26. Die Nachprüfung vom 11.10.2026 ───────────────────────────────────

/** Eine Pause von Hand beenden, wie ihr Wecker es täte. */
function pauseUm() {
  prozess().pauseBis = 0;
  prozess().wartenAufPause.clear();
}

console.log("\n── 22. Ein Ausfall der API über den Strom legt kein Blatt still ──");
{
  // Die API nimmt an (200) und schickt dann eine Überlastung, eine Grenze oder
  // einen Kontofehler als Ereignis im Strom, nachdem das Modell zu schreiben
  // begann — bezahlt, aber nie am Blatt (`ausfall`). Bis zur Nachprüfung
  // zählte jede solche Pause auf die Grenze je Blatt: nach zwei war das
  // älteste Blatt still, dann das nächste, und nach der Behebung las der Leser
  // keines mehr. Ein 400 im Strom gehört seit der Regression vom selben Tag
  // nicht mehr hierher: er ist am Blatt nicht ausgeschlossen (Abschnitt 27).
  const u = await nutzer("Ausfall");
  const f = await fach(u);
  const blaetter = [];
  for (let i = 0; i < 3; i += 1) {
    blaetter.push(await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 600_000 - i * 60_000 }] }));
  }
  const warnVorher = console.warn;
  console.warn = () => {};
  let aufrufe = 0;
  const arten = ["overloaded_error", "rate_limit_error", "billing_error"];
  for (let anstoss = 1; anstoss <= 6; anstoss += 1) {
    const art = arten[anstoss % arten.length]!;
    aufrufe += await laufenMit(u, (_g, begonnen) => {
      begonnen?.();
      throw stromFehler(art);
    });
    pauseUm();
  }
  console.warn = warnVorher;
  // Eine Pause hält den ganzen Lauf an: ein Aufruf je Anstoß.
  pruefe("sechs Ausfälle im Strom, je ein Aufruf", aufrufe === 6, aufrufe);
  pruefe(
    "keine Pause davon hat ein Blatt ruhen lassen — ein Ausfall liegt nicht am Blatt",
    prozess().spaeterBis.size === 0 && prozess().pausenFolge === null,
    { ruhen: [...prozess().spaeterBis.keys()], folge: prozess().pausenFolge },
  );
  const zeilen = (await Promise.all(blaetter.map((b) => laeufe(b.id)))).flat();
  pruefe(
    "jede Zeile ist bezahlt abgebrochen, als „ausfall“",
    zeilen.length === 6 && zeilen.every((z) => z.ergebnis === "pause" && z.abbruch === "ausfall"),
    zeilen.map((z) => [z.ergebnis, z.abbruch]),
  );
  const kosten = await laufKostenSeit(u, new Date(0));
  pruefe("die Summe sagt, dass ihr diese Abbrüche fehlen", kosten.abgebrochen === 6, kosten);
  pruefe("nach der Behebung liest der nächste Anstoß jedes Blatt", (await laufen(u)) === 3);
  prozess().naechstePauseMs = PAUSE_ANFANG_MS;
}

console.log("\n── 23. Pausen von Konto und Netz lassen kein Blatt ruhen ──");
{
  // Ein erreichtes Ausgabelimit (der 400 zum Guthaben) und ein Netz ohne
  // Namensauflösung, abwechselnd, länger als zwei Folgen von Pausen. Bis zur
  // Nachprüfung zählte jede Pause dem Blatt zu, das gerade dran war: nach drei
  // ruhte X eine Stunde, nach drei weiteren Y — ohne Wecker. Danach stieß
  // niemand mehr an, und nach der Behebung blieb alles liegen.
  const u = await nutzer("Konto");
  const f = await fach(u);
  const x = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 600_000 }] });
  const y = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 300_000 }] });
  const warnVorher = console.warn;
  console.warn = () => {};
  let aufrufe = 0;
  for (let anstoss = 1; anstoss <= 2 * PAUSEN_JE_BLATT; anstoss += 1) {
    verhalten = anstoss % 2 === 0 ? "netz" : "abrechnung";
    aufrufe += await laufen(u);
    pauseUm();
  }
  verhalten = "abschreiben";
  console.warn = warnVorher;
  pruefe(`${2 * PAUSEN_JE_BLATT} Anstöße, je ein Aufruf — immer an X, dem ältesten`, aufrufe === 2 * PAUSEN_JE_BLATT, aufrufe);
  pruefe(
    "kein Blatt ruht, und keine Folge steht",
    prozess().spaeterBis.size === 0 && prozess().pausenFolge === null,
    { ruhen: [...prozess().spaeterBis.keys()], folge: prozess().pausenFolge },
  );
  const zeilenX = await laeufe(x.id);
  pruefe(
    "Pausen ohne Kosten: kein Abbruch vermerkt",
    zeilenX.length === 2 * PAUSEN_JE_BLATT && zeilenX.every((z) => z.ergebnis === "pause" && z.abbruch === null),
    zeilenX.map((z) => [z.ergebnis, z.abbruch]),
  );
  pruefe("nach der Behebung liest der nächste Anstoß beide Blätter", (await laufen(u)) === 2);
  pruefe("Y ist dabei", (await laeufe(y.id)).some((z) => z.ergebnis === "vorschlag"));
  prozess().naechstePauseMs = PAUSE_ANFANG_MS;
}

console.log("\n── 24. Zwei Knopfdrücke, während die Uhr der Datenbank vorgeht ──");
{
  // Abschnitt 6 wackelte („zweimal von Hand“, einer von drei Läufen rot): der
  // Knopf verglich `created_at` des letzten Laufs — die Uhr der Datenbank —
  // mit `Date.now()` beim Druck. Ging die Datenbank ein paar Millisekunden
  // vor, galt der erste Lauf als „nach dem zweiten Druck“, und der fiel weg.
  // Hier geht sie fünf Sekunden vor (PGlite nimmt die Uhr des Prozesses, also
  // wird die für den ersten Lauf verstellt), damit es nicht vom Zufall
  // abhängt.
  const u = await nutzer("Zwei Uhren");
  const f = await fach(u);
  const b = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 120_000 }] });
  const echt = Date.now;
  verhalten = "ablehnen";
  try {
    Date.now = () => echt() + 5_000;
    await claudeVonHand(u, b.id, deps);
  } finally {
    Date.now = echt;
  }
  await claudeVonHand(u, b.id, deps);
  verhalten = "abschreiben";
  weckerAus();
  const vonHand = (await laeufe(b.id)).filter((l) => l.art === "von-hand");
  pruefe(
    "zwei Drücke nacheinander, zwei Läufe — die Uhr spielt keine Rolle",
    vonHand.length === 2,
    vonHand.map((l) => [l.ergebnis, l.createdAt.toISOString()]),
  );
}

console.log("\n── 25. Ein Vorschlag von außen, den ein Mensch verwirft ──");
{
  // Ein Chat (propose_sheet) oder der Postbote vor dem Wechsel legt einen
  // Vorschlag in den Korb. Bis zur Nachprüfung hinterließ er keine Spur im
  // Gedächtnis des Lesers: verworfen, las der Leser das Blatt bezahlt noch
  // einmal; verworfen und abgehakt, las die Nachlese dieselben Seiten und die
  // App übernahm die Abschrift ohne den Menschen.
  const u = await nutzer("Von außen");
  const f = await fach(u);
  const korbblatt = () =>
    blatt(u, f, {
      seiten: [
        { leser: "claude", vorMs: 7_200_000 },
        { leser: "claude", vorMs: 7_100_000 },
      ],
    });
  const vonAussen = async (b: { id: string; pages: string[] }, seiten: string[]) => {
    const tuer = await blattVorschlagen(u, {
      sheet: b.id,
      subjectId: f,
      title: "Von außen",
      transcripts: seiten.map((page) => ({ page, text: "abgeschrieben" })),
    });
    return tuer.art === "angelegt" ? tuer.id : "";
  };

  // a) im Korb verworfen
  const a = await korbblatt();
  const aVorschlag = await vonAussen(a, a.pages);
  pruefe("solange er liegt: kein Aufruf", (await laufen(u)) === 0);
  pruefe("verworfen", await deleteProposal(u, aVorschlag));
  pruefe("danach kein bezahltes Einordnen", (await laufen(u)) === 0);
  const [spur, ...mehr] = await laeufe(a.id);
  pruefe(
    "die Spur: einordnen, kein Vorschlag, beide Seiten abgeschrieben, ohne Kosten",
    mehr.length === 0 &&
      spur?.art === "einordnen" &&
      spur.ergebnis === "kein-vorschlag" &&
      spur.grund === VERWORFEN_GRUND &&
      JSON.stringify([...(spur.abgeschrieben ?? [])].sort()) === JSON.stringify([...a.pages].sort()) &&
      spur.messung === null,
    spur,
  );

  // b) verworfen und abgehakt
  const b = await korbblatt();
  const bVorschlag = await vonAussen(b, b.pages);
  await deleteProposal(u, bVorschlag);
  await markFiled(u, b.id, true);
  pruefe("verworfen und abgehakt: keine bezahlte Nachlese", (await laufen(u)) === 0);

  // c) eine Seite war unlesbar: sie bekommt am eingeordneten Blatt ihren
  //    zweiten Versuch — und nur sie.
  const c = await korbblatt();
  const [c1, c2] = c.pages as [string, string];
  const cVorschlag = await vonAussen(c, [c1]);
  await deleteProposal(u, cVorschlag);
  await markFiled(u, c.id, true);
  pruefe("Seite 2 fehlte im Vorschlag: ein Aufruf", (await laufen(u)) === 1);
  const zweiter = gesehen[gesehen.length - 1]!;
  pruefe(
    "… die Nachlese nur über Seite 2",
    zweiter.seiten.length === 1 && zweiter.seiten[0]?.id === c2 && zweiter.felder.length === 3,
    zweiter.seiten,
  );

  // d) ein Vorschlag von Hand ist kein Lesen — verworfen, liest der Leser.
  const d = await korbblatt();
  await createProposal(u, d.id, { subjectId: null, title: "Von Hand", capturedOn: null, note: null, topics: [], transcripts: null }, "manuell");
  const [dVorschlag] = await vorschlaegeAm(u, d.id);
  await deleteProposal(u, dVorschlag!.id);
  pruefe("ein verworfener Vorschlag von Hand hinterlässt keine Spur: der Leser liest", (await laufen(u)) === 1);

  // e) die Korbblätter von vor dem Wechsel (claude-einrichten.sh, Schritt 4b):
  //    auch abgehakt liest sie niemand von selbst.
  const e = await korbblatt();
  const skript = readFileSync(path.join(HIER, "claude-einrichten.sh"), "utf8");
  const korb = /KORB_VOR_DEM_WECHSEL=\$\(cat <<'SQL'\n([\s\S]*?)\nSQL\n\)/.exec(skript)?.[1] ?? "";
  const vermerken = /psql_db -tAc "(with neu as \(insert into leser_laeufe[^"]*)"/.exec(skript)?.[1] ?? "";
  pruefe("Schritt 4b steht im Skript, wie die Probe ihn erwartet", korb !== "" && vermerken !== "");
  const { rows } = await pg.query<{ count: number }>(vermerken.replace("$KORB_VOR_DEM_WECHSEL", korb));
  pruefe("4b vermerkt das Blatt", Number(rows[0]?.count ?? 0) >= 1, rows);
  pruefe("im Korb: kein Aufruf", (await laufen(u)) === 0);
  await markFiled(u, e.id, true);
  pruefe("abgehakt: auch keine bezahlte Nachlese", (await laufen(u)) === 0);
}

console.log("\n── 26. Ein Korbblatt, an dem während des Laufs eine Docling-Seite dazukommt ──");
{
  // Der Lauf liest Seite 1 und endet ohne Vorschlag; in der Zeit kam Seite 2
  // dazu, die Docling las. Ein neuer Stand — der nächste bezahlte Lauf steht
  // nach der Ruhe fest. Bis zur Nachprüfung fragte „frisch im Korb“ nach dem
  // Zeitpunkt der Laufzeile statt nach dem Stand, und das Blatt verschwand aus
  // „wird gelesen“.
  const u = await nutzer("Docling dazu");
  const f = await fach(u);
  const b = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 120_000 }] });
  await laufenMit(u, async () => {
    await seiteAnhaengen(b.id, 1, { leser: "docling", transcript: "Druck", maschinell: true, vorMs: 0 });
    return nachricht({ transcripts: [], title: null, topics: [], captured_on: null, note: null, ergebnis: "kein-vorschlag", grund: "unscharf" });
  });
  process.env.ANTHROPIC_API_KEY = "probe-nie-benutzt";
  const stand = await blaetterStand(u);
  delete process.env.ANTHROPIC_API_KEY;
  pruefe("der Lauf endete ohne Vorschlag, unter dem alten Stand", (await laeufe(b.id))[0]?.ergebnis === "kein-vorschlag");
  pruefe("das Blatt gilt als in Arbeit — „wird gelesen“", stand.inArbeit, stand);
  await claudeLaufen(u, deps);
  const wecker = new Set(prozess().wecker.keys());
  weckerAus();
  pruefe("und der Leser wartet tatsächlich auf seine Ruhe (ein Wecker)", wecker.has(b.id), [...wecker]);
}

// ── 27.–28. Die zweite Nachprüfung vom 11.10.2026 ───────────────────────────

console.log("\n── 27. Ein Strom, der an einem Blatt jedes Mal abreißt, kostet höchstens zwei Aufrufe ──");
{
  // Die Regression aus der zweiten Nachprüfung (/tmp/pruef-regr2/schleife.mts):
  // seit Abschnitt 22 zählte KEIN Abbruch im Strom mehr auf die Grenze je
  // Blatt. Ein Blatt, an dem der Strom jedes Mal abriss, nachdem das Modell
  // schrieb, kam nach jeder Pause und jeder Stunde Ruhe wieder dran — zwanzig
  // Anstöße, zwanzig bezahlte Aufrufe. Jetzt zählt jeder solche Abbruch, ob er
  // eine Pause wird oder ein „später“, außer seine Art schließt das Blatt aus
  // (Abschnitt 22). Daneben ein zweites Blatt Y, das ganz normal gelesen wird.
  const faelle: [string, () => Error][] = [
    ["api_error im Strom (eine Pause)", () => stromFehler("api_error")],
    ["400 im Strom (später)", () => stromFehler("invalid_request_error")],
    ["die Verbindung reißt ab (eine Pause)", () => new TypeError("terminated")],
  ];
  const warnVorher = console.warn;
  console.warn = () => {};
  for (const [name, fehlerFuer] of faelle) {
    const u = await nutzer(`Abriss: ${name}`);
    const f = await fach(u);
    const x = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 600_000 }] });
    const y = await blatt(u, f, { seiten: [{ leser: "claude", vorMs: 300_000 }] });
    const je = { X: 0, Y: 0 };
    for (let anstoss = 1; anstoss <= 20; anstoss += 1) {
      await laufenMit(u, (g, begonnen) => {
        if (g.seiten.some((s) => s.id === x.pages[0])) {
          je.X += 1;
          begonnen?.();
          throw fehlerFuer();
        }
        je.Y += 1;
        return einordnenAntwort(g);
      });
      // Zeit vergeht: die Pause, die Stunde Ruhe und jede Folge sind um.
      pauseUm();
      prozess().spaeterBis.clear();
      prozess().pausenFolge = null;
    }
    pruefe(`${name}: zwanzig Anstöße, ${SPAETER_HOECHSTENS} bezahlte Aufrufe an X`, je.X === SPAETER_HOECHSTENS, je);
    pruefe(`${name}: Y wird gelesen, einmal`, je.Y === 1 && (await laeufe(y.id))[0]?.ergebnis === "vorschlag", je);
    const zeilenX = await laeufe(x.id);
    pruefe(
      `${name}: an X stehen nur bezahlte Abbrüche im Strom`,
      zeilenX.length === SPAETER_HOECHSTENS && zeilenX.every((z) => z.abbruch === "strom" && z.messung === null),
      zeilenX.map((z) => [z.ergebnis, z.abbruch]),
    );
    pruefe(`${name}: weiter nur von Hand — der Knopf an X bleibt`, claudeKnopfMoeglich(x.id));
    prozess().naechstePauseMs = PAUSE_ANFANG_MS;
  }
  console.warn = warnVorher;
}

console.log("\n── 28. Mehrere verworfene Vorschläge an einem Stand — die Reihenfolge entscheidet nichts ──");
{
  // Die zweite Nachprüfung (/tmp/pruef-e3/r2.mts): `verworfenVermerken()`
  // stieg aus, sobald für den Stand schon ein gemerktes Einordnen stand — die
  // Spur eines früher verworfenen Vorschlags oder der Lauf des Lesers selbst.
  // Die Seiten des zweiten Verworfenen fehlten im Gedächtnis, und verworfen
  // und abgehakt las die Nachlese sie bezahlt und übernahm sie ohne Menschen —
  // je nachdem, welcher Vorschlag zuerst verworfen wurde.
  const u = await nutzer("Zweimal verworfen");
  const f = await fach(u);
  const korbblatt = () =>
    blatt(u, f, {
      seiten: [
        { leser: "claude", vorMs: 7_200_000 },
        { leser: "claude", vorMs: 7_100_000 },
      ],
    });
  const vonAussen = async (b: { id: string }, seiten: string[], titel: string) => {
    const tuer = await blattVorschlagen(u, {
      sheet: b.id,
      subjectId: f,
      title: titel,
      transcripts: seiten.map((page) => ({ page, text: `abgeschrieben von ${titel}` })),
    });
    return tuer.art === "angelegt" ? tuer.id : "";
  };
  const sortiert = (seiten: readonly string[] | null | undefined) => JSON.stringify([...(seiten ?? [])].sort());

  // a) und b): zwei Vorschläge von außen, A mit Seite 1, B mit beiden — in
  //    beiden Reihenfolgen verworfen.
  for (const [name, erstB] of [["A zuerst", false], ["B zuerst", true]] as const) {
    const b = await korbblatt();
    const a = await vonAussen(b, [b.pages[0]!], "A");
    const zwei = await vonAussen(b, b.pages, "B");
    for (const id of erstB ? [zwei, a] : [a, zwei]) await deleteProposal(u, id);
    pruefe(`${name}: im Korb kein bezahltes Einordnen`, (await laufen(u)) === 0);
    await markFiled(u, b.id, true);
    pruefe(`${name}: verworfen und abgehakt — keine bezahlte Nachlese`, (await laufen(u)) === 0);
    const zeilen = await laeufe(b.id);
    pruefe(
      `${name}: eine Spur, mit den Seiten beider Vorschläge`,
      zeilen.length === 1 && sortiert(zeilen[0]?.abgeschrieben) === sortiert(b.pages),
      zeilen.map((z) => [z.art, z.ergebnis, z.abgeschrieben]),
    );
  }

  // c) der Leser schafft Seite 1, ein Chat legt beide daneben; beide
  //    verworfen: der eigene Lauf trägt danach auch die Seite des Chats.
  {
    const b = await korbblatt();
    const [s1] = b.pages as [string, string];
    pruefe(
      "eigener Lauf: ein Aufruf, nur Seite 1",
      (await laufenMit(u, (g) =>
        einordnenAntwort(g, { transcripts: [{ page: s1, text: "Seite eins vom Leser" }] }),
      )) === 1,
    );
    await vonAussen(b, b.pages, "Chat");
    for (const v of await vorschlaegeAm(u, b.id)) await deleteProposal(u, v.id);
    await markFiled(u, b.id, true);
    pruefe("eigener Lauf und Chat verworfen, abgehakt — keine bezahlte Nachlese", (await laufen(u)) === 0);
    const [lauf, ...mehr] = await laeufe(b.id);
    pruefe(
      "die Zeile des Laufs bleibt sein Ergebnis und kennt jetzt beide Seiten",
      mehr.length === 0 && lauf?.ergebnis === "vorschlag" && lauf.messung !== null && sortiert(lauf.abgeschrieben) === sortiert(b.pages),
      { lauf, mehr },
    );
  }

  // d) eine Seite, die KEIN Vorschlag abgeschrieben hat, bekommt weiter ihren
  //    zweiten Versuch — und nur sie.
  {
    const b = await korbblatt();
    const [s1, s2] = b.pages as [string, string];
    const a = await vonAussen(b, [s1], "A");
    const zwei = await vonAussen(b, [s1], "B");
    await deleteProposal(u, a);
    await deleteProposal(u, zwei);
    await markFiled(u, b.id, true);
    pruefe("Seite 2 stand in keinem Vorschlag: ein Aufruf", (await laufen(u)) === 1);
    const zweiter = gesehen[gesehen.length - 1]!;
    pruefe(
      "… die Nachlese nur über Seite 2",
      zweiter.seiten.length === 1 && zweiter.seiten[0]?.id === s2 && zweiter.felder.length === 3,
      zweiter.seiten,
    );
  }

  // e) der Wettlauf: während der Leser am Korbblatt sitzt, legt ein Chat
  //    beide Seiten vor, und ein Mensch verwirft das sofort. Die Spur steht
  //    dann vor dem Ergebnis des Laufs; der Lauf darf daran nicht scheitern,
  //    und kein Weg danach darf das Blatt noch einmal bezahlt lesen.
  {
    const b = await korbblatt();
    const [s1] = b.pages as [string, string];
    let verworfen = false;
    pruefe(
      "Wettlauf: ein Aufruf, und mittendrin verwirft ein Mensch den Vorschlag eines Chats",
      (await laufenMit(u, async (g) => {
        const chat = await vonAussen(b, b.pages, "Chat");
        verworfen = await deleteProposal(u, chat);
        return einordnenAntwort(g, { transcripts: [{ page: s1, text: "Seite eins vom Leser" }] });
      })) === 1 && verworfen,
    );
    const zeilen = await laeufe(b.id);
    const spur = zeilen.find((z) => z.grund === VERWORFEN_GRUND);
    const lauf = zeilen.find((z) => z.messung !== null);
    pruefe(
      "die Spur des Chats steht, mit beiden Seiten; der Lauf ist bezahlt vermerkt und läuft nicht mehr",
      spur !== undefined && sortiert(spur.abgeschrieben) === sortiert(b.pages) && lauf !== undefined && lauf.ergebnis !== "laeuft",
      zeilen.map((z) => [z.art, z.ergebnis, z.abbruch, z.grund.slice(0, 50)]),
    );
    const [eigener, ...weitere] = await vorschlaegeAm(u, b.id);
    pruefe("der Vorschlag des Lesers liegt im Korb, nur er", eigener !== undefined && weitere.length === 0);
    prozess().spaeterBis.clear();
    pruefe("im Korb danach kein zweites bezahltes Einordnen", (await laufen(u)) === 0);
    await deleteProposal(u, eigener!.id);
    pruefe("auch nicht, nachdem der Mensch den des Lesers verworfen hat", (await laufen(u)) === 0);
    await markFiled(u, b.id, true);
    pruefe("und abgehakt keine bezahlte Nachlese — beide Seiten standen in einem Verworfenen", (await laufen(u)) === 0);
  }
}

weckerAus();
console.log(`\n${proben - fehler} von ${proben} Proben bestanden.`);
process.exit(fehler === 0 ? 0 : 1);
