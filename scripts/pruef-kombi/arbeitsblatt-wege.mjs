/**
 * Prüfung der Nachbesserung von Abschnitt H (Befunde der Abnahme vom
 * 12.10.2026) im Produktionsbau, ohne API-Schlüssel:
 *
 *   npx tsx scripts/saat-arbeitsblatt.mts --neu > ids.json   (Server gestoppt!)
 *   SCHULAPP_TESTUHR=1 npx next start -p 3336
 *   BASIS=http://localhost:3336 IDS_DATEI=ids.json OUT=<ordner> \
 *     node scripts/pruef-kombi/arbeitsblatt-wege.mjs light 390
 *
 * 1. Lange Aufgaben: die letzte Aufgabe endet über der Fußzeile des A4.
 * 2. Android-Zurück: /noten → / → Menü → Wiederholen → Lupe; Zurück schließt
 *    nur die Lupe, das nächste nur den Tisch, man bleibt auf /.
 * 3. Wiederholen: Mathe, am Ende „Weiter mit Französisch“, dann „Fertig“;
 *    danach (Deutsch wird gebaut, Physik gescheitert) die Karten.
 * 4. Ohne Verbindung: kein Tisch, Toast „Keine Verbindung“ mit „Erneut“.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { anmelden, BASIS, browserStarten, fehlerSammeln, kontext, Pruefung } from "./gemeinsam.mjs";

const schema = process.argv[2] ?? "light";
const groesse = process.argv[3] ?? "390";
const OUT = process.env.OUT ?? ".";
const IDS = JSON.parse(readFileSync(process.env.IDS_DATEI, "utf8"));
const name = (n) => path.join(OUT, `wege-${groesse}-${n}-${schema}.png`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = new Pruefung(`Arbeitsblatt-Wege ${schema} ${groesse}`);

const browser = await browserStarten();
const ctx = await kontext(browser, { groesse, schema });
const page = await ctx.newPage();
const fehler = fehlerSammeln(page);

const tippen = async (sel, warten = 400) => {
  await page.locator(sel).first().tap({ force: true });
  await sleep(warten);
};
const oeffnen = async (o, warten = 1200) => {
  await page.evaluate((o) => window.__kombi.openTisch(o), o);
  await sleep(warten);
};
const tischOffen = async () => (await page.locator("#tisch.open").count()) === 1;
const lupeOffen = async () => !(await page.locator("#tbLupe").isHidden());
const lupeAuf = async () => {
  const b = await page.locator(".tb-page:first-child .tb-paper").boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.5, b.y + 40);
  await sleep(700);
};
const bewerteAlle = async () => {
  const n = await page.locator(".tb-row").count();
  for (let nr = 1; nr <= n; nr += 1) {
    await page.locator(`.tb-row[data-nr="${nr}"] button[data-v="true"]`).scrollIntoViewIfNeeded();
    await tippen(`.tb-row[data-nr="${nr}"] button[data-v="true"]`, 120);
  }
};
const druckStub = () => page.evaluate(() => {
  window.print = () => {};
});

await anmelden(page);
await page.evaluate(() => document.fonts.ready);

// ── 1. Lange Aufgaben passen auf Seite 1 ───────────────────────────────────
await oeffnen({ blatt: IDS.langBlatt });
await page.screenshot({ path: name("01-lang-vorschau") });
// Vorschau (Seite mit fester Höhe, wie gedruckt) und #druck: die letzte Aufgabe endet über der Fußzeile
const messe = (sel) =>
  page.evaluate((sel) => {
    const seite = document.querySelector(sel);
    const fuss = seite.querySelector(".a4-foot").getBoundingClientRect();
    const tasks = seite.querySelectorAll(".a4-list > .a4-task");
    const letzte = tasks[tasks.length - 1].getBoundingClientRect();
    return { n: tasks.length, luft: Math.round(fuss.top - letzte.bottom), ueber: seite.scrollHeight - seite.clientHeight };
  }, sel);
const mass = [await messe(".tb-page:first-child .a4")];
await page.emulateMedia({ media: "print" });
mass.push(await messe("#druck .a4"));
await page.emulateMedia({ media: "screen" });
p.ok(mass.every((m) => m.luft >= 0 && m.ueber <= 1 && m.n >= 5), `Lange Aufgaben: letzte Aufgabe über der Fußzeile, nichts abgeschnitten (${JSON.stringify(mass)})`);
await lupeAuf();
await page.screenshot({ path: name("01-lang-lupe") });
await page.keyboard.press("Escape");
await sleep(500);
await tippen("#tClose", 700);

// ── 2. Android-Zurück: erst die Lupe, dann der Tisch ───────────────────────
await page.goto(`${BASIS}/noten`);
await sleep(800);
await page.goto(`${BASIS}/`);
await page.waitForSelector("#whenrow");
await sleep(400);
await page.evaluate(() => window.__kombi.openZeile());
await sleep(500);
await tippen("#o-w-wiederholen", 1500);
p.ok(await tischOffen(), "Menü → Wiederholen öffnet den Tisch (Mathe, Blatt fertig)");
p.ok((await page.locator("#tThema").textContent()) === "Quadratische Funktionen", "Wiederholen: erstes fälliges Übungsthema mit fertigem Blatt");
await lupeAuf();
p.ok(await lupeOffen(), "Lupe offen");
await page.goBack();
await sleep(700);
p.ok(!(await lupeOffen()) && (await tischOffen()) && new URL(page.url()).pathname === "/", "Zurück schließt nur die Lupe");
await page.goBack();
await sleep(700);
p.ok(!(await tischOffen()) && new URL(page.url()).pathname === "/", "Das nächste Zurück schließt nur den Tisch, man bleibt auf /");
await page.screenshot({ path: name("02-nach-zurueck") });
// Per Knopf geschlossen: kein toter Eintrag in der History
await oeffnen({ mode: "wh" });
await lupeAuf();
await tippen("#tbLClose", 600);
await tippen("#tClose", 700);
const vorZurueck = page.url();
await page.goBack();
await sleep(1000);
p.ok(new URL(page.url()).pathname === "/noten" || page.url() !== vorZurueck, `Per Knopf geschlossen: Zurück verlässt / (${page.url()})`);
await page.goto(`${BASIS}/`);
await page.waitForSelector("#whenrow");

// ── 3. Wiederholen: Weiter mit Französisch ─────────────────────────────────
await oeffnen({ mode: "wh" });
await druckStub();
await tippen("#tbMain", 700);
await bewerteAlle();
await tippen("#tbMain", 1200);
await page.screenshot({ path: name("03-ende-weiter") });
const ende1 = await page.locator("#tEnd").innerText();
p.ok(/Weiter mit Französisch/.test(ende1) && /Passé composé mit être, Arbeitsblatt/.test(ende1) && /Für heute aufhören/.test(ende1), `Mathe-Ende: „Weiter mit Französisch“ (${ende1.replace(/\n/g, " | ")})`);
await tippen("#tEnd .tlink.known", 900);
p.ok((await page.locator("#tThema").textContent()) === "Passé composé mit être", "Weiter: Französisch auf demselben Tisch");
await page.screenshot({ path: name("04-franzoesisch") });
await druckStub();
await tippen("#tbMain", 700);
await bewerteAlle();
await tippen("#tbMain", 1200);
const ende2 = await page.locator("#tEnd").innerText();
p.ok(/Fertig/.test(ende2) && !/Weiter mit/.test(ende2), "Französisch-Ende: nur „Fertig“");
await tippen("#tEnd .tlink", 800);
p.ok(!(await tischOffen()), "Fertig schließt den Tisch");
// Deutsch wird gebaut, Physik gescheitert: Wiederholen führt zu den Karten statt in eine Sackgasse
await page.evaluate(() => window.__kombi.openTisch({ mode: "wh" }));
await page.waitForURL(`${BASIS}/abruf/sitzung`, { timeout: 8000 }).catch(() => {});
p.ok(new URL(page.url()).pathname === "/abruf/sitzung", `Kein fertiges Blatt mehr: Wiederholen → Karten (${page.url()})`);
await page.goto(`${BASIS}/`);
await page.waitForSelector("#whenrow");

// ── 4. Ohne Verbindung ─────────────────────────────────────────────────────
await page.route("**/*", (r) => (r.request().method() === "POST" && r.request().headers()["next-action"] ? r.abort() : r.continue()));
await oeffnen({ mode: "wh" }, 1500);
await page.screenshot({ path: name("05-keine-verbindung") });
p.ok(!(await tischOffen()), "Ohne Verbindung: kein Tisch");
p.ok(new URL(page.url()).pathname === "/", "Ohne Verbindung: keine stille Umleitung auf die Karten");
p.ok((await page.locator("#toastText").textContent()) === "Keine Verbindung" && (await page.locator("#toastAct").textContent()) === "Erneut", "Toast „Keine Verbindung“ mit „Erneut“");
await page.unroute("**/*");
await tippen("#toastAct", 2000);
p.ok(new URL(page.url()).pathname === "/abruf/sitzung" || (await tischOffen()), "Erneut: es geht weiter");

const echt = fehler.filter((f) => !/Failed to fetch|net::ERR_FAILED|ERR_FAILED|An unexpected response|fetch/i.test(String(f)));
p.ok(echt.length === 0, `keine Konsolenfehler ${JSON.stringify(echt)}`);
await browser.close();
process.exit(p.gruen ? 0 : 1);
