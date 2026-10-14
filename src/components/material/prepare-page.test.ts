import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nichtLesbar } from "./prepare-page";

/** Ein Bild, das der Browser nicht öffnet: der Rat passt zum Format. */
describe("Hochladen: Bild nicht lesbar", () => {
  it("ein beschädigtes JPEG bekommt nicht den Rat, es als JPEG zu speichern", () => {
    const m = nichtLesbar(new File([new Uint8Array([1, 2, 3])], "blatt.jpg", { type: "image/jpeg" }));
    assert.equal(m, "Die Datei ist beschädigt. Lad sie neu herunter oder fotografier das Blatt.");
    assert.doesNotMatch(m, /als JPEG/);
  });
  it("auch ohne Typ, nur an der Endung", () => {
    assert.match(nichtLesbar(new File([], "blatt.JPG")), /beschädigt/);
  });
  it("HEIC: als JPEG speichern", () => {
    assert.match(nichtLesbar(new File([], "IMG_1.heic", { type: "image/heic" })), /\(HEIC\)\. Speicher es als JPEG/);
  });
});
