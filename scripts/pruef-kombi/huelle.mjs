/**
 * Abnahme von Abschnitt A (Plan 4, A) ohne den Stapel-Vertrag:
 *
 * - Menü der Zeile geht per clip-path auf und zu; Esc und Android-Zurück
 *   schließen es, Zurück schließt danach die Seite.
 * - Hell und Dunkel wechseln ohne Neuladen; theme-color folgt.
 * - Nur Schibsted Grotesk und Newsreader, nichts von fonts.googleapis.com.
 * - deploymentId: /_next/-Anfragen tragen ?dpl=.
 * - Kaltstart: mit reduzierter Bewegung nie html.pre; ohne sie bei 4×
 *   CPU-Drosselung kein Block, der sichtbar war, verschwindet und wiederkommt
 *   (Bildfolge per requestAnimationFrame, dazu ein Video).
 * - Die Zeile steht auf Startseite und Seite an derselben Stelle (Kr. 52).
 * - Kein Bedienelement der Shell unter 44×44, keine Konsolenfehler.
 *
 *   BASIS=http://localhost:3301 node scripts/pruef-kombi/huelle.mjs [videoordner]
 */

import {
  anmelden,
  BASIS,
  browserStarten,
  fehlerSammeln,
  kontext,
  Pruefung,
  ruhe,
  seitenZahl,
} from "./gemeinsam.mjs";

const p = new Pruefung("huelle");
const videoOrdner = process.argv[2];
const browser = await browserStarten();

async function zielflaechen(page, wurzel) {
  return page.evaluate((w) => {
    const klein = [];
    for (const el of document.querySelectorAll(`${w} button, ${w} a, ${w} [role=option], ${w} input`)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) klein.push(`${el.id || el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return klein;
  }, wurzel);
}

try {
  // ── Menü, Zurück, Esc, Zeile an derselben Stelle ─────────────────────────
  {
    const ctx = await kontext(browser);
    const page = await ctx.newPage();
    const fehler = fehlerSammeln(page);
    const anfragen = [];
    page.on("request", (r) => anfragen.push(r.url()));
    await anmelden(page);
    await page.waitForFunction(() => !!window.__kombi);
    await ruhe(page, 600);

    const dockStart = await page.locator("#dock").boundingBox();
    console.log("Menü");
    await page.click("#field");
    const clip = await page.evaluate(() =>
      document.getElementById("menu").getAnimations().some((a) => a.effect.getKeyframes().some((k) => "clipPath" in k)),
    );
    p.ok(clip, "das Menü wächst per clip-path aus der Zeile");
    await page.waitForSelector("#menu.open");
    await ruhe(page, 400);
    p.ok(await page.isVisible('#mLeer .m-gl:text-is("Wohin?")'), "„Wohin?“ steht da");
    const bereiche = await page.$$eval("#mLeer .m-grid .opt .o1", (xs) => xs.map((x) => x.textContent));
    p.ok(bereiche.length === 9, `neun Bereiche: ${bereiche.join(", ")}`);
    p.ok((await zielflaechen(page, "#zeile")).length === 0, `Menü: keine Fläche unter 44×44 ${(await zielflaechen(page, "#zeile")).join(" ")}`);
    await page.keyboard.press("Escape");
    await ruhe(page, 400);
    p.ok(!(await page.evaluate(() => document.getElementById("menu").classList.contains("open"))), "Esc schließt das Menü");

    await page.click("#field");
    await page.waitForSelector("#menu.open");
    await ruhe(page, 400);
    await page.goBack();
    await ruhe(page, 500);
    p.ok(!(await page.evaluate(() => document.getElementById("menu").classList.contains("open"))), "Zurück schließt das Menü");
    p.ok(page.url() === `${BASIS}/`, `… und bleibt auf ${page.url()}`);

    await page.evaluate(() => window.__kombi.openPage("probe"));
    await page.waitForSelector('#pages .page .p-title:text-is("Probe")');
    await ruhe(page, 500);
    const dockSeite = await page.locator("#dock").boundingBox();
    p.ok(JSON.stringify(dockStart) === JSON.stringify(dockSeite), `die Zeile steht auf Seite und Startseite gleich (${JSON.stringify(dockSeite)})`);
    p.ok((await zielflaechen(page, "#pages")).length === 0, `Seite: keine Fläche unter 44×44 ${(await zielflaechen(page, "#pages")).join(" ")}`);
    await page.click("#field");
    await page.waitForSelector("#menu.open");
    await ruhe(page, 400);
    await page.goBack();
    await ruhe(page, 500);
    p.ok((await seitenZahl(page)) === 1, "Zurück schließt erst das Menü, die Seite bleibt");
    await page.goBack();
    await ruhe(page, 600);
    p.ok((await seitenZahl(page)) === 0, "… dann die Seite");

    // Menü → Bereich öffnet die Seite; Zurück landet nicht auf dem leeren Menü
    await page.click("#field");
    await page.waitForSelector("#menu.open");
    await ruhe(page, 400);
    await page.click('#mLeer .opt:has-text("Noten")');
    await page.waitForURL(`${BASIS}/noten`);
    await ruhe(page, 700);
    p.ok((await seitenZahl(page)) === 1, "„Noten“ unter „Wohin?“ legt die Seite über die Startseite");
    p.ok((await zielflaechen(page, "#whenrow")).length === 0, "Datumszeile: Zahnrad 44×44");
    await page.goBack();
    await ruhe(page, 700);
    p.ok((await seitenZahl(page)) === 0 && page.url() === `${BASIS}/`, `Zurück aus „Noten“: Startseite (${page.url()})`);

    // Toast: 10 px über der Zeile
    await page.evaluate(() => window.__kombi.toast("Mathe abgehakt", () => {}));
    await page.waitForSelector(".toast.on");
    await ruhe(page, 300);
    const t = await page.locator("#toast").boundingBox();
    const d = await page.locator("#dock").boundingBox();
    p.ok(Math.round(d.y - (t.y + t.height)) === 10, `Toast 10 px über der Zeile (${Math.round(d.y - (t.y + t.height))})`);
    p.ok((await page.textContent("#toastAct")) === "Rückgängig", "Toast mit „Rückgängig“");

    // Schriften und deploymentId
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/['"]/g, "")))];
    });
    p.ok(fonts.length > 0 && fonts.every((f) => /Schibsted Grotesk|Newsreader/.test(f)), `geladene Schriften: ${fonts.join(", ")}`);
    p.ok(!anfragen.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), "keine Anfrage an fonts.googleapis.com");
    const statisch = anfragen.filter((u) => u.includes("/_next/static/"));
    p.ok(statisch.length > 0 && statisch.every((u) => /[?&]dpl=/.test(u)), `/_next/static trägt ?dpl= (${statisch.length} Dateien)`);
    p.ok(fehler.length === 0, `keine Konsolenfehler ${fehler.join(" | ")}`);
    await ctx.close();
  }

  // ── Hell und Dunkel ohne Neuladen ────────────────────────────────────────
  {
    console.log("Hell und Dunkel");
    const ctx = await kontext(browser, { schema: "light" });
    const page = await ctx.newPage();
    await anmelden(page);
    const farben = () =>
      page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        dock: getComputedStyle(document.getElementById("dock")).backgroundColor,
        tc: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
        marke: (window.__marke = window.__marke ?? Math.random()),
      }));
    const hell = await farben();
    await page.emulateMedia({ colorScheme: "dark" });
    await ruhe(page, 200);
    const dunkel = await farben();
    p.ok(hell.bg === "rgb(247, 247, 245)" && dunkel.bg === "rgb(20, 20, 22)", `Papier ${hell.bg} → ${dunkel.bg}`);
    p.ok(dunkel.dock === "rgb(11, 11, 12)", `Zeile im Dunkeln ${dunkel.dock}`);
    p.ok(hell.tc.every((c) => c === "#F7F7F5") && dunkel.tc.every((c) => c === "#141416"), `theme-color ${hell.tc} → ${dunkel.tc}`);
    p.ok(hell.marke === dunkel.marke, "ohne Neuladen");
    await page.goto(`${BASIS}/?theme=dark`);
    await page.emulateMedia({ colorScheme: "light" });
    await ruhe(page, 300);
    const ueberstimmt = await farben();
    p.ok(ueberstimmt.bg === "rgb(20, 20, 22)" && ueberstimmt.tc.every((c) => c === "#141416"), "data-theme=dark überstimmt das System (Prüfschalter)");
    await ctx.close();
  }

  // ── Kaltstart ────────────────────────────────────────────────────────────
  {
    console.log("Kaltstart");
    const ctx = await kontext(browser, { reduziert: true, ohneSW: true });
    await ctx.addInitScript({
      content:
        // documentElement gibt es beim Start des Init-Skripts noch nicht
        "window.__preGesehen=false;" +
        "new MutationObserver(function(){var d=document.documentElement;if(d&&d.classList.contains('pre'))window.__preGesehen=true})" +
        ".observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});",
    });
    const page = await ctx.newPage();
    await anmelden(page);
    await page.reload();
    await ruhe(page, 1500);
    p.ok((await page.evaluate(() => window.__preGesehen)) === false, "mit reduzierter Bewegung nie html.pre");
    await ctx.close();

    const ctx2 = await kontext(browser, { ohneSW: true, ...(videoOrdner ? { video: videoOrdner } : {}) });
    await ctx2.addInitScript(() => {
      window.__bilder = [];
      window.__preGesehen = false;
      new MutationObserver(() => {
        const d = document.documentElement;
        if (d && d.classList.contains("pre")) window.__preGesehen = true;
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
      const t0 = performance.now();
      const probe = () => {
        const w = document.getElementById("whenrow");
        if (w) window.__bilder.push({ t: Math.round(performance.now() - t0), o: Number(getComputedStyle(w).opacity) });
        if (performance.now() - t0 < 3000) requestAnimationFrame(probe);
      };
      requestAnimationFrame(probe);
    });
    const page2 = await ctx2.newPage();
    await anmelden(page2);
    const cdp = await ctx2.newCDPSession(page2);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page2.reload();
    await ruhe(page2, 3500);
    const bilder = await page2.evaluate(() => window.__bilder);
    let sichtbar = false;
    let zuckt = false;
    for (const b of bilder) {
      if (b.o > 0.5) sichtbar = true;
      else if (sichtbar && b.o < 0.05) zuckt = true;
    }
    p.ok(await page2.evaluate(() => window.__preGesehen), "ohne reduzierte Bewegung: html.pre beim Start");
    p.ok(bilder.length > 10 && !zuckt, `4× gedrosselt: kein Aufblitzen (${bilder.length} Bilder, letzte Deckkraft ${bilder.at(-1)?.o})`);
    p.ok(!(await page2.evaluate(() => document.documentElement.classList.contains("pre"))), "pre ist danach weg");
    await ctx2.close();
  }
} finally {
  await browser.close();
}

console.log(p.gruen ? "\nHülle: alles grün" : "\nHülle: FEHLER");
process.exit(p.gruen ? 0 : 1);
