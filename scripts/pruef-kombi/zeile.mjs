/**
 * Prüfung von Abschnitt D (Zeile) im Produktionsbau, neben dem Prototyp
 * (Plan 5.4): Bilder bei 390×844 und 360×800, hell und dunkel, dazu die
 * Abnahme aus D (Wohin? mit neun Bereichen, Dublette, Rückfrage, Eintragen
 * mit Rückgängig, Volltextsuche „dampf“, eingefrorener Erledigt-Stand,
 * Verlauf am unteren Rand, Tippflächen ≥ 44 px, keine Konsolenfehler).
 *
 *   BASIS=http://localhost:3312 node scripts/pruef-kombi/zeile.mjs <ausgabeordner>
 *
 * Saat: scripts/saat-abruf.mts, dann scripts/pruef-kombi/saat-zeile.mts.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { anmelden, browserStarten, fehlerSammeln, kontext, Pruefung, ruhe, WURZEL } from "./gemeinsam.mjs";

const AUS = process.argv[2];
if (!AUS) throw new Error("Ausgabeordner fehlt");
mkdirSync(AUS, { recursive: true });

const jetzt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const PROTO = `file://${path.join(WURZEL, "entwurf-modelle/23-kombi-v2/index.html")}?zeit=${process.env.ZEIT ?? jetzt}&reset`;
const p = new Pruefung("zeile");
const browser = await browserStarten();

const tippen = async (page, s) => {
  await page.fill("#field", "");
  await page.waitForTimeout(80);
  await page.type("#field", s, { delay: 25 });
  await page.waitForTimeout(900);
};

const texte = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));

async function bilder(page, name, tag, wer) {
  await page.screenshot({ path: path.join(AUS, `${tag}-${name}-${wer}.png`) });
}

async function ablauf(page, tag, wer) {
  await page.tap("#field");
  await page.waitForTimeout(700);
  await bilder(page, "leer", tag, wer);
  for (const [name, satz] of [
    ["morgen", "morgen"],
    ["eintragen", "mathe s 90 nr 1-4"],
    ["fachfehlt", "+karten erstellen"],
    ["dampf", "dampf"],
    ["noten", "noten mathe"],
    ["klausur", "mathe klausur"],
    ["gedicht", "gedicht"],
  ]) {
    await tippen(page, satz);
    await bilder(page, name, tag, wer);
  }
  // Antwort öffnen: „morgen“ → erste Zeile
  await tippen(page, "morgen");
  await page.click("#mHits .opt.first");
  await page.waitForTimeout(700);
  await bilder(page, "antwort", tag, wer);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

try {
  for (const groesse of ["390", "360"]) {
    for (const schema of ["light", "dark"]) {
      const tag = `${groesse}-${schema === "light" ? "hell" : "dunkel"}`;
      console.log(`\n${tag}`);
      const ctxA = await kontext(browser, { groesse, schema });
      const app = await ctxA.newPage();
      const fehler = fehlerSammeln(app);
      await anmelden(app);
      await ruhe(app, 1600);
      await ablauf(app, tag, "app");
      p.ok(fehler.length === 0, `keine Konsolenfehler (${fehler.join(" | ")})`);
      await ctxA.close();

      const ctxP = await kontext(browser, { groesse, schema });
      const proto = await ctxP.newPage();
      await proto.goto(PROTO);
      await ruhe(proto, 900);
      await ablauf(proto, tag, "proto");
      await ctxP.close();
    }
  }

  // ── Abnahme D (390, hell) ────────────────────────────────────────────────
  console.log("\nAbnahme");
  const ctx = await kontext(browser, { groesse: "390", schema: "light" });
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await ruhe(page, 1600);
  await page.tap("#field");
  await page.waitForTimeout(700);
  const wohin = await texte(page, '#mLeer [aria-label="Wohin?"] .opt');
  p.ok(wohin.length === 9, `Wohin? mit neun Bereichen: ${wohin.join(", ")}`);

  // Tippflächen
  // #send ist ohne Text eingeklappt (Breite 0) und dann kein Ziel
  const klein = await page.$$eval("#mLeer .opt, #send.on, #camBtn, #field", (els) =>
    els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.className || e.id),
  );
  p.ok(klein.length === 0, `Tippflächen im leeren Menü ≥ 44 px (${klein.join(", ")})`);

  // Dublette
  await tippen(page, "mathe S. 84, Nr. 3–5");
  const erste = await texte(page, "#mHits .opt.first");
  p.ok(erste[0]?.startsWith("Steht schon drin"), `Dublette: ${erste[0]}`);

  // Tokens und Pillen
  await tippen(page, "+karten erstellen");
  const toks = await texte(page, "#mTokens .tok");
  const pillen = await texte(page, "#mFach .fp");
  p.ok(toks.join("|") === "Eintragen|welches Fach?", `Tokens ohne Fach: ${toks.join("|")}`);
  p.ok(pillen.length >= 6, `Fachpillen: ${pillen.join(", ")}`);
  const kleinTok = await page.$$eval("#mTokens .tok, #mFach .fp", (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  p.ok(kleinTok === 0, "Tokens und Pillen ≥ 44 px");

  // Ändern mit Rückfrage „Bis wann ist ⟨Fach⟩ fällig?“ (Prototyp startEdit, doEintragen):
  // die Zeile öffnet mit Kontext, Rücktaste im leeren Feld nimmt den Termin weg
  const vorrat = async () => page.evaluate(async () => (await (await fetch("/api/zeile/vorrat")).json()).vorrat);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  let v = await vorrat();
  const a1 = v.aufgaben.find((a) => a.text === "S. 84, Nr. 3–5");
  await page.evaluate((a) => window.__kombi.openZeile({ intent: "aendern", fach: a.fachId, due: a.due, dueAuto: false, editId: a.id, text: a.text }), a1);
  await page.waitForTimeout(600);
  const tokAendern = await texte(page, "#mTokens .tok");
  p.ok(tokAendern[0] === "Ändern", `Ändern: Tokens ${tokAendern.join("|")}`);
  await page.fill("#field", "");
  await page.waitForTimeout(200);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
  await page.type("#field", "S. 84, Nr. 3–6", { delay: 20 });
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const rueck = await texte(page, "#mHits .m-gl");
  const rueckOpts = await texte(page, "#mHits .opt .o1");
  p.ok(rueck[0] === "Bis wann ist Mathe fällig?", `Rückfrage: ${rueck[0]} · ${rueckOpts.join(", ")}`);
  await page.click("#mHits .opt >> nth=1");
  await page.waitForTimeout(1500);
  v = await vorrat();
  const geaendert = v.aufgaben.find((a) => a.id === a1.id);
  p.ok(geaendert.text === "S. 84, Nr. 3–6" && geaendert.due !== a1.due, `Geändert: ${geaendert.text}, ${geaendert.due}; Toast ${await page.textContent("#toastText")}`);
  await page.click("#toastAct");
  await page.waitForTimeout(1500);
  v = await vorrat();
  const zurueck = v.aufgaben.find((a) => a.id === a1.id);
  p.ok(zurueck.text === a1.text && zurueck.due === a1.due, "Rückgängig stellt die Aufgabe wieder her");

  // Eintragen mit Toast und Rückgängig
  await page.tap("#field");
  await tippen(page, "bio arbeitsblatt bis donnerstag");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  const toast = await page.textContent("#toastText");
  v = await vorrat();
  const eingetragen = v.aufgaben.find((a) => a.text === "Arbeitsblatt");
  p.ok(toast === "Eingetragen" && eingetragen && eingetragen.due === "2026-10-15", `Eingetragen: Toast „${toast}“, fällig ${eingetragen?.due}`);
  await page.click("#toastAct");
  await page.waitForTimeout(1200);
  v = await vorrat();
  p.ok(!v.aufgaben.some((a) => a.text === "Arbeitsblatt"), "Rückgängig nimmt die Aufgabe wieder heraus");

  // Volltextsuche
  await page.tap("#field");
  await tippen(page, "dampf");
  await page.waitForTimeout(600);
  const top = await texte(page, "#mHits .opt.first");
  const blaetter = await texte(page, '#mHits [aria-label="Blätter"] .opt .o1');
  p.ok(
    top[0]?.startsWith("Die Dampfmaschine") || blaetter.some((b) => b.startsWith("Die Dampfmaschine")),
    `Volltext „dampf“: oben ${top[0]} · Blätter ${blaetter.join(", ")}`,
  );

  // Eingefrorener Erledigt-Stand: abhaken im offenen Menü sortiert nicht um
  await tippen(page, "gedicht");
  const vorherTop = await texte(page, "#mHits .opt .o1");
  await page.click("#mHits .opt.first .mcheck");
  await page.waitForTimeout(800);
  const nachherTop = await texte(page, "#mHits .opt .o1");
  const an = await page.$eval("#mHits .opt.first .mcheck", (e) => e.classList.contains("on"));
  p.ok(JSON.stringify(vorherTop) === JSON.stringify(nachherTop) && an, `abgehakt, Liste bleibt: ${nachherTop.join(" / ")}`);
  const toast2 = await page.textContent("#toastText");
  p.ok(toast2 === "Deutsch abgehakt", `Toast: ${toast2}`);
  await page.waitForTimeout(300);
  // Rückgängig über den Vorschlag im leeren Menü
  await page.fill("#field", "");
  await page.waitForTimeout(600);
  const vor = await texte(page, '#mLeer [aria-label="Vorschläge"] .opt .o1');
  p.ok(vor[0]?.startsWith("Rückgängig: Deutsch, Gedichtanalyse"), `Vorschlag: ${vor[0]}`);
  await page.click('#mLeer [aria-label="Vorschläge"] .opt >> nth=0');
  await page.waitForTimeout(1200);
  v = await vorrat();
  p.ok(!v.aufgaben.find((a) => a.text === "Gedichtanalyse beenden").done, "Rückgängig öffnet die Aufgabe wieder");

  // Navigation: „noten“ → Noten öffnen
  await tippen(page, "noten");
  const navTop = await texte(page, "#mHits .opt.first .o1");
  p.ok(navTop[0] === "Noten öffnen", `»noten« → ${navTop[0]}`);
  p.ok(fehler.length === 0, `keine Konsolenfehler (${fehler.join(" | ")})`);
  await ctx.close();

  // Verlauf am unteren Rand, wenn mehr folgt (375×667: das leere Menü läuft über)
  const ctxKlein = await kontext(browser, { groesse: "375", schema: "light" });
  const kp = await ctxKlein.newPage();
  await anmelden(kp);
  await ruhe(kp, 1600);
  // drei Seiten öffnen, damit „Zuletzt geöffnet“ voll ist
  for (const bereich of ["Noten", "Klausuren", "Hausaufgaben"]) {
    await kp.tap("#field");
    await kp.waitForTimeout(600);
    await kp.click(`#mLeer .opt.cell:has-text("${bereich}")`);
    await kp.waitForTimeout(1500);
  }
  await kp.tap("#field");
  await kp.waitForTimeout(900);
  const zuletzt = await texte(kp, '#mLeer [aria-label="Zuletzt geöffnet"] .opt .o1');
  p.ok(zuletzt.join(",") === "Hausaufgaben,Klausuren,Noten", `Zuletzt geöffnet: ${zuletzt.join(", ")}`);
  const m1 = await kp.$eval("#mScroll", (e) => ({ more: e.classList.contains("more"), ueber: e.scrollHeight - e.scrollTop - e.clientHeight }));
  p.ok(m1.ueber > 2 ? m1.more : !m1.more, `leeres Menü: .more=${m1.more} bei Überlauf ${m1.ueber}px`);
  await kp.$eval("#mScroll", (e) => e.scrollTo(0, e.scrollHeight));
  await kp.waitForTimeout(300);
  const m2 = await kp.$eval("#mScroll", (e) => e.classList.contains("more"));
  p.ok(!m2, "am Ende kein Verlauf mehr");
  await kp.screenshot({ path: path.join(AUS, "375-hell-verlauf-app.png") });
  await ctxKlein.close();
} finally {
  await browser.close();
}

console.log(p.gruen ? "\nALLES GRÜN" : "\nFEHLER");
process.exit(p.gruen ? 0 : 1);
