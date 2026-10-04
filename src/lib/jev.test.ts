import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readableChars, topicCandidates } from "@/lib/auto-file";
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
