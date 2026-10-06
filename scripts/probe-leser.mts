/**
 * Ein Rauchtest für „ein Leser je Seite“ (6.10.2026) — gegen eine ECHTE
 * Datenbank und nicht gegen Typen, mit einem nachgemachten Docling und einem
 * nachgemachten Jev.
 *
 * Warum es ihn gibt: die Regel, welche Seite der Postbote bekommt, ist SQL
 * (`nachgereichtUngelesen()`), die Kennzeichnung `maschinell` wird im
 * `update` selbst gerechnet, und das EINMAL des App-Vorschlags hängt an einer
 * Sperre in der Transaktion. Nichts davon prüft `npm test`; dort gibt es
 * keine Datenbank. Und die Wanderung scripts/leser-tabellen.sql weicht mit
 * Absicht von drizzle-kit ab — ob der Bestand danach wirklich NULL ist, sieht
 * man nur, wenn man sie auf einen Bestand spielt.
 *
 * Deshalb baut die Probe die Datenbank selbst, in zwei Stufen: erst das
 * Schema VOR dem Umbau (aus `drizzle-kit generate` über den alten Stand von
 * src/db/schema.ts), darin ein Altbestand, dann die Wanderung. Die
 * Basis-Datei entsteht so (P ist ein Ordner außerhalb des Repos):
 *
 *   mkdir -p P && ln -s "$PWD/node_modules" P/node_modules
 *   git show main:src/db/schema.ts > P/schema.ts
 *   (cd P && ./node_modules/.bin/drizzle-kit generate --dialect postgresql \
 *     --schema ./schema.ts --out ./out --name basis)
 *   npx tsx scripts/probe-leser.mts P/db P/out/0000_basis.sql
 *
 * Das Datenbank-Verzeichnis muss neu sein, und es DARF NICHT `.data/pglite`
 * sein: die Probe legt Nutzer, Fächer und Blätter an. Alle Texte sind
 * erfunden; echte Schülerseiten gehören nie hierher.
 *
 * Am 6.10.2026 gelaufen: alle Proben bestanden — die Wanderung lässt den
 * Bestand NULL, die Zuteilung liest jede offene Seite genau einmal und keine
 * schon gelesene, die Tür propose_sheet verwirft statt abzuweisen, und CRLF
 * aus einem Formular lässt die Kennzeichnung stehen.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";

const [verzeichnis, basisDatei] = process.argv.slice(2);
if (!verzeichnis || !basisDatei) {
  console.error(
    "Aufruf: npx tsx scripts/probe-leser.mts <neues-verzeichnis> <0000_basis.sql>",
  );
  process.exit(1);
}

if (path.resolve(verzeichnis).includes(path.join(".data", "pglite"))) {
  console.error("Nicht gegen .data/pglite — das ist die eigene Datenbank.");
  process.exit(1);
}

if (existsSync(verzeichnis) && readdirSync(verzeichnis).length > 0) {
  console.error(`${verzeichnis} ist nicht leer — die Probe braucht eine frische Datenbank.`);
  process.exit(1);
}

// Weder Jev noch die Notbremse aus der Umgebung dieses Rechners: die Probe
// bestimmt beides selbst.
delete process.env.TYPESAFE_API_KEY;
delete process.env.LESER_REGEL;
delete process.env.DOCLING_URL;

const HIER = path.dirname(fileURLToPath(import.meta.url));
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

/**
 * Drei Bytes, deren letztes sagt, was der nachgemachte Docling liest:
 * 1 = Druck, 2 = Kauderwelsch aus Handschrift, 3 = Docling scheitert.
 */
const DRUCK = 1;
const HANDSCHRIFT = 2;
const KAPUTT = 3;
/** Druck, aber während Docling rechnet, tippt jemand die Seite ab. */
const DRUCK_GETIPPT = 4;
const bild = (art: number) => Buffer.from([0xff, 0xd8, art]);

console.log("\n── 0. Die Wanderung auf einen Bestand ──");

await einspielen(basisDatei, false);

async function rohNutzer(name: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into users (name, password_hash) values ($1, 'x') returning id`,
    [name],
  );
  return rows[0].id;
}

async function rohFach(userId: string, name: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into subjects (user_id, name, short) values ($1, $2, $3) returning id`,
    [userId, name, name.slice(0, 2)],
  );
  return rows[0].id;
}

/** Ein Blatt im alten Schema: eingeordnet am `filedAt`, Seiten zu den Zeiten in `seiten`. */
async function rohBlatt(
  userId: string,
  subjectId: string,
  filedAt: string | null,
  seiten: string[],
): Promise<{ id: string; pages: string[] }> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into materials (user_id, subject_id, title, captured_on, filed_at)
     values ($1, $2, 'Altblatt', '2026-08-20', $3) returning id`,
    [userId, subjectId, filedAt],
  );
  const id = rows[0].id;
  const pages: string[] = [];
  for (const [i, createdAt] of seiten.entries()) {
    const seite = await pg.query<{ id: string }>(
      `insert into material_pages (material_id, sort_order, width, height, byte_size, image, reading, thumb, created_at)
       values ($1, $2, 100, 100, 3, $3, $3, $3, $4) returning id`,
      [id, i, bild(HANDSCHRIFT), createdAt],
    );
    pages.push(seite.rows[0].id);
  }
  return { id, pages };
}

const leo = await rohNutzer("Leo");
const fremd = await rohNutzer("Jemand anderes");
const geo = await rohFach(leo, "Geografie");

// Ein Altblatt wie die fünfzehn vom August: eingeordnet, keine Seite gelesen.
const altblatt = await rohBlatt(leo, geo, "2026-08-25T10:00:00Z", [
  "2026-08-20T10:00:00Z",
  "2026-08-20T10:01:00Z",
]);
// Ein altes Blatt mit einer Seite, die nach dem Einordnen dazukam.
const altMitRueckseite = await rohBlatt(leo, geo, "2026-08-25T10:00:00Z", [
  "2026-08-20T10:00:00Z",
  "2026-09-01T10:00:00Z",
]);

const vorher = await pg.query<{ n: number }>(`select count(*)::int as n from material_pages`);

await einspielen(path.join(HIER, "leser-tabellen.sql"), true);

{
  const { rows } = await pg.query<{ leser: string | null; maschinell: boolean; n: number }>(
    `select leser, maschinell, count(*)::int as n from material_pages group by 1, 2`,
  );
  pruefe(
    "der Bestand bleibt NULL und nicht maschinell",
    rows.length === 1 &&
      rows[0].leser === null &&
      rows[0].maschinell === false &&
      rows[0].n === vorher.rows[0].n,
    rows,
  );

  const neu = await pg.query<{ leser: string | null }>(
    `insert into material_pages (material_id, width, height, byte_size, image, reading, thumb)
     values ($1, 1, 1, 3, $2, $2, $2) returning leser`,
    [altblatt.id, bild(DRUCK)],
  );
  pruefe("eine neue Seite beginnt offen", neu.rows[0].leser === "offen", neu.rows);
  await pg.query(`delete from material_pages where leser = 'offen'`);

  let abgewiesen = false;
  try {
    await pg.query(`update material_pages set leser = 'quatsch' where material_id = $1`, [altblatt.id]);
  } catch {
    abgewiesen = true;
  }
  pruefe("die CHECK-Bedingung weist einen fremden Wert ab", abgewiesen);
}

// Ab hier spricht die App selbst mit der Probe-Datenbank.
const probe = drizzle(pg, { schema });
(globalThis as unknown as { __schulappDb?: unknown }).__schulappDb = probe;

const {
  createMaterialWithPage,
  defaultMaterialTitle,
  deletePage,
  getMaterial,
  korbblattStand,
  leserFestlegen,
  listMaterials,
  listMaterialTranscripts,
  listPageActivity,
  setMaterialTranscripts,
} = await import("@/lib/materials");
const { createProposal, listInbox, proposalInputSchema } = await import("@/lib/inbox");
const { korbblattAnstossen, zuteilungLaufen, ZWEITER_VERSUCH_MS } = await import(
  "@/lib/leser/zuteilung"
);
const { callTool } = await import("@/lib/mcp/run");
const { grundOhneMessung } = await import("@/lib/leser/regel");

const SEITE = { mimeType: "image/jpeg", width: 100, height: 100 };

/** Ein Blatt im neuen Schema, Seiten mit dem gegebenen Leser. */
async function blatt(
  userId: string,
  subjectId: string,
  optionen: {
    title?: string;
    capturedOn?: string;
    filedAt?: Date | null;
    seiten: { art: number; leser: schema.Leser | null; vorMs?: number }[];
  },
): Promise<{ id: string; pages: string[] }> {
  const capturedOn = optionen.capturedOn ?? "2026-10-01";
  const [zeile] = await probe
    .insert(schema.materials)
    .values({
      userId,
      subjectId,
      title: optionen.title ?? defaultMaterialTitle(capturedOn),
      capturedOn,
      filedAt: optionen.filedAt ?? null,
    })
    .returning({ id: schema.materials.id });

  const pages: string[] = [];
  for (const [i, s] of optionen.seiten.entries()) {
    const [seite] = await probe
      .insert(schema.materialPages)
      .values({
        materialId: zeile.id,
        sortOrder: i,
        ...SEITE,
        byteSize: 3,
        image: bild(s.art),
        reading: bild(s.art),
        thumb: bild(s.art),
        leser: s.leser,
        createdAt: new Date(Date.now() - (s.vorMs ?? 0)),
      })
      .returning({ id: schema.materialPages.id });
    pages.push(seite.id);
  }
  return { id: zeile.id, pages };
}

async function seite(pageId: string) {
  const [zeile] = await probe
    .select({
      leser: schema.materialPages.leser,
      leserGrund: schema.materialPages.leserGrund,
      doclingText: schema.materialPages.doclingText,
      transcript: schema.materialPages.transcript,
      maschinell: schema.materialPages.maschinell,
    })
    .from(schema.materialPages)
    .where(eq(schema.materialPages.id, pageId));
  return zeile;
}

const WOERTER = ["Hafen", "Schiff", "Container", "Brücke", "Ladung", "Kapitän"];
const DRUCKTEXT = [
  "# Handout Containerschifffahrt",
  "",
  Array.from({ length: 80 }, (_, i) => WOERTER[i % WOERTER.length]).join(" "),
  "",
  "<!-- image -->",
  "",
  "Hafen &amp; Stadt",
].join("\n");
const KAUDERWELSCH = Array.from({ length: 70 }, (_, i) =>
  ["Hfn", "Schff", "Ladng", "Kpitn", "Brcke"][i % 5],
).join(" ");

/** Der nachgemachte Docling: liest am letzten Byte, was die Seite ist, und zählt mit. */
const doclingAufrufe: number[] = [];
const deps = {
  doclingKonfiguriert: true,
  jevKonfiguriert: true,
  async docling(bytes: Uint8Array<ArrayBuffer>) {
    const art = bytes[2];
    doclingAufrufe.push(art);
    if (art === KAPUTT) throw new Error("Docling ist an dieser Seite gescheitert.");
    if (art === DRUCK_GETIPPT) {
      await pg.query(
        `update material_pages set transcript = 'Von Hand, während Docling rechnete.'
          where leser = 'offen' and transcript is null and image = $1`,
        [bild(DRUCK_GETIPPT)],
      );
    }
    return {
      markdown: art === DRUCK || art === DRUCK_GETIPPT ? DRUCKTEXT : KAUDERWELSCH,
      seconds: 3.5,
      status: "success",
    };
  },
  // Der nachgemachte Jev hält nur das Handout für sauber.
  async jevFrage(state: string) {
    return state.includes("Handout") ? 0.93 : 0.12;
  },
};

console.log("\n── 1. Altbestand: der Schutz der Altblätter gilt unverändert ──");
{
  const stand = await listPageActivity(leo, [altblatt.id, altMitRueckseite.id]);
  pruefe(
    "ein Altblatt nennt keine nachgereichte Seite",
    stand.get(altblatt.id)?.unreadAttachedPageIds.length === 0,
    stand.get(altblatt.id),
  );
  pruefe(
    "eine NULL-Seite nach dem Einordnen ist nachgereicht",
    JSON.stringify(stand.get(altMitRueckseite.id)?.unreadAttachedPageIds) ===
      JSON.stringify([altMitRueckseite.pages[1]]),
    stand.get(altMitRueckseite.id),
  );
}

console.log("\n── 2. Eine Claude-Seite an einem eingeordneten Blatt ist immer nachgereicht ──");
const claudeBlatt = await blatt(leo, geo, {
  filedAt: new Date(),
  seiten: [{ art: HANDSCHRIFT, leser: "claude", vorMs: 60_000 }],
});
{
  const stand = await listPageActivity(leo, [claudeBlatt.id]);
  pruefe(
    "auch älter als das Einordnen und ohne ältere gelesene Seite",
    stand.get(claudeBlatt.id)?.unreadAttachedPageIds[0] === claudeBlatt.pages[0],
    stand.get(claudeBlatt.id),
  );
}

console.log("\n── 3. Offene und Docling-Seiten sind nie nachgereicht ──");
const nieBlatt = await blatt(leo, geo, {
  filedAt: new Date(Date.now() - 120_000),
  seiten: [
    { art: DRUCK, leser: "docling" },
    { art: DRUCK, leser: "offen" },
  ],
});
{
  const stand = await listPageActivity(leo, [nieBlatt.id]);
  pruefe(
    "keine der beiden Seiten",
    stand.get(nieBlatt.id)?.unreadAttachedPageIds.length === 0,
    stand.get(nieBlatt.id),
  );
  pruefe("die offene Seite wird gezählt", stand.get(nieBlatt.id)?.offenPages === 1, stand.get(nieBlatt.id));
  const liste = await listMaterials(leo, { nachgereicht: true });
  pruefe(
    "read_material {nachgereicht} nennt das Blatt nicht",
    !liste.some((b) => b.id === nieBlatt.id),
    liste.map((b) => b.id),
  );
  pruefe(
    "nennt aber das Blatt mit der Claude-Seite",
    liste.some((b) => b.id === claudeBlatt.id),
    liste.map((b) => b.id),
  );
  // Aufräumen: die offene Seite soll die Zuteilung unten nicht mitzählen.
  await probe.delete(schema.materialPages).where(eq(schema.materialPages.id, nieBlatt.pages[1]));
}

console.log("\n── 4. Die Kennzeichnung folgt dem Text ──");
const kennBlatt = await blatt(leo, geo, {
  filedAt: new Date(),
  seiten: [
    { art: DRUCK, leser: "docling" },
    { art: DRUCK, leser: "docling" },
  ],
});
{
  await setMaterialTranscripts(leo, kennBlatt.id, [{ pageId: kennBlatt.pages[1], text: "Von Hand." }]);
  const n = await setMaterialTranscripts(
    leo,
    kennBlatt.id,
    [
      { pageId: kennBlatt.pages[0], text: "Maschinell gelesen." },
      { pageId: kennBlatt.pages[1], text: "Maschinell drüber." },
    ],
    { nurUngelesene: true, maschinell: true },
  );
  pruefe("maschinell + nurUngelesene schreibt nur die leere Seite", n === 1, n);
  let a = await seite(kennBlatt.pages[0]);
  const b = await seite(kennBlatt.pages[1]);
  pruefe("sie ist maschinell", a.maschinell && a.transcript === "Maschinell gelesen.", a);
  pruefe("die von Hand bleibt, wie sie war", !b.maschinell && b.transcript === "Von Hand.", b);

  // Das Formular schickt jede Seite mit, auch die unberührte.
  await setMaterialTranscripts(leo, kennBlatt.id, [
    { pageId: kennBlatt.pages[0], text: "Maschinell gelesen." },
    { pageId: kennBlatt.pages[1], text: "Von Hand." },
  ]);
  a = await seite(kennBlatt.pages[0]);
  pruefe("gleicher Text ohne Option behält die Kennzeichnung", a.maschinell, a);

  await setMaterialTranscripts(leo, kennBlatt.id, [
    { pageId: kennBlatt.pages[0], text: "Maschinell gelesen, verbessert." },
  ]);
  a = await seite(kennBlatt.pages[0]);
  pruefe("geänderter Text ist nicht mehr maschinell", !a.maschinell, a);

  // Das Formular schickt jeden Zeilenumbruch als CRLF (multipart/form-data).
  // Derselbe Text mit CRLF ist derselbe Text — sonst verlöre eine
  // Docling-Seite ihre Kennzeichnung, sobald jemand den Titel speichert.
  const crlfBlatt = await blatt(leo, geo, { seiten: [{ art: DRUCK, leser: "docling" }] });
  await setMaterialTranscripts(
    leo,
    crlfBlatt.id,
    [{ pageId: crlfBlatt.pages[0], text: "Zeile eins\n\nZeile zwei" }],
    { nurUngelesene: true, maschinell: true },
  );
  await setMaterialTranscripts(leo, crlfBlatt.id, [
    { pageId: crlfBlatt.pages[0], text: "Zeile eins\r\n\r\nZeile zwei\r\n" },
  ]);
  const crlf = await seite(crlfBlatt.pages[0]);
  pruefe(
    "derselbe Text mit CRLF behält die Kennzeichnung und bleibt LF",
    crlf.maschinell && crlf.transcript === "Zeile eins\n\nZeile zwei",
    crlf,
  );

  const transkripte = await listMaterialTranscripts(leo, kennBlatt.id);
  pruefe(
    "listMaterialTranscripts reicht maschinell durch",
    transkripte.every((t) => typeof t.maschinell === "boolean"),
    transkripte,
  );
  const detail = await getMaterial(leo, kennBlatt.id);
  pruefe(
    "getMaterial nennt leser und maschinell je Seite",
    detail?.pages.every((p) => p.leser === "docling" && typeof p.maschinell === "boolean") === true,
    detail?.pages,
  );
}

console.log("\n── 5. Die Entscheidung steht nur einmal fest ──");
const festBlatt = await blatt(leo, geo, { seiten: [{ art: DRUCK, leser: "offen" }] });
{
  const fremdeHand = await leserFestlegen(fremd, festBlatt.pages[0], {
    leser: "claude",
    grund: grundOhneMessung("fehler"),
    doclingText: null,
  });
  pruefe("ein fremder Nutzer legt nichts fest", !fremdeHand);
  const erst = await leserFestlegen(leo, festBlatt.pages[0], {
    leser: "claude",
    grund: grundOhneMessung("docling-fehlt"),
    doclingText: null,
  });
  const dann = await leserFestlegen(leo, festBlatt.pages[0], {
    leser: "docling",
    grund: grundOhneMessung("sauber"),
    doclingText: "x",
  });
  pruefe("aus 'offen' geht es", erst);
  pruefe("ein zweites Mal nicht", !dann);
  const s = await seite(festBlatt.pages[0]);
  pruefe("es bleibt bei der ersten Entscheidung", s.leser === "claude" && s.leserGrund?.grund === "docling-fehlt", s);
}

console.log("\n── 6. Ein Vorschlag der App entsteht nur einmal ──");
const einmalBlatt = await blatt(leo, geo, { seiten: [{ art: DRUCK, leser: "docling" }] });
{
  const eingabe = proposalInputSchema.parse({ title: "Einmal" });
  const erster = await createProposal(leo, einmalBlatt.id, eingabe, "app", { nurOhneVorschlag: true });
  const zweiter = await createProposal(leo, einmalBlatt.id, eingabe, "app", { nurOhneVorschlag: true });
  const fremder = await createProposal(fremd, einmalBlatt.id, eingabe, "app", { nurOhneVorschlag: true });
  pruefe("der erste entsteht", erster !== null, erster);
  pruefe("der zweite nicht", zweiter === null, zweiter);
  pruefe("ein fremder Nutzer legt keinen an", fremder === null, fremder);
  const korb = await listInbox(leo);
  const eintrag = korb.find((e) => e.id === einmalBlatt.id);
  pruefe(
    "der Korb nennt ihn mit Herkunft 'app'",
    eintrag?.proposals.length === 1 && eintrag.proposals[0]?.origin === "app",
    eintrag?.proposals,
  );
  // Ohne die Option legt der Postbote weiter an, wie bisher.
  const agent = await createProposal(leo, einmalBlatt.id, eingabe, "agent");
  pruefe("ohne die Option entsteht einer wie bisher", agent !== null, agent);
}

console.log("\n── 7. Die Zuteilung ──");

// a) Ein gemischtes Blatt im Korb: Druck, Handschrift, eine Seite, an der
//    Docling scheitert. Zweimal gleichzeitig angestoßen.
const gemischt = await blatt(leo, geo, {
  seiten: [
    { art: DRUCK, leser: "offen", vorMs: 120_000 },
    { art: HANDSCHRIFT, leser: "offen", vorMs: 120_000 },
    { art: KAPUTT, leser: "offen", vorMs: 120_000 },
  ],
});
{
  doclingAufrufe.length = 0;
  await Promise.all([zuteilungLaufen(leo, deps), zuteilungLaufen(leo, deps)]);
  pruefe(
    "zwei gleichzeitige Anstöße: Docling je Seite genau einmal",
    doclingAufrufe.length === 3,
    doclingAufrufe,
  );

  const druck = await seite(gemischt.pages[0]);
  pruefe(
    "Druck: Docling liest, Abschrift steht, maschinell",
    druck.leser === "docling" &&
      druck.maschinell &&
      druck.transcript?.startsWith("Handout Containerschifffahrt") === true &&
      druck.transcript.includes("⟨Bild⟩") &&
      druck.transcript.includes("Hafen & Stadt"),
    druck,
  );
  pruefe(
    "Druck: der Grund ist festgehalten",
    druck.leserGrund?.grund === "sauber" &&
      druck.leserGrund.jev === 0.93 &&
      druck.leserGrund.woerter === 85 &&
      druck.leserGrund.regel === 1,
    druck.leserGrund,
  );

  const hand = await seite(gemischt.pages[1]);
  pruefe(
    "Handschrift: Claude liest, keine Abschrift, Doclings Text gespeichert",
    hand.leser === "claude" &&
      hand.transcript === null &&
      !hand.maschinell &&
      hand.doclingText === KAUDERWELSCH &&
      hand.leserGrund?.grund === "jev-unsicher",
    hand,
  );

  const kaputt = await seite(gemischt.pages[2]);
  pruefe(
    "Docling-Fehler: Claude liest",
    kaputt.leser === "claude" && kaputt.leserGrund?.grund === "docling-fehler" && kaputt.doclingText === null,
    kaputt,
  );

  const stand = await korbblattStand(leo, gemischt.id);
  pruefe(
    "ein gemischtes Blatt bekommt keinen Vorschlag der App",
    stand?.vorschlaege === 0 && stand.ungelesen === 2 && stand.maschinell === 1,
    stand,
  );

  doclingAufrufe.length = 0;
  await zuteilungLaufen(leo, deps);
  pruefe("ein dritter Lauf fasst nichts mehr an", doclingAufrufe.length === 0, doclingAufrufe);
}

// b) Die Notbremse.
{
  process.env.LESER_REGEL = "aus";
  const id = await createMaterialWithPage(
    leo,
    { subjectId: geo, title: "Notbremse", capturedOn: "2026-10-01", note: null },
    { ...SEITE, image: bild(DRUCK), reading: bild(DRUCK), thumb: bild(DRUCK) },
  );
  const detail = await getMaterial(leo, id);
  pruefe("beim Anlegen gleich 'claude'", detail?.pages[0]?.leser === "claude", detail?.pages);

  const nochOffen = await blatt(leo, geo, { seiten: [{ art: DRUCK, leser: "offen" }] });
  doclingAufrufe.length = 0;
  await zuteilungLaufen(leo, deps);
  const s = await seite(nochOffen.pages[0]);
  pruefe("eine offene Seite geht an Claude, Grund 'aus'", s.leser === "claude" && s.leserGrund?.grund === "aus", s);
  pruefe("Docling wurde nie gefragt", doclingAufrufe.length === 0, doclingAufrufe);
  delete process.env.LESER_REGEL;

  const normal = await createMaterialWithPage(
    leo,
    { subjectId: geo, title: "Normal", capturedOn: "2026-10-01", note: null },
    { ...SEITE, image: bild(HANDSCHRIFT), reading: bild(HANDSCHRIFT), thumb: bild(HANDSCHRIFT) },
  );
  const normalDetail = await getMaterial(leo, normal);
  pruefe("ohne Notbremse beginnt eine neue Seite offen", normalDetail?.pages[0]?.leser === "offen", normalDetail?.pages);
  // Gleich entscheiden lassen, damit die nächsten Proben sie nicht mitzählen.
  await zuteilungLaufen(leo, deps);
}

// c) Ein reines Docling-Blatt im Korb, dessen Ruhe um ist.
const rein = await blatt(leo, geo, {
  capturedOn: "2026-10-02",
  seiten: [
    { art: DRUCK, leser: "offen", vorMs: 120_000 },
    { art: DRUCK, leser: "offen", vorMs: 120_000 },
  ],
});
{
  await zuteilungLaufen(leo, deps);
  let korb = await listInbox(leo);
  let eintrag = korb.find((e) => e.id === rein.id);
  pruefe(
    "genau ein Vorschlag, von der App",
    eintrag?.proposals.length === 1 && eintrag.proposals[0]?.origin === "app",
    eintrag?.proposals,
  );
  pruefe(
    "Titel aus der ersten Überschrift, keine Abschrift im Vorschlag",
    eintrag?.proposals[0]?.title === "Handout Containerschifffahrt" &&
      eintrag.proposals[0].transcriptCount === 0,
    eintrag?.proposals[0],
  );
  pruefe("ohne Jev-Schlüssel bleibt er im Korb", eintrag?.filedAt === null, eintrag?.filedAt);

  // Eine weitere Druckseite am selben Blatt: entschieden wird sie, ein
  // zweiter Vorschlag entsteht nicht.
  const [dritte] = await probe
    .insert(schema.materialPages)
    .values({
      materialId: rein.id,
      sortOrder: 2,
      ...SEITE,
      byteSize: 3,
      image: bild(DRUCK),
      reading: bild(DRUCK),
      thumb: bild(DRUCK),
      createdAt: new Date(Date.now() - 120_000),
    })
    .returning({ id: schema.materialPages.id });
  await zuteilungLaufen(leo, deps);
  const s = await seite(dritte.id);
  korb = await listInbox(leo);
  eintrag = korb.find((e) => e.id === rein.id);
  pruefe("die dritte Seite liest Docling", s.leser === "docling" && s.maschinell, s);
  pruefe("ein zweiter Lauf legt keinen zweiten Vorschlag an", eintrag?.proposals.length === 1, eintrag?.proposals);

  const aktiv = await listPageActivity(leo, [rein.id]);
  pruefe("der Korb zählt drei maschinelle Seiten", aktiv.get(rein.id)?.maschinellPages === 3, aktiv.get(rein.id));
}

// d) Ein frisches reines Docling-Blatt wartet die Ruhe ab.
const frisch = await blatt(leo, geo, { seiten: [{ art: DRUCK, leser: "offen" }] });
{
  await zuteilungLaufen(leo, deps);
  const [anzahl] = await probe
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.materialProposals)
    .where(and(eq(schema.materialProposals.materialId, frisch.id)));
  pruefe("vor der Ruhe kein Vorschlag", anzahl?.n === 0, anzahl);

  // Den Wecker abstellen: er stieße in 20 s eine Zuteilung OHNE die Fakes an,
  // mitten in die Proben unten.
  const wecker = (globalThis as unknown as {
    __schulappLeser: { timer: Map<string, ReturnType<typeof setTimeout>> };
  }).__schulappLeser.timer;
  pruefe("der Wecker für die Ruhe ist gestellt", wecker.size >= 1, wecker.size);
  for (const t of wecker.values()) clearTimeout(t);
  wecker.clear();
}

// e) Offene Seiten, die schon gelesen sind: Docling wird nicht gefragt.
{
  const schonBlatt = await blatt(leo, geo, {
    filedAt: new Date(),
    seiten: [
      { art: DRUCK, leser: "offen" },
      { art: DRUCK, leser: "offen" },
    ],
  });
  // Seite 1: von Hand abgetippt, bevor die App entschied (oder vom alten
  // Postboten im Deploy-Fenster). Seite 2: Doclings Abschrift steht schon,
  // nur die Entscheidung fehlt — ein Abbruch zwischen den beiden Schritten.
  await pg.query(`update material_pages set transcript = 'Von Hand.' where id = $1`, [
    schonBlatt.pages[0],
  ]);
  await pg.query(
    `update material_pages set transcript = 'Doclings Abschrift.', maschinell = true where id = $1`,
    [schonBlatt.pages[1]],
  );
  doclingAufrufe.length = 0;
  await zuteilungLaufen(leo, deps);
  const hand = await seite(schonBlatt.pages[0]);
  const nach = await seite(schonBlatt.pages[1]);
  pruefe("Docling wird für gelesene Seiten nicht gefragt", doclingAufrufe.length === 0, doclingAufrufe);
  pruefe(
    "von Hand gelesen: claude, schon-gelesen, Abschrift unberührt",
    hand.leser === "claude" &&
      hand.leserGrund?.grund === "schon-gelesen" &&
      hand.transcript === "Von Hand." &&
      !hand.maschinell,
    hand,
  );
  pruefe(
    "Doclings Abschrift ohne Entscheidung: docling, nachgeholt, maschinell bleibt",
    nach.leser === "docling" &&
      nach.leserGrund?.grund === "nachgeholt" &&
      nach.transcript === "Doclings Abschrift." &&
      nach.maschinell,
    nach,
  );
}

// f) Während Docling rechnet, tippt jemand die Seite ab: die App schreibt
//    nichts und behauptet nicht 'docling'.
{
  const getipptBlatt = await blatt(leo, geo, {
    filedAt: new Date(),
    seiten: [{ art: DRUCK_GETIPPT, leser: "offen" }],
  });
  doclingAufrufe.length = 0;
  await zuteilungLaufen(leo, deps);
  const s = await seite(getipptBlatt.pages[0]);
  pruefe("Docling hat gerechnet", doclingAufrufe.length === 1, doclingAufrufe);
  pruefe(
    "die getippte Abschrift bleibt, leser claude (schon-gelesen), Messung und Rohtext bleiben",
    s.leser === "claude" &&
      s.leserGrund?.grund === "schon-gelesen" &&
      s.leserGrund.jev === 0.93 &&
      s.transcript === "Von Hand, während Docling rechnete." &&
      !s.maschinell &&
      s.doclingText === DRUCKTEXT,
    s,
  );
}

// g) Ein Fehler, nach dem die Seite nicht einmal für Claude festgehalten
//    werden kann (die Datenbank weist jedes Festlegen ab): sie ruht, statt bei
//    jedem Anstoß von vorn zu beginnen — und bekommt danach einen Versuch.
{
  const klemmBlatt = await blatt(leo, geo, {
    filedAt: new Date(),
    seiten: [{ art: HANDSCHRIFT, leser: "offen" }],
  });
  const id = klemmBlatt.pages[0];
  await pg.exec(`
    create function probe_klemmt() returns trigger language plpgsql as $$
    begin raise exception 'Probe: die Datenbank ist weg'; end $$;
    create trigger probe_klemmt before update on material_pages
      for each row when (old.id = '${id}') execute function probe_klemmt();
  `);
  const fehlerVorher = console.error;
  console.error = () => {};
  doclingAufrufe.length = 0;
  await zuteilungLaufen(leo, deps);
  await zuteilungLaufen(leo, deps);
  console.error = fehlerVorher;
  let s = await seite(id);
  pruefe("sie bleibt offen", s.leser === "offen", s);
  pruefe(
    "der zweite Anstoß gleich danach rechnet sie nicht noch einmal",
    doclingAufrufe.length === 1,
    doclingAufrufe,
  );

  await pg.exec(`drop trigger probe_klemmt on material_pages; drop function probe_klemmt();`);
  // Die Ruhe vorspulen, statt zehn Minuten zu warten.
  const prozess = (globalThis as unknown as {
    __schulappLeser: { gescheitert: Map<string, number> };
  }).__schulappLeser;
  pruefe("sie ruht", prozess.gescheitert.has(id), [...prozess.gescheitert.keys()]);
  prozess.gescheitert.set(id, Date.now() - ZWEITER_VERSUCH_MS - 1);
  doclingAufrufe.length = 0;
  await zuteilungLaufen(leo, deps);
  s = await seite(id);
  pruefe(
    "nach der Ruhe ein neuer Versuch, dann entschieden",
    doclingAufrufe.length === 1 && s.leser === "claude" && s.leserGrund?.grund === "jev-unsicher",
    { doclingAufrufe, s },
  );
}

console.log("\n── 8. Die Tür propose_sheet ──");
{
  const [leoZeile] = await probe.select().from(schema.users).where(eq(schema.users.id, leo));
  const tuer = await blatt(leo, geo, {
    seiten: [
      { art: DRUCK, leser: "docling" },
      { art: HANDSCHRIFT, leser: "claude" },
      { art: DRUCK, leser: "offen" },
    ],
  });
  await setMaterialTranscripts(
    leo,
    tuer.id,
    [{ pageId: tuer.pages[0], text: "Erfundener Drucktext." }],
    { nurUngelesene: true, maschinell: true },
  );

  const gemischtAntwort = await callTool(leoZeile, "propose_sheet", {
    sheet: tuer.id,
    title: "Vulkane",
    transcripts: [
      { page: tuer.pages[0], text: "zweite Lesung der Druckseite" },
      { page: tuer.pages[1], text: "Erfundene Handschrift." },
      { page: tuer.pages[2], text: "zu früh" },
    ],
  });
  const d =
    gemischtAntwort.art === "daten"
      ? (gemischtAntwort.daten as { id: string; verworfen: { page: string; grund: string }[] })
      : null;
  pruefe(
    "gemischt: kein Fehler, Docling- und offene Seite verworfen",
    d !== null &&
      JSON.stringify(d.verworfen) ===
        JSON.stringify([
          { page: tuer.pages[0], grund: "docling" },
          { page: tuer.pages[2], grund: "offen" },
        ]),
    gemischtAntwort,
  );
  const imVorschlag = await pg.query<{ page_id: string }>(
    `select page_id from material_proposal_transcripts where proposal_id = $1`,
    [d?.id],
  );
  pruefe(
    "gemischt: im Vorschlag nur die Claude-Seite",
    imVorschlag.rows.length === 1 && imVorschlag.rows[0].page_id === tuer.pages[1],
    imVorschlag.rows,
  );
  const druck = await seite(tuer.pages[0]);
  pruefe(
    "die Docling-Abschrift steht unverändert und maschinell",
    druck.transcript === "Erfundener Drucktext." && druck.maschinell,
    druck,
  );

  const nurDocling = await callTool(leoZeile, "propose_sheet", {
    sheet: tuer.id,
    transcripts: [{ page: tuer.pages[0], text: "noch einmal gelesen" }],
  });
  pruefe(
    "nur Verworfenes: Antwort statt Fehler, id null",
    nurDocling.art === "daten" && (nurDocling.daten as { id: unknown }).id === null,
    nurDocling,
  );
  const kaputt = await callTool(leoZeile, "propose_sheet", {
    sheet: tuer.id,
    captured_on: "2026-13-45",
    transcripts: [{ page: tuer.pages[0], text: "noch einmal" }],
  });
  pruefe("verworfen und ein kaputtes Datum: bleibt ein Fehler", kaputt.art === "fehler", kaputt);
}

console.log("\n── 9. Löschen kann ein Blatt zum reinen Docling-Blatt machen ──");
{
  const loeschBlatt = await blatt(leo, geo, {
    seiten: [
      { art: DRUCK, leser: "docling", vorMs: 120_000 },
      { art: HANDSCHRIFT, leser: "claude", vorMs: 120_000 },
    ],
  });
  await setMaterialTranscripts(
    leo,
    loeschBlatt.id,
    [{ pageId: loeschBlatt.pages[0], text: "Erfundener Drucktext." }],
    { nurUngelesene: true, maschinell: true },
  );
  pruefe("ohne Löschen kein Vorschlag der App", (await korbblattStand(leo, loeschBlatt.id))?.ungelesen === 1);
  pruefe("gelöscht", (await deletePage(leo, loeschBlatt.pages[1])) === "geloescht");
  korbblattAnstossen(leo, loeschBlatt.id);
  await zuteilungLaufen(leo, deps);
  const korb = await listInbox(leo);
  const eintrag = korb.find((e) => e.id === loeschBlatt.id);
  pruefe(
    "danach genau ein Vorschlag, von der App",
    eintrag?.proposals.length === 1 && eintrag.proposals[0]?.origin === "app",
    eintrag?.proposals,
  );
}

console.log(`\n${proben - fehler} von ${proben} Proben bestanden.`);
process.exit(fehler === 0 ? 0 : 1);
