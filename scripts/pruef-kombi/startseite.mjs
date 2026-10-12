/**
 * Abschnitt B (Startseite) gegen den Prototyp: Morgens, Überblick, Morgen
 * früh zu den Zeitpunkten aus V2 15.1–15.4, bei 390×844 und 360×800 (dazu
 * 375×667), hell und dunkel. Je Fall ein Bild der App, eins des Prototyps und
 * eins nebeneinander, dazu Messungen (Scrollhöhe, Tippflächen, Konsole).
 *
 *   BASIS=http://localhost:3310 node scripts/pruef-kombi/startseite.mjs <ausgabeordner>
 *
 * Voraussetzungen: Produktionsbau mit `SCHULAPP_TESTUHR=1`, Saat
 * scripts/pruef-kombi/saat-startseite.mts. Die Uhr stellt die App über
 * /api/testuhr, der Prototyp über `?zeit=…&reset`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { anmelden, BASIS, browserStarten, fehlerSammeln, kontext, WURZEL } from "./gemeinsam.mjs";

const aus = process.argv[2] ?? path.join(tmpdir(), "pruef-startseite");
mkdirSync(aus, { recursive: true });
const PROTO = pathToFileURL(path.join(WURZEL, "entwurf-modelle/23-kombi-v2/index.html")).href;

/** Fälle: Name, Zeit, Tag, Aktion im Prototyp (der App fehlt der Ablauf bis C). */
const FAELLE = [
  { name: "mo-0710", zeit: "07:10", tag: "2026-10-12" },
  { name: "di-0710", zeit: "07:10", tag: "2026-10-13" },
  { name: "fr-0710", zeit: "07:10", tag: "2026-10-16" },
  { name: "mo-1930", zeit: "19:30", tag: "2026-10-12", proto: "skip" },
  { name: "fr-1930", zeit: "19:30", tag: "2026-10-16", proto: "skip" },
  // „Morgen früh“ erreicht man erst über die Vorschläge der Zeile (D); bis
  // dahin setzt der Prüfschalter die Ansicht direkt; im Prototyp der Weg über
  // die Zeile: „morgen“ → Antwort → „Morgenansicht öffnen“ (Z. 2417).
  { name: "mo-1930-frueh", zeit: "19:30", tag: "2026-10-12", proto: "skip", ansicht: "frueh" },
  { name: "fr-1930-frueh", zeit: "19:30", tag: "2026-10-16", proto: "skip", ansicht: "frueh" },
  { name: "sa-0900", zeit: "09:00", tag: "2026-10-17" },
  { name: "ferien", zeit: "10:00", tag: "2026-10-27" },
];

const nurFall = process.env.FALL;
const GROESSEN = (process.env.GROESSEN ?? "390,360").split(",");
const SCHEMATA = (process.env.SCHEMATA ?? "light,dark").split(",");

async function messen(page) {
  return page.evaluate(() => {
    const sc = document.getElementById("homeScroll");
    const klein = [];
    for (const el of document.querySelectorAll("#home button, #home a, #zeile button, #zeile input")) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const mode = el.closest(".mode");
      if (mode && !mode.classList.contains("on")) continue;
      if (r.width < 44 || r.height < 44) klein.push(`${el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)} „${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}“`);
    }
    return {
      h1: document.getElementById("h1")?.textContent ?? "",
      datum: document.getElementById("wDate")?.textContent ?? "",
      scroll: sc ? [sc.scrollHeight, sc.clientHeight] : null,
      klein,
    };
  });
}

async function nebeneinander(browser, a, b, datei, breite, hoehe) {
  const p = await browser.newPage({ viewport: { width: breite * 2 + 24, height: hoehe + 30 }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0;background:#888;font:12px sans-serif;display:flex;gap:24px">
    <div><div style="height:30px;line-height:30px;color:#fff">App</div><img src="data:image/png;base64,${a.toString("base64")}" width="${breite}" height="${hoehe}"></div>
    <div><div style="height:30px;line-height:30px;color:#fff">Prototyp</div><img src="data:image/png;base64,${b.toString("base64")}" width="${breite}" height="${hoehe}"></div></body>`);
  await p.screenshot({ path: datei });
  await p.close();
}

const browser = await browserStarten();
const bericht = [];
for (const groesse of GROESSEN) {
  for (const schema of SCHEMATA) {
    const ctx = await kontext(browser, { groesse, schema });
    const app = await ctx.newPage();
    const fehler = fehlerSammeln(app);
    await anmelden(app);
    const protoCtx = await kontext(browser, { groesse, schema });
    const proto = await protoCtx.newPage();
    for (const f of FAELLE) {
      if (nurFall && f.name !== nurFall) continue;
      await app.goto(`${BASIS}/api/testuhr?zeit=${f.zeit}&tag=${f.tag}`);
      await app.waitForSelector("#m-ueberblick", { state: "attached" });
      await app.waitForTimeout(900);
      await proto.goto(`${PROTO}?zeit=${f.zeit}&tag=${f.tag}&reset`);
      await proto.waitForTimeout(900);
      if (f.proto === "skip") {
        await proto.click("#skipBtn");
        await proto.waitForTimeout(900);
      }
      if (f.ansicht) {
        await app.evaluate((v) => window.__kombi.setView(v, { anim: false }), f.ansicht);
        await proto.click("#field");
        await proto.fill("#field", "morgen");
        await proto.waitForTimeout(500);
        await proto.locator("[role=option]", { hasText: "Stunden" }).last().click();
        await proto.waitForTimeout(500);
        await proto.locator("[role=option]", { hasText: "Morgenansicht öffnen" }).click();
        await app.waitForTimeout(700);
        await proto.waitForTimeout(900);
      }
      const name = `${f.name}-${groesse}-${schema}`;
      const a = await app.screenshot();
      const b = await proto.screenshot();
      writeFileSync(path.join(aus, `${name}-app.png`), a);
      writeFileSync(path.join(aus, `${name}-proto.png`), b);
      const { width, height } = app.viewportSize();
      await nebeneinander(browser, a, b, path.join(aus, `${name}.png`), width, height);
      const mA = await messen(app);
      const mP = await messen(proto);
      bericht.push({ name, app: mA, proto: mP });
      console.log(`${name}\n  App:      ${mA.datum} | ${mA.h1} | scroll ${mA.scroll} | klein ${mA.klein.length}\n  Prototyp: ${mP.datum} | ${mP.h1} | scroll ${mP.scroll}`);
      if (mA.klein.length) console.log("   ", mA.klein.join("\n    "));
    }
    if (fehler.length) console.log("Konsole:", fehler);
    bericht.push({ konsole: fehler, groesse, schema });
    await ctx.close();
    await protoCtx.close();
  }
}
writeFileSync(path.join(aus, "bericht.json"), JSON.stringify(bericht, null, 2));
await browser.close();
