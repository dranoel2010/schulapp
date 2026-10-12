/**
 * Prüfung von Abschnitt C (Ablauf nach der Schule, Kamera) im Produktionsbau.
 *
 *   BASIS=http://localhost:3311 AUS=<ordner> node scripts/pruef-kombi/ablauf.mjs [390|360] [light|dark]
 *
 * Voraussetzung: `SCHULAPP_TESTUHR=1`, Saat aus saat-abruf.mts und
 * saat-ablauf.mts, der Ablauf heute noch offen (Schultag nach Schulschluss;
 * sonst vorher `npx tsx scripts/pruef-kombi/ablauf-zuruecksetzen.mts` bei
 * ausgeschaltetem Server). Kamera nur als Testkamera: gemeinsam.mjs prüft das
 * Label der Videospur vor dem ersten Kameratest.
 */
import fs from "node:fs";
import path from "node:path";

import { anmelden, browserStarten, fehlerSammeln, kontext, Pruefung, ruhe, testkameraPruefen } from "./gemeinsam.mjs";

const groesse = process.argv[2] ?? "390";
const schema = process.argv[3] ?? "light";
const AUS = process.env.AUS ?? "/tmp/kombi-ablauf";
fs.mkdirSync(AUS, { recursive: true });
const bild = (page, name) => page.screenshot({ path: path.join(AUS, `${name}-${groesse}-${schema}.png`) });

const p = new Pruefung(`Ablauf ${groesse} ${schema}`);
const browser = await browserStarten();
const ctx = await kontext(browser, { groesse, schema });
const page = await ctx.newPage();
const fehler = fehlerSammeln(page);

await anmelden(page);
await page.waitForSelector("#flow.on", { timeout: 8000 }).catch(() => {});
await ruhe(page, 700);
p.ok(await page.locator("#flow.on").count(), "nach Schulschluss steht der Ablauf, Schritt Blätter");
await bild(page, "c01-blaetter");

// Kriterium 19: keine Fächer in Schritt 1
p.ok((await page.locator("#s-blaetter .fp, #s-blaetter .subj").count()) === 0, "Schritt 1 zeigt keine Fächer");
p.ok((await page.locator("#blSkipNext").innerText()) === "Keine Blätter, weiter", "leiser Knopf „Keine Blätter, weiter“");

// Kamera — nur die Testkamera
await testkameraPruefen(page);
const t0 = Date.now();
await page.click("#blShoot");
await page.waitForSelector("#cam.open");
await page.waitForTimeout(150);
await bild(page, "c02-kamera-oeffnet");
await page.waitForSelector("#shutter:not(.off)", { timeout: 4000 });
const bis = Date.now() - t0;
p.ok(bis <= 1500, `erstes Bild nach ${bis} ms (≤ 1500)`);
await ruhe(page, 300);
const tc = await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));
p.ok(tc.every((c) => c === "#0B0B0C"), `theme-color in der Kamera (${tc.join(",")})`);
p.ok((await page.locator("#camChip").innerText()) === "Fach erkennen", "Chip „Fach erkennen“");
await bild(page, "c03-kamera");
for (let i = 0; i < 3; i++) {
  await page.click("#shutter");
  await page.waitForTimeout(500);
}
await bild(page, "c04-kamera-drei");
p.ok((await page.locator("#camN").innerText()) === "Drei Blätter", "„Drei Blätter“ im Zähler");
await page.click("#ablegen");
await page.waitForTimeout(160);
await bild(page, "c05-ablegen-160ms");
await ruhe(page, 1300);
await bild(page, "c06-gelandet");
const zeilen = await page.locator("#blTop .sheet-item").count();
p.ok(zeilen === 3, `drei Blätter in der Liste (${zeilen})`);
p.ok(!(await page.locator("#cam").evaluate((e) => e.classList.contains("open"))), "Kamera schließt mit Ablegen");
p.ok(
  (await page.locator("#blNext").isVisible()) && (await page.locator("#blShootLabel").innerText()) === "Noch ein Blatt",
  "„Weiter zu Hausaufgaben“, Sucher flach",
);
// ohne die Haarlinie oben (ab der zweiten Zeile) wie im Prototyp 129,4 px
const hoehen = await page
  .locator("#blTop .sheet-item")
  .evaluateAll((els) => els.map((e) => Math.floor(e.getBoundingClientRect().height - parseFloat(getComputedStyle(e).borderTopWidth))));
p.ok(hoehen.every((h) => h === 129), `Zeilenhöhe beim Einordnen ${hoehen.join(",")} (129)`);
await ruhe(page, 2500);
await bild(page, "c07-nach-upload");

const klein = await page.evaluate(() =>
  [...document.querySelectorAll("#flow.on button")]
    .filter((b) => b.offsetParent && getComputedStyle(b).visibility !== "hidden" && !b.closest(".st-acts.wait"))
    .map((b) => ({ t: b.textContent.trim().slice(0, 24) || b.getAttribute("aria-label"), r: b.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ t, r }) => `${t} ${Math.round(r.width)}×${Math.round(r.height)}`),
);
p.ok(klein.length === 0, `Tippflächen ≥ 44 in Schritt 1 (${klein.join("; ")})`);

// Schritt 2
await page.click("#blNext");
await ruhe(page, 500);
await bild(page, "c08-hausaufgaben");
const subj = await page.locator("#haSubjects .subj-name b").allInnerTexts();
p.ok(subj.join("|") === "Geschichte|Mathematik|Biologie|Anderes Fach", `Fächer von heute: ${subj.join(", ")}`);
const offen = await page.locator("#haOffen .t-title").allInnerTexts();
p.ok(offen.length === 2, `„Schon offen“: ${offen.join(" / ")}`);
p.ok(await page.locator("#skipBtn").isVisible(), "„Überspringen“ auf Schritt 2");
const kleinHA = await page.evaluate(() =>
  [...document.querySelectorAll("#s-ha button")]
    .filter((b) => b.offsetParent && !b.closest(".t-acts"))
    .map((b) => ({ t: b.textContent.trim().slice(0, 24) || b.getAttribute("aria-label"), r: b.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ t, r }) => `${t} ${Math.round(r.width)}×${Math.round(r.height)}`),
);
p.ok(kleinHA.length === 0, `Tippflächen in Schritt 2 ≥ 44 (${kleinHA.join("; ")})`);

// Kriterium 5: in Schritt 2 verlassen → beim nächsten Öffnen Schritt 2
await page.reload();
await page.waitForSelector("#flow.on", { timeout: 8000 }).catch(() => {});
await ruhe(page, 800);
p.ok((await page.locator("#s-ha.vis").count()) === 1, "nach Neuladen wieder bei Schritt 2");

// Abhaken mit Toast und Rückgängig
await page.locator("#haOffen .check").first().click();
await page.waitForTimeout(150);
await bild(page, "c09-abhaken-150ms");
await ruhe(page, 700);
const toast = await page.locator("#toastText").innerText();
p.ok(/^Mathe abgehakt$|^Deutsch abgehakt$/.test(toast), `Toast „${toast}“`);
await bild(page, "c10-abgehakt");
await page.click("#toastAct");
await ruhe(page, 900);
p.ok((await page.locator("#haOffen .task").count()) === 2, "Rückgängig: wieder zwei offen");

// Zurück zu Schritt 1, Schritt bleibt gemerkt
await page.click("#haBack");
await ruhe(page, 500);
await page.click("#blNext");
await ruhe(page, 500);

// Überspringen → Überblick, dann über die Zeile zurück
await page.click("#skipBtn");
await ruhe(page, 700);
p.ok(!(await page.locator("#flow.on").count()), "Überspringen verlässt den Ablauf");
await page.click("#field");
await ruhe(page, 500);
await bild(page, "c11-vorschlag-nach-der-schule");
const vor = page.locator("#o-v-ablauf");
p.ok(await vor.count(), "Vorschlag „Nach der Schule“ in der Zeile");
await vor.click();
await ruhe(page, 700);
p.ok((await page.locator("#skipBtn").innerText()) === "Schließen", "aus dem Menü: „Schließen“ statt „Überspringen“");
p.ok((await page.locator("#s-ha.vis").count()) === 1, "Wiederaufnahme beim gemerkten Schritt (Hausaufgaben)");
await bild(page, "c12-aus-dem-menu");
await page.click("#skipBtn");
await ruhe(page, 600);
p.ok(!(await page.locator("#flow.on").count()), "„Schließen“ führt zum Überblick");

// Neuladen: der Ablauf kommt nicht von selbst wieder
await page.reload();
await ruhe(page, 1500);
p.ok(!(await page.locator("#flow.on").count()), "nach Überspringen öffnet die App am selben Tag nicht den Ablauf");

p.ok(fehler.length === 0, `keine Konsolenfehler (${fehler.join(" | ")})`);
await browser.close();
process.exit(p.gruen ? 0 : 1);
