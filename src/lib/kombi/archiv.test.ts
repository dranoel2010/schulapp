import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appTag, berlinZeitpunkt } from "@/lib/tag";

import { aufgabeImArchiv, klausurImArchiv, klausurVorbei } from "./archiv";

/**
 * Antwort 11: die Grenzen des Archivs. Klausuren zählen in App-Tagen
 * (Europe/Berlin, Wechsel um 04:00), erledigte Aufgaben zwei Tage ab dem
 * Abhaken.
 */

const tagUm = (tag: string, hhmm: string) => appTag(berlinZeitpunkt(tag, hhmm));

describe("Archiv: Klausuren", () => {
  it("am Klausurtag steht sie oben, am Tag danach unten (vorbei)", () => {
    assert.equal(klausurVorbei("2026-10-01", "2026-10-01"), false);
    assert.equal(klausurVorbei("2026-10-01", "2026-10-02"), true);
    assert.equal(klausurImArchiv("2026-10-01", "2026-10-02"), false);
  });

  it("Tag 14 nach dem Klausurtag noch in der Liste, Tag 15 im Archiv", () => {
    assert.equal(klausurImArchiv("2026-10-01", "2026-10-15"), false);
    assert.equal(klausurImArchiv("2026-10-01", "2026-10-16"), true);
  });

  it("Berliner Zeit mit Tageswechsel um 04:00: in der Nacht zu Tag 15 noch in der Liste", () => {
    // Klausur am Donnerstag, 1.10.; Tag 15 ist Freitag, 16.10.
    assert.equal(klausurImArchiv("2026-10-01", tagUm("2026-10-15", "23:59")), false);
    assert.equal(klausurImArchiv("2026-10-01", tagUm("2026-10-16", "03:59")), false);
    assert.equal(klausurImArchiv("2026-10-01", tagUm("2026-10-16", "04:00")), true);
    // 23:30 UTC am 15.10. ist in Berlin schon der 16.10., 01:30 — App-Tag noch der 15.
    assert.equal(klausurImArchiv("2026-10-01", appTag(new Date("2026-10-15T23:30:00Z"))), false);
    assert.equal(klausurImArchiv("2026-10-01", appTag(new Date("2026-10-16T02:00:00Z"))), true);
  });

  it("über die Zeitumstellung (25.10.) zählen Kalendertage, keine Stunden", () => {
    // Klausur am 20.10.; Tag 14 ist der 3.11., Tag 15 der 4.11.
    assert.equal(klausurImArchiv("2026-10-20", tagUm("2026-11-03", "20:00")), false);
    assert.equal(klausurImArchiv("2026-10-20", tagUm("2026-11-04", "04:00")), true);
    // Zeitumstellung im März: Klausur am 20.3.2027, Tag 15 am 4.4.2027
    assert.equal(klausurImArchiv("2027-03-20", tagUm("2027-04-03", "12:00")), false);
    assert.equal(klausurImArchiv("2027-03-20", tagUm("2027-04-04", "12:00")), true);
  });
});

describe("Archiv: erledigte Hausaufgaben", () => {
  const jetzt = berlinZeitpunkt("2026-10-13", "15:00").getTime();
  const um = (tag: string, hhmm: string) => berlinZeitpunkt(tag, hhmm).toISOString();

  it("offene Aufgaben kommen nie ins Archiv", () => {
    assert.equal(aufgabeImArchiv({ done: false, doneAt: null }, jetzt), false);
    assert.equal(aufgabeImArchiv({ done: false, doneAt: um("2026-09-01", "10:00") }, jetzt), false);
  });

  it("zwei Tage unter „Erledigt“, danach im Archiv (wie bisher, ab dem Abhaken)", () => {
    assert.equal(aufgabeImArchiv({ done: true, doneAt: um("2026-10-13", "14:00") }, jetzt), false);
    assert.equal(aufgabeImArchiv({ done: true, doneAt: um("2026-10-11", "15:00") }, jetzt), false);
    assert.equal(aufgabeImArchiv({ done: true, doneAt: um("2026-10-11", "14:59") }, jetzt), true);
  });

  it("nach 14 Tagen erst recht im Archiv", () => {
    assert.equal(aufgabeImArchiv({ done: true, doneAt: um("2026-09-29", "15:00") }, jetzt), true);
    assert.equal(aufgabeImArchiv({ done: true, doneAt: um("2026-09-28", "15:00") }, jetzt), true);
  });

  it("erledigt ohne Zeitpunkt (alte Daten) steht im Archiv statt nirgends", () => {
    assert.equal(aufgabeImArchiv({ done: true, doneAt: null }, jetzt), true);
  });
});
