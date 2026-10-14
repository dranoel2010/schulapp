/**
 * Der Ablauf nach einem Neuladen ohne Netz (Abnahmerunde 17): wer schon auf
 * „Was hast du auf?“ war und dort etwas eingetragen hat, sieht nach dem
 * Neuladen im Flugmodus denselben Schritt mit dem Eintrag, nicht wieder
 * „Neue Blätter?“. Die Seite kommt aus dem Cache des Service Workers, der
 * Schritt aus den neueren Daten im Daten-Cache.
 *
 *   BASIS=http://localhost:3380 node scripts/pruef-kombi/ablauf-kaltstart.mjs
 *
 * Saat: scripts/pruef-kombi/saat-startseite.mts, frisch je Lauf. Trägt
 * „Exercice 4“ in Französisch ein. Braucht den Service Worker und die Testuhr.
 */

import { anmelden, BASIS, browserStarten, kontext, Pruefung } from "./gemeinsam.mjs";

const p = new Pruefung("ablauf-kaltstart");
const browser = await browserStarten();
const ctx = await kontext(browser);
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-14T14:10:00+02:00") });
await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-14T14:10`);
await anmelden(page);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForTimeout(2000);

const schritt = () => page.evaluate(() => document.querySelector("#flow .step.vis")?.innerText ?? "");
await page.locator("button:visible", { hasText: "Keine Blätter, weiter" }).first().click();
await page.waitForTimeout(1500);
await page.locator('#flow :text-is("Französisch"):visible').first().click();
await page.waitForTimeout(800);
await page.keyboard.type("Exercice 4", { delay: 20 });
await page.waitForTimeout(600);
await page.keyboard.press("Enter");
await page.waitForTimeout(2000);

await page.reload();
await page.waitForTimeout(2500);
const online = await schritt();
p.ok(/Was hast du auf\?/.test(online), "online neu geladen: „Was hast du auf?“");

await ctx.setOffline(true);
await page.reload();
await page.waitForTimeout(3500);
const offline = await schritt();
p.ok(/Was hast du auf\?/.test(offline) && /Exercice 4/.test(offline), `ohne Netz neu geladen: derselbe Schritt mit „Exercice 4“ (${JSON.stringify(offline.split("\n")[0])})`);

await browser.close();
process.exit(p.gruen ? 0 : 1);
