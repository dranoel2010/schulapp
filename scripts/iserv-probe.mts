/**
 * Was würde die App aus IServ sehen und in „Schule“ eintragen? — eine Probe
 * am Mac, von Hand, NUR LESEN.
 *
 *   ISERV_URL=https://<server der schule> ISERV_KLASSE=10 npx tsx scripts/iserv-probe.mts [--alle]
 *
 * Fehlt ISERV_URL, ISERV_USER oder ISERV_KLASSE in der Umgebung, fragt die
 * Probe danach; das Passwort fragt sie UNSICHTBAR ab. Ohne Terminal bricht sie
 * ab, statt es sichtbar zu lesen — und nennt dann mit Absicht keinen anderen
 * Weg: Ein Passwort auf der Befehlszeile stünde in der Shell-History und, wenn
 * ein KI-Agent die Probe startet, in dessen Protokoll. ISERV_AUCH, ISERV_NIE
 * und ISERV_KLASSENKALENDER gelten nur aus der Umgebung, wie auf dem NAS.
 *
 * Was sie tut: anmelden, die Kalender-Quellen lesen, die drei Feeds
 * (öffentlich, Klasse, Aufgaben) im Fenster der App holen und zeigen, was der
 * Filter daraus macht — die nächsten zehn Termine genau so, wie sie in Google
 * stünden, alle Zweifelsfälle mit Grund, die knapp genommenen. Mit `--alle`
 * jeden Titel des öffentlichen Kalenders mit Regel und Grund.
 *
 * Was sie NICHT tut: keine Datenbank, kein Google, keine Datei, nichts senden
 * außer der Anmeldung. Die freien Tage der App kennt sie nicht (sie liest
 * keine Datenbank) — Ferien, die die App schon kennt, stehen hier also noch
 * drin. Zum Schluss meldet sie sich IMMER ab, auch nach einem Fehler; sie
 * hinterlässt keine Session.
 *
 * ⚠ Jede Probe ist eine Anmeldung bei IServ und steht in den „Letzten
 * Anmeldungen“ des Schülers und in den Protokollen der Schule. Nicht in
 * Schleifen starten. Sagt sie „abgelehnt“: NICHT wiederholen, sondern erst
 * Benutzername und Passwort prüfen — zu viele Fehlversuche sperren das Konto.
 *
 * Rückgabewert: 0 gelesen, 1 Anmeldung abgelehnt (oder zweiter Faktor,
 * Captcha, Sperre, Passwort abgelaufen), 2 Netz, Format oder sonst ein Fehler.
 *
 * Importiert nur Rechnung und Netz (config, client, parse, klasse, auswahl,
 * events) — @/db wird über @/lib/free-days zwar geladen, aber nie benutzt.
 */

import { createInterface } from "node:readline/promises";

import { addDays, berlinDay, formatGerman, timeInBerlin } from "@/lib/dates";
import { iservAuswahl } from "@/lib/iserv/auswahl";
import { createIservClient, IservFehler, neuerSitzungsSpeicher } from "@/lib/iserv/client";
import {
  ENV,
  EVENTSOURCES_PATH,
  FENSTER_VOR_TAGE,
  FENSTER_ZURUECK_TAGE,
  readIservConfig,
} from "@/lib/iserv/config";
import { urteil } from "@/lib/iserv/klasse";
import { klasseVeraltet, parseAufgabenFeed, parseEventSources, parseKalenderFeed } from "@/lib/iserv/parse";
import type { IservItem } from "@/lib/iserv/types";

const BUDGET_MS = 90_000;
const alle = process.argv.includes("--alle");

// ── Eingaben ─────────────────────────────────────────────────────────────────

async function frage(text: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(text)).trim();
  } finally {
    rl.close();
  }
}

/** Unsichtbar: Rohmodus, Zeichen sammeln, Backspace, Enter beendet, Strg-C bricht ab. */
function verdeckt(text: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    console.error(
      "Kein Terminal: Das Passwort lese ich nur unsichtbar über die Tastatur. Bitte selbst in einem Terminal starten.",
    );
    process.exit(2);
  }

  process.stdout.write(text);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();

  return new Promise((resolve) => {
    let wert = "";

    const ende = () => {
      stdin.off("data", lesen);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };

    function lesen(stueck: string) {
      for (const zeichen of stueck) {
        if (zeichen === "\r" || zeichen === "\n") {
          ende();
          resolve(wert);
          return;
        }
        if (zeichen === "\u0003") {
          ende();
          console.error("Abgebrochen.");
          process.exit(130);
        }
        if (zeichen === "\u007f" || zeichen === "\b") {
          wert = Array.from(wert).slice(0, -1).join("");
          continue;
        }
        if (zeichen < " ") continue;
        wert += zeichen;
      }
    }

    stdin.on("data", lesen);
  });
}

const env: Record<string, string | undefined> = { ...process.env };

if (!env[ENV.url]?.trim()) {
  env[ENV.url] = await frage("IServ-Adresse der Schule (nur der Server, z. B. https://iserv.example.de): ");
}
if (!env[ENV.user]?.trim()) {
  env[ENV.user] = await frage("IServ-Account (z. B. vorname.nachname): ");
}
// Das Passwort NIE aus der Umgebung: Wer es dort setzt, hat es auf eine
// Befehlszeile oder in eine Datei geschrieben.
env[ENV.password] = await verdeckt("IServ-Passwort (unsichtbar): ");
if (!env[ENV.klasse]?.trim()) {
  env[ENV.klasse] = await frage("Klasse (1–13): ");
}

const gelesen = readIservConfig(env);
if (!gelesen.ok) {
  console.error(`Nicht verwendbar: ${gelesen.missing.join(", ")}`);
  process.exit(2);
}
const config = gelesen.config;
const zugang = config.zugang;
const filter = { klasse: config.klasse, auch: config.auch, nie: config.nie, klasseUnsicher: false };

// ── Ausgabe ──────────────────────────────────────────────────────────────────

const ueberschrift = (text: string) => console.log(`\n── ${text} ${"─".repeat(Math.max(3, 70 - text.length))}`);

function datum(item: Pick<IservItem, "ersterTag" | "letzterTag">): string {
  return item.ersterTag === item.letzterTag
    ? formatGerman(item.ersterTag, "kurz")
    : `${formatGerman(item.ersterTag, "kurz")} – ${formatGerman(item.letzterTag, "kurz")}`;
}

// ── Die Probe ────────────────────────────────────────────────────────────────

const client = createIservClient(zugang, {
  deadline: Date.now() + BUDGET_MS,
  speicher: neuerSitzungsSpeicher(),
});
let code = 0;
let angemeldet = false;

try {
  const jetzt = new Date();
  const heute = berlinDay(jetzt);
  const params = {
    start: addDays(heute, -FENSTER_ZURUECK_TAGE),
    end: addDays(heute, FENSTER_VOR_TAGE),
  };

  // (1) und (2)
  const es = parseEventSources(await client.getJson(EVENTSOURCES_PATH), zugang.origin, {
    klasse: config.klasse,
    klassenkalender: config.klassenkalender,
  });
  angemeldet = true;
  console.log(`Anmeldung bei ${new URL(zugang.origin).host}: ok`);

  ueberschrift("Quellen");
  for (const q of es.quellen) {
    console.log(`  ${q.label}  (${q.id}, ${q.typ}) → ${q.rolle}: ${q.grund}`);
  }
  for (const hinweis of es.hinweise) console.log(`  Hinweis: ${hinweis}`);
  if (es.problem) {
    console.log(`  FEHLER: ${es.problem}`);
    code = 2;
  }
  filter.klasseUnsicher = klasseVeraltet(es.quellen, config.klasse, config.klassenkalender);

  // (3)
  ueberschrift(`Einträge im Fenster ${params.start} bis ${params.end}`);
  const items: IservItem[] = [];
  let felder: string[] = [];

  for (const rolle of ["oeffentlich", "klasse", "aufgaben"] as const) {
    const q = es.quellen.find((kandidat) => kandidat.rolle === rolle && kandidat.url);
    if (!q?.url) {
      console.log(`  ${rolle}: keine Quelle`);
      continue;
    }
    try {
      const json = await client.getJson(q.url, params);
      if (rolle === "aufgaben") {
        const r = parseAufgabenFeed(json, q.label, zugang.origin);
        items.push(...r.items);
        felder = r.felder;
        console.log(`  ${q.label}: ${r.items.length} Einträge${r.unlesbar ? `, ${r.unlesbar} unlesbar` : ""}`);
      } else {
        const r = parseKalenderFeed(json, rolle, q.label);
        items.push(...r.items);
        console.log(`  ${q.label}: ${r.items.length} Einträge${r.unlesbar ? `, ${r.unlesbar} unlesbar` : ""}`);
      }
    } catch (fehler) {
      if (!(fehler instanceof IservFehler) || fehler.sperrt) throw fehler;
      console.log(`  ${q.label}: ${fehler.satz}`);
      code = 2;
    }
  }

  // (4)
  const a = iservAuswahl({
    items,
    filter,
    freieZeiten: [],
    iservOrigin: zugang.origin,
    appOrigin: "https://schulapp.invalid",
  });
  ueberschrift("Zahlen (freie Tage der App hier nicht berücksichtigt)");
  console.log(
    `  genommen ${a.genommen.length} (davon knapp ${a.knapp.length}) · Zweifel ${a.zweifel.length} · ausgeschlossen ${a.ausgeschlossen} · doppelt ${a.doppelt}`,
  );

  // (5) genau wie in Google
  ueberschrift("Die nächsten 10 in „Schule“, wie in Google");
  const beginn = (w: (typeof a.wuensche)[number]) => w.body.start.dateTime ?? `${w.firstDay}T00`;
  const kommend = a.wuensche
    .filter((w) => {
      const ende = w.body.end.date ? addDays(w.body.end.date, -1) : w.firstDay;
      return ende >= heute;
    })
    .sort((x, y) => (x.firstDay !== y.firstDay ? (x.firstDay < y.firstDay ? -1 : 1) : beginn(x) < beginn(y) ? -1 : 1));
  for (const w of kommend.slice(0, 10)) {
    const start = w.body.start;
    const wann = start.dateTime
      ? `${formatGerman(berlinDay(new Date(start.dateTime)), "kurz")} ${timeInBerlin(new Date(start.dateTime))}–${w.body.end.dateTime ? timeInBerlin(new Date(w.body.end.dateTime)) : ""}`
      : `${formatGerman(start.date ?? w.firstDay, "kurz")} ganztägig`;
    console.log(`  ${wann.padEnd(22)} ${w.body.summary}${w.body.location ? `  @ ${w.body.location}` : ""}`);
  }
  if (kommend.length === 0) console.log("  (nichts)");

  // (6) und (7)
  const abHeute = (liste: typeof a.zweifel) =>
    liste.filter((e) => e.bisTag >= heute).sort((x, y) => (x.tag < y.tag ? -1 : x.tag > y.tag ? 1 : 0));

  ueberschrift("Zweifelsfälle ab heute — NICHT im Kalender");
  for (const e of abHeute(a.zweifel)) {
    console.log(`  ${formatGerman(e.tag, "kurz")}${e.uhrzeit ? ` ${e.uhrzeit}` : ""}  ${e.titel}  — ${e.grund}`);
  }
  console.log("  Hinein mit ISERV_AUCH=\"<titelteil>\", nie hinein mit ISERV_NIE=\"<titelteil>\" (mit „;“ getrennt).");

  ueberschrift("Knapp genommen");
  for (const e of abHeute(a.knapp)) {
    console.log(`  ${formatGerman(e.tag, "kurz")}${e.uhrzeit ? ` ${e.uhrzeit}` : ""}  ${e.titel}  — ${e.grund}`);
  }

  // (8)
  if (alle) {
    ueberschrift("Alle Titel des öffentlichen Kalenders");
    for (const item of items.filter((i) => i.quelle === "oeffentlich").sort((x, y) => (x.ersterTag < y.ersterTag ? -1 : 1))) {
      const u = urteil({ titel: item.titel, ganztaegig: item.ganztaegig }, filter);
      const marke = u.nehmen ? (u.knapp ? "REIN (knapp)" : "REIN") : u.zweifel ? "zweifel" : "raus";
      console.log(`  ${datum(item).padEnd(24)} ${marke.padEnd(12)} [${u.regel}] ${item.titel} — ${u.grund}`);
    }
  }

  // (9)
  if (felder.length > 0) {
    ueberschrift("Aufgaben-Format (nur Feldnamen)");
    console.log(`  ${felder.join(", ")}`);
  }
} catch (fehler) {
  if (fehler instanceof IservFehler) {
    console.error(`\nIServ: ${zugang.schwaerze(fehler.satz)}`);
    if (fehler.sperrt) console.error("Nicht wiederholen — erst Benutzername und Passwort prüfen.");
    code = fehler.sperrt ? 1 : 2;
  } else {
    const text = fehler instanceof Error ? `${fehler.name}: ${fehler.message}` : String(fehler);
    console.error(`\nAbgebrochen: ${zugang.schwaerze(text)}`);
    code = 2;
  }
} finally {
  try {
    await client.logout();
    if (angemeldet) console.log("\nAbgemeldet — die Probe hinterlässt keine Session.");
  } catch (fehler) {
    const text = fehler instanceof IservFehler ? fehler.satz : fehler instanceof Error ? fehler.name : "unbekannt";
    console.error(`Abmelden ging nicht: ${zugang.schwaerze(text)}`);
  }
}

process.exit(code);
