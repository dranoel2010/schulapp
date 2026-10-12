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
/** Seit Abschnitt C öffnet Mo 19:30 im Ablauf; die Listenprüfungen laufen auf dem Überblick. */
const zumUeberblick = async () => {
  await page.evaluate(() => window.__kombi.setView("ueberblick", { anim: false }));
  await page.waitForTimeout(500);
};
const h1 = () => page.evaluate(() => [...document.querySelectorAll("#h1 .swap")].filter((s) => !s.classList.contains("out")).pop()?.textContent ?? "");
const zeilen = (sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} .task`)].map((t) => t.querySelector(".t-txt").textContent), sel);
const ansicht = () => page.evaluate(() => document.querySelector(".mode.on")?.dataset.v ?? null);

// ── Abhaken auf dem Überblick ───────────────────────────────────────────────
await uhr("19:30");
// Seit Abschnitt C steht Mo 19:30 der Ablauf; abgehakt wird auf dem Überblick
await zumUeberblick();
p.ok((await ansicht()) === "ueberblick", "Mo 19:30, zum Überblick gewechselt");
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
await zumUeberblick();
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
await zumUeberblick();
const idNachher = await page.getAttribute("#ovHaList .task:nth-child(2)", "data-id");
p.ok(idVorher === idNachher, `Rückgängig bringt dieselbe id zurück (${idNachher})`);

// ── Wieder öffnen innerhalb der 350 ms: die Zeile bleibt stehen ────────────
await uhr("19:30");
await zumUeberblick();
await page.click("#ovHaList .task:first-child .check");
await page.waitForTimeout(120);
await page.click("#ovHaList .task:first-child .check");
const wieder = [];
// gemessen bei +0, +100, +200, +300, +600 ms
for (const pause of [0, 100, 100, 100, 300]) {
  if (pause) await page.waitForTimeout(pause);
  wieder.push((await zeilen("#ovHaList")).length);
}
p.ok(wieder.every((n) => n === 2), `wieder geöffnet: beide Zeilen stehen durchgehend (${wieder.join(", ")})`);
await page.waitForTimeout(800);
await page.reload();
await page.waitForTimeout(900);
await zumUeberblick();
p.ok((await zeilen("#ovHaList")).length === 2, "wieder geöffnet: auch auf dem Server offen");

// ── Löschen online, Rückgängig offline, „Erneut“ online ─────────────────────
const idDel = await page.getAttribute("#ovHaList .task:nth-child(2)", "data-id");
const textDel = (await zeilen("#ovHaList"))[1];
await wisch("#ovHaList .task:nth-child(2) .t-front", -200);
await page.waitForTimeout(500);
await page.click("#ovHaList .task:nth-child(2) .del");
await page.waitForTimeout(800);
await ctx.setOffline(true);
await page.click("#toastAct");
await page.waitForTimeout(800);
p.ok((await page.textContent("#toastText")) === "Nicht gespeichert", "offline Rückgängig: „Nicht gespeichert“");
p.ok((await page.textContent("#toastAct")) === "Erneut", "… mit „Erneut“");
p.ok((await zeilen("#ovHaList")).includes(textDel), "die Zeile steht, solange „Erneut“ angeboten wird");
await ctx.setOffline(false);
await page.click("#toastAct");
await page.waitForTimeout(1500);
p.ok((await zeilen("#ovHaList")).includes(textDel), "„Erneut“: die Zeile bleibt");
await page.reload();
await page.waitForTimeout(900);
await zumUeberblick();
p.ok((await page.getAttribute("#ovHaList .task:nth-child(2)", "data-id")) === idDel, `„Erneut“ stellt mit alter id wieder her (${idDel})`);

// ── Lernblock „Starten“: bis F in den Lernplan ─────────────────────────────
if (await page.$("#lbBtn")) {
  await Promise.all([page.waitForURL(/\/lernen$/, { timeout: 5000 }).catch(() => {}), page.click("#lbBtn")]);
  p.ok(page.url().endsWith("/lernen"), `Starten führt in den Lernplan (${page.url()})`);
} else {
  p.ok(false, "Lernblockzeile fehlt um 19:30");
}

// ── Geschützte Leerzeichen vor „·“ (Plan 1.1) ───────────────────────────────
await uhr("19:30");
const lbk = await page.evaluate(() => document.querySelector("#lbRow .lbk")?.textContent ?? "");
p.ok(lbk === "Lernblock\u00a0· ", `„Lernblock\\u00a0· “ (${JSON.stringify(lbk)})`);
await uhr("07:10");
const hu = await page.evaluate(() => [...document.querySelectorAll("#m-morgens em")].map((e) => e.textContent).find((t) => t.startsWith("Hauptunterricht")) ?? "");
p.ok(!hu.includes("·") || hu.includes("\u00a0·"), `„Hauptunterricht\\u00a0· …“ (${JSON.stringify(hu)})`);

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

// ── Abend → nächster Morgen (V2 3.2, Kriterium 9) ──────────────────────────
await uhr("19:30");
p.ok((await ansicht()) === "ueberblick", "Mo 19:30: Überblick");
await page.evaluate(async (b) => {
  await fetch(`${b}/api/testuhr?zeit=07:10&tag=2026-10-13`, { redirect: "manual" });
}, BASIS);
await page.evaluate(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(1500);
const datumDi = await page.textContent("#wDate");
p.ok((await ansicht()) === "morgens", `Di 07:10 nach Rückkehr: Morgens (${await ansicht()} | ${datumDi} | ${await h1()})`);
p.ok(datumDi === "Dienstag, 13. Oktober", `Datum „${datumDi}“`);

// ── Läuft der Fehler-Toast des Rückgängig ab, gilt das Löschen ──────────
// (zuletzt, weil die Aufgabe danach fehlt)
await uhr("19:30");
await zumUeberblick();
await wisch("#ovHaList .task:nth-child(2) .t-front", -200);
await page.waitForTimeout(500);
await page.click("#ovHaList .task:nth-child(2) .del");
await page.waitForTimeout(800);
await ctx.setOffline(true);
await page.click("#toastAct");
await page.waitForTimeout(800);
p.ok((await zeilen("#ovHaList")).includes(textDel), "offline Rückgängig: Zeile steht vorerst");
await page.waitForTimeout(5000);
p.ok(!(await zeilen("#ovHaList")).includes(textDel), "nach Ablauf des Fehler-Toasts ist die Zeile weg");
await ctx.setOffline(false);
await page.reload();
await page.waitForTimeout(900);
await zumUeberblick();
p.ok(!(await zeilen("#ovHaList")).includes(textDel), "… und auch auf dem Server gelöscht");

// ── Zahnrad ─────────────────────────────────────────────────────────────────
await page.click("#gearBtn");
await page.waitForTimeout(1500);
p.ok(page.url().endsWith("/einstellungen"), `Zahnrad öffnet die Einstellungen (${page.url()})`);

// Offline gewollt: die abgewiesenen Aufrufe der Offline-Prüfung zählen nicht
const echteFehler = fehler.filter((f) => !f.includes("ERR_INTERNET_DISCONNECTED"));
p.ok(echteFehler.length === 0, `keine Konsolenfehler ${echteFehler.length ? JSON.stringify(echteFehler) : ""}`);

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
