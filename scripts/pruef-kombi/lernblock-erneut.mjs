/**
 * Schlussrunde, Lernblock auf dem Tisch:
 *
 * 1. Ohne Netz „Starten“: „Keine Verbindung · Erneut“. Netz wieder da, ein
 *    Tipp auf „Erneut“ lädt die Fragen nach (vorher eine leere Funktion: der
 *    Tisch blieb leer, die Uhr lief).
 * 2. Ein Tipp auf die Uhr pausiert. Tisch und Startseite (nach Neuladen)
 *    nennen dieselbe Restzeit (vorher eine Sekunde Unterschied).
 *
 *   BASIS=http://localhost:3380 node scripts/pruef-kombi/lernblock-erneut.mjs [testuhr]
 *
 * Saat: ein offener Lernblock am App-Tag mit mindestens einer fälligen Frage
 * (scripts/pruef-kombi/saat-startseite.mts und dazu eine Frage an der
 * Mathe-Klausur, fällig am Tag der Testuhr). Mit Service Worker, 390x844.
 */

import { BASIS, browserStarten, kontext, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const uhr = process.argv[2] ?? null;
const p = new Pruefung("lernblock-erneut");
const browser = await browserStarten();
const ctx = await kontext(browser);
const page = await ctx.newPage();
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));

await page.goto(`${BASIS}/login`);
await page.fill('input[name="password"]', PASSWORT);
await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
if (uhr) await page.goto(`${BASIS}/api/testuhr?jetzt=${uhr}`);
await page.goto(`${BASIS}/`);
await page.waitForTimeout(2500);
const ueberspringen = page.locator("#skipBtn");
if (await ueberspringen.isVisible()) {
  await ueberspringen.click();
  await page.waitForTimeout(1200);
}

// ── 1. Offline starten, online gehen, Erneut ──────────────────────────────
await ctx.setOffline(true);
await page.getByText(/^(Starten|Weiter)$/).filter({ visible: true }).first().click();
await page.waitForTimeout(3000);
const toast = (await page.$eval("#toast", (e) => e.textContent.trim()).catch(() => "")) ?? "";
const kartenOffline = await page.locator("#lbTisch .t-stack > *").count();
p.ok(/Keine Verbindung/.test(toast) && /Erneut/.test(toast), `ohne Netz: „Keine Verbindung · Erneut“ (${JSON.stringify(toast)})`);
p.ok(kartenOffline === 0, `ohne Netz: keine Karten (${kartenOffline})`);

await ctx.setOffline(false);
const anfragen = [];
page.on("request", (r) => {
  if (r.method() === "POST") anfragen.push(r.url());
});
await page.locator("#toastAct").click();
await page.waitForTimeout(4000);
const karten = await page.locator("#lbTisch .t-stack > *").count();
const tischText = (await page.locator("#lbTisch .t-stack").innerText().catch(() => "")).replace(/\n+/g, " | ");
p.ok(anfragen.length > 0, `„Erneut“ stellt die Anfrage (${anfragen.length} POST)`);
p.ok(karten > 0, `nach „Erneut“ ist die Karte da (${karten}): ${JSON.stringify(tischText.slice(0, 80))}`);
await page.screenshot({ path: process.env.BILD ?? "/dev/null" }).catch(() => {});

// ── 2. Pausieren: Tisch und Startseite gleich ─────────────────────────────
await page.waitForTimeout(2600);
await page.locator("#tClock").click();
await page.waitForTimeout(1500);
const tischRest = (await page.locator("#tClockText").innerText()).trim();
const pausiert = await page.locator("#tClock.paused").count();
await page.waitForTimeout(1500);
const tischRest2 = (await page.locator("#tClockText").innerText()).trim();
p.ok(pausiert === 1 && tischRest === tischRest2, `pausiert steht die Uhr: ${tischRest} → ${tischRest2}`);

await page.goto(`${BASIS}/`);
await page.waitForTimeout(2500);
const sub = (await page.locator("#lbSub").first().innerText().catch(() => "")).trim();
p.ok(sub === `Pausiert bei ${tischRest}`, `Startseite ${JSON.stringify(sub)} gleich Tisch ${JSON.stringify(tischRest)}`);

p.ok(fehler.length === 0, `keine Seitenfehler ${JSON.stringify(fehler)}`);
await browser.close();
process.exit(p.gruen ? 0 : 1);
