/**
 * Die Zeile nach einem Neuladen ohne Netz (Abnahme 12):
 *
 * 1. Online laden, die Zeile einmal öffnen: der Vorrat liegt danach im
 *    Daten-Cache des Service Workers (`schulapp-v3-daten`).
 * 2. Offline neu laden: „hausaufgaben“ findet die Seite „Hausaufgaben“,
 *    „Mathe S. 5 bis morgen“ bietet das Eintragen an. Gilt der Vorrat aus
 *    dem Cache für den App-Tag des Geräts, trägt Enter ein, das Speichern
 *    scheitert und der Toast sagt wie überall „Nicht gespeichert“ mit
 *    „Erneut“ (UMSETZUNG 2.4, Punkt 9). Ist er von gestern, lässt er sich
 *    nicht auffrischen: „Keine Verbindung“ (Punkt 7, Laden).
 *    Abhaken über das Häkchen im Menü („gedicht“) sagt ohne Netz ebenso
 *    „Nicht gespeichert“ mit „Erneut“, wie Startseite und Stapelseiten.
 * 3. Ohne Vorrat im Cache: Enter tut nicht still nichts, sondern sagt
 *    „Keine Verbindung“ mit „Erneut“.
 * 4. Flugmodus nach einem Besuch (Abnahmerunde 16): online über „Wohin?“
 *    Hausaufgaben und Woche geöffnet, dann ohne Netz „Zuletzt geöffnet →
 *    Woche“: die Woche kommt aus dem Cache, mit „Ohne Verbindung“, ohne Toast
 *    „Keine Verbindung“. Dafür holt „Zuletzt“ dieselbe Adresse wie „Wohin?“.
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
/** Die Startseite; steht um 16:40 noch der Ablauf da, wird er übersprungen. */
const startseite = async (page) => {
  await page.goto(`${BASIS}/`);
  await page.waitForSelector("#whenrow", { state: "attached" });
  await page.waitForTimeout(1200);
  if (!(await page.isVisible("#whenrow"))) {
    await page.getByRole("button", { name: "Überspringen" }).first().click();
  }
  await page.waitForSelector("#whenrow");
};

for (const ohneCache of [false, true]) {
  const ctx = await kontext(browser);
  const page = await ctx.newPage();
  await anmelden(page);
  await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-13T16:40`);
  await startseite(page);
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
  // App-Tag des Geräts (Berlin, Wechsel 04:00) gegen den Tag der Testuhr
  const geraeteTag = await page.evaluate(() =>
    new Date(Date.now() - 4 * 36e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }),
  );
  const soll = !ohneCache && geraeteTag === "2026-10-13" ? "Nicht gespeichert" : "Keine Verbindung";
  const anders = soll === "Nicht gespeichert" ? "Keine Verbindung" : "Nicht gespeichert";
  p.ok(
    text.includes(soll) && !text.includes(anders) && /Erneut/.test(text),
    `${ohneCache ? "ohne Vorrat" : `mit Vorrat aus dem Cache (Gerätetag ${geraeteTag})`}: Enter sagt „${soll}“ mit „Erneut“`,
  );
  if (!ohneCache) {
    await page.reload();
    await page.waitForSelector("#whenrow");
    await page.waitForTimeout(1500);
    const hits = await tippen(page, "gedicht");
    const haken = await page.$("#mHits .mcheck");
    p.ok(!!haken, `ohne Netz: „gedicht“ zeigt eine Aufgabe mit Häkchen (${JSON.stringify(hits.slice(0, 2))})`);
    if (haken) {
      await haken.tap();
      await page.waitForTimeout(2500);
      const t = await page.$eval("#toast", (e) => e.textContent.trim()).catch(() => "");
      p.ok(/Nicht gespeichert/.test(t) && !/Keine Verbindung/.test(t) && /Erneut/.test(t), `ohne Netz: Abhaken im Menü sagt „Nicht gespeichert“ mit „Erneut“ (${JSON.stringify(t)})`);
    }
  }
  await ctx.close();
}

{
  const ctx = await kontext(browser);
  const page = await ctx.newPage();
  const geholt = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/seite/woche")) geholt.push(r.url().replace(/^.*\/api/, "/api"));
  });
  await anmelden(page);
  await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-13T16:40`);
  await startseite(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector("#whenrow");
  const oeffnen = async (gruppe, label) => {
    await page.tap("#field");
    await page.waitForTimeout(600);
    await page.locator(`[role=group][aria-label="${gruppe}"]`).getByText(label, { exact: true }).first().click();
    await page.waitForTimeout(1800);
  };
  const zurueck = async () => {
    await page.goBack();
    await page.waitForTimeout(1200);
  };
  for (const l of ["Hausaufgaben", "Woche"]) {
    await oeffnen("Wohin?", l);
    await zurueck();
  }
  const online = geholt.at(-1);
  await ctx.setOffline(true);
  await oeffnen("Zuletzt geöffnet", "Woche");
  const offline = geholt.at(-1);
  const seite = await page.evaluate(() => [...document.querySelectorAll("#pages > .page")].pop()?.innerText ?? "");
  const toast = await page.$eval("#toast", (e) => e.textContent.trim()).catch(() => "");
  p.ok(online === offline && /\?tag=\d{4}-\d{2}-\d{2}$/.test(offline ?? ""), `„Zuletzt“ holt dieselbe Adresse wie „Wohin?“ (${online} / ${offline})`);
  p.ok(/^Woche/.test(seite) && /Ohne Verbindung/.test(seite), `ohne Netz: „Zuletzt geöffnet → Woche“ zeigt die Woche aus dem Cache (${JSON.stringify(seite.slice(0, 60))})`);
  p.ok(!/Keine Verbindung/.test(toast), `ohne Netz: kein Toast „Keine Verbindung“ (${JSON.stringify(toast)})`);
  await ctx.close();
}

await browser.close();
process.exit(p.gruen ? 0 : 1);
