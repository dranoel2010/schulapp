/**
 * Gemeinsames für die Playwright-Prüfungen von Modell 23 (Plan 5.4).
 *
 *   BASIS=http://localhost:3301 node scripts/pruef-kombi/stapel.mjs
 *
 * Voraussetzungen: Produktionsbau mit `SCHULAPP_TESTUHR=1` (Probe-Seite,
 * Prüfschalter, `window.__kombi`), Konto aus scripts/saat-abruf.mts
 * (Passwort `probe1234`). Nie gegen den NAS.
 *
 * Chrome startet IMMER mit der Testkamera (`--use-fake-device-for-media-
 * stream`, `--use-fake-ui-for-media-stream`); vor jedem Kameratest prüft
 * `testkameraPruefen()`, dass die Videospur ein „fake“-Label trägt, sonst
 * bricht das Skript ab. Kamera-Berechtigungen werden nie per
 * `grantPermissions` erteilt.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "../../node_modules/playwright-core/index.mjs";

export const BASIS = process.env.BASIS ?? "http://localhost:3301";
export const PASSWORT = process.env.PASSWORT ?? "probe1234";
export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const GROESSEN = {
  "390": { width: 390, height: 844 },
  "360": { width: 360, height: 800 },
  "375": { width: 375, height: 667 },
};

export async function browserStarten() {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
}

/** Vor jedem Kameratest: nur die Testkamera, nie eine echte. */
export async function testkameraPruefen(page) {
  const label = await page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    const l = s.getVideoTracks()[0]?.label ?? "";
    s.getTracks().forEach((t) => t.stop());
    return l;
  });
  if (!/fake/i.test(label)) {
    throw new Error(`Abbruch: Videospur „${label}“ ist keine Testkamera.`);
  }
  return label;
}

export async function kontext(browser, { groesse = "390", schema = "light", reduziert = false, video, ohneSW = false } = {}) {
  return browser.newContext({
    // Init-Skripte laufen in Seiten, die der Service Worker ausliefert, nicht
    // verlässlich — Prüfungen mit Init-Skript schalten ihn ab.
    ...(ohneSW ? { serviceWorkers: "block" } : {}),
    viewport: GROESSEN[groesse],
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: schema,
    reducedMotion: reduziert ? "reduce" : "no-preference",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    ...(video ? { recordVideo: { dir: video, size: GROESSEN[groesse] } } : {}),
  });
}

export async function anmelden(page) {
  await page.goto(`${BASIS}/login`);
  await page.fill('input[name="password"]', PASSWORT);
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
  await page.waitForSelector("#whenrow");
}

/** Konsolenfehler und Seitenfehler sammeln. */
export function fehlerSammeln(page) {
  const fehler = [];
  page.on("console", (m) => {
    if (m.type() === "error") fehler.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => fehler.push(`pageerror: ${e.message}`));
  return fehler;
}

/** Titel der obersten sichtbaren Ebene im Stapel, oder null. */
export async function obersteSeite(page) {
  return page.evaluate(() => {
    const seiten = [...document.querySelectorAll("#pages > .page")];
    const oben = seiten[seiten.length - 1];
    if (!oben) return null;
    const t = oben.querySelector(".p-title");
    return t ? t.textContent : oben.getAttribute("aria-label");
  });
}

export async function seitenZahl(page) {
  return page.evaluate(() => document.querySelectorAll("#pages > .page").length);
}

/** Warten, bis keine Animation mehr läuft (Einfahren, Ausfahren). */
export async function ruhe(page, ms = 450) {
  await page.waitForTimeout(ms);
}

export class Pruefung {
  constructor(name) {
    this.name = name;
    this.ergebnisse = [];
  }
  ok(bedingung, satz) {
    this.ergebnisse.push({ ok: !!bedingung, satz });
    console.log(`${bedingung ? "  ✔" : "  ✖"} ${satz}`);
  }
  get gruen() {
    return this.ergebnisse.every((e) => e.ok);
  }
}
