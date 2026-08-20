import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TOPIC_LIMIT,
  TOPIC_MAX_LENGTH,
  normalizeTopics,
  topicKey,
} from "@/lib/topics";

describe("topicKey", () => {
  it("faltet Rand und Groß-/Kleinschreibung", () => {
    assert.equal(topicKey("  Kettenregel "), topicKey("kettenregel"));
  });

  it("hält verschiedene Themen auseinander", () => {
    assert.notEqual(topicKey("Ableitungsregeln"), topicKey("Kettenregel"));
  });

  it("erkennt keine Umformulierung — das ist Absicht", () => {
    assert.notEqual(topicKey("Erste Ableitung"), topicKey("Ableitung"));
  });
});

describe("normalizeTopics", () => {
  it("behält die Reihenfolge", () => {
    assert.deepEqual(normalizeTopics(["B", "A", "C"]), ["B", "A", "C"]);
  });

  it("wirft Leeres und reinen Leerraum weg", () => {
    assert.deepEqual(normalizeTopics(["", "   ", "Zellatmung"]), ["Zellatmung"]);
  });

  it("trimmt, ohne den Titel sonst anzufassen", () => {
    assert.deepEqual(normalizeTopics(["  Genetik  "]), ["Genetik"]);
  });

  it("behält bei Dubletten den ersten Titel", () => {
    assert.deepEqual(normalizeTopics(["Kettenregel", "kettenregel"]), [
      "Kettenregel",
    ]);
  });

  it("kürzt auf die Höchstlänge", () => {
    const lang = "x".repeat(TOPIC_MAX_LENGTH + 20);
    const [erstes] = normalizeTopics([lang]);
    assert.equal(erstes?.length, TOPIC_MAX_LENGTH);
  });

  it("deckelt die Anzahl", () => {
    const viele = Array.from({ length: TOPIC_LIMIT + 10 }, (_, i) => `T${i}`);
    assert.equal(normalizeTopics(viele).length, TOPIC_LIMIT);
  });

  it("zählt erst nach dem Aussortieren — Leeres verbraucht keinen Platz", () => {
    const mit = ["", ...Array.from({ length: TOPIC_LIMIT }, (_, i) => `T${i}`)];
    assert.equal(normalizeTopics(mit).length, TOPIC_LIMIT);
  });

  it("nimmt eine leere Liste an", () => {
    assert.deepEqual(normalizeTopics([]), []);
  });
});
