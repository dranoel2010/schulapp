import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { looksLikeId, matchSubject, matchTopic } from "@/lib/mcp/resolve";

/**
 * „Mathe" ist ein Fach — und „Deutsch" könnte zwei sein.
 *
 * Der teuerste Fehler hier ist nicht, nichts zu finden, sondern das Falsche zu
 * finden: ein Vorschlag landete dann am richtigen Blatt mit dem falschen Fach,
 * und beim Übernehmen fielen die Themen weg, weil die App einen Fachwechsel
 * sieht. Deshalb prüft diese Datei vor allem die Fälle, in denen die Antwort
 * „das ist nicht eindeutig" lauten muss.
 */

const MATHE = "3f7c1a2e-8b4d-4c9a-9e51-0d6f2a7b1c34";
const PHYSIK = "9a1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d";

const FAECHER = [
  { id: MATHE, name: "Mathematik", short: "Ma" },
  { id: PHYSIK, name: "Physik", short: "Ph" },
  { id: "11111111-1111-4111-8111-111111111111", name: "Deutsch", short: "De" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Englisch", short: "En" },
];

describe("looksLikeId", () => {
  it("erkennt eine id", () => {
    assert.equal(looksLikeId(MATHE), true);
    assert.equal(looksLikeId(` ${MATHE} `), true);
  });

  it("hält einen Namen nicht für eine id", () => {
    assert.equal(looksLikeId("Mathematik"), false);
    assert.equal(looksLikeId("Ma"), false);
    assert.equal(looksLikeId(""), false);
  });
});

describe("matchSubject", () => {
  it("findet über die id", () => {
    const match = matchSubject(FAECHER, MATHE);

    assert.equal(match.art, "eins");
    if (match.art !== "eins") return;
    assert.equal(match.treffer.name, "Mathematik");
  });

  it("sagt bei einer id, die ins Leere zeigt, nichts — und rät nicht am Namen weiter", () => {
    assert.equal(matchSubject(FAECHER, "44444444-4444-4444-8444-444444444444").art, "keins");
  });

  it("findet über den vollen Namen, egal wie geschrieben", () => {
    for (const query of ["Mathematik", "mathematik", "  MATHEMATIK  "]) {
      const match = matchSubject(FAECHER, query);
      assert.equal(match.art, "eins");
      if (match.art !== "eins") continue;
      assert.equal(match.treffer.id, MATHE);
    }
  });

  it("findet über das Kürzel", () => {
    const match = matchSubject(FAECHER, "Ph");

    assert.equal(match.art, "eins");
    if (match.art !== "eins") return;
    assert.equal(match.treffer.id, PHYSIK);
  });

  it("findet „Mathe“ — den Anfang eines Namens", () => {
    const match = matchSubject(FAECHER, "Mathe");

    assert.equal(match.art, "eins");
    if (match.art !== "eins") return;
    assert.equal(match.treffer.id, MATHE);
  });

  it("meldet Mehrdeutigkeit, statt eines von zweien zu nehmen", () => {
    const doppelt = [
      { id: "a", name: "Deutsch", short: "De" },
      { id: "b", name: "Deutsch", short: "D2" },
    ];

    const match = matchSubject(doppelt, "Deutsch");

    assert.equal(match.art, "mehrere");
    if (match.art !== "mehrere") return;
    assert.deepEqual(match.namen, ["Deutsch", "Deutsch"]);
  });

  it("bevorzugt den genauen Treffer vor dem Anfang eines anderen Namens", () => {
    const kandidaten = [
      { id: "a", name: "Physik", short: "Ph" },
      { id: "b", name: "Physik-Vertiefung", short: "PhV" },
    ];

    const match = matchSubject(kandidaten, "Physik");

    assert.equal(match.art, "eins");
    if (match.art !== "eins") return;
    assert.equal(match.treffer.id, "a");
  });

  it("findet nichts bei einer leeren Frage", () => {
    assert.equal(matchSubject(FAECHER, "   ").art, "keins");
    assert.equal(matchSubject([], "Mathematik").art, "keins");
  });

  it("findet nichts, was nirgends vorkommt", () => {
    assert.equal(matchSubject(FAECHER, "Werken").art, "keins");
  });
});

describe("matchTopic", () => {
  const THEMEN = [
    { id: "t1", title: "Kettenregel" },
    { id: "t2", title: "Ableitungen" },
    { id: "t3", title: "Integralrechnung" },
  ];

  it("findet über den Titel, unabhängig von Schreibweise und Rand", () => {
    for (const query of ["Kettenregel", "kettenregel", " Kettenregel "]) {
      const match = matchTopic(THEMEN, query);
      assert.equal(match.art, "eins");
      if (match.art !== "eins") continue;
      assert.equal(match.treffer.id, "t1");
    }
  });

  it("findet über einen Teil des Titels", () => {
    const match = matchTopic(THEMEN, "Integral");

    assert.equal(match.art, "eins");
    if (match.art !== "eins") return;
    assert.equal(match.treffer.id, "t3");
  });

  it("meldet Mehrdeutigkeit, wenn ein Stück auf zwei Titel passt", () => {
    const match = matchTopic(
      [
        { id: "a", title: "Ableitungen" },
        { id: "b", title: "Ableitungsregeln" },
      ],
      "Ableitung",
    );

    assert.equal(match.art, "mehrere");
  });

  it("nimmt den genauen Titel, auch wenn ein anderer ihn enthält", () => {
    const match = matchTopic(
      [
        { id: "a", title: "Ableitungen" },
        { id: "b", title: "Ableitungen und Integrale" },
      ],
      "Ableitungen",
    );

    assert.equal(match.art, "eins");
    if (match.art !== "eins") return;
    assert.equal(match.treffer.id, "a");
  });

  it("findet nichts, was es nicht gibt", () => {
    assert.equal(matchTopic(THEMEN, "Vektoren").art, "keins");
  });
});
