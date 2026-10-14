/**
 * Die Woche am Rechner (desktop.html `RENDER_woche`) bei 1024×700 (knapp),
 * 1280×800 und 1920×1080, hell und dunkel:
 *
 * - ein Raster Mo bis Fr, der Kopf mit Wochentag und Datum, heute mit Punkt;
 * - die Zeilen „Abgeben“, „Lernen“, dann die Stunden mit Beginn und Ende;
 * - „Lernen“ ohne Uhrzeit, „Starten“ steht unter dem Text (nie daneben);
 * - keine Zelle läuft in die Nachbarspalte, kein waagrechter Überlauf;
 * - „Diese Woche“ nur sichtbar, wenn eine andere Woche steht; die Pfeile
 *   schieben mit der Maus (200 ms), per Tastatur ohne Bewegung; ?tag= folgt;
 * - eine Ferienwoche ist eine einzige Zeile;
 * - Abhaken im Raster mit Rückgängig-Toast;
 * - Starten öffnet den Lernblock-Tisch (zuletzt, weil es schreibt);
 * - keine JS-Fehler.
 *
 *   BASIS=http://localhost:3383 node scripts/pruef-kombi/desktop-woche.mjs [bildordner]
 *
 * Voraussetzungen wie desktop-huelle.mjs: Produktionsbau mit
 * `SCHULAPP_TESTUHR=1` auf eigenem Port mit eigener Datenbank, gesät mit
 * scripts/saat-abruf.mts und scripts/pruef-kombi/saat-startseite.mts (dort
 * stehen die Herbstferien vom 26. bis 30.10.2026). Die Testuhr steht auf
 * Mi 14.10.2026 16:40.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { BASIS, browserStarten, fehlerSammeln, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const pr = new Pruefung("desktop-woche");
/** Satz, Bedingung, und was zu sehen war (nur bei ✖ ausgegeben). */
const p = { pruefe: (satz, ok, was) => pr.ok(ok, ok || !was ? satz : `${satz}: ${was}`) };
const BILDER = process.argv[2];
if (BILDER) mkdirSync(BILDER, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  await sleep(300);
  await page.screenshot({ path: path.join(BILDER, `${w}-${schema}-${name}.png`), animations: "disabled", caret: "hide" });
}

/** Läuft etwas aus seiner Zelle (in die Nachbarspalte)? Liefert die Übeltäter. */
const ueberlaeufer = (page) =>
  page.evaluate(() => {
    const aus = [];
    for (const zelle of document.querySelectorAll(".wk > *")) {
      const z = zelle.getBoundingClientRect();
      if (zelle.scrollWidth > zelle.clientWidth + 0.5) aus.push(`${zelle.className}: scrollWidth ${zelle.scrollWidth} > ${zelle.clientWidth}`);
      for (const el of zelle.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > z.right + 0.5 || r.left < z.left - 0.5) aus.push(`${zelle.className} > ${el.tagName.toLowerCase()}.${el.className}: ${el.textContent.slice(0, 40)}`);
      }
      // Text in Zeilen: jede Textzeile innerhalb der Zelle
      const walker = document.createTreeWalker(zelle, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const rg = document.createRange();
        rg.selectNodeContents(walker.currentNode);
        for (const r of rg.getClientRects()) {
          if (r.width && (r.right > z.right + 0.5 || r.left < z.left - 0.5)) aus.push(`Text „${walker.currentNode.textContent.slice(0, 30)}“ in ${zelle.className}`);
        }
      }
    }
    return [...new Set(aus)];
  });

const raster = (page) =>
  page.evaluate(() => {
    const g = document.querySelector(".wk");
    const kopf = [...document.querySelectorAll(".wk-h:not(.wk-corner)")];
    const diese = document.querySelector(".wk-nav .textbtn");
    return {
      da: !!g,
      spalten: g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0,
      zeitspalte: g ? parseFloat(getComputedStyle(g).gridTemplateColumns.split(" ")[0]) : 0,
      kopf: kopf.map((k) => k.textContent),
      heute: kopf.filter((k) => k.classList.contains("td")).map((k) => k.textContent),
      punkt: kopf.some((k) => k.classList.contains("td") && getComputedStyle(k.querySelector("b"), "::after").content !== "none"),
      labels: [...document.querySelectorAll(".wk-lab")].map((l) => l.textContent),
      zeiten: [...document.querySelectorAll(".wk-t")].map((t) => t.textContent),
      stunden: document.querySelectorAll(".wk-c b").length,
      hu: [...document.querySelectorAll(".wk-c em")].some((e) => e.textContent.startsWith("Hauptunterricht")),
      klausur: [...document.querySelectorAll(".wk-c .tag")].map((t) => t.textContent),
      aufgaben: document.querySelectorAll(".wk-x .mt").length,
      lernen: [...document.querySelectorAll(".wk-x .ml")].map((m) => m.textContent),
      frei: [...document.querySelectorAll(".wk-free")].map((f) => f.textContent),
      sub: document.querySelector(".wkd .d-sub")?.textContent ?? "",
      seitenTitel: [...document.querySelectorAll(".p-title")].filter((t) => t.offsetParent).length,
      dieseSichtbar: diese ? getComputedStyle(diese).visibility === "visible" : null,
      chip: document.querySelectorAll(".chip").length,
      ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 0.5,
    };
  });

/** „Starten“ steht unter dem Text, nie daneben. */
const startenDarunter = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".ml")]
      .filter((m) => m.querySelector(".lbbtn"))
      .map((m) => {
        const t = m.querySelector("p").getBoundingClientRect();
        const b = m.querySelector(".lbbtn").getBoundingClientRect();
        return b.top >= t.bottom - 0.5 && b.left <= t.left + 8;
      }),
  );

const browser = await browserStarten();
try {
  for (const g of GROESSEN) {
    for (const schema of ["light", "dark"]) {
      const w = g.width;
      const vor = `${w} ${schema}`;
      console.log(`${w}×${g.height} ${schema}`);
      const ctx = await browser.newContext({ viewport: g, deviceScaleFactor: 1, colorScheme: schema, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
      const page = await ctx.newPage();
      const fehler = fehlerSammeln(page);
      await anmelden(page);
      await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-14T16:40`);
      await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
      await sleep(800);

      // Über die Seitenleiste (Taste 4) in die Woche
      await page.keyboard.press("4");
      await page.waitForSelector(".wk", { timeout: 8000 });
      await sleep(900);
      const r = await raster(page);
      p.pruefe(`${vor}: Raster mit Zeitspalte und fünf Tagen`, r.da && r.spalten === 6, JSON.stringify(r.spalten));
      p.pruefe(`${vor}: Zeitspalte ${w < 1280 ? 72 : 76} px`, Math.round(r.zeitspalte) === (w < 1280 ? 72 : 76), String(r.zeitspalte));
      p.pruefe(`${vor}: Kopf Montag bis Freitag mit Datum`, r.kopf.length === 5 && r.kopf[0].startsWith("Montag") && r.kopf[4].startsWith("Freitag"), r.kopf.join(" | "));
      p.pruefe(`${vor}: heute mit Punkt und „heute“`, r.heute.length === 1 && r.heute[0].includes("heute") && r.heute[0].startsWith("Mittwoch") && r.punkt, r.heute.join());
      p.pruefe(`${vor}: Zeilen Abgeben, Lernen`, r.labels.join() === "Abgeben,Lernen", r.labels.join());
      p.pruefe(`${vor}: Stunden mit Beginn und Ende`, r.zeiten.length === 4 && r.zeiten[0] === "08:0009:30", r.zeiten.join(" | "));
      p.pruefe(`${vor}: Fächer, Hauptunterricht, Klausur in der Stunde`, r.stunden >= 15 && r.hu && r.klausur.some((k) => k.startsWith("Klausur: ")), `${r.stunden} ${r.klausur.join()}`);
      p.pruefe(`${vor}: Aufgaben im Raster`, r.aufgaben >= 1, String(r.aufgaben));
      p.pruefe(`${vor}: Lernen ohne Uhrzeit`, r.lernen.length >= 1 && r.lernen.every((t) => !/\d{1,2}:\d{2}/.test(t)), r.lernen.join(" | "));
      const darunter = await startenDarunter(page);
      p.pruefe(`${vor}: „Starten“ unter dem Text`, darunter.length >= 1 && darunter.every(Boolean), JSON.stringify(darunter));
      p.pruefe(`${vor}: ein Titel, Unterzeile im Kopf`, r.seitenTitel === 0 && /bis/.test(r.sub), `${r.seitenTitel} ${r.sub}`);
      p.pruefe(`${vor}: „Diese Woche“ verborgen in dieser Woche`, r.dieseSichtbar === false, String(r.dieseSichtbar));
      p.pruefe(`${vor}: kein .chip`, r.chip === 0, String(r.chip));
      p.pruefe(`${vor}: kein waagrechter Überlauf`, !r.ueberlauf, "");
      const ue = await ueberlaeufer(page);
      p.pruefe(`${vor}: keine Zelle läuft über`, ue.length === 0, ue.slice(0, 6).join(" ; "));
      await bild(page, "woche", w, schema);

      // Nächste Woche mit der Maus: schiebt, Adresse mit ?tag=
      await page.click('.wk-nav [aria-label="Nächste Woche"]');
      const bewegt = await page
        .waitForFunction(() => document.querySelector(".wk")?.getAnimations().length > 0, null, { timeout: 3000, polling: 10 })
        .then(() => true, () => false);
      await page.waitForFunction(() => document.querySelector(".wkd .d-sub")?.textContent.startsWith("19.10."), null, { timeout: 5000 });
      await sleep(400);
      const n = await raster(page);
      p.pruefe(`${vor}: Pfeil mit der Maus schiebt`, bewegt, "");
      p.pruefe(`${vor}: nächste Woche 19.10. bis 23.10.`, n.sub === "19.10. bis 23.10." && new URL(page.url()).searchParams.get("tag") === "2026-10-19", `${n.sub} ${page.url()}`);
      p.pruefe(`${vor}: „Diese Woche“ sichtbar`, n.dieseSichtbar === true, String(n.dieseSichtbar));

      // Per Tastatur: ohne Bewegung
      await page.focus('.wk-nav [aria-label="Nächste Woche"]');
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector(".wkd .d-sub")?.textContent.startsWith("26.10."), null, { timeout: 5000 });
      const still = await page.evaluate(() => document.querySelector(".wk").getAnimations().length === 0);
      p.pruefe(`${vor}: per Tastatur ohne Bewegung`, still, "");

      // Ferienwoche: eine Zeile
      await sleep(300);
      const f = await raster(page);
      p.pruefe(`${vor}: Ferienwoche ist eine Zeile`, f.frei.length === 1 && /ferien/i.test(f.frei[0]) && f.stunden === 0 && f.zeiten.length === 1, `${f.frei.join()} ${f.stunden} ${f.zeiten.length}`);
      const uf = await ueberlaeufer(page);
      p.pruefe(`${vor}: Ferienwoche ohne Überlauf`, uf.length === 0 && !f.ueberlauf, uf.join(" ; "));
      await bild(page, "ferien", w, schema);

      // Neuladen mit ?tag= zeigt dieselbe Woche
      await page.reload();
      await page.waitForSelector(".wk", { timeout: 8000 });
      await sleep(600);
      const nl = await raster(page);
      p.pruefe(`${vor}: ?tag= übersteht Neuladen`, nl.sub.startsWith("26.10."), nl.sub);
      p.pruefe(`${vor}: Direktaufruf mit einem Titel`, nl.seitenTitel === 0 && nl.frei.length === 1, `${nl.seitenTitel} ${nl.frei.join()}`);

      // Diese Woche
      await page.click(".wk-nav .textbtn");
      await page.waitForFunction(() => document.querySelector(".wkd .d-sub")?.textContent.startsWith("12.10."), null, { timeout: 5000 });
      await sleep(400);
      const d = await raster(page);
      p.pruefe(`${vor}: „Diese Woche“ führt zurück`, d.dieseSichtbar === false && !new URL(page.url()).searchParams.get("tag"), page.url());

      // Abhaken im Raster, Rückgängig im Toast
      const offen = page.locator('.wk-x .mt:not(.done) .check').first();
      const label = await offen.getAttribute("aria-label");
      await offen.click();
      await page.waitForFunction((l) => document.querySelector(`.wk-x .check[aria-label="${l.replace("abhaken", "wieder öffnen")}"]`), label, { timeout: 5000 });
      const toast = await page
        .waitForFunction(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).find((t) => /abgehakt/.test(t)), null, { timeout: 5000 })
        .then((h) => h.jsonValue(), () => page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ")));
      p.pruefe(`${vor}: Abhaken mit Toast und Rückgängig`, /abgehakt/.test(toast) && /Rückgängig/.test(toast), toast);
      if (w === 1280) await bild(page, "abgehakt", w, schema);
      await page.click(".toast button");
      await page.waitForFunction((l) => document.querySelector(`.wk-x .check[aria-label="${l}"]`), label, { timeout: 6000 });
      p.pruefe(`${vor}: Rückgängig öffnet wieder`, true, "");
      await sleep(600);

      // Starten öffnet den Tisch (schreibt: nur ganz am Ende)
      if (w === 1920 && schema === "dark") {
        await page.click(".ml .lbbtn");
        const tisch = await page.waitForSelector(".tisch.open, #tisch.open", { timeout: 6000 }).then(() => true, () => false);
        p.pruefe(`${vor}: Starten öffnet den Lernblock-Tisch`, tisch, "");
        await sleep(900);
        await bild(page, "tisch", w, schema);
      }

      p.pruefe(`${vor}: keine JS-Fehler`, fehler.length === 0, fehler.join(" ; "));
      await ctx.close();
    }
  }

  // Reduzierte Bewegung: der Wochenwechsel blendet nur über
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
    const page = await ctx.newPage();
    await anmelden(page);
    await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-14T16:40`);
    await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
    await page.goto(`${BASIS}/stundenplan`);
    await page.waitForSelector(".wk", { timeout: 8000 });
    await sleep(600);
    await page.click('.wk-nav [aria-label="Nächste Woche"]');
    const kf = await page
      .waitForFunction(() => document.querySelector(".wk")?.getAnimations()[0]?.effect.getKeyframes(), null, { timeout: 3000, polling: 10 })
      .then((h) => h.jsonValue(), () => null);
    p.pruefe("reduziert: Wochenwechsel nur Überblenden", !!kf && kf.every((k) => !k.transform || k.transform === "none"), JSON.stringify(kf));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(pr.gruen ? "\nWoche am Rechner: alles grün" : `\n${pr.ergebnisse.filter((e) => !e.ok).length} Prüfungen rot`);
process.exit(pr.gruen ? 0 : 1);
