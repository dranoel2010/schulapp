/**
 * Heute am Rechner (desktop.html `RENDER_heute`) bei 1024×700, 1280×800,
 * 1440×900 und 1920×1080, hell und dunkel, um 07:10, 16:40 und 20:30:
 *
 * - keine Datumszeile mit Zahnrad (die Seitenleiste trägt das Datum);
 * - links die Startseite, rechts die Packhilfe: am Morgen die Stunden von
 *   heute, sonst die des nächsten Schultags; Spaltenabstand 40, 64 und 96 px;
 * - Stunden und Woche nicht doppelt (links aus, rechts da);
 * - „Zuletzt abgelegt“ über die volle Breite, vier Blätter, ab 1440 px sechs;
 *   kein Text läuft aus seiner Zelle (Titel brechen mit Trennstrich um);
 * - um 16:40 kein Ablauf, sondern der Überblick;
 * - „Woche“ öffnet die Woche, ein Blatt die Ablage mit dem Blatt, „Alle“ die Ablage;
 * - kein waagrechter Überlauf, keine JS-Fehler.
 *
 *   BASIS=http://localhost:3381 node scripts/pruef-kombi/desktop-heute.mjs [bildordner]
 *
 * Voraussetzungen wie desktop-handy-gleich.mjs (Produktionsbau mit
 * `SCHULAPP_TESTUHR=1`, Saat saat-abruf, saat-startseite, saat-wiederholen,
 * saat-arbeitsblatt). Mit Bildordner legt es bei 1280 und 1920 Bilder ab
 * (dazu je ein Bild bei 1024 und 1440 hell um 16:40).
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { BASIS, browserStarten, fehlerSammeln, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const p = new Pruefung("desktop-heute");
const BILDER = process.argv[2];
if (BILDER) mkdirSync(BILDER, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GROESSEN = [
  { width: 1024, height: 700, abstand: 40 },
  { width: 1280, height: 800, abstand: 64 },
  { width: 1440, height: 900, abstand: 64 },
  { width: 1920, height: 1080, abstand: 96 },
];
/** Testuhr: Mittwoch, 14.10.2026; nächster Schultag Donnerstag, 15.10. */
const ZEITEN = [
  { uhr: "07:10", pack: "Mittwoch, 14.10." },
  { uhr: "16:40", pack: "Donnerstag, 15.10." },
  { uhr: "20:30", pack: "Donnerstag, 15.10." },
];

async function anmelden(page) {
  await page.goto(`${BASIS}/login`);
  await page.fill('input[name="password"]', PASSWORT);
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
}

async function uhr(page, hhmm) {
  await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-14T${hhmm}`);
  await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
  await page.evaluate(() => document.fonts.ready);
  await sleep(1200);
}

/** Text, der über seine Zelle läuft (Muster: UEBERLAUF der Entwurfsprüfung). */
const UEBERLAUF = () => {
  const out = [];
  const zellen = document.querySelectorAll("#homeScroll .tcell, #homeScroll .h-side, #homeScroll .mode.on, #homeScroll .lesson-row, #homeScroll .task");
  for (const el of zellen) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    for (const t of el.querySelectorAll("b, span, p, em, button, time")) {
      const q = t.getBoundingClientRect();
      if (!q.width || !t.textContent.trim() || t.classList.contains("lab-r")) continue;
      const cs = getComputedStyle(t);
      if (cs.visibility === "hidden") continue;
      if (q.right > r.right + 1 || (t.scrollWidth > t.clientWidth + 1 && cs.overflow === "visible"))
        out.push(`${el.className} > ${t.tagName}: ${t.textContent.slice(0, 40)}`);
    }
  }
  return [...new Set(out)];
};

const zustand = (page) =>
  page.evaluate(() => {
    const sichtbar = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
    const grid = document.querySelector("#homeScroll .h-grid");
    const modes = grid?.querySelector(":scope > .modes");
    const side = grid?.querySelector(":scope > .h-side");
    const cells = [...document.querySelectorAll("#homeScroll .d-thumbs .tcell")].filter(sichtbar);
    const mr = modes?.getBoundingClientRect();
    const sr = side?.getBoundingClientRect();
    return {
      datumszeile: sichtbar(document.getElementById("whenrow")),
      ablauf: document.getElementById("flow")?.classList.contains("on") ?? false,
      ansicht: document.querySelector("#homeScroll .mode.on")?.dataset.v ?? null,
      spalten: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
      abstand: grid ? parseFloat(getComputedStyle(grid).columnGap) : 0,
      eins: grid?.classList.contains("h-eins") ?? false,
      packSichtbar: sichtbar(side),
      packRechts: !!mr && !!sr && sichtbar(modes) ? sr.left >= mr.right : null,
      packTitel: side?.querySelector("#hPackLab")?.textContent ?? null,
      stunden: side ? side.querySelectorAll(".lesson-row").length : 0,
      linksStunden: [...document.querySelectorAll("#homeScroll .mode.on .mo-stunden, #homeScroll .mode.on .mo-woche")].some(sichtbar),
      handyBlaetter: sichtbar(document.getElementById("ovBl")),
      blaetter: cells.length,
      blaetterDa: window.__kombi.tagDaten.blaetter.length,
      breitUnten: (() => {
        const t = document.querySelector("#homeScroll .h-thumbs");
        const g = grid?.getBoundingClientRect();
        const b = t?.getBoundingClientRect();
        return !!g && !!b && sichtbar(t) && b.top >= g.bottom - 1 && Math.abs(b.left - g.left) < 1 && Math.abs(b.width - g.width) < 1;
      })(),
      ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 0.5,
    };
  });

async function bild(page, name) {
  if (!BILDER) return;
  await sleep(250);
  await page.screenshot({ path: path.join(BILDER, `${name}.png`), animations: "disabled", caret: "hide" });
}

const browser = await browserStarten();
const fehlerAlle = [];
try {
  for (const g of GROESSEN) {
    for (const schema of ["light", "dark"]) {
      const w = g.width;
      console.log(`${w}×${g.height} ${schema}`);
      const ctx = await browser.newContext({
        viewport: { width: g.width, height: g.height },
        deviceScaleFactor: 1,
        colorScheme: schema,
        locale: "de-DE",
        timezoneId: "Europe/Berlin",
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      const fehler = fehlerSammeln(page);
      await anmelden(page);
      for (const z of ZEITEN) {
        await uhr(page, z.uhr);
        const s = await zustand(page);
        const t = `${w} ${schema} ${z.uhr}`;
        p.ok(!s.datumszeile, `${t}: keine Datumszeile`);
        p.ok(!s.ablauf, `${t}: kein Ablauf (${s.ansicht})`);
        p.ok(s.packSichtbar && s.packTitel === z.pack, `${t}: Packhilfe „${s.packTitel}“`);
        p.ok(s.stunden > 0, `${t}: Packhilfe mit ${s.stunden} Stunden`);
        if (s.eins) p.ok(true, `${t}: links nichts abzugeben, die Packhilfe steht links`);
        else {
          p.ok(s.spalten === 2 && s.packRechts === true, `${t}: zwei Spalten, Packhilfe rechts`);
          p.ok(s.abstand === g.abstand, `${t}: Spaltenabstand ${s.abstand} (soll ${g.abstand})`);
        }
        p.ok(!s.linksStunden, `${t}: Stunden und Woche nicht doppelt`);
        p.ok(!s.handyBlaetter, `${t}: „Zuletzt abgelegt“ des Handys aus`);
        const soll = Math.min(s.blaetterDa, w >= 1440 ? 6 : 4);
        p.ok(s.blaetter === soll, `${t}: ${s.blaetter} Blätter (soll ${soll})`);
        p.ok(s.breitUnten, `${t}: „Zuletzt abgelegt“ breit unter beiden Spalten`);
        p.ok(!s.ueberlauf, `${t}: kein waagrechter Überlauf`);
        const ueber = await page.evaluate(UEBERLAUF);
        p.ok(!ueber.length, `${t}: kein Text über seiner Zelle${ueber.length ? ` (${ueber.join(" | ")})` : ""}`);
        if (w === 1280 || w === 1920 || (schema === "light" && z.uhr === "16:40")) await bild(page, `${w}-${schema}-${z.uhr.replace(":", "")}`);
      }

      // Wege, einmal je Größe (hell): Woche, ein Blatt, Alle
      if (schema === "light") {
        await uhr(page, "16:40");
        await page.click("#homeScroll .h-side .lab-r");
        await page.waitForFunction(() => document.getElementById("stage")?.dataset.v === "woche", null, { timeout: 5000 }).catch(() => {});
        p.ok((await page.evaluate(() => document.getElementById("stage")?.dataset.v)) === "woche", `${w}: „Woche“ öffnet die Woche`);
        await page.click('.rail .r-item[data-v="heute"]');
        await sleep(600);
        const id = await page.evaluate(() => document.querySelector("#homeScroll .d-thumbs .tcell")?.dataset.bid);
        await page.click("#homeScroll .d-thumbs .tcell");
        await page.waitForFunction(() => document.getElementById("stage")?.dataset.v === "ablage", null, { timeout: 5000 }).catch(() => {});
        await sleep(800);
        const ablage = await page.evaluate(() => ({
          v: document.getElementById("stage")?.dataset.v,
          url: location.pathname + location.search,
          detail: !!document.querySelector(".d-split .d-detail *"),
        }));
        p.ok(ablage.v === "ablage" && ablage.url.includes(id) && ablage.detail, `${w}: ein Blatt öffnet die Ablage mit dem Blatt (${ablage.url})`);
        await page.click('.rail .r-item[data-v="heute"]');
        await sleep(600);
        await page.click("#homeScroll .h-thumbs .lab-r");
        await page.waitForFunction(() => document.getElementById("stage")?.dataset.v === "ablage", null, { timeout: 5000 }).catch(() => {});
        p.ok((await page.evaluate(() => document.getElementById("stage")?.dataset.v)) === "ablage", `${w}: „Alle“ öffnet die Ablage`);
      }
      fehlerAlle.push(...fehler.map((f) => `${w} ${schema}: ${f}`));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
p.ok(!fehlerAlle.length, `keine JS-Fehler${fehlerAlle.length ? `: ${fehlerAlle.join(" | ")}` : ""}`);
console.log(p.gruen ? "\ndesktop-heute: grün" : "\ndesktop-heute: ROT");
process.exit(p.gruen ? 0 : 1);
