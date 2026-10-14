/**
 * Ablage, Fächer, Noten und Einstellungen am Rechner (desktop.html
 * `RENDER_ablage`, `blattDetail`, `RENDER_faecher`, `RENDER_noten`,
 * `RENDER_einstellungen`, `ablegen`, `seiteDazu`) bei 1024×700, 1280×800,
 * 1440×900 und 1920×1080, hell und dunkel:
 *
 * - Ablage: Fachpillen über der Liste in einer Zeile, Filter wirkt, ohne
 *   Auswahl steht das erste Blatt im Detail;
 * - Blatt: bis 1439 px Abschrift und Original umschaltbar, ab 1440 px das
 *   Original als Spalte daneben; Umlegen mit Rückgängig; „Thema üben“ oder
 *   „Thema abfragen“ öffnet den Tisch;
 * - Fächer, Noten: Liste und Detail, das erste Fach gewählt, Noten im Fach;
 * - Einstellungen: Tastatur im Detail, „wie das System“, eine Unterseite der
 *   App rechts im Detail;
 * - Hochladen (nur bei 1280 hell, es schreibt): ein Bild, zwei Bilder als ein
 *   Blatt, zwei Bilder als zwei Blätter, Ziehen ins Fenster, „Seite dazu“;
 *   das neue Blatt zeigt „Wird eingeordnet …“ oder „Liegt im Eingangskorb“
 *   und „Abschrift folgt“;
 * - kein waagrechter Überlauf, keine JS-Fehler.
 *
 *   BASIS=http://localhost:3384 node scripts/pruef-kombi/desktop-ablage.mjs [bildordner]
 *
 * Handy unverändert (dieselben Seiten bei 390, hell und dunkel, Pixel für
 * Pixel gegen ein Grundbild vom Stand vorher):
 *
 *   BASIS=… GRUND=<ordner> node scripts/pruef-kombi/desktop-ablage.mjs --handy-grund   # auf dem alten Stand
 *   BASIS=… GRUND=<ordner> node scripts/pruef-kombi/desktop-ablage.mjs --handy         # danach
 *
 * Voraussetzungen wie desktop-handy-gleich.mjs: Produktionsbau mit
 * `SCHULAPP_TESTUHR=1` auf eigenem Port mit eigener Datenbank, gesät mit
 * saat-abruf, saat-startseite, saat-wiederholen, saat-arbeitsblatt und
 * saat-archiv, dazu Noten (Mathematik, Geschichte, Französisch).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { BASIS, browserStarten, fehlerSammeln, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const HANDY = process.argv.includes("--handy") || process.argv.includes("--handy-grund");
const HANDY_GRUND = process.argv.includes("--handy-grund");
const BILDER = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (BILDER) mkdirSync(BILDER, { recursive: true });
const p = new Pruefung(HANDY ? "desktop-ablage (Handy)" : "desktop-ablage");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 0.5);
const pfad = (page) => new URL(page.url()).pathname;

async function anmelden(page) {
  await page.goto(`${BASIS}/login`);
  await page.fill('input[name="password"]', PASSWORT);
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
}

async function uhr(page, jetzt) {
  await page.goto(`${BASIS}/api/testuhr?jetzt=${jetzt}`);
  await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
  await sleep(1000);
}

/** Bühne mit Liste und Detail: Titel links, Titel rechts, Lage. */
const lage = (page) =>
  page.evaluate(() => ({
    lage: document.getElementById("stage")?.dataset.lay ?? null,
    bereich: document.getElementById("stage")?.dataset.v ?? null,
    liste: document.querySelector(".d-split .d-list .p-title")?.textContent ?? null,
    detail: document.querySelector(".d-split .d-detail :is(.p-title, .d-h1)")?.textContent ?? null,
    sel: document.querySelector(".d-list .sel")?.getAttribute("data-id") ?? null,
  }));

/** Bereich per Klick in der Seitenleiste; wartet, bis rechts etwas steht. */
async function bereich(page, v) {
  await page.click(`.rail .r-item[data-v="${v}"]`);
  await page.waitForFunction(
    (b) => document.getElementById("stage")?.dataset.v === b && !!document.querySelector(".d-split .d-detail :is(.p-title, .d-h1)")?.textContent,
    v,
    { timeout: 10000 },
  );
  await sleep(700);
}

async function bild(page, name, w, schema) {
  if (!BILDER) return;
  await sleep(250);
  await page.screenshot({ path: path.join(BILDER, `${w}-${schema}-${name}.png`), animations: "disabled", caret: "hide" });
}

/** Ein echtes Bild als Datei: ein Blatt Papier mit zwei Zeilen Text (JPEG). */
async function blattBild(text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754"><rect width="100%" height="100%" fill="#fbfaf6"/>
    <text x="110" y="200" font-family="Helvetica" font-size="64" fill="#222">${text}</text>
    <text x="110" y="300" font-family="Helvetica" font-size="40" fill="#444">Die Industrialisierung begann um 1760 in England.</text></svg>`;
  const datei = path.join(tmpdir(), `desktop-ablage-${text.replace(/\W+/g, "-")}.jpg`);
  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(datei);
  return datei;
}

async function toastText(page, erwartet, timeout = 20000) {
  return page
    .waitForFunction((t) => (document.querySelector("#toast.on #toastText")?.textContent ?? "").startsWith(t), erwartet, { timeout })
    .then(
      () => true,
      () => false,
    );
}

// ── Handy: dieselben Seiten bei 390, Pixel für Pixel ────────────────────────

async function handy(browser) {
  const GRUND = process.env.GRUND ?? path.join(tmpdir(), "desktop-ablage-handy");
  const AUS = process.env.AUS ?? path.join(tmpdir(), "desktop-ablage-handy-neu");
  mkdirSync(GRUND, { recursive: true });
  mkdirSync(AUS, { recursive: true });
  let n = 0;
  const anders = [];
  for (const schema of ["light", "dark"]) {
    const ctx = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: schema,
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
    });
    const page = await ctx.newPage();
    const fehler = fehlerSammeln(page);
    await page.goto(`${BASIS}/login`);
    await page.fill('input[name="password"]', PASSWORT);
    await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
    await page.waitForSelector("#whenrow", { state: "attached" });
    await uhr(page, "2026-10-14T16:40");
    await page.evaluate(() => window.__kombi.setView("ueberblick", { anim: false }));
    await sleep(800);
    const faecher = await page.evaluate(async () => (await (await fetch("/api/seite/faecher")).json()).daten);
    const ma = faecher.faecher.find((f) => f.name === "Mathematik") ?? faecher.faecher[0];
    const seiten = [
      ["faecher", {}],
      ["fach", { id: ma.id }],
      ["noten", {}],
      ["notenfach", { id: ma.id }],
      ["einstellungen", {}],
      ["archiv", {}],
    ];
    for (const [art, params] of seiten) {
      await page.evaluate(([a, q]) => window.__kombi.openPage(a, q), [art, params]);
      await page.waitForFunction(() => !!document.querySelector("#pages > .page:last-child .p-title")?.textContent, null, { timeout: 8000 }).catch(() => {});
      await sleep(1100);
      await page.evaluate(() => document.fonts.ready);
      let png = await page.screenshot({ animations: "disabled", caret: "hide" });
      for (let i = 0; i < 4; i++) {
        await sleep(400);
        const nochmal = await page.screenshot({ animations: "disabled", caret: "hide" });
        if (nochmal.equals(png)) break;
        png = nochmal;
      }
      const name = `390-${schema}-${art}`;
      n++;
      const datei = path.join(GRUND, `${name}.png`);
      if (HANDY_GRUND) writeFileSync(datei, png);
      else if (!existsSync(datei)) anders.push(`${name}: kein Grundbild`);
      else {
        const [a, b] = await Promise.all([
          sharp(readFileSync(datei)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
          sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        ]);
        let diff = 0;
        if (a.info.width !== b.info.width || a.info.height !== b.info.height) diff = -1;
        else for (let i = 0; i < a.data.length; i += 4) if (a.data.readUInt32LE(i) !== b.data.readUInt32LE(i)) diff++;
        if (diff) {
          anders.push(`${name}: ${diff < 0 ? "andere Größe" : `${diff} Pixel anders`}`);
          writeFileSync(path.join(AUS, `${name}-neu.png`), png);
        }
      }
      await page.evaluate(() => window.__kombi.popPage());
      await sleep(800);
    }
    p.ok(fehler.length === 0, `390 ${schema}: keine JS-Fehler ${fehler.join(" | ")}`);
    await ctx.close();
  }
  if (HANDY_GRUND) console.log(`Grundbild: ${n} Bilder unter ${GRUND}`);
  else p.ok(anders.length === 0, `Handy gleich: ${n} Bilder, ${anders.length} Abweichungen ${anders.join(" | ")}`);
}

// ── Am Rechner ───────────────────────────────────────────────────────────────

const GROESSEN = [
  { width: 1024, height: 700 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

async function rechner(browser) {
  for (const g of GROESSEN) {
    for (const schema of ["light", "dark"]) {
      const w = g.width;
      console.log(`${w}×${g.height} ${schema}`);
      const ctx = await browser.newContext({ viewport: g, deviceScaleFactor: 1, colorScheme: schema, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
      const page = await ctx.newPage();
      const fehler = fehlerSammeln(page);
      await anmelden(page);
      await uhr(page, "2026-10-14T16:40");

      // ── Ablage ──
      await bereich(page, "ablage");
      const ab = await lage(page);
      p.ok(ab.lage === "split" && ab.liste === "Ablage" && !!ab.detail, `${w} ${schema}: Ablage mit Blatt im Detail (${JSON.stringify(ab)})`);
      p.ok(/^\/material\/[0-9a-f-]{36}$/.test(pfad(page)) && !!ab.sel, `${w} ${schema}: ohne Auswahl steht das erste Blatt rechts (${pfad(page)})`);
      const fil = await page.evaluate(() => {
        const f = document.querySelector(".d-list .d-fil");
        const pills = [...(f?.querySelectorAll(".fp") ?? [])];
        const r = f?.getBoundingClientRect();
        const tops = new Set(pills.map((x) => Math.round(x.getBoundingClientRect().top)));
        return {
          da: !!f,
          n: pills.length,
          zeilen: tops.size,
          alleSichtbar: pills.every((x) => { const b = x.getBoundingClientRect(); return b.left >= r.left - 0.5 && b.right <= r.right + 0.5; }),
          hoehe: pills[0]?.getBoundingClientRect().height ?? 0,
          umbruch: getComputedStyle(f).flexWrap === "wrap",
          erste: pills[0]?.textContent,
          rechts: r ? r.right <= document.querySelector(".d-list").getBoundingClientRect().right + 0.5 : false,
        };
      });
      // mit der Maus gibt es kein Wischen: die Pillen brechen um, jede steht ganz in der Spalte
      p.ok(fil.da && fil.n >= 3 && fil.alleSichtbar && fil.umbruch && fil.hoehe === 36 && fil.erste === "Alle", `${w} ${schema}: Fachpillen umgebrochen, alle sichtbar, 36 px (${JSON.stringify(fil)})`);
      const gruppenVor = await page.evaluate(() => document.querySelectorAll(".d-list h3.p-lab").length);
      await page.click(".d-list .d-fil .fp:nth-child(2)");
      await sleep(400);
      const gruppenNach = await page.evaluate(() => ({
        n: document.querySelectorAll(".d-list h3.p-lab").length,
        gedrueckt: document.querySelector('.d-list .d-fil .fp[aria-pressed="true"]')?.textContent,
        kopf: document.querySelector(".d-list h3.p-lab")?.textContent,
      }));
      p.ok(gruppenVor > 1 && gruppenNach.n === 1 && gruppenNach.gedrueckt === gruppenNach.kopf, `${w} ${schema}: Filter zeigt nur ein Fach (${gruppenVor} → ${JSON.stringify(gruppenNach)})`);
      if (w === 1280) await bild(page, "ablage-filter", w, schema);
      await page.click(".d-list .d-fil .fp:first-child");
      await sleep(300);

      // ── Blatt: Abschrift und Original ──
      const blatt = await page.evaluate(async () => {
        const ablage = (await (await fetch("/api/seite/ablage")).json()).daten;
        return ablage.gruppen.flatMap((x) => x.blaetter).find((b) => b.titel === "Arbeit in der Fabrik, Kinderarbeit") ?? ablage.gruppen[0].blaetter[0];
      });
      await page.click(`.d-list [data-id="${blatt.id}"]`);
      await page.waitForURL(`${BASIS}/material/${blatt.id}`);
      await sleep(900);
      const orig = await page.evaluate(() => {
        const sichtbar = (s) => {
          const e = document.querySelector(s);
          return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0;
        };
        const o = document.querySelector(".d-detail .bl-orig")?.getBoundingClientRect();
        const m = document.querySelector(".d-detail .bl-main")?.getBoundingClientRect();
        const t = document.querySelector(".d-detail .d-in > :is(.p-title, .d-ober)")?.getBoundingClientRect();
        return {
          spalte: sichtbar(".d-detail .bl-orig"),
          seg: sichtbar(".d-detail .bl-seg"),
          abschrift: sichtbar(".d-detail .bl-ab .abschrift"),
          breite: o ? Math.round(o.width) : 0,
          daneben: !!o && !!m && o.left >= m.right + 40,
          obenBuendig: !!o && !!t && Math.abs(o.top - t.top) < 2,
        };
      });
      if (w >= 1440) {
        p.ok(orig.spalte && !orig.seg && orig.abschrift && orig.breite >= 260 && orig.breite <= 340 && orig.daneben && orig.obenBuendig, `${w} ${schema}: Original als Spalte neben der Abschrift (${JSON.stringify(orig)})`);
      } else {
        p.ok(!orig.spalte && orig.seg && orig.abschrift, `${w} ${schema}: Abschrift und Original umschaltbar (${JSON.stringify(orig)})`);
        await page.click('.d-detail .bl-seg button:nth-child(2)');
        await sleep(300);
        const og = await page.evaluate(() => {
          const e = document.querySelector(".d-detail .bl-og");
          return !!e && getComputedStyle(e).display !== "none" && !!e.querySelector(".original");
        });
        p.ok(og, `${w} ${schema}: „Original“ zeigt das Foto`);
        if (w === 1280) await bild(page, "blatt-original", w, schema);
        await page.click('.d-detail .bl-seg button:nth-child(1)');
        await sleep(300);
      }
      p.ok(!(await ueberlauf(page)), `${w} ${schema}: Blatt ohne waagrechten Überlauf`);
      await bild(page, "blatt", w, schema);

      // Thema üben oder abfragen, Seite dazu
      const fuss = await page.evaluate(() => [...document.querySelectorAll(".d-detail .bl-foot .btn")].map((b) => b.textContent));
      p.ok(fuss.includes("Seite dazu") && fuss.some((t) => t === "Thema üben" || t === "Thema abfragen"), `${w} ${schema}: unter „Fach und Thema“: ${fuss.join(", ")}`);
      if (w === 1920) {
        await page.click('.d-detail .bl-foot .btn:first-child');
        const tisch = await page
          .waitForSelector(".tisch.open", { timeout: 8000 })
          .then(
            () => true,
            () => false,
          );
        p.ok(tisch, `${w} ${schema}: „${fuss[0]}“ öffnet den Tisch`);
        await sleep(900);
        await page.keyboard.press("Escape");
        await sleep(900);
      }

      // Umlegen mit Rückgängig (schreibt, nimmt es aber zurück)
      if (w === 1440 && schema === "light") {
        const stand = () =>
          page.evaluate(() => ({
            fach: document.querySelector('.d-detail .refile .fp[aria-pressed="true"]')?.textContent,
            themen: [...document.querySelectorAll(".d-detail .bl-main .textline")].map((x) => x.textContent).join(", "),
          }));
        const vorher = await stand();
        await page.click('.d-detail .refile .fp[aria-pressed="false"]');
        const t = await toastText(page, "Nach ");
        const knopf = await page.evaluate(() => document.querySelector("#toast.on button:not([hidden])")?.textContent ?? "");
        p.ok(t && /Rückgängig/.test(knopf), `${w} ${schema}: Umlegen mit Toast und Rückgängig („${knopf}“)`);
        await page.click("#toast.on button:not([hidden])");
        await sleep(2000);
        const nachher = await stand();
        p.ok(vorher.fach === nachher.fach && !!vorher.themen && vorher.themen === nachher.themen, `${w} ${schema}: Rückgängig legt zurück, mit Themen (${JSON.stringify(vorher)} → ${JSON.stringify(nachher)})`);
      }

      // ── Fächer ──
      await bereich(page, "faecher");
      const fa = await lage(page);
      p.ok(fa.lage === "split" && fa.liste === "Fächer" && !!fa.detail && !!fa.sel, `${w} ${schema}: Fächer mit erstem Fach im Detail (${JSON.stringify(fa)})`);
      const ma = await page.evaluate(async () => (await (await fetch("/api/seite/faecher")).json()).daten.faecher.find((f) => f.name === "Mathematik"));
      await page.click(`.d-list [data-id="${ma.id}"]`);
      await page.waitForURL(`${BASIS}/faecher/${ma.id}`);
      await sleep(1200);
      const fach = await page.evaluate(() => {
        const labs = [...document.querySelectorAll(".d-detail .p-lab")].map((x) => x.textContent);
        return { labs, seg: document.querySelectorAll(".d-detail .seg2").length };
      });
      p.ok(["Themen", "Blätter", "Noten"].every((l) => fach.labs.includes(l)) && fach.seg > 0, `${w} ${schema}: Mathematik mit Themen, Blättern und Noten (${fach.labs.join(", ")})`);
      p.ok(!(await ueberlauf(page)), `${w} ${schema}: Fächer ohne waagrechten Überlauf`);
      await bild(page, "fach", w, schema);

      // ── Noten ──
      await bereich(page, "noten");
      const no = await lage(page);
      const noten = await page.evaluate(() => ({
        gesamt: !!document.querySelector(".d-list .total"),
        schnitte: document.querySelectorAll(".d-list .avg").length,
        reihen: document.querySelectorAll(".d-detail .grade-row").length,
        split: document.querySelector(".d-detail .split")?.textContent ?? "",
      }));
      p.ok(no.lage === "split" && !!no.detail && noten.gesamt && noten.schnitte >= 3 && noten.reihen > 0 && /Schriftlich|Mündlich/.test(noten.split), `${w} ${schema}: Noten mit Gesamt, Schnitt je Fach und Notenzeilen (${JSON.stringify({ ...no, ...noten })})`);
      p.ok(!(await ueberlauf(page)), `${w} ${schema}: Noten ohne waagrechten Überlauf`);
      await bild(page, "noten", w, schema);

      // ── Einstellungen ──
      await bereich(page, "einstellungen");
      const ei = await lage(page);
      const tast = await page.evaluate(() => ({
        zeilen: document.querySelectorAll(".d-detail .key-row").length,
        tasten: document.querySelectorAll(".d-detail .key-row .kbd").length,
        hell: [...document.querySelectorAll(".d-list .set-row span")].filter((s) => getComputedStyle(s).display !== "none").map((s) => s.textContent),
        gruppen: [...document.querySelectorAll(".d-list .p-lab")].map((x) => x.textContent),
      }));
      p.ok(ei.detail === "Tastatur" && ei.sel === "tastatur" && tast.zeilen === 8 && tast.tasten >= 12, `${w} ${schema}: Tastatur im Detail (${JSON.stringify({ ...ei, ...tast })})`);
      p.ok(tast.hell.join() === "wie das System", `${w} ${schema}: Hell und dunkel „wie das System“ (${tast.hell.join()})`);
      p.ok(["Schule", "Verbindungen", "App"].every((x) => tast.gruppen.includes(x)), `${w} ${schema}: Gruppen ${tast.gruppen.join(", ")}`);
      await bild(page, "einstellungen", w, schema);
      await page.click('.d-list [data-id="kalender"]');
      await page.waitForURL(`${BASIS}/einstellungen/kalender`);
      await sleep(1200);
      const kal = await lage(page);
      p.ok(kal.liste === "Einstellungen" && kal.sel === "kalender" && (await page.evaluate(() => (document.querySelector(".d-detail")?.textContent ?? "").length > 20)), `${w} ${schema}: Google Kalender im Detail (${JSON.stringify(kal)})`);
      p.ok(!(await ueberlauf(page)), `${w} ${schema}: Einstellungen ohne waagrechten Überlauf`);

      // ── Hochladen (nur einmal, es schreibt) ──
      if (w === 1280 && schema === "light") await hochladen(page, w, schema);

      p.ok(fehler.length === 0, `${w} ${schema}: keine JS-Fehler ${fehler.join(" | ")}`);
      await ctx.close();
    }
  }
}

async function hochladen(page, w, schema) {
  const eins = await blattBild("Probeblatt eins");
  const zwei = await blattBild("Probeblatt zwei");
  const drei = await blattBild("Probeblatt drei");
  await bereich(page, "ablage");

  /** Nach dem Toast: „Ansehen“ öffnet das neue Blatt im Detail; was steht da? */
  const ansehen = async () => {
    await page.click("#toast.on button:not([hidden])");
    await page.waitForFunction(() => /^\/material\/[0-9a-f-]{36}$/.test(location.pathname) && !!document.querySelector(".d-detail .d-in .p-sub"), null, { timeout: 10000 });
    await sleep(900);
    return page.evaluate(() => ({
      sub: [...document.querySelectorAll(".d-detail .d-in > .p-sub")].map((x) => x.textContent).join(" | "),
      abschrift: document.querySelector(".d-detail .bl-ab .abschrift")?.textContent ?? "",
    }));
  };

  // Ein Bild: ein Blatt
  await page.setInputFiles("#fileUp", [eins]);
  p.ok(await toastText(page, "Blatt abgelegt"), `${w} ${schema}: ein Bild → „Blatt abgelegt“`);
  const a = await ansehen();
  p.ok(/Wird eingeordnet …|Liegt im Eingangskorb/.test(a.sub) && /1 Seite/.test(a.sub), `${w} ${schema}: neues Blatt: ${a.sub}`);
  p.ok(/Abschrift folgt|Wird abgeschrieben/.test(a.abschrift), `${w} ${schema}: neues Blatt: ${a.abschrift}`);
  await bild(page, "neues-blatt", w, schema);

  // Zwei Bilder: der Dialog fragt
  await page.setInputFiles("#fileUp", [eins, zwei]);
  await page.waitForSelector("#sheet.on .d-frage");
  await sleep(400);
  const frage = await page.evaluate(() => {
    const s = document.getElementById("sheet");
    const b = s.getBoundingClientRect();
    return {
      titel: s.querySelector("h2")?.textContent,
      text: s.querySelector("p")?.textContent,
      knoepfe: [...s.querySelectorAll(".d-foot .btn")].map((x) => x.textContent),
      mitte: Math.abs(b.left + b.width / 2 - window.innerWidth / 2) < 1.5,
    };
  });
  p.ok(
    frage.titel === "Zwei Bilder" && frage.text === "Gehören sie zu einem Blatt, oder ist jedes ein eigenes?" && frage.knoepfe.join() === "Ein Blatt, 2 Seiten,Zwei Blätter" && frage.mitte,
    `${w} ${schema}: Dialog „ein Blatt oder mehrere“ (${JSON.stringify(frage)})`,
  );
  await bild(page, "dialog-zwei-bilder", w, schema);
  await page.click("#sheet.on .d-foot .btn:first-child");
  p.ok(await toastText(page, "Blatt abgelegt"), `${w} ${schema}: „Ein Blatt, 2 Seiten“ → „Blatt abgelegt“`);
  const b = await ansehen();
  p.ok(/2 Seiten/.test(b.sub), `${w} ${schema}: ein Blatt mit zwei Seiten (${b.sub})`);

  await page.setInputFiles("#fileUp", [zwei, drei]);
  await page.waitForSelector("#sheet.on .d-frage");
  await sleep(300);
  await page.click("#sheet.on .d-foot .btn:last-child");
  p.ok(await toastText(page, "Zwei Blätter abgelegt"), `${w} ${schema}: „Zwei Blätter“ → „Zwei Blätter abgelegt“`);
  await sleep(800);

  // Ziehen ins Fenster
  const bytes = readFileSync(drei).toString("base64");
  await page.evaluate((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], "gezogen.jpg", { type: "image/jpeg" }));
    window.__dt = dt;
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes);
  await sleep(400);
  const drop = await page.evaluate(() => {
    const d = document.querySelector(".d-drop");
    return { an: !!d?.classList.contains("on"), text: d?.textContent ?? "" };
  });
  p.ok(drop.an && drop.text === "Loslassen zum AblegenEin Bild je Blatt. Fach und Thema erkennt die App.", `${w} ${schema}: Ziehen zeigt „Loslassen zum Ablegen“ (${JSON.stringify(drop)})`);
  await bild(page, "ziehen", w, schema);
  await page.evaluate(() => window.dispatchEvent(new DragEvent("drop", { dataTransfer: window.__dt, bubbles: true, cancelable: true })));
  p.ok(await toastText(page, "Blatt abgelegt"), `${w} ${schema}: Loslassen legt ab`);
  p.ok(!(await page.evaluate(() => document.querySelector(".d-drop")?.classList.contains("on"))), `${w} ${schema}: danach ist die Fläche weg`);

  // Seite dazu an ein Blatt der Ablage
  const blatt = await page.evaluate(async () => {
    const ablage = (await (await fetch("/api/seite/ablage")).json()).daten;
    return ablage.gruppen.flatMap((x) => x.blaetter).find((x) => x.titel === "Arbeit in der Fabrik, Kinderarbeit") ?? ablage.gruppen[0].blaetter[0];
  });
  const seitenVor = await page.evaluate(async (id) => (await (await fetch(`/api/seite/blatt?id=${id}`)).json()).daten.seiten.length, blatt.id);
  await page.evaluate((id) => window.__kombi.openPage("blatt", { id }), blatt.id);
  await page.waitForURL(`${BASIS}/material/${blatt.id}`);
  await sleep(900);
  await page.setInputFiles('.d-detail .bl-main input[type="file"]', [zwei]);
  p.ok(await toastText(page, "Seite angehängt"), `${w} ${schema}: „Seite dazu“ → „Seite angehängt“`);
  await sleep(1500);
  const seitenNach = await page.evaluate(async (id) => (await (await fetch(`/api/seite/blatt?id=${id}`)).json()).daten.seiten.length, blatt.id);
  p.ok(seitenNach === seitenVor + 1, `${w} ${schema}: das Blatt hat eine Seite mehr (${seitenVor} → ${seitenNach})`);

  // PDF: ehrlich abgewiesen
  await page.setInputFiles("#fileUp", { name: "blatt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  p.ok(await toastText(page, "PDF geht noch nicht"), `${w} ${schema}: PDF → Hinweis statt stiller Fehler`);
}

const browser = await browserStarten();
try {
  if (HANDY) await handy(browser);
  else await rechner(browser);
} finally {
  await browser.close();
}

console.log(p.gruen ? `\n${p.name}: alles grün` : `\n${p.name}: FEHLER`);
process.exit(p.gruen ? 0 : 1);
