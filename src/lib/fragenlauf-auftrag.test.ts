import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KEINE_ANWEISUNG_ABSCHRIFT } from "@/lib/abschrift-regeln";
import { CLAUDE_LANGSAM_TOK_S, CLAUDE_MAX_TOKENS, antwortFormat } from "@/lib/claude/client";
import {
  FRAGE,
  FRAGEN_ANTWORT,
  FRAGEN_FORM,
  FRAGEN_FRIST_MS,
  FRAGEN_MAX_TOKENS,
  FRAGEN_SYSTEM,
  PRO_LAUF,
  ZIEL_JE_KLAUSUR,
  bedarf,
  frageAus,
  fragenAuftrag,
  fragenEingabe,
  fragenErgebnis,
  fragenInhalt,
  notizMitHinweis,
  type FragenAntwort,
} from "@/lib/fragenlauf-auftrag";
import { TOOLS } from "@/lib/mcp/tools";
import { FRAGEN_MAX, NOTIZ_MAX, ZITAT_MAX } from "@/recall/proposals";

/**
 * Der Fragenlauf ohne Netz und ohne Datenbank: wann er fragt, was er sagt und
 * was er von der Antwort übernimmt.
 *
 * Bis zum 11.10.2026 stand das in harness/fragen.mts, und kein Test sah es —
 * der Ordner liegt außerhalb des Typprüfers. `bedarf()` hat dort am 12.9.2026
 * einen Fehler gehabt, den erst eine Abnahme fand (ein verworfener Vorschlag
 * kam wieder). Die fünf Fälle stehen hier deshalb einzeln.
 */

const STOCK = { items: 0, openQuestions: 0, discardedQuestions: 0 };
const EIN_THEMA = [{ id: "t", title: "T", subjectTopicId: "v", linked: true, pages: ["p"] }];
const EINE_SEITE = [{ id: "p", sortOrder: 0, chars: 10, transcript: "x", maschinell: false }];

/** Eine Frage, an der alles stimmt — die Grundlage jeder Abwandlung unten. */
const GUT = {
  page: "11111111-1111-1111-1111-111111111111",
  question: "Was besagt die Kettenregel?",
  solution: "Äußere Ableitung mal innere Ableitung.",
  misconception: "Man vergisst, mit der inneren Ableitung zu multiplizieren.",
  quote: "Man leitet also die äußere Funktion ab",
};

function antwort(teil: Partial<FragenAntwort>): FragenAntwort {
  return { questions: [], ergebnis: "vorschlag", grund: "", ...teil };
}

describe("bedarf — wann gar nicht gefragt wird", () => {
  it("nicht, solange Fragen unentschieden im Eingang liegen", () => {
    const was = bedarf({ topics: EIN_THEMA, pages: EINE_SEITE, stock: { ...STOCK, openQuestions: 3 } });
    assert.deepEqual(was, { nichts: "3 Fragen liegen noch unentschieden im Eingang" });
    assert.deepEqual(
      bedarf({ topics: EIN_THEMA, pages: EINE_SEITE, stock: { ...STOCK, openQuestions: 1 } }),
      { nichts: "1 Frage liegt noch unentschieden im Eingang" },
    );
  });

  it("nicht ohne Themen — und sagt das, nicht „keine Seite“", () => {
    const was = bedarf({ topics: [], pages: [], stock: STOCK });
    assert.match("nichts" in was ? was.nichts : "", /keine Themen/);
  });

  it("nicht ohne abgeschriebene Seite — mit dem Hinweis auf das falsche Fach", () => {
    const frei = [{ ...EIN_THEMA[0], linked: false, subjectTopicId: null, pages: [] }];
    const was = bedarf({ topics: [...frei, { ...EIN_THEMA[0], pages: [] }], pages: [], stock: STOCK });
    assert.match("nichts" in was ? was.nichts : "", /1 von 2 Themen sind mit keinem Thema des Fachs verbunden/);
    assert.deepEqual(bedarf({ topics: [{ ...EIN_THEMA[0], pages: [] }], pages: [], stock: STOCK }), {
      nichts: "keine abgeschriebene Seite zu den Themen dieser Prüfung",
    });
  });

  it("nicht, wenn der Mensch schon Nein gesagt und nichts übernommen hat", () => {
    const was = bedarf({ topics: EIN_THEMA, pages: EINE_SEITE, stock: { ...STOCK, discardedQuestions: 5 } });
    assert.match("nichts" in was ? was.nichts : "", /5 Fragen hast du schon abgelehnt/);
    // Hat er etwas übernommen, war das Nein keines zum ganzen Stoff.
    assert.deepEqual(
      bedarf({ topics: EIN_THEMA, pages: EINE_SEITE, stock: { ...STOCK, items: 2, discardedQuestions: 5 } }),
      { wieviele: PRO_LAUF },
    );
  });

  it("nicht, wenn das Ziel erreicht ist", () => {
    const was = bedarf({ topics: EIN_THEMA, pages: EINE_SEITE, stock: { ...STOCK, items: ZIEL_JE_KLAUSUR } });
    assert.deepEqual(was, { nichts: `${ZIEL_JE_KLAUSUR} Bausteine sind genug (Ziel ${ZIEL_JE_KLAUSUR})` });
  });

  it("sonst so viele, wie zum Ziel fehlen — höchstens PRO_LAUF", () => {
    assert.equal(ZIEL_JE_KLAUSUR, 24);
    assert.equal(PRO_LAUF, 12);
    assert.deepEqual(bedarf({ topics: EIN_THEMA, pages: EINE_SEITE, stock: STOCK }), { wieviele: 12 });
    assert.deepEqual(
      bedarf({ topics: EIN_THEMA, pages: EINE_SEITE, stock: { ...STOCK, items: 20 } }),
      { wieviele: 4 },
    );
  });
});

describe("der Systemtext", () => {
  it("stellt die Regel gegen Anweisungen vor alles andere", () => {
    const regel = FRAGEN_SYSTEM.indexOf(KEINE_ANWEISUNG_ABSCHRIFT);
    assert.ok(regel > 0);
    assert.ok(regel < FRAGEN_SYSTEM.indexOf(TOOLS.read_exam_material.description));
    assert.match(FRAGEN_SYSTEM, /Schreib es in grund und mach sonst nichts damit/);
  });

  it("trägt die Beschreibungen der beiden Werkzeuge Wort für Wort — und sagt, dass es keine sind", () => {
    assert.ok(FRAGEN_SYSTEM.includes(TOOLS.read_exam_material.description));
    assert.ok(FRAGEN_SYSTEM.includes(TOOLS.propose_questions.description));
    assert.match(FRAGEN_SYSTEM, /Werkzeuge gibt es dabei keine/);
    assert.match(FRAGEN_SYSTEM, /beide sind hier keine Werkzeuge/);
  });
});

describe("der Auftrag", () => {
  const auftrag = fragenAuftrag({ fach: "Mathematik", tag: "Dienstag, 20. Oktober", wieviele: 7 });

  it("nennt Fach, Tag und die bestellte Zahl", () => {
    assert.match(auftrag, /Prüfung in Mathematik am Dienstag, 20\. Oktober/);
    assert.match(auftrag, /schreib 7 Fragen dazu/);
  });

  it("verlangt die Verteilung über ALLE Themen und das herauskopierte Zitat", () => {
    assert.match(auftrag, /Verteile sie über ALLE Themen/);
    assert.match(auftrag, /Kopiere es heraus, statt es aufzuschreiben/);
    assert.match(auftrag, /lieber vier gute Fragen als zwölf/);
  });

  it("schickt das Modell zu keinem Werkzeug", () => {
    assert.doesNotMatch(auftrag, /\b(read|propose)_[a-z_]+/);
    assert.doesNotMatch(auftrag, /\bRuf\b/);
  });

  it("legt den Stoff als Text unter den Auftrag — genau wie read_exam_material ihn liefert", () => {
    const inhalt = fragenInhalt(
      { fach: "Mathematik", tag: "heute", wieviele: 3 },
      { satz: "Satz.", daten: { a: 1 } as never },
    );
    assert.deepEqual(inhalt, [
      { type: "text", text: fragenAuftrag({ fach: "Mathematik", tag: "heute", wieviele: 3 }) },
      { type: "text", text: 'Satz.\n{"a":1}' },
    ]);
  });

  it("hat eine Frist, die länger ist, als max_tokens bei langsamer API braucht", () => {
    // Bis zur Abnahme vom 11.10.2026 eine Viertelstunde für 64 000 Tokens:
    // eine Antwort, die nicht aufhörte, endete an der eigenen Frist als
    // „später“ — bezahlt und ohne eine Frage — statt an max_tokens.
    assert.equal(FRAGEN_MAX_TOKENS, CLAUDE_MAX_TOKENS);
    assert.ok(FRAGEN_FRIST_MS > (FRAGEN_MAX_TOKENS / CLAUDE_LANGSAM_TOK_S) * 1000);
    assert.equal(Math.round(FRAGEN_FRIST_MS / 60_000), 46);
  });
});

describe("die Form der Antwort", () => {
  const pq = TOOLS.propose_questions.args.shape;

  it("ist das Schema von propose_questions — dasselbe Objekt, nicht nachgebaut", () => {
    assert.equal(FRAGE, pq.questions.element);
    assert.equal(FRAGEN_FORM.shape.questions.element, pq.questions.element);
    assert.equal(FRAGEN_FORM.shape.note, pq.note);
    assert.equal(FRAGEN_FORM.shape.questions.description, pq.questions.description);
  });

  it("hat kein `exam` — welche Klausur gemeint ist, weiß die App", () => {
    assert.equal("exam" in FRAGEN_FORM.shape, false);
  });

  it("und die Prüfung hat dieselben Felder", () => {
    assert.deepEqual(Object.keys(FRAGEN_ANTWORT.shape), Object.keys(FRAGEN_FORM.shape));
  });

  it("zwingt der API keine Mindestzahl auf — „kein-vorschlag“ braucht keine erfundene Frage", () => {
    const json = antwortFormat(FRAGEN_FORM).schema as {
      properties: { questions: { minItems?: number; description?: string; items: { properties: Record<string, { description?: string }> } } };
    };
    assert.equal(json.properties.questions.minItems, undefined);
    assert.match(json.properties.questions.description ?? "", new RegExp(`maxItems: ${FRAGEN_MAX}`));
    // Die Sätze der freiwilligen Felder kommen an (das SDK allein verlöre sie).
    const topic = json.properties.questions.items.properties.topic?.description ?? "";
    assert.ok(topic.startsWith(pq.questions.element.shape.topic.description ?? "∅"));
  });

  it("lässt die Antwort als Ganzes durch, auch wenn eine Frage zu lang ist", () => {
    const geprueft = FRAGEN_ANTWORT.safeParse({
      questions: [{ ...GUT, quote: "x".repeat(ZITAT_MAX + 1) }, GUT],
      ergebnis: "vorschlag",
      grund: "",
    });
    assert.equal(geprueft.success, true);
  });
});

describe("frageAus — jede Frage einzeln", () => {
  it("nimmt eine Frage, an der alles stimmt", () => {
    const ergebnis = frageAus(GUT, 1);
    assert.deepEqual(ergebnis, { frage: GUT, hinweise: [] });
  });

  it("verwirft ein Thema, das keine id sein kann, und behält die Frage", () => {
    const ergebnis = frageAus({ ...GUT, topic: "x".repeat(65) }, 2);
    assert.ok("frage" in ergebnis);
    assert.equal("frage" in ergebnis ? ergebnis.frage.topic : "", undefined);
    assert.deepEqual("frage" in ergebnis ? ergebnis.hinweise : [], ["Frage 2: Thema verworfen"]);
  });

  it("verwirft eine Art, die es nicht gibt, und behält die Frage", () => {
    const ergebnis = frageAus({ ...GUT, kind: "meinung" }, 3);
    assert.ok("frage" in ergebnis);
    assert.deepEqual("frage" in ergebnis ? ergebnis.hinweise : [], ["Frage 3: Art verworfen"]);
  });

  it("lässt eine Frage mit zu langem Zitat weg — und sagt, woran es lag", () => {
    const ergebnis = frageAus({ ...GUT, quote: "x".repeat(ZITAT_MAX + 1) }, 4);
    assert.ok("weg" in ergebnis);
    assert.match("weg" in ergebnis ? ergebnis.weg : "", /^Frage 4 weggelassen \(Zitat: /);
  });

  it("lässt eine Frage ohne Verwechslungssatz weg", () => {
    const ohne: Record<string, unknown> = { ...GUT };
    delete ohne.misconception;
    assert.match(String((frageAus(ohne, 5) as { weg: string }).weg), /Verwechslung/);
  });

  it("lässt weg, was gar keine Frage ist, und ein Feld, das es am Werkzeug nicht gibt", () => {
    assert.ok("weg" in frageAus("Frage", 6));
    assert.ok("weg" in frageAus([GUT], 7));
    assert.ok("weg" in frageAus({ ...GUT, exam: "andere" }, 8));
  });
});

describe("fragenEingabe", () => {
  it("nimmt „kein-vorschlag“ mit dem Grund des Modells", () => {
    assert.deepEqual(fragenEingabe(antwort({ ergebnis: "kein-vorschlag", grund: " nur Überschriften " })), {
      art: "kein-vorschlag",
      grund: "nur Überschriften",
    });
    assert.deepEqual(fragenEingabe(antwort({ ergebnis: "kein-vorschlag" })), {
      art: "kein-vorschlag",
      grund: "ohne Angabe",
    });
  });

  it("ist „nichts“, wenn keine Frage standhält", () => {
    const leer = fragenEingabe(antwort({}));
    assert.equal(leer.art, "nichts");
    const kaputt = fragenEingabe(antwort({ questions: [{ ...GUT, quote: "kurz" }] }));
    assert.equal(kaputt.art, "nichts");
    assert.match(kaputt.art === "nichts" ? kaputt.grund : "", /Keine der Fragen hielt der Prüfung stand; Frage 1 weggelassen/);
  });

  it("nimmt die guten, lässt die schlechte weg und sagt es in der Notiz", () => {
    const eingabe = fragenEingabe(
      antwort({
        questions: [GUT, { ...GUT, quote: "x".repeat(ZITAT_MAX + 1) }, { ...GUT, topic: "v", kind: "verfahren" }],
        note: "Thema 2 hat nur eine Seite.",
      }),
    );
    assert.equal(eingabe.art, "vorschlag");
    if (eingabe.art !== "vorschlag") return;

    assert.equal(eingabe.genannt, 3);
    assert.deepEqual(
      eingabe.fragen.map((f) => [f.pageId, f.subjectTopicId, f.materialKind]),
      [
        [GUT.page, null, undefined],
        [GUT.page, "v", "verfahren"],
      ],
    );
    assert.equal(
      eingabe.note,
      "Thema 2 hat nur eine Seite. Die App hat eine Frage weggelassen, die nicht in die Grenzen passte.",
    );
    assert.match(eingabe.hinweise[0] ?? "", /^Frage 2 weggelassen/);
  });
});

describe("notizMitHinweis", () => {
  it("bleibt unter NOTIZ_MAX und kürzt die Notiz, nicht den Satz der App", () => {
    const lang = "a".repeat(NOTIZ_MAX);
    const notiz = notizMitHinweis(lang, 2) ?? "";
    assert.ok(notiz.length <= NOTIZ_MAX, String(notiz.length));
    assert.match(notiz, /…/);
    assert.match(notiz, /Die App hat 2 Fragen weggelassen, die nicht in die Grenzen passten\.$/);
  });

  it("kürzt eine zu lange Notiz auch ohne weggelassene Frage — und lässt eine leere leer", () => {
    assert.equal((notizMitHinweis("b".repeat(NOTIZ_MAX + 10), 0) ?? "").length, NOTIZ_MAX);
    assert.equal(notizMitHinweis(null, 0), null);
    assert.equal(notizMitHinweis(null, 1), "Die App hat eine Frage weggelassen, die nicht in die Grenzen passte.");
  });
});

describe("fragenErgebnis", () => {
  const eingabe = {
    art: "vorschlag" as const,
    fragen: [{ pageId: "p", promptFree: "f", solution: "s", misconception: "m", sourceQuote: "q" }],
    note: null,
    genannt: 1,
    hinweise: ["Frage 2 weggelassen (Zitat: zu lang)"],
  };

  it("zählt, was im Eingang liegt — und nennt die bestellte Zahl, wenn sie abweicht", () => {
    const { ergebnis, grund } = fragenErgebnis({ ok: true, fragen: 1, themenVerworfen: 0 }, eingabe, 12, "mehr war nicht drin");
    assert.equal(ergebnis, "vorschlag");
    assert.equal(
      grund,
      "1 Frage liegt im Eingang (bestellt waren 12); Frage 2 weggelassen (Zitat: zu lang); Claude: mehr war nicht drin",
    );
  });

  it("sagt, was die Ablage still weggelassen hat", () => {
    const zwei = { ...eingabe, fragen: [...eingabe.fragen, ...eingabe.fragen], hinweise: [] };
    const { grund } = fragenErgebnis({ ok: true, fragen: 1, themenVerworfen: 1 }, zwei, 1, "");
    assert.equal(
      grund,
      "1 Frage liegt im Eingang; 1 auf einer Seite außerhalb des Stoffs weggelassen; bei 1 das Thema verworfen (nicht aus dem Fach der Klausur)",
    );
  });

  it("ist „nichts“, wenn die Ablage abweist — mit einem Satz für den Menschen", () => {
    const { ergebnis, grund } = fragenErgebnis({ ok: false, grund: "fremde-seiten" }, eingabe, 12, "");
    assert.equal(ergebnis, "nichts");
    assert.match(grund, /^Keine der Fragen nannte eine Seite aus dem Stoff dieser Klausur\./);
  });
});
