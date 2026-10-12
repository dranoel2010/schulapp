/**
 * Abschnitt F: Lernblock und Klausur im Browser (Plan 4 F, 5.4).
 *
 *   BASIS=http://localhost:3314 AUSGABE=/pfad node scripts/pruef-kombi/lernblock.mjs
 *
 * Zwei Durchgänge, je nach frischer Saat (scripts/saat-abruf.mts, dann
 * scripts/saat-lernblock.mts):
 *
 * - `PHASE=bilder` mit `saat-lernblock.mts --fragen`: Überblick, Klausurseite,
 *   Tisch mit Kopf, Uhr, Pause, Material, Zurück, Neuladen — und die Bilder.
 * - `PHASE=ende` mit `saat-lernblock.mts` (ohne Fragen): der Block öffnet mit
 *   dem Material, „Block beenden“ unter einer Minute, „Als erledigt zählen?“,
 *   „Erledigt“, Abhaken und Zurücknehmen auf der Klausurseite.
 * Bilder der App und des Prototyps (gleiche Namen) nach $AUSGABE, je 390×844
 * und 360×800, hell und dunkel.
 */

import fs from "node:fs";
import path from "node:path";

import { anmelden, browserStarten, fehlerSammeln, kontext, obersteSeite, Pruefung, ruhe, WURZEL } from "./gemeinsam.mjs";

const AUSGABE = process.env.AUSGABE ?? path.join(WURZEL, ".pruef-bilder");
fs.mkdirSync(AUSGABE, { recursive: true });
const PROTO = `file://${path.join(WURZEL, "entwurf-modelle/23-kombi-v2/index.html")}`;

const p = new Pruefung("Lernblock und Klausur");

async function kleinsteTippflaeche(page, wurzel) {
  return page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(`${sel} button, ${sel} a, ${sel} [role=button]`)) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (!r.width || !r.height || st.visibility === "hidden" || el.closest("[hidden]")) continue;
      if (r.width < 44 || r.height < 44) out.push(`${el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)} „${(el.textContent || "").trim().slice(0, 30)}“`);
    }
    return out;
  }, wurzel);
}

async function prototyp(browser, groesse, schema) {
  const ctx = await kontext(browser, { groesse, schema, ohneSW: true });
  const page = await ctx.newPage();
  await page.goto(`${PROTO}?zeit=16:40&reset`);
  await ruhe(page, 900);
  // Überblick: Ablauf überspringen, falls er kommt
  const skip = page.locator("text=Überspringen").first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await ruhe(page, 700);
  }
  const n = `${groesse}-${schema}`;
  await page.locator("#ovKl").scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: path.join(AUSGABE, `proto-ueberblick-${n}.png`) });
  await page.locator("#ovKl .exam-row").click();
  await ruhe(page, 700);
  await page.screenshot({ path: path.join(AUSGABE, `proto-klausur-${n}.png`) });
  await page.locator(".page .prow.today .lbbtn").click();
  await ruhe(page, 900);
  await page.screenshot({ path: path.join(AUSGABE, `proto-tisch-${n}.png`) });
  await ctx.close();
}

async function app(browser, groesse, schema, erste) {
  const ctx = await kontext(browser, { groesse, schema });
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await ruhe(page, 600);
  const n = `${groesse}-${schema}`;

  await page.waitForSelector("#ovKl");
  await page.locator("#ovKl").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(AUSGABE, `app-ueberblick-${n}.png`) });
  if (erste) {
    p.ok((await page.locator("#lbText").textContent()) === "Starten", "Lernblockzeile zeigt „Starten“");
    p.ok(/Lernblock\s*·\s*Scheitelpunktform/.test(await page.locator("#lbRow p").innerText()), "Lernblock · Scheitelpunktform");
  }

  await page.locator("#ovKl .exam-row").click();
  await ruhe(page, 900);
  p.ok((await obersteSeite(page)) === "Mathematik", "Klausurseite fährt ein (Titel Mathematik)");
  await page.screenshot({ path: path.join(AUSGABE, `app-klausur-${n}.png`) });
  const klein = await kleinsteTippflaeche(page, "#pages .page");
  p.ok(klein.length === 0, `Klausurseite: keine Tippfläche unter 44×44 ${klein.join("; ")}`);

  if (erste) {
    const text = await page.locator("#pages .page").last().innerText();
    p.ok(text.includes("Lernplan") && text.includes("Heute") && text.includes("2. Stunde"), "Lernplan mit Heute und Klausur 2. Stunde");
    p.ok(text.includes("Noten in Mathematik") && text.includes("2 · 3+ · 2−"), "Noten in Mathematik 2 · 3+ · 2−");
    p.ok(text.includes("Blätter zum Thema") && text.includes("Scheitelpunktform, Übungen"), "Blätter zum Thema");
    p.ok(text.includes("Termine neu rechnen") && text.includes("Am Takt ändert sich nichts."), "Termine neu rechnen mit Erklärsatz");
    p.ok(text.includes("Ein Lernblock von Freitag ist offen."), "verpasster Block mit Nachholen/Auslassen");

    // Starten aus der heutigen Planzeile → Tisch
    await page.locator("#pages .page .prow.today .lbbtn").last().click();
    await ruhe(page, 1200);
    p.ok(await page.locator("#lbTisch.open").isVisible(), "Tisch geht auf");
    const uhr1 = await page.locator("#lbTisch #tClockText").innerText();
    await page.waitForTimeout(2200);
    const uhr2 = await page.locator("#lbTisch #tClockText").innerText();
    p.ok(uhr1 !== uhr2 && /^2[45]:\d\d$/.test(uhr2), `Uhr läuft (${uhr1} → ${uhr2})`);
    p.ok((await page.locator("#lbTisch .t-thema").innerText()) === "Lernblock · Scheitelpunktform", "Kopf „Lernblock · Scheitelpunktform“");
    p.ok(/Mathematik · Klausur Fr 16\.10\./.test(await page.locator("#lbTisch .t-fach").innerText()), "Kopf „Mathematik · Klausur Fr 16.10.“");
    await page.screenshot({ path: path.join(AUSGABE, `app-tisch-${n}.png`) });
    const mat = page.locator("#lbTisch .t-mat");
    p.ok(/Material · Scheitelpunktform, 2 Seiten/.test(await mat.innerText()), "Material · Scheitelpunktform, 2 Seiten");

    // Pause
    await page.locator("#lbTisch #tClock").click();
    await ruhe(page, 600);
    const pz = await page.locator("#lbTisch #tClockText").innerText();
    await page.waitForTimeout(1500);
    p.ok((await page.locator("#lbTisch #tClockText").innerText()) === pz, "Pause hält die Uhr an");
    await page.screenshot({ path: path.join(AUSGABE, `app-tisch-pause-${n}.png`) });

    // Material als Sheet
    await mat.click();
    await ruhe(page, 700);
    p.ok(await page.locator("#sheet.open").isVisible(), "Material öffnet das Sheet");
    await page.screenshot({ path: path.join(AUSGABE, `app-material-${n}.png`) });
    await page.goBack();
    await ruhe(page, 600);
    p.ok(!(await page.locator("#sheet.open").count()), "Zurück schließt das Sheet, Tisch bleibt");
    p.ok(await page.locator("#lbTisch.open").isVisible(), "… der Tisch ist noch offen");

    // Zurück schließt den Tisch
    await page.goBack();
    await ruhe(page, 700);
    p.ok(!(await page.locator("#lbTisch.open").count()), "Zurück schließt den Tisch");
    p.ok(/Weiter/.test(await page.locator("#pages .page .prow.today .lbbtn").last().innerText()), "Planzeile zeigt „Weiter“");

    // Neuladen: der Uhrstand kommt vom Server
    await page.goto(page.url().replace(/\/klausuren\/.*/, "/"));
    await ruhe(page, 900);
    const lb = await page.locator("#lbRow").innerText();
    p.ok(/Weiter/.test(lb) && /Pausiert bei 2[45]:\d\d/.test(lb), `nach Neuladen: „Weiter“, „Pausiert bei …“ (${lb.replace(/\n/g, " / ")})`);
    await page.screenshot({ path: path.join(AUSGABE, `app-ueberblick-pausiert-${n}.png`) });
  }

  if (!erste) {
    // Tisch in dieser Größe und diesem Schema (der Block läuft dabei weiter)
    await page.locator("#pages .page .prow.today .lbbtn").last().click();
    await ruhe(page, 1300);
    await page.screenshot({ path: path.join(AUSGABE, `app-tisch-${n}.png`) });
    const kleinT = await kleinsteTippflaeche(page, "#lbTisch");
    p.ok(kleinT.length === 0, `Tisch: keine Tippfläche unter 44×44 ${kleinT.join("; ")}`);
    await page.locator("#lbTisch .tbtn").click();
    await ruhe(page, 700);
    p.ok(!(await page.locator("#lbTisch.open").count()), "Schließen (×) schließt den Tisch");
  }

  p.ok(fehler.length === 0, `keine Konsolenfehler ${fehler.join(" | ")}`);
  await ctx.close();
}

async function ende(browser) {
  const ctx = await kontext(browser, { groesse: "390", schema: "light" });
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);
  await ruhe(page, 600);

  // Ohne offene Fragen: das Ende des Blocks, das Material kommt von selbst
  await page.locator("#lbBtn").click();
  await ruhe(page, 1400);
  p.ok(await page.locator("#lbTisch .t-end.on").isVisible(), "ohne Fragen: „Fragen für heute durch.“");
  p.ok(/Heute waren keine Fragen offen\./.test(await page.locator("#lbTisch .t-end").innerText()), "„Heute waren keine Fragen offen.“");
  p.ok(await page.locator("#sheet.open").isVisible(), "das Material geht von selbst auf");
  await page.goBack();
  await ruhe(page, 600);
  await page.screenshot({ path: path.join(AUSGABE, "app-tisch-ende-390-light.png") });

  // Block beenden unter einer Minute: zurück auf Ruhe, ohne Frage
  await page.locator("#lbTisch .tlink.known").click();
  await ruhe(page, 900);
  p.ok(!(await page.locator("#lbTisch.open").count()), "unter 1 Minute: Tisch zu, keine Rückfrage");
  p.ok((await page.locator("#lbText").innerText()) === "Starten", "… und die Zeile zeigt wieder „Starten“");
  await page.reload();
  await ruhe(page, 900);
  p.ok((await page.locator("#lbText").innerText()) === "Starten", "… auch nach Neuladen");

  // Über einer Minute: „Als erledigt zählen? 1 Minute gelernt“
  await page.locator("#lbBtn").click();
  await ruhe(page, 1400);
  await page.goBack(); // Sheet zu
  await page.waitForTimeout(61_000);
  await page.locator("#lbTisch .tlink.known").click();
  await ruhe(page, 500);
  const frage = await page.locator("#lbTisch .t-confirm.on").innerText();
  p.ok(/Als erledigt zählen\?/.test(frage) && /1 Minute gelernt/.test(frage) && /Weiterlernen/.test(frage), `Rückfrage (${frage.replace(/\n/g, " / ")})`);
  await page.screenshot({ path: path.join(AUSGABE, "app-tisch-erledigt-frage-390-light.png") });
  await page.locator("#lbTisch .t-confirm .btn.ja").click();
  await ruhe(page, 1200);
  p.ok(!(await page.locator("#lbTisch.open").count()), "Ja: Tisch schrumpft in den Knopf");
  p.ok(await page.locator("#lbRow.erledigt").count(), "Lernblockzeile „Erledigt“");
  await page.screenshot({ path: path.join(AUSGABE, "app-ueberblick-erledigt-390-light.png") });
  await page.reload();
  await ruhe(page, 900);
  p.ok(await page.locator("#lbRow.erledigt").count(), "… auch nach Neuladen");
  // Erledigt startet nicht neu
  await page.locator("#lbBtn").click({ force: true }).catch(() => {});
  await ruhe(page, 500);
  p.ok(!(await page.locator("#lbTisch.open").count()), "ein erledigter Block startet nicht");

  // Klausurseite: heutigen Block wieder öffnen, Rückgängig; gestrigen abhaken
  await page.locator("#ovKl .exam-row").click();
  await ruhe(page, 900);
  const heute = page.locator("#pages .page .prow.today").last();
  p.ok(/, erledigt/.test(await heute.innerText()), "heutige Planzeile „…, erledigt“");
  await heute.click();
  await ruhe(page, 700);
  p.ok(/Lernblock wieder offen/.test(await page.locator("#toastText").innerText()), "Tipp: „Lernblock wieder offen“");
  p.ok(!/, erledigt/.test(await heute.innerText()), "… die Zeile ist offen");
  await page.locator("#toastAct").click();
  await ruhe(page, 900);
  p.ok(/, erledigt/.test(await heute.innerText()), "Rückgängig: wieder erledigt");
  const gestern = page.locator("#pages .page .prow").first();
  p.ok(!/, erledigt/.test(await gestern.innerText()), "gestriger Block offen");
  // Linkswisch
  const box = await gestern.boundingBox();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width - 20 - i * 12, box.y + box.height / 2);
  await page.mouse.up();
  await ruhe(page, 900);
  p.ok(/, erledigt/.test(await gestern.innerText()), "Linkswisch hakt den gestrigen Block ab");
  p.ok(/Lernblock erledigt/.test(await page.locator("#toastText").innerText()), "Toast „Lernblock erledigt“");
  await page.screenshot({ path: path.join(AUSGABE, "app-klausur-abgehakt-390-light.png") });
  p.ok(!(await page.locator("#pages .page").last().innerText()).includes("ist offen."), "kein verpasster Block mehr");

  // Termine neu rechnen
  await page.locator("#pages .page button.lrow", { hasText: "Termine neu rechnen" }).click();
  await ruhe(page, 1200);
  p.ok(/Termin|Keine offenen Termine/.test(await page.locator("#toastText").innerText()), `Termine neu rechnen: Toast „${await page.locator("#toastText").innerText()}“`);

  p.ok(fehler.length === 0, `keine Konsolenfehler ${fehler.join(" | ")}`);
  await ctx.close();
}

const browser = await browserStarten();
try {
  if (process.env.PHASE === "ende") {
    await ende(browser);
  } else {
    let erste = true;
    for (const groesse of ["390", "360"]) {
      for (const schema of ["light", "dark"]) {
        await prototyp(browser, groesse, schema);
        await app(browser, groesse, schema, erste);
        erste = false;
      }
    }
  }
} finally {
  await browser.close();
}
console.log(p.gruen ? "\nAlles grün." : "\nNICHT grün.");
process.exit(p.gruen ? 0 : 1);
