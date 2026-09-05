/**
 * Ein Rauchtest für die drei neuen Abschrift-Funktionen — gegen eine ECHTE
 * Datenbank und nicht gegen Typen.
 *
 * Warum es ihn gibt: `setMaterialTranscripts()`, `listMaterialTranscripts()`
 * und `listMaterialsWithTranscripts()` lesen und schreiben, und für schreibende
 * Funktionen hat dieses Projekt keine automatischen Tests — es gibt keinen
 * Testlauf mit Datenbank. Zwei Dinge darin gab es im Projekt vorher überhaupt
 * nicht: eine korrelierte `exists`-Unterabfrage und ein Zeilenvergleich
 * `(a, b, c) > (…)` als Cursor. Beides ist am gerenderten SQL nachgelesen und
 * war bis hierher nie ausgeführt.
 *
 * Die Datenbank ist eine eigene, frisch angelegte — nicht `.data/pglite`. Sie
 * wird über `globalThis.__schulappDb` untergeschoben, bevor irgendetwas aus
 * @/lib/materials geladen wird; `getDatabase()` in @/db nimmt sie dann statt
 * eine eigene zu öffnen.
 *
 * Zwei Schritte, und der erste ist der, den man vergisst — die Probe-Datenbank
 * ist leer und braucht erst das Schema:
 *
 *   cat > drizzle.probe.config.ts <<'EOF'
 *   import { defineConfig } from "drizzle-kit";
 *   export default defineConfig({
 *     schema: "./src/db/schema.ts", out: "/tmp/probe-out", dialect: "postgresql",
 *     driver: "pglite" as const, dbCredentials: { url: "/tmp/probe-db" },
 *   });
 *   EOF
 *   npx drizzle-kit push --config=drizzle.probe.config.ts --force
 *   rm -f drizzle.probe.config.ts
 *   npx tsx scripts/probe-abschrift.mts /tmp/probe-db
 *
 * Das Verzeichnis darf danach weg. Es DARF NICHT `.data/pglite` sein: die Probe
 * legt Nutzer, Fächer und siebzig Blätter an und wäre in der eigenen Datenbank
 * kein Test, sondern ein Schaden.
 *
 * Am 5.9.2026 einmal gelaufen: 22 Proben, alle bestanden. Gefunden hat der Lauf
 * dabei genau einen Fehler, und der lag im Test — die Option heißt `after` und
 * nicht `cursor`, und weil `tsx` keine Typen prüft, wurde der unbekannte Name
 * stillschweigend ignoriert und der Cursor bewegte sich nie. Ein Rauchtest, der
 * nur Typen prüft, hätte genau das nicht gefunden.
 *
 * **Und einen Fehler hat er NICHT gefunden — Probe 9 ist die Lehre daraus.**
 * Probe 7 dreht sechzig Blätter über eine Rundengrenze und war grün, während
 * der Cursor an genau dieser Grenze jedes Mal ein Blatt doppelt herausgab. Der
 * Grund ist die Probe-Datenbank selbst: PGlites `now()` setzt nur
 * Millisekunden, echtes Postgres setzt Mikrosekunden, und verloren gingen genau
 * die drei Stellen, die es hier nie gab. Wer gegen PGlite prüft, prüft die
 * Genauigkeit von PGlite mit — was in Produktion feiner ist als hier, gehört
 * deshalb von Hand gesetzt und nicht der Datenbank überlassen.
 *
 * Probe 9 wurde am 5.9.2026 zuerst gegen den ALTEN Stand gefahren und war rot,
 * und zwar schlimmer als erwartet: der Cursor rückte überhaupt nicht mehr vor
 * — dieselben zwei Blätter kamen sieben Runden lang wieder, das dritte nie, und
 * der zurückgegebene Cursor war ein `Date` ohne jede Nachkommastelle („Wed Sep
 * 02 2026 12:00:00 GMT+0200"). Nach der Reparatur: 32 Proben, alle bestanden.
 */

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";

const verzeichnis = process.argv[2];
if (!verzeichnis) {
  console.error("Aufruf: npx tsx scripts/probe-abschrift.mts <verzeichnis>");
  process.exit(1);
}

const probe = drizzle(new PGlite(verzeichnis), { schema });
(globalThis as unknown as { __schulappDb?: unknown }).__schulappDb = probe;

const {
  setMaterialTranscripts,
  listMaterialTranscripts,
  listMaterialsWithTranscripts,
  getMaterial,
} = await import("@/lib/materials");

let fehler = 0;
function pruefe(name: string, bedingung: boolean, gesehen?: unknown) {
  if (bedingung) {
    console.log(`  ✓ ${name}`);
  } else {
    fehler += 1;
    console.log(`  ✗ ${name}`);
    if (gesehen !== undefined) console.log(`      gesehen: ${JSON.stringify(gesehen)}`);
  }
}

const bytes = Buffer.from([0xff, 0xd8, 0xff]);

async function nutzer(name: string): Promise<string> {
  const [zeile] = await probe
    .insert(schema.users)
    .values({ name, passwordHash: "x" })
    .returning({ id: schema.users.id });
  return zeile.id;
}

async function fach(userId: string, name: string): Promise<string> {
  const [zeile] = await probe
    .insert(schema.subjects)
    .values({ userId, name, short: name.slice(0, 2), color: "blue" })
    .returning({ id: schema.subjects.id });
  return zeile.id;
}

async function blatt(
  userId: string,
  subjectId: string,
  title: string,
  capturedOn: string,
  seiten: number,
): Promise<{ id: string; pages: string[] }> {
  const [zeile] = await probe
    .insert(schema.materials)
    .values({ userId, subjectId, title, capturedOn })
    .returning({ id: schema.materials.id });

  const pages: string[] = [];
  for (let i = 0; i < seiten; i += 1) {
    const [seite] = await probe
      .insert(schema.materialPages)
      .values({
        materialId: zeile.id,
        sortOrder: i,
        mimeType: "image/jpeg",
        width: 100,
        height: 100,
        byteSize: bytes.length,
        image: bytes,
        reading: bytes,
        thumb: bytes,
      })
      .returning({ id: schema.materialPages.id });
    pages.push(seite.id);
  }

  return { id: zeile.id, pages };
}

console.log("\n── Aufbau ──");
const leo = await nutzer("Leo");
const fremd = await nutzer("Jemand anderes");
const geo = await fach(leo, "Geografie");
const fremdesFach = await fach(fremd, "Geografie");

const dreiseiter = await blatt(leo, geo, "Vulkanismus", "2026-08-25", 3);
const fremdesBlatt = await blatt(fremd, fremdesFach, "Fremd", "2026-08-25", 1);
console.log(`  Blatt mit ${dreiseiter.pages.length} Seiten, dazu ein fremdes.`);

console.log("\n── 1. Ein fremdes Blatt lässt sich nicht beschreiben ──");
{
  const n = await setMaterialTranscripts(leo, fremdesBlatt.id, [
    { pageId: fremdesBlatt.pages[0], text: "eingeschmuggelt" },
  ]);
  pruefe("schreibt 0 Seiten", n === 0, n);
  const nach = await listMaterialTranscripts(fremd, fremdesBlatt.id);
  pruefe("die fremde Seite ist unberührt", nach[0]?.transcript === null, nach);
}

console.log("\n── 2. Eine fremde Seite am eigenen Blatt geht nicht durch ──");
{
  const n = await setMaterialTranscripts(leo, dreiseiter.id, [
    { pageId: fremdesBlatt.pages[0], text: "eingeschmuggelt" },
  ]);
  pruefe("schreibt 0 Seiten", n === 0, n);
}

console.log("\n── 3. Der leere String bleibt der leere String ──");
{
  await setMaterialTranscripts(leo, dreiseiter.id, [
    { pageId: dreiseiter.pages[0], text: "Der Vulkanismus bezeichnet ⟨alle⟩ Vorgänge." },
    { pageId: dreiseiter.pages[1], text: "" },
  ]);
  const nach = await listMaterialTranscripts(leo, dreiseiter.id);
  pruefe("Seite 1 trägt den Text", nach[0]?.transcript?.startsWith("Der Vulkanismus") === true, nach[0]);
  pruefe('Seite 2 ist "" und nicht null', nach[1]?.transcript === "", nach[1]);
  pruefe("Seite 3 ist unberührt null", nach[2]?.transcript === null, nach[2]);
  pruefe("die Reihenfolge stimmt", nach.map((s) => s.sortOrder).join() === "0,1,2", nach.map((s) => s.sortOrder));
}

console.log("\n── 4. Ungenannte Seiten bleiben stehen ──");
{
  const n = await setMaterialTranscripts(leo, dreiseiter.id, [
    { pageId: dreiseiter.pages[2], text: "Dritte Seite." },
  ]);
  pruefe("schreibt genau 1 Seite", n === 1, n);
  const nach = await listMaterialTranscripts(leo, dreiseiter.id);
  pruefe("Seite 1 steht noch", nach[0]?.transcript?.startsWith("Der Vulkanismus") === true, nach[0]);
  pruefe('Seite 2 ist weiterhin ""', nach[1]?.transcript === "", nach[1]);
  pruefe("Seite 3 trägt jetzt Text", nach[2]?.transcript === "Dritte Seite.", nach[2]);
}

console.log("\n── 5. getMaterial() nennt die Länge, nicht den Text ──");
{
  const m = await getMaterial(leo, dreiseiter.id);
  const laengen = m?.pages.map((s) => s.transcriptLength);
  pruefe("drei Seiten mit Längen", laengen?.length === 3, laengen);
  pruefe("Seite 1 hat eine Länge > 0", (laengen?.[0] ?? 0) > 0, laengen?.[0]);
  pruefe("Seite 2 hat Länge 0 (gelesen, leer)", laengen?.[1] === 0, laengen?.[1]);
  pruefe("Seite 3 hat eine Länge > 0", (laengen?.[2] ?? 0) > 0, laengen?.[2]);
}

console.log("\n── 6. Der Export filtert auf Blätter MIT Abschrift ──");
{
  await blatt(leo, geo, "Ohne Abschrift", "2026-08-26", 1);
  const seite = await listMaterialsWithTranscripts(leo, geo);
  pruefe("genau ein Blatt", seite.sheets.length === 1, seite.sheets.map((b) => b.title));
  pruefe("und zwar das mit Abschrift", seite.sheets[0]?.title === "Vulkanismus", seite.sheets[0]?.title);
  pruefe("mit allen drei Seiten", seite.sheets[0]?.pages.length === 3, seite.sheets[0]?.pages.length);
  pruefe("das Fach ist dabei", seite.sheets[0]?.subject.name === "Geografie", seite.sheets[0]?.subject);
}

console.log("\n── 7. Der Cursor überspringt und wiederholt nichts (60 Blätter) ──");
{
  const viele = await fach(leo, "Viele");
  for (let i = 0; i < 60; i += 1) {
    const b = await blatt(leo, viele, `Blatt ${i}`, "2026-09-01", 1);
    await setMaterialTranscripts(leo, b.id, [{ pageId: b.pages[0], text: `Nr ${i}` }]);
  }

  const gesehen: string[] = [];
  let after: Awaited<ReturnType<typeof listMaterialsWithTranscripts>>["next"] = null;
  let runden = 0;
  for (;;) {
    const seite = await listMaterialsWithTranscripts(
      leo,
      viele,
      after ? { after } : undefined,
    );
    runden += 1;
    gesehen.push(...seite.sheets.map((b) => b.id));
    if (!seite.next || runden > 5) break;
    after = seite.next;
  }

  pruefe("in zwei Runden gelesen", runden === 2, runden);
  pruefe("60 Blätter zusammen", gesehen.length === 60, gesehen.length);
  pruefe("alle verschieden", new Set(gesehen).size === 60, new Set(gesehen).size);
}

console.log("\n── 8. Ein fremder Nutzer sieht nichts ──");
{
  const seite = await listMaterialsWithTranscripts(fremd, geo);
  pruefe("kein Blatt aus fremdem Fach", seite.sheets.length === 0, seite.sheets.length);
  const nach = await listMaterialTranscripts(fremd, dreiseiter.id);
  pruefe("keine Abschrift aus fremdem Blatt", nach.length === 0, nach.length);
}

console.log("\n── 9. Der Cursor überlebt Mikrosekunden (an der Rundengrenze) ──");
{
  // Der Fehler, den diese Probe festhält: `materials.created_at` ist in
  // Postgres mikrosekundengenau (`now()` setzt sechs Stellen), ein JS-`Date`
  // kann nur Millisekunden. Solange `TranscriptCursor.createdAt` ein `Date`
  // war, kam der Zeitstempel als `…123000` aus der Runde zurück, obwohl die
  // Zeile `…123456` trägt — der Cursor lag also VOR dem Blatt, das er
  // markiert, und `(captured_on, created_at, id) > (…)` liess genau dieses
  // Blatt in der nächsten Runde ein zweites Mal durch.
  //
  // Die Folgen waren keine Schönheitsfehler: die Wiki-Übergabe sammelt in
  // @/lib/wiki/collect.ts ohne Doppelungssperre, `assertUniqueIds()` warf, der
  // Nutzer wurde übersprungen — und bei einem einzigen Nutzer entstand gar kein
  // Ordner, für ALLE Fächer. Das Fach-PDF zählte die Doppelung gegen
  // `PDF_SHEET_LIMIT` und verlor dafür am Ende ein echtes Blatt, behauptete
  // aber, sauber an der Grenze abgeschnitten zu haben.
  //
  // Warum Probe 7 daneben grün blieb — und das ist der Grund, aus dem der
  // Fehler so lange stand: PGlites `now()` liefert nur Millisekunden, die
  // abgeschnittene Stelle ist dort also immer 0. Gegen echtes Postgres wäre
  // Probe 7 rot gewesen. Deshalb werden die Mikrosekunden hier von Hand per
  // rohem SQL gesetzt: SPEICHERN kann PGlite sie, es erzeugt sie nur nicht
  // selbst.
  const genau = await fach(leo, "Mikrosekunden");
  const stellen = ["123456", "123789", "987654"];
  const ids: string[] = [];

  for (const [i, mikro] of stellen.entries()) {
    const b = await blatt(leo, genau, `Mikro ${i}`, "2026-09-02", 1);
    await setMaterialTranscripts(leo, b.id, [
      { pageId: b.pages[0], text: `Nr ${i}` },
    ]);
    await probe.execute(
      sql`update materials set created_at = ${`2026-09-02 10:00:00.${mikro}+00`}::timestamptz where id = ${b.id}::uuid`,
    );
    ids.push(b.id);
  }

  // `limit: 2` bei drei Blättern desselben Schultags: die erste Runde ist voll
  // und endet mitten im Bestand — genau die Rundengrenze, an der der Fehler
  // zuschlug. Im echten Betrieb ist es dieselbe Grenze bei fünfzig Blättern,
  // nur dauert das Herstellen dort fünfzigmal so lang.
  const gesehen: string[] = [];
  let after: Awaited<ReturnType<typeof listMaterialsWithTranscripts>>["next"] =
    null;
  let runden = 0;
  let ersterCursor = "";

  for (;;) {
    const seite = await listMaterialsWithTranscripts(leo, genau, {
      limit: 2,
      after: after ?? undefined,
    });
    runden += 1;
    gesehen.push(...seite.sheets.map((b) => b.id));
    if (runden === 1) ersterCursor = String(seite.next?.createdAt ?? "");
    // Die Schranke ist Notwehr und keine Erwartung: rückt der Cursor gar nicht
    // vor, liefe diese Schleife ewig statt rot zu werden.
    if (!seite.next || runden > 6) break;
    after = seite.next;
  }

  pruefe(
    "der Cursor trägt die Mikrosekunden mit",
    ersterCursor.includes("123789"),
    ersterCursor,
  );
  pruefe("in zwei Runden gelesen", runden === 2, runden);
  pruefe("drei Blätter zusammen", gesehen.length === 3, gesehen.length);
  pruefe("alle verschieden", new Set(gesehen).size === 3, new Set(gesehen).size);
  pruefe(
    "in der Reihenfolge der Aufnahme",
    gesehen.join() === ids.join(),
    gesehen,
  );
}

console.log("\n── 10. Drei Blätter im selben Augenblick — die id entscheidet ──");
{
  // Die Gegenprobe zu 9, und der Fall, für den die id überhaupt als dritter
  // Schlüssel im Cursor steht: `created_at` steht auf `defaultNow()`, und das
  // ist in Postgres der Zeitpunkt der TRANSAKTION — zwei in derselben
  // Transaktion angelegte Blätter tragen denselben Wert bis auf die
  // Mikrosekunde. Fällt die Rundengrenze genau dazwischen, muss die id die
  // Reihenfolge entscheiden; täte sie es nicht, fehlte ein Blatt oder käme
  // doppelt. Probe 9 hätte diesen Fall NICHT gefunden: dort sind alle drei
  // Zeitstempel verschieden.
  const gleichzeitig = await fach(leo, "Gleichzeitig");
  const ids: string[] = [];

  for (let i = 0; i < 3; i += 1) {
    const b = await blatt(leo, gleichzeitig, `Gleich ${i}`, "2026-09-03", 1);
    await setMaterialTranscripts(leo, b.id, [
      { pageId: b.pages[0], text: `Nr ${i}` },
    ]);
    await probe.execute(
      sql`update materials set created_at = '2026-09-03 08:30:00.500000+00'::timestamptz where id = ${b.id}::uuid`,
    );
    ids.push(b.id);
  }

  const gesehen: string[] = [];
  let after: Awaited<ReturnType<typeof listMaterialsWithTranscripts>>["next"] =
    null;
  let runden = 0;

  for (;;) {
    const seite = await listMaterialsWithTranscripts(leo, gleichzeitig, {
      limit: 2,
      after: after ?? undefined,
    });
    runden += 1;
    gesehen.push(...seite.sheets.map((b) => b.id));
    if (!seite.next || runden > 6) break;
    after = seite.next;
  }

  pruefe("drei Blätter zusammen", gesehen.length === 3, gesehen.length);
  pruefe("alle verschieden", new Set(gesehen).size === 3, new Set(gesehen).size);
  // Bei gleichem Tag und gleichem Zeitpunkt bleibt nur die id, und Postgres
  // sortiert uuid nach Bytes — für die Schreibweise mit Bindestrichen ist das
  // dieselbe Reihenfolge wie die von JavaScript.
  pruefe(
    "sortiert nach der id",
    gesehen.join() === [...ids].sort().join(),
    gesehen,
  );
}

console.log(
  fehler === 0
    ? "\n✓ Alle Proben bestanden.\n"
    : `\n✗ ${fehler} Probe(n) fehlgeschlagen.\n`,
);
process.exit(fehler === 0 ? 0 : 1);
