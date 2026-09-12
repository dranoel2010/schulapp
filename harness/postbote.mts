import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { laufFuerBlatt } from "./auftrag.mts";
import {
  liesZugang,
  Verbindung,
  WerkzeugFehler,
  ZugangVerloren,
} from "./mcp.mts";
import { sperren } from "./sperre.mts";

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

    // Zwei Arten von „später", und sie unterscheiden sich hier in genau einem
    // Wort: `return` beendet die Runde, `continue` nimmt das nächste Blatt.
    // Gemeinsam ist beiden das Wichtigere — das Blatt wird NICHT gemerkt und
    // ist beim nächsten Durchgang wieder dran. Warum die beiden getrennt
    // gehören, steht ausführlich an `LaufErgebnis` in kaefig.mts; kurz: das
    // leere Kontingent gehört dem Abo und trifft das nächste Blatt genauso, die
    // abgelaufene Frist gehört diesem Blatt und sagt über das nächste nichts.
    if (ergebnis.art === "pause") {
      sagen(`   Runde abgebrochen: ${ergebnis.grund}`);
      return;
    }

    if (ergebnis.art === "spaeter") {
      sagen(`   übersprungen, später noch einmal: ${ergebnis.grund}`);
      // Ein Blatt, das jedes Mal in die Frist läuft, kommt auch jedes Mal
      // wieder und kostet dann jede Runde einen ganzen Lauf, ohne je fertig zu
      // werden. Eine zweite Merkliste („dreimal versucht, jetzt lass es") wäre
      // die Antwort darauf, und sie steht hier bewusst nicht: das eine
      // Gedächtnis dieses Dienstes ist mit Absicht das einzige, und ein
      // Zähler, den niemand sieht, wäre der Anfang einer zweiten Warteschlange
      // neben dem Korb. Wer so ein Blatt loswerden will, trägt seine id von
      // Hand in gesehen.json ein — oder fotografiert es besser ab.
      continue;
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

      // Die Abschrift bekommt eine eigene Zeile, und zwar mit beiden Zahlen.
      // „9 von 12" ist die einzige Stelle, an der jemand, der nur das Mitlesen
      // vor sich hat, merkt, dass drei Seiten nicht zu lesen waren — und das
      // ist der Hinweis, das Blatt noch einmal zu fotografieren. Ein bloßes
      // „abgeschrieben" verschwiege genau den Fall, der einen Blick wert ist.
      // Bei `seiten === 0` bleibt die Zeile weg: dann hat das Modell die Zahl
      // nicht gefüllt, und „0 von 0" wäre eine Behauptung und keine Auskunft.
      if (gesagt.seiten > 0) {
        const offen = gesagt.seiten - gesagt.abschriften;
        sagen(
          `   Abschrift: ${gesagt.abschriften} von ${gesagt.seiten} Seiten` +
            (offen > 0 ? ` — ${offen} nicht zu lesen, bleibt offen` : ""),
        );
      }

      if (gesagt.grund) sagen(`   dazu: ${gesagt.grund}`);
    } else {
      sagen(`   kein Vorschlag: ${gesagt.grund || "ohne Angabe"} (${dauer})`);
    }
  }
}

async function main(): Promise<void> {
  sperren("Der Postbote");

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
