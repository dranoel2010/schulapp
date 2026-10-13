import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { grammatikFolge, nextLesson, type VorratGrammatik, type ZeilenVorrat } from "@/lib/kombi/vorrat";

import { istGrammatikBlatt, spracheDesSatzes } from "./grammatik";
import { parse } from "./parser";
import { prototypVorrat } from "./prototyp-vorrat";
import { answerFor, suche, txtText, type Antwort, type Ziel } from "./suche";

/** „Blatt Grammatik Englisch“ in der Zeile (Antwort 5 vom 13.10.2026). */

const p = (v: ZeilenVorrat, s: string) =>
  parse(s, { faecher: v.faecher, heute: v.heute, naechsteStunde: (f, ab) => nextLesson(v, f, ab), ctx: null, override: null });
const antwort = (s: string, v = prototypVorrat()): Antwort => {
  const a = answerFor(p(v, s), { v, jetzt: v.jetzt, doneFuer: (x) => x.done });
  assert.ok(a, `keine Antwort für »${s}«`);
  return a;
};
const menue = (s: string, v = prototypVorrat()) =>
  suche(p(v, s), { v, jetzt: v.jetzt, doneFuer: (x) => x.done, server: { q: "", list: [] } });
const thema = (z: Ziel | null | undefined) => (z && z.typ === "tisch" ? (z.thema ?? null) : null);

describe("Zeile: Grammatikblatt erkennen", () => {
  it("»Blatt« und ein Wort für Grammatik, in beliebiger Folge", () => {
    assert.ok(istGrammatikBlatt(["Blatt", "Grammatik", "Englisch"]));
    assert.ok(istGrammatikBlatt(["englisch", "grammatik", "blatt"]));
    assert.ok(istGrammatikBlatt(["blatt", "grammaire"]));
    assert.ok(!istGrammatikBlatt(["blatt"]));
    assert.ok(!istGrammatikBlatt(["grammatik"]));
    assert.ok(!istGrammatikBlatt(["arbeitsblatt", "grammatik"]));
  });

  for (const satz of ["Blatt Grammatik Englisch", "blatt grammatik französisch", "Blatt Grammatik", "Englisch Blatt Grammatik", "Blatt Grammatik Englisch morgen"]) {
    it(`»${satz}« wird gesucht, nicht eingetragen`, () => assert.equal(p(prototypVorrat(), satz).intent, "suchen"));
  }

  it("»bio arbeitsblatt bis donnerstag« bleibt eine Hausaufgabe", () =>
    assert.equal(p(prototypVorrat(), "bio arbeitsblatt bis donnerstag").intent, "eintragen"));

  it("die Sprache kommt aus dem Fach oder aus einem Sprachwort", () => {
    const v = prototypVorrat();
    assert.equal(spracheDesSatzes(p(v, "Blatt Grammatik Englisch").words, p(v, "Blatt Grammatik Englisch").fach), "en");
    assert.equal(spracheDesSatzes(p(v, "blatt grammatik frz").words, p(v, "blatt grammatik frz").fach), "fr");
    assert.equal(spracheDesSatzes(["blatt", "grammatik"], null), null);
    // ohne Fach Englisch im Stundenplan zählt das Wort allein
    assert.equal(spracheDesSatzes(["blatt", "grammatik", "english"], null), "en");
  });
});

describe("Zeile: Antwort auf »Blatt Grammatik …«", () => {
  it("»Blatt Grammatik Englisch«: das fälligste Englisch-Thema, darunter das andere", () => {
    const a = antwort("Blatt Grammatik Englisch");
    assert.ok(a.kind === "nav");
    if (a.kind !== "nav") return;
    assert.equal(a.l1, "Blatt Grammatik · Simple past");
    assert.equal(a.l2, "Arbeitsblatt in Englisch");
    assert.deepEqual(a.ziel, { typ: "tisch", mode: "wh", fach: null, thema: "en-sp" });
    assert.deepEqual(a.wahl?.items.map((i) => txtText(i.l1)), ["Present perfect"]);
  });

  it("»blatt grammatik französisch«: das Französisch-Thema, heute fällig", () => {
    const a = antwort("blatt grammatik französisch");
    assert.equal(a.l1, "Blatt Grammatik · Passé composé mit être");
    assert.equal(a.l2, "Arbeitsblatt in Französisch, heute fällig");
    assert.ok(a.kind === "nav" && thema(a.ziel) === "fr-pc");
  });

  it("»Blatt Grammatik Deutsch«: Deutsch auf Deutsch", () => {
    const a = antwort("Blatt Grammatik Deutsch");
    assert.ok(a.kind === "nav" && thema(a.ziel) === "de-ks");
  });

  it("»Blatt Grammatik« ohne Sprache: das fälligste überhaupt, die anderen zur Wahl", () => {
    const a = antwort("Blatt Grammatik");
    assert.ok(a.kind === "nav");
    if (a.kind !== "nav") return;
    assert.equal(thema(a.ziel), "fr-pc");
    assert.deepEqual(a.wahl?.items.map((i) => thema(i.ziel)), ["en-sp", "en-pp", "de-ks"]);
  });

  it("mehrdeutig (keins heute fällig, mehrere Sprachen): kurze Auswahl je Sprache", () => {
    const v = prototypVorrat();
    v.grammatik = v.grammatik.map((t) => (t.id === "fr-pc" ? { ...t, faellig: "2026-10-15" } : t)).sort(grammatikFolge);
    const a = antwort("Blatt Grammatik", v);
    assert.ok(a.kind === "nav");
    if (a.kind !== "nav") return;
    assert.equal(a.l1, "Blatt Grammatik");
    assert.equal(a.l2, "In welcher Sprache?");
    assert.equal(a.ziel, null);
    assert.deepEqual(a.wahl?.items.map((i) => `${txtText(i.l1)} · ${txtText(i.l2)}`), [
      "Simple past · Arbeitsblatt in Englisch",
      "Passé composé mit être · Arbeitsblatt in Französisch",
      "Kommasetzung · Arbeitsblatt in Deutsch",
    ]);
  });

  it("eine einzige Sprache ist nie mehrdeutig", () => {
    const v = prototypVorrat();
    v.grammatik = v.grammatik.filter((t) => t.sprache === "en");
    const a = antwort("Blatt Grammatik", v);
    assert.ok(a.kind === "nav" && thema(a.ziel) === "en-sp");
  });

  it("ohne passendes Thema sagt die Zeile es kurz", () => {
    assert.equal(antwort("Blatt Grammatik Mathe").l1, "Noch kein Grammatikthema in Mathematik.");
    const v = prototypVorrat();
    v.grammatik = [];
    assert.equal(antwort("Blatt Grammatik Englisch", v).l1, "Noch kein Grammatikthema in Englisch.");
    assert.equal(antwort("Blatt Grammatik", v).l1, "Noch kein Grammatikthema mit Blatt.");
  });

  it("geht vor »morgen« und vor der Ablage", () => {
    assert.equal(thema((antwort("Blatt Grammatik Englisch morgen") as Extract<Antwort, { kind: "nav" }>).ziel), "en-sp");
    assert.equal(antwort("Blatt").l1, "Ablage öffnen");
  });
});

describe("Zeile: Menü zu »Blatt Grammatik …«", () => {
  it("oberster Treffer öffnet das Blatt, die Auswahl steht als Gruppe »Grammatik« darunter", () => {
    const m = menue("Blatt Grammatik Englisch");
    assert.equal(txtText(m.top.l1), "Blatt Grammatik · Simple past");
    assert.equal(thema(m.top.ziel), "en-sp");
    const g = m.groups.find((x) => x.key === "g:gr");
    assert.equal(g?.label, "Grammatik");
    assert.deepEqual(g?.items?.map((i) => thema(i.ziel)), ["en-pp"]);
  });

  it("»Blatt aufnehmen« und die Ablage stehen nicht darunter", () => {
    const m = menue("Blatt Grammatik");
    assert.ok(!m.groups.some((g) => g.key === "g:act" || g.key === "g:ar"));
  });

  it("»Blatt« allein bleibt die Ablage mit »Blatt aufnehmen«", () => {
    const m = menue("Blatt");
    assert.equal(txtText(m.top.l1), "Ablage öffnen");
    assert.ok(m.groups.some((g) => g.key === "g:act"));
  });
});

describe("Folge der Grammatikthemen", () => {
  const t = (id: string, faellig: string | null, zuletzt: string, name = id): VorratGrammatik => ({
    id,
    fachId: "en",
    name,
    sprache: "en",
    faellig,
    zuletzt,
  });
  it("ältester Termin zuerst, ohne Termin zuletzt, dann das jüngste, dann alphabetisch", () => {
    const liste = [t("c", null, "2026-10-10"), t("a", "2026-10-14", "2026-10-01"), t("b", "2026-10-12", "2026-09-01"), t("d", null, "2026-10-11"), t("f", null, "2026-10-11", "A")];
    assert.deepEqual(liste.sort(grammatikFolge).map((x) => x.id), ["b", "a", "f", "d", "c"]);
  });
});
