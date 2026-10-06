import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  abschriftenSieben,
  nurVerworfen,
  verwerfGrund,
  verworfenSatz,
  type SeitenStand,
} from "./verwerfen";

/**
 * Die Tür propose_sheet und ein Leser je Seite (Entscheidung 7): was an ihr
 * verworfen wird und wann daraus kein Fehler wird. Die Regel schützt eine
 * Docling-Abschrift und jede schon gelesene Seite davor, beim Übernehmen
 * still ersetzt zu werden — ob der Vorschlag vom Postboten kommt oder aus
 * einem Chat.
 */
describe("verwerfGrund", () => {
  const faelle: [SeitenStand, ReturnType<typeof verwerfGrund>][] = [
    [{ leser: "docling", transcriptLength: 900 }, "docling"],
    // Eine Docling-Seite ohne Abschrift gibt es nach der Zuteilung nicht —
    // käme sie doch, gehört sie trotzdem nicht Claude.
    [{ leser: "docling", transcriptLength: null }, "docling"],
    [{ leser: "offen", transcriptLength: null }, "offen"],
    [{ leser: "offen", transcriptLength: 12 }, "offen"],
    [{ leser: "claude", transcriptLength: 300 }, "gelesen"],
    // Der leere String ist gelesen: „es stand nichts darauf".
    [{ leser: "claude", transcriptLength: 0 }, "gelesen"],
    [{ leser: null, transcriptLength: 40 }, "gelesen"],
    [{ leser: null, transcriptLength: 0 }, "gelesen"],
    // Genau diese beiden darf ein Agent abschreiben.
    [{ leser: "claude", transcriptLength: null }, null],
    [{ leser: null, transcriptLength: null }, null],
  ];

  for (const [seite, erwartet] of faelle) {
    it(`leser ${String(seite.leser)}, Abschrift ${String(seite.transcriptLength)} → ${String(erwartet)}`, () => {
      assert.equal(verwerfGrund(seite), erwartet);
    });
  }
});

describe("abschriftenSieben", () => {
  const seiten = new Map<string, SeitenStand>([
    ["druck", { leser: "docling", transcriptLength: 500 }],
    ["hand", { leser: "claude", transcriptLength: null }],
    ["offen", { leser: "offen", transcriptLength: null }],
    ["alt", { leser: null, transcriptLength: 80 }],
  ]);

  it("lässt nur die Claude-Seite durch und nennt die übrigen mit Grund, in der Reihenfolge des Aufrufs", () => {
    const { bleiben, verworfen } = abschriftenSieben(
      [
        { page: "druck", text: "zweite Lesung" },
        { page: "hand", text: "erfundene Handschrift" },
        { page: "offen", text: "zu früh" },
        { page: "alt", text: "noch einmal" },
      ],
      seiten,
    );

    assert.deepEqual(bleiben, [{ page: "hand", text: "erfundene Handschrift" }]);
    assert.deepEqual(verworfen, [
      { page: "druck", grund: "docling" },
      { page: "offen", grund: "offen" },
      { page: "alt", grund: "gelesen" },
    ]);
  });

  it("übergeht eine Seite, die es am Blatt nicht gibt — die weist der Aufrufer vorher ab", () => {
    const { bleiben, verworfen } = abschriftenSieben([{ page: "fremd", text: "x" }], seiten);
    assert.deepEqual(bleiben, []);
    assert.deepEqual(verworfen, []);
  });
});

describe("nurVerworfen", () => {
  const leer = [{ path: [] }];
  const verworfen = [{ page: "druck", grund: "docling" as const }];

  it("ist wahr, wenn nur die Regel am Ganzen anschlägt und alles verworfen ist", () => {
    // Sonst liefe es als isError auf das Abweisen hinaus, das ein alter
    // Postbote als „kein Vorschlag" merkt — und die Claude-Seiten verlöre.
    assert.equal(nurVerworfen(leer, verworfen, 0), true);
  });

  it("bleibt ein Fehler, wenn daneben ein Feld nicht passt", () => {
    assert.equal(nurVerworfen([...leer, { path: ["capturedOn"] }], verworfen, 0), false);
  });

  it("bleibt ein Fehler, wenn nichts verworfen wurde", () => {
    assert.equal(nurVerworfen(leer, [], 0), false);
  });

  it("bleibt ein Fehler, wenn noch eine Abschrift übrig ist", () => {
    assert.equal(nurVerworfen(leer, verworfen, 1), false);
  });

  it("ist ohne Meldung nie wahr", () => {
    assert.equal(nurVerworfen([], verworfen, 0), false);
  });
});

describe("verworfenSatz", () => {
  it("zählt nach Grund und nennt die ids nicht", () => {
    const satz = verworfenSatz([
      { page: "a", grund: "docling" },
      { page: "b", grund: "docling" },
      { page: "c", grund: "offen" },
      { page: "d", grund: "gelesen" },
    ]);

    assert.equal(
      satz,
      "Verworfen wurden die Abschriften zu 2 Seiten, die die App maschinell gelesen hat (Docling), einer Seite, die die App gerade selbst liest und einer Seite, die schon eine Abschrift hat — die ids stehen unter „verworfen“.",
    );
  });

  it("spricht von einer Abschrift, wenn es eine ist", () => {
    assert.equal(
      verworfenSatz([{ page: "a", grund: "gelesen" }]),
      "Verworfen wurde die Abschrift zu einer Seite, die schon eine Abschrift hat — die ids stehen unter „verworfen“.",
    );
  });
});
