/**
 * Format und Maße eines Fotos — aus den Bytes gelesen, nicht aus der Spalte
 * daneben geglaubt.
 *
 * ── Warum das PDF das selbst tun muss ────────────────────────────────────────
 *
 * **Erstens: pdfkit kann nur JPEG und PNG.** @/lib/images lässt beim Aufnehmen
 * `image/jpeg`, `image/png` UND `image/webp` durch — WebP ist ein gültiges
 * Format für ein Schulblatt und wird auf der Detailseite anstandslos
 * angezeigt. In ein PDF bekommt man es nicht: pdfkit wirft „Unknown image
 * format." (gemessen am 5.9.2026). Ein einziges WebP-Foto unter zweihundert
 * ließe das ganze Fach-PDF scheitern, und mit ihm alle Abschriften — also
 * genau das, wofür das Dokument gemacht ist. Deshalb wird vorher gefragt statt
 * hinterher gefangen.
 *
 * **Zweitens: pdfkit bricht Bilder nicht um.** Ein `doc.image()` zeichnet dort,
 * wo es steht, und läuft über den Seitenrand hinaus, wenn kein Platz mehr ist.
 * Wer entscheiden will, ob ein Foto noch auf die Seite passt, muss seine Höhe
 * VORHER kennen — und die steht im Bildkopf.
 *
 * **Drittens: das Byte entscheidet, nicht die Spalte.** `material_pages`
 * trägt eine `mime_type`-Spalte, und die wird beim Aufnehmen geprüft. Aber
 * gezeichnet werden die Bytes, nicht die Spalte; sagt die Spalte „image/jpeg"
 * und stehen PNG-Bytes darin, ist die Spalte die falsche Auskunft. Der Kopf
 * einer Bilddatei ist ein paar Bytes lang und beantwortet beide Fragen —
 * Format und Maße — in einem Zug.
 *
 * **Viertens: der Kopf ist eine Behauptung, keine Zusage.** Die Maße im IHDR
 * eines PNG sind vier Bytes, die jeder hinschreiben kann, und pdfkit glaubt
 * sie: es legt aus ihnen den Speicher für die Bildpunkte an, BEVOR es die
 * Bilddaten ansieht. Und der Deflate-Strom dahinter kann kaputt sein, obwohl
 * der Kopf heil ist — pdfkit packt ihn asynchron aus und wirft dann an einer
 * Stelle, an der kein try/catch mehr steht. Beides steht unten an seiner
 * Grenze ausführlich; kurz: was diese Datei durchlässt, muss pdfkit auch
 * überleben, sonst ist die Prüfung keine.
 *
 * Reine Rechnung: kein pdfkit, keine Datenbank, kein Next. Gelesen werden die
 * Bildköpfe; nur dort, wo pdfkit die Bilddaten wirklich anfasst, werden sie
 * zusätzlich einmal ausgepackt. Deshalb ist das hier ohne Datenbank zu prüfen.
 */

import { inflateSync } from "node:zlib";

/** Was aus einem Bildkopf herauskommt. */
export type ImageInfo = {
  /** Nur diese beiden Formate kann pdfkit einbetten. */
  readonly format: "jpeg" | "png";
  readonly width: number;
  readonly height: number;
};

/**
 * Liest Format und Maße aus den ersten Bytes.
 *
 * `null` heißt: keins der beiden Formate, die pdfkit einbetten kann — WebP,
 * GIF, HEIC, abgeschnittene Bytes, alles dasselbe Ergebnis. Der Aufrufer
 * schreibt dann einen sichtbaren Hinweis ins Dokument, statt es scheitern zu
 * lassen.
 *
 * Keine Ausnahme für kaputte Eingaben: „das kann ich nicht einbetten" ist die
 * Antwort auf alle diese Fälle, und ein Aufrufer, der sie ohnehin behandeln
 * muss, gewinnt nichts durch drei verschiedene Wege dorthin.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  return readPng(bytes) ?? readJpeg(bytes);
}

/* -------------------------------------------------------------------------
   PNG
   ------------------------------------------------------------------------- */

/** Die acht Bytes, mit denen jede PNG-Datei anfängt. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Signatur (8) + Blocklänge (4) + „IHDR" (4) + 13 Bytes Kopf + Prüfsumme (4).
 *
 * Vorher waren es 24 — genug für Breite und Höhe, aber nicht für Farbtyp,
 * Bittiefe und Verschränkung, und ohne die drei lässt sich nicht sagen, ob
 * pdfkit die Bilddaten anfassen wird.
 */
const PNG_HEADER_BYTES = 33;

/**
 * Wie viele Bildpunkte ein PNG behaupten darf, bevor es gar nicht erst
 * angefasst wird.
 *
 * Der Fehler, gegen den das steht, ist gemessen (5.9.2026, pdfkit 0.20.2):
 * eine PNG-Datei von 68 Bytes — Signatur, ein IHDR mit 8000 × 8000 und Farbtyp
 * 6, ein winziger GÜLTIGER IDAT, IEND — ließ pdfkit 515 MB anlegen. Die
 * Rechnung steht im fremden Code und nimmt ausschließlich die ANGEGEBENEN
 * Maße: png-js legt `new Uint8Array(width * height * pixelBytes)` an (256 MB),
 * pdfkit legt daneben die Bilddaten (192 MB) und den Alphakanal (64 MB). Das
 * Budget in ./subject-pdf kann davor nicht schützen — es bucht
 * `page.bytes.byteLength`, also 68 Bytes, gegen die 40 MB. Und die Tür in
 * material/actions.ts prüft nur die MITGESCHICKTEN Zahlen, die sie mit den
 * Bytes nie vergleicht.
 *
 * 40 Millionen ist die Grenze, weil sie kein ehrliches Blatt trifft: die App
 * speichert nach MAX_EDGE (@/lib/images) nie mehr als 1600 Pixel lange Kante,
 * ein hochkant abfotografiertes A4-Blatt sind also 1200 × 1600 = 1,9
 * Millionen Bildpunkte, und selbst ein Bildschirmfoto in 5K (5120 × 2880)
 * bleibt bei 14,7 Millionen. Die 8000 × 8000 der Probe sind 64 Millionen und
 * damit draußen.
 */
const PNG_MAX_PIXELS = 40_000_000;

/**
 * PNG ist einfach: hinter der Signatur steht als erster Block immer IHDR, und
 * dort stehen Breite und Höhe als 32-Bit-Zahlen. Die Reihenfolge der Blöcke
 * ist im Format vorgeschrieben — IHDR MUSS der erste sein —, es muss also
 * nichts gesucht werden.
 *
 * Was danach kommt, ist keine Kopfrechnung mehr, sondern die Antwort auf zwei
 * gemessene Fehler: die Maße sind nach oben begrenzt (PNG_MAX_PIXELS), und wo
 * pdfkit die Bilddaten wirklich auspackt, werden sie hier einmal probeweise
 * ausgepackt (`imageDataUnpacks`).
 */
function readPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.byteLength < PNG_HEADER_BYTES) return null;

  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }

  // "IHDR" an Position 12 — ohne diese Prüfung läse ein beliebiger erster
  // Block als Maße.
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null;
  }

  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);

  if (width <= 0 || height <= 0) return null;

  // Die Grenze aus PNG_MAX_PIXELS. `width * height` und nicht jede Kante für
  // sich: ein Panorama von 20000 × 400 ist harmlos, 8000 × 8000 ist es nicht,
  // und teuer ist die Fläche und nicht die längere Seite.
  if (width * height > PNG_MAX_PIXELS) return null;

  // Bittiefe (24), Farbtyp (25) und Verschränkung (28) stehen im IHDR hinter
  // den Maßen; ohne sie ließe sich unten nicht sagen, ob pdfkit die Bilddaten
  // überhaupt anfasst. Was das Format nicht kennt, ist kein PNG — png-js käme
  // für einen unbekannten Farbtyp auf `colors = undefined` und legte für die
  // Bildpunkte ein Feld der Länge NaN an, also gar keins.
  const bitDepth = bytes[24] ?? 0;
  const colorType = bytes[25] ?? 0;
  const interlaced = (bytes[28] ?? 0) === 1;
  const channels = pngChannels(colorType);

  if (channels === null) return null;
  if (![1, 2, 4, 8, 16].includes(bitDepth)) return null;

  if (pdfkitUnpacksImageData(bytes, colorType, interlaced)) {
    if (!imageDataUnpacks(bytes, { width, height, bitDepth, channels })) {
      return null;
    }
  }

  return { format: "png", width, height };
}

/**
 * Wie viele Werte je Bildpunkt im Deflate-Strom stehen — nur dafür wird der
 * Farbtyp gebraucht. `null` heißt: kein Farbtyp, den das Format kennt.
 */
function pngChannels(colorType: number): number | null {
  switch (colorType) {
    case 0:
      return 1; // Graustufen
    case 2:
      return 3; // Echtfarbe
    case 3:
      return 1; // Palette, ein Index je Bildpunkt
    case 4:
      return 2; // Graustufen + Alpha
    case 6:
      return 4; // Echtfarbe + Alpha
    default:
      return null;
  }
}

/**
 * Packt pdfkit die Bilddaten dieses PNG aus — oder reicht es sie durch?
 *
 * Das ist die Frage, an der alles hängt, und die Antwort steht in
 * node_modules/pdfkit/js/pdfkit.js (0.20.2, PNGImage.embed, Zeile 4809-4828).
 * Ausgepackt wird in genau drei Fällen: bei Alphakanal (Farbtyp 4 und 6, siehe
 * png-js' `hasAlphaChannel`), bei indizierter Transparenz (Farbtyp 3 mit einem
 * tRNS-Block) und bei verschränkten Bildern (Adam7). In jedem anderen Fall
 * wandert der Deflate-Strom UNANGETASTET in das PDF — ein kaputter Strom
 * kostet dort nichts als ein kaputtes Bild im Betrachter, und dafür lohnt das
 * Auspacken nicht.
 *
 * Ein Bildschirmfoto vom Whiteboard, das @/lib/images ausdrücklich als PNG
 * zulässt, ist fast immer Farbtyp 6 — der teure Fall ist also nicht der
 * seltene. Er ist trotzdem der einzige, in dem sich das Auspacken lohnt.
 */
function pdfkitUnpacksImageData(
  bytes: Uint8Array,
  colorType: number,
  interlaced: boolean,
): boolean {
  if (colorType === 4 || colorType === 6 || interlaced) return true;

  return colorType === 3 && hasChunk(bytes, "tRNS");
}

/**
 * Packt den Deflate-Strom einmal aus und sagt, ob das gelingt.
 *
 * ── Der Fehler, gegen den das steht ──────────────────────────────────────────
 *
 * Gemessen am 5.9.2026 gegen pdfkit 0.20.2: eine PNG-Datei von 63 Bytes, 4 × 4,
 * Farbtyp 6 (RGBA), als IDAT sechs Bytes Müll. Wörtlich herausgekommen ist
 * „doc.image synchron: kein Wurf / UNCAUGHT: incorrect header check / nach 3s
 * -> ended = false". Der Weg: pdfkit geht bei einem Alphakanal in
 * splitAlphaChannel(), das ruft png-js' `decodePixels()`, und das ruft
 * `zlib.inflate` MIT RÜCKRUF (png-js.cjs:174). Der Wurf fällt damit eine
 * Ereignisschleife später — ausserhalb jedes try/catch in ./subject-document,
 * und pdfkit sendet dafür auch kein `error`-Ereignis. Danach endete der
 * Dokumentstrom nie, das Versprechen auf „fertig" löste nie auf, und der Route
 * Handler antwortete auf die Anfrage überhaupt nicht mehr. Eine hängende
 * Anfrage ist schlimmer als ein Fehler: sie hält eine Verbindung, und niemand
 * sieht einen Fehler.
 *
 * Deshalb wird hier vorher gefragt statt hinterher gefangen — fangen geht bei
 * diesem Weg gar nicht.
 *
 * ── Warum mit Obergrenze ─────────────────────────────────────────────────────
 *
 * `maxOutputLength` ist nicht Sparsamkeit, sondern die zweite Hälfte der
 * Prüfung: png-js ruft `inflate` OHNE jede Grenze, ein Deflate-Strom von
 * wenigen Kilobyte kann sich aber auf Gigabytes aufblasen. Die Grenze ist,
 * was ein ehrliches Bild dieser Maße hergibt; alles darüber ist keins.
 */
function imageDataUnpacks(
  bytes: Uint8Array,
  size: { width: number; height: number; bitDepth: number; channels: number },
): boolean {
  const imageData = collectImageData(bytes);
  if (imageData === null) return false;

  // Je Bildzeile ein Filterbyte plus die Bildpunkte. Verschränkte Bilder
  // (Adam7) zerlegen dasselbe Bild in sieben Durchgänge und brauchen dadurch
  // mehr Filterbytes und mehr Aufrundung je Zeile — bis zu vier Bytes je Zeile
  // großzügig mitgerechnet, denn das hier ist eine Obergrenze und kein Maß.
  const scanline = 1 + Math.ceil((size.width * size.channels * size.bitDepth) / 8);
  const maxBytes = (scanline + 4) * size.height + 64;

  try {
    inflateSync(imageData, { maxOutputLength: maxBytes });
    return true;
  } catch {
    // Kaputter Strom (Z_DATA_ERROR), abgeschnittener Strom (Z_BUF_ERROR) und
    // ein Strom, der mehr hergibt als das Bild groß sein kann
    // (ERR_BUFFER_TOO_LARGE) — für diese Datei ist das dasselbe Ergebnis.
    return false;
  }
}

/**
 * Hängt die IDAT-Blöcke aneinander; das zusammen ist der Deflate-Strom.
 *
 * `null` heißt: die Blockkette geht nicht auf. Genau das ist auch der Fall
 * eines abgeschnittenen PNG — png-js wirft dafür zwar synchron („Incomplete or
 * corrupt PNG file") und wäre zu fangen, aber ein Ergebnis für beide Fälle ist
 * eins weniger, das der Aufrufer auseinanderhalten muss.
 *
 * Mehrere IDAT-Blöcke sind der Normalfall und keine Ausnahme: Kodierer
 * zerlegen den Strom in Stücke fester Größe.
 */
function collectImageData(bytes: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let at = 8; // hinter der Signatur

  while (at + 12 <= bytes.byteLength) {
    const length = readUint32(bytes, at);
    const start = at + 8;

    // Der Block muss samt seiner Prüfsumme wirklich dastehen. Ohne diese
    // Zeile läse eine erfundene Blocklänge über das Ende der Datei hinaus.
    if (start + length + 4 > bytes.byteLength) return null;

    if (isChunkType(bytes, at + 4, "IDAT")) {
      parts.push(bytes.subarray(start, start + length));
    } else if (isChunkType(bytes, at + 4, "IEND")) {
      // Ein PNG ohne einen einzigen IDAT-Block hat keine Bilddaten und ist
      // keins.
      if (parts.length === 0) return null;

      return parts.length === 1 ? parts[0] : concat(parts);
    }

    at = start + length + 4;
  }

  // Kein IEND: die Datei hört mitten in der Kette auf.
  return null;
}

/** Steht irgendwo in der Blockkette ein Block dieses Typs? */
function hasChunk(bytes: Uint8Array, type: string): boolean {
  let at = 8;

  while (at + 12 <= bytes.byteLength) {
    const length = readUint32(bytes, at);
    const start = at + 8;

    if (start + length + 4 > bytes.byteLength) return false;
    if (isChunkType(bytes, at + 4, type)) return true;
    if (isChunkType(bytes, at + 4, "IEND")) return false;

    at = start + length + 4;
  }

  return false;
}

/** Die vier Bytes ab `at` als Blocktyp gelesen. */
function isChunkType(bytes: Uint8Array, at: number, type: string): boolean {
  for (let i = 0; i < 4; i++) {
    if (bytes[at + i] !== type.charCodeAt(i)) return false;
  }

  return true;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }

  return out;
}

/* -------------------------------------------------------------------------
   JPEG
   ------------------------------------------------------------------------- */

/**
 * JPEG ist eine Kette von Segmenten, und die Maße stehen in einem davon.
 *
 * Jedes Segment beginnt mit 0xFF und einer Kennung. Die meisten tragen danach
 * ihre Länge als 16-Bit-Zahl (die Länge zählt sich selbst mit, deshalb unten
 * `2 + length` und nicht `4 + length`). Ein paar Kennungen stehen für sich
 * allein und haben gar keine Länge — die müssen übersprungen werden, sonst
 * läse die Schleife zwei beliebige Bytes als Segmentlänge und liefe aus dem
 * Takt.
 *
 * Die Maße stehen in einem SOF-Segment („Start of Frame", 0xC0–0xCF). Drei
 * Kennungen aus diesem Bereich sind aber KEIN SOF und tragen ganz anderes:
 * 0xC4 (Huffman-Tabellen), 0xC8 (reserviert) und 0xCC (arithmetische
 * Tabellen). Wer sie mitnimmt, liest die Tabellengröße als Bildhöhe.
 *
 * Progressive JPEGs (SOF2) werden hier nicht ausgesondert. Unsere Fotos
 * entstehen im Browser mit `canvas.toBlob()` (siehe @/lib/images), und das
 * schreibt Baseline-JPEG; ein progressives käme nur durch eine von Hand
 * gebaute Anfrage herein und würde in den allermeisten Betrachtern trotzdem
 * angezeigt. Eine Prüfung dafür wäre Code für einen Fall, den es nicht gibt.
 */
function readJpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let at = 2;

  while (at + 1 < bytes.byteLength) {
    if (bytes[at] !== 0xff) return null;

    const marker = bytes[at + 1] ?? 0;

    // Füllbytes: zwischen zwei Segmenten dürfen beliebig viele 0xFF stehen.
    if (marker === 0xff) {
      at += 1;
      continue;
    }

    // Ohne eigene Länge: SOI (D8), TEM (01) und die acht Neustartmarken
    // (D0–D7).
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }

    // EOI (D9) und SOS (DA): danach kommen die Bilddaten selbst. Wer bis
    // hierher kein SOF gefunden hat, findet auch keins mehr.
    if (marker === 0xd9 || marker === 0xda) return null;

    if (at + 4 > bytes.byteLength) return null;

    const length = readUint16(bytes, at + 2);
    if (length < 2) return null;

    const istSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (istSof) {
      // Aufbau eines SOF: Länge (2), Genauigkeit (1), Höhe (2), Breite (2).
      if (at + 9 > bytes.byteLength) return null;

      const height = readUint16(bytes, at + 5);
      const width = readUint16(bytes, at + 7);

      if (width <= 0 || height <= 0) return null;

      return { format: "jpeg", width, height };
    }

    at += 2 + length;
  }

  return null;
}

/* -------------------------------------------------------------------------
   Zahlen aus Bytes

   Von Hand und nicht über einen DataView: der müsste für jeden Aufruf neu
   gebaut werden oder als Zustand mitgeschleppt, und es geht um vier Bytes.
   ------------------------------------------------------------------------- */

function readUint16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function readUint32(bytes: Uint8Array, at: number): number {
  // `* 2 ** 24` statt `<< 24`: der Verschiebeoperator rechnet in JavaScript mit
  // vorzeichenbehafteten 32 Bit, und ein Bild breiter als 8388607 Pixel käme
  // als negative Zahl heraus. Kommt nie vor, kostet nichts.
  return (
    (bytes[at] ?? 0) * 2 ** 24 +
    ((bytes[at + 1] ?? 0) << 16) +
    ((bytes[at + 2] ?? 0) << 8) +
    (bytes[at + 3] ?? 0)
  );
}
