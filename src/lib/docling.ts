import { timeInBerlin } from "@/lib/dates";

/**
 * Docling — der Leser der App für sauberen Druck.
 *
 * Docling (IBM, offen) wandelt eine Seite in Text um und läuft als eigener
 * Container auf dem NAS (`docling-serve-cpu`), nur im Heimnetz erreichbar.
 * Was es gut kann, ist gedruckter Text Zeichen für Zeichen und Tabellen als
 * Tabellen. Was es nicht kann, ist Handschrift — gemessen am 5.10.2026 an 37
 * Seiten: gedruckt rund 94 %, Handschrift rund 32 %, und das als Kauderwelsch.
 *
 * Seit dem 6.10.2026 liest jede Seite genau EIN Leser, und die App
 * entscheidet, welcher (@/lib/leser/zuteilung). Die Zuteilung schickt jede
 * neue Seite genau einmal hierher, gleich nach dem Hochladen; Doclings
 * Rohtext steht danach in `material_pages.docling_text` und wird nie neu
 * gerechnet. Ist er sauberer Druck (feste Regel plus Jev), wird er die
 * Abschrift der Seite; sonst liest Claude die Seite vom Foto — ohne Doclings
 * Text daneben. Ein Werkzeug für Agenten gibt es nicht mehr, und eine Vorlage
 * für Claude auch nicht: bis zum 6.10.2026 rechnete Docling jede Seite für den
 * Postboten vor (`read_docling`), und Claude schrieb sie danach trotzdem
 * vollständig ab — zwei Leser für jede Seite, und wer was übernimmt, entschied
 * ein Satz im Prompt.
 *
 * Eingebaut am 4.10.2026 auf ausdrücklichen Wunsch („wir binden das ein").
 * Ohne `DOCLING_URL` fragt die Zuteilung Docling nicht und gibt jede Seite
 * Claude, wie vor Docling.
 */

/**
 * Auf dem Prozessor des NAS braucht eine Seite mit Formeln spürbar. Länger
 * wartet die Zuteilung nicht — dann liest Claude die Seite vom Foto. Die
 * Zuteilung arbeitet nach dem Hochladen und nicht in einer Anfrage, also
 * wartet in dieser Zeit niemand außer den Seiten dahinter.
 */
const TIMEOUT_MS = 180_000;

export function doclingConfigured(): boolean {
  return Boolean(process.env.DOCLING_URL);
}

/** Was Docling zu einer Seite zurückgibt. */
export type DoclingResult = {
  markdown: string;
  /** Sekunden, die Docling selbst gerechnet hat. */
  seconds: number;
  status: string;
};

/**
 * Die Einstellungen für eine Schulseite.
 *
 * - `force_ocr`: Ein Foto hat keine Textebene; ohne OCR käme nichts heraus.
 * - Sprachen Deutsch, Französisch, Englisch — die Fächer, in denen geschrieben
 *   wird.
 * - `do_formula_enrichment`: Formeln als LaTeX. Seit dem 6.10.2026 liest
 *   Docling eine Seite mit Formelverdacht nie allein (@/lib/leser/regel), die
 *   Einstellung bleibt trotzdem: die Messung an 37 Seiten, auf der die Regel
 *   steht, ist mit ihr gemacht. Ob sie entfallen kann, muss erst eine
 *   Gegenmessung ohne sie zeigen.
 * - `image_export_mode=placeholder`: Bilder auf dem Blatt als Platzhalter und
 *   nicht als Base64 — sonst wöge die Antwort mehr als das Foto.
 *
 * Exportiert für den Test, damit eine geänderte Einstellung auffällt.
 */
export function doclingForm(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
): FormData {
  const form = new FormData();
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";

  form.append("files", new Blob([bytes], { type: mimeType }), `seite.${extension}`);
  form.append("to_formats", "md");
  form.append("do_ocr", "true");
  form.append("force_ocr", "true");
  for (const lang of ["de", "fr", "en"]) form.append("ocr_lang", lang);
  form.append("do_formula_enrichment", "true");
  // Ausdrücklich, nicht „default": In docling-serve 1.x gibt es die
  // Voreinstellung „default" für Formeln nicht mehr, und ohne diese Zeile
  // scheitert jede Seite mit „Preset 'default' not found" (gemessen am
  // 4.10.2026).
  form.append("code_formula_preset", "codeformulav2");
  form.append("table_mode", "accurate");
  form.append("image_export_mode", "placeholder");

  return form;
}

/**
 * Wie oft nachgefragt wird, ob die Seite fertig ist.
 *
 * Eine halbe Sekunde seit dem 4.10.2026, vorher anderthalb. Im Mittel wartet
 * eine fertige Seite die Hälfte dieser Zeit, bis jemand nachfragt — das sind
 * jetzt eine Viertelsekunde statt einer Dreiviertelsekunde je Seite. Viel ist
 * das nicht, aber es kostet auch nichts: die Nachfrage ist ein Blick in eine
 * Tabelle von docling-serve und rechnet selbst nichts.
 */
const POLL_MS = 500;

/**
 * Ein Fehler, der Docling als Ganzes trifft und nicht nur diese eine Seite.
 *
 * Die Unterscheidung ist der Grund, warum es diese Klasse gibt. Scheitert eine
 * einzelne Seite („failure" am Ende der Aufgabe), ist die nächste Seite davon
 * unberührt — dann soll die Zuteilung Docling dort ruhig wieder fragen. Kennt
 * Docling die Aufgabe dagegen nicht mehr (404 nach einem Neustart), antwortet
 * es mit 5xx oder gar nicht, dann geht es der nächsten Seite genauso, und jede
 * kostete bis zu `TIMEOUT_MS`. Genau diese Fälle öffnen den Schalter weiter
 * unten; ein gewöhnliches `Error` öffnet ihn nicht. Die Zuteilung schreibt
 * beides verschieden in `leser_grund`: „docling-ausfall" und
 * „docling-fehler" — in beiden Fällen liest Claude die Seite.
 *
 * Der Zeitablauf des Clients kommt nicht immer als diese Klasse an — reißt
 * `AbortSignal.timeout()` mitten in einer Anfrage ab, wirft fetch einen
 * `TimeoutError`. Den erkennt `trifftDocling()` am Namen.
 */
export class DoclingAusfall extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DoclingAusfall";
  }
}

/**
 * Eine Seite durch Docling. Wirft bei jedem Fehler; der Aufrufer fängt.
 *
 * Über den asynchronen Weg — abgeben, nachfragen, abholen — und nicht über
 * `/v1/convert/file`. Der synchrone Weg wartet serverseitig nur eine feste
 * Zeit und antwortet danach mit 404 „Task result not found", auch wenn die
 * Seite noch in Arbeit ist. Auf dem Prozessor des NAS ist das bei einer
 * Formelseite keine Ausnahme.
 *
 * Was wirft, steht seit dem 4.10.2026 genauer da, weil daran der Schalter
 * hängt (siehe `DoclingAusfall`):
 *
 * - Abgeben: eine Absage (4xx, 5xx) oder eine Antwort ohne `task_id` ist ein
 *   gewöhnlicher Fehler. Ein 4xx ist fast immer eine falsche Einstellung, und
 *   die scheitert ohnehin sofort — dafür muss niemand pausieren.
 * - Nachfragen und Abholen: 404 und 5xx sind ein Ausfall, ebenso ein
 *   Netzfehler. Bis hierher las die Schleife bei einem 404 weiter, fand in der
 *   Antwort keinen Status und fragte bis zum Ende der Frist nach — drei Minuten
 *   für eine Aufgabe, die es nicht mehr gab.
 * - Leeres Ergebnis mit einem anderen Status als „success": ein Fehler und
 *   keine leere Seite. Sonst hielte die Zuteilung eine Seite, die Docling gar
 *   nicht fertig gelesen hat, für eine ohne Gedrucktes — mit demselben
 *   Ergebnis (Claude liest), aber mit einem falschen Grund in `leser_grund`,
 *   und an dem soll sich die Regel später nachmessen lassen.
 */
export async function convertPage(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
): Promise<DoclingResult> {
  const base = process.env.DOCLING_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("DOCLING_URL fehlt.");

  const deadline = Date.now() + TIMEOUT_MS;
  const signal = () => AbortSignal.timeout(Math.max(1, deadline - Date.now()));

  const submitted = await fetch(`${base}/v1/convert/file/async`, {
    method: "POST",
    headers: { accept: "application/json" },
    body: doclingForm(bytes, mimeType),
    signal: signal(),
  });
  if (!submitted.ok) {
    throw new Error(
      `Docling nimmt die Seite nicht an (${submitted.status}): ${(await submitted.text()).slice(0, 300)}`,
    );
  }
  const { task_id: taskId } = (await submitted.json()) as { task_id?: unknown };
  // Ohne diese Zeile fragte die Schleife unten nach `/v1/status/poll/undefined`
  // — und bekäme ein 404, das wie ein Neustart aussähe und den Schalter
  // öffnete, obwohl Docling nur eine unerwartete Antwort gegeben hat.
  if (typeof taskId !== "string" || taskId === "") {
    throw new Error("Docling hat die Seite angenommen, aber keine Aufgabe genannt (task_id fehlt).");
  }

  for (;;) {
    if (Date.now() > deadline) throw new DoclingAusfall("Docling braucht zu lange.");

    const poll = await nachfragen(`${base}/v1/status/poll/${taskId}`, {
      signal: signal(),
    });
    if (!poll.ok) {
      throw antwortFehler(
        poll.status,
        poll.status === 404
          ? "Docling kennt die Aufgabe nicht mehr (404) — vermutlich neu gestartet."
          : `Docling antwortet beim Nachfragen mit ${poll.status}.`,
      );
    }

    const status = (await poll.json()) as {
      task_status?: string;
      error_message?: string | null;
    };

    if (status.task_status === "success") break;
    if (status.task_status === "failure") {
      throw new Error(`Docling ist gescheitert: ${status.error_message ?? "ohne Grund"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  const result = await nachfragen(`${base}/v1/result/${taskId}`, {
    headers: { accept: "application/json" },
    signal: signal(),
  });
  if (!result.ok) {
    throw antwortFehler(
      result.status,
      `Docling liefert das Ergebnis nicht (${result.status}).`,
    );
  }

  const body = (await result.json()) as {
    document?: { md_content?: string | null };
    status?: string;
    processing_time?: number;
  };

  const markdown = (body.document?.md_content ?? "").trim();
  const status = body.status ?? "unknown";

  if (markdown === "" && status !== "success") {
    throw new Error(`Docling liefert keinen Text (Status „${status}“).`);
  }

  return {
    markdown,
    seconds: body.processing_time ?? 0,
    status,
  };
}

/**
 * fetch für Nachfragen und Abholen: ein Netzfehler heißt hier, dass Docling weg
 * ist — die Seite hatte es ja eben noch angenommen.
 *
 * Der Zeitablauf geht unverändert durch; er ist schon als solcher zu erkennen
 * (`trifftDocling()`), und eingewickelt verlöre er seinen Namen.
 */
async function nachfragen(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (istZeitablauf(error)) throw error;
    throw new DoclingAusfall("Docling ist beim Nachfragen nicht erreichbar.", {
      cause: error,
    });
  }
}

/** 404 und 5xx sind ein Ausfall, jeder andere Status ein gewöhnlicher Fehler. */
function antwortFehler(status: number, message: string): Error {
  return status === 404 || status >= 500
    ? new DoclingAusfall(message)
    : new Error(message);
}

function istZeitablauf(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/**
 * Trifft dieser Fehler Docling als Ganzes — oder nur diese eine Seite?
 *
 * Ja heißt: der Zeitablauf des Clients oder ein `DoclingAusfall` (404, 5xx,
 * kein Netz beim Nachfragen). Nein heißt alles andere, ausdrücklich auch eine
 * einzelne gescheiterte Seite und eine Absage beim Abgeben.
 */
export function trifftDocling(error: unknown): boolean {
  return error instanceof DoclingAusfall || istZeitablauf(error);
}

/**
 * Wie lange Docling nach einem Ausfall in Ruhe gelassen wird.
 *
 * Eingebaut am 4.10.2026. Ohne die Pause kostete ein hängendes Docling jede
 * Seite die vollen `TIMEOUT_MS`: ein Blatt mit acht Seiten wartete 24 Minuten,
 * bevor die Zuteilung es Claude gibt, und die Seiten dahinter warteten mit —
 * die Zuteilung liest eine Seite nach der anderen. Mit der Pause zahlt die
 * erste Seite einmal; jede Seite danach fragt Docling gar nicht erst und geht
 * sofort an Claude („docling-pause" in `leser_grund`). Eine Seite, die in der
 * Pause an Claude ging, bleibt dort — nachgeholt wird nichts.
 *
 * Zehn Minuten, weil eine abgebrochene Aufgabe in docling-serve weiterläuft
 * (es gibt keinen Weg, sie abzubrechen) und dort Rechenzeit belegt; kürzer
 * hieße, die nächste Seite in genau diesen Stau zu schicken. Die Pause gilt
 * für den ganzen Prozess und vergisst sich bei einem Neustart der App, was in
 * Ordnung ist: dann ist meist auch Docling neu.
 */
export const PAUSE_MS = 10 * 60_000;

/** Der Schalter: ob Docling gerade pausiert, und was ihn öffnet. */
export type Schalter = {
  /** Bis wann (ms seit 1970) Docling pausiert — `null`, wenn nicht. */
  pausiertBis(now?: number): number | null;
  /** Meldet einen Fehlschlag. `true` heißt: der Schalter ist jetzt offen. */
  fehlschlag(error: unknown, now?: number): boolean;
};

/**
 * Ein neuer Schalter. Die Uhr wird hineingereicht, damit sich die zehn Minuten
 * prüfen lassen, ohne zehn Minuten zu warten.
 */
export function neuerSchalter(pauseMs: number = PAUSE_MS): Schalter {
  let ausBis = 0;

  return {
    pausiertBis(now = Date.now()) {
      return now < ausBis ? ausBis : null;
    },
    fehlschlag(error, now = Date.now()) {
      if (!trifftDocling(error)) return false;
      // Ein zweiter Ausfall während der Pause verlängert sie: dann hing auch
      // die Aufgabe, die noch unterwegs war.
      ausBis = now + pauseMs;
      return true;
    },
  };
}

/**
 * Der Schalter des Prozesses — an `globalThis`, aus demselben Grund wie die
 * Datenbank in @/db: Next kann dieses Modul in mehreren Bündeln auswerten,
 * und zwei Schalter wüssten nichts voneinander — der eine schickte die
 * nächste Seite in den Stau, vor dem der andere gerade pausiert.
 *
 * Bis zum 6.10.2026 stand daneben ein Vorrat fertiger Umrechnungen, für
 * `read_docling` und das Vorauslesen der nächsten Seite. Seit Docling jede
 * Seite genau einmal liest und das Ergebnis in `material_pages.docling_text`
 * steht, ist die Datenbank dieser Vorrat.
 */
const globalForDocling = globalThis as unknown as {
  __schulappDocling?: { schalter: Schalter };
};

function prozess() {
  globalForDocling.__schulappDocling ??= { schalter: neuerSchalter() };
  return globalForDocling.__schulappDocling;
}

/** Bis wann Docling pausiert, oder `null`. */
export function doclingPausiertBis(now: number = Date.now()): number | null {
  return prozess().schalter.pausiertBis(now);
}

/**
 * Meldet einen Fehlschlag an den Schalter. Öffnet er sich, steht eine Zeile im
 * Protokoll — mit dem Grund und der Uhrzeit, bis zu der Docling ruht. Sonst
 * sähe man dem Lauf nur an, dass Docling plötzlich fehlt, und nicht, warum.
 */
export function doclingFehlschlag(error: unknown, now: number = Date.now()): boolean {
  const offen = prozess().schalter.fehlschlag(error, now);

  if (offen) {
    console.error(
      `Docling pausiert bis ${timeInBerlin(new Date(now + PAUSE_MS))}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return offen;
}
