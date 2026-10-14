/**
 * Die Lernblock-Uhr mit Testuhr, OHNE `page.clock.install`: die Uhr des
 * Browsers ist die echte, nur der Server läuft auf der Testuhr (Cookie). So
 * steht es, wenn jemand die Testuhr stellt und am Gerät lernt. Der Server
 * schreibt `laeuft_seit` mit der Testuhr; der Tisch zählt mit dem Versatz
 * der App-Uhr weiter. Vorher stand die Uhr (Testuhr später als das Gerät)
 * oder war sofort abgelaufen (Testuhr früher), und „Block beenden“ nahm den
 * Weg „unter einer Minute“.
 *
 *   BASIS=http://localhost:3380 node scripts/pruef-kombi/lernblock-testuhr.mjs [2026-10-14T21:10] [lang]
 *
 * Saat: ein offener Lernblock am App-Tag der Testuhr mit mindestens einer
 * fälligen Frage (etwa scripts/pruef-kombi/saat-startseite.mts und dazu eine
 * Frage an der Mathe-Klausur, fällig am 14.10.). Braucht SCHULAPP_TESTUHR=1.
 * Mit `lang`: nach gut einer Minute die Frage „Saß“, dann „Block beenden“
 * fragt „Als erledigt zählen?“ mit „1 Minute gelernt“.
 */

import { BASIS, browserStarten, kontext, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const uhr = process.argv[2] ?? "2026-10-14T21:10";
const lang = process.argv[3] === "lang";
const p = new Pruefung("lernblock-testuhr");
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
await page.waitForTimeout(2000);
const ueberspringen = page.locator("#skipBtn");
if (await ueberspringen.isVisible()) {
  await ueberspringen.click();
  await page.waitForTimeout(1200);
}

await page.getByText(/^(Starten|Weiter|\d\d:\d\d)$/).filter({ visible: true }).first().click();
await page.waitForTimeout(3000);
const sekunden = async () => {
  const t = (await page.locator("#tClockText").first().textContent().catch(() => null)) ?? "";
  const m = /^(\d\d):(\d\d)$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const a = await sekunden();
await page.waitForTimeout(6000);
const b = await sekunden();
p.ok(a !== null && a > 0, `Tisch mit Uhr, nicht abgelaufen (${a} s übrig)`);
p.ok(a !== null && b !== null && a - b >= 4 && a - b <= 8, `die Uhr läuft: nach 6 s ${a} → ${b}`);

if (lang) {
  await page.waitForTimeout(56000);
  await page.locator("textarea").filter({ visible: true }).first().fill("Antwort");
  await page.getByText("Aufdecken", { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Saß/ }).filter({ visible: true }).first().click();
  await page.waitForTimeout(2000);
  await page.getByText("Block beenden").filter({ visible: true }).first().click();
  await page.waitForTimeout(1200);
  const frage = (await page.locator(".t-confirm.on").first().innerText().catch(() => "")).replace(/\n+/g, " | ");
  p.ok(/Als erledigt zählen\?/.test(frage) && /1 Minute gelernt/.test(frage), `„Block beenden“ nach gut einer Minute: ${JSON.stringify(frage)}`);
}

p.ok(fehler.length === 0, `keine Seitenfehler ${JSON.stringify(fehler)}`);
await browser.close();
process.exit(p.gruen ? 0 : 1);
