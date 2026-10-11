import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  stoffAuskunftBauen,
  stoffSeiten,
  vorschlagsFragen,
} from "@/lib/klausur-stoff";
import { MAX_DATA_CHARS, auskunftZeichen } from "@/lib/mcp/auskunft";
import type { KlausurVorrat } from "@/recall/proposals";
import type { KlausurStoff, KlausurThema } from "@/recall/source";

/**
 * Der Stoff einer Klausur, wie ein Modell ihn bekommt — geprüft ohne
 * Datenbank, an der reinen Rechnung (`stoffAuskunftBauen()`).
 *
 * Bis zum 11.10.2026 stand das in read_exam_material (@/lib/mcp/run), und
 * kein Test sah es: geprüft wurde es nur in scripts/probe-abruf-werkzeuge.mts
 * gegen eine Datenbank. Seit der Fragenlauf der App dieselbe Auskunft an Opus
 * gibt, ist jeder Satz darin zweimal wichtig — und der letzte Test hier hält
 * fest, dass es ihn nur einmal gibt.
 */

const SEITE_A = { pageId: "a", sortOrder: 0, transcript: "Kettenregel: äußere mal innere.", maschinell: false };
const SEITE_B = { pageId: "b", sortOrder: 1, transcript: "Produktregel", maschinell: true };

function thema(teil: Partial<KlausurThema>): KlausurThema {
  return {
    examTopicId: "t",
    title: "Thema",
    subjectTopicId: "v",
    verknuepft: true,
    seiten: [],
    ...teil,
  };
}

function stoff(themen: KlausurThema[]): KlausurStoff {
  return {
    examId: "e1",
    klausurtag: "2026-10-20",
    kind: "klausur",
    subjectId: "s1",
    subjectName: "Mathematik",
    subjectColor: "blue",
    themen,
    seitenGesamt: stoffSeiten(themen).map((s) => ({
      pageId: s.id,
      sortOrder: s.sortOrder,
      transcript: s.transcript,
      maschinell: s.maschinell,
    })),
    zeichenGesamt: 0,
  };
}

const LEER: KlausurVorrat = { bausteine: 0, offeneFragen: 0, verworfen: 0 };

function bauen(themen: KlausurThema[], vorrat: KlausurVorrat = LEER, heute = "2026-10-11") {
  return stoffAuskunftBauen({ stoff: stoff(themen), themen, vorrat, heute });
}

describe("stoffSeiten", () => {
  it("nimmt jede Seite nur einmal, auch wenn sie an zwei Themen hängt", () => {
    const seiten = stoffSeiten([
      thema({ examTopicId: "t1", seiten: [SEITE_A, SEITE_B] }),
      thema({ examTopicId: "t2", seiten: [SEITE_B] }),
    ]);
    assert.deepEqual(
      seiten.map((s) => [s.id, s.chars, s.maschinell]),
      [
        ["a", SEITE_A.transcript.length, false],
        ["b", SEITE_B.transcript.length, true],
      ],
    );
  });
});

describe("der Satz", () => {
  it("sagt Fach, Tag, Abstand, Themen, Seiten und Zeichen", () => {
    const { satz } = bauen([thema({ seiten: [SEITE_A] })]);
    assert.match(satz, /^Mathematik am .+ \(in 9 Tagen\): ein Thema, eine abgeschriebene Seite mit \d+ Zeichen\./);
  });

  it("sagt nichts über den Abstand, wenn die Klausur geschrieben ist", () => {
    const { satz } = bauen([thema({ seiten: [SEITE_A] })], LEER, "2026-10-25");
    assert.doesNotMatch(satz, /\(in /);
  });

  it("nennt Themen ohne Blatt und Themen ohne abgeschriebenes Blatt getrennt", () => {
    const { satz } = bauen([
      thema({ examTopicId: "t1", verknuepft: false, subjectTopicId: null }),
      thema({ examTopicId: "t2" }),
      thema({ examTopicId: "t3", seiten: [SEITE_A] }),
    ]);
    assert.match(satz, / 1 Thema hängt an keinem Blatt\./);
    assert.match(satz, / Zu 1 Thema führt kein abgeschriebenes Blatt/);
  });

  it("sagt bei null Seiten, dass keine Frage gestellt werden kann", () => {
    const { satz } = bauen([thema({})]);
    assert.match(satz, /Ohne abgeschriebene Seite lässt sich keine Frage stellen/);
  });

  it("warnt vor maschinell gelesenen Seiten", () => {
    const { satz } = bauen([thema({ seiten: [SEITE_A, SEITE_B] })]);
    assert.match(satz, /Eine Seite hat die App maschinell gelesen \(Docling, „maschinell: true“\)/);
  });

  it("nennt, was zu dieser Klausur schon da ist", () => {
    const { satz } = bauen([thema({ seiten: [SEITE_A] })], {
      bausteine: 3,
      offeneFragen: 1,
      verworfen: 2,
    });
    assert.match(satz, /schon 1 unentschiedene Frage zu dieser Klausur/);
    assert.match(satz, / 3 Bausteine sind aus diesem Stoff bereits gebaut\./);
    assert.match(satz, / 2 Fragen wollte der Mensch zu dieser Klausur nicht/);
  });
});

describe("die Daten", () => {
  it("tragen die Felder, die read_exam_material immer trug", () => {
    const { daten } = bauen(
      [
        thema({ examTopicId: "t1", title: "Ableitung", subjectTopicId: "v1", seiten: [SEITE_A, SEITE_B] }),
        thema({ examTopicId: "t2", title: "Frei", subjectTopicId: null, verknuepft: false }),
      ],
      { bausteine: 4, offeneFragen: 0, verworfen: 1 },
    );

    assert.deepEqual(Object.keys(daten), [
      "exam",
      "subject",
      "subjectId",
      "kind",
      "date",
      "today",
      "topics",
      "pages",
      "stock",
    ]);
    assert.deepEqual(daten.topics, [
      { id: "t1", title: "Ableitung", subjectTopicId: "v1", linked: true, pages: ["a", "b"] },
      { id: "t2", title: "Frei", subjectTopicId: null, linked: false, pages: [] },
    ]);
    assert.deepEqual(daten.pages.map((s) => Object.keys(s)), [
      ["id", "sortOrder", "chars", "transcript", "maschinell"],
      ["id", "sortOrder", "chars", "transcript", "maschinell"],
    ]);
    assert.deepEqual(daten.stock, { items: 4, openQuestions: 0, discardedQuestions: 1 });
    assert.equal(daten.today, "2026-10-11");
  });
});

describe("die Grenze", () => {
  it("zählt wie ein Werkzeugergebnis: Satz, Zeilenumbruch, JSON", () => {
    const auskunft = bauen([thema({ seiten: [SEITE_A] })]);
    assert.equal(auskunft.zeichen, auskunftZeichen(auskunft.satz, auskunft.daten));
    assert.equal(
      auskunft.zeichen,
      `${auskunft.satz}\n${JSON.stringify(auskunft.daten)}`.length,
    );
    assert.equal(auskunft.zuGross, false);
  });

  it("ist zu groß, sobald die Auskunft über MAX_DATA_CHARS liegt", () => {
    const riesig = { ...SEITE_A, transcript: "x".repeat(MAX_DATA_CHARS) };
    assert.equal(bauen([thema({ seiten: [riesig] })]).zuGross, true);
  });
});

describe("vorschlagsFragen", () => {
  it("übersetzt die Felder von propose_questions in die des Abrufkerns", () => {
    assert.deepEqual(
      vorschlagsFragen([
        {
          page: "p",
          question: "Was ist das?",
          solution: "Das.",
          misconception: "Nicht jenes.",
          quote: "Ein Zitat, lang genug.",
        },
        {
          page: "q",
          topic: "v",
          question: "Und das?",
          solution: "Dies.",
          misconception: "Nicht das.",
          quote: "Noch ein Zitat, lang genug.",
          kind: "verfahren",
        },
      ]),
      [
        {
          pageId: "p",
          subjectTopicId: null,
          promptFree: "Was ist das?",
          solution: "Das.",
          misconception: "Nicht jenes.",
          sourceQuote: "Ein Zitat, lang genug.",
          materialKind: undefined,
        },
        {
          pageId: "q",
          subjectTopicId: "v",
          promptFree: "Und das?",
          solution: "Dies.",
          misconception: "Nicht das.",
          sourceQuote: "Noch ein Zitat, lang genug.",
          materialKind: "verfahren",
        },
      ],
    );
  });
});

describe("eine Fassung", () => {
  it("steht nur hier — read_exam_material holt sie, statt sie zu bauen", () => {
    const wurzel = path.join(process.cwd(), "src");
    const run = readFileSync(path.join(wurzel, "lib", "mcp", "run.ts"), "utf8");
    assert.match(run, /import \{ stoffAuskunft, vorschlagsFragen \} from "@\/lib\/klausur-stoff";/);
    assert.match(run, /await stoffAuskunft\(user\.id, stoff, themen\)/);

    // Ein unverwechselbares Stück aus den Warnsätzen — steht es in einer
    // zweiten Datei, gibt es eine zweite Fassung.
    const kennzeichen = [
      "zitiere von dort nur, was in sich stimmig ist",
      "bau nicht dasselbe noch einmal",
      "schlag nichts vor, was dort schon liegt",
    ];
    const dateien = readdirSync(wurzel, { recursive: true })
      .map(String)
      .filter((datei) => /\.tsx?$/.test(datei) && !/\.test\.tsx?$/.test(datei));

    for (const stueck of kennzeichen) {
      const fundorte = dateien.filter((datei) =>
        readFileSync(path.join(wurzel, datei), "utf8").includes(stueck),
      );
      assert.deepEqual(fundorte, [path.join("lib", "klausur-stoff.ts")], stueck);
    }
  });
});
