import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, todayInBerlin } from "@/lib/dates";
import {
  PROPOSAL_TOPIC_LIMIT,
  prefillFromProposal,
  proposalInputSchema,
  type Prefill,
  type PrefillMaterial,
  type PrefillProposal,
} from "@/lib/inbox";
import { MATERIAL_NOTE_MAX, MATERIAL_TITLE_MAX } from "@/lib/materials";

/**
 * Die reinen Teile von @/lib/inbox: die Rechnung, aus der die Vorbelegung des
 * Handformulars wird, und das Schema, das einen Vorschlag annimmt oder nicht.
 *
 * Beide entscheiden, was der Nutzer beim Bestätigen zu sehen bekommt, und
 * beide kommen ohne Datenbank aus. Was hier nicht steht, ist Absicht: alles,
 * was liest oder schreibt, gehört in einen Test mit echter Datenbank und nicht
 * in eine nachgebaute. Warum ein Import dieser Datei trotzdem keine PGlite
 * öffnet, steht im Kopf von materials.test.ts.
 *
 * Der teuerste Fehler, den diese Datei abfangen soll, ist der stille: ein
 * Vorschlag, der schweigt, darf am Blatt nichts löschen. Auf dem Bildschirm
 * sähe das nach nichts aus — und beim Übernehmen wären die Themen weg.
 */

const MATHE = "3f7c1a2e-8b4d-4c9a-9e51-0d6f2a7b1c34";
const PHYSIK = "9a1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d";

/**
 * Der Schultag des Beispielvorschlags — eine Woche zurück, aus derselben
 * Quelle gerechnet wie im Schema. Ein fest eingetragener Tag wäre irgendwann
 * Zukunft und der ganze Testlauf rot, an einem Tag, an dem niemand etwas
 * geändert hat.
 */
const SCHULTAG = addDays(todayInBerlin(), -7);

/** Das Blatt, so wie es dasteht. Jeder Test tauscht nur das eine Feld. */
function blatt(overrides: Partial<PrefillMaterial> = {}): PrefillMaterial {
  return {
    subjectId: MATHE,
    subjectName: "Mathematik",
    title: "Blatt vom 10.1.",
    capturedOn: "2026-01-10",
    note: null,
    topics: ["Kettenregel", "Ableitungen"],
    ...overrides,
  };
}

/**
 * Ein Vorschlag, der zu allem schweigt — der Ausgangspunkt jedes Tests. Genau
 * so kommt er auch aus der Datenbank, wenn ein Agent nur ein einziges Feld
 * gefüllt hat.
 */
function vorschlag(overrides: Partial<PrefillProposal> = {}): PrefillProposal {
  return {
    subjectId: null,
    subjectName: null,
    title: null,
    capturedOn: null,
    note: null,
    topics: [],
    ...overrides,
  };
}

/** Welche Felder die Gegenüberstellung nennt, in ihrer Reihenfolge. */
function felder(prefill: Prefill): string[] {
  return prefill.aenderungen.map((change) => change.feld);
}

/** Die eine Zeile der Gegenüberstellung zu einem Feld. */
function zeile(prefill: Prefill, feld: string) {
  return prefill.aenderungen.find((change) => change.feld === feld);
}

/** Ein gültiger Vorschlag; jeder Test tauscht nur das Feld, um das es geht. */
function eingabe(overrides: Record<string, unknown> = {}) {
  return { title: "Kettenregel Übungen", ...overrides };
}

/** Die Meldungen zu einem Feld, so wie das Formular sie einsammelt. */
function issuesFor(field: string, input: Record<string, unknown>): string[] {
  const result = proposalInputSchema.safeParse(input);
  if (result.success) return [];

  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

/**
 * Die Meldungen, die an keinem einzelnen Feld hängen. Sie landen über dem
 * Formular, in `ProposalFormState.message`.
 */
function rootIssues(input: Record<string, unknown>): string[] {
  const result = proposalInputSchema.safeParse(input);
  if (result.success) return [];

  return result.error.issues
    .filter((issue) => issue.path.length === 0)
    .map((issue) => issue.message);
}

describe("prefillFromProposal", () => {
  it("lässt bei einem Vorschlag, der zu allem schweigt, alles stehen", () => {
    const prefill = prefillFromProposal(blatt(), vorschlag());

    assert.deepEqual(prefill.werte, {
      subjectId: MATHE,
      title: "Blatt vom 10.1.",
      capturedOn: "2026-01-10",
      note: null,
      topics: ["Kettenregel", "Ableitungen"],
    });
    assert.deepEqual(prefill.aenderungen, []);
  });

  it("setzt nur den Titel, wenn nur der Titel vorgeschlagen ist", () => {
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ title: "Kettenregel Übungen" }),
    );

    assert.equal(prefill.werte.title, "Kettenregel Übungen");
    // Alles andere bleibt, wie es am Blatt steht — leer heißt „dazu sage ich
    // nichts" und nicht „lösch das".
    assert.equal(prefill.werte.subjectId, MATHE);
    assert.equal(prefill.werte.capturedOn, "2026-01-10");
    assert.equal(prefill.werte.note, null);
    assert.deepEqual(prefill.werte.topics, ["Kettenregel", "Ableitungen"]);
    assert.deepEqual(felder(prefill), ["Titel"]);
  });

  it("behält die Themen des Blattes, wenn der Vorschlag keine nennt", () => {
    // Der teuerste Fall: beim Übernehmen ersetzt setMaterialTopics() die ganze
    // Menge. Käme hier eine leere Liste heraus, löschte ein Vorschlag, der über
    // Themen gar nichts sagt, alle Themen des Blattes — und zwar lautlos.
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ title: "Kettenregel Übungen" }),
    );

    assert.deepEqual(prefill.werte.topics, ["Kettenregel", "Ableitungen"]);
    assert.equal(zeile(prefill, "Themen"), undefined);
  });

  it("nimmt die Themen des Vorschlags, wenn er welche nennt", () => {
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ topics: ["Integrale"] }),
    );

    assert.deepEqual(prefill.werte.topics, ["Integrale"]);
    assert.deepEqual(felder(prefill), ["Themen"]);
    assert.deepEqual(zeile(prefill, "Themen"), {
      feld: "Themen",
      vorher: "Kettenregel, Ableitungen",
      nachher: "Integrale",
    });
  });

  it("nimmt einen Vorschlag an, der nur Themen nennt", () => {
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ topics: ["Integrale"] }),
    );

    assert.equal(prefill.werte.title, "Blatt vom 10.1.");
    assert.equal(prefill.werte.subjectId, MATHE);
  });

  it("nennt keine Änderung, wenn der Vorschlag denselben Titel sagt", () => {
    // Ein Vorschlag, der denselben Titel noch einmal sagt, ist keine Änderung.
    // Stünde er in der Liste, ginge die eine Zeile, die zählt, darin unter.
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ title: "Blatt vom 10.1.", capturedOn: "2026-01-10" }),
    );

    assert.deepEqual(prefill.aenderungen, []);
  });

  it("hält dieselben Themen in anderer Reihenfolge für dieselben", () => {
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ topics: ["Ableitungen", "Kettenregel"] }),
    );

    assert.deepEqual(prefill.werte.topics, ["Ableitungen", "Kettenregel"]);
    assert.deepEqual(prefill.aenderungen, []);
  });

  it("hält dieselben Themen in anderer Schreibweise für dieselben", () => {
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ topics: ["  kettenregel", "ABLEITUNGEN "] }),
    );

    assert.deepEqual(prefill.aenderungen, []);
  });

  it("hält ein doppelt genanntes Thema nicht für ein zusätzliches", () => {
    const prefill = prefillFromProposal(
      blatt({ topics: ["Kettenregel"] }),
      vorschlag({ topics: ["Kettenregel", "kettenregel"] }),
    );

    assert.deepEqual(prefill.aenderungen, []);
  });

  it("merkt, wenn ein Thema dazukommt", () => {
    const prefill = prefillFromProposal(
      blatt({ topics: ["Kettenregel"] }),
      vorschlag({ topics: ["Kettenregel", "Integrale"] }),
    );

    assert.deepEqual(felder(prefill), ["Themen"]);
  });

  it("schreibt „—“, wenn eine Themenliste leer ist", () => {
    const prefill = prefillFromProposal(
      blatt({ topics: [] }),
      vorschlag({ topics: ["Integrale"] }),
    );

    assert.equal(zeile(prefill, "Themen")?.vorher, "—");
  });

  it("nennt beim Fachwechsel die Namen und nicht die ids", () => {
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ subjectId: PHYSIK, subjectName: "Physik" }),
    );

    assert.equal(prefill.werte.subjectId, PHYSIK);
    assert.deepEqual(zeile(prefill, "Fach"), {
      feld: "Fach",
      vorher: "Mathematik",
      nachher: "Physik",
    });
  });

  it("vergleicht das Fach über die id und nicht über den Namen", () => {
    // Zwei Fächer dürfen denselben Namen tragen; derselbe Name heißt also
    // nicht, dass es dasselbe Fach ist.
    const gleich = prefillFromProposal(
      blatt(),
      vorschlag({ subjectId: MATHE, subjectName: "Mathe" }),
    );
    assert.deepEqual(gleich.aenderungen, []);

    // Ohne Themen am Blatt, weil ein Fachwechsel sie fallen lässt (siehe
    // unten) und diese Zeile hier sonst eine zweite Aussage prüfte.
    const anders = prefillFromProposal(
      blatt({ topics: [], subjectName: "Mathematik" }),
      vorschlag({ subjectId: PHYSIK, subjectName: "Mathematik" }),
    );
    assert.deepEqual(felder(anders), ["Fach"]);
  });

  /**
   * Der Fachwechsel und die Themen — die Regel, die diese Funktion mit
   * `updateMaterial()` teilen muss.
   *
   * `updateMaterial()` löst beim Fachwechsel alle Themenpaarungen auf, und das
   * Blattformular nimmt das sichtbar vorweg. Täte die Vorbelegung es nicht
   * auch, nähme ein Vorschlag, der nur „Physik" sagt, die Themen von
   * Mathematik mit — und `setMaterialTopics()` legte sie danach als neue
   * Vokabeln im falschen Fach an, wo sie niemand mehr löschen kann.
   */
  it("lässt beim Fachwechsel die Themen des Blattes fallen", () => {
    const prefill = prefillFromProposal(
      blatt({ topics: ["Kettenregel"] }),
      vorschlag({ subjectId: PHYSIK, subjectName: "Physik" }),
    );

    assert.deepEqual(prefill.werte.topics, []);
    assert.deepEqual(felder(prefill), ["Fach", "Themen"]);
    assert.deepEqual(zeile(prefill, "Themen"), {
      feld: "Themen",
      vorher: "Kettenregel",
      nachher: "—",
    });
  });

  it("behält beim Fachwechsel die Themen, die der Vorschlag selbst nennt", () => {
    // Dann ist es keine Mitnahme, sondern eine Aussage: jemand hat dieses
    // Thema für dieses Fach hingeschrieben.
    const prefill = prefillFromProposal(
      blatt({ topics: ["Kettenregel"] }),
      vorschlag({
        subjectId: PHYSIK,
        subjectName: "Physik",
        topics: ["Optik"],
      }),
    );

    assert.deepEqual(prefill.werte.topics, ["Optik"]);
    assert.deepEqual(zeile(prefill, "Themen"), {
      feld: "Themen",
      vorher: "Kettenregel",
      nachher: "Optik",
    });
  });

  it("lässt die Themen in Ruhe, solange das Fach dasselbe bleibt", () => {
    const prefill = prefillFromProposal(
      blatt({ topics: ["Kettenregel"] }),
      vorschlag({ title: "Kurvendiskussion" }),
    );

    assert.deepEqual(prefill.werte.topics, ["Kettenregel"]);
    assert.deepEqual(felder(prefill), ["Titel"]);
  });

  /**
   * Verglichen wird mit demselben Schlüssel, mit dem später geschrieben wird.
   *
   * `vocabularyKey()` faltet die Schulwörter weg: „Kettenregel Übungen" meint
   * dieselbe Vokabel wie „Kettenregel", und `ensureVocabulary()` gibt beim
   * Übernehmen die vorhandene Zeile zurück. Verglich die Gegenüberstellung mit
   * `topicKey()`, kündigte sie einen Wechsel an, den es nicht gibt — und
   * hinterher sagte kein Satz, dass nichts passiert ist.
   */
  it("hält ein angehängtes Schulwort nicht für ein anderes Thema", () => {
    const prefill = prefillFromProposal(
      blatt({ topics: ["Kettenregel"] }),
      vorschlag({ topics: ["Kettenregel Übungen"] }),
    );

    assert.deepEqual(prefill.aenderungen, []);
  });

  it("hält zwei Schreibweisen desselben Fachworts nicht für zwei Themen", () => {
    const prefill = prefillFromProposal(
      blatt({ topics: ["Fotosynthese"] }),
      vorschlag({ topics: ["Photosynthese"] }),
    );

    assert.deepEqual(prefill.aenderungen, []);
  });

  it("schreibt „—“, wenn der Name des vorgeschlagenen Fachs fehlt", () => {
    // Die Änderung zu verschweigen wäre schlimmer, als sie unvollständig zu
    // zeigen — und die id gehört nicht auf den Bildschirm.
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ subjectId: PHYSIK }),
    );

    assert.deepEqual(zeile(prefill, "Fach"), {
      feld: "Fach",
      vorher: "Mathematik",
      nachher: "—",
    });
  });

  it("fügt eine Notiz hinzu und zeigt den leeren Vorher-Wert als „—“", () => {
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ note: "Seite 2 fehlt" }),
    );

    assert.equal(prefill.werte.note, "Seite 2 fehlt");
    assert.deepEqual(zeile(prefill, "Notiz"), {
      feld: "Notiz",
      vorher: "—",
      nachher: "Seite 2 fehlt",
    });
  });

  it("löscht eine vorhandene Notiz nicht, nur weil der Vorschlag schweigt", () => {
    const prefill = prefillFromProposal(
      blatt({ note: "Rückseite kopieren" }),
      vorschlag({ title: "Kettenregel Übungen" }),
    );

    assert.equal(prefill.werte.note, "Rückseite kopieren");
    assert.equal(zeile(prefill, "Notiz"), undefined);
  });

  it("ersetzt eine vorhandene Notiz, wenn der Vorschlag eine nennt", () => {
    const prefill = prefillFromProposal(
      blatt({ note: "Rückseite kopieren" }),
      vorschlag({ note: "Seite 2 fehlt" }),
    );

    assert.deepEqual(zeile(prefill, "Notiz"), {
      feld: "Notiz",
      vorher: "Rückseite kopieren",
      nachher: "Seite 2 fehlt",
    });
  });

  it("schreibt den Tag mit Jahr", () => {
    // Ohne Jahr sähen zwei Tage aus zwei Schuljahren nach einem
    // Wochentagsfehler aus statt nach einem Jahr Unterschied.
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({ capturedOn: "2026-09-14" }),
    );

    assert.deepEqual(zeile(prefill, "Tag"), {
      feld: "Tag",
      vorher: "10.1.2026",
      nachher: "14.9.2026",
    });
  });

  it("unterscheidet zwei Tage, die sich nur im Jahr unterscheiden", () => {
    const prefill = prefillFromProposal(
      blatt({ capturedOn: "2025-01-10" }),
      vorschlag({ capturedOn: "2026-01-10" }),
    );

    assert.deepEqual(zeile(prefill, "Tag"), {
      feld: "Tag",
      vorher: "10.1.2025",
      nachher: "10.1.2026",
    });
  });

  it("nennt die Felder in der Reihenfolge des Formulars", () => {
    const prefill = prefillFromProposal(
      blatt(),
      vorschlag({
        subjectId: PHYSIK,
        subjectName: "Physik",
        title: "Kräfte und Bewegung",
        capturedOn: "2026-09-14",
        note: "Seite 2 fehlt",
        topics: ["Newton"],
      }),
    );

    assert.deepEqual(felder(prefill), [
      "Fach",
      "Titel",
      "Tag",
      "Notiz",
      "Themen",
    ]);
  });

  it("rechnet ohne Systemuhr — zweimal dasselbe Ergebnis", () => {
    // Reine Rechnung heißt: kein „heute" darin. Sonst hinge die
    // Gegenüberstellung davon ab, wann jemand die Seite lädt.
    const einmal = prefillFromProposal(blatt(), vorschlag({ topics: ["A"] }));
    const nochmal = prefillFromProposal(blatt(), vorschlag({ topics: ["A"] }));

    assert.deepEqual(einmal, nochmal);
  });
});

describe("proposalInputSchema", () => {
  it("nimmt einen Vorschlag an, der nur den Titel nennt", () => {
    const result = proposalInputSchema.safeParse(eingabe());

    assert.ok(result.success);
    assert.deepEqual(result.data, {
      subjectId: null,
      title: "Kettenregel Übungen",
      capturedOn: null,
      note: null,
      topics: [],
    });
  });

  it("nimmt einen Vorschlag an, der nur Themen nennt", () => {
    // Wer beim Lesen eines Blattes nur zwei Themen erkennt, soll keinen Titel
    // erfinden müssen — ein erfundener Titel wird mitbestätigt.
    const result = proposalInputSchema.safeParse({ topics: ["Zellatmung"] });

    assert.ok(result.success);
    assert.deepEqual(result.data.topics, ["Zellatmung"]);
    assert.equal(result.data.title, null);
  });

  it("nimmt einen Vorschlag an, der nur das Fach nennt", () => {
    const result = proposalInputSchema.safeParse({ subjectId: PHYSIK });

    assert.ok(result.success);
    assert.equal(result.data.subjectId, PHYSIK);
  });

  it("weist einen völlig leeren Vorschlag ab", () => {
    assert.deepEqual(rootIssues({}), [
      "Ein Vorschlag, der nichts vorschlägt, ist keiner.",
    ]);
  });

  it("hält auch einen Vorschlag aus lauter Leerzeichen für leer", () => {
    assert.deepEqual(
      rootIssues({
        subjectId: "  ",
        title: "   ",
        capturedOn: "",
        note: "  ",
        topics: ["", "   "],
      }),
      ["Ein Vorschlag, der nichts vorschlägt, ist keiner."],
    );
  });

  it("stellt die Meldung über das Formular und nicht unter ein Feld", () => {
    // Es ist keines der fünf Felder falsch, es fehlen alle fünf. Unter einem
    // Feld stünde sie da, wo sie niemand erwartet.
    for (const feld of ["subjectId", "title", "capturedOn", "note", "topics"]) {
      assert.deepEqual(issuesFor(feld, {}), [], feld);
    }
  });

  it("macht aus leeren Zeichenketten null und nicht \"\"", () => {
    // In der Spalte stünde sonst "", und die Ansicht müsste zwischen „sagt
    // nichts" und „schlägt nichts vor" unterscheiden, was dasselbe ist.
    for (const value of ["", "   ", null, undefined]) {
      const result = proposalInputSchema.safeParse(
        eingabe({ note: value, subjectId: value, capturedOn: value }),
      );

      assert.ok(result.success, String(value));
      assert.equal(result.data.note, null, String(value));
      assert.equal(result.data.subjectId, null, String(value));
      assert.equal(result.data.capturedOn, null, String(value));
    }
  });

  it("schneidet die Leerzeichen um Titel und Notiz weg", () => {
    const result = proposalInputSchema.safeParse(
      eingabe({ title: "  Vektoren ", note: "  Seite 2 fehlt  " }),
    );

    assert.ok(result.success);
    assert.equal(result.data.title, "Vektoren");
    assert.equal(result.data.note, "Seite 2 fehlt");
  });

  it("lässt genau achtzig Zeichen Titel zu und einen mehr nicht", () => {
    assert.deepEqual(
      issuesFor("title", eingabe({ title: "a".repeat(MATERIAL_TITLE_MAX) })),
      [],
    );
    assert.deepEqual(
      issuesFor("title", eingabe({ title: "a".repeat(MATERIAL_TITLE_MAX + 1) })),
      ["Der Titel ist zu lang — höchstens 80 Zeichen."],
    );
  });

  it("lässt genau fünfhundert Zeichen Notiz zu und einen mehr nicht", () => {
    assert.deepEqual(
      issuesFor("note", eingabe({ note: "n".repeat(MATERIAL_NOTE_MAX) })),
      [],
    );
    assert.deepEqual(
      issuesFor("note", eingabe({ note: "n".repeat(MATERIAL_NOTE_MAX + 1) })),
      ["Die Notiz ist zu lang — höchstens 500 Zeichen."],
    );
  });

  it("weist ein Datum ab, das es nicht gibt", () => {
    for (const value of ["heute", "2026-02-31", "14.9.2026", "2026-9-14"]) {
      assert.deepEqual(
        issuesFor("capturedOn", eingabe({ capturedOn: value })),
        ["Dieses Datum gibt es nicht."],
        value,
      );
    }
  });

  it("stellt an ein unlesbares Datum genau eine Meldung", () => {
    assert.equal(
      issuesFor("capturedOn", eingabe({ capturedOn: "morgen" })).length,
      1,
    );
  });

  it("nimmt den heutigen Tag an und lehnt den morgigen ab", () => {
    // „Heute" kommt aus derselben Quelle wie im Schema, sonst kippte der Test
    // um Mitternacht Berliner Zeit.
    const today = todayInBerlin();

    assert.deepEqual(
      issuesFor("capturedOn", eingabe({ capturedOn: today })),
      [],
    );
    assert.deepEqual(
      issuesFor("capturedOn", eingabe({ capturedOn: SCHULTAG })),
      [],
    );
    assert.deepEqual(
      issuesFor("capturedOn", eingabe({ capturedOn: addDays(today, 1) })),
      ["Dieser Tag ist noch nicht gewesen."],
    );
    assert.deepEqual(
      issuesFor("capturedOn", eingabe({ capturedOn: addDays(today, 400) })),
      ["Dieser Tag ist noch nicht gewesen."],
    );
  });

  it("weist ein Fach ab, das keine id ist", () => {
    for (const value of ["mathe", "3f7c1a2e", "3f7c1a2e-8b4d-4c9a-9e51-0d6f"]) {
      assert.deepEqual(
        issuesFor("subjectId", eingabe({ subjectId: value })),
        ["Dieses Fach gibt es nicht."],
        value,
      );
    }
  });

  it("normalisiert die Themen wie das Blattformular", () => {
    const result = proposalInputSchema.safeParse(
      eingabe({ topics: ["  Kettenregel ", "", "kettenregel", "Integrale"] }),
    );

    assert.ok(result.success);
    assert.deepEqual(result.data.topics, ["Kettenregel", "Integrale"]);
  });

  it("deckelt die Themen bei PROPOSAL_TOPIC_LIMIT", () => {
    // Nähme ein Vorschlag mehr an, als beim Übernehmen durchkommt,
    // verschwänden die überzähligen Chips genau in dem Moment, in dem der
    // Mensch zustimmt.
    const viele = Array.from(
      { length: PROPOSAL_TOPIC_LIMIT + 10 },
      (_, index) => `Thema ${index}`,
    );
    const result = proposalInputSchema.safeParse(eingabe({ topics: viele }));

    assert.ok(result.success);
    assert.equal(result.data.topics.length, PROPOSAL_TOPIC_LIMIT);
  });

  it("macht aus fehlenden Themen eine leere Liste und kein undefined", () => {
    for (const value of [null, undefined]) {
      const result = proposalInputSchema.safeParse(eingabe({ topics: value }));

      assert.ok(result.success, String(value));
      assert.deepEqual(result.data.topics, [], String(value));
    }
  });

  it("sammelt die Meldungen aller Felder ein, statt beim ersten aufzuhören", () => {
    // Das Formular zeigt sie alle auf einmal an; wer dreimal absenden muss, um
    // drei Fehler zu sehen, gibt vorher auf.
    const result = proposalInputSchema.safeParse({
      subjectId: "mathe",
      title: "t".repeat(MATERIAL_TITLE_MAX + 1),
      capturedOn: "irgendwann",
      note: "n".repeat(MATERIAL_NOTE_MAX + 1),
    });

    assert.ok(!result.success);
    assert.deepEqual(
      [...new Set(result.error.issues.map((issue) => issue.path[0]))].sort(),
      ["capturedOn", "note", "subjectId", "title"],
    );
  });
});
