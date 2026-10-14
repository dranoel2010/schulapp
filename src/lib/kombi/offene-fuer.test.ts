import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  headlineFor,
  istAelter,
  moAbgaben,
  offeneFuer,
  ueberblickAufgaben,
  type AufgabeT,
  type MorgenT,
  type TagDaten,
} from "@/lib/kombi/startseite";

const leerMorgen = (tag: string): MorgenT => ({ tag, stunden: [], klausur: null });

function daten(teil: Partial<TagDaten> & Pick<TagDaten, "tag" | "naechsterSchultag">): TagDaten {
  return {
    stand: "2026-10-12T17:30:00.000Z",
    uhrVersatz: 0,
    ansicht: "ueberblick",
    schritt: "blaetter",
    ablaufStand: null,
    schultag: true,
    nachSchluss: true,
    ferien: null,
    aufgaben: [],
    morgens: leerMorgen(teil.tag),
    frueh: leerMorgen(teil.naechsterSchultag),
    klausurenBald: [],
    lernblock: null,
    naechsterLernblock: null,
    verpasst: null,
    blaetter: [],
    eingangskorb: 0,
    wiederholen: { kind: "leer" } as TagDaten["wiederholen"],
    klausurBlock: null,
    ...teil,
  };
}

let n = 0;
const aufgabe = (fach: string, text: string, due: string, done = false, doneAt: string | null = null): AufgabeT => ({
  id: `a${++n}`,
  fachId: fach,
  fach,
  fachName: fach,
  text,
  due,
  done,
  doneAt,
  details: false,
});

// Die Aufgaben aus V2 2.2
const mathe = aufgabe("Mathe", "S. 84, Nr. 3–5", "2026-10-13");
const deutsch = aufgabe("Deutsch", "Gedichtanalyse beenden", "2026-10-13");
const englisch = aufgabe("Englisch", "Vokabeln Unit 3", "2026-10-12", true, "2026-10-11T17:12:00.000Z");
const geschichte = aufgabe("Geschichte", "Fragen zur Dampfmaschine", "2026-10-12");
const bio = aufgabe("Bio", "Arbeitsblatt Zellatmung fertig", "2026-10-15");
const alle = [mathe, deutsch, englisch, geschichte, bio];

describe("offeneFuer (Prototyp Z. 1782)", () => {
  const mo = daten({ tag: "2026-10-12", naechsterSchultag: "2026-10-13" });

  it("nennt die offenen bis zum nächsten Schultag, ohne die Abgaben von heute", () => {
    assert.deepEqual(offeneFuer(mo, alle).map((a) => a.text), ["S. 84, Nr. 3–5", "Gedichtanalyse beenden"]);
  });

  it("an einem Tag ohne Schule zählen auch die von heute", () => {
    const sa = daten({ tag: "2026-10-12", naechsterSchultag: "2026-10-13", schultag: false });
    assert.deepEqual(offeneFuer(sa, alle).map((a) => a.text), [
      "Fragen zur Dampfmaschine",
      "S. 84, Nr. 3–5",
      "Gedichtanalyse beenden",
    ]);
  });

  it("eine eben abgehakte, noch gehaltene Zeile bleibt in der Liste", () => {
    const hak = { ...mathe, done: true };
    assert.equal(offeneFuer(mo, [hak, deutsch]).length, 1);
    assert.equal(offeneFuer(mo, [hak, deutsch], new Set([hak.id])).length, 2);
  });
});

describe("Überblick: drei Zeilen, „Und … weitere“, spätere", () => {
  it("„Eine weitere bis Donnerstag“ (V2 3.7 Nr. 4)", () => {
    const mo = daten({ tag: "2026-10-12", naechsterSchultag: "2026-10-13" });
    const r = ueberblickAufgaben(mo, alle);
    assert.equal(r.gezeigt.length, 2);
    assert.deepEqual(r.zeilen.map((z) => z.text), ["Eine weitere bis Donnerstag"]);
  });

  it("höchstens drei, dann „Und zwei weitere“", () => {
    const mo = daten({ tag: "2026-10-12", naechsterSchultag: "2026-10-13" });
    const viele = [1, 2, 3, 4, 5].map((i) => aufgabe("Mathe", `Nr. ${i}`, "2026-10-13"));
    const r = ueberblickAufgaben(mo, viele);
    assert.equal(r.gezeigt.length, 3);
    assert.deepEqual(r.zeilen.map((z) => z.text), ["Und zwei weitere"]);
  });
});

describe("headlineFor (Prototyp Z. 1633)", () => {
  const mo = daten({ tag: "2026-10-12", naechsterSchultag: "2026-10-13" });

  it("Überblick: „Zwei Aufgaben für Dienstag“, nach dem Abhaken „Noch eine …“", () => {
    assert.equal(headlineFor("ueberblick", mo, alle), "Zwei Aufgaben für Dienstag");
    assert.equal(headlineFor("ueberblick", mo, [{ ...mathe, done: true }, deutsch]), "Noch eine Aufgabe für Dienstag");
    assert.equal(headlineFor("ueberblick", mo, [{ ...mathe, done: true }]), "Für Dienstag ist alles erledigt");
  });

  it("freitags „… für Montag, 19.10.“ (Kriterium 29)", () => {
    const fr = daten({ tag: "2026-10-16", naechsterSchultag: "2026-10-19" });
    const a = [aufgabe("Mathe", "x", "2026-10-19"), aufgabe("Deutsch", "y", "2026-10-19")];
    assert.equal(headlineFor("ueberblick", fr, a), "Zwei Aufgaben für Montag, 19.10.");
  });

  it("Ferien: „Ferien bis Freitag, 30.10.“", () => {
    const fe = daten({
      tag: "2026-10-27",
      naechsterSchultag: "2026-11-02",
      schultag: false,
      ferien: { bis: "2026-10-30", titel: "Ferien" },
    });
    assert.equal(headlineFor("ueberblick", fe, alle), "Ferien bis Freitag, 30.10.");
    // auch mit eigenem Titel aus der Schulhomepage bleibt der Wortlaut des Prototyps
    const herbst = { ...fe, ferien: { bis: "2026-10-30", titel: "Herbstferien" } };
    assert.equal(headlineFor("ueberblick", herbst, alle), "Ferien bis Freitag, 30.10.");
  });

  it("Morgens zählt die Abgaben des Tages, offen wie erledigt", () => {
    assert.equal(headlineFor("morgens", mo, alle), "Heute zwei Abgaben");
    assert.equal(headlineFor("morgens", mo, [englisch]), "Heute eine Abgabe");
    assert.equal(headlineFor("morgens", mo, []), "Heute nichts abzugeben");
  });

  it("Morgen früh: „Morgen …“, sonst der Wochentag", () => {
    assert.equal(headlineFor("frueh", mo, alle), "Morgen zwei Abgaben");
    const fr = daten({ tag: "2026-10-16", naechsterSchultag: "2026-10-19" });
    assert.equal(headlineFor("frueh", fr, []), "Montag nichts abzugeben");
  });
});

describe("moAbgaben", () => {
  const schultagMo = { tag: "2026-10-12", schultag: true };
  it("offene zuerst, erledigte darunter in der Reihenfolge des Abhakens", () => {
    const spaet = { ...geschichte, done: true, doneAt: "2026-10-12T05:12:00.000Z" };
    assert.deepEqual(moAbgaben([spaet, englisch], "2026-10-12", schultagMo).map((a) => a.fach), ["Englisch", "Geschichte"]);
    assert.deepEqual(moAbgaben([englisch, geschichte], "2026-10-12", schultagMo).map((a) => a.fach), ["Geschichte", "Englisch"]);
  });
});

describe("Überfällige Abgaben (Abnahme 13.10.2026)", () => {
  // Englisch, fällig Mo 12.10., noch offen
  const vokabeln = aufgabe("Englisch", "Vokabeln Unit 3", "2026-10-12");
  it("Dienstagabend kündigt der Überblick sie für Mittwoch an, die Vorschau zeigt sie", () => {
    const di = daten({ tag: "2026-10-13", naechsterSchultag: "2026-10-14" });
    assert.equal(headlineFor("ueberblick", di, [vokabeln]), "Noch eine Aufgabe für Mittwoch");
    assert.equal(headlineFor("frueh", di, [vokabeln]), "Morgen eine Abgabe");
    assert.deepEqual(moAbgaben([vokabeln], "2026-10-14", di).map((a) => a.text), ["Vokabeln Unit 3"]);
  });
  it("Mittwochmorgen steht sie unter „Abgeben“ und zählt in der Überschrift", () => {
    const mi = daten({ tag: "2026-10-14", naechsterSchultag: "2026-10-15" });
    const heute = aufgabe("Mathe", "S. 90", "2026-10-14");
    assert.equal(headlineFor("morgens", mi, [vokabeln, heute]), "Heute zwei Abgaben");
    assert.deepEqual(moAbgaben([heute, vokabeln], "2026-10-14", mi).map((a) => a.fach), ["Englisch", "Mathe"]);
  });
  it("erledigt zählt sie nicht mehr; heute an einem Schultag Fälliges wird erst morgen überfällig", () => {
    const mi = daten({ tag: "2026-10-14", naechsterSchultag: "2026-10-15" });
    assert.equal(headlineFor("morgens", mi, [{ ...vokabeln, done: true }]), "Heute nichts abzugeben");
    const heute = aufgabe("Mathe", "S. 90", "2026-10-14");
    assert.equal(headlineFor("frueh", mi, [heute]), "Morgen nichts abzugeben");
  });
});

describe("ueberblickAufgaben mit gehaltenen Zeilen", () => {
  const mo = daten({ tag: "2026-10-12", naechsterSchultag: "2026-10-13" });
  it("eine eben wieder geöffnete Zeile (alter Zustand erledigt) bleibt stehen", () => {
    // Reihenfolge-Stand während des Haltens: Mathe trägt noch done = true
    const ordnung = [{ ...mathe, done: true }, deutsch];
    const ohne = ueberblickAufgaben(mo, ordnung).gezeigt.map((a) => a.fach);
    assert.deepEqual(ohne, ["Deutsch"]);
    const mit = ueberblickAufgaben(mo, ordnung, new Set([mathe.id])).gezeigt.map((a) => a.fach);
    assert.deepEqual(mit, ["Mathe", "Deutsch"]);
  });
});

describe("istAelter", () => {
  it("Server-Props aus dem Router-Cache verlieren gegen den frischeren Stand", () => {
    const alt = { stand: "2026-10-13T14:40:00.000Z" };
    const neu = { stand: "2026-10-13T14:52:10.000Z" };
    assert.equal(istAelter(alt, neu), true);
    assert.equal(istAelter(neu, alt), false);
    assert.equal(istAelter(neu, neu), false);
  });
  it("ohne lesbaren Stand gilt nichts als älter", () => {
    assert.equal(istAelter({ stand: "" }, { stand: "2026-10-13T14:52:10.000Z" }), false);
  });
});
