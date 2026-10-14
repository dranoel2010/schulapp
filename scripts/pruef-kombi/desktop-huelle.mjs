/**
 * Das Grundgerüst am Rechner (desktop.html, EINBAU.md „Am Rechner“) bei
 * 1024×700, 1280×800 und 1920×1080:
 *
 * - die Seitenleiste steht da, Heute ist markiert, das Datum oben;
 * - Bereichswechsel per Klick (mit Einblenden) und per Taste 1 bis 7 (ohne);
 * - Direktaufruf /klausuren/<id>: Liste und Detail;
 * - /hausaufgaben/<id> (das Formular der Aufgabe) im Detail neben der Liste;
 * - Zurück im Browser führt in den vorigen Bereich;
 * - die Zeile liegt mittig unter dem Detail, `/` öffnet sie als Popover;
 * - ↑/↓ gehen durch die Liste;
 * - ein Sheet öffnet als Dialog in der Mitte, Esc schließt ihn;
 * - der Knopf der Zeile lädt hoch: eine Datei wird ein Blatt (bei 1280 hell);
 * - kein waagrechter Überlauf, keine JS-Fehler.
 *
 *   BASIS=http://localhost:3380 node scripts/pruef-kombi/desktop-huelle.mjs [bildordner]
 *
 * Voraussetzungen wie desktop-handy-gleich.mjs (Produktionsbau mit
 * `SCHULAPP_TESTUHR=1`, Saat saat-abruf, saat-startseite). Mit Bildordner
 * legt es bei 1280 und 1920 hell und dunkel Bilder ab.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { BASIS, browserStarten, fehlerSammeln, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const p = new Pruefung("desktop-huelle");
const BILDER = process.argv[2];
if (BILDER) mkdirSync(BILDER, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GROESSEN = [
  { width: 1024, height: 700 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

async function anmelden(page) {
  await page.goto(`${BASIS}/login`);
  await page.fill('input[name="password"]', PASSWORT);
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
}

const pfad = (page) => new URL(page.url()).pathname;
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 0.5);
const listeUndDetail = (page) =>
  page.evaluate(() => {
    const l = document.querySelector(".d-split .d-list");
    const d = document.querySelector(".d-split .d-detail");
    return {
      liste: l?.querySelector(".p-title")?.textContent ?? null,
      detail: d?.querySelector(".p-title")?.textContent ?? null,
      formular: !!d?.querySelector("form"),
      lage: document.getElementById("stage")?.dataset.lay ?? null,
    };
  });

async function bild(page, name, w, schema) {
  if (!BILDER || w === 1024) return;
  await sleep(300);
  await page.screenshot({ path: path.join(BILDER, `${w}-${schema}-${name}.png`), animations: "disabled", caret: "hide" });
}

const browser = await browserStarten();
try {
  for (const g of GROESSEN) {
    for (const schema of g.width === 1024 ? ["light"] : ["light", "dark"]) {
      const w = g.width;
      console.log(`${w}×${g.height} ${schema}`);
      const ctx = await browser.newContext({ viewport: g, deviceScaleFactor: 1, colorScheme: schema, locale: "de-DE", timezoneId: "Europe/Berlin", serviceWorkers: "block" });
      const page = await ctx.newPage();
      const fehler = fehlerSammeln(page);
      await anmelden(page);
      await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-14T16:40`);
      await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
      await sleep(1200);

      // Seitenleiste, Heute ohne Ablauf
      const leiste = await page.evaluate(() => {
        const r = document.querySelector(".rail");
        const b = r?.getBoundingClientRect();
        return {
          sichtbar: !!r && getComputedStyle(r).display !== "none" && (b?.width ?? 0) > 200,
          aktiv: r?.querySelector('[aria-current="page"]')?.dataset.v ?? null,
          datum: r?.querySelector(".r-when b")?.textContent ?? "",
          ablauf: document.getElementById("flow")?.classList.contains("on") ?? false,
          punkte: [...(r?.querySelectorAll(".r-item") ?? [])].map((x) => x.textContent),
        };
      });
      p.ok(leiste.sichtbar, `${w}: Seitenleiste sichtbar`);
      p.ok(leiste.aktiv === "heute", `${w}: Heute ist markiert (${leiste.aktiv})`);
      p.ok(leiste.datum === "Mittwoch, 14. Oktober", `${w}: Datum oben (${leiste.datum})`);
      p.ok(!leiste.ablauf, `${w}: um 16:40 kein Ablauf, die Startseite zeigt den Überblick`);
      p.ok(!(await ueberlauf(page)), `${w}: Heute ohne waagrechten Überlauf`);
      await bild(page, "heute", w, schema);

      // Bereichswechsel per Klick, mit Einblenden
      // jede Animation mitschreiben, die ein Bereich beim Wechsel startet
      const mitschreiben = () =>
        page.evaluate(() => {
          window.__anim = [];
          if (window.__animOrig) return;
          window.__animOrig = Element.prototype.animate;
          Element.prototype.animate = function (k, o) {
            if (this.classList?.contains("d-bereich") || this.classList?.contains("d-spalte")) window.__anim.push(typeof o === "number" ? o : o?.duration);
            return window.__animOrig.call(this, k, o);
          };
        });
      await mitschreiben();
      await page.click('.rail .r-item[data-v="klausuren"]');
      await page.waitForURL(`${BASIS}/klausuren`);
      await sleep(300);
      const anim = (await page.evaluate(() => window.__anim)).includes(180);
      await sleep(700);
      const kl = await listeUndDetail(page);
      p.ok(kl.lage === "split" && kl.liste === "Klausuren", `${w}: Klick „Klausuren“ → Liste (${JSON.stringify(kl)})`);
      p.ok(anim, `${w}: Bereichswechsel mit der Maus blendet 180 ms ein`);
      p.ok(
        (await page.evaluate(() => document.querySelector('.rail [aria-current="page"]')?.dataset.v)) === "klausuren",
        `${w}: „Klausuren“ markiert`,
      );

      // per Taste, ohne Bewegung
      await mitschreiben();
      await page.keyboard.press("4");
      await page.waitForURL(/\/stundenplan/);
      await sleep(700);
      const ohne = (await page.evaluate(() => window.__anim)).length === 0;
      p.ok((await page.evaluate(() => document.getElementById("stage")?.dataset.lay)) === "scroll", `${w}: Taste 4 → Woche als Fläche`);
      p.ok(ohne, `${w}: per Taste ohne Übergang`);
      p.ok(!(await ueberlauf(page)), `${w}: Woche ohne waagrechten Überlauf`);
      await bild(page, "woche", w, schema);
      await page.keyboard.press("1");
      await page.waitForURL(`${BASIS}/`);
      await sleep(500);
      p.ok((await page.evaluate(() => document.querySelectorAll("#pages > *").length)) === 0, `${w}: Taste 1 → Heute`);

      // Direktaufruf einer Klausur
      const vorrat = await page.evaluate(async () => (await (await fetch("/api/zeile/vorrat")).json()).vorrat);
      const klausur = vorrat.klausuren.find((k) => k.datum === "2026-10-16") ?? vorrat.klausuren[0];
      await page.goto(`${BASIS}/klausuren/${klausur.id}`);
      // die Klausur trägt ihre Überschrift selbst (.d-h1, Teil „Hausaufgaben und Klausuren“), andere Details den Seitentitel
      await page.waitForSelector(".d-split .d-detail :is(.p-title, .d-h1) >> visible=true");
      await sleep(900);
      const direkt = await listeUndDetail(page);
      p.ok(direkt.liste === "Klausuren" && !!direkt.detail, `${w}: /klausuren/<id> direkt: Liste und Detail (${JSON.stringify(direkt)})`);
      p.ok(!(await ueberlauf(page)), `${w}: Klausur ohne waagrechten Überlauf`);

      // Die Zeile liegt mittig unter dem Detail
      const mitte = await page.evaluate(() => {
        const d = document.querySelector(".d-detail").getBoundingClientRect();
        const z = document.getElementById("dock").getBoundingClientRect();
        return { detail: d.left + d.width / 2, zeile: z.left + z.width / 2, breite: z.width, unten: window.innerHeight - z.bottom };
      });
      p.ok(Math.abs(mitte.detail - mitte.zeile) < 1.5 && mitte.breite <= 600.5, `${w}: Zeile mittig unter dem Detail (${JSON.stringify(mitte)})`);
      await bild(page, "klausur", w, schema);

      // Zurück im Browser
      await page.click('.rail .r-item[data-v="ablage"]');
      await page.waitForURL(`${BASIS}/material`);
      await sleep(800);
      await page.goBack();
      await page.waitForURL(`${BASIS}/klausuren/${klausur.id}`);
      await sleep(900);
      const zurueck = await listeUndDetail(page);
      p.ok(zurueck.liste === "Klausuren" && !!zurueck.detail, `${w}: Zurück aus der Ablage → wieder die Klausur (${JSON.stringify(zurueck)})`);

      // ↑/↓ in der Ablage
      await page.click('.rail .r-item[data-v="ablage"]');
      await page.waitForURL(`${BASIS}/material`);
      await page.waitForSelector(".d-list [data-id]");
      await sleep(500);
      await page.keyboard.press("ArrowDown");
      await page.waitForURL(/\/material\/[0-9a-f-]{36}$/);
      const erst = pfad(page);
      await sleep(700);
      await page.keyboard.press("j");
      await page.waitForFunction((a) => location.pathname !== a, erst);
      await sleep(900);
      const zweit = pfad(page);
      const sel = await page.evaluate(() => document.querySelector(".d-list .lrow.sel")?.dataset.id ?? null);
      p.ok(erst !== zweit && zweit.endsWith(sel ?? "-"), `${w}: ↓ und j gehen durch die Liste (${erst} → ${zweit}, gewählt ${sel})`);
      const blatt = await listeUndDetail(page);
      p.ok(blatt.liste === "Ablage" && !!blatt.detail, `${w}: Blatt im Detail (${blatt.detail})`);
      p.ok(!(await ueberlauf(page)), `${w}: Ablage ohne waagrechten Überlauf`);
      await bild(page, "ablage-blatt", w, schema);

      // Das Formular einer Aufgabe im Detail
      const aufgabe = vorrat.aufgaben.find((a) => !a.done) ?? vorrat.aufgaben[0];
      await page.goto(`${BASIS}/hausaufgaben/${aufgabe.id}`);
      await page.waitForSelector(".d-split .d-detail form");
      await sleep(900);
      const form = await listeUndDetail(page);
      p.ok(form.liste === "Hausaufgaben" && form.formular, `${w}: /hausaufgaben/<id>: Formular im Detail neben der Liste (${JSON.stringify(form)})`);
      p.ok(
        (await page.evaluate(() => [...document.querySelectorAll(".pback")].filter((b) => b.offsetParent).length)) === 0,
        `${w}: kein Zurück-Pfeil auf Bereichsseiten`,
      );
      await bild(page, "aufgabe-formular", w, schema);

      // Die Zeile: „/“ öffnet das Popover, Esc schließt
      await page.click(".rail .r-when");
      await page.keyboard.press("/");
      await page.waitForSelector("#menu.open.on");
      await sleep(400);
      const menue = await page.evaluate(() => {
        const m = document.getElementById("menu").getBoundingClientRect();
        const z = document.getElementById("dock").getBoundingClientRect();
        return { ueber: m.bottom <= z.top + 0.5, hoehe: m.height };
      });
      p.ok(menue.ueber && menue.hoehe <= 540.5, `${w}: „/“ öffnet das Menü als Popover über der Zeile (${JSON.stringify(menue)})`);
      await bild(page, "zeile-menue", w, schema);
      await page.keyboard.press("Escape");
      await sleep(400);
      p.ok(!(await page.evaluate(() => document.getElementById("menu").classList.contains("open"))), `${w}: Esc schließt das Menü`);

      // Ein Sheet als Dialog in der Mitte
      await page.evaluate(() => window.__kombi.openSheet("Ein Sheet zur Probe."));
      await page.waitForSelector("#sheet.on");
      await sleep(400);
      const dlg = await page.evaluate(() => {
        const b = document.getElementById("sheet").getBoundingClientRect();
        return { mitte: Math.abs(b.left + b.width / 2 - window.innerWidth / 2), hoehe: Math.abs(b.top + b.height / 2 - window.innerHeight / 2), breite: b.width };
      });
      p.ok(dlg.mitte < 1.5 && dlg.hoehe < 1.5 && dlg.breite <= 560.5, `${w}: Sheet als Dialog in der Mitte (${JSON.stringify(dlg)})`);
      await bild(page, "dialog", w, schema);
      await page.keyboard.press("Escape");
      await sleep(500);
      p.ok(!(await page.evaluate(() => document.getElementById("sheet").classList.contains("open"))), `${w}: Esc schließt den Dialog`);

      // Hochladen statt Kamera: ein Bild wird ein Blatt (nur einmal, es schreibt in die Datenbank)
      if (w === 1280 && schema === "light") {
        p.ok((await page.getAttribute("#camBtn", "aria-label")) === "Blatt hochladen", `${w}: der Knopf der Zeile heißt „Blatt hochladen“`);
        const png = await page.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = 600;
          c.height = 848;
          const x = c.getContext("2d");
          x.fillStyle = "#fff";
          x.fillRect(0, 0, 600, 848);
          x.fillStyle = "#222";
          x.font = "28px sans-serif";
          x.fillText("Probeblatt zum Hochladen", 40, 80);
          return c.toDataURL("image/png").split(",")[1];
        });
        await page.setInputFiles("#fileUp", { name: "blatt.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
        const toast = await page
          .waitForFunction(() => document.querySelector("#toast.on #toastText")?.textContent === "Blatt abgelegt", null, { timeout: 15000 })
          .then(
            () => true,
            () => false,
          );
        p.ok(toast, `${w}: eine Datei hochgeladen → „Blatt abgelegt“`);
        await sleep(600);
      }

      p.ok(fehler.length === 0, `${w}: keine JS-Fehler ${fehler.join(" | ")}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

console.log(p.gruen ? "\nDesktop-Hülle: alles grün" : "\nDesktop-Hülle: FEHLER");
process.exit(p.gruen ? 0 : 1);
