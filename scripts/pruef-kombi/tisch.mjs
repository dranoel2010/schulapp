/**
 * Abschnitt E: der Tisch beim Wiederholen neben dem Prototyp (Plan 5.4).
 * 390×844 und 360×800, hell und dunkel; je Zustand ein Bild der App und eins
 * des Prototyps mit gleichem Namen, dazu ein Maßvergleich der Bausteine.
 *
 *   BASIS=http://localhost:3313 RESET=<skript> node scripts/pruef-kombi/tisch.mjs <ausgabeordner> [390-hell …]
 *
 * Voraussetzungen: Produktionsbau mit `SCHULAPP_TESTUHR=1`, Saat aus
 * `scripts/saat-abruf.mts` und `scripts/saat-wiederholen.mts`. Eine Runde
 * schreibt Versuche und `done_at`; `RESET` ist ein Befehl, der vor jeder
 * Größe die Saat zurücksetzt (Server stoppen, `saat-wiederholen.mts
 * --zuruecksetzen`, Server starten — nie zwei PGlite auf denselben Dateien).
 */

import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { anmelden, browserStarten, fehlerSammeln, kontext, Pruefung, WURZEL } from "./gemeinsam.mjs";

const AUS = process.argv[2];
if (!AUS) throw new Error("Ausgabeordner fehlt");
mkdirSync(AUS, { recursive: true });
const NUR = process.argv.slice(3);

const PROTO = `file://${path.join(WURZEL, "entwurf-modelle/23-kombi-v2/index.html")}?zeit=16:40&reset`;
const p = new Pruefung("tisch");
const browser = await browserStarten();

const masse = (page) =>
  page.evaluate(() => {
    const r = (s) => {
      const el = document.querySelector(s);
      if (!el || !el.offsetParent) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    };
    const t = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
    return {
      kopf: r("#tHead"),
      fach: t("#tFach"),
      thema: t("#tThema"),
      von: t("#tOf"),
      zaehler: t("#tCount"),
      striche: document.querySelectorAll("#tTicks .tick").length,
      stapel: r("#tStack"),
      karte: r('#tStack .sc[data-pos="0"]'),
      fuss: r("#tFoot"),
      knopfL: r("#tAsk .rb, #tRate .rb"),
      frage: t('#tStack .sc[data-pos="0"] .c-q p'),
    };
  });

/** Bedienelemente auf dem Tisch unter 44×44 (Grundsatz 1.6). */
const zuKlein = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#tisch button, #tisch textarea, #ovWh button")]
      .filter((b) => {
        if (!b.offsetParent || getComputedStyle(b).visibility === "hidden") return false;
        if (b.closest("[inert]") || b.closest('.sc:not([data-pos="0"])')) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && (r.width < 44 || r.height < 44);
      })
      .map((b) => `${b.textContent.trim() || b.getAttribute("aria-label")} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`),
  );

async function bild(page, name, wer) {
  await page.screenshot({ path: path.join(AUS, `${name}-${wer}.png`) });
}

/** Warten, bis die Rückseite der obersten Karte gefüllt ist (App: Lösung vom Server). */
const loesungDa = (page) =>
  page.waitForFunction(() => {
    const top = document.querySelector('#tStack .sc[data-pos="0"]');
    return top && top.classList.contains("flipped") && top.querySelector(".cb-sol li");
  }, null, { timeout: 8000 });

async function runde(page, wer, tag) {
  const out = {};
  await page.click("#whBtn");
  await page.waitForSelector("#tisch.open");
  await page.waitForTimeout(900);
  await bild(page, `${tag}-1-frage`, wer);
  out.frage = await masse(page);
  out.klein = await zuKlein(page);

  await page.click('#tStack .sc[data-pos="0"] textarea');
  await page.keyboard.type("England, um 1760");
  await page.waitForTimeout(300);
  await bild(page, `${tag}-2-tippen`, wer);

  await page.click("#tReveal");
  await loesungDa(page);
  await page.waitForTimeout(600);
  await bild(page, `${tag}-3-loesung`, wer);
  out.loesung = await masse(page);

  await page.click('#tStack .sc[data-pos="0"] .cb-heft');
  await page.waitForTimeout(500);
  await bild(page, `${tag}-4-stelle`, wer);
  out.stelle = await masse(page);

  await page.click('#tStack .sc[data-pos="0"] .cb-retire');
  await page.waitForTimeout(500);
  await bild(page, `${tag}-5-zurueckziehen`, wer);
  out.kleinLoesung = await zuKlein(page);
  await page.click('#tStack .sc[data-pos="0"] .cb-ask button:not(.yes)');

  await page.click('#tRate .rb[data-r="sass"]');
  await page.waitForTimeout(450);
  await page.click("#tDunno");
  await loesungDa(page);
  await page.click('#tRate .rb[data-r="daneben"]');
  await page.waitForTimeout(600);
  await bild(page, `${tag}-6-daneben`, wer);
  out.daneben = await masse(page);

  for (let i = 0; i < 20; i++) {
    if (await page.$("#tEnd.on")) break;
    await page.click("#tReveal");
    await loesungDa(page);
    await page.click('#tRate .rb[data-r="sass"]');
    await page.waitForTimeout(120);
  }
  await page.waitForSelector("#tEnd.on");
  await page.waitForTimeout(700);
  await bild(page, `${tag}-7-themenende`, wer);
  out.ende = await page.evaluate(() => [...document.querySelectorAll("#tEnd h2, #tEnd p, #tEnd button")].map((e) => e.textContent.trim()));
  out.kleinEnde = await zuKlein(page);
  out.themeTisch = await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));

  await page.click("#tEnd button:not(.known)");
  // beim Schrumpfen trägt der Knopf schon die neue Zahl (Kriterium 44)
  out.geist = await page.evaluate(() => document.querySelector("#tGhost")?.textContent ?? null);
  await page.waitForTimeout(900);
  out.nach = await page.evaluate(() => ({
    knopf: document.querySelector("#whBtn")?.textContent?.trim() ?? null,
    sub: document.querySelector("#whSub")?.textContent?.trim() ?? null,
  }));
  out.themePapier = await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));
  return out;
}

try {
  for (const groesse of ["390", "360"]) {
    for (const schema of ["light", "dark"]) {
      const tag = `${groesse}-${schema === "light" ? "hell" : "dunkel"}`;
      if (NUR.length && !NUR.includes(tag)) continue;
      console.log(`\n${tag}`);
      if (process.env.RESET) execSync(process.env.RESET, { stdio: "inherit" });

      const ctxA = await kontext(browser, { groesse, schema });
      const app = await ctxA.newPage();
      const fehlerA = fehlerSammeln(app);
      await anmelden(app);
      await app.waitForSelector("#whBtn");
      await app.waitForTimeout(700);
      const whA = await app.evaluate(() => [document.querySelector("#whBtn")?.textContent, document.querySelector("#whSub")?.textContent]);
      await app.locator("#ovWh").screenshot({ path: path.join(AUS, `${tag}-0-wh-app.png`) });

      const ctxP = await kontext(browser, { groesse, schema });
      const proto = await ctxP.newPage();
      const fehlerP = fehlerSammeln(proto);
      await proto.goto(PROTO);
      await proto.waitForTimeout(600);
      const skip = proto.getByRole("button", { name: "Überspringen" });
      if (await skip.isVisible().catch(() => false)) {
        await skip.click();
        await proto.waitForTimeout(700);
      }
      await proto.waitForSelector("#whBtn");
      const whP = await proto.evaluate(() => [document.querySelector("#whBtn")?.textContent, document.querySelector("#whSub")?.textContent]);
      await proto.locator("#ovWh").screenshot({ path: path.join(AUS, `${tag}-0-wh-proto.png`) });
      p.ok(JSON.stringify(whA) === JSON.stringify(whP), `Wiederholen-Knopf: App ${JSON.stringify(whA)} · Prototyp ${JSON.stringify(whP)}`);

      const a = await runde(app, "app", tag);
      const b = await runde(proto, "proto", tag);
      for (const k of ["frage", "loesung", "stelle", "daneben"]) {
        for (const f of Object.keys(a[k])) {
          const x = a[k][f];
          const y = b[k][f];
          const ok = Array.isArray(x) && Array.isArray(y) ? x.every((v, i) => Math.abs(v - y[i]) <= 2) : JSON.stringify(x) === JSON.stringify(y);
          p.ok(ok, `${k}.${f}: App ${JSON.stringify(x)} · Prototyp ${JSON.stringify(y)}`);
        }
      }
      p.ok(JSON.stringify(a.ende) === JSON.stringify(b.ende), `Themenende: App ${JSON.stringify(a.ende)} · Prototyp ${JSON.stringify(b.ende)}`);
      p.ok(a.geist === b.geist && a.geist === "Wiederholen2 Themen", `Schrumpfen: Knopf zählt schon um (App ${a.geist} · Prototyp ${b.geist})`);
      p.ok(JSON.stringify(a.nach) === JSON.stringify(b.nach), `nach „Für heute aufhören“: App ${JSON.stringify(a.nach)} · Prototyp ${JSON.stringify(b.nach)}`);
      p.ok(a.themeTisch.every((c) => c === (schema === "light" ? "#2A44C0" : "#121A4E")), `theme-color Tisch ${a.themeTisch}`);
      p.ok(a.themePapier.every((c) => c === (schema === "light" ? "#F7F7F5" : "#141416")), `theme-color Papier ${a.themePapier}`);
      p.ok(!a.klein.length && !a.kleinLoesung.length && !a.kleinEnde.length, `keine Tippfläche unter 44×44: ${[...a.klein, ...a.kleinLoesung, ...a.kleinEnde].join(", ") || "—"}`);
      p.ok(fehlerA.length === 0, `Konsole der App ohne Fehler ${fehlerA.join(" | ")}`);
      if (fehlerP.length) console.log(`  (Prototyp-Konsole: ${fehlerP.join(" | ")})`);
      await ctxA.close();
      await ctxP.close();
    }
  }
} finally {
  await browser.close();
}
console.log(p.gruen ? "\nAlles grün." : "\nNicht alles grün.");
process.exit(p.gruen ? 0 : 1);
