import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fachEintraege, fachKurz } from "@/lib/kombi/fach-alias";
import { nextLesson } from "@/lib/kombi/vorrat";

import { parse } from "./parser";
import { prototypVorrat } from "./prototyp-vorrat";
import { AREAS, answerFor, dublette, rueckfrageTage, suche, suggestions, txtText, type Antwort, type SuchUmgebung } from "./suche";

const v = prototypVorrat();
const u: SuchUmgebung = { v, jetzt: v.jetzt, doneFuer: (a) => a.done };
const p = (s: string) =>
  parse(s, { faecher: v.faecher, heute: v.heute, naechsteStunde: (f, ab) => nextLesson(v, f, ab), ctx: null, override: null });
const antwort = (s: string): Antwort => {
  const a = answerFor(p(s), u);
  assert.ok(a, `keine Antwort für »${s}«`);
  return a;
};

describe("Antworten beim Tippen (Wortlaut wie im Prototyp)", () => {
  it("»morgen«: Dienstag mit vier Stunden und zwei Abgaben", () => {
    const a = antwort("morgen");
    assert.equal(a.l1, "Dienstag, 13.10., 4 Stunden, 2 Abgaben");
    assert.ok(a.kind === "tag" && a.inhalt.art === "tag");
    if (a.kind !== "tag" || a.inhalt.art !== "tag") return;
    assert.deepEqual(
      a.inhalt.stunden.map((s) => `${s.von} ${s.fach} ${s.em}`),
      ["08:00 Geschichte Hauptunterricht · R. 104", "09:50 Deutsch R. 104", "11:40 Mathematik R. 208", "13:30 Englisch R. 112"],
    );
    assert.deepEqual(a.inhalt.abgeben.map((x) => x.text), ["S. 84, Nr. 3–5", "Gedichtanalyse beenden"]);
    assert.equal(a.openLabel, "Morgenansicht öffnen");
  });

  it("»noten mathe«: Noten in Mathematik", () => {
    const a = antwort("noten mathe");
    assert.equal(a.l1, "Noten in Mathematik");
    assert.ok(a.kind === "noten" && a.inhalt.art === "noten");
    if (a.kind !== "noten" || a.inhalt.art !== "noten") return;
    assert.deepEqual(a.inhalt.noten.map((n) => `${n.label} ${n.titel}`), ["2 Klausur", "3+ Test", "2− Mitarbeit"]);
    assert.equal(a.openLabel, "Noten öffnen");
  });

  it("»mathe klausur«: Klausur mit Lernplan ab heute", () => {
    const a = antwort("mathe klausur");
    assert.equal(a.l1, "Klausur Mathematik");
    assert.equal(a.l2, "Freitag, 16.10., in 4 Tagen");
    assert.ok(a.kind === "klausur" && a.inhalt.art === "klausur");
    if (a.kind !== "klausur" || a.inhalt.art !== "klausur") return;
    assert.equal(a.inhalt.kopf, "Quadratische Funktionen, in 4 Tagen");
    assert.deepEqual(
      a.inhalt.zeilen.map((z) => `${z.time} | ${z.b} | ${z.em}`),
      ["Heute | Scheitelpunktform | Lernblock, 25 Minuten", "Mi | Wiederholung | Alles bis Scheitelpunktform"],
    );
  });

  it("»klausur« nach geschriebenen Klausuren: erst die kommende, sonst die zuletzt vergangene, nie „in -n Tagen“", () => {
    const k1 = v.klausuren[0];
    const mk = (id: string, fachId: string, datum: string, thema: string) => ({ ...k1, id, fachId, datum, thema, plan: [] });
    const alt = [mk("kA", "ma", "2026-10-16", "Quadratische Funktionen"), mk("kB", "ma", "2026-10-17", "Parabeln")];
    const am = (klausuren: typeof v.klausuren, s: string) => {
      const vv = { ...v, heute: "2026-10-19", klausuren };
      const pp = parse(s, { faecher: vv.faecher, heute: vv.heute, naechsteStunde: (f, ab) => nextLesson(vv, f, ab), ctx: null, override: null });
      return answerFor(pp, { ...u, v: vv });
    };
    // die kommende liegt mehr als 14 Tage entfernt: sie gilt, nicht die älteste vergangene
    const weit = am([...alt, mk("kC", "ma", "2026-11-20", "Wurzeln")], "klausur");
    assert.equal(weit?.l2, "Freitag, 20.11., in 32 Tagen");
    // keine kommende mehr: die zuletzt geschriebene, als „vor n Tagen“
    const vorbei = am(alt, "mathe klausur");
    assert.equal(vorbei?.l2, "Samstag, 17.10., vor 2 Tagen");
    assert.ok(vorbei?.kind === "klausur" && vorbei.inhalt.art === "klausur" && vorbei.inhalt.kopf === "Parabeln, vor 2 Tagen");
  });

  it("»wiederholen mathe«: nur Mathematik, das erste Thema", () => {
    const a = antwort("wiederholen mathe");
    assert.equal(a.kind, "nav");
    assert.equal(a.l1, "Wiederholen · nur Mathematik · Quadratische Funktionen");
    assert.equal(a.l2, "12 Fragen");
  });

  it("»wiederholen«: alle Themen, zuerst Geschichte", () => {
    const a = antwort("wiederholen");
    assert.equal(a.l1, "Wiederholen · 3 Themen, zuerst Geschichte");
    assert.equal(a.l2, "Industrialisierung in England");
  });

  it("»epoche«: Hauptunterricht seit …", () => {
    const a = antwort("epoche");
    assert.equal(a.l1, "Epoche Geschichte");
    assert.equal(a.l2, "Hauptunterricht seit Montag, 28.9.");
  });

  it("in den Ferien wird nicht wiederholt", () => {
    const f = { ...u, v: { ...v, heute: "2026-10-27" } };
    assert.equal(answerFor(p("wiederholen"), f)?.l1, "In den Ferien wird nicht wiederholt.");
  });
});

describe("Suche", () => {
  it("»gedichtanalyse« findet die Aufgabe als obersten Treffer", () => {
    const r = suche(p("gedichtanalyse"), { ...u, server: { q: "", list: [] } });
    assert.equal(txtText(r.top.l1), "Deutsch Gedichtanalyse beenden");
    assert.equal(txtText(r.top.l2), "Aufgabe · bis Dienstag, 13.10.");
  });

  it("»scheitelpunkt« findet das Thema des Lernblocks mit „Starten“", () => {
    const r = suche(p("scheitelpunkt"), { ...u, server: { q: "", list: [] } });
    assert.equal(txtText(r.top.l1), "Scheitelpunktform");
    assert.equal(txtText(r.top.l2), "Thema in Mathematik");
    assert.equal(r.top.start, true);
  });

  it("ein Blatt vom Server schlägt die bloße Fachseite (»?geschichte dampfmaschine«)", () => {
    const server = { q: "geschichte dampfmaschine", list: [{ id: "b1", titel: "Die Dampfmaschine", fachId: "ge", seiteId: null, ausschnitt: "Die Dampfmaschine Die Industrialisierung begann" }] };
    const r = suche(p("?geschichte dampfmaschine"), { ...u, server });
    assert.equal(txtText(r.top.l1), "Die Dampfmaschine");
    assert.ok(txtText(r.top.l2).startsWith("Blatt · "));
  });

  it("erledigte Aufgaben werden nie oberster Treffer", () => {
    const r = suche(p("vokabeln"), { ...u, server: { q: "", list: [] } });
    assert.notEqual(r.top.key, "a:a3");
    assert.ok(r.groups.some((g) => g.items?.some((i) => i.key === "a:a3" && i.done)));
  });

  it("ältere erledigte Aufgaben findet die Suche zwei Wochen lang, aber nie als obersten Treffer", () => {
    const tag = 864e5;
    const mit = (vor: number) => {
      const a3 = v.aufgaben.find((a) => a.id === "a3")!;
      const vv = { ...v, aufgaben: v.aufgaben.map((a) => (a.id === "a3" ? { ...a3, done: v.jetzt - vor * tag } : a)) };
      return suche(p("vokabeln"), { ...u, v: vv, server: { q: "", list: [] } });
    };
    const vier = mit(4);
    assert.notEqual(vier.top.key, "a:a3");
    assert.ok(vier.groups.some((g) => g.items?.some((i) => i.key === "a:a3" && i.done)));
    // nicht mehr in der Hausaufgabenliste: ein Tipp öffnet sie wieder, statt in die Liste ohne sie zu führen
    const it4 = vier.groups.flatMap((g) => g.items ?? []).find((i) => i.key === "a:a3")!;
    assert.equal(it4.intern?.typ, "wiederOeffnen");
    assert.equal(it4.ziel, undefined);
    const frisch = mit(1).groups.flatMap((g) => g.items ?? []).find((i) => i.key === "a:a3")!;
    assert.equal(frisch.ziel?.typ, "seite");
    const alt = mit(15);
    assert.ok(!alt.groups.some((g) => g.items?.some((i) => i.key === "a:a3")));
    assert.notEqual(alt.top.key, "a:a3");
  });

  it("»archiv« öffnet das Archiv, auch mit »klausuren«, und wird keine Aufgabe (Antwort 11)", () => {
    for (const q of ["archiv", "klausuren archiv", "Archiv"]) {
      assert.notEqual(p(q).intent, "eintragen", q);
      const a = antwort(q);
      assert.equal(a.l1, "Archiv öffnen");
      assert.ok(a.kind === "nav");
      if (a.kind !== "nav") continue;
      assert.deepEqual(a.ziel, { typ: "seite", art: "archiv" });
    }
    const r = suche(p("archiv"), { ...u, server: { q: "", list: [] } });
    assert.equal(txtText(r.top.l1), "Archiv öffnen");
  });

  it("»vergangene« findet das Archiv als Bereich, das Raster „Wohin?“ bleibt bei neun", () => {
    const r = suche(p("vergangene"), { ...u, server: { q: "", list: [] } });
    assert.ok(r.groups.flatMap((g) => g.items ?? []).some((i) => i.ziel?.typ === "seite" && i.ziel.art === "archiv") || (r.top.ziel?.typ === "seite" && r.top.ziel.art === "archiv"));
    assert.equal(AREAS.length, 9);
    assert.ok(!AREAS.some((a) => a.key === "archiv"));
  });

  it("Kein Treffer", () => {
    const r = suche(p("mama anrufen"), { ...u, server: { q: "", list: [] } });
    assert.equal(txtText(r.top.l1), "Kein Treffer für »mama anrufen«");
  });
});

describe("Eintragen", () => {
  it("Dublette „Steht schon drin“", () => {
    assert.equal(dublette(v, "ma", "2026-10-13", "S. 84, Nr. 3–5")?.id, "a1");
    assert.equal(dublette(v, "ma", "2026-10-14", "S. 84, Nr. 3–5"), null);
  });

  it("Rückfrage „Bis wann?“: Morgen, Mittwoch, Nächste Stunde", () => {
    const t = rueckfrageTage(v, "bi", nextLesson(v, "bi", v.heute));
    assert.deepEqual(t, [["Morgen", "2026-10-13"], ["Mittwoch", "2026-10-14"], ["Nächste Stunde", "2026-10-15"]]);
  });

  it("„Mathe abgehakt“: der Toast nimmt kurz, nicht das Kürzel und nicht den Namen", () => {
    const [ma] = fachEintraege([{ id: "x", name: "Mathematik", short: "M" }]);
    assert.equal(`${ma.kurz} abgehakt`, "Mathe abgehakt");
    assert.equal(fachKurz("Biologie"), "Bio");
    assert.equal(fachKurz("Geschichte"), "Geschichte");
  });
});

describe("Vorschläge im leeren Menü", () => {
  it("Überblick: Wiederholen und Lernblock", () => {
    const s = suggestions({ v, jetzt: v.jetzt, ansicht: "ueberblick", undo: null, used: new Set() });
    assert.deepEqual(s.map((o) => `${txtText(o.l1)} | ${txtText(o.l2)}`), [
      "Wiederholen | Zuerst Geschichte · Industrialisierung in England",
      "Lernblock starten | Scheitelpunktform, 25 Minuten",
    ]);
  });
  it("Rückgängig steht vorn, dann drei", () => {
    const s = suggestions({ v, jetzt: v.jetzt, ansicht: "ueberblick", undo: { desc: "Mathe, S. 84" }, used: new Set() });
    assert.equal(txtText(s[0].l1), "Rückgängig: Mathe, S. 84");
    assert.equal(s.length, 3);
  });
  it("morgens: Woche und die Klausur dieser Woche", () => {
    const s = suggestions({ v, jetzt: v.jetzt, ansicht: "morgens", undo: null, used: new Set() });
    assert.deepEqual(s.map((o) => `${txtText(o.l1)} | ${txtText(o.l2)}`), ["Woche | 12.10. bis 16.10.", "Klausur Mathematik | Freitag, 16.10., in 4 Tagen"]);
  });
});
