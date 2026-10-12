/**
 * Bilder von Abschnitt A neben dem Prototyp (Plan 5.4): 390×844 und
 * 360×800, hell und dunkel. Je Zustand ein Bild der App und eins des
 * Prototyps mit gleichem Namen, dazu ein Maßvergleich der Bausteine, die A
 * baut (Datumszeile, Zahnrad, Zeile, Menü, Seitenkopf, Toast).
 *
 *   BASIS=http://localhost:3301 node scripts/pruef-kombi/bilder.mjs <ausgabeordner>
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { anmelden, browserStarten, kontext, Pruefung, ruhe, WURZEL } from "./gemeinsam.mjs";

const AUS = process.argv[2];
if (!AUS) throw new Error("Ausgabeordner fehlt");
mkdirSync(AUS, { recursive: true });

const PROTO = `file://${path.join(WURZEL, "entwurf-modelle/23-kombi-v2/index.html")}`;
const p = new Pruefung("bilder");
const browser = await browserStarten();

const rechteck = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, sel);

const stil = (page, sel, props) =>
  page.evaluate(
    ({ s, ps }) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      // next/font legt eine Ersatzschrift gleicher Maße dazu; die Schrift ist dieselbe
      return Object.fromEntries(ps.map((k) => [k, k === "fontFamily" ? cs[k].replace(/, "[^"]+ Fallback"/g, "") : cs[k]]));
    },
    { s: sel, ps: props },
  );

function gleich(name, a, b, toleranz = 1) {
  const ok =
    a && b && Object.keys(a).every((k) => (typeof a[k] === "number" ? Math.abs(a[k] - b[k]) <= toleranz : a[k] === b[k]));
  p.ok(ok, `${name}: App ${JSON.stringify(a)} · Prototyp ${JSON.stringify(b)}`);
}

try {
  for (const groesse of ["390", "360"]) {
    for (const schema of ["light", "dark"]) {
      const tag = `${groesse}-${schema === "light" ? "hell" : "dunkel"}`;
      console.log(`\n${tag}`);
      const ctxA = await kontext(browser, { groesse, schema });
      const app = await ctxA.newPage();
      await anmelden(app);
      await app.waitForFunction(() => !!window.__kombi);
      await ruhe(app, 900);
      const ctxP = await kontext(browser, { groesse, schema });
      const proto = await ctxP.newPage();
      await proto.goto(`${PROTO}?zeit=07:20&reset`);
      await proto.evaluate(() => document.fonts.ready);
      await ruhe(proto, 900);

      // Start: Datumszeile, Zahnrad, Zeile
      await app.screenshot({ path: path.join(AUS, `a-start-${tag}-app.png`) });
      await proto.screenshot({ path: path.join(AUS, `a-start-${tag}-proto.png`) });
      gleich("Datumszeile", await rechteck(app, "#whenrow"), await rechteck(proto, "#whenrow"));
      gleich("Datum (Text)", await rechteck(app, "#wDate"), await rechteck(proto, "#wDate"));
      gleich("Zahnrad", await rechteck(app, "#gearBtn"), await rechteck(proto, "#gearBtn"));
      gleich("Zeile", await rechteck(app, "#dock"), await rechteck(proto, "#dock"));
      gleich("Feld", await rechteck(app, "#field"), await rechteck(proto, "#field"));
      gleich("Kameraknopf", await rechteck(app, "#camBtn"), await rechteck(proto, "#camBtn"));
      const farben = ["backgroundColor", "color", "fontFamily", "fontSize", "fontWeight"];
      gleich("Stil Zeile", await stil(app, "#dock", farben), await stil(proto, "#dock", farben));
      gleich("Stil Datum", await stil(app, "#when", farben.slice(1)), await stil(proto, "#when", farben.slice(1)));
      gleich("Papier", await stil(app, "body", ["backgroundColor"]), await stil(proto, "body", ["backgroundColor"]));
      p.ok((await app.textContent("#wDate")) === (await proto.textContent("#wDate")), `Datum „${await app.textContent("#wDate")}“`);

      // Menü offen
      await app.click("#field");
      await proto.click("#field");
      await ruhe(app, 600);
      await ruhe(proto, 600);
      await app.screenshot({ path: path.join(AUS, `a-menu-${tag}-app.png`) });
      await proto.screenshot({ path: path.join(AUS, `a-menu-${tag}-proto.png`) });
      gleich("Wohin-Zelle", { ...(await rechteck(app, '#mLeer .m-grid .opt')), y: 0 }, { ...(await rechteck(proto, '#mLeer .m-grid .opt')), y: 0 });
      gleich("Stil Menü", await stil(app, "#menu", ["backgroundColor", "borderTopLeftRadius"]), await stil(proto, "#menu", ["backgroundColor", "borderTopLeftRadius"]));
      gleich("Stil Gruppe", await stil(app, "#mLeer .m-gl", farben), await stil(proto, "#mLeer .m-group:last-child .m-gl", farben));
      gleich("Scrim", await stil(app, "#scrim", ["backgroundColor", "opacity"]), await stil(proto, "#scrim", ["backgroundColor", "opacity"]));
      await app.keyboard.press("Escape");
      await proto.keyboard.press("Escape");
      await ruhe(app, 500);
      await ruhe(proto, 500);

      // Seite: Kopf und Titel (App: Probe, Prototyp: Einstellungen)
      await app.evaluate(() => window.__kombi.openPage("probe"));
      await proto.click("#gearBtn");
      await ruhe(app, 900);
      await ruhe(proto, 900);
      await app.screenshot({ path: path.join(AUS, `a-seite-${tag}-app.png`) });
      await proto.screenshot({ path: path.join(AUS, `a-seite-${tag}-proto.png`) });
      gleich("Zurück-Pfeil", await rechteck(app, "#pages > .page:last-child .pback"), await rechteck(proto, "#pages > .page:last-child .pback"));
      const titelA = await rechteck(app, "#pages > .page:last-child .p-title");
      const titelP = await rechteck(proto, "#pages > .page:last-child .p-title");
      gleich("Titel (Lage)", { x: titelA?.x, y: titelA?.y, h: titelA?.h }, { x: titelP?.x, y: titelP?.y, h: titelP?.h });
      gleich("Stil Titel", await stil(app, "#pages > .page:last-child .p-title", farben), await stil(proto, "#pages > .page:last-child .p-title", farben));
      gleich("Zeile auf der Seite", await rechteck(app, "#dock"), await rechteck(proto, "#dock"));

      // Toast
      await app.evaluate(() => window.__kombi.toast("Mathe abgehakt", () => {}));
      await proto.evaluate(() => document.querySelector("#pages .pback")?.click());
      await ruhe(proto, 500);
      await proto.click("#m-morgens .task:not(.done) .check");
      await ruhe(app, 500);
      await ruhe(proto, 500);
      await app.screenshot({ path: path.join(AUS, `a-toast-${tag}-app.png`) });
      await proto.screenshot({ path: path.join(AUS, `a-toast-${tag}-proto.png`) });
      const tA = await rechteck(app, "#toast");
      const tP = await rechteck(proto, "#toast");
      gleich("Toast (Lage, Höhe)", { x: tA?.x, y: tA?.y, h: tA?.h }, { x: tP?.x, y: tP?.y, h: tP?.h });
      gleich("Stil Toast", await stil(app, "#toast", ["backgroundColor", "color", "fontSize", "fontWeight", "borderRadius"]), await stil(proto, "#toast", ["backgroundColor", "color", "fontSize", "fontWeight", "borderRadius"]));

      await ctxA.close();
      await ctxP.close();
    }
  }
} finally {
  await browser.close();
}

console.log(p.gruen ? "\nBilder: Maße gleich" : "\nBilder: Abweichungen");
process.exit(p.gruen ? 0 : 1);
