import { timeInBerlin } from "@/lib/dates";

/**
 * Docling — der zweite Leser eines Fotos, für das Gedruckte.
 *
 * Docling (IBM, offen) wandelt eine Seite in Text um und läuft als eigener
 * Container auf dem NAS (`docling-serve-cpu`), nur im Heimnetz erreichbar.
 * Was es gut kann, ist genau das, was beim Abschreiben am teuersten falsch
 * wird: gedruckter Text Zeichen für Zeichen, Tabellen als Tabellen, Formeln
 * als LaTeX. Was es nicht kann, ist Handschrift — dafür ist es nicht gebaut,
 * und dafür bleibt Claude.
 *
 * Deshalb ist Docling hier eine VORLAGE und keine Abschrift. Der Postbote ruft
 * `read_docling`, übernimmt Gedrucktes, Tabellen und Formeln von dort und
 * ergänzt die Handschrift aus dem Foto. In die Datenbank kommt nichts davon
 * direkt; gespeichert wird weiter nur, was über `propose_sheet` hereinkommt.
 *
 * Eingebaut am 4.10.2026 auf ausdrücklichen Wunsch („wir binden das ein").
 * Ohne `DOCLING_URL` meldet das Werkzeug, dass Docling fehlt, und der
 * Postbote liest wie bisher nur das Foto.
 */

/**
 * Auf dem Prozessor des NAS braucht eine Seite mit Formeln spürbar. Länger
 * wartet niemand — dann liest der Postbote eben nur das Foto.
 */
const TIMEOUT_MS = 180_000;

export function doclingConfigured(): boolean {
  return Boolean(process.env.DOCLING_URL);
}

/** Die Form, die das Werkzeug zurückgibt. */
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
 * - `do_formula_enrichment`: Formeln als LaTeX. Der Grund, warum es Docling
 *   hier überhaupt gibt.
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
 * unberührt — dann soll der Postbote es dort ruhig wieder versuchen. Kennt
 * Docling die Aufgabe dagegen nicht mehr (404 nach einem Neustart), antwortet
 * es mit 5xx oder gar nicht, dann geht es der nächsten Seite genauso, und jede
 * kostete bis zu `TIMEOUT_MS`. Genau diese Fälle öffnen den Schalter weiter
 * unten; ein gewöhnliches `Error` öffnet ihn nicht.
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
 *   keine leere Seite. Sonst läse `read_docling` daraus „vermutlich alles
 *   Handschrift", und das wäre über eine Seite, die Docling gar nicht
 *   fertig gelesen hat, eine Behauptung ohne Grundlage.
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
 * Seite die vollen `TIMEOUT_MS`: ein Blatt mit acht Seiten wartete 24 Minuten
 * und lief damit sicher in die Frist des Postboten — Runde für Runde, und die
 * Blätter dahinter warteten mit. Mit der Pause zahlt die erste Seite einmal,
 * alles danach liest sofort nur das Foto.
 *
 * Zehn Minuten, weil eine abgebrochene Aufgabe in docling-serve weiterläuft
 * (es gibt keinen Weg, sie abzubrechen) und dort Rechenzeit belegt; kürzer
 * hieße, die nächste Seite in genau diesen Stau zu schicken. Die Pause gilt
 * für den ganzen Prozess — Postbote, Nachlese und jeder andere Client
 * gleichermaßen — und vergisst sich bei einem Neustart der App, was in
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
 * Wie lange ein gelesenes Ergebnis im Vorrat bleibt, und wie viele höchstens.
 *
 * Eine Stunde reicht über einen Lauf des Postboten und seinen nächsten
 * Versuch hinaus, wenn ein Lauf an der Frist scheiterte. Fünfzig Seiten sind
 * vier volle Blätter; ein Ergebnis wiegt ein paar Kilobyte Markdown.
 */
export const VORRAT_TTL_MS = 60 * 60_000;
export const VORRAT_MAX = 50;

/** Ein Vorrat laufender und fertiger Umrechnungen, je Schlüssel eine. */
export type Vorrat<T> = {
  /**
   * Die Umrechnung zu diesem Schlüssel — die vorhandene, wenn es sie gibt,
   * sonst eine neue aus `load`. `treffer` sagt, welches von beiden.
   */
  holen(
    key: string,
    load: () => Promise<T>,
    now?: number,
  ): { promise: Promise<T>; treffer: boolean };
  /**
   * Das FERTIGE Ergebnis zu diesem Schlüssel, ohne etwas anzustoßen — `null`,
   * wenn es keins gibt, es abgelaufen ist oder die Umrechnung noch läuft.
   *
   * Für die Pause (`read_docling`, seit dem 4.10.2026): solange Docling ruht,
   * soll nichts darauf warten und nichts Neues beginnen, aber was schon fertig
   * dasteht, ist gelesen und kostet Docling nichts mehr. Ein Treffer hier lässt
   * den Eintrag, wo er ist, und verdrängt nichts.
   */
  fertig(key: string, now?: number): { wert: T } | null;
  groesse(): number;
};

/**
 * Ein neuer Vorrat.
 *
 * **Der Eintrag steht, bevor irgendetwas wartet.** `load` beginnt erst im
 * nächsten Mikrotask, der Eintrag ist da schon gesetzt. Ein zweiter Aufruf zum
 * selben Schlüssel — `read_docling` zweimal nebeneinander, oder Anfrage und
 * Vorauslesen — findet ihn deshalb immer und rechnet dieselbe Seite nicht
 * zweimal. Stünde der Eintrag erst hinter einem `await`, fände ihn der zweite
 * Aufruf genau in dem Moment nicht, in dem es darauf ankommt.
 *
 * **Ein Fehlschlag bleibt nicht liegen.** Der Eintrag geht weg, sobald die
 * Umrechnung scheitert; der nächste Versuch rechnet neu. Gelöscht wird nur,
 * wenn noch derselbe Eintrag dasteht — ein neuerer bleibt.
 *
 * Abgelaufene Einträge fallen beim nächsten Anlegen weg, und ist der Vorrat
 * dann noch voll, der älteste. Ein so verdrängter Eintrag, der noch rechnet,
 * rechnet weiter; wer auf ihn wartet, bekommt sein Ergebnis trotzdem.
 *
 * **Fertig heißt: das Ergebnis steht am Eintrag.** Ein Promise lässt sich
 * nicht fragen, ob es schon erfüllt ist; deshalb schreibt der Vorrat das
 * Ergebnis beim Erfüllen selbst an den Eintrag (`ergebnis`), und `fertig()`
 * liest nur das. Die Rückmeldung hängt am Promise, bevor irgendjemand anderes
 * darauf wartet — wer `await holen(…).promise` hinter sich hat, findet den
 * Eintrag also schon fertig vor.
 */
export function neuerVorrat<T>(
  ttlMs: number = VORRAT_TTL_MS,
  max: number = VORRAT_MAX,
): Vorrat<T> {
  const eintraege = new Map<
    string,
    { promise: Promise<T>; at: number; ergebnis: { wert: T } | null }
  >();

  return {
    fertig(key, now = Date.now()) {
      const da = eintraege.get(key);
      if (!da || now - da.at >= ttlMs) return null;
      return da.ergebnis;
    },
    holen(key, load, now = Date.now()) {
      const da = eintraege.get(key);
      if (da && now - da.at < ttlMs) return { promise: da.promise, treffer: true };

      eintraege.delete(key);
      for (const [alt, eintrag] of eintraege) {
        if (now - eintrag.at >= ttlMs) eintraege.delete(alt);
      }
      // Eine Map zählt in der Reihenfolge des Einfügens; der erste Schlüssel
      // ist also der älteste.
      while (eintraege.size >= max) {
        const aeltester = eintraege.keys().next().value;
        if (aeltester === undefined) break;
        eintraege.delete(aeltester);
      }

      const promise = Promise.resolve().then(load);
      const eintrag = { promise, at: now, ergebnis: null as { wert: T } | null };
      eintraege.set(key, eintrag);
      promise.then(
        (wert) => {
          eintrag.ergebnis = { wert };
        },
        () => {
          if (eintraege.get(key) === eintrag) eintraege.delete(key);
        },
      );

      return { promise, treffer: false };
    },
    groesse() {
      return eintraege.size;
    },
  };
}

/**
 * Schalter und Vorrat des Prozesses — an `globalThis`, aus demselben Grund wie
 * die Datenbank in @/db: Next kann dieses Modul in mehreren Bündeln auswerten,
 * und zwei Vorräte rechneten dieselbe Seite zweimal.
 */
const globalForDocling = globalThis as unknown as {
  __schulappDocling?: { schalter: Schalter; vorrat: Vorrat<DoclingResult> };
};

function prozess() {
  globalForDocling.__schulappDocling ??= {
    schalter: neuerSchalter(),
    vorrat: neuerVorrat<DoclingResult>(),
  };
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

/**
 * Die Umrechnung einer Seite, aus dem Vorrat oder neu.
 *
 * Geschlüsselt nach Nutzer UND Seite. `load` prüft beim ersten Mal, dass die
 * Seite diesem Nutzer gehört (`readPageImage()`); ein späterer Treffer
 * überspringt das, und das darf er nur, weil derselbe Nutzer im Schlüssel
 * steht. Ein Schlüssel aus der Seite allein gäbe einem Fremden, der die id
 * errät, das Markdown eines anderen Blattes.
 *
 * Der Schlüssel nimmt an, dass sich die Bytes einer Seite nie ändern. Das gilt
 * heute — eine Seite lässt sich löschen, aber nicht ersetzen oder drehen. Kommt
 * so etwas dazu, muss es hier den Eintrag wegnehmen.
 */
export function doclingFor(
  userId: string,
  pageId: string,
  load: () => Promise<DoclingResult>,
  now: number = Date.now(),
): { promise: Promise<DoclingResult>; treffer: boolean } {
  return prozess().vorrat.holen(vorratsSchluessel(userId, pageId), load, now);
}

/**
 * Die schon fertige Umrechnung einer Seite, oder `null` — ohne zu warten und
 * ohne Docling zu fragen.
 *
 * Für die Pause, seit dem 4.10.2026: vorher wies `read_docling` während der
 * Pause jede Seite ab, auch eine, die längst fertig im Vorrat lag — meist
 * genau die, die das Vorauslesen kurz vor dem Ausfall noch geschafft hatte.
 * Derselbe Schlüssel wie bei `doclingFor()`, mit dem Nutzer darin; ein Treffer
 * heißt also, dass DIESER Nutzer die Seite schon einmal lesen durfte.
 */
export function doclingFertig(
  userId: string,
  pageId: string,
  now: number = Date.now(),
): DoclingResult | null {
  return (
    prozess().vorrat.fertig(vorratsSchluessel(userId, pageId), now)?.wert ??
    null
  );
}

function vorratsSchluessel(userId: string, pageId: string): string {
  return `${userId}:${pageId}`;
}
