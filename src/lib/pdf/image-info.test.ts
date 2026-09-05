import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32, deflateSync } from "node:zlib";

import { readImageInfo } from "@/lib/pdf/image-info";

/**
 * Geprüft wird gegen von Hand gebaute Bildköpfe.
 *
 * Ein echtes Foto wäre der schlechtere Prüfstein: es beantwortet nur den einen
 * Fall, den es selbst darstellt, und die Fälle, um die es hier geht, sind die
 * krummen — ein Segment ohne Länge, eine Kennung aus dem SOF-Bereich, die
 * keine ist, ein WebP mit RIFF-Kopf. Solche Bytes stellt man hin, statt sie zu
 * suchen.
 *
 * Für PNG reicht der Kopf inzwischen nicht mehr: seit `readPng()` dort, wo
 * pdfkit die Bilddaten auspackt, probeweise mit auspackt, müssen die Proben
 * ganze Dateien sein — mit echtem Deflate-Strom und echter Prüfsumme an jedem
 * Block. `pngFile()` und `pngRgba()` bauen genau die.
 */

/** Ein PNG-Block: Länge, Typ, Inhalt, Prüfsumme. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const inhalt = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const out = Buffer.alloc(inhalt.length + 8);

  out.writeUInt32BE(data.length, 0);
  inhalt.copy(out, 4);
  out.writeUInt32BE(crc32(inhalt) >>> 0, inhalt.length + 4);

  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type PngHead = {
  /** 0 Graustufen, 2 Echtfarbe, 3 Palette, 4 Graustufen+Alpha, 6 RGBA. */
  colorType?: number;
  bitDepth?: number;
  /** 1 heißt Adam7 — der dritte Fall, in dem pdfkit auspackt. */
  interlace?: number;
};

/**
 * Signatur und IHDR — 33 Bytes, und für ein Bild ohne Alphakanal ist das
 * alles, was `readImageInfo()` ansieht.
 */
function png(width: number, height: number, head: PngHead = {}): Uint8Array {
  const ihdr = Buffer.alloc(13);

  ihdr.writeUInt32BE(width >>> 0, 0);
  ihdr.writeUInt32BE(height >>> 0, 4);
  ihdr[8] = head.bitDepth ?? 8;
  ihdr[9] = head.colorType ?? 2;
  ihdr[12] = head.interlace ?? 0;

  return Uint8Array.from(Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr)]));
}

/** Eine ganze PNG-Datei: Kopf, die übergebenen Blöcke, IEND. */
function pngFile(
  width: number,
  height: number,
  head: PngHead,
  blocks: Uint8Array[],
): Uint8Array {
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from(png(width, height, head)),
      ...blocks.map((block) => Buffer.from(block)),
      Buffer.from(chunk("IEND", new Uint8Array(0))),
    ]),
  );
}

/**
 * Ein heiles PNG mit Alphakanal — der Fall, den pdfkit wirklich auspackt und
 * der deshalb durchkommen MUSS.
 */
function pngRgba(width: number, height: number): Uint8Array {
  // Je Bildzeile ein Filterbyte (0 = kein Filter) und dann RGBA je Bildpunkt.
  const zeilen = Buffer.alloc(height * (1 + width * 4));
  let at = 0;

  for (let y = 0; y < height; y++) {
    zeilen[at++] = 0;

    for (let x = 0; x < width; x++) {
      zeilen[at++] = (x * 7) % 256;
      zeilen[at++] = (y * 5) % 256;
      zeilen[at++] = 200;
      zeilen[at++] = 255;
    }
  }

  return pngFile(width, height, { colorType: 6 }, [
    chunk("IDAT", deflateSync(zeilen)),
  ]);
}

/**
 * Ein JPEG mit einer Kette von Segmenten davor.
 *
 * `vorspann` sind vollständige Segmente (Kennung samt Länge und Inhalt), die
 * VOR dem SOF stehen — damit lässt sich prüfen, dass die Schleife sie richtig
 * überspringt.
 */
function jpeg(
  width: number,
  height: number,
  vorspann: number[] = [],
  sofMarker = 0xc0,
): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    ...vorspann,
    0xff,
    sofMarker,
    0x00,
    0x11, // Länge 17
    0x08, // Genauigkeit
    (height >> 8) & 255,
    height & 255,
    (width >> 8) & 255,
    width & 255,
    0x03, // Anzahl Komponenten
    ...new Array(9).fill(0),
  ]);
}

describe("readImageInfo — PNG", () => {
  it("liest die Maße aus dem IHDR", () => {
    assert.deepEqual(readImageInfo(png(1200, 1600)), {
      format: "png",
      width: 1200,
      height: 1600,
    });
  });

  it("weist zurück, was hinter der Signatur kein IHDR hat", () => {
    const bytes = png(10, 10);
    bytes[12] = 0x49;
    bytes[13] = 0x44; // "IDAT" statt "IHDR"

    assert.equal(readImageInfo(bytes), null);
  });

  it("lässt große, aber ehrliche Bilder durch", () => {
    // Die Grenze soll nichts treffen, was wirklich vorkommt: ein Panorama von
    // 100 000 × 1 und ein Bildschirmfoto in 5K (14,7 Millionen Bildpunkte)
    // sind beides Bilder, die jemand hochladen darf.
    assert.equal(readImageInfo(png(100_000, 1))?.width, 100_000);
    assert.equal(readImageInfo(png(5120, 2880))?.width, 5120);
  });

  it("weist ein PNG zurück, das mehr Bildpunkte behauptet, als je eins hat", () => {
    /*
     * Fund 8, nachgemessen am 5.9.2026 gegen pdfkit 0.20.2: GENAU diese Datei
     * — 68 Bytes, IHDR sagt 8000 × 8000, Farbtyp 6, ein winziger GÜLTIGER
     * Deflate-Strom — ließ pdfkit 515 MB anlegen („nach 4s: ended = true |
     * RSS-Zuwachs = 515 MB"). Das Budget in ./subject-pdf buchte dafür 68
     * Bytes, weil es die Bytes der Datei zählt; die Maße im Kopf sind eine
     * Behauptung, und pdfkit glaubt sie.
     */
    const behauptung = pngFile(8000, 8000, { colorType: 6 }, [
      chunk("IDAT", deflateSync(new Uint8Array(16))),
    ]);

    assert.ok(behauptung.byteLength < 100, `${behauptung.byteLength} Bytes`);
    assert.equal(readImageInfo(behauptung), null);

    // Und ein Blatt mit 3 Milliarden Pixeln Kantenlänge erst recht nicht.
    assert.equal(readImageInfo(png(3_000_000_000, 1)), null);
  });

  it("lässt ein heiles PNG mit Alphakanal durch", () => {
    // Der Gegenprobe wegen: ein Bildschirmfoto vom Whiteboard ist fast immer
    // Farbtyp 6, und genau das ist der Fall, den pdfkit auspackt. Würde die
    // neue Prüfung ihn aussondern, wäre das Fach-PDF für Bildschirmfotos
    // stillschweigend kaputt.
    assert.deepEqual(readImageInfo(pngRgba(8, 6)), {
      format: "png",
      width: 8,
      height: 6,
    });
  });

  it("weist ein PNG mit Alphakanal zurück, dessen Bilddaten Müll sind", () => {
    /*
     * Fund 7, nachgemessen am 5.9.2026: GENAU diese Datei — 4 × 4, Farbtyp 6,
     * sechs Bytes Müll als IDAT — kam durch den Bildkopf, `doc.image()` warf
     * NICHT, der Wurf fiel eine Ereignisschleife später aus einem zlib-Rückruf
     * („UNCAUGHT: incorrect header check"), und danach wurde der Dokumentstrom
     * nie fertig („nach 3s -> ended = false"). Der Route Handler antwortete auf
     * die Anfrage überhaupt nicht mehr.
     */
    const kaputt = pngFile(4, 4, { colorType: 6 }, [
      chunk("IDAT", Uint8Array.from([1, 2, 3, 4, 5, 6])),
    ]);

    assert.equal(readImageInfo(kaputt), null);
  });

  it("packt nur aus, wo pdfkit auch auspackt", () => {
    // Dieselben sechs Bytes Müll, aber ohne Alphakanal: diesen Strom reicht
    // pdfkit unangetastet ins PDF durch, es hängt sich daran nicht auf, und
    // ihn hier auszupacken wäre bei jedem echten Foto vergebliche Arbeit.
    // Die Zeile hält also eine Entscheidung fest und nicht bloß ein Verhalten.
    const echtfarbe = pngFile(4, 4, { colorType: 2 }, [
      chunk("IDAT", Uint8Array.from([1, 2, 3, 4, 5, 6])),
    ]);

    assert.equal(readImageInfo(echtfarbe)?.width, 4);
  });

  it("prüft auch verschränkte Bilder ohne Alphakanal", () => {
    // Adam7 ist der dritte Weg, auf dem pdfkit auspackt — an einem kaputten
    // Strom bliebe es hier genauso hängen wie bei Farbtyp 6.
    const kaputt = pngFile(4, 4, { colorType: 2, interlace: 1 }, [
      chunk("IDAT", Uint8Array.from([1, 2, 3])),
    ]);

    assert.equal(readImageInfo(kaputt), null);
  });

  it("prüft ein Palettenbild nur, wenn ein tRNS-Block dabei ist", () => {
    // Der zweite Weg: bei indizierter Transparenz packt pdfkit aus, ohne sie
    // nicht. Beide Dateien tragen denselben Müll als Bilddaten.
    const muell = chunk("IDAT", Uint8Array.from([1, 2, 3, 4]));
    const palette = chunk("PLTE", new Uint8Array(3));

    const ohne = pngFile(4, 4, { colorType: 3 }, [palette, muell]);
    const mit = pngFile(4, 4, { colorType: 3 }, [
      palette,
      chunk("tRNS", Uint8Array.from([0])),
      muell,
    ]);

    assert.equal(readImageInfo(ohne)?.width, 4);
    assert.equal(readImageInfo(mit), null);
  });

  it("weist einen Deflate-Strom zurück, der mehr hergibt als das Bild groß ist", () => {
    // Fünf Megabyte aus wenigen Kilobyte: png-js ruft `inflate` ohne jede
    // Grenze, ein 4 × 4 großes Bild hat aber höchstens ein paar Dutzend Bytes.
    const bombe = pngFile(4, 4, { colorType: 6 }, [
      chunk("IDAT", deflateSync(new Uint8Array(5_000_000))),
    ]);

    assert.ok(bombe.byteLength < 20_000, `${bombe.byteLength} Bytes`);
    assert.equal(readImageInfo(bombe), null);
  });

  it("weist ein PNG zurück, dessen Blockkette abbricht", () => {
    const ganz = pngRgba(8, 6);

    assert.equal(readImageInfo(ganz.slice(0, ganz.byteLength - 6)), null);
  });

  it("verläuft sich nicht in einer erfundenen Blocklänge", () => {
    // Eine Blocklänge mit gesetztem obersten Bit. Läse `readUint32` sie mit
    // `<< 24`, käme eine negative Zahl heraus, die Schleife über die Blöcke
    // liefe rückwärts und dieser Test käme nie zurück.
    const kopf = png(4, 4, { colorType: 6 });
    const bytes = new Uint8Array(kopf.byteLength + 12);

    bytes.set(kopf);
    bytes.set([0x80, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], kopf.byteLength);

    assert.equal(readImageInfo(bytes), null);
  });

  it("weist einen Farbtyp zurück, den das Format nicht kennt", () => {
    // png-js rechnete für einen unbekannten Farbtyp mit `undefined` weiter.
    assert.equal(readImageInfo(png(4, 4, { colorType: 5 })), null);
    assert.equal(readImageInfo(png(4, 4, { bitDepth: 12 })), null);
  });
});

describe("readImageInfo — JPEG", () => {
  it("liest Höhe und Breite aus dem SOF", () => {
    // Höhe steht VOR Breite — ein vertauschtes Paar drehte im PDF jedes Foto
    // ins Querformat, und zwar unauffällig, weil es trotzdem ein Bild bliebe.
    assert.deepEqual(readImageInfo(jpeg(1200, 1600)), {
      format: "jpeg",
      width: 1200,
      height: 1600,
    });
  });

  it("überspringt Segmente vor dem SOF", () => {
    // Ein APP0 (JFIF) und ein Kommentar, wie sie jede Kamera schreibt.
    const app0 = [0xff, 0xe0, 0x00, 0x06, 1, 2, 3, 4];
    const kommentar = [0xff, 0xfe, 0x00, 0x05, 65, 66, 67];

    assert.equal(readImageInfo(jpeg(800, 600, [...app0, ...kommentar]))?.width, 800);
  });

  it("verwechselt eine Huffman-Tabelle nicht mit einem SOF", () => {
    // 0xC4 liegt mitten im SOF-Bereich und ist keins. Wer den Bereich pauschal
    // nimmt, liest die Tabellengröße als Bildhöhe — und das Foto käme im PDF
    // in einer erfundenen Form heraus.
    const dht = [0xff, 0xc4, 0x00, 0x06, 1, 2, 3, 4];

    assert.deepEqual(readImageInfo(jpeg(640, 480, dht)), {
      format: "jpeg",
      width: 640,
      height: 480,
    });
  });

  it("kommt an Füllbytes und Neustartmarken vorbei", () => {
    const fuellung = [0xff, 0xff, 0xff, 0xd0];

    assert.equal(readImageInfo(jpeg(320, 240, fuellung))?.height, 240);
  });

  it("nimmt auch ein progressives JPEG (SOF2)", () => {
    // Unsere Fotos sind Baseline, aber ein progressives ist ein gültiges Bild
    // und soll nicht wegen seiner Kennung durchfallen.
    assert.equal(readImageInfo(jpeg(100, 200, [], 0xc2))?.height, 200);
  });

  it("gibt auf, wenn vor dem SOF schon die Bilddaten anfangen", () => {
    const sos = [0xff, 0xda, 0x00, 0x04, 0, 0];

    assert.equal(readImageInfo(jpeg(10, 10, sos)), null);
  });
});

describe("readImageInfo — was pdfkit nicht einbetten kann", () => {
  it("weist WebP zurück", () => {
    // Der Fall aus @/lib/images: `image/webp` ist beim Aufnehmen erlaubt, in
    // ein PDF geht es nicht. „RIFF" … „WEBP".
    const webp = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
      0x38, 0x4c,
    ]);

    assert.equal(readImageInfo(webp), null);
  });

  it("weist GIF zurück", () => {
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);

    assert.equal(readImageInfo(gif), null);
  });

  it("weist abgeschnittene und leere Bytes zurück", () => {
    assert.equal(readImageInfo(new Uint8Array(0)), null);
    assert.equal(readImageInfo(Uint8Array.from([0xff, 0xd8])), null);
    assert.equal(readImageInfo(png(1, 1).slice(0, 20)), null);
  });
});
