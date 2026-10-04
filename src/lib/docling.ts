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

/** Wie oft nachgefragt wird, ob die Seite fertig ist. */
const POLL_MS = 1_500;

/**
 * Eine Seite durch Docling. Wirft bei jedem Fehler; der Aufrufer fängt.
 *
 * Über den asynchronen Weg — abgeben, nachfragen, abholen — und nicht über
 * `/v1/convert/file`. Der synchrone Weg wartet serverseitig nur eine feste
 * Zeit und antwortet danach mit 404 „Task result not found", auch wenn die
 * Seite noch in Arbeit ist. Auf dem Prozessor des NAS ist das bei einer
 * Formelseite keine Ausnahme.
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
  const { task_id: taskId } = (await submitted.json()) as { task_id: string };

  for (;;) {
    if (Date.now() > deadline) throw new Error("Docling braucht zu lange.");

    const poll = await fetch(`${base}/v1/status/poll/${taskId}`, {
      signal: signal(),
    });
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

  const result = await fetch(`${base}/v1/result/${taskId}`, {
    headers: { accept: "application/json" },
    signal: signal(),
  });
  if (!result.ok) {
    throw new Error(`Docling liefert das Ergebnis nicht (${result.status}).`);
  }

  const body = (await result.json()) as {
    document?: { md_content?: string | null };
    status?: string;
    processing_time?: number;
  };

  return {
    markdown: (body.document?.md_content ?? "").trim(),
    seconds: body.processing_time ?? 0,
    status: body.status ?? "unknown",
  };
}
