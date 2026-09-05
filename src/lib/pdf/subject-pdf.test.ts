import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDF_IMAGE_BYTES, PDF_SHEET_LIMIT, imageLoader } from "@/lib/pdf/subject-pdf";

/**
 * Geprüft wird hier das Budget für Fotos — die eine Stelle im Fach-PDF, an der
 * Speicher verwaltet wird.
 *
 * Ohne Datenbank, weil `imageLoader()` den Leser als Argument bekommt und nicht
 * importiert. Was eine Datenbank braucht — `collectSheets()` und
 * `renderSubjectPdf()` —, steht hier nicht; das sind Runden über einen Cursor
 * und eine Besitzprüfung, und beide sind gegen eine echte Datenbank zu prüfen,
 * nicht gegen eine Attrappe.
 */

/** Ein Leser, der jedes Foto in derselben Größe liefert und mitzählt. */
function leser(bytesJeFoto: number) {
  const gefragt: string[] = [];

  return {
    gefragt,
    read: async (pageId: string) => {
      gefragt.push(pageId);
      return { bytes: new Uint8Array(bytesJeFoto) };
    },
  };
}

describe("imageLoader — das Budget", () => {
  it("gibt die Bytes heraus, solange Platz ist", async () => {
    const { read } = leser(1000);
    const laden = imageLoader(read, 10_000);

    const bild = await laden("p1");

    assert.equal(bild.kind, "bytes");
    assert.equal(bild.kind === "bytes" ? bild.bytes.byteLength : 0, 1000);
  });

  it("hört auf zu holen, sobald die Grenze erreicht ist", async () => {
    // Der eigentliche Zweck: nicht bloß „gibt nichts mehr heraus", sondern
    // FRAGT die Datenbank gar nicht mehr. Würde weiter geholt und nur
    // weggeworfen, läge das Foto trotzdem im Speicher — und genau davor soll
    // die Grenze schützen.
    const { gefragt, read } = leser(400);
    const laden = imageLoader(read, 1000);

    assert.equal((await laden("p1")).kind, "bytes"); // 400
    assert.equal((await laden("p2")).kind, "bytes"); // 800
    assert.equal((await laden("p3")).kind, "bytes"); // 1200 — noch erlaubt
    assert.equal((await laden("p4")).kind, "budget");
    assert.equal((await laden("p5")).kind, "budget");

    assert.deepEqual(gefragt, ["p1", "p2", "p3"]);
  });

  it("lässt ein einzelnes Foto über die Grenze — und mehr nicht", async () => {
    // Geprüft wird VOR dem Holen, weil erst die Bytes selbst verraten, wie groß
    // ein Foto ist. Der Höchststand ist damit die Grenze plus EIN Foto, und das
    // ist die ehrliche Rechnung: bei 40 MB Grenze und höchstens 3 MB je Seite
    // sind das 43 MB.
    const { gefragt, read } = leser(5000);
    const laden = imageLoader(read, 1000);

    assert.equal((await laden("p1")).kind, "bytes");
    assert.equal((await laden("p2")).kind, "budget");

    assert.deepEqual(gefragt, ["p1"]);
  });

  it("zählt auch ein Foto, das sich hinterher nicht einbetten lässt", async () => {
    // Ein WebP kommt durch diese Tür wie jedes andere Foto; dass das Dokument
    // es später nicht einbetten kann, ändert nichts daran, dass seine Bytes im
    // Speicher lagen. Hier wird der Speicher gezählt, nicht das Ergebnis.
    //
    // Die Zahlen sind so gewählt, dass es auffiele: das erste Foto verbraucht
    // mit 600 Bytes das Budget von 500. Zählte es nicht mit, käme das zweite
    // noch durch.
    const { gefragt, read } = leser(600);
    const laden = imageLoader(read, 500);

    assert.equal((await laden("webp")).kind, "bytes");
    assert.equal((await laden("p2")).kind, "budget");

    assert.deepEqual(gefragt, ["webp"]);
  });

  it("meldet ein verschwundenes Blatt, ohne Budget zu verbrauchen", async () => {
    // Zwischen der Abfrage der Abschriften und dem Holen der Fotos kann ein
    // Blatt gelöscht worden sein. Das darf weder das Dokument kosten noch das
    // Budget.
    let aufrufe = 0;

    const laden = imageLoader(async () => {
      aufrufe += 1;
      return null;
    }, 1000);

    assert.equal((await laden("p1")).kind, "gone");
    assert.equal((await laden("p2")).kind, "gone");
    assert.equal((await laden("p3")).kind, "gone");

    assert.equal(aufrufe, 3);
  });

  it("nimmt ohne Angabe die Grenze des Projekts", async () => {
    const { read } = leser(1);

    assert.equal((await imageLoader(read)("p1")).kind, "bytes");
  });
});

describe("die Grenzen selbst", () => {
  it("bleiben in der Größenordnung, für die sie gerechnet wurden", () => {
    // Keine Prüfung der Zahl um ihrer selbst willen — eine Wachsamkeit gegen
    // ein versehentliches Verschieben um eine Zehnerpotenz. 40 MB sind bei
    // rund 250 KB je Foto etwa 160 Fotos; 400 MB wären ein Container, der
    // beim ersten PDF stirbt.
    assert.ok(PDF_IMAGE_BYTES >= 10_000_000 && PDF_IMAGE_BYTES <= 80_000_000);
    assert.ok(PDF_SHEET_LIMIT >= 50 && PDF_SHEET_LIMIT <= 400);
  });

  it("ist ein Vielfaches der Rundengröße des Exports", () => {
    // `TRANSCRIPT_EXPORT_LIMIT` ist 50. Ein Vielfaches davon heißt, dass keine
    // halbe Runde geholt und weggeworfen wird — und dass `atLimit` genau dann
    // gesetzt ist, wenn die letzte Runde voll war.
    assert.equal(PDF_SHEET_LIMIT % 50, 0);
  });
});
