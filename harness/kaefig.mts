import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
 * Eine Aufgabe für den Käfig: was zu tun ist, was dafür erlaubt ist, und wie
 * die Antwort aussieht.
 *
 * ── Warum die Erlaubnisliste hier steht und nicht weiter oben ───────────────
 *
 * Bis zum 12.9.2026 war sie eine Konstante dieser Datei — eine Liste für alle
 * Läufe, weil es nur einen gab (das Einordnen) und die Nachlese dieselben
 * Werkzeuge braucht. Mit dem Fragenlauf gilt das nicht mehr: Er liest
 * `read_exam_material` und schreibt `propose_questions`, und beides hat auf der
 * Liste des Einordnens nichts zu suchen. Umgekehrt braucht er `read_page`
 * nicht — er arbeitet auf Abschriften und nicht auf Fotos.
 *
 * Eine gemeinsame Liste aus allen Werkzeugen beider Läufe wäre die bequeme
 * Antwort und die falsche: Sie erlaubte dem Einordner, Fragen vorzuschlagen,
 * und dem Fragenlauf, an Blättern zu schreiben. Die Zusage des Käfigs bleibt
 * davon unberührt — sie lautet „nichts außer den Werkzeugen dieser App",
 * und die hält `--tools ""` zusammen mit `--strict-mcp-config`, nicht diese
 * Liste. WELCHE der App-Werkzeuge ein Lauf ruft, ist Sache der Aufgabe.
 *
 * `formen` ist die Stelle, an der die Antwort des Modells Feld für Feld
 * abgeschrieben wird. Sie gehört zur Aufgabe, weil das Schema dazugehört —
 * ausführlich steht der Grund an `auswerten()` weiter unten: Ein neues Feld im
 * Schema, das hier niemand abschreibt, verschwindet still.
 */
export type Aufgabe<A> = {
  /** Was das Modell tun soll — der einzige Text, den es bekommt. */
  auftrag: string;
  /** Die Werkzeuge dieses Laufs, voll qualifiziert (`mcp__schulapp__…`). */
  erlaubt: readonly string[];
  /** Das JSON-Schema der Antwort, wie `--json-schema` es erwartet. */
  schema: unknown;
  /** Feld für Feld abschreiben. `null` heißt: unverwertbar. */
  formen: (roh: Record<string, unknown>) => A | null;
};

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
export const FRIST_MS = 900_000;

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
export type LaufErgebnis<A> =
  | { art: "antwort"; antwort: A; kostenUsd: number; dauerMs: number }
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
 * Setzt Claude auf eine Aufgabe an.
 *
 * `token` ist ein Zugriffs-Token des Postboten, das die ganze Frist übersteht —
 * `zugriffstoken()` in mcp.mts verlangt dafür ausdrücklich `FRIST_MS` Vorlauf.
 * Nachgelegt wird während des Laufs nicht: Das Token geht als Datei in den
 * Käfig, und danach führt kein Weg mehr hinein.
 *
 * **`aufgabe` ist der einzige Weg, denselben Käfig für etwas anderes zu
 * benutzen** — der Postbote ordnet Blätter ein, die Nachlese schreibt
 * Abschriften nach, der Fragenlauf baut Abruffragen. Alles übrige bleibt
 * gleich, und das ist der Punkt: dieselben Schalter, dieselbe Frist, dasselbe
 * Kontingent. Ein zweiter Käfig neben diesem wäre eine zweite Stelle, an der
 * man vergessen kann, `--tools ""` zu setzen.
 */
export async function laufFuerAufgabe<A>(
  aufgabe: Aufgabe<A>,
  adresse: string,
  token: string,
  modell?: string,
): Promise<LaufErgebnis<A>> {
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
    return await starten(aufgabe, arbeitsplatz, mcpDatei, modell);
  } finally {
    rmSync(arbeitsplatz, { recursive: true, force: true });
  }
}

function starten<A>(
  aufgabe: Aufgabe<A>,
  arbeitsplatz: string,
  mcpDatei: string,
  modell: string | undefined,
): Promise<LaufErgebnis<A>> {
  const argumente = [
    "-p",
    aufgabe.auftrag,
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    mcpDatei,
    "--allowedTools",
    aufgabe.erlaubt.join(" "),
    "--output-format",
    "json",
    // Das Schema geht als JSON in die Zeile, nicht als Pfad: `claude` liest
    // dieses Argument selbst als JSON und antwortet auf einen Dateinamen mit
    // „is not valid JSON" (ausprobiert). Über spawn mit Argumentliste gibt es
    // keine Shell, die daran etwas zu deuten hätte.
    "--json-schema",
    JSON.stringify(aufgabe.schema),
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

      fertig(auswerten(aufgabe, aus, fehlerAus, code));
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
function auswerten<A>(
  aufgabe: Aufgabe<A>,
  aus: string,
  fehlerAus: string,
  code: number | null,
): LaufErgebnis<A> {
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

  const roh = ergebnis.structured_output;

  const antwort =
    roh && typeof roh === "object"
      ? aufgabe.formen(roh as Record<string, unknown>)
      : null;

  if (!antwort) {
    return {
      art: "nichts",
      grund: `Keine verwertbare Antwort: ${(ergebnis.result ?? "").slice(0, 200)}`,
    };
  }

  return {
    art: "antwort",
    antwort,
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
export function zahlAus(wert: unknown): number {
  return typeof wert === "number" && Number.isFinite(wert) && wert >= 0
    ? Math.round(wert)
    : 0;
}
