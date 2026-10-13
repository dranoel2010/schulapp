import assert from "node:assert/strict";
import { test } from "node:test";

import { falschZeile } from "./ende-text";

test("Blatt zum Fach-Thema: falsche Aufgaben kommen aufs nächste Blatt", () => {
  assert.equal(falschZeile([2], "thema-1"), "Aufgabe 2 kommt aufs nächste Blatt.");
  assert.equal(falschZeile([1, 3, 4], "thema-1"), "Aufgaben 1, 3 und 4 kommen aufs nächste Blatt.");
});

test("Blatt ohne Fach-Thema (Probeklausur, Gesamtwiederholung): keine Zusage", () => {
  assert.equal(falschZeile([2], null), null);
  assert.equal(falschZeile([1, 3], null), null);
});

test("alles richtig: keine Zeile", () => {
  assert.equal(falschZeile([], "thema-1"), null);
});
