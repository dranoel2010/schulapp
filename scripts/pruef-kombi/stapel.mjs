/**
 * Der Vertrag zwischen Shell, Stapel und Router (Plan 2.4), mit Playwright
 * gegen den Produktionsbau:
 *
 *   1. Auf einer Stapelseite abhaken → Startseite darunter bleibt, Seite
 *      bleibt, kein Server-Render der Seite in `children`.
 *   2. Stapel → Stapel → Formular (echte Route) → speichern → Zurück zweimal
 *      → erst die Seite davor, dann die Startseite.
 *   3. Neuladen: direkter Aufruf → eine Seite über der Startseite; Neuladen
 *      mitten im Stapel stellt ihn wieder her.
 *   4. Flugmodus nach einem Besuch: die besuchte Seite kommt aus dem Cache
 *      („Ohne Verbindung · Stand …“), eine nie besuchte zeigt den Toast.
 *
 *   BASIS=http://localhost:3301 node scripts/pruef-kombi/stapel.mjs
 */

import {
  anmelden,
  BASIS,
  browserStarten,
  fehlerSammeln,
  kontext,
  obersteSeite,
  Pruefung,
  ruhe,
  seitenZahl,
} from "./gemeinsam.mjs";

const p = new Pruefung("stapel");
const browser = await browserStarten();

try {
  const ctx = await kontext(browser);
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page);

  const zuHause = async () => {
    await page.goto(`${BASIS}/`);
    await page.waitForFunction(() => !!window.__kombi);
  };

  // Falle beim Prüfen (README, „Das echte App-Gefühl“): Ohne dieselbe
  // NEXT_DEPLOYMENT_ID bei Bau und Start wird jeder Link zur harten
  // Navigation, und diese Prüfung schlüge aus dem falschen Grund fehl.
  await zuHause();
  const ohneDpl = await page.evaluate(() =>
    [...document.querySelectorAll('script[src*="/_next/"]')].some((s) => !s.src.includes("dpl=")),
  );
  if (ohneDpl) {
    console.warn(
      "Warnung: /_next-Dateien ohne ?dpl= — Bau und Start mit derselben NEXT_DEPLOYMENT_ID? (export NEXT_DEPLOYMENT_ID=$(git rev-parse HEAD))",
    );
  }

  // ── 2. Zurück über ein Formular (legt zugleich die Aufgabe für 1 an) ──────
  console.log("2. Stapel → Formular → speichern → Zurück zweimal");
  await zuHause();
  await page.evaluate(() => window.__kombi.openPage("probe"));
  await page.waitForSelector('#pages .page .p-title:text-is("Probe")');
  await ruhe(page);
  p.ok(page.url() === `${BASIS}/kombi-probe`, `URL der Stapelseite: ${page.url()}`);
  await page.click("#pages > .page:last-child >> text=Eine Ebene tiefer");
  await page.waitForSelector('#pages .page .p-title:text-is("Probe, Ebene 2")');
  await ruhe(page);
  p.ok((await seitenZahl(page)) === 2, "zwei Seiten im Stapel");
  await page.click("#pages > .page:last-child >> text=Aufgabe eintragen");
  await page.waitForSelector("#probe-text");
  await ruhe(page);
  p.ok((await seitenZahl(page)) === 3, "das Formular liegt als dritte Ebene oben");
  const text = `Probe ${Date.now() % 100000}`;
  await page.fill("#probe-text", text);
  await page.click('button:has-text("Speichern")');
  await page.waitForFunction(() => !document.querySelector("#probe-text"), null, { timeout: 10000 });
  await ruhe(page, 700);
  p.ok((await obersteSeite(page)) === "Probe, Ebene 2", `nach dem Speichern oben: ${await obersteSeite(page)}`);
  await page.goBack();
  await ruhe(page, 700);
  p.ok((await obersteSeite(page)) === "Probe", `Zurück 1: ${await obersteSeite(page)}`);
  await page.goBack();
  await ruhe(page, 700);
  p.ok((await seitenZahl(page)) === 0, `Zurück 2: Startseite (Seiten: ${await seitenZahl(page)})`);
  p.ok(page.url() === `${BASIS}/`, `URL wieder ${page.url()}`);

  // ── 1. Abhaken auf einer Stapelseite ─────────────────────────────────────
  console.log("1. Abhaken auf der Stapelseite");
  await zuHause();
  await page.evaluate(() => window.__kombi.openPage("probe"));
  await page.waitForSelector(`#pages .task:has-text("${text}")`);
  await ruhe(page);
  const anfragen = [];
  const merken = (r) => anfragen.push({ url: r.url(), method: r.method(), rsc: r.headers()["rsc"] ?? null, action: r.headers()["next-action"] ?? null });
  page.on("request", merken);
  await page.click(`#pages .task:has-text("${text}") .check`);
  await page.waitForSelector(".toast.on");
  const toastText = await page.textContent("#toastText");
  p.ok(/abgehakt/.test(toastText ?? ""), `Toast: „${toastText}“`);
  p.ok(await page.isVisible("#toastAct"), "Toast mit „Rückgängig“");
  await ruhe(page, 800);
  page.off("request", merken);
  const action = anfragen.filter((a) => a.action);
  const rsc = anfragen.filter((a) => a.rsc && !a.action);
  p.ok(action.length === 1, `genau eine Server Action (${action.length})`);
  p.ok(rsc.length === 0, `kein Server-Render nachgeladen (${rsc.map((r) => r.url).join(", ") || "keins"})`);
  p.ok(anfragen.some((a) => a.url.includes("/api/seite/probe")), "die Seite lädt gezielt über /api/seite nach");
  // darunter die Ansicht des Tages: Startseite oder, nach Schulschluss, der Ablauf (C)
  p.ok((await page.isVisible("#whenrow")) || (await page.isVisible("#flow.on")), "Startseite darunter steht");
  p.ok((await obersteSeite(page)) === "Probe", "die Seite bleibt");
  p.ok(await page.locator(`#pages .task.done:has-text("${text}")`).count() === 1, "die Zeile ist abgehakt");
  // Rückgängig
  await page.click("#toastAct");
  await page.waitForSelector(`#pages .task:not(.done):has-text("${text}")`);
  p.ok(true, "Rückgängig öffnet die Aufgabe wieder");

  // Fehler-Toast: künstlich scheiternde Action
  console.log("   Fehler-Toast");
  await ruhe(page, 600);
  // Erledigte von früheren Läufen zählen nicht mit
  const vorher = await page.locator("#pages .task.done").count();
  await page.click("#pages > .page:last-child >> text=Abhaken scheitern lassen");
  const sofort = await page.locator("#pages .task.done").count();
  await page.waitForSelector('.toast.on:has-text("Nicht gespeichert")');
  const knopf = await page.textContent("#toastAct");
  p.ok(sofort >= vorher + 1, "optimistisch sofort abgehakt");
  p.ok(knopf === "Erneut", `Fehler-Toast mit „${knopf}“`);
  const nochAbgehakt = await page.locator("#pages .task.done").count();
  await ruhe(page, 600);
  const danach = await page.locator("#pages .task.done").count();
  p.ok(nochAbgehakt >= vorher + 1 && danach === vorher, `springt erst nach dem Toast zurück (beim Toast ${nochAbgehakt}, danach ${danach})`);

  // ── 3. Neuladen ──────────────────────────────────────────────────────────
  console.log("3. Neuladen");
  const frisch = await ctx.newPage();
  await frisch.goto(`${BASIS}/kombi-probe`);
  await frisch.waitForSelector('#pages .page .p-title:text-is("Probe")');
  p.ok((await seitenZahl(frisch)) === 1, `direkter Aufruf: eine Seite (${await seitenZahl(frisch)})`);
  p.ok(await frisch.locator("#home #whenrow").count() === 1, "darunter die Startseite (Gerüst)");
  await frisch.click("#pages > .page:last-child .pback");
  await frisch.waitForURL(`${BASIS}/`);
  await ruhe(frisch, 600);
  p.ok((await seitenZahl(frisch)) === 0, "Zurück führt nach /");
  await frisch.close();

  await zuHause();
  await page.evaluate(() => window.__kombi.openPage("probe"));
  await page.waitForSelector('#pages .page .p-title:text-is("Probe")');
  await ruhe(page);
  await page.click("#pages > .page:last-child >> text=Eine Ebene tiefer");
  await page.waitForSelector('#pages .page .p-title:text-is("Probe, Ebene 2")');
  await ruhe(page);
  await page.reload();
  await page.waitForSelector('#pages .page .p-title:text-is("Probe, Ebene 2")');
  await page.waitForSelector('#pages .page .p-title:text-is("Probe")', { state: "attached" });
  await ruhe(page, 800);
  p.ok((await seitenZahl(page)) === 2, `Neuladen im Stapel: beide Seiten wieder da (${await seitenZahl(page)})`);
  await page.goBack();
  await ruhe(page, 900);
  p.ok((await obersteSeite(page)) === "Probe", `danach Zurück: ${await obersteSeite(page)}`);
  await page.goBack();
  await ruhe(page, 900);
  p.ok((await seitenZahl(page)) === 0, `und Startseite (${await seitenZahl(page)})`);

  // Neuladen auf /noten/fach/[id], nachdem im Tab schon Seiten offen waren:
  // „Zuletzt geöffnet“ (sessionStorage) darf das Hydrieren nicht stören
  // (React #418, danach fehlte window.__kombi).
  {
    const nf = await ctx.newPage();
    const nfFehler = fehlerSammeln(nf);
    await nf.goto(`${BASIS}/`);
    await nf.waitForFunction(() => !!window.__kombi);
    // ein Fach über die Fächerliste (die Saat hat nicht immer Noten), dann seine Noten
    await nf.evaluate(() => window.__kombi.openPage("faecher"));
    await nf.waitForSelector('#pages .page .p-title:text-is("Fächer")');
    await ruhe(nf);
    const zeile = nf.locator("#pages > .page:last-child .lrow").first();
    if (await zeile.count()) {
      await zeile.click();
      await nf.waitForURL(/\/faecher\/[0-9a-f-]{36}/);
      await ruhe(nf);
      const fachId = new URL(nf.url()).pathname.split("/")[2];
      await nf.evaluate((id) => window.__kombi.openPage("notenfach", { id }), fachId);
      await nf.waitForURL(/\/noten\/fach\//);
      await ruhe(nf);
      const ziel = nf.url();
      nfFehler.length = 0;
      await nf.reload();
      await nf.waitForSelector("#pages .page .p-title");
      await ruhe(nf, 900);
      const hat = await nf.evaluate(() => !!window.__kombi);
      const pe = nfFehler.filter((f) => f.startsWith("pageerror"));
      p.ok(pe.length === 0 && hat, `Neuladen auf ${new URL(ziel).pathname}: keine pageerror, __kombi da${pe.length ? `: ${pe.join(" | ")}` : ""}`);
      for (const pfad of ["/stundenplan", "/"]) {
        nfFehler.length = 0;
        await nf.goto(`${BASIS}${pfad}`);
        await nf.waitForSelector("#whenrow", { state: "attached" });
        await ruhe(nf, 900);
        const pe2 = nfFehler.filter((f) => f.startsWith("pageerror"));
        p.ok(pe2.length === 0, `danach ${pfad} aufgerufen: keine pageerror${pe2.length ? `: ${pe2.join(" | ")}` : ""}`);
      }
    } else {
      p.ok(false, "Fächer: kein Fach zum Öffnen (Saat?)");
    }
    await nf.close();
  }

  // ── 4. Flugmodus ─────────────────────────────────────────────────────────
  console.log("4. Flugmodus");
  await zuHause();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller && !!window.__kombi, null, { timeout: 15000 });
  await page.evaluate(() => window.__kombi.openPage("probe"));
  await page.waitForSelector('#pages .page .p-title:text-is("Probe")');
  await ruhe(page, 600);
  await page.goBack();
  await ruhe(page, 600);
  await ctx.setOffline(true);
  await page.evaluate(() => window.__kombi.openPage("probe"));
  await page.waitForSelector('#pages .page .p-title:text-is("Probe")');
  await page.waitForSelector('.page .p-sub:has-text("Ohne Verbindung")');
  const sub = await page.textContent('.page .p-sub:has-text("Ohne Verbindung")');
  p.ok(/^Ohne Verbindung · Stand \d\d:\d\d$/.test(sub ?? ""), `aus dem Cache: „${sub}“`);
  await page.goBack();
  await ruhe(page, 600);
  await page.evaluate(() => window.__kombi.openPage("probe", { ebene: "3" }));
  await page.waitForSelector('.toast.on:has-text("Keine Verbindung")', { timeout: 5000 });
  await ruhe(page, 400);
  p.ok((await seitenZahl(page)) === 0, "nie besuchte Seite: keine Seite, nur der Toast");
  p.ok((await page.textContent("#toastAct")) === "Erneut", "Toast mit „Erneut“");
  await ctx.setOffline(false);

  const echteFehler = fehler.filter((f) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::ERR|Failed to load resource/.test(f));
  p.ok(echteFehler.length === 0, `keine Konsolenfehler${echteFehler.length ? `: ${echteFehler.join(" | ")}` : ""}`);
  await ctx.close();
} finally {
  await browser.close();
}

console.log(p.gruen ? "\nStapel: alles grün" : "\nStapel: FEHLER");
process.exit(p.gruen ? 0 : 1);
