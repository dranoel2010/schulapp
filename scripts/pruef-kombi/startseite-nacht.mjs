/**
 * Die Startseite über Nacht im Hintergrund (Abnahmerunde 17):
 *
 * Am Nachmittag läuft der Ablauf in derselben Sitzung durch („Keine Blätter,
 * weiter“, „Fertig“) oder wird übersprungen; danach steht der Überblick.
 * Die App geht in den Hintergrund, Server- und Browseruhr springen auf den
 * nächsten Morgen 07:10. Kommt sie zurück, steht die Morgenansicht da
 * („Heute … Abgaben“ mit „Stunden“), nicht der Überblick von gestern.
 * Gegenprobe: von 07:10 auf 14:10 wechselt sie in den Ablauf.
 * Je Lauf eine frische Saat: die Abläufe vom 14. und 15.10. werden erledigt.
 *
 *   BASIS=http://localhost:3380 node scripts/pruef-kombi/startseite-nacht.mjs
 *
 * Saat: scripts/pruef-kombi/saat-startseite.mts, frisch je Lauf (der Ablauf
 * des 14.10. darf noch nicht erledigt sein). Braucht die Testuhr.
 */

import { BASIS, browserStarten, kontext, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const p = new Pruefung("startseite-nacht");
const browser = await browserStarten();

async function nacht(von, bis, vorher) {
  const ctx = await kontext(browser);
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(von + ":00+02:00") });
  await page.goto(`${BASIS}/api/testuhr?jetzt=${von}`);
  await page.goto(`${BASIS}/login`);
  await page.fill('input[name="password"]', PASSWORT);
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  for (const knopf of vorher) {
    await page.locator("button:visible", { hasText: knopf }).first().click();
    await page.waitForTimeout(1500);
  }
  const sicht = (versteckt) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { get: () => h, configurable: true });
      Object.defineProperty(document, "visibilityState", { get: () => (h ? "hidden" : "visible"), configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, versteckt);
  await sicht(true);
  await page.evaluate(async (u) => {
    await fetch(`/api/testuhr?jetzt=${u}`);
  }, bis);
  await page.clock.setSystemTime(new Date(bis + ":00+02:00"));
  await sicht(false);
  await page.clock.runFor(70000);
  await page.waitForTimeout(4000);
  const text = await page.evaluate(() => document.querySelector("#app")?.innerText ?? "");
  await ctx.close();
  return text;
}

// Morgens: die Abgaben von heute und „Stunden“ zum Packen, nicht „… für ⟨Tag⟩“
const morgen = (t) => /Stunden/.test(t) && /Heute/.test(t) && !/Aufgaben? für/.test(t);
const kurz = (t) => JSON.stringify(t.replace(/\n+/g, " | ").slice(0, 80));
let t = await nacht("2026-10-14T14:10", "2026-10-15T07:10", ["Keine Blätter", "Fertig"]);
p.ok(morgen(t), `nach „Fertig“, Mittwoch 14:10 bis Donnerstag 07:10 im Hintergrund: Morgenansicht (${kurz(t)})`);
t = await nacht("2026-10-15T07:10", "2026-10-15T14:10", []);
p.ok(/Neue Blätter\?/.test(t), `Gegenprobe Donnerstag 07:10 bis 14:10: der Ablauf (${kurz(t)})`);
t = await nacht("2026-10-15T14:10", "2026-10-16T07:10", ["Überspringen"]);
p.ok(morgen(t), `nach „Überspringen“, Donnerstag 14:10 bis Freitag 07:10: Morgenansicht (${kurz(t)})`);

await browser.close();
process.exit(p.gruen ? 0 : 1);
