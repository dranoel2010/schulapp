import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  onlyTranscribesAttachedPages,
  onlyTranscribesUnreadPages,
  readableChars,
  topicCandidates,
} from "@/lib/auto-file";
import {
  MAX_STATE_CHARS,
  MAX_TOPICS,
  jevState,
  readSubject,
  readTopics,
  subjectQuestion,
  topicQuestions,
  type JevSubject,
} from "@/lib/jev";

const SUBJECTS: JevSubject[] = [
  { id: "ma", name: "Mathematik", topics: ["Polygonzug"] },
  { id: "geo", name: "Geografie", topics: ["Wirtschaftssektoren", "Lieferketten"] },
  { id: "sp", name: "Sport", topics: [] },
];

describe("subjectQuestion", () => {
  it("hängt die bisherigen Themen als Hinweis an", () => {
    const question = subjectQuestion(SUBJECTS);

    assert.equal(question.type, "choice");
    assert.ok(question.type === "choice");
    assert.equal(
      question.criteria.f1,
      "Geografie. Bisherige Themen: Wirtschaftssektoren, Lieferketten",
    );
    assert.equal(question.criteria.f2, "Sport", "ohne Themen nur der Name");
  });
});

describe("readSubject", () => {
  it("findet das Fach über den Schlüssel", () => {
    const result = readSubject(SUBJECTS, {
      type: "choice",
      choice: "f1",
      confidence: 0.97,
      probabilities: {},
    });

    assert.equal(result?.subject.id, "geo");
    assert.equal(result?.confidence, 0.97);
  });

  it("gibt bei einer fremden oder fehlenden Antwort nichts", () => {
    assert.equal(readSubject(SUBJECTS, undefined), null);
    assert.equal(readSubject(SUBJECTS, { type: "noul", noul: 1 }), null);
    assert.equal(
      readSubject(SUBJECTS, {
        type: "choice",
        choice: "f9",
        confidence: 1,
        probabilities: {},
      }),
      null,
    );
  });
});

describe("readTopics", () => {
  it("nimmt, was wahrscheinlicher ja als nein ist, das sicherste zuerst", () => {
    const topics = ["A", "B", "C"];
    const chosen = readTopics(topics, {
      t0: { type: "noul", noul: 0.6 },
      t1: { type: "noul", noul: 0.2 },
      t2: { type: "noul", noul: 0.95 },
    });

    assert.deepEqual(chosen, ["C", "A"]);
  });

  it("deckelt bei MAX_TOPICS", () => {
    const topics = Array.from({ length: 8 }, (_, i) => `T${i}`);
    const answers = Object.fromEntries(
      topics.map((_, i) => [`t${i}`, { type: "noul" as const, noul: 0.9 }]),
    );

    assert.equal(readTopics(topics, answers).length, MAX_TOPICS);
  });

  it("passen die Fragen zu den Schlüsseln, die readTopics liest", () => {
    const questions = topicQuestions("Geografie", ["A", "B"]);
    assert.deepEqual(Object.keys(questions), ["t0", "t1"]);
  });
});

describe("jevState", () => {
  it("kürzt lange Abschriften", () => {
    const state = jevState("x".repeat(MAX_STATE_CHARS + 500));
    assert.ok(state.length < MAX_STATE_CHARS + 200);
  });
});

describe("readableChars", () => {
  it("zählt die unsicheren Stellen nicht mit", () => {
    assert.equal(readableChars("⟨Zeichnung: Bergsee, Wald⟩\n⟨m1⟩ ⟨m2⟩"), 0);
    assert.equal(readableChars("Kultur ⟨unleserlich⟩ landschaft"), 16);
  });
});

describe("topicCandidates", () => {
  it("stellt Claudes Themen vorn hin und lässt Doppelte weg", () => {
    assert.deepEqual(
      topicCandidates(["Megastadt", "Lieferketten"], ["lieferketten", "Beijing"]),
      ["lieferketten", "Beijing", "Megastadt"],
    );
  });
});

describe("onlyTranscribesUnreadPages", () => {
  /** Ein eingeordnetes Blatt: Seite 1 gelesen, Seite 2 nachgereicht und ungelesen. */
  const SEITEN = [
    { pageId: "s1", transcript: "Aufgabe 1" },
    { pageId: "s2", transcript: null },
    { pageId: "s3", transcript: "" },
  ];

  /** Ein Vorschlag, der nur die Abschrift der nachgereichten Seite bringt. */
  function vorschlag(overrides: Partial<Parameters<typeof onlyTranscribesUnreadPages>[0]> = {}) {
    return {
      subjectId: null,
      title: null,
      capturedOn: null,
      note: null,
      topics: [],
      transcripts: [{ pageId: "s2" }],
      ...overrides,
    };
  }

  it("lässt die Abschrift einer ungelesenen Seite durch", () => {
    assert.equal(onlyTranscribesUnreadPages(vorschlag(), SEITEN), true);
  });

  it("hält jeden Vorschlag auf, der außer der Abschrift noch etwas sagt", () => {
    for (const anders of [
      { subjectId: "ma" },
      { title: "Rückseite" },
      { capturedOn: "2026-10-01" },
      { note: "nachgereicht" },
      { topics: ["Kettenregel"] },
    ]) {
      assert.equal(
        onlyTranscribesUnreadPages(vorschlag(anders), SEITEN),
        false,
        JSON.stringify(anders),
      );
    }
  });

  it("ersetzt keine Seite, die schon gelesen ist — auch keine leere", () => {
    assert.equal(
      onlyTranscribesUnreadPages(vorschlag({ transcripts: [{ pageId: "s2" }, { pageId: "s1" }] }), SEITEN),
      false,
    );
    assert.equal(
      onlyTranscribesUnreadPages(vorschlag({ transcripts: [{ pageId: "s3" }] }), SEITEN),
      false,
      "„“ heißt gelesen, es stand nichts darauf",
    );
  });

  it("hält eine Abschrift zu einer fremden Seite auf", () => {
    assert.equal(
      onlyTranscribesUnreadPages(vorschlag({ transcripts: [{ pageId: "anderswo" }] }), SEITEN),
      false,
    );
  });

  it("übernimmt keinen Vorschlag ohne jede Abschrift", () => {
    assert.equal(onlyTranscribesUnreadPages(vorschlag({ transcripts: [] }), SEITEN), false);
  });
});

describe("onlyTranscribesAttachedPages", () => {
  const nachgereicht = new Set(["p3"]);

  it("lässt eine Abschrift der nachgereichten Seite durch", () => {
    assert.equal(
      onlyTranscribesAttachedPages({ transcripts: [{ pageId: "p3" }] }, nachgereicht),
      true,
    );
  });

  it("hält ein Altblatt fest, dessen alte Seiten mit abgeschrieben wurden", () => {
    // Die Rückseite p3 ist nachgereicht, p1 und p2 sind seit August ungelesen.
    // Schreibt ein Lauf alle drei ab, entscheidet ein Mensch.
    assert.equal(
      onlyTranscribesAttachedPages(
        { transcripts: [{ pageId: "p1" }, { pageId: "p2" }, { pageId: "p3" }] },
        nachgereicht,
      ),
      false,
    );
  });

  it("lässt eine leere Abschrift nicht als Zustimmung durch", () => {
    assert.equal(onlyTranscribesAttachedPages({ transcripts: [] }, nachgereicht), false);
  });
});
