/**
 * Der Tisch am Rechner (desktop.html, „Tisch in Fensterbreite“) bei 1280×800
 * und 1920×1080, hell und dunkel, dazu 1024×700 hell (knappe Stufe):
 *
 * - Wiederholen: der Tisch füllt das Fenster, die Karten stehen in einer
 *   Spalte von 600 px in der Mitte, die Frage in 30 px; die Tasten stehen in
 *   den Knöpfen (.d-k, nicht .k). Leertaste deckt auf, 2 heißt Saß, Esc
 *   schließt.
 * - Arbeitsblatt (Übungsthema): links die Aufgabenseite in Lesegröße, die
 *   Lösungsseite zugeklappt (.d-fold) und NICHT als Papier im DOM; rechts die
 *   Spalte (400 px, ab 1680 px 440 px) mit Kopf, Zählwort und „Arbeitsblatt
 *   drucken“ mit P. P druckt (beide Seiten in #druck), danach „Wie lief es?“:
 *   bei 1920 stehen Aufgaben und Lösungen nebeneinander (je ≥ 560 px), bei
 *   1280 untereinander, und die Ansicht ist zur Lösungsseite gesprungen.
 *   Alle Zeilen bewerten, „Fertig“: „… sitzt.“/„… geübt.“
 * - Lernblock mit Arbeitsblatt: Kopf „Mathematik · Lernblock“, die Uhr oben
 *   rechts, ein Klick hält sie an; drucken, bewerten, „Blatt ausgewertet.“
 *   rechts in der Spalte, die Seiten bleiben links liegen.
 * - Öffnen aus dem Knopf: die Fläche wächst per transform (keine clip-path).
 * - kein waagrechter Überlauf, keine JS-Fehler.
 *
 *   BASIS=http://localhost:3385 IDS_DATEI=<ids.json> RESET='<befehl>' \
 *     node scripts/pruef-kombi/desktop-tisch.mjs [bildordner]
 *
 * Voraussetzungen wie desktop-handy-gleich.mjs: Produktionsbau mit
 * `SCHULAPP_TESTUHR=1` auf eigenem Port mit eigener Datenbank, gesät mit
 * saat-abruf, pruef-kombi/saat-startseite, saat-wiederholen und
 * saat-arbeitsblatt (dessen Ausgabe ist `IDS_DATEI`). Drucken und Bewerten
 * schreiben; `RESET` setzt vor jedem Durchgang die Saat zurück.
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { BASIS, browserStarten, fehlerSammeln, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const p = new Pruefung("desktop-tisch");
const BILDER = process.argv[2];
if (BILDER) mkdirSync(BILDER, { recursive: true });
const IDS = JSON.parse(readFileSync(process.env.IDS_DATEI, "utf8"));
const RESET = process.env.RESET ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A4W = (210 * 96) / 25.4;
const GROESSEN = [
  { width: 1024, height: 700 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

async function anmelden(page) {
  await page.goto(`${BASIS}/login`);
  await page.fill('input[name="password"]', PASSWORT);
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
}

async function bild(page, name, w, schema) {
  if (!BILDER) return;
  await sleep(350);
  await page.screenshot({ path: path.join(BILDER, `${w}-${schema}-${name}.png`), animations: "disabled", caret: "hide" });
}

const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 0.5);
const tisch = (page) =>
  page.evaluate(() => {
    const t = document.querySelector(".tisch.open");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const box = (s) => {
      const e = t.querySelector(s);
      if (!e || !e.offsetParent) return null;
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      id: t.id,
      w: Math.round(r.width),
      h: Math.round(r.height),
      stack: box(".t-stack"),
      foot: box(".t-foot"),
      frage: (() => {
        const q = t.querySelector('.sc[data-pos="0"] .c-q p');
        return q ? parseFloat(getComputedStyle(q).fontSize) : null;
      })(),
      kbd: [...t.querySelectorAll(".rb .d-k")].map((x) => x.textContent),
      altK: t.querySelectorAll(".rb .k").length,
      papiere: [...t.querySelectorAll(".d-pages .tb-paper")].map((x) => Math.round(x.getBoundingClientRect().width)),
      zwei: !!t.querySelector(".d-pages.two"),
      fold: box(".d-fold"),
      side: box(".d-side"),
      scroll: t.querySelector(".d-pages")?.scrollTop ?? null,
      lupe: !!t.querySelector(".tb-lupe:not([hidden])"),
      main: t.querySelector("#tbMain")?.textContent ?? null,
      fach: t.querySelector(".d-side .t-fach")?.textContent ?? null,
      thema: t.querySelector(".d-side .t-thema")?.textContent ?? null,
      themaH: Math.round(t.querySelector(".d-side .t-thema")?.getBoundingClientRect().height ?? 0),
      lead: t.querySelector(".d-side .d-lead")?.textContent ?? null,
      ende: t.querySelector(".d-side .t-end h2, .tisch > .t-end.on h2")?.textContent ?? document.querySelector(".tisch.open > .t-end.on h2")?.textContent ?? null,
      uhr: t.querySelector(".t-clock")?.textContent ?? null,
      uhrPause: !!t.querySelector(".t-clock.paused"),
      druck: document.querySelectorAll("#druck .a4").length,
    };
  });

const browser = await browserStarten();
try {
  for (const g of GROESSEN) {
    for (const schema of g.width === 1024 ? ["light"] : ["light", "dark"]) {
      const w = g.width;
      const vor = `${w} ${schema}`;
      console.log(`${w}×${g.height} ${schema}`);
      const ctx = await browser.newContext({ viewport: g, deviceScaleFactor: 1, colorScheme: schema, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
      const page = await ctx.newPage();
      const fehler = fehlerSammeln(page);
      // Frische Saat und frische Anmeldung: das Blatt des Lernblocks ist dasselbe wie das des Übungsthemas
      const frisch = async () => {
        if (RESET) {
          execSync(RESET, { stdio: "ignore" });
          await sleep(3000);
        }
        await anmelden(page);
        await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-14T16:40`);
        await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
        await page.evaluate(() => {
          window.__druck = 0;
          window.print = () => {
            window.__druck++;
          };
        });
        await sleep(1200);
      };
      await frisch();

      // ── Wiederholen: aus dem Knopf, per transform ─────────────────────────
      const wh = page.locator("#whBtn");
      if (await wh.count()) {
        await page.evaluate(() => {
          window.__wachsen = [];
          const orig = Element.prototype.animate;
          Element.prototype.animate = function (k, o) {
            if (this.classList?.contains("t-surface")) window.__wachsen.push(JSON.stringify(k));
            return orig.call(this, k, o);
          };
        });
        await wh.click();
        await page.waitForSelector(".tisch.open .t-stack .sc");
        await sleep(200);
        const wachsen = await page.evaluate(() => window.__wachsen.join(" "));
        p.ok(/scale\(/.test(wachsen) && !/clipPath/.test(wachsen), `${vor}: Tisch wächst per transform aus dem Knopf`);
        await sleep(1400);
        const k = await tisch(page);
        p.ok(k.w === w && k.h === g.height, `${vor}: Tisch füllt das Fenster (${k.w}×${k.h})`);
        p.ok(k.stack && k.stack.w === 600 && Math.abs(k.stack.x + 300 - w / 2) <= 1, `${vor}: Karten in einer Spalte von 600 px in der Mitte (${JSON.stringify(k.stack)})`);
        p.ok(k.frage === 30, `${vor}: Frage in 30 px (${k.frage})`);
        p.ok(k.kbd.join(",") === "Leertaste,1,2" && k.altK === 0, `${vor}: Tasten in den Knöpfen (${k.kbd.join(",")})`);
        p.ok(k.foot && k.foot.y - (k.stack.y + k.stack.h) === 56, `${vor}: Knöpfe 56 px unter der Karte`);
        await bild(page, "wiederholen-frage", w, schema);
        await page.locator('.tisch.open .sc[data-pos="0"] textarea').fill("Dampfmaschine und Fabriken");
        await page.locator("body").click({ position: { x: 5, y: g.height - 5 } }).catch(() => {});
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press(" ");
        await sleep(1200);
        const auf = await page.evaluate(() => !!document.querySelector('.tisch.open .sc[data-pos="0"].flipped'));
        p.ok(auf, `${vor}: Leertaste deckt auf`);
        const k2 = await tisch(page);
        p.ok(k2.foot && k2.foot.y + k2.foot.h <= g.height, `${vor}: aufgedeckt bleiben die Knöpfe im Bild`);
        await bild(page, "wiederholen-aufgedeckt", w, schema);
        const vorher = await page.evaluate(() => document.querySelector('.tisch.open .sc[data-pos="0"]')?.dataset.id);
        await page.keyboard.press("2");
        await sleep(1200);
        const nachher = await page.evaluate(() => document.querySelector('.tisch.open .sc[data-pos="0"]')?.dataset.id);
        p.ok(vorher && nachher !== vorher, `${vor}: 2 heißt Saß, die nächste Karte liegt oben`);
        p.ok(!(await ueberlauf(page)), `${vor}: kein waagrechter Überlauf (Karten)`);
        await page.keyboard.press("Escape");
        await sleep(900);
        p.ok(!(await page.evaluate(() => !!document.querySelector(".tisch.open"))), `${vor}: Esc schließt den Tisch`);
      } else p.ok(false, `${vor}: Knopf „Wiederholen“ fehlt auf Heute`);

      // ── Arbeitsblatt eines Übungsthemas ───────────────────────────────────
      await page.evaluate((thema) => window.__kombi.openTisch({ thema }), IDS.mathe);
      await page.waitForSelector(".tisch.open .d-blatt .tb-paper");
      await sleep(1200);
      let b = await tisch(page);
      const sideW = w >= 1680 ? 440 : 400;
      p.ok(b.side && b.side.w === sideW, `${vor}: Spalte rechts ${sideW} px (${b.side?.w})`);
      p.ok(b.papiere.length === 1, `${vor}: vor dem Druck nur die Aufgabenseite als Papier (${b.papiere.length})`);
      p.ok(!!b.fold, `${vor}: Lösungsseite zugeklappt („Erst nach dem Lösen“)`);
      const flaeche = w - sideW - 80;
      p.ok(Math.abs(b.papiere[0] - Math.min(A4W, flaeche)) <= 2, `${vor}: Lesegröße min(A4, Fläche) (${b.papiere[0]} px)`);
      p.ok(b.fold && Math.abs(b.fold.w - b.papiere[0]) <= 2, `${vor}: Falz so breit wie die Seite`);
      p.ok(b.main?.startsWith("Arbeitsblatt drucken") && b.main.endsWith("P"), `${vor}: „Arbeitsblatt drucken“ mit P (${b.main})`);
      p.ok(/^Arbeitsblatt · \d+ Aufgaben, etwa \d+ Minuten$/.test(b.lead ?? ""), `${vor}: Zählwort (${b.lead})`);
      p.ok(b.thema === "Quadratische Funktionen", `${vor}: Thema rechts (${b.thema})`);
      p.ok(!(await ueberlauf(page)), `${vor}: kein waagrechter Überlauf (Blatt)`);
      await bild(page, "blatt-vorschau", w, schema);
      await page.keyboard.press("p");
      await page.waitForSelector(".tisch.open .d-side .tb-wert");
      await sleep(1400);
      b = await tisch(page);
      const druck = await page.evaluate(() => window.__druck);
      p.ok(druck === 1 && b.druck === 2, `${vor}: P druckt beide Seiten (${druck}, #druck ${b.druck})`);
      p.ok(b.papiere.length === 2 && !b.fold, `${vor}: in „Wie lief es?“ klappt die Lösungsseite auf`);
      if (w >= 1920) p.ok(b.zwei && b.papiere.every((x) => x >= 560), `${vor}: Aufgaben und Lösungen nebeneinander (${b.papiere.join(", ")})`);
      else p.ok(!b.zwei && b.scroll > 100, `${vor}: untereinander, Ansicht bei der Lösungsseite (scrollTop ${b.scroll})`);
      p.ok(b.themaH >= 28, `${vor}: das Thema bleibt über „Wie lief es?“ stehen (${b.themaH} px)`);
      await bild(page, "blatt-wertung", w, schema);
      const n = await page.locator(".tisch.open .tb-row").count();
      for (let i = 0; i < n; i++) await page.locator(`.tisch.open .tb-row >> nth=${i} >> button[data-v="${i === 2 ? "false" : "true"}"]`).click();
      await sleep(400);
      await page.locator(".tisch.open #tbMain").click();
      await sleep(1600);
      b = await tisch(page);
      p.ok(/Quadratische Funktionen (sitzt|geübt)\./.test(b.ende ?? ""), `${vor}: Themenende nach „Fertig“ (${b.ende})`);
      await bild(page, "blatt-ende", w, schema);
      await page.keyboard.press("Escape");
      await sleep(900);

      // ── Lernblock mit Arbeitsblatt ─────────────────────────────────────────
      if (RESET) await frisch();
      await page.evaluate((id) => window.__kombi.openTisch({ mode: "block", blatt: true, block: id, blockId: id }), IDS.block);
      await page.waitForSelector(".tisch.open .d-blatt .tb-paper");
      await sleep(1400);
      b = await tisch(page);
      p.ok(b.fach === "Mathematik · Lernblock", `${vor}: Lernblock-Kopf (${b.fach} / ${b.thema})`);
      p.ok(!!b.uhr && /\d+:\d\d/.test(b.uhr), `${vor}: Uhr oben rechts (${b.uhr})`);
      await page.locator(".tisch.open .t-clock").click();
      await sleep(600);
      p.ok((await tisch(page)).uhrPause, `${vor}: ein Klick hält die Uhr an`);
      await page.locator(".tisch.open .t-clock").click();
      await sleep(400);
      await bild(page, "lernblock-blatt", w, schema);
      await page.locator(".tisch.open #tbMain").click();
      await page.waitForSelector(".tisch.open .d-side .tb-wert");
      await sleep(900);
      const m = await page.locator(".tisch.open .tb-row").count();
      for (let i = 0; i < m; i++) await page.locator(`.tisch.open .tb-row >> nth=${i} >> button[data-v="true"]`).click();
      await sleep(300);
      await page.locator(".tisch.open #tbMain").click();
      await sleep(1600);
      b = await tisch(page);
      p.ok(b.ende === "Blatt ausgewertet." && b.papiere.length === 2, `${vor}: „Blatt ausgewertet.“ rechts, die Seiten bleiben (${b.ende})`);
      await bild(page, "lernblock-ende", w, schema);
      await page.keyboard.press("Escape");
      await sleep(900);

      // ── Lernblock ohne Arbeitsblatt: dieselben Karten, oben rechts die Uhr ──
      // (eigene Saat: saat-abruf, dann saat-lernblock --fragen; LB_RESET setzt sie ein)
      if (process.env.LB_RESET) {
        execSync(process.env.LB_RESET, { stdio: "ignore" });
        await sleep(3000);
        await anmelden(page);
        await sleep(1200);
        await page.locator("#lbBtn").click();
        await page.waitForSelector(".tisch.open .t-stack .sc");
        await sleep(1600);
        const l = await tisch(page);
        p.ok(!!l.uhr && /\d+:\d\d/.test(l.uhr), `${vor}: Lernblock-Karten mit Uhr oben rechts (${l.uhr})`);
        p.ok(l.stack && l.stack.w === 600 && Math.abs(l.stack.x + 300 - w / 2) <= 1, `${vor}: Lernblock-Karten in der Spalte von 600 px`);
        p.ok(l.kbd.join(",") === "Leertaste,1,2", `${vor}: Tasten in den Knöpfen (${l.kbd.join(",")})`);
        await bild(page, "lernblock-karten", w, schema);
        await page.locator('.tisch.open .sc[data-pos="0"] textarea').fill("Am d und e");
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press(" ");
        await sleep(1200);
        p.ok(await page.evaluate(() => !!document.querySelector('.tisch.open .sc[data-pos="0"].flipped')), `${vor}: Leertaste deckt im Lernblock auf`);
        await bild(page, "lernblock-karten-aufgedeckt", w, schema);
        await page.keyboard.press("1");
        await sleep(1200);
        p.ok(await page.evaluate(() => !document.querySelector('.tisch.open .sc[data-pos="0"].flipped')), `${vor}: 1 heißt Daneben, die nächste Karte liegt oben`);
        await page.keyboard.press("Escape");
        await sleep(900);
      }

      p.ok(!fehler.length, fehler.length ? `${vor}: Konsole: ${fehler.join(" | ")}` : `${vor}: keine JS-Fehler`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(p.gruen ? "\nDesktop-Tisch: alles grün" : "\nDesktop-Tisch: FEHLER");
process.exit(p.gruen ? 0 : 1);
