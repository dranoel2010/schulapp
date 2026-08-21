import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_MIME,
  JPEG_QUALITY,
  MAX_EDGE,
  MAX_PAGES,
  MAX_PAGE_BYTES,
  MAX_THUMB_BYTES,
  THUMB_EDGE,
  fitWithin,
  formatBytes,
  isAllowedMime,
} from "@/lib/images";

/** Liest sich unten wie die Frage selbst: „passt 4032×3024 in 1600?“ */
function fit(width: number, height: number, max = MAX_EDGE): string {
  const box = fitWithin(width, height, max);
  return `${box.width}×${box.height}`;
}

describe("fitWithin", () => {
  it("legt bei einem Querformat die Breite auf die Kastenkante", () => {
    assert.equal(fit(4032, 3024), "1600×1200");
  });

  it("legt bei einem Hochformat die Höhe auf die Kastenkante", () => {
    assert.equal(fit(3024, 4032), "1200×1600");
  });

  it("macht aus einem Quadrat wieder ein Quadrat", () => {
    assert.equal(fit(2000, 2000), "1600×1600");
  });

  it("lässt ein Bild in Ruhe, das schon kleiner ist", () => {
    assert.equal(fit(800, 600), "800×600");
    assert.equal(fit(600, 800), "600×800");
  });

  it("lässt ein Bild in Ruhe, das genau in den Kasten passt", () => {
    assert.equal(fit(1600, 1200), "1600×1200");
    assert.equal(fit(1200, 1600), "1200×1600");
  });

  it("vergrößert nie — auch nicht einen winzigen Ausschnitt", () => {
    assert.equal(fit(40, 30), "40×30");
    assert.equal(fit(1, 1), "1×1");
  });

  it("rechnet auch für die Vorschau", () => {
    assert.equal(fit(4032, 3024, THUMB_EDGE), "320×240");
  });

  it("gibt immer ganze Pixel zurück", () => {
    const box = fitWithin(3000, 2001, MAX_EDGE);
    assert.equal(box.width, 1600);
    assert.equal(box.height, 1067);
    assert.ok(Number.isInteger(box.width));
    assert.ok(Number.isInteger(box.height));
  });

  it("rundet die kurze Kante kaufmännisch", () => {
    // 1000 × 333 auf die Hälfte: 166,5 Pixel werden 167, nicht 166.
    assert.equal(fit(1000, 333, 500), "500×167");
  });

  it("gibt bei einem extrem schmalen Streifen nie 0 zurück", () => {
    assert.equal(fit(4000, 3), "1600×1");
    assert.equal(fit(4000, 1), "1600×1");
    assert.equal(fit(1, 4000), "1×1600");
  });

  it("behandelt unsinnige Maße wie einen einzelnen Pixel", () => {
    assert.equal(fit(0, 0), "1×1");
    assert.equal(fit(-100, 200), "1×200");
    assert.equal(fit(Number.NaN, 800), "1×800");
    assert.equal(fit(4000, 3000, 0), "1×1");
  });
});

describe("formatBytes", () => {
  it("zeigt unter einem Kilobyte die Bytes selbst", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1), "1 B");
    assert.equal(formatBytes(999), "999 B");
    assert.equal(formatBytes(1023), "1023 B");
  });

  it("wechselt bei 1024 auf Kilobyte", () => {
    assert.equal(formatBytes(1024), "1 KB");
    assert.equal(formatBytes(248 * 1024), "248 KB");
  });

  it("rundet Kilobyte auf ganze Zahlen", () => {
    assert.equal(formatBytes(1536), "2 KB");
    assert.equal(formatBytes(300_000), "293 KB");
  });

  it("schreibt Megabyte mit einer Nachkommastelle und Komma", () => {
    assert.equal(formatBytes(1024 * 1024), "1,0 MB");
    assert.equal(formatBytes(1_500_000), "1,4 MB");
    assert.equal(formatBytes(3_000_000), "2,9 MB");
  });

  it("macht aus unsinnigen Werten kein Negativ", () => {
    assert.equal(formatBytes(-1), "0 B");
    assert.equal(formatBytes(Number.NaN), "0 B");
  });
});

describe("isAllowedMime", () => {
  it("nimmt an, was aus dem Canvas kommt", () => {
    assert.ok(isAllowedMime("image/jpeg"));
    assert.ok(isAllowedMime("image/png"));
    assert.ok(isAllowedMime("image/webp"));
  });

  it("lehnt alles andere ab", () => {
    assert.ok(!isAllowedMime("image/heic"));
    assert.ok(!isAllowedMime("image/gif"));
    assert.ok(!isAllowedMime("application/pdf"));
    assert.ok(!isAllowedMime("IMAGE/JPEG"));
    assert.ok(!isAllowedMime(""));
  });

  it("deckt genau die Liste ab, die daneben steht", () => {
    assert.deepEqual([...ALLOWED_MIME], [
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    assert.ok(ALLOWED_MIME.every((mime) => isAllowedMime(mime)));
  });
});

describe("die Grenzen", () => {
  it("hält die Vorschau deutlich unter dem Vollbild", () => {
    assert.ok(THUMB_EDGE < MAX_EDGE);
    assert.equal(MAX_EDGE, 1600);
    assert.equal(THUMB_EDGE, 320);
  });

  it("bleibt beim Sicherheitsnetz weit über einem verkleinerten Blatt", () => {
    assert.ok(JPEG_QUALITY > 0 && JPEG_QUALITY <= 1);
    assert.ok(MAX_PAGE_BYTES > 1_000_000);
    assert.ok(MAX_PAGES >= 2);
  });

  it("lässt die Vorschau ein Vielfaches ihrer üblichen Größe zu", () => {
    // Eine Vorschau mit 320 Pixel langer Kante wiegt rund 15 KB. Die Grenze
    // ist das Netz und nicht die Erwartung — sie darf ein ehrliches
    // Vorschaubild nie treffen, auch kein besonders dichtes.
    assert.ok(MAX_THUMB_BYTES >= 20 * 15_000);
  });

  it("hält die Vorschau unter dem Vollbild", () => {
    assert.ok(MAX_THUMB_BYTES < MAX_PAGE_BYTES);
  });

  it("hält Vollbild und Vorschau zusammen unter dem bodySizeLimit", () => {
    // 4 MB stehen in next.config.ts, und sie gelten für den ganzen Body samt
    // multipart-Rahmen und Formularfeldern. Wächst eine der beiden Grenzen über
    // diese Rechnung hinaus, stirbt die Anfrage an einer Tür, die dem Nutzer
    // nichts Wahres sagen kann — dann schlägt hier zuerst der Test an.
    // Dezimal gerechnet, weil das die vorsichtigere der beiden Auslegungen von
    // "4mb" ist; binär wäre die Decke noch etwas höher.
    const bodySizeLimit = 4 * 1_000_000;
    const rahmen = 100_000;

    assert.ok(MAX_PAGE_BYTES + MAX_THUMB_BYTES + rahmen < bodySizeLimit);
  });
});
