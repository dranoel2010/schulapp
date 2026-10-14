/**
 * Handy bleibt Handy: Bilder der App unterhalb der Desktop-Schwelle, vor und
 * nach dem Einbau der Rechner-Ansicht, Pixel für Pixel (Toleranz 0).
 *
 * Größen: 360×800 und 390×844 (Handy, wie die Regel „360 und 390“), 800×900 (die Spalte von 600 bis
 * 1023 px), je hell und dunkel. Seiten: Start um 16:40 (Ablauf), Überblick,
 * Ablauf, Hausaufgaben, Woche, Klausur, Ablage, Blatt, Einstellungen, Zeile
 * mit Menü, ein offenes Sheet, Tisch mit Karten (über „Wiederholen“), Arbeitsblatt, „Wie lief es?“
 * und Morgens um 07:10.
 *
 *   # einmal auf dem unveränderten Stand:
 *   BASIS=http://localhost:3380 IDS_DATEI=<ids.json> RESET='<befehl>' \
 *     node scripts/pruef-kombi/desktop-handy-gleich.mjs --grund
 *   # danach gegen das Grundbild:
 *   BASIS=… IDS_DATEI=… RESET=… node scripts/pruef-kombi/desktop-handy-gleich.mjs
 *
 * Voraussetzungen: Produktionsbau mit `SCHULAPP_TESTUHR=1` auf eigenem Port
 * mit eigener Datenbank, gesät mit scripts/saat-abruf.mts,
 * scripts/pruef-kombi/saat-startseite.mts, scripts/saat-wiederholen.mts und
 * scripts/saat-arbeitsblatt.mts (dessen Ausgabe ist `IDS_DATEI`). Weil der
 * Tisch beim Drucken schreibt, setzt `RESET` (ein Shell-Befehl) vor jeder
 * Größe die Datenbank auf die Saat zurück und startet den Server neu.
 *
 * Die Bilder liegen unter `.pruef-bilder/desktop-grund/` im Hauptordner
 * (`GRUND=<ordner>` überstimmt das, etwa aus einem Worktree). Abweichungen
 * landen als `<name>-neu.png` und `<name>-diff.png` in `AUS` (Vorgabe: ein
 * Ordner unter /tmp).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { anmelden, BASIS, browserStarten, fehlerSammeln, WURZEL } from "./gemeinsam.mjs";

const GRUNDBILD = process.argv.includes("--grund");
const GRUND = process.env.GRUND ?? path.join(WURZEL, ".pruef-bilder/desktop-grund");
const AUS = process.env.AUS ?? path.join(tmpdir(), "desktop-handy-gleich");
const IDS = JSON.parse(readFileSync(process.env.IDS_DATEI ?? path.join(GRUND, "ids.json"), "utf8"));
const RESET = process.env.RESET ?? "";
const NUR = process.env.NUR ? process.env.NUR.split(",") : null;

const GROESSEN = [
  { name: "360", width: 360, height: 800, mobil: true },
  { name: "390", width: 390, height: 844, mobil: true },
  { name: "800", width: 800, height: 900, mobil: false },
];
const SCHEMATA = ["light", "dark"];

if (GRUNDBILD) mkdirSync(GRUND, { recursive: true });
else if (!existsSync(GRUND)) {
  console.error(`Kein Grundbild unter ${GRUND}. Erst mit --grund auf dem unveränderten Stand laufen lassen (oder GRUND=<ordner>).`);
  process.exit(2);
}
mkdirSync(AUS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abweichungen = [];
const fehlerAlle = [];
let bilder = 0;

async function vergleichen(name, png) {
  const datei = path.join(GRUND, `${name}.png`);
  if (GRUNDBILD) {
    writeFileSync(datei, png);
    return;
  }
  if (!existsSync(datei)) {
    abweichungen.push(`${name}: kein Grundbild`);
    writeFileSync(path.join(AUS, `${name}-neu.png`), png);
    return;
  }
  const [a, b] = await Promise.all([
    sharp(readFileSync(datei)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    abweichungen.push(`${name}: Größe ${a.info.width}×${a.info.height} → ${b.info.width}×${b.info.height}`);
    writeFileSync(path.join(AUS, `${name}-neu.png`), png);
    return;
  }
  let n = 0;
  const diff = Buffer.alloc(a.data.length);
  for (let i = 0; i < a.data.length; i += 4) {
    const gleich = a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3];
    if (!gleich) n++;
    diff[i] = gleich ? a.data[i] >> 2 : 255;
    diff[i + 1] = gleich ? a.data[i + 1] >> 2 : 0;
    diff[i + 2] = gleich ? a.data[i + 2] >> 2 : 0;
    diff[i + 3] = 255;
  }
  if (n) {
    abweichungen.push(`${name}: ${n} Pixel anders`);
    writeFileSync(path.join(AUS, `${name}-neu.png`), png);
    await sharp(diff, { raw: { width: a.info.width, height: a.info.height, channels: 4 } }).png().toFile(path.join(AUS, `${name}-diff.png`));
  }
}

async function bild(page, name) {
  if (NUR && !NUR.some((x) => name.includes(x))) return;
  await page.evaluate(() => document.fonts.ready);
  // Erst ein ruhiges Bild: zwei Aufnahmen hintereinander müssen gleich sein
  let png = await page.screenshot({ animations: "disabled", caret: "hide" });
  for (let i = 0; i < 4; i++) {
    await sleep(400);
    const nochmal = await page.screenshot({ animations: "disabled", caret: "hide" });
    if (nochmal.equals(png)) break;
    png = nochmal;
  }
  bilder++;
  await vergleichen(name, png);
}

async function uhr(page, jetzt) {
  await page.goto(`${BASIS}/api/testuhr?jetzt=${jetzt}`);
  await page.waitForSelector("#whenrow", { state: "attached" });
  await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
  await sleep(1200);
}

async function seite(page, art, params, name) {
  const da = () =>
    page.evaluate(() => {
      const s = document.querySelector("#pages > .page:last-child .p-title");
      return !!s && !!s.textContent;
    });
  // Gleich nach dem Start liest der Server die gesäten Blätter; eine Antwort
  // kann dann scheitern („Keine Verbindung“). Ein zweiter Versuch genügt.
  for (let versuch = 0; versuch < 3 && !(await da()); versuch++) {
    await page.evaluate(([a, p]) => window.__kombi.openPage(a, p), [art, params]);
    await page.waitForFunction(() => {
      const s = document.querySelector("#pages > .page:last-child .p-title");
      return !!s && !!s.textContent;
    }, null, { timeout: 5000 }).catch(() => {});
  }
  if (!(await da())) throw new Error(`${name}: Seite ${art} öffnet nicht`);
  await sleep(1000);
  await bild(page, name);
  await page.evaluate(() => window.__kombi.popPage());
  await sleep(800);
}

const browser = await browserStarten();
try {
  for (const g of GROESSEN) {
    for (const schema of SCHEMATA) {
      if (RESET) {
        execSync(RESET, { stdio: "ignore" });
        await sleep(4000);
      }
      const vor = `${g.name}-${schema}`;
      console.log(vor);
      const ctx = await browser.newContext({
        serviceWorkers: "block",
        viewport: { width: g.width, height: g.height },
        deviceScaleFactor: 2,
        isMobile: g.mobil,
        hasTouch: g.mobil,
        colorScheme: schema,
        reducedMotion: "no-preference",
        locale: "de-DE",
        timezoneId: "Europe/Berlin",
      });
      const page = await ctx.newPage();
      const fehler = fehlerSammeln(page);
      await anmelden(page);

      // Start um 16:40: was die App von selbst zeigt, dann Überblick und Ablauf
      await uhr(page, "2026-10-14T16:40");
      await bild(page, `${vor}-start-1640`);
      await page.evaluate(() => window.__kombi.setView("ueberblick", { anim: false }));
      await sleep(900);
      await bild(page, `${vor}-ueberblick-1640`);
      await page.evaluate(() => window.__kombi.setView("ablauf", { anim: false }));
      await sleep(900);
      await bild(page, `${vor}-ablauf-1640`);
      await page.evaluate(() => window.__kombi.setView("ueberblick", { anim: false }));
      await sleep(700);

      const vorrat = await page.evaluate(async () => (await (await fetch("/api/zeile/vorrat")).json()).vorrat);
      const klausur = vorrat.klausuren.find((k) => k.datum === "2026-10-16") ?? vorrat.klausuren[0];
      const ablage = await page.evaluate(async () => (await (await fetch("/api/seite/ablage")).json()).daten);
      const blatt = ablage.gruppen.flatMap((g) => g.blaetter).find((b) => b.titel === "Arbeit in der Fabrik, Kinderarbeit") ?? ablage.gruppen[0].blaetter[0];

      await seite(page, "hausaufgaben", {}, `${vor}-hausaufgaben`);
      await seite(page, "woche", {}, `${vor}-woche`);
      await seite(page, "klausur", { id: klausur.id }, `${vor}-klausur`);
      await seite(page, "ablage", {}, `${vor}-ablage`);
      await seite(page, "blatt", { id: blatt.id }, `${vor}-blatt`);
      await seite(page, "einstellungen", {}, `${vor}-einstellungen`);

      // Zeile mit Menü
      await page.click("#field");
      await page.waitForSelector("#menu.open");
      await sleep(900);
      await bild(page, `${vor}-zeile-menue`);
      await page.keyboard.press("Escape");
      await sleep(700);

      // Ein offenes Sheet
      await page.evaluate(() => window.__kombi.openSheet("Ein Sheet zur Probe."));
      await page.waitForSelector("#sheet.open");
      await sleep(900);
      await bild(page, `${vor}-sheet`);
      await page.evaluate(() => window.__kombi.closeSheet());
      await sleep(700);

      // Tisch: Karten, Arbeitsblatt, Wie lief es?
      // Wiederholen beginnt mit Geschichte (Karten), wie der Überblick sagt
      await page.click("#whBtn");
      await page.waitForSelector("#tisch.open #tStack .sc");
      await sleep(1600);
      await bild(page, `${vor}-tisch-karten`);
      await page.keyboard.press("Escape");
      await sleep(900);
      await page.evaluate((thema) => window.__kombi.openTisch({ thema }), IDS.mathe);
      await page.waitForSelector(".tisch.open #tbMain");
      await sleep(1400);
      await bild(page, `${vor}-tisch-arbeitsblatt`);
      await page.evaluate(() => {
        window.print = () => {};
      });
      await page.click("#tbMain");
      await sleep(2400);
      await bild(page, `${vor}-tisch-wertung`);
      await page.keyboard.press("Escape");
      await sleep(900);

      // Morgens um 07:10
      await uhr(page, "2026-10-14T07:10");
      await bild(page, `${vor}-morgens-0710`);

      fehlerAlle.push(...fehler.map((f) => `${vor}: ${f}`));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

if (GRUNDBILD) {
  writeFileSync(path.join(GRUND, "ids.json"), JSON.stringify(IDS));
  console.log(`\nGrundbild: ${bilder} Bilder unter ${GRUND}`);
}
if (fehlerAlle.length) console.log(`\nKonsole:\n  ${fehlerAlle.join("\n  ")}`);
if (!GRUNDBILD) {
  if (abweichungen.length) console.log(`\nAbweichungen (${abweichungen.length} von ${bilder}), Bilder in ${AUS}:\n  ${abweichungen.join("\n  ")}`);
  else console.log(`\nHandy gleich: ${bilder} Bilder, 0 Abweichungen`);
}
process.exit(!GRUNDBILD && abweichungen.length ? 1 : 0);
