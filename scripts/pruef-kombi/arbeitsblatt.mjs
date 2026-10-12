/**
 * Prüfung Abschnitt H (Arbeitsblätter) im Produktionsbau, neben dem
 * Prototyp (`screens/ab-*`):
 *
 *   npx tsx scripts/saat-arbeitsblatt.mts --neu        (Server gestoppt!)
 *   SCHULAPP_TESTUHR=1 npx next start -p 3316
 *   BASIS=http://localhost:3316 IDS='<Ausgabe der Saat>' OUT=<ordner> \
 *     node scripts/pruef-kombi/arbeitsblatt.mjs light 390
 *
 * Bilder: Vorschau, Seite 2, Lupe (Flug, Seite 1, Lösungen), Wie lief es?,
 * zwei offen, alle bewertet, geübt, Französisch, Lernblock, Fachseite mit
 * Art je Thema, gebaut wird, gescheitert. Dazu: Druck als PDF (zwei Seiten
 * A4), kein Bedienelement unter 44×44, keine Konsolenfehler.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { anmelden, BASIS, browserStarten, fehlerSammeln, kontext, Pruefung } from "./gemeinsam.mjs";

const schema = process.argv[2] ?? "light";
const groesse = process.argv[3] ?? "390";
const OUT = process.env.OUT ?? ".";
const IDS = JSON.parse(process.env.IDS_DATEI ? readFileSync(process.env.IDS_DATEI, "utf8") : (process.env.IDS ?? "{}"));
const name = (n) => path.join(OUT, `app-${groesse}-${n}-${schema}.png`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = new Pruefung(`Arbeitsblatt ${schema} ${groesse}`);

const browser = await browserStarten();
const ctx = await kontext(browser, { groesse, schema });
const page = await ctx.newPage();
const fehler = fehlerSammeln(page);
const zuKlein = [];

async function messen(label) {
  const m = await page.evaluate(() => {
    const oben = document.querySelector(".tisch.open") ?? document.querySelector("#pages .page:last-child") ?? document.body;
    return [...oben.querySelectorAll('button, a, input, textarea, [role="button"]')]
      .filter((e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !e.closest("[hidden], .tb-lupe[hidden]"))
      .map((e) => ({ text: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), w: e.offsetWidth, h: e.offsetHeight }));
  });
  // 1×1: versteckte Formularfelder (Radio) der alten Seiten, keine Tippfläche
  const klein = m.filter((x) => x.w > 1 && x.h > 1 && (x.w < 44 || x.h < 44));
  if (klein.length) zuKlein.push([label, klein]);
}

const tippen = async (sel, warten = 400) => {
  await page.locator(sel).first().tap({ force: true });
  await sleep(warten);
};
const oeffnen = async (o, warten = 900) => {
  await page.evaluate((o) => window.__kombi.openTisch(o), o);
  await sleep(warten);
};
const druckStub = () => page.evaluate(() => {
  window.__p = 0;
  window.print = () => {
    window.__p++;
  };
});

await anmelden(page);
await page.evaluate(() => document.fonts.ready);

// ── Lernblock vor der Mathe-Klausur: ein Arbeitsblatt (Kriterium 4) ──────────
await oeffnen({ block: IDS.block, mode: "block" });
await page.screenshot({ path: name("30-lernblock-blatt") });
p.ok(await page.locator("#tbMain").textContent() === "Arbeitsblatt drucken", "Lernblock vor Mathe-Klausur zeigt „Arbeitsblatt drucken“");
p.ok((await page.locator("#tThema").textContent()) === "Lernblock · Scheitelpunktform", "Kopf: Lernblock · Scheitelpunktform");
await messen("lernblock");
await tippen("#tClose", 700);

// ── Mathematik · Quadratische Funktionen ───────────────────────────────────
await oeffnen({ thema: IDS.mathe });
await page.screenshot({ path: name("13-blatt-vorschau") });
await messen("vorschau");
p.ok((await page.locator("#tStack .sc").count()) === 0, "Übungsthema: keine Karten (Kriterium 1)");
p.ok((await page.locator("#tThema").textContent()) === "Quadratische Funktionen", "Kopf beim Wiederholen: das Thema, nicht der Lernblock");
p.ok((await page.locator("#tbMain").textContent()) === "Arbeitsblatt drucken", "Knopf „Arbeitsblatt drucken“ (Kriterium 1)");
const sichtbar = await page.evaluate(() => {
  const box = document.querySelector("#tbVorschau").getBoundingClientRect();
  const [s1, s2] = [...document.querySelectorAll(".tb-paper")].map((e) => e.getBoundingClientRect());
  const h2 = document.querySelectorAll(".tb-cap")[1].getBoundingClientRect();
  return { seite1: s1.top >= box.top - 1 && s1.bottom <= box.bottom + 1, ueberschrift2: h2.bottom <= box.bottom + 1, w: s1.width, s2top: s2.top };
});
p.ok(sichtbar.seite1, "Vorschau: Seite 1 ganz im Bild");
p.ok(sichtbar.ueberschrift2, "Vorschau: Überschrift von Seite 2 („Seite 2 · Lösungen“) im Bild");
await page.evaluate(() => {
  const v = document.querySelector("#tbVorschau");
  v.scrollTop = v.scrollHeight;
});
await sleep(300);
await page.screenshot({ path: name("14-blatt-seite2") });
await page.evaluate(() => {
  document.querySelector("#tbVorschau").scrollTop = 0;
});
await sleep(200);
{
  const b = await page.locator(".tb-page:first-child .tb-paper").boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.3, b.y + b.height * 0.12);
  await sleep(120);
  await page.screenshot({ path: name("15-lupe-flug-120ms") });
  await sleep(500);
  await page.screenshot({ path: name("16-lupe-seite1") });
}
await messen("lupe");
const umbruch = await page.evaluate(() => {
  const sc = document.querySelector("#tbLScroll");
  return sc.scrollWidth <= sc.clientWidth + 1;
});
p.ok(umbruch, "Lupe bricht auf Bildschirmbreite um (kein seitliches Schieben)");
await tippen("#tbLClose", 600);
await page.evaluate(() => {
  const v = document.querySelector("#tbVorschau");
  v.scrollTop = v.scrollHeight;
});
await sleep(200);
{
  const b = await page.locator(".tb-page:nth-child(2) .tb-paper").boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.3, Math.max(b.y + 20, 200));
  await sleep(700);
  await page.screenshot({ path: name("17-lupe-loesungen") });
}
await tippen("#tbLClose", 600);

// Druck als PDF (vor dem Drucken liegen die Seiten schon in #druck)
if (groesse === "390" && schema === "light") {
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  writeFileSync(path.join(OUT, "app-druck-mathematik.pdf"), pdf);
  const seiten = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
  p.ok(seiten === 2, `Druck: genau zwei Seiten (${seiten})`);
}

// Der PDF-Weg der installierten App (Plan H): dieselbe Gestaltung, zwei Seiten A4
{
  const id = await page.locator("#tisch").getAttribute("data-blatt");
  const r = await page.request.get(`${BASIS}/api/arbeitsblatt/${id}/pdf`);
  const pdf = await r.body();
  const seiten = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
  p.ok(r.status() === 200 && r.headers()["content-type"] === "application/pdf" && seiten === 2, `PDF-Route: 200, application/pdf, ${seiten} Seiten`);
  if (groesse === "390" && schema === "light") writeFileSync(path.join(OUT, "app-route-mathematik.pdf"), pdf);
  const fremd = await page.request.get(`${BASIS}/api/arbeitsblatt/00000000-0000-4000-8000-000000000000/pdf`);
  p.ok(fremd.status() === 404, "PDF-Route: unbekanntes Blatt 404");
}

// Escape: erst die Lupe, der Tisch bleibt offen
{
  await page.evaluate(() => {
    document.querySelector("#tbVorschau").scrollTop = 0;
  });
  await sleep(200);
  const b = await page.locator(".tb-page:first-child .tb-paper").boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.5, b.y + 40);
  await sleep(600);
  await page.keyboard.press("Escape");
  await sleep(600);
  p.ok((await page.locator("#tbLupe").isHidden()) && (await page.locator("#tisch.open").count()) === 1, "Escape schließt erst die Lupe, der Tisch bleibt");
}

await druckStub();
await tippen("#tbMain", 120);
p.ok((await page.evaluate(() => window.__p)) === 1, "Drucken ruft window.print()");
await page.screenshot({ path: name("18-wie-lief-es-120ms") });
await sleep(600);
await page.screenshot({ path: name("19-wie-lief-es") });
await messen("wertung");
p.ok((await page.locator(".tb-row").count()) === 6, "Wie lief es? mit einer Zeile je Aufgabe (Kriterium 3)");
p.ok(await page.locator(".tb-bald").isVisible(), "„Gelöstes Blatt fotografieren · bald“ sichtbar (Kriterium 6)");
await tippen("#tbMain", 500);
p.ok(!(await page.locator("#tEnd.on").count()), "Fertig vor der Wertung: bleibt bei Wie lief es?");
for (const [nr, v] of [[1, "true"], [2, "true"], [3, "true"], [4, "false"]]) {
  await page.locator(`.tb-row[data-nr="${nr}"] button[data-v="${v}"]`).scrollIntoViewIfNeeded();
  await tippen(`.tb-row[data-nr="${nr}"] button[data-v="${v}"]`, 150);
}
await page.evaluate(() => {
  document.querySelector("#tbWertung").scrollTop = 0;
});
await sleep(400);
await page.screenshot({ path: name("20-zwei-offen") });
p.ok((await page.locator("#tbState").textContent()) === "Noch 2 von 6 offen", "Stand: „Noch 2 von 6 offen“");
for (const [nr, v] of [[5, "true"], [6, "true"]]) {
  await page.locator(`.tb-row[data-nr="${nr}"] button[data-v="${v}"]`).scrollIntoViewIfNeeded();
  await tippen(`.tb-row[data-nr="${nr}"] button[data-v="${v}"]`, 150);
}
await page.evaluate(() => {
  document.querySelector("#tbWertung").scrollTop = 0;
});
await sleep(500);
await page.screenshot({ path: name("21-alle-bewertet") });
await tippen("#tbMain", 900);
await page.screenshot({ path: name("22-geuebt") });
const ende = await page.locator("#tEnd").innerText();
p.ok(/Quadratische Funktionen geübt\./.test(ende) && /6 Aufgaben, 5 richtig\./.test(ende) && /Aufgabe 4 kommt aufs nächste Blatt\./.test(ende), "Ende: geübt, 5 richtig, Aufgabe 4 aufs nächste Blatt");
p.ok(/Wieder dran: Dienstag, 13\.10\./.test(ende), "Wieder dran: Dienstag, 13.10.");
await tippen("#tEnd .tlink", 800);

// Dasselbe Blatt ist das des heutigen Lernblocks: im Block steht jetzt „Blatt ausgewertet.“
await oeffnen({ block: IDS.block, mode: "block" });
await page.screenshot({ path: name("31-lernblock-ausgewertet") });
const blockEnde = await page.locator("#tEnd").innerText();
p.ok(/Blatt ausgewertet\./.test(blockEnde) && /Der Lernblock zählt als erledigt\./.test(blockEnde), "Lernblock: beim Wiederholen ausgewertet → „Blatt ausgewertet.“, Block erledigt");
await tippen("#tEnd .tlink", 800);

// ── Französisch ─────────────────────────────────────────────────────────────
await oeffnen({ thema: IDS.franzoesisch });
await page.screenshot({ path: name("23-franzoesisch-blatt") });
await page.evaluate(() => {
  const v = document.querySelector("#tbVorschau");
  v.scrollTop = v.scrollHeight;
});
await sleep(300);
await page.screenshot({ path: name("24-franzoesisch-seite2") });
await tippen("#tClose", 700);

// ── Gebaut wird gerade / heute gescheitert ─────────────────────────────────
await oeffnen({ thema: IDS.deutsch });
await page.screenshot({ path: name("50-wird-gebaut") });
p.ok((await page.locator(".tb-wait").textContent()) === "Das Blatt wird gerade gebaut.", "Ohne fertiges Blatt: „Das Blatt wird gerade gebaut.“");
await tippen("#tClose", 700);
await oeffnen({ thema: IDS.physik });
await page.screenshot({ path: name("51-gescheitert") });
p.ok((await page.locator(".tb-wait").textContent()) === "Für dieses Thema ließ sich heute kein Blatt bauen.", "Gescheitert: ruhiger Satz");
p.ok(await page.locator("#tbArt").isVisible(), "Gescheitert, Thema mit Fragen: „Dieses Thema lieber abfragen“");
await messen("gescheitert");
await tippen("#tClose", 700);

// ── Art je Thema auf der Fachseite (Kriterium 5) ───────────────────────────
await page.goto(`${BASIS}/faecher/${IDS.fachMathe}`);
await sleep(900);
await page.locator('.seg2[aria-label="Art von Quadratische Funktionen"]').scrollIntoViewIfNeeded();
await sleep(300);
await page.screenshot({ path: name("40-fach-themen") });
await messen("fach");
await tippen('.seg2[aria-label="Art von Quadratische Funktionen"] button:first-child', 600);
await page.screenshot({ path: name("41-art-umgestellt") });
p.ok((await page.locator("#toastText").textContent()) === "Ab jetzt mit Karten", "Toast „Ab jetzt mit Karten“");
const sub = await page.locator('.lrow:has(.seg2[aria-label="Art von Quadratische Funktionen"]) .s').textContent();
p.ok(/Abfragen mit \d+ Fragen, von dir umgestellt/.test(sub), `Unterzeile: ${sub}`);
await tippen("#toastAct", 600);

p.ok(zuKlein.length === 0, `kein Bedienelement unter 44×44 ${JSON.stringify(zuKlein)}`);
p.ok(fehler.length === 0, `keine Konsolenfehler ${JSON.stringify(fehler)}`);
await browser.close();
process.exit(p.gruen ? 0 : 1);
