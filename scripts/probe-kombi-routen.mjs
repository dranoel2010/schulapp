/**
 * Ruft jede Route der App ab (Plan G, „Tests“) und erwartet 200 oder eine
 * Umleitung. Die IDs für Klausur, Fach, Blatt, Note und Aufgabe holt das
 * Skript selbst über die Daten der Nachschlage-Seiten.
 *
 *   BASIS=http://localhost:3315 node scripts/probe-kombi-routen.mjs
 *
 * Voraussetzung: Produktionsbau, Konto aus scripts/saat-abruf.mts (Passwort
 * „probe1234“). Nie gegen den NAS.
 */

const BASIS = process.env.BASIS ?? "http://localhost:3301";
const PASSWORT = process.env.PASSWORT ?? "probe1234";

async function anmelden() {
  // Die Server Action der Anmeldung braucht die Seite; einfacher ist der
  // Weg über Playwright. Hier genügt ein Browser ohne Fenster.
  const { chromium } = await import("../node_modules/playwright-core/index.mjs");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASIS}/login`);
  await page.fill('input[name="password"]', PASSWORT);
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type="submit"]')]);
  const cookies = await ctx.cookies();
  await browser.close();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

const cookie = await anmelden();
const holen = (pfad) => fetch(`${BASIS}${pfad}`, { headers: { cookie }, redirect: "manual" });
const json = async (art, q = "") => (await (await holen(`/api/seite/${art}${q}`)).json()).daten;

const klausuren = await json("klausuren");
const faecher = await json("faecher");
const ablage = await json("ablage");
const hausaufgaben = await json("hausaufgaben");
const klausur = klausuren.klausuren[0]?.id;
const fach = faecher.faecher[0]?.id;
const blatt = ablage.gruppen[0]?.blaetter[0]?.id;
const aufgabe = [...hausaufgaben.fuer, ...hausaufgaben.spaeter, ...hausaufgaben.erledigt][0]?.id;
const notenfach = (await json("noten")).faecher[0]?.id;
const note = notenfach ? (await json("notenfach", `?id=${notenfach}`)).noten[0]?.id : null;

const ROUTEN = [
  "/",
  "/stundenplan",
  "/stundenplan/bearbeiten",
  "/stundenplan/1/1",
  "/stundenplan/zeiten",
  "/stundenplan/epoche",
  "/hausaufgaben",
  "/hausaufgaben/neu",
  aufgabe && `/hausaufgaben/${aufgabe}`,
  "/klausuren",
  "/klausuren/neu",
  klausur && `/klausuren/${klausur}`,
  klausur && `/klausuren/${klausur}/bearbeiten`,
  "/noten",
  "/noten/neu",
  notenfach && `/noten/fach/${notenfach}`,
  notenfach && `/noten/fach/${notenfach}/ziel`,
  note && `/noten/${note}`,
  "/faecher",
  "/faecher/neu",
  fach && `/faecher/${fach}`,
  fach && `/faecher/${fach}/bearbeiten`,
  fach && `/faecher/${fach}/themen`,
  "/material",
  fach && `/material?fach=${fach}`,
  blatt && `/material/${blatt}`,
  blatt && `/material/${blatt}/bearbeiten`,
  "/material/eingang",
  blatt && `/material/eingang/neu?blatt=${blatt}`,
  "/abruf/bausteine",
  "/abruf/bausteine/neu",
  "/abruf/eingang",
  "/abruf/klausur",
  klausur && `/abruf/klausur?klausur=${klausur}`,
  "/einstellungen",
  "/einstellungen/erinnerungen",
  "/einstellungen/abschrift",
  "/einstellungen/installieren",
  "/einstellungen/verbindungen",
  "/einstellungen/kalender",
  "/einstellungen/iserv",
  "/einstellungen/daten",
  "/einstellungen/konto",
  "/lernen",
  "/abruf",
  "/abruf/sitzung",
  "/datenschutz",
  "/offline",
  "/login",
  ...["woche", "hausaufgaben", "klausuren", "noten", "ablage", "faecher", "einstellungen"].map((a) => `/api/seite/${a}`),
  "/api/tag/daten",
].filter(Boolean);

let schlecht = 0;
for (const r of ROUTEN) {
  const res = await holen(r);
  const ok = res.status === 200 || (res.status >= 300 && res.status < 400);
  if (!ok) schlecht += 1;
  console.log(`${ok ? "  ✔" : "  ✖"} ${res.status} ${r}${res.status >= 300 && res.status < 400 ? ` → ${res.headers.get("location")}` : ""}`);
}
console.log(schlecht ? `\n${schlecht} Routen gescheitert` : `\nAlle ${ROUTEN.length} Routen erreichbar`);
process.exit(schlecht ? 1 : 0);
