/**
 * Schlussrunde: im Ablauf fotografierte Blätter stehen nach dem Neuladen noch
 * in Schritt 1, auch wenn die Testuhr auf einem anderen Tag steht als die
 * Uhr des Servers. Vorher trugen sie `created_at` der echten Uhr, und
 * `blaetterVomTag` (Tag der Testuhr) fand sie nicht: Schritt 1 zeigte wieder
 * „Keine Blätter, weiter“.
 *
 *   BASIS=http://localhost:3380 node scripts/pruef-kombi/ablauf-testuhr.mjs [2026-10-12T14:30]
 *
 * Saat: saat-abruf.mts und saat-ablauf.mts, der Ablauf am Tag der Testuhr
 * noch offen. Braucht SCHULAPP_TESTUHR=1. Kamera nur als Testkamera.
 */

import { BASIS, browserStarten, kontext, PASSWORT, Pruefung, ruhe, testkameraPruefen } from "./gemeinsam.mjs";

const uhr = process.argv[2] ?? "2026-10-12T14:30";
const p = new Pruefung("ablauf-testuhr");
const browser = await browserStarten();
const ctx = await kontext(browser);
const page = await ctx.newPage();
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));

await page.goto(`${BASIS}/login`);
await page.fill('input[name="password"]', PASSWORT);
await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
await page.goto(`${BASIS}/api/testuhr?jetzt=${uhr}`);
await page.goto(`${BASIS}/`);
await page.waitForSelector("#flow.on", { timeout: 8000 }).catch(() => {});
await ruhe(page, 700);
p.ok(await page.locator("#flow.on").count(), `Testuhr ${uhr}: der Ablauf steht, Schritt Blätter`);

const vorher = await page.locator("#blTop .sheet-item").count();
await testkameraPruefen(page);
await page.click("#blShoot");
await page.waitForSelector("#shutter:not(.off)", { timeout: 4000 });
for (let i = 0; i < 3; i++) {
  await page.click("#shutter");
  await page.waitForTimeout(500);
}
await page.click("#ablegen");
await ruhe(page, 4000);
const nachher = await page.locator("#blTop .sheet-item").count();
p.ok(nachher === vorher + 3, `drei Blätter mehr in der Liste (${vorher} → ${nachher})`);

await page.reload();
await page.waitForSelector("#flow.on", { timeout: 8000 }).catch(() => {});
await ruhe(page, 1500);
const zeilen = await page.locator("#blTop .sheet-item").count();
p.ok(zeilen === nachher, `nach dem Neuladen: dieselben ${nachher} Blätter in Schritt 1 (${zeilen})`);
p.ok(await page.locator("#blNext").isVisible(), "nach dem Neuladen: „Weiter zu Hausaufgaben“");
await page.screenshot({ path: process.env.BILD ?? "/dev/null" }).catch(() => {});

p.ok(fehler.length === 0, `keine Seitenfehler ${JSON.stringify(fehler)}`);
await browser.close();
process.exit(p.gruen ? 0 : 1);
