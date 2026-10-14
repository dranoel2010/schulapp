/**
 * Doppelte Fotos (Abnahmerunde 16, Antwort 4): Eine Seite kommt beim Server
 * an, aber die Antwort nicht beim Handy (schwaches Mobilnetz). Der Browser
 * schickt sie dann noch einmal, mit derselben Kennung der Aufnahme. Der
 * Server erkennt sie (`material_pages.upload_key`) und gibt das vorhandene
 * Blatt zurück, statt ein zweites anzulegen oder die Seite zweimal anzuhängen.
 *
 * Hier geht die erste Anfrage jeder Aufnahme wirklich an den Server
 * (`route.fetch`), ihre Antwort wird danach verworfen (`route.abort`). Die
 * Wiederholung muss dasselbe Blatt mit derselben Seitenzahl zurückbekommen:
 *
 * 1. neues Blatt: ein Blatt mehr in der Liste, nicht zwei,
 * 2. „Seite dazu“: das Blatt hat eine Seite mehr, nicht zwei.
 *
 *   BASIS=http://localhost:3382 AUS=<ordner> node scripts/pruef-kombi/upload-wiederholt.mjs [390|360] [light|dark]
 *
 * Mit `GEGENPROBE=1` schickt die Prüfung die Wiederholung mit einer fremden
 * Kennung, wie eine App ohne diesen Schutz: dann muss sie rot werden.
 *
 * Saat wie ablauf-kamera.mjs (offener Ablauf nach dem Anmelden). Chrome mit
 * Testkamera, geprüft per `testkameraPruefen`; keine Berechtigungen erteilt.
 * Ohne Service Worker, damit `page.route` jede Anfrage sieht.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { anmelden, browserStarten, fehlerSammeln, kontext, Pruefung, ruhe, testkameraPruefen } from "./gemeinsam.mjs";

const groesse = process.argv[2] ?? "390";
const schema = process.argv[3] ?? "light";
const GEGENPROBE = process.env.GEGENPROBE === "1";
const AUS = process.env.AUS ?? "/tmp/kombi-upload-wiederholt";
fs.mkdirSync(AUS, { recursive: true });
const bild = (page, name) => page.screenshot({ path: path.join(AUS, `${name}-${groesse}-${schema}.png`) });
const p = new Pruefung(`Upload wiederholt ${groesse} ${schema}`);
const browser = await browserStarten();

const ctx = await kontext(browser, { groesse, schema, ohneSW: true });
const page = await ctx.newPage();
const fehler = fehlerSammeln(page);

/**
 * Die Antworten auf POST /api/blaetter. `verwerfen`: die nächste Anfrage geht
 * an den Server, ihre Antwort aber nicht an die Seite.
 */
const antworten = [];
let verwerfen = false;
await page.route("**/api/blaetter", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  const felder = route.request().postData() ?? "";
  const kennung = /name="aufnahme"\r\n\r\n([^\r]+)/.exec(felder)?.[1] ?? null;
  // Gegenprobe: die Wiederholung kommt mit fremder Kennung an, wie ohne Schutz
  const fremd = GEGENPROBE && !verwerfen && kennung;
  const antwort = fremd
    ? await route.fetch({ postData: Buffer.from(route.request().postDataBuffer().toString("latin1").replace(kennung, randomUUID()), "latin1") })
    : await route.fetch();
  const json = await antwort.json().catch(() => null);
  const weg = verwerfen;
  verwerfen = false;
  antworten.push({ weg, status: antwort.status(), id: json?.id ?? null, seiten: json?.seiten ?? null, kennung });
  if (weg) return route.abort("connectionreset");
  return route.fulfill({ response: antwort, json });
});

await anmelden(page);
await page.waitForSelector("#flow.on", { timeout: 8000 });
await ruhe(page, 600);
await testkameraPruefen(page);
/** Warten, bis die Wiederholung ihre Antwort bekommen hat (höchstens 15 s). */
const zweiteAntwort = async () => {
  for (let i = 0; i < 50 && !antworten.some((x) => !x.weg); i++) await page.waitForTimeout(300);
};
const zeilen = () => page.locator("#blTop .sheet-item").count();
const vorher = await zeilen();

// 1. Neues Blatt, Antwort verloren
let blattId = null;
await page.click("#blShoot");
await page.waitForSelector("#shutter:not(.off)", { timeout: 4000 });
await page.click("#shutter");
await page.waitForTimeout(400);
verwerfen = true;
await page.click("#ablegen");
await zweiteAntwort();
await ruhe(page, 1500);
{
  const a = antworten.slice();
  p.ok(a.length === 2 && a[0].weg && !a[1].weg, `zwei Anfragen, die erste ohne Antwort (${a.length})`);
  p.ok(a[0].kennung && a[0].kennung === a[1].kennung, `beide mit derselben Kennung der Aufnahme (${a[0]?.kennung})`);
  p.ok(a[0].status === 200 && a[1].status === 200 && a[0].id === a[1].id, "die Wiederholung bekommt dasselbe Blatt");
  blattId = a[1]?.id ?? null;
  p.ok(a[1].seiten === 1, `das Blatt hat 1 Seite (${a[1].seiten})`);
  p.ok((await zeilen()) === vorher + 1, `ein Blatt mehr in der Liste, nicht zwei (${vorher} → ${await zeilen()})`);
}
await bild(page, "w01-neues-blatt");

// Neu laden: der Server kennt genau ein neues Blatt
await page.reload();
await page.waitForSelector("#flow.on", { timeout: 8000 });
await ruhe(page, 1200);
p.ok((await zeilen()) === vorher + 1, `nach Neuladen: ${await zeilen()} Blätter`);

// 2. „Seite dazu“ am obersten Blatt, Antwort verloren
antworten.length = 0;
await page.locator("#blTop .sheet-item").first().locator(".add-page").click();
await page.waitForSelector("#shutter:not(.off)", { timeout: 4000 });
await page.click("#shutter");
await page.waitForTimeout(500);
verwerfen = true;
await page.click("#ablegen");
await zweiteAntwort();
await ruhe(page, 1500);
{
  const a = antworten.slice();
  p.ok(a.length === 2 && a[0].weg && !a[1].weg, `„Seite dazu“: zwei Anfragen, die erste ohne Antwort (${a.length})`);
  p.ok(a[0].kennung && a[0].kennung === a[1].kennung, "beide mit derselben Kennung");
  p.ok(a[0].id === a[1].id && a[1].id === blattId, "dasselbe Blatt wie in Schritt 1");
  p.ok(a[0].seiten === 2 && a[1].seiten === 2, `das Blatt hat 2 Seiten, nicht 3 (${a[0]?.seiten}, ${a[1]?.seiten})`);
}
await page.reload();
await page.waitForSelector("#flow.on", { timeout: 8000 });
await ruhe(page, 1200);
p.ok((await zeilen()) === vorher + 1, `nach Neuladen weiter ${vorher + 1} Blätter`);
p.ok((await page.locator("#blTop .sheet-item").first().locator(".pg.under").count()) === 1, "oberstes Blatt: Miniatur mit einem Blatt darunter (2 Seiten)");
await bild(page, "w02-seite-dazu");

p.ok(fehler.every((f) => /Failed to load resource|ERR_CONNECTION_RESET/.test(f)), `keine Konsolenfehler außer der verworfenen Antwort (${fehler.join(" | ")})`);
await ctx.close();
await browser.close();
process.exit(p.gruen ? 0 : 1);
