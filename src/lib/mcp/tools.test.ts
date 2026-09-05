import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_PAGES } from "@/lib/images";
import { PROPOSAL_TRANSCRIPT_MAX } from "@/lib/inbox";
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

describe("die Abschrift an propose_sheet", () => {
  const seite = (page: string, text: string) => ({ page, text });

  it("nimmt zu jeder Seite einen Text an — und die leere Seite als leeren Text", () => {
    const result = TOOLS.propose_sheet.args.safeParse({
      sheet: "blatt",
      transcripts: [
        seite("eins", "Kettenregel: äußere mal innere Ableitung"),
        seite("zwei", ""),
      ],
    });

    assert.equal(result.success, true);
    // Der leere Text muss leer ANKOMMEN. Er heißt „gelesen, und es stand nichts
    // darauf" und ist damit etwas anderes als ein fehlender Eintrag, der „diese
    // Seite hat noch niemand gelesen" heißt. Fielen die beiden schon hier
    // zusammen, wäre der Unterschied an der Tür verloren — und die Spalte in
    // der Datenbank dürfte auch gleich NOT NULL sein.
    assert.equal(result.success && result.data.transcripts?.[1]?.text, "");
  });

  it("liest eine Seite aus lauter Leerraum als gelesen und leer", () => {
    const result = TOOLS.propose_sheet.args.safeParse({
      sheet: "blatt",
      transcripts: [seite("eins", "   \n  ")],
    });

    assert.equal(result.success && result.data.transcripts?.[0]?.text, "");
  });

  it("lässt die Leerzeilen INNERHALB einer Seite stehen — sie sind ihre Gliederung", () => {
    const seitentext = "Aufgabe 1\n\n  a) 3x²\n\n  b) 5x";
    const result = TOOLS.propose_sheet.args.safeParse({
      sheet: "blatt",
      transcripts: [seite("eins", `\n${seitentext}\n`)],
    });

    assert.equal(result.success && result.data.transcripts?.[0]?.text, seitentext);
  });

  it("weist zwei Abschriften an derselben Seite ab", () => {
    // @/lib/inbox faltet sie sonst still zusammen (der erste gilt), damit der
    // zusammengesetzte Primärschlüssel von `material_proposal_transcripts`
    // nicht als englischer Postgres-Fehler zurückkommt. „Still" hieße: die
    // zweite Abschrift ist weg, ohne dass jemand es sagt. An der Tür wird sie
    // deshalb abgewiesen.
    const result = TOOLS.propose_sheet.args.safeParse({
      sheet: "blatt",
      transcripts: [seite("eins", "oben"), seite("eins", "unten")],
    });

    assert.equal(result.success, false);
    assert.deepEqual(result.success ? [] : result.error.issues[0]?.path, [
      "transcripts",
    ]);
  });

  it("hält die Grenze je Seite ein — und zwar genau die aus dem Eingangskorb", () => {
    const gerade = "x".repeat(PROPOSAL_TRANSCRIPT_MAX);

    assert.equal(
      TOOLS.propose_sheet.args.safeParse({
        sheet: "blatt",
        transcripts: [seite("eins", gerade)],
      }).success,
      true,
    );
    assert.equal(
      TOOLS.propose_sheet.args.safeParse({
        sheet: "blatt",
        transcripts: [seite("eins", `${gerade}x`)],
      }).success,
      false,
    );
  });

  it("nimmt nicht mehr Abschriften an, als ein Blatt Seiten hat", () => {
    const viele = (anzahl: number) =>
      Array.from({ length: anzahl }, (_, index) => seite(`seite-${index}`, "Text"));

    assert.equal(
      TOOLS.propose_sheet.args.safeParse({
        sheet: "blatt",
        transcripts: viele(MAX_PAGES),
      }).success,
      true,
    );
    assert.equal(
      TOOLS.propose_sheet.args.safeParse({
        sheet: "blatt",
        transcripts: viele(MAX_PAGES + 1),
      }).success,
      false,
    );
  });

  it("verlangt zu jeder Abschrift beide Felder und duldet kein drittes", () => {
    assert.equal(
      TOOLS.propose_sheet.args.safeParse({
        sheet: "blatt",
        transcripts: [{ page: "eins" }],
      }).success,
      false,
    );
    assert.equal(
      TOOLS.propose_sheet.args.safeParse({
        sheet: "blatt",
        transcripts: [{ text: "Text" }],
      }).success,
      false,
    );
    assert.equal(
      TOOLS.propose_sheet.args.safeParse({
        sheet: "blatt",
        transcripts: [{ page: "eins", text: "Text", seite: 1 }],
      }).success,
      false,
    );
  });

  it("bleibt ohne Abschrift der Vorschlag, der es vorher war", () => {
    assert.equal(TOOLS.propose_sheet.args.safeParse({ sheet: "blatt" }).success, true);
  });

  it("verspricht nicht mehr Abschrift, als in ein Werkzeugergebnis passt", () => {
    // Die Rechnung aus der Beschreibung, als Test. Ein Werkzeugergebnis endet
    // in der Claude-App bei rund 150 000 Zeichen; zwölf Seiten mal 8 000 sind
    // 96 000 und lassen Luft für den Satz davor, die Feldnamen und den
    // JSON-RPC-Umschlag. Wer eine der beiden Zahlen anhebt, liest hier, was er
    // damit verspricht — und nicht erst an einer Antwort, die niemand mehr
    // annimmt.
    assert.equal(MAX_PAGES * PROPOSAL_TRANSCRIPT_MAX + 10_000 < 150_000, true);
  });

  it("zeigt dem Modell im Verzeichnis beide Felder als Pflicht", () => {
    // Die Eindeutigkeit der Seiten steht als `refine` im Schema und fällt bei
    // der Umwandlung nach JSON-Schema still weg — deshalb steht sie zusätzlich
    // im letzten Satz der Beschreibung. Was NICHT wegfallen darf, ist die
    // Struktur: ohne `text` in `required` hielte ein Modell die leere Seite für
    // eine, die man weglässt.
    const proposal = toolList().find((tool) => tool.name === "propose_sheet");
    const schema = proposal?.inputSchema as {
      properties: {
        transcripts: { maxItems: number; items: Record<string, unknown> };
      };
    };
    const eintrag = schema.properties.transcripts.items;

    assert.deepEqual(eintrag.required, ["page", "text"]);
    assert.equal(eintrag.additionalProperties, false);
    assert.equal(schema.properties.transcripts.maxItems, MAX_PAGES);
  });

  it("sagt dem Modell in der Beschreibung, WIE abgeschrieben wird", () => {
    // Diese Beschreibung ist kein Kommentar, sondern die Anweisung: sie ist das
    // Einzige, was steuert, wie eine Abschrift entsteht. Ein Modell an der
    // Claude-App sieht harness/auftrag.mts nie, für den Menschen dort ist das
    // hier der ganze Text. Wer sie kürzt, nimmt Regeln weg, die kein anderer
    // Test vermisst — deshalb steht jede der fünf hier einzeln.
    const transcripts = (
      TOOLS.propose_sheet.args as unknown as {
        shape: { transcripts: { description?: string } };
      }
    ).shape.transcripts;
    const text = transcripts.description ?? "";

    // wörtlich statt zusammengefasst
    assert.match(text, /nicht zusammenfassen/i);
    // die Schreibweise des Schülers bleibt stehen, auch die falsche
    assert.match(text, /korrigierst nicht/i);
    // Unsicheres in ⟨spitzen Klammern⟩ — und niemals raten
    assert.match(text, /⟨spitze Klammern⟩/);
    assert.match(text, /Rate NIE/);
    // die leere Seite wird nicht weggelassen
    assert.match(text, /LEEREN Text/);
    // woher die id einer Seite kommt
    assert.match(text, /read_sheet/);
  });
});

describe("read_transcript", () => {
  it("verlangt genau ein Blatt", () => {
    assert.equal(TOOLS.read_transcript.args.safeParse({}).success, false);
    assert.equal(TOOLS.read_transcript.args.safeParse({ sheet: "" }).success, false);
    assert.equal(TOOLS.read_transcript.args.safeParse({ sheet: "blatt" }).success, true);
    // Eine Seite ist kein Blatt; wer beides schickt, meint vermutlich das
    // falsche von beiden.
    assert.equal(
      TOOLS.read_transcript.args.safeParse({ sheet: "blatt", page: "eins" }).success,
      false,
    );
  });

  it("liest nur — sonst fragte die App vor jedem Blick in eine Abschrift", () => {
    assert.equal(TOOLS.read_transcript.readOnly, true);
  });

  it("wird von read_sheet aus gefunden — sonst kennt niemand den Weg zum Wortlaut", () => {
    // read_sheet nennt je Seite nur die Länge. Ohne diesen Verweis läse ein
    // Modell die Zahl und wüsste nicht, wie es an den Text kommt.
    assert.match(TOOLS.read_sheet.description, /read_transcript/);
  });
});
