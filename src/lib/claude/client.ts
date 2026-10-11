import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type {
  BetaBase64ImageSource,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import { auswerten, type Ausgang, type ClaudeErgebnis } from "./ergebnis";

/**
 * Die App ruft Opus selbst — ein Aufruf, ohne Werkzeuge (seit dem 11.10.2026).
 *
 * Bis dahin las ein eigener Dienst neben der App, der Postbote: ein `claude`
 * im Käfig, mit einem Abo statt eines Schlüssels, der über den Web MCP las und
 * vorschlug. Seit diesem Tag ruft die App das Modell über die API selbst. Der
 * Käfig zieht dabei mit und wird enger:
 *
 * - **Keine Werkzeuge.** Die Anfrage trägt kein `tools`, kein `tool_choice`,
 *   keine Server-Werkzeuge, keine MCP-Server — `claudeAnfrage()` baut sie aus
 *   einer festen Liste von Feldern, und client.test.ts prüft genau diese
 *   Liste. Was das Modell sieht, ist der Systemtext, der Auftrag und die
 *   Bilder; was es tun kann, ist antworten. Ein Blatt, auf dem „lösche alle
 *   Noten“ steht, findet hier nichts, womit es das könnte.
 * - **Strukturierte Antwort.** Die Form steht als zod-Schema beim Aufrufer
 *   und geht als `output_config.format` mit. Zurück kommt sie trotzdem durch
 *   `safeParse` (@/lib/claude/ergebnis) — die API sorgt für die Form, die App
 *   prüft sie trotzdem selbst. Ein Modell, das ein nicht vertrauenswürdiges
 *   Blatt gelesen hat, bekommt seine Antwort nie ungeprüft durchgereicht.
 * - **Geschrieben wird hier nichts.** Dieses Modul ruft und deutet; was aus
 *   einer Antwort wird, entscheidet die Tür (@/lib/blatt-vorschlag), dieselbe,
 *   durch die `propose_sheet` geht.
 *
 * **Modell und Aufwand sind gemessen, nicht gewählt.** Am 11.10.2026, blind an
 * 31 echten Seiten: Opus 5.5 schrieb Handschrift rund viermal besser ab als
 * Sonnet 5.5 (10–13 gegen 37–52 bestätigte schwere Fehler), und Sonnet
 * „verbesserte“ still die Schreibweise des Schülers — genau das, was die
 * Regeln verbieten. Gemessen wurde mit `effort: "high"` und der
 * 1000-px-Lesefassung; beides ist deshalb die Vorgabe. Die Vorgabe des
 * Modells selbst wäre `medium`, also steht der Aufwand ausdrücklich da.
 *
 * **Was das API verbietet, steht hier nicht:** kein Vorbefüllen der Antwort,
 * kein `budget_tokens`, kein `temperature`/`top_p`/`top_k`, kein erzwungenes
 * `tool_choice` — alles 400 auf Opus 5.5. Gedacht wird adaptiv; wie viel,
 * steuert allein `effort`.
 *
 * **Ein Rückfall bei Ablehnung.** Opus 5.5 hat Sicherheitsfilter, die auch ein
 * harmloses Biologieblatt ablehnen können. `fallbacks: "default"` lässt die
 * API die Anfrage dann im selben Aufruf auf dem Modell wiederholen, das sie
 * für die Kategorie empfiehlt. Wer wirklich geschrieben hat, steht danach in
 * der Antwort und damit in der Messung; ungemessen ist dieses Modell an
 * Handschrift, und das soll man im Protokoll sehen.
 *
 * **Die Frist setzt der Code selbst** (`fristMs`, als `AbortSignal`). Next
 * kennt für `next start` keine, die wirken würde (`maxDuration` liest dort
 * niemand), und ein Lauf ohne Frist hielte die Queue des Lesers fest.
 *
 * **Gestreamt, aber nicht mitgelesen.** `max_tokens` ist groß, und ohne
 * Strom weist das SDK eine solche Anfrage ab („Streaming is required for
 * operations that may take longer than 10 minutes“) — eine zwölfseitige
 * Abschrift bei `high` kann so lange brauchen. `finalMessage()` wartet auf das
 * Ende und liefert die ganze Antwort, samt `usage`.
 */

/** Das Modell, gemessen am 11.10.2026 (Kopf dieser Datei). */
export const CLAUDE_MODELL = "claude-opus-5-5";

/** Der Aufwand der Messung — die Vorgabe des Modells wäre `medium`. */
export const CLAUDE_EFFORT = "high";

/**
 * Wie viele Tokens eine Antwort höchstens hat, Denken eingeschlossen.
 *
 * Zwölf Seiten (`MAX_PAGES`) zu je 8 000 Zeichen sind 96 000 Zeichen, deutsch
 * grob 30 000 bis 40 000 Tokens, dazu das JSON und das Denken bei `high`.
 * 64 000 lassen dafür Luft, und sie sind zugleich die Obergrenze der Kosten
 * eines einzelnen Aufrufs auf der Ausgabeseite: 64 000 × 20 $ je Million
 * sind 1,28 $. Wird die Grenze erreicht, ist die Antwort abgeschnitten und der
 * Lauf `nichts` — eine halbe Abschrift ist schlimmer als keine.
 *
 * Das ist die Obergrenze. Der Abschreiber bindet seine Grenze seit dem
 * 11.10.2026 an die Seitenzahl (`maxTokensFuer()` in
 * @/lib/leser/claude-auftrag): ein Blatt mit einer Seite braucht keine 64 000,
 * und eine Schleife an ihm soll nicht so viel kosten dürfen.
 */
export const CLAUDE_MAX_TOKENS = 64_000;

/**
 * Wie langsam eine Antwort schlimmstenfalls geschrieben wird, in Tokens je
 * Sekunde — angenommen, nicht gemessen, und mit Absicht niedrig.
 *
 * Opus schreibt sonst eher 40 bis 70 Tokens je Sekunde; an einem zähen Tag
 * und mit adaptivem Denken bei `high` liegt es darunter. Die Zahl hat genau
 * eine Aufgabe: aus ihr wird die Frist eines Aufrufs (`fristFuerTokens()`),
 * und die Frist muss LÄNGER sein als die Zeit, die eine Antwort bis an ihr
 * `max_tokens` braucht. Andersherum — so stand es bis zur Abnahme vom
 * 11.10.2026: eine Viertelstunde für 64 000 Tokens — brach die eigene Frist
 * eine ausufernde Antwort ab, bevor sie an `max_tokens` stieß. Das ergab
 * „später“ statt „nichts“: nicht gemerkt, also ein zweiter und dritter
 * bezahlter Versuch an derselben Schleife, statt eines gemerkten.
 */
export const CLAUDE_LANGSAM_TOK_S = 25;

/**
 * Was vor dem ersten Token vergeht: die Bilder hochladen, Wartezeit bei der
 * API, die zwei Wiederholungen des SDK bei 429 und 5xx samt ihrer Pausen.
 */
export const CLAUDE_ANLAUF_MS = 3 * 60_000;

/**
 * Die Frist für einen Aufruf mit so vielen Ausgabe-Tokens: der Anlauf plus
 * die Zeit, die `maxTokens` bei `CLAUDE_LANGSAM_TOK_S` brauchen. Damit greift
 * `max_tokens` vor der Frist, solange die API nicht langsamer schreibt als
 * angenommen — eine Antwort, die nicht aufhört, endet als „nichts“ (gemerkt,
 * einmal bezahlt) und nicht als „später“. Für 64 000 Tokens sind das gut
 * 45 Minuten; so lange hält nur ein Aufruf die Queue, der wirklich ausufert.
 */
export function fristFuerTokens(maxTokens: number): number {
  return CLAUDE_ANLAUF_MS + Math.ceil((maxTokens / CLAUDE_LANGSAM_TOK_S) * 1000);
}

/**
 * Die Beta-Kennung für `fallbacks: "default"`. Die ältere Form mit einer
 * Liste von Modellen braucht eine andere (`…-2026-06-01`); beide zu
 * verwechseln ist ein 400.
 */
export const CLAUDE_RUECKFALL_BETA = "server-side-fallback-2026-07-01";

/**
 * Wohin der Schlüssel geht — fest und nicht aus `ANTHROPIC_BASE_URL`. Das SDK
 * nähme sonst jede Adresse aus der Umgebung und schickte den Schlüssel dorthin.
 */
const API_ADRESSE = "https://api.anthropic.com";

/**
 * Ist ein Schlüssel eingerichtet? Wie `jevConfigured()` und
 * `doclingConfigured()`: ohne ihn läuft die App wie bisher, nur liest niemand
 * Handschrift.
 *
 * Gelesen wird `ANTHROPIC_API_KEY` zur Laufzeit aus der Umgebung des Prozesses
 * — nie als `NEXT_PUBLIC_`, nie als Build-Argument: Next backte ihn sonst ins
 * Bild, und von dort ist er in jedem Abzug.
 */
export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Welche Fassung einer Seite das Modell bekommt.
 *
 * `lesefassung` (1000 px) ist die gemessene und die Vorgabe. `voll` (1600 px)
 * ist möglich, aber UNGEMESSEN: mehr Bildpunkte heißt nicht von selbst
 * besser gelesen, und es heißt sicher mehr Bild-Tokens je Seite. Umgestellt
 * wird mit `CLAUDE_BILD=voll`, erst nach einer Messung; jeder andere Wert —
 * auch ein Tippfehler — bleibt bei der gemessenen Fassung.
 */
export type ClaudeBildfassung = "lesefassung" | "voll";

export function claudeBildfassung(
  wert: string | undefined = process.env.CLAUDE_BILD,
): ClaudeBildfassung {
  return wert?.trim() === "voll" ? "voll" : "lesefassung";
}

/**
 * Was das Modell zu sehen bekommt: Text und Bilder, die Bilder nur als Bytes.
 *
 * Enger als das, was die API annähme, und das mit Absicht: kein Bild über eine
 * Adresse (die API holte sie ab), kein Dokument, kein Werkzeugergebnis. Was
 * hineingeht, liegt schon in der App.
 */
export type ClaudeInhalt =
  | { type: "text"; text: string }
  | { type: "image"; source: BetaBase64ImageSource };

/** Die Formate, die die API als Bild annimmt — die App speichert drei davon. */
const API_BILDFORMATE = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/**
 * Eine Seite als Bildblock — oder `null`, wenn ihr Format keines ist, das die
 * API annimmt. Dann ist nur DIESE Seite unlesbar, nicht das Blatt.
 */
export function bildBlock(bytes: Uint8Array, mimeType: string): ClaudeInhalt | null {
  const format = API_BILDFORMATE.find((erlaubt) => erlaubt === mimeType);
  if (!format) return null;

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: format,
      // `Buffer.from(Uint8Array)` kopiert genau den Ausschnitt — nicht den
      // ganzen Speicher darunter (siehe `bytea` in src/db/schema.ts).
      data: Buffer.from(bytes).toString("base64"),
    },
  };
}

/** Ein Aufruf, so wie ihn der Leser bestellt. */
export type ClaudeAuftrag<T> = {
  /** Was für jeden Aufruf dieser Art gilt (z. B. `ABSCHREIBER_SYSTEM`). */
  system: string;
  /** Der Auftrag und die Bilder, in der Reihenfolge, in der das Modell sie liest. */
  inhalt: readonly ClaudeInhalt[];
  /**
   * Die Form der Antwort. Ohne `.transform()`: aus dem Schema wird auch das
   * JSON-Schema für die API, und eine Umwandlung lässt sich dort nicht
   * ausdrücken.
   */
  schema: z.ZodType<T>;
  /**
   * Was die API als Form der Antwort sieht, wenn das mehr ist als `schema` —
   * sonst `schema` selbst. Der Fragenlauf (@/lib/fragenlauf) zeigt dem Modell
   * die Fragen mit dem Schema von propose_questions, samt Beschreibung und
   * Grenzen jedes Feldes, prüft danach aber jede Frage einzeln: eine zu lange
   * soll nicht die übrigen elf kosten, die schon bezahlt sind. Die Prüfung
   * übernimmt das Ganze also lockerer, und die Form muss trotzdem alles sagen.
   */
  form?: z.ZodType;
  /**
   * Die eigene Frist in Millisekunden — danach ist der Lauf `spaeter`. Sie
   * muss länger sein, als `maxTokens` brauchen (`fristFuerTokens()`).
   */
  fristMs: number;
  /** Höchstzahl der Ausgabe-Tokens; Vorgabe `CLAUDE_MAX_TOKENS`. */
  maxTokens?: number;
};

/**
 * Wer die Anfrage tatsächlich verschickt. In `npm test` ein nachgemachter,
 * damit kein Test je einen echten Aufruf macht und keiner einen Schlüssel
 * braucht.
 *
 * `begonnen` ruft der Sender, sobald das Modell zu schreiben begonnen hat —
 * beim ersten Inhaltsblock des Stroms, gleich ob Denken, Text oder der Block
 * eines Rückfalls (seit der Abnahme vom 11.10.2026). Ab da ist der Aufruf
 * bezahlt, auch wenn er danach abbricht; davor — ein 400, ein 429, eine
 * Verbindung, die nie zustande kam, eine Annahme mit 200, nach der nur noch
 * ein Fehler kam — kostet er nichts. Ein bezahlter Abbruch steht in der
 * Monatssumme als Lücke („mindestens …“); auf die Grenze je Blatt
 * (@/lib/leser/claude-ablauf) zählen davon nur die, die am Blatt liegen
 * können.
 */
export type ClaudeSender = (
  anfrage: BetaMessageStreamParams,
  signal: AbortSignal,
  begonnen?: () => void,
) => Promise<BetaMessage>;

/**
 * Das Schema als Antwortformat für die API — OHNE die Prüffunktion, die das
 * SDK mitliefert.
 *
 * Mit ihr parste das SDK die Antwort schon in `finalMessage()` und würfe bei
 * einer abgeschnittenen oder abgelehnten Antwort einen Fehler, in dem `usage`
 * und `stop_reason` verloren gingen — genau die beiden, an denen man sieht,
 * was passiert ist und was es gekostet hat. Geprüft wird stattdessen danach,
 * in @/lib/claude/ergebnis, mit demselben Schema.
 *
 * **Und ohne den Umweg über `betaZodOutputFormat()`.** Der wandelt mit
 * `reused: "ref"`, und zod legt dabei jedes freiwillige Feld
 * (`.optional().describe(…)`) als Verweis in `$defs` ab; die Umformung des
 * SDK (`transformJSONSchema()`) behält an einem Verweis nur den Verweis — die
 * Beschreibung fällt still weg. Am 11.10.2026 beim Fragenlauf gesehen: an
 * propose_questions verlöre das Modell so die Sätze zu `topic` („die
 * subjectTopicId, nicht der Titel“), zu `kind` (die vier Materialarten) und
 * zu `note`. Hier wird deshalb ohne Verweise gewandelt (`reused: "inline"`)
 * und erst dann dieselbe Umformung angewandt: was die API nicht prüft
 * (Längen, Höchstzahlen, `enum`), wandert wie vorher in die Beschreibung.
 * `$schema` fällt weg — die Umformung schriebe es sonst als Satz in die
 * Beschreibung des Ganzen.
 */
export function antwortFormat(schema: z.ZodType): BetaJSONOutputFormat {
  const json: Record<string, unknown> = z.toJSONSchema(schema, {
    reused: "inline",
    io: "output",
  });
  delete json.$schema;
  return { type: "json_schema", schema: transformJSONSchema(json) };
}

/**
 * Die Anfrage, wie sie verschickt wird — aus einer festen Liste von Feldern.
 *
 * Kein Spread eines fremden Objekts, kein „und was sonst noch mitkam“: jedes
 * Feld steht hier einzeln, und ein neues muss hier hingeschrieben werden, wo
 * der Kopf dieser Datei sagt, warum es keine Werkzeuge gibt.
 */
export function claudeAnfrage<T>(auftrag: ClaudeAuftrag<T>): BetaMessageStreamParams {
  return {
    model: CLAUDE_MODELL,
    max_tokens: auftrag.maxTokens ?? CLAUDE_MAX_TOKENS,
    betas: [CLAUDE_RUECKFALL_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: CLAUDE_EFFORT,
      format: antwortFormat(auftrag.form ?? auftrag.schema),
    },
    system: auftrag.system,
    messages: [{ role: "user", content: [...auftrag.inhalt] }],
  };
}

/**
 * Der echte Sender: das SDK, mit dem Schlüssel aus der Umgebung.
 *
 * `authToken: null` und eine feste Adresse, damit nichts anderes aus der
 * Umgebung mitliest: läge daneben ein `ANTHROPIC_AUTH_TOKEN`, schickte das SDK
 * beide Kopfzeilen, und die API wiese jeden Aufruf mit 401 ab — als `pause`,
 * also ohne Schaden, aber ohne Abschrift. Die Wiederholungen bei 429 und 5xx
 * (zwei, die Vorgabe des SDK) bleiben: sie geschehen, bevor der Strom beginnt,
 * kosten nichts und laufen innerhalb der eigenen Frist.
 *
 * „Begonnen“ ist der erste Inhaltsblock (`content_block_start`) im Strom.
 * Bis zur Nachprüfung vom 11.10.2026 war es das Ereignis `connect`, und das
 * fällt schon, wenn die API mit 200 antwortet: eine Überlastung, die sie
 * danach als Ereignis im Strom schickt (`overloaded_error`), galt dann als
 * bezahlter Abbruch, obwohl kein Token entstanden war. `message_start` und
 * `ping` kommen ebenso vor jedem Token und zählen deshalb nicht.
 */
export const anthropicSenden: ClaudeSender = (anfrage, signal, begonnen) => {
  const strom = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    authToken: null,
    baseURL: API_ADRESSE,
  }).beta.messages.stream(anfrage, { signal });
  if (begonnen) {
    let gemeldet = false;
    strom.on("streamEvent", (ereignis) => {
      if (gemeldet || ereignis.type !== "content_block_start") return;
      gemeldet = true;
      begonnen();
    });
  }
  return strom.finalMessage();
};

/**
 * Ruft Opus und deutet, was zurückkommt — eines von vier Ergebnissen, nie eine
 * Ausnahme.
 *
 * Ohne Schlüssel wird gar nicht erst gerufen: das ist `pause` und nicht
 * `nichts`, denn es liegt nicht am Blatt — und wer den Schlüssel nachträgt,
 * soll jedes Blatt noch gelesen bekommen.
 */
export async function claudeRufen<T>(
  auftrag: ClaudeAuftrag<T>,
  senden: ClaudeSender = anthropicSenden,
): Promise<ClaudeErgebnis<T>> {
  if (senden === anthropicSenden && !claudeConfigured()) {
    return {
      art: "pause",
      grund: "Kein API-Schlüssel eingerichtet (ANTHROPIC_API_KEY fehlt).",
      messung: null,
      abbruch: null,
      pauseAmBlatt: false,
      wandMs: 0,
    };
  }

  const anfrage = claudeAnfrage(auftrag);
  const frist = AbortSignal.timeout(auftrag.fristMs);
  const beginn = Date.now();
  let begonnen = false;

  let ausgang: Ausgang;
  try {
    const nachricht = await senden(anfrage, frist, () => {
      begonnen = true;
    });
    ausgang = { art: "nachricht", nachricht, wandMs: Date.now() - beginn };
  } catch (fehler) {
    ausgang = {
      art: "fehler",
      fehler,
      fristAbgelaufen: frist.aborted,
      begonnen,
      wandMs: Date.now() - beginn,
    };
  }

  return auswerten(ausgang, auftrag.schema, CLAUDE_MODELL);
}
