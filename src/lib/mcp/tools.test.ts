import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isToolName, TOOLS, toolList } from "@/lib/mcp/tools";

/**
 * Das Verzeichnis, so wie ein Client es zu sehen bekommt.
 *
 * Geprüft wird hier nicht, was ein Werkzeug tut — das liest und schreibt und
 * gehört in einen Test mit echter Datenbank. Geprüft wird, was ein Client
 * daraus ableitet, bevor er irgendetwas ruft: welche Argumente erlaubt sind, ob
 * er vor jedem Aufruf nachfragen muss, und dass kein Werkzeug etwas verspricht,
 * was es nach der Regel aus KONZEPT.md gar nicht dürfte.
 */

describe("der Werkzeugkasten", () => {
  it("heißt durchweg read_ oder propose_ — mehr darf der Agent nicht", () => {
    for (const name of Object.keys(TOOLS)) {
      assert.equal(
        name.startsWith("read_") || name.startsWith("propose_"),
        true,
        `${name} passt in keine der beiden erlaubten Gruppen`,
      );
    }
  });

  it("schreibt genau an einer Stelle — dem Eingangskorb", () => {
    const schreibend = Object.entries(TOOLS)
      .filter(([, spec]) => !spec.readOnly)
      .map(([name]) => name);

    assert.deepEqual(schreibend, ["propose_sheet"]);
  });

  it("hält sich an die Namensregeln des Protokolls", () => {
    for (const name of Object.keys(TOOLS)) {
      assert.match(name, /^[A-Za-z0-9_.-]{1,64}$/);
    }
  });

  it("erkennt seine eigenen Namen wieder — und keine fremden", () => {
    for (const name of Object.keys(TOOLS)) {
      assert.equal(isToolName(name), true);
    }

    assert.equal(isToolName("delete_everything"), false);
    // Ein Name aus dem Prototyp von Object darf kein Werkzeug sein.
    assert.equal(isToolName("toString"), false);
    assert.equal(isToolName("constructor"), false);
  });
});

describe("toolList", () => {
  const list = toolList();

  it("liefert jedes Werkzeug genau einmal, in fester Reihenfolge", () => {
    assert.deepEqual(
      list.map((tool) => tool.name),
      Object.keys(TOOLS),
    );
  });

  it("gibt jedem Werkzeug eine Überschrift und einen Satz", () => {
    for (const tool of list) {
      assert.equal(typeof tool.title, "string");
      assert.equal((tool.title as string).length > 0, true);
      assert.equal((tool.description as string).length > 20, true);
    }
  });

  it("beschreibt die Argumente als JSON-Schema mit einem Objekt an der Wurzel", () => {
    for (const tool of list) {
      const schema = tool.inputSchema as Record<string, unknown>;

      assert.equal(schema.type, "object");
      // Was nicht im Schema steht, darf auch nicht mitgeschickt werden — sonst
      // liefe ein vertipptes Argument stumm ins Leere.
      assert.equal(schema.additionalProperties, false);
    }
  });

  it("sagt an jedem Werkzeug, ob es nur liest — daran hängt die Rückfrage der App", () => {
    for (const tool of list) {
      const annotations = tool.annotations as Record<string, unknown>;
      const spec = TOOLS[tool.name as keyof typeof TOOLS];

      assert.equal(annotations.readOnlyHint, spec.readOnly);
      assert.equal(annotations.openWorldHint, false);
    }
  });

  it("nennt den einzigen Schreiber ausdrücklich nicht zerstörend", () => {
    const proposal = list.find((tool) => tool.name === "propose_sheet");
    const annotations = proposal?.annotations as Record<string, unknown>;

    // Ohne diese Zeile gilt die Vorgabe der Spezifikation: „zerstörend".
    assert.equal(annotations.destructiveHint, false);
    assert.equal(annotations.idempotentHint, false);
  });
});

describe("die Argumente der Werkzeuge", () => {
  it("nimmt read_material ohne jedes Argument an — dann ist es die ganze Ablage", () => {
    assert.equal(TOOLS.read_material.args.safeParse({}).success, true);
  });

  it("weist ein Argument ab, das es nicht gibt", () => {
    const result = TOOLS.read_material.args.safeParse({ fach: "Mathe" });
    assert.equal(result.success, false);
  });

  it("hält die Obergrenze der Ablage ein", () => {
    assert.equal(TOOLS.read_material.args.safeParse({ limit: 200 }).success, true);
    assert.equal(TOOLS.read_material.args.safeParse({ limit: 201 }).success, false);
    assert.equal(TOOLS.read_material.args.safeParse({ limit: 0 }).success, false);
    assert.equal(TOOLS.read_material.args.safeParse({ limit: 1.5 }).success, false);
  });

  it("verlangt für ein Blatt eine Angabe und lässt sie nicht leer", () => {
    assert.equal(TOOLS.read_sheet.args.safeParse({}).success, false);
    assert.equal(TOOLS.read_sheet.args.safeParse({ sheet: "" }).success, false);
    assert.equal(TOOLS.read_sheet.args.safeParse({ sheet: "x" }).success, true);
  });

  it("nimmt bei propose_sheet jedes Feld einzeln — nur das Blatt muss dastehen", () => {
    assert.equal(TOOLS.propose_sheet.args.safeParse({}).success, false);
    assert.equal(TOOLS.propose_sheet.args.safeParse({ sheet: "x" }).success, true);
    assert.equal(
      TOOLS.propose_sheet.args.safeParse({ sheet: "x", topics: ["Kettenregel"] }).success,
      true,
    );
  });

  it("weist bei propose_sheet einen zu langen Titel ab, bevor das Formular es täte", () => {
    const zuLang = "x".repeat(200);
    assert.equal(
      TOOLS.propose_sheet.args.safeParse({ sheet: "x", title: zuLang }).success,
      false,
    );
  });

  it("weist mehr Themen ab, als ein Blatt tragen kann", () => {
    const zuViele = Array.from({ length: 100 }, (_, index) => `Thema ${index}`);
    assert.equal(
      TOOLS.propose_sheet.args.safeParse({ sheet: "x", topics: zuViele }).success,
      false,
    );
  });
});
