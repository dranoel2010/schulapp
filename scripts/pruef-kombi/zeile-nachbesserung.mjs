/**
 * Nachprüfung der Befunde zu Abschnitt D (Zeile) im Produktionsbau:
 *
 * 1. Vorrat: außerhalb der Zeile abgehakt (auf /hausaufgaben) → die Zeile
 *    zeigt es beim nächsten Öffnen; keine Dublette auf eine erledigte Aufgabe;
 *    jedes Öffnen und das Sichtbarwerden holen den Vorrat neu; nach dem
 *    Tageswechsel (Uhr vorgestellt) trägt die Zeile erst mit neuem Vorrat ein.
 * 2. Abhaken im offenen Menü lässt scrollTop stehen (375×667, „mathe“).
 * 3. „Zuletzt geöffnet“ merkt Ablage, Fächer, Blatt »Titel« und eine Klausur
 *    aus der Klausurenliste.
 * 4. Serversuche: „d“ bringt keine Blätterliste, „industrie“ keine Gruppe Blätter.
 * 5. Eine späte Antwort auf „dam“ überschreibt die Liste für „dampf“ nicht.
 * 6. Ein Aufgabentext über 120 Zeichen wird nicht optimistisch eingetragen.
 *
 *   BASIS=http://localhost:3332 node scripts/pruef-kombi/zeile-nachbesserung.mjs
 *
 * Saat wie scripts/pruef-kombi/zeile.mjs. Ändert Daten (Abhaken, Eintragen):
 * nach einem Lauf neu säen.
 */

import { anmelden, BASIS, browserStarten, fehlerSammeln, kontext, Pruefung, ruhe } from "./gemeinsam.mjs";

const p = new Pruefung("zeile-nachbesserung");
const browser = await browserStarten();

const tippen = async (page, s) => {
  await page.fill("#field", "");
  await page.waitForTimeout(80);
  await page.type("#field", s, { delay: 25 });
  await page.waitForTimeout(900);
};
const texte = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
const menueZu = async (page) => {
  await page.click("#scrim", { position: { x: 20, y: 60 } }).catch(() => {});
  await page.waitForTimeout(500);
};
const vorratHolen = (page) => page.evaluate(() => fetch("/api/zeile/vorrat").then((r) => r.json()).then((j) => j.vorrat));

try {
  // ── 1. Vorrat ──────────────────────────────────────────────────────────────
  {
    const ctx = await kontext(browser, { groesse: "390", schema: "light" });
    const page = await ctx.newPage();
    const fehler = fehlerSammeln(page);
    let vorratAnfragen = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/zeile/vorrat")) vorratAnfragen++;
    });
    await anmelden(page);
    await ruhe(page, 1800);
    // Zeile einmal öffnen, damit der Vorrat sicher geladen ist
    await page.tap("#field");
    await tippen(page, "gedicht");
    const vorher = await page.$eval("#mHits .opt.first .mcheck", (e) => e.classList.contains("on")).catch(() => null);
    p.ok(vorher === false, `vorher offen: mcheck on=${vorher}`);
    await menueZu(page);

    // außerhalb der Zeile abhaken: auf der alten Seite /hausaufgaben
    await page.goto(`${BASIS}/hausaufgaben`);
    await page.waitForTimeout(1200);
    await page.click('button[aria-label$="Gedichtanalyse beenden abhaken"]');
    await page.waitForTimeout(1500);
    const v = await vorratHolen(page);
    p.ok(v.aufgaben.find((a) => a.text === "Gedichtanalyse beenden")?.done, "in der Datenbank erledigt");

    const n0 = vorratAnfragen;
    await page.tap("#field");
    await page.waitForTimeout(150);
    p.ok(vorratAnfragen > n0, `Öffnen holt den Vorrat neu (${vorratAnfragen - n0} Anfrage)`);
    await tippen(page, "gedicht");
    const nachher = await page.$eval("#mHits .opt .mcheck", (e) => e.classList.contains("on")).catch(() => null);
    p.ok(nachher === true, `Zeile zeigt die Aufgabe erledigt: mcheck on=${nachher}`);
    await tippen(page, "deutsch gedichtanalyse beenden bis dienstag");
    const erste = await texte(page, "#mHits .opt.first .o1");
    p.ok(erste[0] !== "Steht schon drin", `keine Dublette auf die erledigte Aufgabe: „${erste[0]}“`);
    await page.fill("#field", "");
    await menueZu(page);

    // Sichtbarwerden holt neu
    const n1 = vorratAnfragen;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(400);
    p.ok(vorratAnfragen > n1, "visibilitychange holt den Vorrat neu");
    p.ok(fehler.length === 0, `keine Konsolenfehler (${fehler.join(" | ")})`);
    await ctx.close();
  }

  // Tageswechsel: Uhr des Geräts einen Tag vor — Eintragen wartet auf den neuen Vorrat
  {
    const ctx = await kontext(browser, { groesse: "390", schema: "light" });
    const page = await ctx.newPage();
    await page.clock.install();
    await anmelden(page);
    await page.clock.runFor(2500);
    await page.tap("#field");
    await page.clock.runFor(600);
    await tippen(page, "mathe nachbesserung uhr bis morgen");
    // jetzt ist der Vorrat „von gestern“: die Geräteuhr springt einen Tag
    let gehalten = 0;
    await page.route("**/api/zeile/vorrat", async (route) => {
      gehalten++;
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.clock.fastForward(24 * 3600_000);
    const toasts = [];
    await page.exposeFunction("__toast", (t) => toasts.push(t));
    await page.evaluate(() => {
      const el = document.getElementById("toastText");
      if (el) new MutationObserver(() => window.__toast(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await page.press("#field", "Enter");
    await page.waitForTimeout(300);
    const sofort = toasts.includes("Eingetragen");
    p.ok(gehalten >= 1 && !sofort, `Tageswechsel: erst neuer Vorrat (${gehalten} Anfrage), kein sofortiges Eintragen`);
    await page.waitForTimeout(2500);
    p.ok(toasts.includes("Eingetragen"), `danach eingetragen: ${toasts.join(" | ")}`);
    await ctx.close();
  }

  // ── 2. Scroll bleibt beim Abhaken ──────────────────────────────────────────
  {
    const ctx = await kontext(browser, { groesse: "375", schema: "light" });
    const page = await ctx.newPage();
    await anmelden(page);
    await ruhe(page, 1800);
    await page.tap("#field");
    await tippen(page, "mathe");
    const vorher = await page.$eval("#mScroll", (e) => ({ h: e.scrollHeight, c: e.clientHeight }));
    await page.$eval("#mScroll", (e) => e.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const checks = await page.$$("#mHits .mcheck");
    const sichtbar = [];
    for (const c of checks) if (await c.isVisible()) sichtbar.push(c);
    if (sichtbar.length) {
      await sichtbar[0].click();
      await page.waitForTimeout(1500);
    }
    const st = await page.$eval("#mScroll", (e) => e.scrollTop);
    p.ok(sichtbar.length > 0 && st === 0, `Abhaken lässt die Liste stehen: scrollTop ${st} (Überlauf ${vorher.h - vorher.c}px)`);
    // Rückgängig über den Toast, damit die Saat stimmt
    await page.click("#toastAct").catch(() => {});
    await ctx.close();
  }

  // ── 3. Zuletzt geöffnet ────────────────────────────────────────────────────
  {
    const ctx = await kontext(browser, { groesse: "390", schema: "light" });
    const page = await ctx.newPage();
    await anmelden(page);
    await ruhe(page, 1800);
    for (const bereich of ["Ablage", "Fächer"]) {
      await page.tap("#field");
      await page.waitForTimeout(600);
      await page.click(`#mLeer .opt.cell:has-text("${bereich}")`);
      await page.waitForTimeout(1500);
    }
    await page.tap("#field");
    await tippen(page, "dampfmaschine");
    await page.waitForTimeout(600);
    await page.click('#mHits .opt:has-text("Die Dampfmaschine") >> nth=0');
    await page.waitForTimeout(1800);
    await page.tap("#field");
    await page.waitForTimeout(900);
    const z1 = await texte(page, '#mLeer [aria-label="Zuletzt geöffnet"] .opt .o1');
    p.ok(z1.join(",") === "Blatt »Die Dampfmaschine«,Fächer,Ablage", `Zuletzt: ${z1.join(", ")}`);
    await menueZu(page);
    // Klausur aus der Klausurenliste (nicht aus der Zeile)
    await page.goto(`${BASIS}/klausuren`);
    await page.waitForTimeout(1000);
    await page.click('a[href^="/klausuren/"]:not([href$="/neu"]) >> nth=0');
    await page.waitForURL(/\/klausuren\/[0-9a-f-]{36}/);
    await page.waitForTimeout(1200);
    await page.tap("#field");
    await page.waitForTimeout(900);
    const z2 = await texte(page, '#mLeer [aria-label="Zuletzt geöffnet"] .opt');
    p.ok(/^Klausur \S+/.test(z2[0] ?? ""), `Klausur aus der Liste gemerkt: ${z2.join(" | ")}`);
    await ctx.close();
  }

  // ── 4./5./6. Suche und Eintragen ───────────────────────────────────────────
  {
    const ctx = await kontext(browser, { groesse: "390", schema: "light" });
    const page = await ctx.newPage();
    const fehler = fehlerSammeln(page);
    await anmelden(page);
    await ruhe(page, 1800);
    await page.tap("#field");
    await tippen(page, "d");
    await page.waitForTimeout(500);
    const bd = await texte(page, '#mHits [aria-label="Blätter"] .opt .o1');
    p.ok(bd.length <= 1, `„d“: Blätter ${bd.length} (${bd.join(", ")})`);
    await tippen(page, "industrie");
    await page.waitForTimeout(500);
    const bi = await texte(page, '#mHits [aria-label="Blätter"] .opt .o1');
    p.ok(bi.length === 0, `„industrie“: keine Gruppe Blätter (${bi.join(", ")})`);

    // die Antwort auf „dam“ kommt erst nach der auf „dampf“
    await page.route("**/api/suche?**", async (route) => {
      const q = new URL(route.request().url()).searchParams.get("q");
      if (q === "dam") await new Promise((r) => setTimeout(r, 1500));
      await route.continue().catch(() => {});
    });
    await page.fill("#field", "");
    await page.type("#field", "dam", { delay: 25 });
    await page.waitForTimeout(260);
    await page.type("#field", "pf", { delay: 25 });
    await page.waitForTimeout(2500);
    const nachDampf = await page.evaluate(() => document.querySelector("#mHits")?.textContent ?? "");
    await page.unroute("**/api/suche?**");
    await tippen(page, "dampf");
    await page.waitForTimeout(800);
    const frischDampf = await page.evaluate(() => document.querySelector("#mHits")?.textContent ?? "");
    p.ok(nachDampf === frischDampf, "späte Antwort auf „dam“ überschreibt „dampf“ nicht");

    // zu langer Aufgabentext
    const lang = "mathe " + "Arbeitsauftrag ".repeat(10) + "bis morgen";
    await page.fill("#field", lang);
    await page.dispatchEvent("#field", "input");
    await page.waitForTimeout(900);
    const l2 = await texte(page, "#mHits .opt.first");
    p.ok(/höchstens 120 Zeichen/.test(l2[0] ?? ""), `Hinweis zu lang: ${l2[0]?.slice(-40)}`);
    await page.press("#field", "Enter");
    await page.waitForTimeout(800);
    const offen = await page.$eval("#zeile", (e) => e.classList.contains("menu-on"));
    const toast = await page.textContent("#toastText").catch(() => "");
    p.ok(offen && toast !== "Eingetragen", `nicht eingetragen (Menü offen=${offen}, Toast „${toast}“)`);
    p.ok(fehler.length === 0, `keine Konsolenfehler (${fehler.join(" | ")})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(p.gruen ? "\nALLES GRÜN" : "\nFEHLER");
process.exit(p.gruen ? 0 : 1);
