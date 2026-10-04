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
 *
 * Seit dem 4.10.2026 gilt diese Zahl nur noch, wo niemand eine andere nennt:
 * für die Nachlese von Hand und den Fragenlauf. Ein Blatt des Postboten
 * bekommt seine Frist nach Seitenzahl, siehe `fristFuer()`.
 */
export const FRIST_MS = 900_000;

/**
 * Die längste Frist, die `fristFuer()` vergibt.
 *
 * Sie ist zugleich die Zahl, nach der `zugriffstoken()` in mcp.mts das Token
 * bemisst: Jedes Token, das in einen Käfig geht, muss die längste mögliche
 * Frist überstehen. Mehr als 57 Minuten gehen nicht: mit der Minute Luft in
 * mcp.mts sind das 58, und ein Zugriffs-Token lebt eine Stunde
 * (ACCESS_TTL_SECONDS in @/lib/oauth). mcp.mts prüft das beim Laden.
 */
export const FRIST_MAX_MS = 45 * 60_000;

/** Was jeder Lauf braucht, gleich wie viele Seiten: starten, vorschlagen, antworten. */
const GRUNDLAST_MS = 5 * 60_000;

/**
 * Was eine Seite höchstens braucht: die 180 s, nach denen die App auf Docling
 * nicht mehr wartet (TIMEOUT_MS in @/lib/docling), und rund eine Minute für
 * Claude, der die Seite liest und abschreibt. Von Hand abgeschrieben, weil
 * dieser Ordner nichts aus src/ importieren darf (siehe RASPBERRY.md) — steigt
 * die Zahl dort, gehört sie hier nachgezogen.
 */
const PRO_SEITE_MS = 4 * 60_000;

/** MAX_PAGES in @/lib/images, aus demselben Grund von Hand. */
const MAX_SEITEN = 12;

/**
 * Die Frist für ein Blatt mit so vielen Seiten.
 *
 * Eingeführt am 4.10.2026 mit Docling. Eine feste Viertelstunde passte, solange
 * eine Seite in Sekunden gelesen war. Auf dem Prozessor des NAS kann Docling
 * für eine einzige Seite bis zu drei Minuten brauchen, und ein Blatt mit fünf
 * solchen Seiten liefe in die Viertelstunde, käme als „spaeter" zurück, liefe
 * in der nächsten Runde wieder hinein — und kostete jedes Mal einen ganzen
 * Lauf, ohne je fertig zu werden. Je Seite zu rechnen gibt dem großen Blatt die
 * Zeit, die es braucht, und dem kleinen nicht mehr als bisher.
 *
 * Der Preis steht auf der anderen Seite: ein Blatt, das trotzdem hängt, kostet
 * jetzt bis zu einer Dreiviertelstunde Kontingent je Runde statt einer
 * Viertelstunde, und drei solche halten eine Runde über zwei Stunden auf.
 *
 * Eine Seitenzahl, die keine ist, zählt als zwölf: lieber die volle Frist als
 * eine, die ein großes Blatt mitten in der Abschrift abschneidet.
 *
 * Geschätzt, nicht gemessen. Nachmessen lässt es sich an der Zeile „Züge …,
 * Wand … s", die der Postbote nach jedem Lauf schreibt.
 */
export function fristFuer(seiten: number): number {
  const anzahl = Number.isInteger(seiten) && seiten > 0 ? seiten : MAX_SEITEN;
  return Math.min(FRIST_MAX_MS, GRUNDLAST_MS + anzahl * PRO_SEITE_MS);
}

/**
 * Wie viele Züge ein Lauf hat.
 *
 * Gezählt ist der ungünstigste Fall, und der ist seit Docling (4.10.2026)
 * größer: ein Modell, das jeden Aufruf einzeln macht, statt read_docling und
 * read_page in einen Zug zu legen, und das nach jedem Bild noch einen eigenen
 * Zug zum Aufschreiben braucht. Das sind je Seite drei Züge, bei zwölf Seiten
 * (MAX_PAGES in @/lib/images) sechsunddreißig. Dazu read_sheet, read_subjects,
 * read_topics und propose_sheet — die mittleren beiden verlangt der Auftrag
 * seit dem 4.10.2026 nicht mehr, erlaubt sind sie aber weiter, und ein Aufruf
 * kostet einen Zug. Macht vierzig; dazu zwölf Luft für Fehlgriffe — ein
 * Werkzeug, das nein sagt und noch einmal richtig gerufen wird — und für die
 * Antwort am Ende. Zweiundfünfzig.
 *
 * Folgt das Modell dem Auftrag, braucht dasselbe Blatt rund vierzehn: ein Zug
 * je Seite mit beiden Aufrufen, dazu propose_sheet und die Antwort.
 *
 * Warum trotzdem der ungünstigste Fall: wer mitten in der Abschrift aus den
 * Zügen läuft, kommt nie zu propose_sheet. Herauskäme ein Lauf, der die ganze
 * Arbeit gemacht und nichts abgeliefert hat — und als „nichts" landet das
 * Blatt in gesehen.json und kommt nie wieder. Gegen ein Modell, das sich
 * verrennt, steht die Frist (`fristFuer()`), nicht diese Zahl.
 *
 * Zwanzig waren es bis zum 5.9.2026, vierzig bis zum 4.10.2026 — die vierzig
 * waren noch ohne read_docling gerechnet.
 */
const MAX_ZUEGE = 52;

/**
 * Was ein Lauf gekostet hat, in den Zahlen, die `claude` selbst mitschickt —
 * dazu die Wanduhr dieses Prozesses.
 *
 * Eingebaut am 4.10.2026, bevor irgendetwas schneller gemacht wird: ob die
 * Zeit im Modell steckt, in den Werkzeugen (Docling) oder davor, sagte bis
 * dahin keine Zeile im Mitlesen. API-Zeit gegen Wanduhr trennt das grob;
 * Ausgabe gegen Denken zeigt, ob die Abschrift zweimal geschrieben wird.
 *
 * Jede Zahl geht durch `zahlAus()`: die Feldnamen gehören der Fassung von
 * `claude`, und benennt eine neue sie um, steht hier eine 0 statt eines
 * Absturzes. Eine 0 heißt in dieser Zeile deshalb im Zweifel „nicht
 * mitgeschickt" und nicht „nichts verbraucht".
 */
export type Messung = {
  /** `num_turns`. */
  zuege: number;
  /** `duration_api_ms` — die Zeit, in der das Modell gerechnet hat. */
  apiMs: number;
  /** Hier gemessen, vom Start des Prozesses bis zu seinem Ende. */
  wandMs: number;
  /** `stop_reason`; leer, wenn keiner dastand. */
  stopGrund: string;
  eingabe: number;
  ausgabe: number;
  /** Davon Denken (`output_tokens_details.thinking_tokens`). */
  denken: number;
  cacheGelesen: number;
  cacheGeschrieben: number;
};

/** Sekunden, gerundet — für das Mitlesen. */
function sekunden(ms: number): number {
  return Math.round(ms / 1000);
}

/**
 * Die Messung als eine Zeile fürs Mitlesen.
 *
 * Der Grund, warum das Modell aufgehört hat, steht nur dabei, wenn er etwas
 * sagt: „end_turn" ist der Normalfall, ein „max_tokens" dagegen der Hinweis,
 * dass eine Antwort abgeschnitten wurde.
 */
export function messungZeile(messung: Messung): string {
  const tok = (zahl: number) => zahl.toLocaleString("de-DE");

  return (
    `Züge ${messung.zuege}, Ausgabe ${tok(messung.ausgabe)} Tok ` +
    `(davon Denken ${tok(messung.denken)}), ` +
    `Cache gelesen ${tok(messung.cacheGelesen)}, ` +
    `API ${sekunden(messung.apiMs)} s, Wand ${sekunden(messung.wandMs)} s` +
    (messung.stopGrund && messung.stopGrund !== "end_turn"
      ? `, Stopp: ${messung.stopGrund}`
      : "")
  );
}

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
  | {
      art: "antwort";
      antwort: A;
      kostenUsd: number;
      dauerMs: number;
      messung?: Messung;
    }
  /**
   * Nicht dieser Lauf war das Problem, sondern das, worauf jeder Lauf sich
   * stützt: Kontingent leer, API weg, `claude` startet nicht. Die Runde hört
   * auf; das Blatt bleibt ungemerkt. Eine Messung gibt es nur, wenn `claude`
   * noch JSON geschrieben hat.
   */
  | { art: "pause"; grund: string; messung?: Messung }
  /**
   * Dieser eine Lauf ist nicht fertig geworden (Frist). Das Blatt bleibt
   * ungemerkt und ist beim nächsten Durchgang wieder dran — die Runde macht
   * mit dem nächsten Blatt weiter. Gemessen ist nur die Wanduhr: ein
   * abgebrochener Lauf schreibt kein Ergebnis, aus dem sich mehr lesen ließe.
   */
  | { art: "spaeter"; grund: string; wandMs?: number }
  /**
   * Der Lauf ist gelaufen und hat nichts zustande gebracht. Nicht wiederholen.
   * Die Messung ist hier am meisten wert: ein Lauf, der an den Zügen
   * scheitert, ist genau der, dessen Züge man sehen will.
   */
  | { art: "nichts"; grund: string; messung?: Messung };

/**
 * Setzt Claude auf eine Aufgabe an.
 *
 * `token` ist ein Zugriffs-Token des Postboten, das jede Frist übersteht —
 * `zugriffstoken()` in mcp.mts verlangt dafür ausdrücklich `FRIST_MAX_MS`
 * Vorlauf. Nachgelegt wird während des Laufs nicht: Das Token geht als Datei
 * in den Käfig, und danach führt kein Weg mehr hinein. Deshalb wird `fristMs`
 * hier auf FRIST_MAX_MS gedeckelt — eine längere Frist liefe dem Token davon.
 *
 * **`aufgabe` ist der einzige Weg, denselben Käfig für etwas anderes zu
 * benutzen** — der Postbote schreibt Blätter ab, die Nachlese schreibt
 * Abschriften nach, der Fragenlauf baut Abruffragen. Alles übrige bleibt
 * gleich, und das ist der Punkt: dieselben Schalter, dasselbe Kontingent. Ein
 * zweiter Käfig neben diesem wäre eine zweite Stelle, an der man vergessen
 * kann, `--tools ""` zu setzen.
 *
 * Nur die Frist ist seit dem 4.10.2026 ein Argument: ein Blatt mit zwölf
 * Seiten darf länger als eines mit einer (`fristFuer()`). Wer nichts sagt,
 * bekommt FRIST_MS wie bisher.
 */
export async function laufFuerAufgabe<A>(
  aufgabe: Aufgabe<A>,
  adresse: string,
  token: string,
  modell?: string,
  fristMs: number = FRIST_MS,
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
    return await starten(
      aufgabe,
      arbeitsplatz,
      mcpDatei,
      modell,
      Math.min(fristMs, FRIST_MAX_MS),
    );
  } finally {
    rmSync(arbeitsplatz, { recursive: true, force: true });
  }
}

function starten<A>(
  aufgabe: Aufgabe<A>,
  arbeitsplatz: string,
  mcpDatei: string,
  modell: string | undefined,
  fristMs: number,
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

  // Docling darf je Seite bis zu 180 s rechnen (TIMEOUT_MS in @/lib/docling),
  // und so lange wartet read_docling. Wie lange `claude` von sich aus auf ein
  // MCP-Werkzeug wartet, ist nicht belegt — also steht es hier ausdrücklich,
  // mit zwanzig Sekunden Luft über der Grenze der App. Ohne das könnte der
  // Käfig eine Seite aufgeben, an der Docling noch rechnet. (4.10.2026)
  umgebung.MCP_TOOL_TIMEOUT = "200000";

  return new Promise((fertig) => {
    // Die Wanduhr beginnt vor dem Start: was `claude` braucht, bis es
    // überhaupt fragt (Anmeldung, MCP-Server verbinden), gehört mit in die
    // Rechnung, und genau das fehlt in `duration_ms`.
    const start = Date.now();
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
    }, fristMs);

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
          grund: `Frist von ${Math.round(fristMs / 60_000)} Minuten überschritten`,
          wandMs: Date.now() - start,
        });
        return;
      }

      fertig(auswerten(aufgabe, aus, fehlerAus, code, Date.now() - start));
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
  wandMs: number,
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
    // Ab hier nur für die Messung, und deshalb alles `unknown`: was davon
    // ankommt, entscheidet die Fassung von `claude`, nicht dieser Typ.
    num_turns?: unknown;
    duration_api_ms?: unknown;
    stop_reason?: unknown;
    usage?: {
      input_tokens?: unknown;
      output_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
      output_tokens_details?: { thinking_tokens?: unknown } | null;
    } | null;
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

  const nutzung = ergebnis.usage ?? {};
  const messung: Messung = {
    zuege: zahlAus(ergebnis.num_turns),
    apiMs: zahlAus(ergebnis.duration_api_ms),
    wandMs,
    stopGrund: typeof ergebnis.stop_reason === "string" ? ergebnis.stop_reason : "",
    eingabe: zahlAus(nutzung.input_tokens),
    ausgabe: zahlAus(nutzung.output_tokens),
    denken: zahlAus(nutzung.output_tokens_details?.thinking_tokens),
    cacheGelesen: zahlAus(nutzung.cache_read_input_tokens),
    cacheGeschrieben: zahlAus(nutzung.cache_creation_input_tokens),
  };

  if (ergebnis.api_error_status === 429) {
    return { art: "pause", grund: "Kontingent erschöpft (429)", messung };
  }

  if (ergebnis.api_error_status && ergebnis.api_error_status >= 500) {
    return {
      art: "pause",
      grund: `Die API war nicht erreichbar (${ergebnis.api_error_status})`,
      messung,
    };
  }

  // Nicht angemeldet, abgelaufen, widerrufen: das liegt am Käfig und nicht
  // am Blatt, und es trifft das nächste genauso. Kam es bisher als JSON mit
  // `is_error`, landete es unten bei „nichts" — und der Postbote merkte sich
  // jedes Blatt, das während des Ausfalls drankam, für immer als erledigt
  // (4.10.2026; derselbe Ausfall stand schon einmal unbemerkt auf dem NAS,
  // verdeckt durch einen leeren Korb). Gefragt wird nach ausdrücklichen
  // Zeichen einer Anmeldung, nicht nach „kein einziger Zug": ein Fehler, der
  // nur dieses Blatt betrifft, darf die Warteschlange nicht anhalten.
  const meldung = typeof ergebnis.result === "string" ? ergebnis.result : "";
  if (
    ergebnis.api_error_status === 401 ||
    ergebnis.api_error_status === 403 ||
    /not logged in|please run \/login|invalid api key|oauth token|authenticat/i.test(meldung)
  ) {
    return {
      art: "pause",
      grund: `claude ist nicht angemeldet: ${meldung.slice(0, 200)}`,
      messung,
    };
  }

  if (ergebnis.is_error || code !== 0) {
    return {
      art: "nichts",
      grund: `Lauf gescheitert (${ergebnis.subtype ?? "?"}, exit ${code}): ${(ergebnis.result ?? "").slice(0, 200)}`,
      messung,
    };
  }

  const verweigert = ergebnis.permission_denials ?? [];
  if (verweigert.length > 0) {
    return {
      art: "nichts",
      grund: `Der Lauf wollte etwas, das er nicht darf: ${verweigert.map((v) => v.tool_name).join(", ")}`,
      messung,
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
      messung,
    };
  }

  return {
    art: "antwort",
    antwort,
    kostenUsd: ergebnis.total_cost_usd ?? 0,
    dauerMs: ergebnis.duration_ms ?? 0,
    messung,
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
