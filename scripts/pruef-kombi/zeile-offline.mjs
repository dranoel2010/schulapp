/**
 * Die Zeile nach einem Neuladen ohne Netz (Abnahme 12):
 *
 * 1. Online laden, die Zeile einmal öffnen: der Vorrat liegt danach im
 *    Daten-Cache des Service Workers (`schulapp-v3-daten`).
 * 2. Offline neu laden: „hausaufgaben“ findet die Seite „Hausaufgaben“,
 *    „Mathe S. 5 bis morgen“ bietet das Eintragen an, Enter sagt „Keine
 *    Verbindung“ mit „Erneut“.
 * 3. Ohne Vorrat im Cache: Enter tut nicht still nichts, sondern sagt
 *    „Keine Verbindung“ mit „Erneut“.
 *
 *   BASIS=http://localhost:3380 node scripts/pruef-kombi/zeile-offline.mjs
 *
 * Saat: scripts/pruef-kombi/saat-startseite.mts. Braucht den Service Worker,
 * läuft deshalb ohne `ohneSW`. Trägt nichts ein (ohne Netz scheitert es).
 */

import { anmelden, BASIS, browserStarten, kontext, Pruefung } from "./gemeinsam.mjs";

const p = new Pruefung("zeile-offline");
const browser = await browserStarten();

const tippen = async (page, s) => {
  await page.tap("#field");
  await page.fill("#field", "");
  await page.keyboard.type(s, { delay: 20 });
  await page.waitForTimeout(800);
  return page.$$eval("#mHits .opt, #mHits [role=option]", (e) => e.map((x) => x.textContent.trim()));
};
const toastText = (page) => page.evaluate(() => document.body.innerText);

for (const ohneCache of [false, true]) {
  const ctx = await kontext(browser);
  const page = await ctx.newPage();
  await anmelden(page);
  await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-13T16:40`);
  await page.goto(`${BASIS}/`);
  await page.waitForSelector("#whenrow");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // erst unter der Kontrolle des Workers geht der Vorrat durch ihn
  await page.reload();
  await page.waitForSelector("#whenrow");
  await tippen(page, "hausaufgaben");
  await page.waitForTimeout(800);
  const imCache = await page.evaluate(async () => !!(await (await caches.open("schulapp-v3-daten")).match("/api/zeile/vorrat")));
  p.ok(imCache, "der Vorrat der Zeile liegt im Daten-Cache");
  if (ohneCache) await page.evaluate(async () => (await caches.open("schulapp-v3-daten")).delete("/api/zeile/vorrat"));

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#whenrow");
  await page.waitForTimeout(1500);

  const ha = await tippen(page, "hausaufgaben");
  const eintrag = await tippen(page, "Mathe S. 5 bis morgen");
  if (!ohneCache) {
    p.ok(ha.some((t) => t.startsWith("Hausaufgaben")), `ohne Netz: „hausaufgaben“ findet die Seite (${JSON.stringify(ha.slice(0, 2))})`);
    p.ok(eintrag.length > 0, `ohne Netz: „Mathe S. 5 bis morgen“ zeigt ein Menü (${JSON.stringify(eintrag.slice(0, 2))})`);
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const text = await toastText(page);
  p.ok(/Keine Verbindung/.test(text) && /Erneut/.test(text), `${ohneCache ? "ohne Vorrat" : "mit Vorrat aus dem Cache"}: Enter sagt „Keine Verbindung“ mit „Erneut“`);
  await ctx.close();
}

await browser.close();
process.exit(p.gruen ? 0 : 1);
