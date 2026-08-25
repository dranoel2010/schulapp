import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { laufFuerBlatt } from "./kaefig.mts";
import {
  liesZugang,
  Verbindung,
  WerkzeugFehler,
  ZugangVerloren,
} from "./mcp.mts";

/**
 * Der Postbote: sieht nach, ob im Eingangskorb etwas liegt, und setzt Claude
 * darauf an.
 *
 *   npx tsx harness/postbote.mts                 — läuft, bis du ihn beendest
 *   npx tsx harness/postbote.mts --einmal        — eine Runde, dann Schluss
 *   npx tsx harness/postbote.mts --blatt <id>    — genau dieses Blatt, auch
 *                                                  wenn es schon dran war
 *   npx tsx harness/postbote.mts --intervall 300 — alle fünf Minuten
 *   npx tsx harness/postbote.mts --modell sonnet — ein anderes Modell
 *
 * **Der Korb ist die Warteschlange.** Der Dienst führt keine eigene Liste
 * dessen, was zu tun wäre: ein Blatt ohne Vorschlag, das noch niemand
 * durchgesehen hat, IST die offene Aufgabe. Damit gibt es nichts, was zwischen
 * App und Dienst auseinanderlaufen könnte — und nichts aufzuräumen, wenn der
 * Dienst wochenlang aus war.
 *
 * **Er schreibt selbst nichts in die App.** Er liest den Korb, um zu
 * entscheiden, ob sich ein Lauf lohnt; geschrieben wird ausschließlich im
 * Käfig, durch `propose_sheet` — dieselbe Tür wie für jeden anderen.
 *
 * **Gemerkt wird trotzdem etwas, und zwar genau eine Sache:** welche Blätter
 * schon einen Lauf hatten. Ohne diese Liste käme ein verworfener Vorschlag
 * beim nächsten Durchgang wieder — der Korb sähe wieder aus wie „ohne
 * Vorschlag", und der Dienst schlüge dasselbe noch einmal vor. Das ist die
 * einzige Stelle, an der er ein Gedächtnis braucht.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
const GESEHEN_DATEI = path.join(HIER, "gesehen.json");
const SPERRE = path.join(HIER, "lauf.lock");

/** Wie oft nachgesehen wird, wenn nichts anderes gesagt ist. */
const INTERVALL_SEKUNDEN = 120;

/**
 * Wie viele Blätter eine Runde bearbeitet.
 *
 * Drei, damit ein Stapel von zehn Zetteln nicht in einem Zug das halbe
 * Tageskontingent frisst und damit zwischen den Läufen wieder nachgesehen wird
 * — falls der Mensch inzwischen selbst eingeordnet hat.
 */
const PRO_RUNDE = 3;

type Zeile = {
  id: string;
  title: string;
  subject: string;
  filedAt: string | null;
  proposals: unknown[];
};

function argument(name: string): string | undefined {
  const stelle = process.argv.indexOf(`--${name}`);
  return stelle === -1 ? undefined : process.argv[stelle + 1];
}

function schalter(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Läuft unter dieser Nummer noch ein Prozess? Signal 0 fragt, ohne zu treffen. */
function lebt(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Es darf immer nur EIN Postbote laufen — und das ist keine Ordnungsliebe.
 *
 * Gemessen am 25.8.2026: zwei Postboten auf derselben `zugang.json` beenden
 * einander. Das Erneuerungs-Token wird bei jedem Gebrauch getauscht; der eine
 * holt sich ein frisches und schreibt es in die Datei, der andere hat das alte
 * noch im Speicher und legt es beim nächsten Mal vor — und das ist genau das
 * Muster, auf das die App wartet. Sie kann „mein zweites Ich" nicht von
 * „jemand hat das Token" unterscheiden und tut das Richtige: sie lehnt ab. Der
 * zweite Lauf stirbt dann mit `invalid_grant`, und im schlechteren Fall ist die
 * ganze Verbindung fällig und muss neu zugestimmt werden.
 *
 * Die Sperre ist eine Datei mit einer Prozessnummer, keine Zeitmarke: nach
 * einem Absturz oder einem harten Neustart steht dort eine Nummer, unter der
 * niemand mehr läuft, und dann gilt sie nicht. Ein Postbote, der sich nach
 * einem Stromausfall selbst aussperrt, wäre die schlechtere Störung.
 */
function sperren(): void {
  // Zwei Versuche: der erste greift nach der Sperre, der zweite kommt nur dann
  // dran, wenn dazwischen eine verwaiste weggeräumt wurde.
  for (let versuch = 0; versuch < 2; versuch += 1) {
    try {
      // `wx` heißt: anlegen, aber nur wenn es sie noch nicht gibt — und zwar in
      // einem Zug. Erst prüfen und dann schreiben hat eine Lücke dazwischen,
      // und genau durch die sind am 25.8.2026 beim Ausprobieren zwei Postboten
      // gleichzeitig gestartet. Beide sahen keine Sperre, beide legten eine an,
      // beide holten sich mit demselben Token ein neues — und dem zweiten wurde
      // es zu Recht verweigert.
      writeFileSync(SPERRE, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (grund) {
      if ((grund as NodeJS.ErrnoException).code !== "EEXIST") throw grund;

      const pid = existsSync(SPERRE)
        ? Number(readFileSync(SPERRE, "utf8").trim())
        : 0;

      if (Number.isFinite(pid) && pid > 0 && lebt(pid)) {
        throw new Error(
          `Es läuft schon ein Postbote (Prozess ${pid}).\n\n` +
            "Zwei auf einmal geht nicht: sie teilen sich einen Zugang, dessen " +
            "Token bei jedem Gebrauch getauscht wird, und nehmen sich " +
            "gegenseitig die Verbindung weg.\n\n" +
            `Beenden mit: kill ${pid}\n` +
            `Läuft dort nichts mehr, kann die Sperre weg: rm ${SPERRE}`,
        );
      }

      // Verwaist — die Nummer gehört keinem laufenden Prozess mehr.
      rmSync(SPERRE, { force: true });
    }
  }

  // Aufgeräumt wird auf jedem Weg hinaus — auch bei einem Fehler, auch bei
  // Strg-C. Bliebe die Datei liegen, hilfe immerhin die Prüfung auf die
  // Prozessnummer beim nächsten Start.
  const loesen = () => {
    try {
      rmSync(SPERRE, { force: true });
    } catch {
      // Beim Hinausgehen ist eine liegengebliebene Datei kein Grund zu lärmen.
    }
  };

  process.on("exit", loesen);
}

function liesGesehen(): Set<string> {
  if (!existsSync(GESEHEN_DATEI)) return new Set();

  try {
    return new Set(JSON.parse(readFileSync(GESEHEN_DATEI, "utf8")) as string[]);
  } catch {
    // Eine kaputte Merkliste ist kein Grund aufzugeben — sie kostet höchstens
    // einen doppelten Vorschlag, und der steht sichtbar im Korb.
    return new Set();
  }
}

function schreibeGesehen(gesehen: Set<string>): void {
  writeFileSync(GESEHEN_DATEI, `${JSON.stringify([...gesehen], null, 2)}\n`);
}

/** Eine Zeile fürs Mitlesen: Uhrzeit, dann der Satz. */
function sagen(satz: string): void {
  const jetzt = new Date().toLocaleTimeString("de-DE", { hour12: false });
  console.log(`${jetzt}  ${satz}`);
}

/** Die offenen Blätter: noch nicht durchgesehen, kein Vorschlag, noch nie dran. */
function offene(zeilen: Zeile[], gesehen: Set<string>): Zeile[] {
  return zeilen.filter(
    (zeile) =>
      zeile.filedAt === null && zeile.proposals.length === 0 && !gesehen.has(zeile.id),
  );
}

async function runde(
  verbindung: Verbindung,
  gesehen: Set<string>,
  modell: string | undefined,
  nurDieses: string | undefined,
): Promise<void> {
  const antwort = await verbindung.werkzeug("read_inbox", { limit: 50 });
  const zeilen = (antwort.daten ?? []) as Zeile[];

  const dran = nurDieses
    ? zeilen.filter((zeile) => zeile.id === nurDieses)
    : offene(zeilen, gesehen).slice(0, PRO_RUNDE);

  if (dran.length === 0) {
    return;
  }

  sagen(`${dran.length} Blatt/Blätter zu bearbeiten.`);

  for (const zeile of dran) {
    const kurz = zeile.id.slice(0, 8);
    sagen(`→ ${kurz} „${zeile.title}" (${zeile.subject})`);

    // Das Token wird vor dem Lauf geholt und nicht währenddessen: es gilt eine
    // Stunde, der Lauf dauert Minuten, und in den Käfig kommt es als Datei.
    const ergebnis = await laufFuerBlatt(
      zeile.id,
      verbindung.adresse,
      await verbindung.zugriffstoken(),
      modell,
    );

    if (ergebnis.art === "spaeter") {
      sagen(`   später noch einmal: ${ergebnis.grund}`);
      // Nicht merken — dieses Blatt ist beim nächsten Durchgang wieder dran.
      return;
    }

    gesehen.add(zeile.id);
    schreibeGesehen(gesehen);

    if (ergebnis.art === "nichts") {
      sagen(`   kein Vorschlag: ${ergebnis.grund}`);
      continue;
    }

    const { antwort: gesagt, kostenUsd, dauerMs } = ergebnis;
    const dauer = `${Math.round(dauerMs / 1000)} s`;

    if (gesagt.ergebnis === "vorschlag") {
      const themen = gesagt.themen.length > 0 ? gesagt.themen.join(", ") : "ohne Thema";
      // Der Betrag ist keine Rechnung, sondern was derselbe Lauf über die API
      // gekostet hätte — über das Abo zahlt er auf das Kontingent ein, nicht
      // auf die Kreditkarte. Er steht trotzdem da: er ist das einzige Maß
      // dafür, wie teuer ein Blatt den Tag macht.
      sagen(`   Vorschlag liegt im Korb: ${themen} (${dauer}, entspricht ${kostenUsd.toFixed(2)} $)`);
      if (gesagt.grund) sagen(`   dazu: ${gesagt.grund}`);
    } else {
      sagen(`   kein Vorschlag: ${gesagt.grund || "ohne Angabe"} (${dauer})`);
    }
  }
}

async function main(): Promise<void> {
  sperren();

  const verbindung = new Verbindung(liesZugang());
  const intervall = Number(argument("intervall") ?? INTERVALL_SEKUNDEN) * 1000;
  const modell = argument("modell");
  const nurDieses = argument("blatt");
  const einmal = schalter("einmal") || nurDieses !== undefined;

  const gesehen = liesGesehen();

  sagen(`Postbote wach. ${verbindung.adresse}`);
  if (!einmal) sagen(`Sieht alle ${Math.round(intervall / 1000)} s nach. Beenden mit Strg-C.`);

  // Aufhören heißt aufhören: ohne diese Zeile bliebe der Prozess nach Strg-C
  // noch bis zum Ende der laufenden Runde stehen, und das kann drei Minuten
  // dauern.
  process.on("SIGINT", () => {
    sagen("Postbote macht Feierabend.");
    process.exit(0);
  });

  for (;;) {
    try {
      await runde(verbindung, gesehen, modell, nurDieses);
    } catch (grund) {
      if (grund instanceof ZugangVerloren) throw grund;

      // Alles andere ist der Alltag eines Dienstes: ein Netz, das kurz weg war,
      // ein Werkzeug, das nein sagt. Aufhören wäre die falsche Antwort.
      const satz = grund instanceof WerkzeugFehler || grund instanceof Error ? grund.message : String(grund);
      sagen(`Diese Runde ging schief: ${satz}`);
    }

    if (einmal) return;

    await new Promise((weiter) => setTimeout(weiter, intervall));
  }
}

main().catch((grund: unknown) => {
  console.error(`\n${grund instanceof Error ? grund.message : String(grund)}`);
  process.exit(1);
});
