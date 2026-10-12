/**
 * Abschnitt B bedienen (Plan 4 B, Abnahme): Abhaken mit Toast und
 * Rückgängig, die Zeile bleibt 350 ms stehen, die Überschrift zählt herunter;
 * Wisch nach rechts hakt ab, Linkswisch legt „Bearbeiten“ und „Löschen“
 * frei, Löschen mit Rückgängig bringt dieselbe Aufgabe zurück; Wechsel über
 * „Wohin? → Überblick“; Wechsel beim Zurückkommen aus dem Hintergrund
 * (Kriterium 9); Zahnrad öffnet die Einstellungen.
 *
 *   BASIS=http://localhost:3310 node scripts/pruef-kombi/startseite-bedienen.mjs [bildordner]
 *
 * Danach die Saat neu einspielen (es wird abgehakt und gelöscht).
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { anmelden, BASIS, browserStarten, fehlerSammeln, kontext, Pruefung } from "./gemeinsam.mjs";

const aus = process.argv[2] ?? path.join(tmpdir(), "pruef-startseite");
mkdirSync(aus, { recursive: true });
const p = new Pruefung("Startseite bedienen");
const browser = await browserStarten();
const ctx = await kontext(browser, { groesse: "390", schema: "light" });
const page = await ctx.newPage();
const fehler = fehlerSammeln(page);
await anmelden(page);

const uhr = async (zeit, tag = "2026-10-12") => {
  await page.goto(`${BASIS}/api/testuhr?zeit=${zeit}&tag=${tag}`);
  await page.waitForSelector("#m-ueberblick", { state: "attached" });
  await page.waitForTimeout(700);
};
const h1 = () => page.evaluate(() => [...document.querySelectorAll("#h1 .swap")].filter((s) => !s.classList.contains("out")).pop()?.textContent ?? "");
const zeilen = (sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} .task`)].map((t) => t.querySelector(".t-txt").textContent), sel);
const ansicht = () => page.evaluate(() => document.querySelector(".mode.on")?.dataset.v ?? null);

// ── Abhaken auf dem Überblick ───────────────────────────────────────────────
await uhr("19:30");
p.ok((await ansicht()) === "ueberblick", "Mo 19:30: Überblick (der Ablauf kommt mit C)");
p.ok((await h1()) === "Zwei Aufgaben für Dienstag", `Überschrift „${await h1()}“`);
const vorher = await zeilen("#ovHaList");
p.ok(vorher[0] === "S. 84, Nr. 3–5", `erste Zeile Mathe (${vorher.join(" | ")})`);
await page.click("#ovHaList .task:first-child .check");
await page.waitForTimeout(120);
const toast = await page.textContent("#toastText");
p.ok(toast === "Mathe abgehakt", `Toast „${toast}“`);
p.ok((await zeilen("#ovHaList")).length === 2, "Zeile steht nach 120 ms noch");
await page.screenshot({ path: path.join(aus, "abhaken-120ms.png") });
await page.waitForTimeout(900);
p.ok((await zeilen("#ovHaList")).length === 1, "nach 350 ms klappt die Zeile zu");
p.ok((await h1()) === "Noch eine Aufgabe für Dienstag", `Überschrift zählt herunter: „${await h1()}“`);
await page.click("#toastAct");
await page.waitForTimeout(1200);
p.ok((await zeilen("#ovHaList")).length === 2, "Rückgängig: die Zeile ist wieder da");
p.ok((await h1()) === "Zwei Aufgaben für Dienstag", "Rückgängig: Überschrift wieder „Zwei …“");
await page.reload();
await page.waitForTimeout(900);
p.ok((await zeilen("#ovHaList")).length === 2, "nach Neuladen weiter offen (Server)");

// ── Wisch nach rechts ───────────────────────────────────────────────────────
const wisch = async (sel, dx) => {
  const box = await page.locator(sel).boundingBox();
  const y = box.y + box.height / 2;
  const x0 = box.x + 60;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x0 + (dx * i) / 10, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};
await wisch("#ovHaList .task:first-child .t-front", 220);
await page.waitForTimeout(150);
p.ok((await page.textContent("#toastText")) === "Mathe abgehakt", "Wisch nach rechts hakt ab");
await page.click("#toastAct");
await page.waitForTimeout(1200);

// ── Linkswisch, Löschen, Rückgängig ─────────────────────────────────────────
const idVorher = await page.getAttribute("#ovHaList .task:nth-child(2)", "data-id");
await wisch("#ovHaList .task:nth-child(2) .t-front", -200);
await page.waitForTimeout(500);
p.ok(await page.evaluate(() => document.querySelector("#ovHaList .task:nth-child(2)").classList.contains("open-l")), "Linkswisch legt die Aktionen frei");
await page.screenshot({ path: path.join(aus, "linkswisch.png") });
await page.click("#ovHaList .task:nth-child(2) .del");
await page.waitForTimeout(500);
p.ok((await page.textContent("#toastText")) === "Gelöscht", "Toast „Gelöscht“");
p.ok((await zeilen("#ovHaList")).length === 1, "Zeile ist weg");
await page.click("#toastAct");
await page.waitForTimeout(1500);
await page.reload();
await page.waitForTimeout(900);
const idNachher = await page.getAttribute("#ovHaList .task:nth-child(2)", "data-id");
p.ok(idVorher === idNachher, `Rückgängig bringt dieselbe id zurück (${idNachher})`);

// ── Wechsel über die Zeile: Wohin? → Überblick ──────────────────────────────
await uhr("07:10");
p.ok((await ansicht()) === "morgens", "07:10: Morgens");
p.ok((await zeilen("#m-morgens .mo-list")).join(" | ") === "Fragen zur Dampfmaschine | Vokabeln Unit 3", "Abgeben: offen zuerst, erledigt darunter");
await page.click("#m-morgens .mo-list .task:first-child .check");
await page.waitForTimeout(1000);
p.ok((await zeilen("#m-morgens .mo-list")).join(" | ") === "Vokabeln Unit 3 | Fragen zur Dampfmaschine", "abgehakt wandert unter die erledigten");
p.ok(await page.evaluate(() => !!document.querySelector("#m-morgens .task.done:nth-child(2) .strike")), "Durchstrich am Aufgabentext");
await page.screenshot({ path: path.join(aus, "morgens-abgehakt.png") });
await page.click("#toastAct");
await page.waitForTimeout(1200);
await page.click("#field");
await page.waitForTimeout(400);
await page.click("#o-w-ueberblick");
await page.waitForTimeout(80);
await page.screenshot({ path: path.join(aus, "wechsel-80ms.png") });
await page.waitForTimeout(600);
p.ok((await ansicht()) === "ueberblick", "Wohin? → Überblick wechselt die Ansicht");
p.ok((await h1()) === "Zwei Aufgaben für Dienstag", `Überschrift im Überblick: „${await h1()}“`);

// ── Kriterium 9: sichtbar kein Wechsel, nach Rückkehr schon ─────────────────
await uhr("13:05");
p.ok((await ansicht()) === "morgens", "13:05: Morgens");
await page.evaluate(async (b) => {
  await fetch(`${b}/api/testuhr?zeit=13:11&tag=2026-10-12`, { redirect: "manual" });
}, BASIS);
await page.waitForTimeout(300);
p.ok((await ansicht()) === "morgens", "nach 13:11 bei sichtbarem Bildschirm: noch Morgens");
await page.evaluate(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(1200);
p.ok((await ansicht()) === "ueberblick", "nach Rückkehr: Wechsel (Ablauf fehlt bis C, also Überblick)");

// ── Zahnrad ─────────────────────────────────────────────────────────────────
await page.click("#gearBtn");
await page.waitForTimeout(1500);
p.ok(page.url().endsWith("/einstellungen"), `Zahnrad öffnet die Einstellungen (${page.url()})`);

p.ok(fehler.length === 0, `keine Konsolenfehler ${fehler.length ? JSON.stringify(fehler) : ""}`);

// ── Kaltstart mit reduzierter Bewegung: nie html.pre (Plan B, Tests) ────────
const rctx = await kontext(browser, { groesse: "390", schema: "light", reduziert: true, ohneSW: true });
await rctx.addInitScript(() => {
  // documentElement gibt es beim Start des Init-Skripts noch nicht
  window.__preGesehen = false;
  new MutationObserver(() => {
    const d = document.documentElement;
    if (d && d.classList.contains("pre")) window.__preGesehen = true;
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
});
const rpage = await rctx.newPage();
await anmelden(rpage);
await rpage.goto(`${BASIS}/api/testuhr?zeit=07:10&tag=2026-10-12`);
await rpage.waitForTimeout(800);
p.ok((await rpage.evaluate(() => window.__preGesehen)) === false, "reduzierte Bewegung: html.pre nie gesetzt");
await rpage.click("#field");
await rpage.waitForTimeout(400);
await rpage.click("#o-w-ueberblick");
await rpage.waitForTimeout(30);
const transforms = await rpage.evaluate(() =>
  document.getElementById("home").getAnimations({ subtree: true }).some((a) =>
    a.effect.getKeyframes().some((k) => k.transform && k.transform !== "none"),
  ),
);
p.ok(!transforms, "reduzierte Bewegung: der Wechsel blendet nur über");
await rctx.close();
await browser.close();
console.log(p.gruen ? "GRÜN" : "ROT");
process.exit(p.gruen ? 0 : 1);
