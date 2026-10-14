/**
 * Hausaufgaben und Klausuren am Rechner (desktop.html `RENDER_hausaufgaben`,
 * `aufgabeDetail`, `RENDER_klausuren`, `klausurDetail`) bei 1024×700,
 * 1280×800 und 1920×1080, hell und dunkel:
 *
 * - „Hausaufgaben“ öffnet die Liste mit der ersten Aufgabe im Detail
 *   (Fach als Angabe, Aufgabe als Titel, Abgabe, Stunde, Eingetragen, Erledigt/Bearbeiten);
 * - ↓ wählt die nächste Aufgabe, der Text wählt aus, der Ring hakt ab;
 * - X hakt die gewählte überfällige Aufgabe ab (sie steht unter „Erledigt“),
 *   ein zweites X öffnet sie wieder: sie steht unter „Für ⟨Tag⟩“;
 * - „Bearbeiten“ öffnet das Formular der App im Detail, „Abbrechen“ führt
 *   zur Aufgabe zurück;
 * - „Klausuren“ öffnet die Liste mit der nächsten Klausur im Detail:
 *   „Datum · relativ“, „Fach: Thema“, Lernplan als Wochenstreifen (bis 1279
 *   eine Zeile je Tag), heute mit „Starten“, jeder Block im Streifen,
 *   „Blätter zum Thema“ und „Noten in ⟨Fach⟩“ nebeneinander;
 * - am Ende (1920 dunkel): „Archiv“ im Detail, ein Klick auf den Ring holt
 *   die Aufgabe zurück unter „Für ⟨Tag⟩“;
 * - kein waagrechter Überlauf (Seite, Liste, Detail), keine JS-Fehler.
 *
 *   BASIS=http://localhost:3382 node scripts/pruef-kombi/desktop-listen.mjs [bildordner]
 *
 * Voraussetzungen wie desktop-huelle.mjs (Produktionsbau mit
 * `SCHULAPP_TESTUHR=1`, Saat saat-abruf, saat-startseite, saat-wiederholen,
 * saat-arbeitsblatt). Schreibt in die Datenbank (Abhaken, Archiv); danach
 * die Saat zurücksetzen.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { BASIS, browserStarten, fehlerSammeln, PASSWORT, Pruefung } from "./gemeinsam.mjs";

const p = new Pruefung("desktop-listen");
const BILDER = process.argv[2];
if (BILDER) mkdirSync(BILDER, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAEUFE = [
  { width: 1024, height: 700, schema: "light" },
  { width: 1280, height: 800, schema: "light" },
  { width: 1280, height: 800, schema: "dark" },
  { width: 1920, height: 1080, schema: "light" },
  { width: 1920, height: 1080, schema: "dark" },
];

async function anmelden(page) {
  await page.goto(`${BASIS}/login`);
  await page.fill('input[name="password"]', PASSWORT);
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
}

/** Waagrechter Überlauf: die Seite, die Liste oder das Detail ist breiter als sein Platz */
const ueberlauf = (page) =>
  page.evaluate(() => {
    const zu = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 0.5) zu.push("Seite");
    for (const s of [".d-list", ".d-detail"]) {
      const el = document.querySelector(s);
      if (el && el.scrollWidth > el.clientWidth + 0.5) zu.push(s);
    }
    // nichts ragt aus dem Detail heraus
    const d = document.querySelector(".d-detail")?.getBoundingClientRect();
    if (d)
      for (const el of document.querySelectorAll(".d-detail .lp-d, .d-detail .d-fact, .d-detail .two > div")) {
        const r = el.getBoundingClientRect();
        if (r.right > d.right + 0.5) zu.push(el.className);
      }
    return zu;
  });

const gruppeVon = (page, id) =>
  page.evaluate((i) => document.querySelector(`.d-list .task[data-id="${i}"]`)?.closest(".group")?.dataset.g ?? null, id);

const selVon = (page) => new URL(page.url()).searchParams.get("sel");

async function bild(page, name, lauf) {
  if (!BILDER) return;
  await sleep(350);
  await page.screenshot({ path: path.join(BILDER, `${lauf.width}-${lauf.schema}-${name}.png`), animations: "disabled", caret: "hide" });
}

const browser = await browserStarten();
try {
  for (const lauf of LAEUFE) {
    const w = lauf.width;
    const vor = `${w} ${lauf.schema}`;
    console.log(vor);
    const ctx = await browser.newContext({
      viewport: { width: lauf.width, height: lauf.height },
      deviceScaleFactor: 1,
      colorScheme: lauf.schema,
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      serviceWorkers: "block",
    });
    const page = await ctx.newPage();
    const fehler = fehlerSammeln(page);
    await anmelden(page);
    await page.goto(`${BASIS}/api/testuhr?jetzt=2026-10-14T16:40`);
    await page.waitForFunction(() => !!window.__kombi && !!window.__kombi.tagDaten);
    await sleep(1000);

    // ── Hausaufgaben ──────────────────────────────────────────────────────
    await page.click('.rail .r-item[data-v="hausaufgaben"]');
    await page.waitForURL(/\/hausaufgaben\?sel=/);
    await page.waitForSelector(".d-detail .d-aufgabe .d-h1");
    await sleep(700);
    const erst = await page.evaluate(() => {
      const zeilen = [...document.querySelectorAll(".d-list .task")];
      return {
        gruppen: [...document.querySelectorAll(".d-list .group:not([hidden]) .lab")].map((x) => x.textContent),
        erste: zeilen[0]?.dataset.id ?? null,
        gewaehlt: document.querySelector(".d-list .task.sel")?.dataset.id ?? null,
        h1: document.querySelector(".d-aufgabe .d-h1")?.textContent ?? "",
        fach: document.querySelector(".d-aufgabe .d-ober")?.textContent ?? "",
        fakten: [...document.querySelectorAll(".d-aufgabe .d-fact > span:first-child")].map((x) => x.textContent),
        knoepfe: [...document.querySelectorAll(".d-aufgabe .d-foot .btn")].map((x) => x.textContent),
        archiv: document.querySelector(".d-list .d-arch b")?.textContent ?? null,
      };
    });
    p.ok(erst.gruppen.includes("Für Donnerstag"), `${vor}: Gruppen wie die App (${erst.gruppen.join(", ")})`);
    p.ok(!!erst.erste && erst.gewaehlt === erst.erste && selVon(page) === erst.erste, `${vor}: ohne Auswahl steht die erste Aufgabe im Detail`);
    p.ok(!!erst.fach && !!erst.h1 && !erst.h1.includes(":"), `${vor}: Fach als Angabe, die Aufgabe als Überschrift (${erst.fach} / ${erst.h1})`);
    p.ok(["Abgabe", "Stunde", "Eingetragen"].every((f) => erst.fakten.includes(f)), `${vor}: Abgabe, Stunde, Eingetragen (${erst.fakten.join(", ")})`);
    p.ok(erst.knoepfe[0]?.startsWith("Erledigt") && erst.knoepfe[1] === "Bearbeiten", `${vor}: Knöpfe Erledigt und Bearbeiten (${erst.knoepfe.join(", ")})`);
    p.ok(erst.archiv === "Archiv", `${vor}: am Ende die Zeile „Archiv“`);
    p.ok((await ueberlauf(page)).length === 0, `${vor}: Hausaufgaben ohne Überlauf ${(await ueberlauf(page)).join(" ")}`);
    await bild(page, "hausaufgaben", lauf);

    // ↓ wählt die nächste, ohne Übergang
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction((a) => new URL(location.href).searchParams.get("sel") !== a, erst.erste);
    await sleep(600);
    const zweit = selVon(page);
    p.ok(
      zweit !== erst.erste && (await page.evaluate(() => document.querySelector(".d-list .task.sel")?.dataset.id)) === zweit,
      `${vor}: ↓ wählt die nächste Aufgabe`,
    );

    // Der Text wählt aus (die erste wieder), der Ring bleibt offen
    await page.click(`.d-list .task[data-id="${erst.erste}"] .t-txt`);
    await page.waitForFunction((a) => new URL(location.href).searchParams.get("sel") === a, erst.erste);
    await sleep(600);
    p.ok(
      !(await page.evaluate((i) => document.querySelector(`.d-list .task[data-id="${i}"]`)?.classList.contains("done"), erst.erste)),
      `${vor}: ein Klick auf den Text wählt aus und hakt nicht ab`,
    );

    // X: die gewählte überfällige Aufgabe abhaken und wieder öffnen
    const alt = await page.evaluate(() => {
      const z = [...document.querySelectorAll(".d-list .task")].find((t) => /war fällig/.test(t.querySelector(".t-sub")?.textContent ?? ""));
      return z?.dataset.id ?? null;
    });
    p.ok(!!alt, `${vor}: eine überfällige Aufgabe steht in der Liste`);
    if (alt) {
      await page.click(`.d-list .task[data-id="${alt}"] .t-txt`);
      await page.waitForFunction((a) => new URL(location.href).searchParams.get("sel") === a, alt);
      await sleep(500);
      await page.keyboard.press("x");
      await page.waitForFunction((i) => document.querySelector(`.d-list .task[data-id="${i}"]`)?.closest(".group")?.dataset.g === "Erledigt", alt, { timeout: 8000 }).catch(() => {});
      p.ok((await gruppeVon(page, alt)) === "Erledigt", `${vor}: X hakt ab, die Aufgabe steht unter „Erledigt“ (${await gruppeVon(page, alt)})`);
      await page.waitForFunction(() => document.querySelector(".d-aufgabe .d-foot .btn")?.textContent?.startsWith("Wieder öffnen"), null, { timeout: 8000 }).catch(() => {});
      p.ok(
        (await page.evaluate(() => document.querySelector(".d-aufgabe .d-foot .btn")?.textContent ?? "")).startsWith("Wieder öffnen"),
        `${vor}: das Detail sagt jetzt „Wieder öffnen“`,
      );
      await sleep(600);
      await page.keyboard.press("x");
      await page.waitForFunction((i) => document.querySelector(`.d-list .task[data-id="${i}"]`)?.closest(".group")?.dataset.g === "Für Donnerstag", alt, { timeout: 8000 }).catch(() => {});
      const g = await gruppeVon(page, alt);
      p.ok(g === "Für Donnerstag", `${vor}: die erledigte alte Aufgabe mit X wieder geöffnet steht unter „Für Donnerstag“ (${g})`);
      p.ok(selVon(page) === alt && (await page.evaluate((i) => document.querySelector(`.d-list .task[data-id="${i}"]`)?.classList.contains("sel"), alt)), `${vor}: sie bleibt gewählt`);
      await sleep(900);
    }

    // Bearbeiten: das Formular der App im Detail, Abbrechen zurück zur Aufgabe
    const vorher = selVon(page);
    await page.click(".d-aufgabe .d-foot .btn.quiet");
    await page.waitForURL(/\/hausaufgaben\/[0-9a-f-]{36}$/);
    await page.waitForSelector(".d-detail form");
    await sleep(800);
    const form = await page.evaluate(() => ({
      liste: document.querySelector(".d-list .p-title")?.textContent ?? null,
      felder: [...document.querySelectorAll(".d-detail form .kf-label")].map((x) => x.textContent),
      sel: document.querySelector(".d-list .task.sel")?.dataset.id ?? null,
    }));
    p.ok(form.liste === "Hausaufgaben" && form.felder.includes("Fach") && form.felder.includes("Aufgabe"), `${vor}: Bearbeiten öffnet das Formular im Detail (${form.felder.join(", ")})`);
    p.ok(form.sel === vorher, `${vor}: die Aufgabe bleibt in der Liste gewählt`);
    p.ok((await ueberlauf(page)).length === 0, `${vor}: Formular ohne Überlauf`);
    await bild(page, "aufgabe-bearbeiten", lauf);
    await page.click(".d-detail form .btn.quiet");
    await page.waitForURL(/\/hausaufgaben\?sel=/, { timeout: 8000 }).catch(() => {});
    p.ok(selVon(page) === vorher, `${vor}: Abbrechen führt zur Aufgabe zurück (${page.url()})`);
    await sleep(600);

    // ── Klausuren ─────────────────────────────────────────────────────────
    await page.click('.rail .r-item[data-v="klausuren"]');
    await page.waitForURL(/\/klausuren\/[0-9a-f-]{36}$/);
    await page.waitForSelector(".d-detail .d-klausur .lp");
    await sleep(800);
    const k = await page.evaluate(() => {
      const lp = document.querySelector(".lp");
      const heute = document.querySelector(".lp-d.today");
      return {
        ober: document.querySelector(".d-klausur .d-ober")?.textContent ?? "",
        h1: document.querySelector(".d-klausur .d-h1")?.textContent ?? "",
        titelVersteckt: [...document.querySelectorAll(".d-detail .d-in > .p-title")].every((x) => !x.offsetParent),
        spalten: getComputedStyle(lp).gridTemplateColumns.split(" ").length,
        tage: [...document.querySelectorAll(".lp-d")].map((d) => d.dataset.tag),
        heute: heute?.querySelector(".pday")?.textContent ?? null,
        knopf: heute?.querySelector(".lbbtn")?.textContent ?? null,
        klausur: document.querySelector(".lp-d.exday .lp-b")?.textContent ?? "",
        two: getComputedStyle(document.querySelector(".two")).gridTemplateColumns.split(" ").length,
        labs: [...document.querySelectorAll(".two .p-lab")].map((x) => x.textContent),
        wege: [...document.querySelectorAll(".d-wege .lrow b")].map((x) => x.textContent),
        gewaehlt: document.querySelector(".d-list .lrow.sel")?.dataset.id ?? null,
      };
    });
    const kid = new URL(page.url()).pathname.split("/").pop();
    p.ok(/· in 2 Tagen$/.test(k.ober), `${vor}: Datum · relativ (${k.ober})`);
    p.ok(k.h1 === "Mathematik: Quadratische Funktionen", `${vor}: „Fach: Thema“ (${k.h1})`);
    p.ok(k.titelVersteckt, `${vor}: der Seitentitel steht nicht doppelt`);
    p.ok(k.gewaehlt === kid, `${vor}: die Klausur ist in der Liste gewählt`);
    p.ok(w < 1280 ? k.spalten === 1 : k.spalten === 5, `${vor}: Lernplan ${w < 1280 ? "eine Zeile je Tag" : "Mo bis Fr nebeneinander"} (${k.spalten} Spalten)`);
    p.ok(k.heute === "Heute, 14.10." && k.knopf === "Starten", `${vor}: heute kräftig mit „Starten“ (${k.heute}, ${k.knopf})`);
    p.ok(/^Klausur2\. Stunde, 09:50$/.test(k.klausur), `${vor}: Klausur mit Stunde (${k.klausur})`);
    p.ok(w < 1280 ? true : k.two === 2, `${vor}: Blätter und Noten nebeneinander (${k.two})`);
    p.ok(k.labs[0] === "Blätter zum Thema" && k.labs[1] === "Noten in Mathematik", `${vor}: ${k.labs.join(", ")}`);
    p.ok(["Stoff und Fragen", "Bearbeiten"].every((x) => k.wege.includes(x)) && k.wege.some((x) => x.startsWith("Lernplan")), `${vor}: Wege im Detail (${k.wege.join(", ")})`);
    const daten = await page.evaluate(async (id) => (await (await fetch(`/api/seite/klausur?id=${id}`)).json()).daten, kid);
    const fehlt = daten.bloecke.map((b) => b.tag).filter((t) => !k.tage.includes(t));
    p.ok(fehlt.length === 0, `${vor}: jeder Block steht im Streifen ${fehlt.join(", ")}`);
    p.ok((await ueberlauf(page)).length === 0, `${vor}: Klausur ohne Überlauf ${(await ueberlauf(page)).join(" ")}`);
    await bild(page, "klausur", lauf);
    await page.evaluate(() => (document.querySelector(".d-detail").scrollTop = 99999));
    await bild(page, "klausur-unten", lauf);

    // die nächste Klausur (↓): auch ihr Plan steht ganz im Streifen
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction((a) => !location.pathname.endsWith(a), kid);
    await page.waitForSelector(".d-detail .d-klausur");
    await sleep(900);
    const kid2 = new URL(page.url()).pathname.split("/").pop();
    const d2 = await page.evaluate(async (id) => (await (await fetch(`/api/seite/klausur?id=${id}`)).json()).daten, kid2);
    const tage2 = await page.evaluate(() => [...document.querySelectorAll(".lp-d")].map((d) => d.dataset.tag));
    const fehlt2 = d2.bloecke.map((b) => b.tag).filter((t) => !tage2.includes(t));
    p.ok(fehlt2.length === 0 && tage2.includes(d2.datum), `${vor}: zweite Klausur: jeder Block und der Klausurtag im Streifen ${fehlt2.join(", ")}`);
    p.ok((await ueberlauf(page)).length === 0, `${vor}: zweite Klausur ohne Überlauf ${(await ueberlauf(page)).join(" ")}`);
    await bild(page, "klausur-2", lauf);

    // ── Archiv (nur einmal: es schreibt in die Datenbank) ──────────────────
    if (w === 1920 && lauf.schema === "dark") {
      await page.click('.rail .r-item[data-v="hausaufgaben"]');
      await page.waitForURL(/\/hausaufgaben/);
      await page.waitForSelector(".d-list .d-arch");
      await sleep(600);
      await page.click(".d-list .d-arch");
      await page.waitForURL(`${BASIS}/archiv`);
      await page.waitForSelector(".d-detail .task.done");
      await sleep(800);
      p.ok(
        await page.evaluate(() => document.querySelector(".d-list .d-arch")?.classList.contains("sel") && document.querySelector(".d-detail .p-title")?.textContent === "Archiv"),
        `${vor}: „Archiv“ öffnet im Detail, die Zeile ist gewählt`,
      );
      await bild(page, "archiv", lauf);
      const arch = await page.evaluate(() => document.querySelector(".d-detail .task.done")?.dataset.id);
      await page.click(`.d-detail .task[data-id="${arch}"] .check`);
      await page.waitForFunction((i) => document.querySelector(`.d-list .task[data-id="${i}"]`)?.closest(".group")?.dataset.g === "Für Donnerstag", arch, { timeout: 8000 }).catch(() => {});
      p.ok((await gruppeVon(page, arch)) === "Für Donnerstag", `${vor}: ein Klick auf den Ring holt die Aufgabe aus dem Archiv unter „Für Donnerstag“ (${await gruppeVon(page, arch)})`);
      await bild(page, "archiv-zurueck", lauf);
    }

    p.ok(fehler.length === 0, `${vor}: keine JS-Fehler ${fehler.join(" | ")}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(p.gruen ? "\nDesktop-Listen: alles grün" : "\nDesktop-Listen: FEHLER");
process.exit(p.gruen ? 0 : 1);
