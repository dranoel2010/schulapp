/**
 * Abschnitt E, Nachprüfung der Befunde (Prüfrunde 1): Themenschlüssel und
 * Fach werden geprüft (400 statt 500), der leere Tisch nennt das Fach, die
 * Übergangszeilen zu /abruf/eingang und /abruf/bausteine, „Blatt ansehen“
 * öffnet das Sheet erst mit Inhalt (900 ms Latenz) und zeigt ohne Netz kein
 * Sheet, sondern „Keine Verbindung“ mit „Erneut“.
 *
 *   BASIS=http://localhost:3333 node scripts/pruef-kombi/tisch-nachpruefung.mjs <ausgabeordner>
 *
 * Schreibt einen Versuch; vor tisch.mjs die Saat zurücksetzen.
 */

import { mkdirSync } from "node:fs";

import { BASIS, anmelden, browserStarten, fehlerSammeln, kontext, Pruefung } from "./gemeinsam.mjs";

const OUT = process.argv[2];
if (!OUT) throw new Error("Ausgabeordner fehlt");
mkdirSync(OUT, { recursive: true });
const p = new Pruefung("e-nach");
const browser = await browserStarten();
try {
  const ctx = await kontext(browser, {});
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await page.waitForSelector("#whBtn");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/start-uebergang.png` });

  // 4: Schlüssel prüfen
  const st = async (u) => (await page.request.get(BASIS + u)).status();
  p.ok((await st("/api/wiederholen?thema=ohne:abc")) === 400, "thema=ohne:abc → 400");
  p.ok((await st("/api/wiederholen?thema=xyz")) === 400, "thema=xyz → 400");
  p.ok((await st("/api/wiederholen?fach=abc")) === 400, "fach=abc → 400");
  const alle = await (await page.request.get(BASIS + "/api/wiederholen")).json();
  p.ok((await st(`/api/wiederholen?thema=${alle.themen[0].key}`)) === 200, "gültiger Schlüssel → 200");

  // Fach-ids aus dem Notenblatt
  const html = await (await page.request.get(BASIS + "/noten")).text();
  const ids = [...new Set([...html.matchAll(/\/noten\/fach\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
  // Kein Fach der Saat ist ohne Fälliges: die Antwort des Servers für ein Fach
  // wird abgefangen und geleert, fachName kommt aus dem Server-Test (themen.db.test).
  const fr = ids[0];
  const echt = await (await page.request.get(BASIS + `/api/wiederholen?fach=${fr}`)).json();
  const fachLabel = echt.themen[0].fach;
  await page.route(`**/api/wiederholen?fach=${fr}`, (route) =>
    route.fulfill({ json: { ...echt, themen: [], lauf: null, fachName: fachLabel, durch: false } }),
  );
  const leerFach = { id: fr, name: fachLabel };
  // 3: Übergangszeilen
  const zeilen = await page.$$eval(".abruf-uebergang a", (as) => as.map((a) => [a.textContent.trim(), a.getAttribute("href"), a.getBoundingClientRect().height]));
  console.log("   Zeilen:", JSON.stringify(zeilen));
  p.ok(zeilen.some(([, h]) => h === "/abruf/bausteine") && zeilen.every(([, , hh]) => hh >= 44), "„Fragen und Termine ›“ führt nach /abruf/bausteine, ≥ 44 px");

  // 1: Toast mit Fach
  if (leerFach) {
    await page.evaluate((f) => window.__kombi.openTisch({ mode: "wh", fach: f }), leerFach.id);
    const t = await page.waitForFunction(() => document.querySelector("#toast.show, .toast.show")?.textContent ?? null, null, { timeout: 4000 }).then((h) => h.jsonValue()).catch(() => null);
    const toast = t ?? (await page.evaluate(() => document.querySelector("#toast")?.textContent));
    console.log("   Toast:", toast);
    p.ok(toast?.includes(`In ${leerFach.name} ist heute nichts fällig.`), "Toast nennt das Fach");
    await page.waitForTimeout(400);
  }

  // 2: Blatt ansehen mit 900 ms Latenz, Sheet erst mit Inhalt
  await page.click("#whBtn");
  await page.waitForSelector("#tisch.open");
  await page.waitForTimeout(700);
  await page.click("#tReveal");
  await page.waitForFunction(() => document.querySelector('#tStack .sc[data-pos="0"] .cb-sol li'), null, { timeout: 8000 });
  await page.waitForTimeout(500);
  let blattAnfragen = 0;
  await page.route("**/api/wiederholen/blatt*", async (route) => {
    blattAnfragen += 1;
    await new Promise((r) => setTimeout(r, 900));
    await route.continue();
  });
  await page.click('#tStack .sc[data-pos="0"] .cb-heft');
  await page.waitForTimeout(250);
  await page.click('#tStack .sc[data-pos="0"] .cb-quote button');
  // während des Ladens: kein Sheet
  await page.waitForTimeout(300);
  const frueh = await page.evaluate(() => document.getElementById("sheet")?.classList.contains("open") ?? false);
  p.ok(!frueh, "während des Ladens kein leeres Sheet");
  await page.waitForFunction(() => document.getElementById("sheet")?.classList.contains("open"), null, { timeout: 5000 });
  const proben = [];
  for (let i = 0; i < 8; i++) {
    proben.push(await page.evaluate(() => {
      const s = document.getElementById("sheet");
      const r = s.getBoundingClientRect();
      return { h: Math.round(r.height), t: s.querySelector(".p-title")?.textContent, sub: s.querySelector(".p-sub")?.textContent };
    }));
    await page.waitForTimeout(60);
  }
  console.log("   Sheet:", JSON.stringify(proben[0]), "…", JSON.stringify(proben.at(-1)));
  p.ok(proben.every((x) => x.t && x.h === proben.at(-1).h), "Sheet fährt gleich mit Inhalt ein, Höhe springt nicht");
  p.ok(proben.at(-1).sub === "Geschichte, 2 Seiten", "„Geschichte, 2 Seiten“ wie im Prototyp");
  p.ok(blattAnfragen === 1, `eine Blatt-Anfrage (vorgewärmt beim Aufklappen): ${blattAnfragen}`);
  await page.screenshot({ path: `${OUT}/sheet.png` });
  await page.goBack();
  await page.waitForTimeout(500);

  // Fehler: kein Sheet, Toast mit „Erneut“ — neue Seite, damit kein vorgewärmtes Blatt im Vorrat liegt
  await page.close();
  const page2 = await ctx.newPage();
  const fehler2 = fehlerSammeln(page2);
  await page2.route("**/api/wiederholen/blatt*", (route) => route.abort());
  await page2.goto(BASIS + "/");
  await page2.waitForSelector("#whBtn");
  await page2.click("#whBtn");
  await page2.waitForSelector("#tisch.open");
  await page2.waitForTimeout(700);
  await page2.click("#tReveal");
  await page2.waitForFunction(() => document.querySelector('#tStack .sc[data-pos="0"] .cb-sol li'), null, { timeout: 8000 });
  await page2.waitForTimeout(500);
  await page2.click('#tStack .sc[data-pos="0"] .cb-heft');
  await page2.waitForTimeout(250);
  await page2.click('#tStack .sc[data-pos="0"] .cb-quote button');
  await page2.waitForTimeout(600);
  const zustand = await page2.evaluate(() => ({
    sheet: document.getElementById("sheet")?.classList.contains("open") ?? false,
    toast: document.querySelector("#toast")?.textContent ?? "",
  }));
  console.log("   Fehler:", JSON.stringify(zustand));
  p.ok(!zustand.sheet && zustand.toast.includes("Keine Verbindung") && zustand.toast.includes("Erneut"), "ohne Netz: kein Sheet, Toast „Keine Verbindung“ mit „Erneut“");
  await page2.screenshot({ path: `${OUT}/sheet-fehler.png` });

  // 3: die Übergangszeile führt wirklich zu „Termine neu rechnen“
  await page2.keyboard.press("Escape");
  await page2.waitForTimeout(700);
  await Promise.all([page2.waitForURL(`${BASIS}/abruf/bausteine`), page2.click('.abruf-uebergang a[href="/abruf/bausteine"]')]);
  await page2.waitForTimeout(800);
  const knopf = await page2.getByText("Termine neu rechnen").first().isVisible().catch(() => false);
  p.ok(knopf, "„Fragen und Termine ›“ öffnet /abruf/bausteine mit „Termine neu rechnen“");
  const echteFehler = [...fehler, ...fehler2].filter((f) => !/Failed to load resource|ERR_FAILED|blatt/.test(f));
  p.ok(echteFehler.length === 0, `Konsole ohne Fehler ${JSON.stringify(echteFehler)}`);
} finally {
  await browser.close();
}
process.exit(p.gruen ? 0 : 1);
