import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doclingForm } from "@/lib/docling";

describe("doclingForm", () => {
  const form = doclingForm(new Uint8Array([1, 2, 3]), "image/jpeg");

  it("erzwingt OCR — ein Foto hat keine Textebene", () => {
    assert.equal(form.get("force_ocr"), "true");
    assert.deepEqual(form.getAll("ocr_lang"), ["de", "fr", "en"]);
  });

  it("nennt die Formel-Voreinstellung ausdrücklich", () => {
    // Ohne sie scheitert docling-serve 1.x mit „Preset 'default' not found".
    assert.equal(form.get("do_formula_enrichment"), "true");
    assert.equal(form.get("code_formula_preset"), "codeformulav2");
  });

  it("schickt Bilder nur als Platzhalter zurück", () => {
    assert.equal(form.get("image_export_mode"), "placeholder");
    assert.equal(form.get("to_formats"), "md");
  });

  it("gibt der Datei die Endung ihres Formats", () => {
    const file = doclingForm(new Uint8Array([1]), "image/png").get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "seite.png");
  });
});
