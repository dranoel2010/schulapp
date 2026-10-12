/**
 * Abschnitt E: was der Tisch beim Wiederholen tun muss (V2 15.5, Plan E),
 * ohne Bildvergleich. Ein Durchlauf schreibt Versuche — vorher die Saat
 * zurücksetzen (`RESET`, siehe tisch.mjs).
 *
 *   BASIS=http://localhost:3313 RESET=<skript> node scripts/pruef-kombi/tisch-ablauf.mjs
 *
 * Geprüft: Lösung erst nach dem Versuch (A2, Netzwerk), Aufdecken mit 800 ms
 * Latenz (Karte hält hochkant, Rückseite gefüllt), ohne Netz zurückdrehen und
 * „Keine Verbindung“, Zurückziehen zählt aus, Wurf per Ziehen, fünf schnelle
 * „Saß“, Schließen mitten im Thema und Fortsetzen, Android-Zurück und Escape,
 * „Dieses Thema lieber abfragen“, letztes Thema mit „Fertig“ und die
 * Textzeile danach, reduzierte Bewegung.
 */

import { execSync } from "node:child_process";

import { anmelden, browserStarten, fehlerSammeln, kontext, Pruefung } from "./gemeinsam.mjs";

const p = new Pruefung("tisch-ablauf");
if (process.env.RESET) execSync(process.env.RESET, { stdio: "inherit" });
const browser = await browserStarten();

const loesungDa = (page) =>
  page.waitForFunction(() => {
    const top = document.querySelector('#tStack .sc[data-pos="0"]');
    return top && top.classList.contains("flipped") && top.querySelector(".cb-sol li");
  }, null, { timeout: 8000 });
const text = (page, s) => page.evaluate((x) => document.querySelector(x)?.textContent?.trim() ?? null, s);
const oben = (page) => text(page, '#tStack .sc[data-pos="0"] .c-q p');

try {
  const ctx = await kontext(browser, {});
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  const antworten = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/wiederholen")) antworten.push(await r.text().catch(() => ""));
  });
  await anmelden(page);
  await page.waitForSelector("#whBtn");

  // A2: die Lösung reist nicht mit der Frage
  await page.click("#whBtn");
  await page.waitForSelector("#tisch.open");
  await page.waitForTimeout(700);
  p.ok(antworten.length > 0 && antworten.every((t) => !t.includes("um 1760") && !t.includes("Newcomen")), "A2: /api/wiederholen enthält keine Musterlösung und keinen Verwechslungssatz");

  // vor dem Aufdecken: zäh ziehen, „Erst antworten.“
  const box = await page.locator('#tStack .sc[data-pos="0"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 30, { steps: 6 });
  const hinweis = await page.evaluate(() => document.querySelector("#tMeta").classList.contains("hint"));
  await page.mouse.up();
  p.ok(hinweis, "vor dem Aufdecken: Ziehen zeigt „Erst antworten.“");

  // Latenz 800 ms: die Karte dreht an, hält hochkant und zeigt dann die gefüllte Rückseite
  await page.route("**/*", async (route) => {
    if (route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.click("#tReveal");
  await page.waitForTimeout(300);
  const halb = await page.evaluate(() => {
    const top = document.querySelector('#tStack .sc[data-pos="0"]');
    const m = new DOMMatrixReadOnly(getComputedStyle(top.querySelector(".sc-flip")).transform);
    // rotateY(θ): m11 = cos θ; hochkant heißt cos θ ≈ 0
    return { flipped: top.classList.contains("flipped"), cos: Math.abs(m.m11), leer: !top.querySelector(".cb-sol li") };
  });
  p.ok(halb.flipped && halb.cos < 0.1 && halb.leer, `Latenz: Karte hält hochkant ohne Lösung (cos ${halb.cos.toFixed(3)})`);
  await loesungDa(page);
  await page.waitForTimeout(500);
  const voll = await page.evaluate(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#tStack .sc[data-pos="0"] .sc-flip')).transform);
    return m.m11;
  });
  p.ok(voll < -0.99, "Latenz: danach ganz umgedreht, Rückseite gefüllt");
  await page.unroute("**/*");

  // Saß per Wurf nach rechts
  const vorWurf = await oben(page);
  const k = await page.locator('#tStack .sc[data-pos="0"]').boundingBox();
  await page.mouse.move(k.x + k.width / 2, k.y + 40);
  await page.mouse.down();
  await page.mouse.move(k.x + k.width / 2 + 220, k.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  p.ok((await oben(page)) !== vorWurf && (await text(page, "#tCount")) === "10 Fragen", "Wurf nach rechts zählt als Saß, nächste Karte");

  // ohne Netz: zurückdrehen und „Keine Verbindung“
  await ctx.setOffline(true);
  await page.click("#tReveal");
  await page.waitForTimeout(1200);
  const offline = await page.evaluate(() => ({
    flipped: document.querySelector('#tStack .sc[data-pos="0"]').classList.contains("flipped"),
    toast: document.querySelector("#toast.on #toastText")?.textContent,
    knopf: document.querySelector("#toast.on #toastAct")?.textContent,
  }));
  p.ok(!offline.flipped && offline.toast === "Keine Verbindung" && offline.knopf === "Erneut", `ohne Netz: Karte dreht zurück, Toast ${JSON.stringify(offline)}`);
  await ctx.setOffline(false);
  await page.click("#toastAct");
  await loesungDa(page);
  p.ok(true, "„Erneut“ deckt auf");

  // Zurückziehen: fällt aus Zahl und Strichen
  await page.click('#tStack .sc[data-pos="0"] .cb-retire');
  await page.click('#tStack .sc[data-pos="0"] .cb-ask .yes');
  await page.waitForTimeout(500);
  p.ok((await text(page, "#tCount")) === "9 Fragen" && (await page.locator("#tTicks .tick").count()) === 9, "Zurückziehen: „9 Fragen“, 9 Striche");

  // fünf schnelle „Saß“ hintereinander
  for (let i = 0; i < 5; i++) {
    await page.click("#tDunno");
    await loesungDa(page);
    await page.click('#tRate .rb[data-r="sass"]');
  }
  await page.waitForTimeout(600);
  const striche = await page.locator("#tTicks .tick.past").count();
  p.ok(striche === 6, `fünf schnelle Saß gehen alle durch (${striche} von 9 Strichen)`);

  // Schließen mitten im Thema: fragt nicht nach, Unterzeile „Weiter mit …, noch 3 Fragen“
  await page.click("#tClose");
  await page.waitForTimeout(900);
  const sub = await text(page, "#whSub");
  p.ok(sub === "Weiter mit Geschichte · Industrialisierung in England, noch 3 Fragen", `Unterzeile nach Schließen: ${sub}`);
  p.ok(!(await page.$("#tisch.open")), "Tisch ist zu");
  await page.reload();
  await page.waitForSelector("#whBtn");
  p.ok((await text(page, "#whSub")) === sub, "nach Neuladen sagt der Server dasselbe");

  // Fortsetzen: die übrigen Fragen, Zähler zählt die erledigten mit
  await page.click("#whBtn");
  await page.waitForSelector("#tisch.open");
  await page.waitForTimeout(700);
  const fort = await page.evaluate(() => ({ n: document.querySelector("#tCount").textContent, past: document.querySelectorAll("#tTicks .tick.past").length }));
  p.ok(fort.n === "9 Fragen" && fort.past === 6, `Fortsetzen: ${JSON.stringify(fort)}`);

  // Android-Zurück schließt den Tisch
  await page.goBack();
  await page.waitForTimeout(700);
  p.ok(!(await page.$("#tisch.open")) && page.url().endsWith("/"), "Android-Zurück schließt den Tisch und bleibt auf /");
  await page.click("#whBtn");
  await page.waitForSelector("#tisch.open");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  p.ok(!(await page.$("#tisch.open")), "Escape schließt den Tisch");

  // Rest von Geschichte, dann Mathematik als Karten (lieber abfragen), dann Französisch
  await page.click("#whBtn");
  await page.waitForSelector("#tisch.open");
  await page.waitForTimeout(600);
  for (let i = 0; i < 40 && !(await page.$("#tEnd.on")); i++) {
    await page.click("#tDunno");
    await loesungDa(page);
    await page.click('#tRate .rb[data-r="sass"]');
    await page.waitForTimeout(80);
  }
  await page.waitForSelector("#tEnd.on");
  const ende1 = await text(page, "#tEnd p");
  p.ok(ende1 === "9 Fragen, alle beim ersten Mal.", `Themenende zählt über das Schließen hinweg: ${ende1}`);
  await page.click("#tEnd .tlink.known");
  await page.waitForTimeout(700);
  p.ok((await text(page, "#tThema")) === "Quadratische Funktionen" && (await page.$("#tisch.blatt")), "„Weiter mit Mathematik“: Übungsthema auf dem Tisch");
  await page.click("#tbArt");
  await page.waitForSelector('#tStack .sc[data-pos="0"]');
  await page.waitForTimeout(500);
  p.ok((await text(page, "#tCount")) === "12 Fragen", "„Dieses Thema lieber abfragen“ legt die Karten hin");
  for (let i = 0; i < 40 && !(await page.$("#tEnd.on")); i++) {
    await page.click("#tDunno");
    await loesungDa(page);
    await page.click('#tRate .rb[data-r="sass"]');
    await page.waitForTimeout(80);
  }
  await page.waitForSelector("#tEnd.on");
  await page.click("#tEnd .tlink.known");
  await page.waitForTimeout(700);
  await page.click("#tbArt");
  await page.waitForSelector('#tStack .sc[data-pos="0"]');
  for (let i = 0; i < 40 && !(await page.$("#tEnd.on")); i++) {
    await page.click("#tDunno");
    await loesungDa(page);
    await page.click('#tRate .rb[data-r="sass"]');
    await page.waitForTimeout(80);
  }
  await page.waitForSelector("#tEnd.on");
  await page.waitForTimeout(500);
  const letzt = await page.evaluate(() => [...document.querySelectorAll("#tEnd .tnext > *")].map((e) => e.textContent.trim()));
  p.ok(JSON.stringify(letzt) === JSON.stringify(["Alle Themen für heute durch.", "Fertig"]), `letztes Thema: ${JSON.stringify(letzt)}`);
  await page.click("#tEnd .tlink");
  await page.waitForTimeout(1200);
  const zeile = await text(page, "#ovWh .wh-ok");
  p.ok(zeile === "Für heute durch. Nächstes Thema Dienstag." && !(await page.$("#whBtn")), `danach die Textzeile: ${zeile}`);
  await page.reload();
  await page.waitForSelector("#ovWh");
  p.ok((await text(page, "#ovWh .wh-ok")) === zeile, "nach Neuladen dieselbe Textzeile vom Server");
  p.ok(fehler.filter((f) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/.test(f)).length === 0, `Konsole ohne Fehler ${fehler.join(" | ")}`);
  await ctx.close();

  // reduzierte Bewegung: der Tisch blendet nur über
  if (process.env.RESET) execSync(process.env.RESET, { stdio: "inherit" });
  const ctxR = await kontext(browser, { reduziert: true });
  const r = await ctxR.newPage();
  await anmelden(r);
  await r.waitForSelector("#whBtn");
  await r.click("#whBtn");
  await r.waitForSelector("#tisch.open");
  const anim = await r.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.("#tisch"))
      .map((a) => Object.keys(a.effect.getKeyframes()[0]).filter((x) => !["offset", "easing", "composite", "computedOffset"].includes(x)))
      .flat(),
  );
  p.ok(anim.length > 0 && anim.every((x) => x === "opacity"), `reduzierte Bewegung: nur opacity (${[...new Set(anim)].join(", ")})`);
  await r.click("#tDunno");
  await loesungDa(r);
  p.ok(true, "reduzierte Bewegung: Aufdecken als Überblenden");
  await ctxR.close();
} finally {
  await browser.close();
}
console.log(p.gruen ? "\nAlles grün." : "\nNicht alles grün.");
process.exit(p.gruen ? 0 : 1);
