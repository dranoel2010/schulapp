import {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import type { LeserLaufAbbruch, LeserLaufMessung } from "@/db/schema";

/**
 * Was bei einem Aufruf herauskommt — auch wenn er scheitert. Reine Rechnung:
 * kein Netz, keine Datenbank, damit `npm test` jeden Ausgang durchspielen
 * kann, ohne einen Cent auszugeben.
 *
 * **Vier Ausgänge, und der Unterschied zwischen ihnen ist Geld.** Sie sind die
 * des Käfigs, in dem der Postbote bis zum 11.10.2026 lief (`auswerten()` in
 * harness/kaefig.mts), und sie beantworten zwei Fragen: Ist dieses Blatt für
 * seinen jetzigen Stand erledigt? Und lohnt sich gleich danach das nächste?
 *
 * - `antwort`: das Modell hat geantwortet, und die Antwort hat die Prüfung
 *   Feld für Feld bestanden. Daraus macht der Aufrufer „vorschlag“ oder
 *   „kein-vorschlag“.
 * - `nichts`: der Lauf ist gelaufen und hat nichts Brauchbares ergeben —
 *   abgelehnt (auch nach dem Rückfall), abgeschnitten, eine Antwort, die nicht
 *   zum Schema passt, eine Anfrage, die zu groß oder nicht zu verarbeiten ist
 *   (413/422; ein 400 nicht — warum, steht an `fehlerEinordnen`). Gemerkt:
 *   derselbe Stand des Blattes liefe genauso, nur noch einmal bezahlt.
 * - `pause`: nicht das Blatt war das Problem, sondern das, worauf jeder Lauf
 *   sich stützt — Schlüssel falsch oder fehlend, Abrechnung, Kontingent, die
 *   API gestört oder nicht erreichbar. Der ganze Leser hält an; NICHT
 *   gemerkt. Ein Schlüsselfehler darf nie zu „nichts“ werden: am 4.10.2026
 *   merkte sich der Postbote so jedes Blatt eines Ausfalls für immer.
 * - `spaeter`: nur dieser Versuch ist nicht fertig geworden (eigene Frist,
 *   Zeitüberschreitung, ein 400, der nicht nach Konto klingt, eine Ablehnung,
 *   deren Rückfallmodell ausgelastet war). Nicht gemerkt, und das nächste
 *   Blatt darf trotzdem gleich drankommen: die Frist gehört dem Blatt, nicht
 *   der API.
 *
 * **Bezahlt oder nicht** (`abbruch`, seit der Abnahme vom 11.10.2026). Ob ein
 * Ausgang ohne Ergebnis Geld gekostet hat, ist eine zweite Frage neben den
 * vieren: ein 400 oder 429, bevor das Modell schrieb, kostet nichts; die
 * eigene Frist oder ein Abbruch, nachdem es zu schreiben begann, kostet die
 * Tokens bis dahin. Bezahlt heißt aber nicht „am Blatt“: welche Abbrüche auf
 * die Grenze je Blatt zählen (`SPAETER_HOECHSTENS`), entscheidet
 * @/lib/leser/claude-ablauf nach `abbruch` — ein Abbruch mitten im Strom
 * zählt, auch als Pause, außer seine Art schließt das Blatt aus (`ausfall`:
 * Überlastung, Grenzen, Konto); was vor dem Inhalt scheitert, kostet nichts
 * und zählt nie (siehe `fehlerEinordnen`).
 *
 * **Und eine dritte Frage, nur für `pause`: kann sie am Blatt liegen?**
 * (`pauseAmBlatt`). Ein abgewiesener Schlüssel, eine leere Abrechnung, ein
 * 429, ein Netz ohne Namensauflösung oder eine überlastete API treffen jedes
 * Blatt gleich; ein 500 oder ein Strom, der mitten in der Antwort abreißt,
 * kann an genau dieser Anfrage hängen — und nur diese darf der Leser dem Blatt
 * zurechnen, das gerade dran war (`PAUSEN_JE_BLATT`).
 *
 * **Fehler werden an ihrer Klasse erkannt, nicht an ihrem Text** — mit einer
 * begründeten Ausnahme beim 400 (Guthaben/Limit, siehe `fehlerEinordnen`). Das SDK wirft
 * je Statuscode eine eigene Klasse (`RateLimitError`, `AuthenticationError`
 * …); ein Satz der API kann sich ändern, eine Klasse nicht ohne neue Fassung.
 * Wo die Klasse nichts sagt — ein Fehler mitten im Strom kommt ohne
 * Statuscode —, entscheidet das Feld `type` der Fehlermeldung, ein
 * festgelegter Wert der API und kein Satz.
 *
 * **Die Ausgabe wird geprüft, nicht durchgereicht.** Was zurückkommt, hat ein
 * Modell erzeugt, das ein nicht vertrauenswürdiges Blatt gelesen hat. Es geht
 * durch `safeParse` mit dem Schema des Aufrufers, und was durchfällt, ist
 * `nichts` — nie ein halb übernommenes Objekt.
 */

/** Die Messung eines Aufrufs — die Form steht an der Spalte in src/db/schema.ts. */
export type Messung = LeserLaufMessung;

export type ClaudeErgebnis<T> =
  | { art: "antwort"; antwort: T; messung: Messung; wandMs: number }
  | {
      art: "nichts" | "pause" | "spaeter";
      grund: string;
      /** Nur, wenn eine Antwort kam — ein Fehler ohne Antwort hat keine `usage`. */
      messung: Messung | null;
      /**
       * Bei `pause` und `spaeter`: war der Versuch bezahlt, und woran brach er
       * ab? `null` heißt: er hat nichts gekostet (siehe Kopf).
       */
      abbruch: LeserLaufAbbruch | null;
      /**
       * Nur bei `pause`: kann sie an dieser Anfrage liegen und nicht an Konto,
       * Netz oder Last der API (siehe Kopf)? Bei den anderen Ausgängen immer
       * `false` — für sie gilt die Frage nicht.
       */
      pauseAmBlatt: boolean;
      wandMs: number;
    };

/** Was der Aufruf erlebt hat, bevor es gedeutet wird. */
export type Ausgang =
  | { art: "nachricht"; nachricht: BetaMessage; wandMs: number }
  | {
      art: "fehler";
      fehler: unknown;
      /** Ist die EIGENE Frist abgelaufen? Dann ist jeder Abbruch ein „später“. */
      fristAbgelaufen: boolean;
      /** Hatte das Modell zu schreiben begonnen — war der Aufruf also schon bezahlt? */
      begonnen: boolean;
      wandMs: number;
    };

/** Preise in US-Dollar je Million Tokens. */
type Preis = { eingabe: number; ausgabe: number; cacheGelesen: number };

/**
 * Was ein Modell kostet, das hier antworten kann.
 *
 * Opus 5.5 ist das bestellte; Opus 5 und Opus 4.8 sind die Modelle, auf die
 * `fallbacks: "default"` nach einer Ablehnung umleitet. Ein Rückfall wird zu
 * DESSEN Preisen abgerechnet, nicht zu denen des bestellten. Cache lesen kostet
 * bei Opus 5.5 das 0,05-Fache der Eingabe (0,20 $), sonst das 0,1-Fache; Cache
 * schreiben 1,25-fach für fünf Minuten, 2-fach für eine Stunde (unten).
 * Stand: Preisliste vom Oktober 2026.
 *
 * Ein Modell, das hier fehlt, macht die Kosten UNBEKANNT und nicht null: eine
 * Null sähe in der Monatssumme aus wie ein geschenkter Lauf.
 */
export const PREISE: Readonly<Record<string, Preis>> = {
  "claude-opus-5-5": { eingabe: 4, ausgabe: 20, cacheGelesen: 0.2 },
  "claude-opus-5": { eingabe: 5, ausgabe: 25, cacheGelesen: 0.5 },
  "claude-opus-4-8": { eingabe: 5, ausgabe: 25, cacheGelesen: 0.5 },
};

const CACHE_SCHREIBEN_5M = 1.25;
const CACHE_SCHREIBEN_1H = 2;

/**
 * Der Preis eines Modells — für die id selbst und für eine mit Datum dahinter
 * („claude-opus-4-8-20260101“). Kein Präfixvergleich: „claude-opus-5“ ist ein
 * Präfix von „claude-opus-5-5“, und das teurere Modell bekäme sonst den
 * Preis des billigeren oder umgekehrt.
 */
export function preisFuer(modell: string): Preis | null {
  for (const [id, preis] of Object.entries(PREISE)) {
    if (modell === id || new RegExp(`^${id}-\\d{8}$`).test(modell)) return preis;
  }
  return null;
}

/** Eine Zahl aus `usage`: was keine endliche, nicht negative Zahl ist, zählt 0. */
function zahl(wert: number | null | undefined): number {
  return typeof wert === "number" && Number.isFinite(wert) && wert >= 0 ? wert : 0;
}

/** Ein Anlauf eines Aufrufs mit seinem Modell — die Einheit der Abrechnung. */
type Anlauf = {
  modell: string | null;
  eingabe: number;
  ausgabe: number;
  cacheGelesen: number;
  cache5m: number;
  cache1h: number;
};

/** Die Zahlen, die jeder Eintrag in `usage` und `usage.iterations` trägt. */
type Nutzung = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_creation: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  } | null;
};

function anlauf(modell: string | null, nutzung: Nutzung): Anlauf {
  const aufgeteilt = nutzung.cache_creation;
  return {
    modell,
    eingabe: zahl(nutzung.input_tokens),
    ausgabe: zahl(nutzung.output_tokens),
    cacheGelesen: zahl(nutzung.cache_read_input_tokens),
    // Ohne Aufteilung nach Haltbarkeit zählt alles als fünf Minuten — die
    // Vorgabe der API und die einzige, die dieser Leser benutzt.
    cache5m: aufgeteilt
      ? zahl(aufgeteilt.ephemeral_5m_input_tokens)
      : zahl(nutzung.cache_creation_input_tokens),
    cache1h: aufgeteilt ? zahl(aufgeteilt.ephemeral_1h_input_tokens) : 0,
  };
}

/**
 * Die Anläufe eines Aufrufs.
 *
 * **`usage.iterations` ist die Wahrheit, nicht `usage`.** Lehnt Opus 5.5 ab
 * und schreibt ein Rückfallmodell weiter, deckt das `usage` oben nur den
 * Anlauf, der die Antwort geschrieben hat; was der abgelehnte Anlauf gelesen
 * und geschrieben hat, steht nur in den Iterationen — und wird trotzdem
 * berechnet. Ohne Iterationen gibt es genau einen Anlauf, den der Antwort.
 *
 * Ein Eintrag einer Art, die dieser Leser nie auslöst (Zusammenfassung,
 * Berater), kommt mit `modell: null` heraus: seine Kosten sind unbekannt.
 */
function anlaeufe(nachricht: BetaMessage, angefragt: string): Anlauf[] {
  const iterationen = nachricht.usage.iterations ?? [];
  if (iterationen.length === 0) return [anlauf(nachricht.model, nachricht.usage)];

  return iterationen.map((eintrag) => {
    if (eintrag.type === "fallback_message") return anlauf(eintrag.model, eintrag);
    // Der Anlauf des bestellten Modells; trägt er kein Modell, war es das
    // bestellte — abgelehnt und weitergegeben wird nur nach vorn.
    if (eintrag.type === "message") return anlauf(eintrag.model ?? angefragt, eintrag);
    return anlauf(null, eintrag);
  });
}

/** Die Messung aus einer Antwort. Liest nur, deutet nichts. */
export function messungAus(
  nachricht: BetaMessage,
  wandMs: number,
  angefragt: string,
): Messung {
  const liste = anlaeufe(nachricht, angefragt);
  const summe = (feld: keyof Omit<Anlauf, "modell">) =>
    liste.reduce((gesamt, eintrag) => gesamt + eintrag[feld], 0);

  const ohnePreis: string[] = [];
  let kosten = 0;
  for (const eintrag of liste) {
    const preis = eintrag.modell ? preisFuer(eintrag.modell) : null;
    if (!preis) {
      const name = eintrag.modell ?? "unbekannter Anlauf";
      if (!ohnePreis.includes(name)) ohnePreis.push(name);
      continue;
    }
    kosten +=
      (eintrag.eingabe * preis.eingabe +
        eintrag.ausgabe * preis.ausgabe +
        eintrag.cacheGelesen * preis.cacheGelesen +
        eintrag.cache5m * preis.eingabe * CACHE_SCHREIBEN_5M +
        eintrag.cache1h * preis.eingabe * CACHE_SCHREIBEN_1H) /
      1_000_000;
  }

  const abgelehntVon = nachricht.content.flatMap((block) =>
    block.type === "fallback" ? [block.from.model] : [],
  );

  return {
    modell: nachricht.model,
    rueckfall: (nachricht.usage.iterations ?? []).some(
      (eintrag) => eintrag.type === "fallback_message",
    ),
    abgelehntVon,
    stopGrund: nachricht.stop_reason ?? "",
    ablehnung:
      nachricht.stop_reason === "refusal"
        ? (nachricht.stop_details?.category ?? null)
        : null,
    eingabe: summe("eingabe"),
    ausgabe: summe("ausgabe"),
    denken: zahl(nachricht.usage.output_tokens_details?.thinking_tokens),
    cacheGelesen: summe("cacheGelesen"),
    cacheGeschrieben: summe("cache5m") + summe("cache1h"),
    kostenUsd: ohnePreis.length > 0 ? null : kosten,
    ohnePreis,
    wandMs,
  };
}

/**
 * Der Text der Antwort — der hinter dem LETZTEN Rückfall.
 *
 * Lehnt ein Modell mitten im Schreiben ab, steht sein halber Text vor dem
 * `fallback`-Block, und das Rückfallmodell schreibt danach von vorn. Die
 * Antwort ist also nur, was nach dem letzten Wechsel kam; der Rest wäre ein
 * abgebrochenes JSON davor.
 */
export function antwortText(nachricht: BetaMessage): string {
  let ab = 0;
  nachricht.content.forEach((block, index) => {
    if (block.type === "fallback") ab = index + 1;
  });

  return nachricht.content
    .slice(ab)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

/** Ein Satz aus einer Fehlermeldung, gekürzt — fürs Protokoll, nie zum Vergleichen. */
function kurz(fehler: unknown): string {
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

type Einordnung = {
  art: "nichts" | "pause" | "spaeter";
  grund: string;
  abbruch: LeserLaufAbbruch | null;
  pauseAmBlatt: boolean;
};

/**
 * Ein Fehler beim Aufruf, eingeordnet: welcher der vier Ausgänge, ob er
 * bezahlt war, und — bei einer Pause — ob sie am Blatt liegen kann. Bezahlt
 * ist ein Abbruch genau dann, wenn das Modell schon zu schreiben begonnen
 * hatte (`begonnen`, @/lib/claude/client) — auch bei abgelaufener Frist:
 * wartete der Aufruf die ganze Frist auf eine Antwort, die nie kam, hat er
 * nichts gekostet, und das Blatt kann nichts dafür.
 *
 * Welcher bezahlte Abbruch es war, sagt `abbruch`, und davon hängt ab, ob er
 * auf die Grenze je Blatt zählt (`AUF_DIE_GRENZE` in
 * @/lib/leser/claude-ablauf):
 *
 * - `frist`: die eigene Frist lief ab, nachdem es zu schreiben begann.
 * - `ausfall`: der Strom brach mit einer Art ab, die sicher nicht an der
 *   Anfrage liegt (`NIE_AM_BLATT`: Last, Grenzen, Konto, Schlüssel, Modell).
 *   Bezahlt, aber die API — zählt nie.
 * - `strom`: jeder andere Abbruch, nachdem es zu schreiben begann — ein
 *   `api_error` oder ein 400 mitten im Strom, eine Verbindung, die mitten in
 *   der Antwort abreißt. Ob es am Blatt liegt, weiß niemand; ausgeschlossen
 *   ist es nicht, und bezahlt ist es. Zählt (Regression vom 11.10.2026: bis
 *   dahin zählte er nicht, und ein Blatt, an dem der Strom jedes Mal abriss,
 *   wurde bei jedem Anstoß neu bezahlt — zwanzig Mal in zwanzig Anstößen).
 *
 * Ein Fehler mit Statuscode oder ohne Verbindung (`APIConnectionError`) kommt
 * immer VOR dem Inhalt: eine Antwort mit Fehlerstatus trägt keinen Token, und
 * eine Verbindung, die gar nicht erst zustande kam, auch nicht. Er ist nie
 * bezahlt, auch wenn `begonnen` gesetzt wäre — reißt der Strom mitten in der
 * Antwort ab, meldet das SDK das als `AnthropicError` oder als `APIError`
 * ohne Status (BetaMessageStream.js `#handleError`, core/streaming.js).
 */
export function fehlerEinordnen(
  fehler: unknown,
  fristAbgelaufen: boolean,
  begonnen = false,
): Einordnung {
  const art = einordnenOhneKosten(fehler, fristAbgelaufen);
  const bezahlt = art.art !== "nichts" && begonnen && !vorDemInhalt(fehler);
  const abbruch: LeserLaufAbbruch | null = !bezahlt
    ? null
    : fristAbgelaufen
      ? "frist"
      : stromAnDerApi(fehler)
        ? "ausfall"
        : "strom";
  return {
    ...art,
    abbruch,
    pauseAmBlatt: art.art === "pause" && pauseKannAmBlattLiegen(fehler, begonnen),
  };
}

/** Kam dieser Fehler sicher, bevor das Modell schrieb — mit Statuscode oder ohne Verbindung? */
function vorDemInhalt(fehler: unknown): boolean {
  return (
    fehler instanceof APIConnectionError ||
    (fehler instanceof APIError && fehler.status !== undefined)
  );
}

/** Ein Fehler mitten im Strom, dessen Art sicher nicht an der Anfrage liegt. */
function stromAnDerApi(fehler: unknown): boolean {
  return fehler instanceof APIError && NIE_AM_BLATT.has(fehler.type ?? "");
}

/**
 * Die Arten eines Fehlers mitten im Strom, die sicher nicht an der Anfrage
 * liegen: Last, Grenzen, Konto, Schlüssel, Modell. Feste Werte der API
 * (`error.type`), kein Satz. Sie entscheiden zweierlei: eine solche Pause
 * rechnet der Leser keinem Blatt zu (`pauseKannAmBlattLiegen`), und ein
 * solcher bezahlter Abbruch zählt nicht auf die Grenze je Blatt (`ausfall`
 * statt `strom`, `fehlerEinordnen`) — ein Ausfall von Anthropic legt kein
 * Blatt still. Alles andere mitten im Strom ist am Blatt nicht
 * ausgeschlossen.
 */
const NIE_AM_BLATT = new Set([
  "overloaded_error",
  "rate_limit_error",
  "billing_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
]);

/**
 * Kann diese Pause an der Anfrage liegen — also an dem Blatt, das gerade dran
 * war? Nur dann darf der Leser sie ihm zurechnen (`pausenFolge()` in
 * @/lib/leser/claude-ablauf, seit der Nachprüfung vom 11.10.2026: bis dahin
 * zählte dort jede Pause, auch ein erreichtes Ausgabelimit oder ein Netz ohne
 * Namensauflösung, und nach drei solchen Pausen ruhte jedes Blatt, ohne dass
 * ein Wecker es je wieder anstieß).
 *
 * - Ja: ein 5xx außer 503 und 529 — die beiden sagen „nicht verfügbar“ und
 *   „überlastet“, und das gilt für jede Anfrage; ein Fehler mitten im Strom,
 *   dessen Art nicht nach Last oder Konto klingt; ein Strom, der abreißt,
 *   nachdem das Modell schrieb (ein lange schreibendes Blatt kann an einer
 *   Grenze unterwegs hängen bleiben).
 * - Nein: alles, was vor der Antwort scheitert — Verbindung, Schlüssel (401,
 *   403), Grenzen (429), Abrechnung (402, der 400 zum Guthaben), ein Modell,
 *   das der Schlüssel nicht hat (404), ein fehlender Schlüssel.
 */
function pauseKannAmBlattLiegen(fehler: unknown, begonnen: boolean): boolean {
  if (fehler instanceof APIConnectionError) return false;
  if (fehler instanceof InternalServerError) {
    return fehler.status !== 503 && fehler.status !== 529 && !NIE_AM_BLATT.has(fehler.type ?? "");
  }
  if (fehler instanceof APIError) {
    // Mit Status: 401, 403, 429, 402, 404, der 400 zum Guthaben — Konto und
    // Schlüssel. Ohne Status: ein Fehler mitten im Strom, nach seiner Art.
    return fehler.status === undefined && !NIE_AM_BLATT.has(fehler.type ?? "");
  }
  // Kein Fehler der API selbst: abgerissen, nachdem das Modell schrieb — oder
  // etwas, das vor jeder Antwort scheiterte.
  return begonnen;
}

/**
 * Welcher Ausgang — die Reihenfolge ist die Logik: das Genaueste zuerst, weil
 * die Klassen voneinander erben (`APIConnectionTimeoutError` ist ein
 * `APIConnectionError`, jeder ist ein `APIError`).
 */
function einordnenOhneKosten(
  fehler: unknown,
  fristAbgelaufen: boolean,
): Omit<Einordnung, "abbruch" | "pauseAmBlatt"> {
  // Die eigene Frist zuerst: wie das SDK den Abbruch meldet, ist dann egal.
  // Der Satz nennt kein Blatt: seit dem Fragenlauf (@/lib/fragenlauf) kann
  // es auch eine Klausur sein, die in die Frist lief.
  if (fristAbgelaufen) {
    return { art: "spaeter", grund: "Die Frist dieses Laufs ist abgelaufen." };
  }
  if (fehler instanceof APIConnectionTimeoutError) {
    return { art: "spaeter", grund: `Zeitüberschreitung beim Warten auf die API: ${kurz(fehler)}` };
  }
  if (fehler instanceof APIUserAbortError) {
    return { art: "spaeter", grund: "Der Aufruf wurde abgebrochen." };
  }
  if (fehler instanceof APIConnectionError) {
    return { art: "pause", grund: `Die API ist nicht erreichbar: ${kurz(fehler)}` };
  }
  if (fehler instanceof AuthenticationError || fehler instanceof PermissionDeniedError) {
    return {
      art: "pause",
      grund: `Der API-Schlüssel wurde abgewiesen (${fehler.status}): fehlt, falsch oder ohne Recht auf dieses Modell.`,
    };
  }
  if (fehler instanceof RateLimitError) {
    return { art: "pause", grund: `Grenze der API erreicht (429): ${kurz(fehler)}` };
  }
  if (fehler instanceof InternalServerError) {
    // ≥ 500, darunter 529 „überlastet“.
    return { art: "pause", grund: `Die API ist gestört (${fehler.status}): ${kurz(fehler)}` };
  }

  if (fehler instanceof APIError) {
    // Abrechnung — ein Ausgabelimit erreicht, eine Karte abgelaufen. Das liegt
    // am Konto und trifft das nächste Blatt genauso; gemerkt als „nichts“
    // läge jedes Blatt des Monatsendes für immer still.
    if (fehler.type === "billing_error" || fehler.status === 402) {
      return { art: "pause", grund: `Die Abrechnung des API-Kontos lässt keinen Aufruf zu: ${kurz(fehler)}` };
    }
    // „Dieses Modell gibt es für diesen Schlüssel nicht“ — gilt für jedes Blatt.
    if (fehler instanceof NotFoundError) {
      return { art: "pause", grund: `Das Modell ist für diesen Schlüssel nicht verfügbar (404): ${kurz(fehler)}` };
    }

    // Mitten im Strom kommt ein Fehler ohne Statuscode; was er ist, sagt `type`.
    if (fehler.status === undefined) {
      switch (fehler.type) {
        // Wie beim 400 unten: nicht sicher eine Eigenschaft des Blattes.
        case "invalid_request_error":
          return { art: "spaeter", grund: `Die API hat die Anfrage mitten im Lauf abgewiesen: ${kurz(fehler)}` };
        case "timeout_error":
          return { art: "spaeter", grund: `Zeitüberschreitung mitten im Lauf: ${kurz(fehler)}` };
        default:
          return { art: "pause", grund: `Die API brach mitten im Lauf ab (${fehler.type ?? "ohne Art"}): ${kurz(fehler)}` };
      }
    }

    // Ein 400 ist NICHT sicher eine Eigenschaft dieses Blattes. Ein leeres
    // Guthaben oder ein erreichtes Ausgabelimit kam bei dieser API lange als
    // 400 `invalid_request_error` und nicht als 402 — welche Form heute
    // gilt, ist nicht gemessen. Als „nichts“ gemerkt, läge dann jedes Blatt
    // bis zum Monatsende still und danach für immer. Deshalb: was nach Konto
    // klingt, ist eine Pause (der einzige Textvergleich in dieser Datei, und
    // er steht hier, weil die API für diesen Fall keine eigene Art nennt);
    // jeder andere 400 ist „später“ und nicht gemerkt. Das kostet nichts —
    // eine abgewiesene Anfrage wird nicht berechnet —, und deshalb zählt er
    // NICHT auf `SPAETER_HOECHSTENS` (@/lib/leser/claude-ablauf): ein 400, der
    // am Aufruf liegt — eine abgelöste Beta-Kennung, ein Schema, das die API
    // nicht mehr nimmt —, träfe jedes Blatt, und nach der Behebung soll jedes
    // wieder gelesen werden (Abnahme vom 11.10.2026).
    if (fehler instanceof BadRequestError) {
      if (/credit|balance|billing|spend|usage limit|limit.*reached|guthaben/i.test(fehler.message)) {
        return { art: "pause", grund: `Guthaben oder Ausgabelimit des API-Kontos (400): ${kurz(fehler)}` };
      }
      return { art: "spaeter", grund: `Die API hat die Anfrage abgewiesen (400): ${kurz(fehler)}` };
    }

    // Zu groß oder nicht zu verarbeiten: dieselbe Anfrage bekäme dieselbe
    // Antwort — also gemerkt.
    if (fehler instanceof UnprocessableEntityError || fehler.status === 413) {
      return { art: "nichts", grund: `Die API hat die Anfrage abgewiesen (${fehler.status}): ${kurz(fehler)}` };
    }

    // Ein Status, den hier niemand erwartet: nicht merken. Ein Fehler kostet
    // nichts, und ein falsch gemerktes Blatt käme nie wieder.
    return { art: "spaeter", grund: `Unerwartete Antwort der API (${fehler.status}): ${kurz(fehler)}` };
  }

  // Bricht der Strom unterwegs ab (Verbindung weg), meldet das SDK das als
  // `AnthropicError` ohne Status. Das ist ein Verbindungsfehler und trifft das
  // nächste Blatt genauso — ebenso alles, was hier gar nicht vom SDK kommt.
  if (fehler instanceof AnthropicError) {
    return { art: "pause", grund: `Der Aufruf brach ab: ${kurz(fehler)}` };
  }
  return { art: "pause", grund: `Unerwarteter Fehler beim Aufruf: ${kurz(fehler)}` };
}

/**
 * Eine Antwort, eingeordnet: erst der Grund, warum das Modell aufhörte, dann
 * die Form.
 *
 * Gelesen wird `stop_reason` VOR dem Inhalt. Eine Ablehnung (`refusal`) kommt
 * mit HTTP 200 und womöglich halbem Text; eine abgeschnittene Antwort
 * (`max_tokens`) ist ein halbes JSON, das zufällig sogar gültig sein könnte —
 * eine Abschrift, die mitten im Satz endet, wäre die schlimmste Sorte Fehler,
 * weil sie vollständig aussieht.
 */
export function antwortEinordnen<T>(
  nachricht: BetaMessage,
  schema: z.ZodType<T>,
):
  | { art: "antwort"; antwort: T }
  | { art: "nichts"; grund: string }
  | { art: "spaeter"; grund: string } {
  switch (nachricht.stop_reason) {
    case "end_turn":
    case "stop_sequence":
      break;
    case "refusal": {
      // Ob ein Rückfallmodell es überhaupt versucht hat, steht am Inhalt: je
      // Wechsel ein `fallback`-Block. Ohne ihn gab es für die Kategorie keinen
      // Rückfall — oder das Rückfallmodell war selbst ausgelastet oder an
      // seiner Grenze. Den zweiten Fall sagt die API: dann nennt
      // `stop_details.recommended_model` das Modell, das es versucht hätte
      // (SDK 0.128, BetaRefusalStopDetails). Das liegt nicht am Blatt, sondern
      // an der Stunde, und als „nichts“ gemerkt bekäme das Blatt seinen Rückfall
      // nie — also „später“ (seit der Abnahme vom 11.10.2026).
      const gewechselt = nachricht.content.some((block) => block.type === "fallback");
      const kategorie = nachricht.stop_details?.category ?? "ohne Kategorie";
      const empfohlen = nachricht.stop_details?.recommended_model;
      if (!gewechselt && typeof empfohlen === "string" && empfohlen.trim() !== "") {
        return {
          art: "spaeter",
          grund: `Abgelehnt (${kategorie}); der Rückfall auf ${empfohlen.trim().slice(0, 60)} war gerade ausgelastet. Später noch einmal.`,
        };
      }
      return {
        art: "nichts",
        grund: `Abgelehnt (${kategorie})${
          gewechselt ? ", auch nach dem Rückfall." : "; einen Rückfall gab es nicht."
        }`,
      };
    }
    case "max_tokens":
      return { art: "nichts", grund: "Die Antwort wurde an der Höchstzahl der Tokens abgeschnitten (max_tokens)." };
    default:
      return { art: "nichts", grund: `Das Modell hörte unerwartet auf (${nachricht.stop_reason ?? "ohne Grund"}).` };
  }

  const text = antwortText(nachricht);
  if (text.trim() === "") return { art: "nichts", grund: "Die Antwort war leer." };

  let roh: unknown;
  try {
    // Ohne Nullzeichen, bevor irgendetwas davon weitergeht: Postgres nimmt
    // U+0000 in keinem Text und in keinem jsonb an. Ein „\u0000“ im JSON —
    // aus einem Blatt, das es darauf anlegt, oder einem Ausrutscher — ließe
    // sonst das Speichern scheitern: den Vorschlag, und mit dem Grund sogar
    // den Vermerk des Laufs, und ein Blatt ohne Vermerk wird beim nächsten
    // Anstoß noch einmal bezahlt (Abnahme vom 11.10.2026). Hier, an der einen
    // Stelle, an der Text des Modells hereinkommt, gilt es für jeden Leser.
    roh = ohneNullzeichen(JSON.parse(text));
  } catch {
    return { art: "nichts", grund: "Die Antwort war kein JSON." };
  }

  const geprueft = schema.safeParse(roh, { error: z.locales.de().localeError });
  if (!geprueft.success) {
    const meldung = geprueft.error.issues[0];
    const stelle = meldung?.path.join(".") ?? "";
    return {
      art: "nichts",
      grund: `Die Antwort passt nicht zur verlangten Form${stelle ? ` („${stelle}“)` : ""}: ${meldung?.message ?? "unbekannt"}`,
    };
  }

  return { art: "antwort", antwort: geprueft.data };
}

/**
 * Ein Wert aus `JSON.parse`, in dem kein Text mehr U+0000 enthält — in Texten
 * und in Schlüsseln, wie tief sie auch stecken. Alles andere bleibt, wie es
 * ist: ein Steuerzeichen sonst nimmt Postgres an, und was eine Abschrift sein
 * darf, entscheiden die Regeln und nicht diese Funktion.
 */
export function ohneNullzeichen(wert: unknown): unknown {
  if (typeof wert === "string") return wert.replaceAll("\u0000", "");
  if (Array.isArray(wert)) return wert.map(ohneNullzeichen);
  if (wert !== null && typeof wert === "object") {
    return Object.fromEntries(
      Object.entries(wert).map(([schluessel, inhalt]) => [
        schluessel.replaceAll("\u0000", ""),
        ohneNullzeichen(inhalt),
      ]),
    );
  }
  return wert;
}

/** Der ganze Weg: Ausgang hinein, eines der vier Ergebnisse heraus. */
export function auswerten<T>(
  ausgang: Ausgang,
  schema: z.ZodType<T>,
  angefragt: string,
): ClaudeErgebnis<T> {
  if (ausgang.art === "fehler") {
    return {
      ...fehlerEinordnen(ausgang.fehler, ausgang.fristAbgelaufen, ausgang.begonnen),
      messung: null,
      wandMs: ausgang.wandMs,
    };
  }

  const messung = messungAus(ausgang.nachricht, ausgang.wandMs, angefragt);
  const eingeordnet = antwortEinordnen(ausgang.nachricht, schema);

  if (eingeordnet.art === "antwort") {
    return { art: "antwort", antwort: eingeordnet.antwort, messung, wandMs: ausgang.wandMs };
  }
  // Eine Ablehnung, deren Rückfall ausgelastet war, ist bezahlt — die
  // abgelehnte Antwort hat gelesen — und nicht gemerkt: ein bezahlter Abbruch.
  return {
    art: eingeordnet.art,
    grund: eingeordnet.grund,
    messung,
    abbruch: eingeordnet.art === "spaeter" ? "rueckfall" : null,
    pauseAmBlatt: false,
    wandMs: ausgang.wandMs,
  };
}

/** Sekunden, gerundet — fürs Protokoll. */
function sekunden(ms: number): number {
  return Math.round(ms / 1000);
}

/** US-Dollar mit drei Stellen, deutsch geschrieben: „0,312 $“. */
export function dollar(betrag: number): string {
  return `${betrag.toLocaleString("de-DE", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} $`;
}

/**
 * Die Messung als eine Zeile fürs Protokoll — dieselbe Rolle wie
 * `messungZeile` im Käfig des Postboten, nur mit dem, was bei der API dazukam:
 * wer wirklich geantwortet hat und was es gekostet hat.
 *
 * Der Stoppgrund steht nur dabei, wenn er etwas sagt: „end_turn“ ist der
 * Normalfall. Ein Rückfall steht immer dabei — dann hat nicht Opus 5.5
 * abgeschrieben, und nur Opus 5.5 ist an Handschrift gemessen.
 */
export function messungZeile(messung: Messung): string {
  const tok = (anzahl: number) => anzahl.toLocaleString("de-DE");
  const teile = [
    messung.modell,
    `Eingabe ${tok(messung.eingabe)} Tok`,
    `Ausgabe ${tok(messung.ausgabe)} Tok (davon Denken ${tok(messung.denken)})`,
  ];

  if (messung.cacheGelesen > 0 || messung.cacheGeschrieben > 0) {
    teile.push(
      `Cache gelesen ${tok(messung.cacheGelesen)}, geschrieben ${tok(messung.cacheGeschrieben)}`,
    );
  }
  teile.push(`Wand ${sekunden(messung.wandMs)} s`);
  teile.push(
    messung.kostenUsd === null
      ? `Kosten unbekannt (kein Preis für ${messung.ohnePreis.join(", ")})`
      : dollar(messung.kostenUsd),
  );
  if (messung.rueckfall) {
    teile.push(
      messung.abgelehntVon.length > 0
        ? `Rückfall: ${messung.abgelehntVon.join(" → ")} lehnte ab, ${messung.modell} schrieb`
        : `Rückfall: ${messung.modell} schrieb`,
    );
  }
  if (messung.stopGrund && messung.stopGrund !== "end_turn") {
    teile.push(
      `Stopp: ${messung.stopGrund}${messung.ablehnung ? ` (${messung.ablehnung})` : ""}`,
    );
  }

  return teile.join(", ");
}
