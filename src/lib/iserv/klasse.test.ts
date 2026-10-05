import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { istFreiTitel, klassenIn, normalisiere, urteil, type FilterConfig } from "@/lib/iserv/klasse";

/**
 * Der Filter „betrifft das meine Klasse?" an erfundenen Titeln, die den
 * MUSTERN eines echten öffentlichen Kalenders folgen — kein Titel ist von
 * dort abgeschrieben. Lehrerkürzel sind „Xy", Namen gibt es keine. Die Fälle
 * folgen dem Prototyp vom 5.10.2026 (61 Titel, 5 Konfigurationen), dazu die
 * Erweiterungen: Jahrgang, „ab Klasse …", Ferien nur ganztägig, Zahlwörter,
 * Datum direkt hinter der Klasse und „kein Klassenbezug ist nicht für alle“.
 */

const K10: FilterConfig = { klasse: 10, auch: [], nie: [] };

type Fall = [titel: string, nehmen: boolean, regel: string];

const FAELLE: Fall[] = [
  // (a) die eigene Klasse
  ["10.Kl_Wandertag zum Müggelsee", true, "eigene-klasse"],
  ["Kl. 10_Theaterbesuch", true, "eigene-klasse"],
  ["10. Klasse: Praktikumsbeginn", true, "eigene-klasse"],
  ["Klasse 10 Sportfest", true, "eigene-klasse"],
  ["10. Kl. Abgabe Jahresarbeit", true, "eigene-klasse"],
  ["KL. 10_Exkursion", true, "eigene-klasse"],
  ["Kl.10 Fotos", true, "eigene-klasse"],
  ["10. Klassenfahrt Erzgebirge", true, "eigene-klasse"],
  ["Klassen 9 und 10_Projekttag", true, "bereich"],
  ["9./10. Kl Chorprobe", true, "bereich"],
  ["9.+10. Kl_Theater", true, "bereich"],
  // (b) Bereiche, die sie einschließen
  ["Nachschreibklausur_7. - 12. Kl_Xy", true, "bereich"],
  ["Nachschreibklausur_7.–12. Kl_Xy", true, "bereich"],
  ["Unterrichtsende Klassen 1-12", true, "bereich"],
  ["Wandertag Klassen 5 bis 12", true, "bereich"],
  ["Sportfest alle Klassen", true, "bereich"],
  // (c) für alle, und der Unterricht ist betroffen
  ["Herbstferien_Sa. 24. 10. – Sa. 7. 11. 2026", true, "alle-unterricht"],
  ["Sommerferien", true, "alle-unterricht"],
  ["Pfingstferien Sa. 15.5. – Di. 18.5.", true, "alle-unterricht"],
  ["Beweglicher Ferientag", true, "alle-unterricht"],
  ["4. Pädagogischer Tag_unterrichtsfrei", true, "alle-unterricht"],
  ["Schulfrei wegen Wahl", true, "alle-unterricht"],
  ["Michaelifest_Schulsamstag", true, "alle-unterricht"],
  ["Unterrichtsende um 11:30 Uhr", true, "alle-unterricht"],
  ["Heute kein Unterricht!", true, "alle-unterricht"],
  ["Tag der offenen Tür_Schule geschlossen", true, "alle-unterricht"],
  ["Elternsprechtag_Unterricht endet nach der 4. Stunde", true, "unterricht-trotz-marker"],
  // andere Klassen
  ["9.Kl_Forstpraktikum", false, "fremde-klasse"],
  ["Kl. 9_Exkursion", false, "fremde-klasse"],
  ["11. Kl._Berufsorientierung", false, "fremde-klasse"],
  ["12.Kl_Klassenspiel", false, "fremde-klasse"],
  ["8. Klassenspiel", false, "fremde-klasse"],
  ["EA 6.Kl", false, "fremde-klasse"],
  ["12.Kl+13.KL_Für die Klassen 12 und 13 unterrichtsfrei", false, "fremde-klasse"],
  ["Klassen 1-4_Fasching, danach kein Unterricht", false, "fremde-klasse"],
  ["Kl. 7–9 Wandertag", false, "fremde-klasse"],
  ["am 3.10. Kl. 8 Ausflug", false, "fremde-klasse"],
  // Eltern, Gremien, Hort, Kurse
  ["EA 10. Kl.", false, "marker"],
  ["Elternabend Klasse 10", false, "marker"],
  ["Gartenkreis", false, "marker"],
  ["Inklusionskreis", false, "marker"],
  ["Basarkreistreffen_digital", false, "marker"],
  ["Elternbeirat", false, "marker"],
  ["SGK_Jahresplanung", false, "marker"],
  ["Pädagogische Konferenz", false, "marker"],
  ["Hort_Ferienbetreuung_26.10.-06.11.", false, "marker"],
  ["Hort_Schließzeit 24.12. - 01.01.", false, "marker"],
  ["Infoabend Oberstufe", false, "marker"],
  ["LF/gf Physik_Probeklausur", false, "kurs"],
  ["LF Chemie/ LF Musik_Probeklausur", false, "kurs"],
  ["Abitur schriftlich Mathe", false, "kurs"],
  // Stufen — nur zum Ausschließen
  ["Fasching in der Unterstufe, danach kein Unterricht", false, "fremde-stufe"],
  ["Mittelstufe Wandertag", false, "fremde-stufe"],
  ["Oberstufe: unterrichtsfrei", false, "eigene-stufe"],
  // ohne Bezug — im Zweifel draußen
  ["Gartensamstag", false, "ohne-bezug"],
  ["Konzert der Chor-AG", false, "ohne-bezug"],
  ["MSA_Prüfung Präsentation", false, "ohne-bezug"],
  ["Probeklausur Deutsch", false, "ohne-bezug"],
  // Wörter, die wie Klassen aussehen
  ["1. + 2. Pädagogischer Tag_unterrichtsfrei (3. Pädagogischer Tag: Mo, 30.11.26)", true, "alle-unterricht"],
  ["Klausurenwoche", false, "ohne-bezug"],
  ["", false, "leer"],
];

describe("urteil — die 61 Titel des Prototyps", () => {
  it("sind 61", () => {
    assert.equal(FAELLE.length, 61);
  });

  for (const [titel, nehmen, regel] of FAELLE) {
    it(`${titel || "(leer)"} → ${nehmen ? "rein" : "raus"} (${regel})`, () => {
      // Ganztägig, wie IServ Ferien und Tage schreibt …
      const u = urteil({ titel, ganztaegig: true }, K10);
      assert.equal(u.nehmen, nehmen, `${titel}: ${JSON.stringify(u)}`);
      assert.equal(u.regel, regel, `${titel}: ${JSON.stringify(u)}`);

      // … und mit Uhrzeit dasselbe — außer bei Ferien, die zählen nur ganztägig.
      if (!/ferien(?!betreuung)/i.test(titel)) {
        const mitUhrzeit = urteil({ titel, ganztaegig: false }, K10);
        assert.equal(mitUhrzeit.regel, regel, `${titel} mit Uhrzeit`);
      }
    });
  }
});

describe("urteil — Zweifel und knapp", () => {
  it("markiert, was knapp draußen bleibt, als Zweifel", () => {
    const zweifel = (titel: string) => {
      const u = urteil({ titel, ganztaegig: true }, K10);
      return !u.nehmen && u.zweifel;
    };

    assert.ok(zweifel("EA 10. Kl."), "Elternabend der eigenen Klasse");
    assert.ok(zweifel("MSA_Prüfung Präsentation"));
    assert.ok(zweifel("Faschingsfeier der Unterstufe_anschließend unterrichtsfrei"));
    assert.ok(zweifel("Oberstufe: unterrichtsfrei"));
    assert.ok(!zweifel("Gartenkreis"));
    assert.ok(!zweifel("Kl. 9_Exkursion"));
    assert.ok(!zweifel("LF/gf Physik_Probeklausur"));
  });

  it("nimmt „Schule und Hort geschlossen“ knapp auf", () => {
    const u = urteil({ titel: "Brückentag_Schule und Hort geschlossen", ganztaegig: true }, K10);
    assert.ok(u.nehmen && u.knapp);
    assert.equal(u.regel, "unterricht-trotz-marker");
  });

  it("nennt einen kurzen deutschen Grund", () => {
    assert.equal(urteil({ titel: "Kl. 9_Exkursion", ganztaegig: false }, K10).grund, "andere Klasse 9");
    assert.equal(urteil({ titel: "Nachschreibklausur_7. - 12. Kl_Xy", ganztaegig: false }, K10).grund, "Klassen 7–12");
    assert.equal(urteil({ titel: "EA 10. Kl.", ganztaegig: false }, K10).grund, "Elternabend");
    assert.equal(urteil({ titel: "Gartensamstag", ganztaegig: false }, K10).grund, "kein Bezug zu Klasse 10 erkennbar");
  });
});

describe("urteil — die drei Erweiterungen", () => {
  it("Ferien zählen nur ganztägig: eine „Ferien-AG“ um 15:30 ist eine AG", () => {
    assert.equal(urteil({ titel: "Ferien-AG Töpfern", ganztaegig: false }, K10).regel, "ohne-bezug");
    assert.equal(urteil({ titel: "Herbstferien", ganztaegig: true }, K10).regel, "alle-unterricht");
    assert.equal(urteil({ titel: "Herbstferien", ganztaegig: false }, K10).nehmen, false);
  });

  it("„ab Klasse 7“ ist ein Bereich bis 13", () => {
    assert.equal(urteil({ titel: "ab Klasse 7 Wandertag", ganztaegig: true }, K10).regel, "bereich");
    assert.equal(urteil({ titel: "Projektwoche ab der 7. Klasse", ganztaegig: true }, K10).regel, "bereich");
    assert.equal(urteil({ titel: "ab Klasse 11 Studienfahrt", ganztaegig: true }, K10).regel, "fremde-klasse");
    assert.deepEqual([...klassenIn(normalisiere("ab Kl. 12"))], [12, 13]);
  });

  it("Jahrgang und Jg. sind Anker wie „Kl.“", () => {
    assert.equal(urteil({ titel: "Jg. 9 Exkursion", ganztaegig: false }, K10).regel, "fremde-klasse");
    assert.equal(urteil({ titel: "Jahrgangsstufe 10: Infoveranstaltung", ganztaegig: false }, K10).regel, "eigene-klasse");
    assert.equal(urteil({ titel: "Jahrgang 10_Praktikum", ganztaegig: false }, K10).regel, "eigene-klasse");
  });
});

describe("urteil — ISERV_AUCH, ISERV_NIE und eine andere Klasse", () => {
  it("die fünf Konfigurationen des Prototyps", () => {
    const cfg: FilterConfig = { klasse: 10, auch: ["msa"], nie: ["nachschreibklausur"] };
    assert.equal(urteil({ titel: "MSA_Prüfung Präsentation", ganztaegig: true }, cfg).nehmen, true);
    assert.equal(urteil({ titel: "Nachschreibklausur_7. - 12. Kl_Xy", ganztaegig: false }, cfg).nehmen, false);

    const k9: FilterConfig = { klasse: 9, auch: [], nie: [] };
    assert.equal(urteil({ titel: "Kl. 9_Exkursion", ganztaegig: false }, k9).nehmen, true);
    assert.equal(urteil({ titel: "Kl. 10_Vorstellung", ganztaegig: false }, k9).nehmen, false);
    assert.equal(urteil({ titel: "Nachschreibklausur_7. - 12. Kl_Xy", ganztaegig: false }, k9).nehmen, true);
  });

  it("AUCH trifft nur ganze Wörter: „msa“ trifft „MSA_…“, aber nicht „Gemsa“", () => {
    const cfg: FilterConfig = { klasse: 10, auch: ["msa"], nie: [] };
    const msa = urteil({ titel: "MSA_Prüfung Präsentation", ganztaegig: true }, cfg);
    assert.equal(msa.regel, "auch");

    const gemsa = urteil({ titel: "Gemsa-Lauf im Park", ganztaegig: false }, cfg);
    assert.notEqual(gemsa.regel, "auch");
    assert.equal(gemsa.nehmen, false);
  });

  it("„ea 10“ als Ausnahme holt den Elternabend herein, aber nicht „EA 100“", () => {
    const cfg: FilterConfig = { klasse: 10, auch: [normalisiere("EA 10")], nie: [] };
    assert.equal(urteil({ titel: "EA 10. Kl.", ganztaegig: false }, cfg).regel, "auch");
    assert.notEqual(urteil({ titel: "EA 100 Jahre Schule", ganztaegig: false }, cfg).regel, "auch");
  });

  it("NIE schlägt AUCH", () => {
    const cfg: FilterConfig = { klasse: 10, auch: ["msa"], nie: ["msa"] };
    const u = urteil({ titel: "MSA_Prüfung Präsentation", ganztaegig: true }, cfg);
    assert.equal(u.nehmen, false);
    assert.equal(u.regel, "nie");
  });

  it("ISERV_KLASSE=9: Mittelstufe ist fremd, Oberstufe eigen", () => {
    const k9: FilterConfig = { klasse: 9, auch: [], nie: [] };
    assert.equal(urteil({ titel: "Oberstufe: unterrichtsfrei", ganztaegig: true }, k9).regel, "eigene-stufe");
    assert.equal(urteil({ titel: "Kl. 7–9 Wandertag", ganztaegig: true }, k9).regel, "bereich");
    assert.equal(urteil({ titel: "EA 10. Kl.", ganztaegig: false }, k9).regel, "fremde-klasse");
  });
});

describe("urteil — kein Klassenbezug heißt nicht „für alle“", () => {
  // Jeder dieser Titel betrifft eine ANDERE Klasse oder eine Gruppe, die der
  // Filter nicht lesen kann — keiner darf als „für alle“ hineinkommen.
  const FREMD: [titel: string, regel: string][] = [
    ["Kl. 11_ 19.10.-30.10. Sozialpraktikum_unterrichtsfrei", "fremde-klasse"],
    ["Kl. 12_ 15.03. Abschlussfahrt, kein Unterricht", "fremde-klasse"],
    ["Jahrgänge 11-13_unterrichtsfrei", "fremde-klasse"],
    ["Projektwoche Kl. 9 - 10 Uhr Treffpunkt", "fremde-klasse"],
    ["Elfte Klasse Praktikum unterrichtsfrei", "fremde-klasse"],
    ["Zwölftklassspiel_Unterrichtsende 11:30 Uhr", "fremde-klasse"],
    ["Achtklassspiel – kein Unterricht in der 1. Stunde", "fremde-klasse"],
    ["Kein Unterricht für die 12er (Abschlussfahrt)", "klassenbezug-unklar"],
    ["Unterrichtsende für 7er-9er", "klassenbezug-unklar"],
    ["9a_Unterrichtsende 11:30", "klassenbezug-unklar"],
    ["Abschlussklassen: kein Unterricht", "klassenbezug-unklar"],
    ["Q1 unterrichtsfrei", "klassenbezug-unklar"],
    ["Unterrichtsende für die 9. um 11 Uhr", "klassenbezug-unklar"],
    ["Klassenfahrt, kein Unterricht", "klassenbezug-unklar"],
    ["Elternabend der 12er – kein Unterricht", "marker"],
  ];

  for (const [titel, regel] of FREMD) {
    it(`${titel} → raus (${regel})`, () => {
      const u = urteil({ titel, ganztaegig: true }, K10);
      assert.equal(u.nehmen, false, `${titel}: ${JSON.stringify(u)}`);
      assert.equal(u.regel, regel, `${titel}: ${JSON.stringify(u)}`);
    });
  }

  it("schiebt einen unklaren Bezug in die Zweifel, nicht ins Nichts", () => {
    const u = urteil({ titel: "Q1 unterrichtsfrei", ganztaegig: true }, K10);
    assert.ok(!u.nehmen && u.zweifel);
  });

  it("liest die eigene Klasse auch mit Datum dahinter und als Zahlwort", () => {
    assert.equal(urteil({ titel: "Kl. 10_12.10. Theaterbesuch", ganztaegig: false }, K10).regel, "eigene-klasse");
    assert.equal(urteil({ titel: "Kl. 10_Theaterbesuch_12.10.", ganztaegig: false }, K10).regel, "eigene-klasse");
    assert.equal(urteil({ titel: "Zehntklässler: Praktikum, unterrichtsfrei", ganztaegig: true }, K10).regel, "eigene-klasse");
    assert.equal(urteil({ titel: "Zehnte Klasse_Wandertag", ganztaegig: true }, K10).regel, "eigene-klasse");
  });

  it("lässt „nach der 4. Stunde“ und „der 3. Pädagogische Tag“ für alle gelten", () => {
    assert.equal(urteil({ titel: "Unterrichtsende nach der 4. Stunde", ganztaegig: false }, K10).regel, "alle-unterricht");
    assert.equal(
      urteil({ titel: "Unterrichtsfrei: der 3. Pädagogische Tag", ganztaegig: true }, K10).regel,
      "alle-unterricht",
    );
  });
});

describe("urteil — ISERV_AUCH holt keine fremde Klasse", () => {
  it("prüft die fremde Klasse VOR der Ausnahme", () => {
    const cfg: FilterConfig = { klasse: 10, auch: ["präsentation", "konzert"], nie: [] };

    assert.equal(urteil({ titel: "9.Kl_Präsentation_Forstpraktikum", ganztaegig: false }, cfg).regel, "fremde-klasse");
    assert.equal(urteil({ titel: "Konzert der 5. Klasse", ganztaegig: false }, cfg).regel, "fremde-klasse");
    assert.equal(urteil({ titel: "Konzert der Unterstufe", ganztaegig: false }, cfg).regel, "fremde-stufe");
    assert.equal(urteil({ titel: "Konzert der Chor-AG", ganztaegig: false }, cfg).regel, "auch");
    assert.equal(urteil({ titel: "Kl. 10_Präsentation", ganztaegig: false }, cfg).regel, "auch");
  });
});

describe("urteil — Klasse unsicher (neues Schuljahr?)", () => {
  const UNSICHER: FilterConfig = { klasse: 10, auch: ["ea 10"], nie: [], klasseUnsicher: true };

  it("nimmt keinen Termin, der die eingestellte Klasse nennt — auch nicht per ISERV_AUCH", () => {
    for (const titel of ["Kl. 10_Vorstellung", "Nachschreibklausur_7. - 12. Kl_Xy", "EA 10. Kl."]) {
      const u = urteil({ titel, ganztaegig: false }, UNSICHER);
      assert.equal(u.nehmen, false, titel);
      assert.equal(u.regel, "klasse-unsicher", titel);
      assert.ok(!u.nehmen && u.zweifel, titel);
    }
  });

  it("lässt Termine für alle und fremde Klassen, wie sie sind", () => {
    assert.equal(urteil({ titel: "Herbstferien", ganztaegig: true }, UNSICHER).regel, "alle-unterricht");
    assert.equal(urteil({ titel: "Kl. 9_Exkursion", ganztaegig: false }, UNSICHER).regel, "fremde-klasse");
  });
});

describe("istFreiTitel", () => {
  it("erkennt Ferien (ganztägig) und unterrichtsfreie Tage — aber keinen Schultag", () => {
    assert.ok(istFreiTitel({ titel: "Herbstferien_Sa. 24. 10. – Sa. 7. 11. 2026", ganztaegig: true }));
    assert.ok(istFreiTitel({ titel: "3.Pädagogischer Tag_unterrichtsfrei", ganztaegig: true }));
    assert.ok(istFreiTitel({ titel: "Brückentag_Schule und Hort geschlossen", ganztaegig: true }));
    assert.ok(!istFreiTitel({ titel: "Herbstferien", ganztaegig: false }));
    assert.ok(!istFreiTitel({ titel: "Adventsbasar_Schulsamstag", ganztaegig: true }));
    assert.ok(!istFreiTitel({ titel: "Unterrichtsende um 11:30 Uhr", ganztaegig: true }));
    assert.ok(!istFreiTitel({ titel: "Epochenheft Geschichte abgeben", ganztaegig: true }));
  });
});

describe("normalisiere und klassenIn", () => {
  it("macht „_“, NBSP und alle Striche gleich", () => {
    assert.equal(normalisiere("  Kl. 10_Wandertag–Tag  "), "kl. 10 wandertag-tag");
  });

  it("liest keine Klasse aus einem Datum", () => {
    assert.deepEqual([...klassenIn(normalisiere("Herbstferien_Sa. 24. 10. – Sa. 7. 11. 2026"))], []);
    assert.deepEqual([...klassenIn(normalisiere("am 3.10. Kl. 8 Ausflug"))], [8]);
    assert.deepEqual([...klassenIn(normalisiere("Klausur am 10.11."))], []);
  });

  it("liest Zahlwörter und lässt Jahreszahlen und Uhrzeiten liegen", () => {
    assert.deepEqual([...klassenIn(normalisiere("Achtklassspiel"))], [8]);
    assert.deepEqual([...klassenIn(normalisiere("Elfte Klasse"))], [11]);
    assert.deepEqual([...klassenIn(normalisiere("Jg. 2010"))], []);
    assert.deepEqual([...klassenIn(normalisiere("Kl. 9 - 10:30 Uhr"))], [9]);
    assert.deepEqual([...klassenIn(normalisiere("Kl. 10.11. Ausflug"))], []);
  });

  it("verwirft Zahlen außerhalb von 1 bis 13 und umgekehrte Bereiche", () => {
    assert.deepEqual([...klassenIn(normalisiere("Klasse 14"))], []);
    assert.deepEqual([...klassenIn(normalisiere("Klassen 12-7"))], []);
  });
});
