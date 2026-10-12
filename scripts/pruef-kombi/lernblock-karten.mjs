/**
 * Abschnitt F, Nachbesserung: die Karten im Lernblock und die Befunde der
 * Prüfung im Browser (Plan 4 F, 5.4).
 *
 *   BASIS=http://localhost:3334 AUSGABE=/pfad KLAUSUR=<id> node scripts/pruef-kombi/lernblock-karten.mjs
 *
 * Saat: scripts/saat-abruf.mts, dann scripts/saat-lernblock.mts --fragen
 * (KLAUSUR ist die ausgegebene Mathe-Klausur). `PHASE=ablauf` verbraucht
 * den Stand (Fragen beantwortet, Block erledigt); vor `PHASE=bilder` neu
 * säen, dort mit `--fragen --eng` (Bio morgen oben, Mathe als „Noch ein
 * Lernblock heute: Mathe“).
 *
 * - Karten: Ticks, „3 Fragen“, Antwort schreiben, Aufdecken, Saß, Weiß ich
 *   nicht, Daneben („kommt nochmal“), Ende „Fragen für heute durch.“ mit
 *   „Weiter mit Material“ und „Block beenden“; Wiederöffnen ohne Fragen;
 * - Escape: Sheet → Tisch → Seite, je eine Ebene;
 * - Material: Formelzeile als `.formel` (kursiv, Newsreader);
 * - Planzeilen: „Fr 9.10.“ für den verpassten Freitag, vergangene blass;
 * - direkter Aufruf /klausuren/<id>: Nachholen, Als erledigt zählen → Ja,
 *   Wiederöffnen und Rückgängig — die Seite zeigt den neuen Stand;
 * - Bilder bei 390×844 und 360×800, hell und dunkel, mit dem Prototyp.
 */

import fs from "node:fs";
import path from "node:path";

import { anmelden, BASIS, browserStarten, fehlerSammeln, kontext, ruhe, seitenZahl, Pruefung, WURZEL } from "./gemeinsam.mjs";

const AUSGABE = process.env.AUSGABE ?? path.join(WURZEL, ".pruef-bilder");
const KLAUSUR = process.env.KLAUSUR;
if (!KLAUSUR) throw new Error("KLAUSUR=<id der Mathe-Klausur> fehlt");
fs.mkdirSync(AUSGABE, { recursive: true });
const PROTO = `file://${path.join(WURZEL, "entwurf-modelle/23-kombi-v2/index.html")}`;

const p = new Pruefung("Lernblock: Karten und Nachbesserung");

async function kleinsteTippflaeche(page, wurzel) {
  return page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(`${sel} button, ${sel} a, ${sel} [role=button], ${sel} textarea`)) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (!r.width || !r.height || st.visibility === "hidden" || el.closest("[hidden],[inert]")) continue;
      if (r.width < 44 || r.height < 44) out.push(`${el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)} „${(el.textContent || "").trim().slice(0, 30)}“`);
    }
    return out;
  }, wurzel);
}

const tisch = (page) => page.locator("#lbTisch");
const zahlText = (page) => tisch(page).locator(".t-count").innerText();

async function prototypBilder(browser, groesse, schema) {
  const ctx = await kontext(browser, { groesse, schema, ohneSW: true });
  const page = await ctx.newPage();
  await page.goto(`${PROTO}?zeit=16:40&reset`);
  await ruhe(page, 900);
  const skip = page.locator("text=Überspringen").first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await ruhe(page, 700);
  }
  const n = `${groesse}-${schema}`;
  // Karten zeigt der Prototyp beim Wiederholen (sein Mathe-Block ist ein Arbeitsblatt)
  await page.locator("#whBtn").click();
  await ruhe(page, 1100);
  await page.screenshot({ path: path.join(AUSGABE, `proto-karte-${n}.png`) });
  await page.locator("#tStack .sc[data-pos='0'] textarea").fill("Am d und e");
  await page.locator("#tReveal").click();
  await ruhe(page, 900);
  await page.screenshot({ path: path.join(AUSGABE, `proto-karte-loesung-${n}.png`) });
  await ctx.close();
}

async function karten(browser) {
  const ctx = await kontext(browser, { groesse: "390", schema: "light" });
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await ruhe(page, 600);

  await page.locator("#lbBtn").click();
  await ruhe(page, 1500);
  p.ok(await tisch(page).locator(".sc[data-pos='0']").isVisible(), "Lernblock zeigt eine Karte");
  p.ok((await tisch(page).locator(".t-ticks .tick").count()) === 3, "drei Ticks");
  p.ok((await zahlText(page)) === "3 Fragen", "„3 Fragen“");
  p.ok(await tisch(page).getByRole("button", { name: "Weiß ich nicht" }).isVisible(), "„Weiß ich nicht“ sichtbar");
  p.ok(await tisch(page).getByRole("button", { name: "Aufdecken" }).isVisible(), "„Aufdecken“ sichtbar");
  p.ok(await tisch(page).locator(".t-mat").isVisible(), "Material-Pille unter den Knöpfen");
  await page.screenshot({ path: path.join(AUSGABE, "app-karte-390-light.png") });
  const klein = await kleinsteTippflaeche(page, "#lbTisch");
  p.ok(klein.length === 0, `Tisch mit Karte: keine Tippfläche unter 44×44 ${klein.join("; ")}`);

  // 1: schreiben, aufdecken, Saß
  await tisch(page).locator(".sc[data-pos='0'] textarea").fill("Am d und e");
  await tisch(page).getByRole("button", { name: "Aufdecken" }).click();
  await ruhe(page, 1100);
  p.ok(await tisch(page).locator(".sc[data-pos='0'].flipped").count(), "Karte dreht sich");
  p.ok(/Siehe Blatt\./.test(await tisch(page).locator(".sc[data-pos='0'] .cb-sol").innerText()), "Musterlösung erst nach dem Versuch");
  p.ok(/Am d und e/.test(await tisch(page).locator(".sc[data-pos='0'] .cb-mine").innerText()), "„Deine Antwort“ steht auf der Rückseite");
  p.ok(await tisch(page).getByRole("button", { name: "Saß" }).isVisible(), "„Daneben“/„Saß“ sichtbar");
  await page.screenshot({ path: path.join(AUSGABE, "app-karte-loesung-390-light.png") });
  await tisch(page).getByRole("button", { name: "Saß" }).click();
  await ruhe(page, 700);
  p.ok((await tisch(page).locator(".t-ticks .tick.past").count()) === 1, "ein Tick gefüllt");

  // 2: Weiß ich nicht, Daneben
  await tisch(page).getByRole("button", { name: "Weiß ich nicht" }).click();
  await ruhe(page, 1100);
  p.ok(/Nichts geschrieben/.test(await tisch(page).locator(".sc[data-pos='0'] .cb-mine").innerText()), "„Nichts geschrieben“");
  await tisch(page).getByRole("button", { name: "Daneben" }).click();
  await ruhe(page, 700);
  p.ok(/1 kommt nochmal/.test(await zahlText(page)), `„… · 1 kommt nochmal“ (${await zahlText(page)})`);

  // 3: Aufdecken leer, Saß; dann die Daneben-Frage noch einmal, Saß
  await tisch(page).getByRole("button", { name: "Aufdecken" }).click();
  await ruhe(page, 1100);
  await tisch(page).getByRole("button", { name: "Saß" }).click();
  await ruhe(page, 700);
  await tisch(page).getByRole("button", { name: "Aufdecken" }).click();
  await ruhe(page, 1100);
  await tisch(page).getByRole("button", { name: "Saß" }).click();
  await ruhe(page, 1000);
  const ende = await tisch(page).locator(".t-end").innerText();
  p.ok(/Fragen für heute durch\./.test(ende), "„Fragen für heute durch.“");
  p.ok(/3 Fragen, 2 beim ersten Mal\./.test(ende), `„3 Fragen, 2 beim ersten Mal.“ (${ende.replace(/\n/g, " / ")})`);
  p.ok(/Weiter mit Material/.test(ende) && /Block beenden/.test(ende), "„Weiter mit Material“ und „Block beenden“");
  await page.screenshot({ path: path.join(AUSGABE, "app-karten-ende-390-light.png") });

  // Material: Formelzeile kursiv in Newsreader
  await tisch(page).getByRole("button", { name: "Weiter mit Material" }).click();
  await ruhe(page, 800);
  const formel = page.locator("#sheet .abschrift .formel").first();
  p.ok((await formel.count()) && /f\(x\) = a\(x − d\)² \+ e/.test(await formel.innerText()), "Material: Formelzeile als .formel");
  const stil = await formel.evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.fontStyle} ${s.fontFamily}`;
  });
  p.ok(/italic/.test(stil) && /Newsreader|serif/i.test(stil), `… kursiv in Newsreader (${stil})`);
  await page.screenshot({ path: path.join(AUSGABE, "app-material-formel-390-light.png") });

  // Escape: Sheet, dann Tisch — die Seite darunter bleibt (hier: Startseite, kein Stapel)
  await page.keyboard.press("Escape");
  await ruhe(page, 600);
  p.ok(!(await page.locator("#sheet.open").count()) && (await tisch(page).locator(".t-end.on").isVisible()), "Esc schließt nur das Sheet");
  await page.keyboard.press("Escape");
  await ruhe(page, 700);
  p.ok(!(await page.locator("#lbTisch.open").count()), "Esc schließt dann den Tisch");

  // Kriterium 47: beim Wiederöffnen sind die Fragen erledigt
  await page.locator("#lbBtn").click();
  await ruhe(page, 1500);
  p.ok(await tisch(page).locator(".t-end.on").isVisible(), "Wiederöffnen: keine offene Frage mehr, gleich das Ende");
  p.ok(/3 Fragen, 2 beim ersten Mal\./.test(await tisch(page).locator(".t-end").innerText()), "… mit denselben Zahlen");
  await page.keyboard.press("Escape"); // Sheet (Material geht von selbst auf)
  await ruhe(page, 500);
  await page.keyboard.press("Escape");
  await ruhe(page, 700);

  p.ok(fehler.length === 0, `keine Konsolenfehler ${fehler.join(" | ")}`);
  await ctx.close();
}

async function stapelUndEscape(browser) {
  const ctx = await kontext(browser, { groesse: "390", schema: "light" });
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await ruhe(page, 600);
  await page.locator("#ovKl .exam-row").click();
  await ruhe(page, 900);
  p.ok((await seitenZahl(page)) === 1, "Klausurseite im Stapel");
  const tage = await page.locator("#pages .page .prow .pday").allInnerTexts();
  p.ok(tage.includes("Fr 9.10."), `verpasster Freitag als „Fr 9.10.“ (${tage.join(", ")})`);
  p.ok(tage[tage.length - 1] === "Fr", "Klausur in dieser Woche bleibt „Fr“");
  const blass = await page.locator("#pages .page .prow").first().evaluate((el) => getComputedStyle(el).opacity);
  p.ok(blass === "0.6", `vergangener Block blass (${blass})`);
  const text = await page.locator("#pages .page").last().innerText();
  p.ok(/Nachholen verteilt ihn auf die Tage bis zur Klausur, Auslassen streicht ihn\./.test(text), "Einzahl: „verteilt ihn … streicht ihn“");
  p.ok(!/Erledigtes und Angefangenes bleibt stehen/.test(text), "kein erfundener Untertitel unter „Lernplan neu erstellen“");
  p.ok(
    (await page.locator("#pages .page .p-sub", { hasText: "Am Takt ändert sich nichts." }).count()) === 1,
    "Erklärsatz zu „Termine neu rechnen“ als .p-sub",
  );

  await page.locator("#pages .page .prow.today .lbbtn").last().click();
  await ruhe(page, 1500);
  p.ok(await page.locator("#lbTisch.open").isVisible(), "Tisch über der Klausurseite");
  p.ok(await page.locator("#sheet.open").isVisible(), "ohne Fragen geht das Material auf");
  await page.keyboard.press("Escape");
  await ruhe(page, 600);
  p.ok(!(await page.locator("#sheet.open").count()) && (await page.locator("#lbTisch.open").count()) === 1, "Esc 1: Sheet zu, Tisch offen");
  await page.keyboard.press("Escape");
  await ruhe(page, 800);
  p.ok(!(await page.locator("#lbTisch.open").count()), "Esc 2: Tisch zu");
  p.ok((await seitenZahl(page)) === 1 && /\/klausuren\//.test(page.url()), `… die Klausurseite bleibt (${await seitenZahl(page)} Seite, ${new URL(page.url()).pathname})`);
  await page.keyboard.press("Escape");
  await ruhe(page, 800);
  p.ok((await seitenZahl(page)) === 0, "Esc 3: Seite zu");
  p.ok(fehler.length === 0, `keine Konsolenfehler ${fehler.join(" | ")}`);
  await ctx.close();
}

async function direkt(browser) {
  const ctx = await kontext(browser, { groesse: "390", schema: "light" });
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await page.goto(`${BASIS}/klausuren/${KLAUSUR}`);
  await ruhe(page, 1200);
  const seite = () => page.locator(".page").last();

  // Nachholen: der Hinweis und die Zeile vom Freitag verschwinden
  p.ok(/Ein Lernblock von Freitag ist offen\./.test(await seite().innerText()), "direkter Aufruf: verpasster Block");
  await seite().getByRole("button", { name: "Nachholen" }).click();
  await ruhe(page, 1800);
  const nach = await seite().innerText();
  p.ok(/Auf die Tage bis zur Klausur verteilt/.test(await page.locator("#toastText").innerText()), "Toast „Auf die Tage bis zur Klausur verteilt“");
  p.ok(!/ist offen\./.test(nach), "… der Hinweis ist weg");
  p.ok(!(await page.locator(".page .pday", { hasText: "9.10." }).count()), "… die Zeile vom Freitag ist weg");

  // Als erledigt zählen → Ja: die Zeile steht danach auf erledigt
  await page.locator(".page .prow.today .lbbtn").last().click();
  await ruhe(page, 1500);
  if (await page.locator("#sheet.open").count()) {
    await page.keyboard.press("Escape");
    await ruhe(page, 500);
  }
  await page.waitForTimeout(61_000);
  await page.locator("#lbTisch .tlink.known", { hasText: "Block beenden" }).click();
  await ruhe(page, 500);
  p.ok(/1 Minute gelernt/.test(await page.locator("#lbTisch .t-confirm.on").innerText()), "„Als erledigt zählen? 1 Minute gelernt“");
  await page.locator("#lbTisch .t-confirm .btn.ja").click();
  await ruhe(page, 1800);
  const heute = page.locator(".page .prow.today").last();
  p.ok(/, erledigt/.test(await heute.innerText()), `Zeile „…, erledigt“ (${(await heute.innerText()).replace(/\n/g, " / ")})`);
  p.ok(!(await heute.locator(".lbbtn").count()), "… ohne „Weiter“");
  const fortschritt = await page.locator(".page .p-sub", { hasText: "Blöcken erledigt" }).last().innerText();
  p.ok(/^1 von \d+ Blöcken erledigt/.test(fortschritt), `Fortschritt „1 von …“ (${fortschritt})`);
  await page.screenshot({ path: path.join(AUSGABE, "app-klausur-direkt-erledigt-390-light.png") });

  // Wiederöffnen und Rückgängig
  await heute.click();
  await ruhe(page, 1200);
  p.ok(/Lernblock wieder offen/.test(await page.locator("#toastText").innerText()), "Tipp: „Lernblock wieder offen“");
  p.ok(!/, erledigt/.test(await heute.innerText()), "… offen");
  await page.locator("#toastAct").click();
  await ruhe(page, 1500);
  p.ok(/, erledigt/.test(await heute.innerText()), "Rückgängig: wieder erledigt");
  await page.goto(`${BASIS}/`);
  await ruhe(page, 1200);
  p.ok(await page.locator("#lbRow.erledigt").count(), "Überblick: „Erledigt“");
  p.ok(fehler.length === 0, `keine Konsolenfehler ${fehler.join(" | ")}`);
  await ctx.close();
}

async function bilder(browser) {
  // Karten in allen Größen und Schemata: Wiederöffnen zeigt jetzt das Ende,
  // deshalb nur Klausurseite und Tisch-Ende; die Karte selbst kam in `karten`.
  for (const groesse of ["390", "360"]) {
    for (const schema of ["light", "dark"]) {
      const n = `${groesse}-${schema}`;
      await prototypBilder(browser, groesse, schema);
      const ctx = await kontext(browser, { groesse, schema });
      const page = await ctx.newPage();
      const fehler = fehlerSammeln(page);
      await anmelden(page);
      await ruhe(page, 700);
      await page.locator("#ovKl").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(AUSGABE, `app-ueberblick-${n}.png`) });
      const ov = await page.locator("#ovKl").innerText();
      p.ok(/Bio/.test(ov) && /Noch ein Lernblock heute: Mathe/.test(ov), `${n} Überblick: Bio oben, „Noch ein Lernblock heute: Mathe“`);
      await page.locator("#ovKl .textline", { hasText: "Noch ein Lernblock heute: Mathe" }).click();
      await ruhe(page, 900);
      await page.screenshot({ path: path.join(AUSGABE, `app-klausur-${n}.png`) });
      const klein = await kleinsteTippflaeche(page, "#pages .page");
      p.ok(klein.length === 0, `${n} Klausurseite: keine Tippfläche unter 44×44 ${klein.join("; ")}`);
      p.ok(fehler.length === 0, `${n} keine Konsolenfehler ${fehler.join(" | ")}`);
      await ctx.close();
    }
  }
}

async function kartenBilder(browser) {
  for (const groesse of ["390", "360"]) {
    for (const schema of ["light", "dark"]) {
      const n = `${groesse}-${schema}`;
      const ctx = await kontext(browser, { groesse, schema });
      const page = await ctx.newPage();
      const fehler = fehlerSammeln(page);
      await anmelden(page);
      await ruhe(page, 700);
      // Saat mit --eng: Bio morgen steht oben, Mathe als „Noch ein Lernblock heute“
      await page.locator("#ovKl .textline", { hasText: "Noch ein Lernblock heute: Mathe" }).click();
      await ruhe(page, 900);
      await page.locator("#pages .page .prow.today .lbbtn").last().click();
      await ruhe(page, 1500);
      await page.screenshot({ path: path.join(AUSGABE, `app-karte-${n}.png`) });
      const klein = await kleinsteTippflaeche(page, "#lbTisch");
      p.ok(klein.length === 0, `${n} Karte: keine Tippfläche unter 44×44 ${klein.join("; ")}`);
      await tisch(page).locator(".sc[data-pos='0'] textarea").fill("Am d und e");
      await tisch(page).getByRole("button", { name: "Aufdecken" }).click();
      await ruhe(page, 1100);
      await page.screenshot({ path: path.join(AUSGABE, `app-karte-loesung-${n}.png`) });
      // Daneben: nichts wird erledigt, die Saat bleibt für den nächsten Durchgang
      await tisch(page).getByRole("button", { name: "Daneben" }).click();
      await ruhe(page, 500);
      await tisch(page).locator(".tbtn").click();
      await ruhe(page, 700);
      p.ok(fehler.length === 0, `${n} keine Konsolenfehler ${fehler.join(" | ")}`);
      await ctx.close();
    }
  }
}

const browser = await browserStarten();
try {
  // Zwei Durchgänge, je auf frischer Saat (--fragen): PHASE=ablauf (Karten,
  // Escape, direkter Aufruf; verbraucht die Fragen) und PHASE=bilder.
  const phase = process.env.PHASE ?? "ablauf";
  if (phase === "ablauf") {
    await karten(browser);
    await stapelUndEscape(browser);
    await direkt(browser);
  } else {
    await kartenBilder(browser);
    await bilder(browser);
  }
} finally {
  await browser.close();
}
console.log(p.gruen ? "\nAlles grün." : "\nNICHT grün.");
process.exit(p.gruen ? 0 : 1);
