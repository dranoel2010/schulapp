import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ANTWORT_SCHEMA, auftragFuer, type Antwort } from "./auftrag.mts";

/**
 * Der Käfig: ein Claude-Lauf, der nichts kann außer den elf Werkzeugen dieser
 * App.
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
 * Werkzeugen, zählt genau elf auf — alle aus dieser App. Nach Bash gefragt,
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
 * Drei Minuten sind großzügig für „ein Bild lesen und einen Vorschlag
 * schreiben" und knapp genug, dass ein hängender Lauf den Dienst nicht für den
 * Abend blockiert. `claude` bringt selbst kein Zeitlimit mit.
 */
const FRIST_MS = 180_000;

/**
 * Wie viele Züge ein Lauf hat. Ein Blatt mit zwölf Seiten braucht zwölf
 * read_page plus read_sheet, read_topics und propose_sheet — zwanzig lässt Luft
 * und zieht trotzdem eine Grenze gegen ein Modell, das sich verrennt.
 */
const MAX_ZUEGE = 20;

/** Was bei einem Lauf herauskommt — auch wenn er scheitert. */
export type LaufErgebnis =
  | { art: "antwort"; antwort: Antwort; kostenUsd: number; dauerMs: number }
  /** Etwas ging schief, aber es lohnt ein späterer Versuch (Kontingent, Netz, Frist). */
  | { art: "spaeter"; grund: string }
  /** Der Lauf ist gelaufen und hat nichts zustande gebracht. Nicht wiederholen. */
  | { art: "nichts"; grund: string };

/**
 * Setzt Claude auf ein Blatt an.
 *
 * `token` ist ein frisches Zugriffs-Token des Postboten — es gilt eine Stunde,
 * und der Lauf dauert Minuten; erneuert wird also vor dem Start, nicht während.
 */
export async function laufFuerBlatt(
  blattId: string,
  adresse: string,
  token: string,
  modell?: string,
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
    return await starten(blattId, arbeitsplatz, mcpDatei, modell);
  } finally {
    rmSync(arbeitsplatz, { recursive: true, force: true });
  }
}

function starten(
  blattId: string,
  arbeitsplatz: string,
  mcpDatei: string,
  modell: string | undefined,
): Promise<LaufErgebnis> {
  const argumente = [
    "-p",
    auftragFuer(blattId),
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
      fertig({
        art: "spaeter",
        grund: `claude ließ sich nicht starten: ${grund.message}`,
      });
    });

    kind.on("close", (code) => {
      clearTimeout(frist);

      if (abgebrochen) {
        fertig({ art: "spaeter", grund: `Frist von ${FRIST_MS / 1000} s überschritten` });
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
    return {
      art: "spaeter",
      grund: `claude antwortete nicht in JSON (exit ${code}): ${kurz.slice(0, 200)}`,
    };
  }

  if (ergebnis.api_error_status === 429) {
    return { art: "spaeter", grund: "Kontingent erschöpft (429)" };
  }

  if (ergebnis.api_error_status && ergebnis.api_error_status >= 500) {
    return { art: "spaeter", grund: `Die API war nicht erreichbar (${ergebnis.api_error_status})` };
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
      grund: antwort.grund ?? "",
    },
    kostenUsd: ergebnis.total_cost_usd ?? 0,
    dauerMs: ergebnis.duration_ms ?? 0,
  };
}
