/**
 * Prüfung von Abschnitt C, Teil 2: Kamera ohne Zugriff, „Aus Fotos“,
 * „Seite dazu“, „Fach ändern“, gescheiterte Abschrift (`?fehler=abschrift`),
 * Android-Zurück schließt die Kamera.
 *
 *   BASIS=http://localhost:3311 AUS=<ordner> node scripts/pruef-kombi/ablauf-kamera.mjs [390|360] [light|dark]
 *
 * Chrome läuft auch hier mit der Testkamera; „kein Zugriff“ entsteht, indem
 * ein Init-Skript `getUserMedia` mit `NotAllowedError` ablehnen lässt — so
 * wie Android-Chrome nach einmaligem Ablehnen. Berechtigungen werden nie
 * erteilt (`grantPermissions` kommt nicht vor).
 */
import fs from "node:fs";
import path from "node:path";

import { anmelden, browserStarten, fehlerSammeln, kontext, Pruefung, ruhe, testkameraPruefen } from "./gemeinsam.mjs";

const groesse = process.argv[2] ?? "390";
const schema = process.argv[3] ?? "light";
const AUS = process.env.AUS ?? "/tmp/kombi-ablauf";
fs.mkdirSync(AUS, { recursive: true });
const bild = (page, name) => page.screenshot({ path: path.join(AUS, `${name}-${groesse}-${schema}.png`) });
const p = new Pruefung(`Kamera ${groesse} ${schema}`);
const browser = await browserStarten();

// 1. Kein Zugriff auf die Kamera
{
  const ctx = await kontext(browser, { groesse, schema, ohneSW: true });
  await ctx.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("abgelehnt", "NotAllowedError"));
    }
  });
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await page.waitForSelector("#flow.on", { timeout: 8000 });
  await ruhe(page, 600);
  await page.click("#blShoot");
  await page.waitForSelector("#fMsg:not([hidden]) .btn", { timeout: 4000 });
  await ruhe(page, 400);
  await bild(page, "k01-kein-zugriff");
  p.ok((await page.locator("#fMsg span").innerText()) === "Kein Zugriff auf die Kamera", "„Kein Zugriff auf die Kamera“");
  const [w1] = await Promise.all([page.waitForEvent("filechooser", { timeout: 3000 }), page.click("#fMsg .btn")]);
  p.ok(!!w1, "„Foto auswählen“ öffnet die Dateiwahl");
  const [w2] = await Promise.all([page.waitForEvent("filechooser", { timeout: 3000 }), page.click("#shutter")]);
  p.ok(!!w2, "der Auslöser öffnet dann ebenfalls die Dateiwahl");
  // ein Foto über die Dateiwahl: wird ein Blatt im Streifen
  const png = path.join(AUS, "k01-kein-zugriff-" + groesse + "-" + schema + ".png");
  await w2.setFiles(png);
  await page.waitForSelector("#csRow .cs-mini", { timeout: 5000 });
  p.ok((await page.locator("#camN").innerText()) === "Ein Blatt", "Foto aus der Dateiwahl ist ein Blatt");
  await page.click("#camClose");
  await ruhe(page, 1500);
  p.ok((await page.locator("#blTop .sheet-item").count()) === 1, "Schließen legt ab, was fotografiert ist");
  p.ok(fehler.length === 0, `keine Konsolenfehler (${fehler.join(" | ")})`);
  await ctx.close();
}

// 2. Testkamera: gescheiterte Abschrift, Seite dazu, Fach ändern, Zurück
{
  const ctx = await kontext(browser, { groesse, schema });
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await page.goto(`${process.env.BASIS ?? "http://localhost:3301"}/?fehler=abschrift`);
  await page.waitForSelector("#flow.on", { timeout: 8000 });
  await ruhe(page, 600);
  await testkameraPruefen(page);
  await page.click("#blShoot");
  await page.waitForSelector("#shutter:not(.off)", { timeout: 4000 });
  // Android-Zurück ohne Foto schließt die Kamera
  await page.goBack();
  await ruhe(page, 500);
  p.ok(!(await page.locator("#cam.open").count()), "Android-Zurück schließt die Kamera");
  await page.click("#blShoot");
  await page.waitForSelector("#shutter:not(.off)", { timeout: 4000 });
  await page.click("#shutter");
  await page.waitForTimeout(400);
  await page.click("#ablegen");
  await ruhe(page, 2500);
  const err = page.locator("#blTop .sheet-item").first().locator(".st-s.err");
  p.ok((await err.count()) === 1 && /Abschrift fehlgeschlagen$/.test(await err.innerText()), "rote Zeile „… Abschrift fehlgeschlagen“");
  await bild(page, "k02-fehlgeschlagen");
  await page.locator("#blTop .retry").first().click();
  await ruhe(page, 900);
  const s = await page.locator("#blTop .sheet-item").first().locator(".st-s").innerText();
  p.ok(/Abschrift folgt$/.test(s), `nach „Erneut versuchen“: „${s}“`);
  p.ok((await page.locator("#blTop .retry").count()) === 0, "„Erneut versuchen“ ist weg");
  await bild(page, "k03-erneut");

  // Seite dazu am obersten Blatt
  p.ok(await page.locator("#blTop .sheet-item").first().locator(".add-page").isVisible(), "„Seite dazu“ am obersten Blatt");
  p.ok(!(await page.locator("#blTop .sheet-item").nth(1).locator(".add-page").isVisible()), "… und nur dort");
  await page.locator("#blTop .sheet-item").first().locator(".add-page").click();
  await page.waitForSelector("#shutter:not(.off)", { timeout: 4000 });
  p.ok((await page.locator("#csAdd").getAttribute("aria-pressed")) === "true", "Kamera öffnet mit „Seite dazu“ an diesem Blatt");
  await page.click("#shutter");
  await page.waitForTimeout(500);
  await bild(page, "k04-seite-dazu-kamera");
  p.ok((await page.locator("#camN").innerText()) === "Seite dazu", "Zähler „Seite dazu“");
  await page.click("#ablegen");
  await ruhe(page, 2500);
  p.ok((await page.locator("#blTop .sheet-item").first().locator(".pg.under").count()) === 1, "zweite Seite: Miniatur mit Blatt darunter");
  await bild(page, "k05-seite-dazugelegt");

  // Fach ändern
  await page.locator("#blTop .sheet-item").first().locator(".refile-btn").click();
  await ruhe(page, 300);
  await bild(page, "k06-fach-aendern");
  const pillen = await page.locator("#blTop .sheet-item").first().locator(".refile .fp").allInnerTexts();
  p.ok(pillen.length >= 6, `Fach-Pillen: ${pillen.join(", ")}`);
  p.ok((await page.locator("#blTop .sheet-item").first().locator(".refile .fp").first().getAttribute("aria-pressed")) === "true", "das jetzige Fach steht vorn");
  const ziel = page.locator("#blTop .sheet-item").first().locator('.refile .fp[aria-pressed="false"]').first();
  const neu = await ziel.innerText();
  await ziel.click();
  await ruhe(page, 400);
  p.ok((await page.locator("#toastText").innerText()) === `Nach ${neu} verschoben`, `Toast „Nach ${neu} verschoben“`);
  await ruhe(page, 1500);
  p.ok((await page.locator("#blTop .sheet-item").first().locator(".st-t").innerText()) === neu, "Fach steht in der Zeile");
  await bild(page, "k07-umsortiert");
  p.ok(fehler.length === 0, `keine Konsolenfehler (${fehler.join(" | ")})`);
  await ctx.close();
}

await browser.close();
process.exit(p.gruen ? 0 : 1);
