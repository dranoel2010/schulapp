import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextLesson } from "@/lib/kombi/vorrat";

import { findDue, fmtTask, parse, type ParseUmgebung } from "./parser";
import { prototypVorrat } from "./prototyp-vorrat";

const v = prototypVorrat();
const umg = (over: Partial<ParseUmgebung> = {}): ParseUmgebung => ({
  faecher: v.faecher,
  heute: v.heute,
  naechsteStunde: (f, ab) => nextLesson(v, f, ab),
  ctx: null,
  override: null,
  ...over,
});

/** Prototyp `PARSER_SAETZE` (Z. 4621): Satz und erwartete Absicht. */
const PARSER_SAETZE: [string, "eintragen" | "suchen"][] = [
  ["mathe s 90 nr 1-4", "eintragen"], ["bio arbeitsblatt bis donnerstag", "eintragen"], ["Deutsch Gedicht lernen bis 20.10.", "eintragen"],
  ["mathe klausur verschieben", "suchen"], ["bio", "suchen"], ["was ist morgen", "suchen"], ["morgen", "suchen"], ["noten mathe", "suchen"],
  ["scheitelpunkt", "suchen"], ["gedichtanalyse", "suchen"], ["ma heft vergessen", "eintragen"], ["mama anrufen", "suchen"], ["?mathe heft", "suchen"],
  ["+karten erstellen", "eintragen"], ["englisch", "suchen"],
  ["wiederholen", "suchen"], ["abfragen mathe", "suchen"], ["geschichte quellen lesen", "eintragen"], ["dampfmaschine", "suchen"],
  ["?geschichte dampfmaschine", "suchen"], ["frz passé composé", "eintragen"], ["noten", "suchen"], ["packen", "suchen"],
];

describe("Parser der Zeile", () => {
  it("hat alle 23 Sätze des Prototyps", () => assert.equal(PARSER_SAETZE.length, 23));

  for (const [satz, soll] of PARSER_SAETZE) {
    it(`»${satz}« → ${soll}`, () => assert.equal(parse(satz, umg()).intent, soll));
  }

  it("zerlegt »mathe s 90 nr 1-4« in Fach, nächste Stunde und Text", () => {
    const p = parse("mathe s 90 nr 1-4", umg());
    assert.equal(p.eFach?.name, "Mathematik");
    assert.equal(p.taskText, "S. 90 Nr. 1–4");
    // nächste Mathestunde nach Montag ist Dienstag
    assert.equal(p.due, "2026-10-13");
    assert.equal(p.dueAuto, true);
  });

  it("»bio arbeitsblatt bis donnerstag« fällig Do 15.10.", () => {
    const p = parse("bio arbeitsblatt bis donnerstag", umg());
    assert.equal(p.due, "2026-10-15");
    assert.equal(p.dueExplicit, true);
    assert.equal(p.taskText, "Arbeitsblatt");
  });

  it("»ma heft vergessen« erkennt Mathe am Kürzel ma, nur als erstes Wort", () => {
    assert.equal(parse("ma heft vergessen", umg()).eFach?.id, "ma");
    assert.equal(parse("heft ma vergessen", umg()).fach, null);
  });

  it("»frz passé composé« trägt Französisch ein", () => {
    const p = parse("frz passé composé", umg());
    assert.equal(p.eFach?.name, "Französisch");
    assert.equal(p.taskText, "Passé composé");
  });

  it("Präfix ? und + schlagen alles andere", () => {
    assert.equal(parse("?mathe heft", umg()).why, "praefix");
    assert.equal(parse("+karten erstellen", umg()).taskText, "Karten erstellen");
  });

  it("Override: »Stattdessen suchen« und ändern im Kontext", () => {
    assert.equal(parse("mathe s 90", umg({ override: "suchen" })).intent, "suchen");
    const ctx = { intent: "aendern" as const, fach: "ma", due: "2026-10-13", editId: "a1" };
    assert.equal(parse("S. 84", umg({ ctx, override: "eintragen" })).intent, "aendern");
  });

  it("hält die vorige Absicht während des Tippens (hold)", () => {
    const p = parse("mathe k", umg(), "suchen");
    assert.equal(p.real, "eintragen");
    assert.equal(p.intent, "suchen");
    assert.equal(p.held, true);
  });
});

describe("findDue", () => {
  it("Datum über den Jahreswechsel: am 28.12. ist »bis 3.1.« im nächsten Jahr", () => {
    assert.equal(findDue("Referat bis 3.1.", "2026-12-28")?.date, "2027-01-03");
  });
  it("ein vergangenes Datum dieses Jahres gilt fürs nächste", () => {
    assert.equal(findDue("bis 20.10.", "2026-10-12")?.date, "2026-10-20");
    assert.equal(findDue("bis 1.10.", "2026-10-12")?.date, "2027-10-01");
  });
  it("es gibt keinen 31.2.", () => assert.equal(findDue("bis 31.2.", "2026-10-12"), null));
  it("Wochentag ist nie heute, morgen und übermorgen", () => {
    assert.equal(findDue("bis montag", "2026-10-12")?.date, "2026-10-19");
    assert.equal(findDue("morgen", "2026-10-12")?.date, "2026-10-13");
    assert.equal(findDue("übermorgen", "2026-10-12")?.date, "2026-10-14");
  });
});

describe("fmtTask", () => {
  it("setzt S. und Nr. und den Halbgeviertstrich", () => assert.equal(fmtTask("s 90 nr 1-4"), "S. 90 Nr. 1–4"));
});
