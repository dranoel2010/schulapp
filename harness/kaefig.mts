import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ANTWORT_SCHEMA, auftragFuer, type Antwort } from "./auftrag.mts";

/**
 * Der Käfig: ein Claude-Lauf, der nichts kann außer den Werkzeugen dieser App.
 *
 * **Das ist die Stelle, an der eine Zeile in KONZEPT.md steht.** Dort hieß es,
 * Zettel gehörten nie in eine Claude-Code-Sitzung, „dort steht kein Bash und
 * kein Zugriff auf das Repo daneben". Der Satz stimmte — für einen gewöhnlichen
 * Lauf. Drei Schalter drehen ihn um, und sie nehmen Fähigkeiten weg, statt sie
 * nur zu verbieten:
 *
 * - `--tools ""` entfernt die eingebauten Werkzeuge. Kein Bash, kein Lesen und
 *   Schreiben von Dateien, kein Netz.
 * - `--strict-mcp-config` lässt nur die Server gelten, die hier mitgegeben
 *   werden — die anderen Connectors des Kontos (Vercel, Figma, was sonst noch
 *   angemeldet ist) sind damit aus der Sitzung heraus.
 * - `--mcp-config` gibt genau einen Server mit: die Schulapp, mit dem Token
 *   des Postboten.
 *
 * Gemessen am 25.8.2026: ein so gestarteter Lauf, gefragt nach seinen
 * Werkzeugen, zählte genau elf auf — alle aus dieser App, und damals waren es
 * elf. Seit dem 5.9.2026 sind es zwölf (`read_transcript` kam mit der Abschrift
 * dazu); die Zahl steht hier bewusst als die GEMESSENE und wird nicht
 * fortgeschrieben, sonst behauptete der Kommentar eine Messung, die niemand
 * gemacht hat. Was die Messung zeigt, gilt unverändert: alles, was der Lauf
 * sieht, kommt aus dieser App. Nach Bash gefragt,
 * antwortet er „KEIN-BASH". Ohne `--tools ""` führt derselbe Lauf `echo` aus,
 * obwohl Bash nicht in der Erlaubnisliste steht: `--allowedTools` ist eine
 * Regel über Erlaubnis, und die Einstellungen des Rechners können sie weiten.
 * Wegnehmen schlägt Verbieten.
 *
 * **Das Token liegt in einer Datei, und die Datei lebt nur für diesen Lauf.**
 * Sie entsteht in einem eigenen Verzeichnis mit 0600 und wird danach gelöscht;
 * dasselbe Verzeichnis ist zugleich das Arbeitsverzeichnis des Laufs — leer,
 * damit dort auch nichts läge, wenn doch einmal etwas lesen könnte.
 */

/**
 * Was der Lauf rufen darf. Weniger geht nicht, mehr braucht er nicht.
 *
 * `read_subjects` steht seit dem 25.8.2026 dabei, und ohne das Werkzeug war die
 * ganze Fachzuordnung eine Fassade: der Lauf konnte ein Fach vorschlagen, kannte
 * aber die Fächer nicht, die es gibt. `propose_sheet` trifft eine Schreibweise
 * nur, wenn sie auf Name oder Kürzel eines vorhandenen Fachs passt — „Erdkunde"
 * für ein Fach namens „Geografie" wäre still nichts geworden.
 */
const ERLAUBT = [
  "mcp__schulapp__read_sheet",
  "mcp__schulapp__read_page",
  "mcp__schulapp__read_subjects",
  "mcp__schulapp__read_topics",
  "mcp__schulapp__propose_sheet",
];

/**
 * Wie lange ein Lauf höchstens dauern darf.
 *
 * Die alte Rechnung waren drei Minuten für „ein Bild lesen und einen Vorschlag
 * schreiben" — großzügig für ein Blatt, dessen ganze Ausgabe aus einem Fach,
 * einem Thema und zwei Sätzen Notiz bestand.
 *
 * Seit der Abschrift (5.9.2026) sieht die Rechnung anders aus. Im dichtesten
 * Fall schreibt derselbe Lauf zwölf Seiten (MAX_PAGES in @/lib/images) zu je
 * 8 000 Zeichen ab: 96 000 Zeichen, grob 25 000 Token, die Zeichen für Zeichen
 * erzeugt werden müssen. Mit überschlagenen 50 Token in der Sekunde sind das
 * rund acht Minuten, in denen nichts geschieht außer Schreiben — und davor
 * liegen noch zwölf Bilder, die gelesen und je einmal durch die Leitung
 * geschickt werden wollen. Drei Minuten hätten so ein Blatt mitten in der
 * vierten Seite abgeschnitten.
 *
 * Fünfzehn Minuten sind dafür großzügig gerechnet und immer noch eine Grenze:
 * ein hängender Lauf blockiert den Dienst, er beendet ihn nicht. `claude`
 * bringt selbst kein Zeitlimit mit.
 *
 * Die Zahl ist überschlagen und nicht gemessen — ein Blatt mit zwölf vollen
 * Seiten gab es hier noch nicht. Wer nachmessen will, findet die tatsächliche
 * Dauer in jeder Zeile „Vorschlag liegt im Korb (… s)".
 *
 * Was das kostet, steht in postbote.mts: PRO_RUNDE ist drei, und drei Läufe,
 * die alle in die Frist laufen, halten eine Runde eine Dreiviertelstunde auf.
 * Genau deshalb bricht ein Zeitablauf seit dem 5.9.2026 nur noch dieses eine
 * Blatt ab und nicht mehr die ganze Runde — siehe `LaufErgebnis`.
 */
const FRIST_MS = 900_000;

/**
 * Wie viele Züge ein Lauf hat.
 *
 * Die Rechnung: read_sheet, read_subjects, read_topics und propose_sheet sind
 * vier Aufrufe, dazu bis zu zwölf read_page (MAX_PAGES in @/lib/images) —
 * sechzehn. Neu ist, dass der Auftrag verlangt, die Abschrift DIREKT NACH JEDEM
 * BILD aufzuschreiben statt am Ende alles auf einmal aus dem Gedächtnis; das
 * sind bis zu zwölf weitere Züge, in denen gar kein Werkzeug läuft. Macht
 * achtundzwanzig im dichtesten Fall.
 *
 * Vierzig lässt Luft für einen Fehlgriff — ein Werkzeug, das nein sagt und noch
 * einmal richtig gerufen wird — und zieht trotzdem eine Grenze gegen ein
 * Modell, das sich verrennt.
 *
 * Zwanzig waren es vorher, und zwanzig wären ab jetzt die schlechteste aller
 * Grenzen: ein zwölfseitiges Blatt liefe mitten in der Abschrift aus den Zügen,
 * also BEVOR propose_sheet an die Reihe kommt. Herauskäme ein Lauf, der die
 * ganze Arbeit gemacht und nichts abgeliefert hat.
 */
const MAX_ZUEGE = 40;

/**
 * Was bei einem Lauf herauskommt — auch wenn er scheitert.
 *
 * **„Später" war bis zum 5.9.2026 eins und ist seitdem zweierlei.** Beide Fälle
 * sagen dasselbe über das Blatt: es ist nicht erledigt, merk es dir nicht als
 * abgearbeitet. Sie unterscheiden sich in der Frage, die unmittelbar danach
 * kommt — lohnt es sich, im selben Durchgang das NÄCHSTE Blatt anzufassen?
 *
 * Bei einem leeren Kontingent (429) lautet die Antwort nein. Das Kontingent
 * gehört dem Abo und nicht dem Blatt; der nächste Lauf bekommt dieselbe Absage,
 * nur schneller. Drei Blätter hintereinander gegen dieselbe Wand zu fahren
 * kostet zwar nichts, füllt aber das Mitlesen mit drei gleichlautenden Zeilen
 * und verdeckt damit, was eigentlich los ist. Dasselbe gilt für eine API, die
 * mit 500 antwortet, und für ein `claude`, das sich gar nicht erst starten
 * lässt — da ist kein Modell im Spiel, sondern eine kaputte Installation.
 *
 * Bei einem Zeitablauf lautet die Antwort ja. Die Frist gehört dem BLATT: sie
 * läuft ab, weil dieses eine zwölf volle Seiten hat, weil die Handschrift zäh
 * ist, weil das Modell sich an einer Stelle festgebissen hat. Über das nächste
 * Blatt sagt das nichts — es hat vielleicht eine Seite und ist in vierzig
 * Sekunden fertig. Die Runde deswegen abzubrechen hieß bisher: ein einziges
 * zähes Blatt hält den ganzen Stapel auf, und zwar jede Runde aufs Neue, denn
 * es steht ja weiterhin vorn im Korb. Mit einer Frist von fünfzehn Minuten
 * wäre aus dem Schönheitsfehler ein Dienst geworden, der nichts mehr schafft.
 */
export type LaufErgebnis =
  | { art: "antwort"; antwort: Antwort; kostenUsd: number; dauerMs: number }
  /**
   * Nicht dieser Lauf war das Problem, sondern das, worauf jeder Lauf sich
   * stützt: Kontingent leer, API weg, `claude` startet nicht. Die Runde hört
   * auf; das Blatt bleibt ungemerkt.
   */
  | { art: "pause"; grund: string }
  /**
   * Dieser eine Lauf ist nicht fertig geworden (Frist). Das Blatt bleibt
   * ungemerkt und ist beim nächsten Durchgang wieder dran — die Runde macht
   * mit dem nächsten Blatt weiter.
   */
  | { art: "spaeter"; grund: string }
  /** Der Lauf ist gelaufen und hat nichts zustande gebracht. Nicht wiederholen. */
  | { art: "nichts"; grund: string };

/**
 * Setzt Claude auf ein Blatt an.
 *
 * `token` ist ein frisches Zugriffs-Token des Postboten — es gilt eine Stunde,
 * und der Lauf dauert Minuten; erneuert wird also vor dem Start, nicht während.
 *
 * **`auftrag` ist der einzige Weg, denselben Käfig für etwas anderes zu
 * benutzen** — die Nachlese (harness/nachlese.mts) gibt hier ihren eigenen
 * Auftrag herein. Alles übrige bleibt gleich, und das ist der Punkt: dieselbe
 * Erlaubnisliste, dieselbe Frist, dasselbe Kontingent, dasselbe Antwortschema.
 * Ein zweiter Käfig neben diesem wäre eine zweite Stelle, an der man vergessen
 * kann, `read_transcript` NICHT zu erlauben. Ohne Angabe gilt der Auftrag zum
 * Einordnen, und für den Postboten ändert sich damit nichts.
 */
export async function laufFuerBlatt(
  blattId: string,
  adresse: string,
  token: string,
  modell?: string,
  auftrag?: string,
): Promise<LaufErgebnis> {
  const arbeitsplatz = mkdtempSync(path.join(tmpdir(), "postbote-"));

  const mcpDatei = path.join(arbeitsplatz, "mcp.json");

  writeFileSync(
    mcpDatei,
    JSON.stringify({
      mcpServers: {
        schulapp: {
          type: "http",
          url: adresse,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
    { mode: 0o600 },
  );

  try {
    return await starten(
      auftrag ?? auftragFuer(blattId),
      arbeitsplatz,
      mcpDatei,
      modell,
    );
  } finally {
    rmSync(arbeitsplatz, { recursive: true, force: true });
  }
}

function starten(
  auftrag: string,
  arbeitsplatz: string,
  mcpDatei: string,
  modell: string | undefined,
): Promise<LaufErgebnis> {
  const argumente = [
    "-p",
    auftrag,
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    mcpDatei,
    "--allowedTools",
    ERLAUBT.join(" "),
    "--output-format",
    "json",
    // Das Schema geht als JSON in die Zeile, nicht als Pfad: `claude` liest
    // dieses Argument selbst als JSON und antwortet auf einen Dateinamen mit
    // „is not valid JSON" (ausprobiert). Über spawn mit Argumentliste gibt es
    // keine Shell, die daran etwas zu deuten hätte.
    "--json-schema",
    JSON.stringify(ANTWORT_SCHEMA),
    "--max-turns",
    String(MAX_ZUEGE),
    ...(modell ? ["--model", modell] : []),
  ];

  // Ohne ANTHROPIC_API_KEY läuft es über die Anmeldung des Abos — und genau das
  // ist gewollt: ein Schlüssel in der Umgebung würde still Geld ausgeben.
  const umgebung = { ...process.env };
  delete umgebung.ANTHROPIC_API_KEY;

  return new Promise((fertig) => {
    const kind = spawn("claude", argumente, {
      cwd: arbeitsplatz,
      env: umgebung,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let aus = "";
    let fehlerAus = "";
    let abgebrochen = false;

    kind.stdout.on("data", (teil) => (aus += teil));
    kind.stderr.on("data", (teil) => (fehlerAus += teil));

    // SIGINT und nicht SIGTERM: SIGINT beendet den Zug ordentlich, SIGTERM
    // lässt ihn halb stehen und schreibt gar kein Ergebnis. Der zweite Schuss
    // kommt erst, wenn der erste nichts bewirkt hat.
    const frist = setTimeout(() => {
      abgebrochen = true;
      kind.kill("SIGINT");
      setTimeout(() => kind.kill("SIGTERM"), 10_000);
    }, FRIST_MS);

    kind.on("error", (grund) => {
      clearTimeout(frist);
      // „pause" und nicht „spaeter": wenn `claude` sich nicht starten lässt,
      // fehlt es im Pfad oder darf nicht ausgeführt werden. Beim nächsten Blatt
      // fehlt es genauso.
      fertig({
        art: "pause",
        grund: `claude ließ sich nicht starten: ${grund.message}`,
      });
    });

    kind.on("close", (code) => {
      clearTimeout(frist);

      if (abgebrochen) {
        // Der eine Fall, der ausdrücklich NICHT die Runde beendet: die Frist
        // gehört diesem Blatt (zwölf Seiten, zähe Handschrift), nicht dem
        // Dienst. Ausführlich an `LaufErgebnis`.
        fertig({
          art: "spaeter",
          grund: `Frist von ${Math.round(FRIST_MS / 60_000)} Minuten überschritten`,
        });
        return;
      }

      fertig(auswerten(aus, fehlerAus, code));
    });
  });
}

/**
 * Was der Lauf zurückgibt, in eine Entscheidung übersetzt.
 *
 * Drei Dinge sind dabei nicht offensichtlich, und jedes hat einen Fall, in dem
 * es sonst still schiefginge:
 *
 * - **Ein verweigertes Werkzeug ist kein Fehler.** Der Lauf endet mit exit 0
 *   und `is_error: false`; dass nichts passiert ist, steht nur in
 *   `permission_denials`. Wer das nicht liest, hält einen Lauf für gelungen, in
 *   dem das Modell nur erklärt hat, dass es nicht darf.
 * - **`subtype` bleibt „success", auch wenn die API einen Fehler geworfen
 *   hat.** Die Wahrheit steht in `is_error` und `api_error_status`.
 * - **429 heißt warten, nicht scheitern.** Das Kontingent des Abos ist leer;
 *   dasselbe Blatt später noch einmal ist richtig, ein „nichts" wäre falsch.
 *   Es wird zu „pause" und nicht zu „spaeter": leer ist das Kontingent für alle
 *   Blätter dieser Runde, nicht nur für dieses.
 *
 * **Und die Falle, die still zuschlägt:** das Rückgabeobjekt unten wird Feld
 * für Feld von Hand abgeschrieben. Das ist Absicht — was hier ankommt, hat ein
 * Modell erzeugt, und `structured_output` einfach durchzureichen hieße, ihm die
 * Form der Antwort zu überlassen. Der Preis dafür ist, dass ein NEUES Feld im
 * Schema still verschwindet, wenn es hier nicht auch abgeschrieben wird: es
 * steht im Typ, der Compiler sieht kein Problem (es kommt ja aus einem `as`),
 * und im Mitlesen steht dann eine Null. Genau das ist am 5.9.2026 beinahe mit
 * `seiten` und `abschriften` passiert. Wer das Schema erweitert, erweitert
 * diese Stelle mit.
 */
function auswerten(aus: string, fehlerAus: string, code: number | null): LaufErgebnis {
  let ergebnis: {
    is_error?: boolean;
    subtype?: string;
    result?: string | null;
    structured_output?: unknown;
    api_error_status?: number | null;
    permission_denials?: { tool_name: string }[];
    total_cost_usd?: number;
    duration_ms?: number;
  };

  try {
    ergebnis = JSON.parse(aus.trim());
  } catch {
    const kurz = (aus || fehlerAus).trim().split("\n").pop() ?? "";
    // Auch das ist „pause": wer statt JSON etwas anderes schreibt, ist nicht an
    // diesem Blatt gescheitert. Das sind die Fälle „nicht angemeldet", „andere
    // Fassung von claude", „unbekanntes Argument" — sie treffen das nächste
    // Blatt genauso, und dann steht der Satz wenigstens einmal da statt dreimal.
    return {
      art: "pause",
      grund: `claude antwortete nicht in JSON (exit ${code}): ${kurz.slice(0, 200)}`,
    };
  }

  if (ergebnis.api_error_status === 429) {
    return { art: "pause", grund: "Kontingent erschöpft (429)" };
  }

  if (ergebnis.api_error_status && ergebnis.api_error_status >= 500) {
    return { art: "pause", grund: `Die API war nicht erreichbar (${ergebnis.api_error_status})` };
  }

  if (ergebnis.is_error || code !== 0) {
    return {
      art: "nichts",
      grund: `Lauf gescheitert (${ergebnis.subtype ?? "?"}, exit ${code}): ${(ergebnis.result ?? "").slice(0, 200)}`,
    };
  }

  const verweigert = ergebnis.permission_denials ?? [];
  if (verweigert.length > 0) {
    return {
      art: "nichts",
      grund: `Der Lauf wollte etwas, das er nicht darf: ${verweigert.map((v) => v.tool_name).join(", ")}`,
    };
  }

  const antwort = ergebnis.structured_output as Antwort | undefined;

  if (!antwort || typeof antwort.ergebnis !== "string") {
    return {
      art: "nichts",
      grund: `Keine verwertbare Antwort: ${(ergebnis.result ?? "").slice(0, 200)}`,
    };
  }

  return {
    art: "antwort",
    antwort: {
      ergebnis: antwort.ergebnis,
      vorschlagId: antwort.vorschlagId,
      themen: antwort.themen ?? [],
      // Zahl oder nichts: `?? 0` ließe eine "9" aus dem Modell als Zeichenkette
      // durch, und die stünde später im Mitlesen als „9 von 12" da, während
      // jede Rechnung damit schiefginge.
      seiten: zahl(antwort.seiten),
      abschriften: zahl(antwort.abschriften),
      grund: antwort.grund ?? "",
    },
    kostenUsd: ergebnis.total_cost_usd ?? 0,
    dauerMs: ergebnis.duration_ms ?? 0,
  };
}

/**
 * Eine Zahl aus etwas, das ein Modell geschrieben hat.
 *
 * Das Schema verlangt `integer`, und in aller Regel kommt auch eine Zahl an.
 * Der Typ `Antwort` sagt es ebenfalls — nur steht dahinter ein `as`, und ein
 * `as` prüft nichts. Was hier wirklich ankommt, ist geparstes JSON aus einem
 * fremden Prozess; „12" mit Anführungszeichen, `null` oder ein fehlendes Feld
 * sind alle möglich, ohne dass der Compiler etwas merkt. Eine 0 ist an dieser
 * Stelle die ehrlichste Antwort: sie sagt „unbekannt" und rechnet sich nicht
 * heimlich als NaN durch das Mitlesen.
 */
function zahl(wert: unknown): number {
  return typeof wert === "number" && Number.isFinite(wert) && wert >= 0
    ? Math.round(wert)
    : 0;
}
