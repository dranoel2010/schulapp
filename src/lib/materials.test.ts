import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, germanShortParts, todayInBerlin } from "@/lib/dates";
import {
  MATERIAL_NOTE_MAX,
  MATERIAL_TITLE_MAX,
  defaultMaterialTitle,
  materialInputSchema,
} from "@/lib/materials";

/**
 * Die reinen Teile von @/lib/materials: der Titelvorschlag und das Schema des
 * Formulars. Beide rechnen nur, beide entscheiden, was der Nutzer zu sehen
 * bekommt — und beide standen bisher ungeprüft in einer Datei, die man für
 * „geht nur mit Datenbank" hielt.
 *
 * Sie geht auch ohne: `@/db` gibt einen faulen Proxy heraus, die Verbindung
 * entsteht erst bei der ersten echten Abfrage. Ein Import dieser Datei öffnet
 * also keine PGlite, und dieser Testlauf rührt die Datenbank nicht an.
 *
 * Was hier nicht steht, ist Absicht: alles, was schreibt oder liest, gehört in
 * einen Test mit echter Datenbank und nicht in eine nachgebaute.
 */

/**
 * Der Schultag des Beispielformulars — eine Woche zurück, aus derselben Quelle
 * gerechnet wie im Schema.
 *
 * Ein festes Datum im Text ginge hier nicht: das Schema weist alles ab, was
 * noch nicht gewesen ist, und ein hart eingetragener Tag wäre irgendwann
 * Zukunft und der ganze Testlauf rot — an einem Tag, an dem niemand etwas
 * geändert hat.
 */
const SCHULTAG = addDays(todayInBerlin(), -7);

/** Ein gültiges Formular; jeder Test tauscht nur das eine Feld, um das es geht. */
function form(overrides: Record<string, unknown> = {}) {
  return {
    subjectId: "3f7c1a2e-8b4d-4c9a-9e51-0d6f2a7b1c34",
    title: "Kettenregel Übungen",
    capturedOn: SCHULTAG,
    note: null,
    ...overrides,
  };
}

/** Die Meldungen zu einem Feld, so wie das Formular sie einsammelt. */
function issuesFor(field: string, input: Record<string, unknown>): string[] {
  const result = materialInputSchema.safeParse(input);
  if (result.success) return [];

  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

describe("defaultMaterialTitle", () => {
  it("schlägt an einem gewöhnlichen Tag das Kurzdatum vor", () => {
    assert.equal(defaultMaterialTitle("2026-09-14"), "Blatt vom 14.9.");
    assert.equal(defaultMaterialTitle("2026-08-21"), "Blatt vom 21.8.");
  });

  it("benutzt die Kurzform aus @/lib/dates statt einer eigenen", () => {
    // Der Titel steht später neben Datumsangaben aus dem Wochenraster und der
    // Fälligkeit. Baute er sich sein Kurzdatum selbst, liefen die drei
    // Schreibweisen irgendwann auseinander — genau dafür gibt es
    // germanShortParts().
    for (const date of [
      "2026-01-01",
      "2026-03-09",
      "2026-09-14",
      "2026-12-31",
      "2024-02-29",
    ]) {
      assert.equal(
        defaultMaterialTitle(date),
        `Blatt vom ${germanShortParts(date).dayMonth}`,
        date,
      );
    }
  });

  it("schreibt Tag und Monat ohne führende Null", () => {
    // "Blatt vom 01.01." liest sich wie ein Aktenzeichen; so steht es auch
    // nirgends sonst in der App.
    assert.equal(defaultMaterialTitle("2026-01-01"), "Blatt vom 1.1.");
    assert.equal(defaultMaterialTitle("2026-03-09"), "Blatt vom 9.3.");
  });

  it("trägt die Ränder des Jahres richtig ein", () => {
    assert.equal(defaultMaterialTitle("2026-12-31"), "Blatt vom 31.12.");
    assert.equal(defaultMaterialTitle("2025-12-31"), "Blatt vom 31.12.");
    assert.equal(defaultMaterialTitle("2027-01-01"), "Blatt vom 1.1.");
  });

  it("kennt den 29. Februar, wenn es ihn gibt", () => {
    assert.equal(defaultMaterialTitle("2024-02-29"), "Blatt vom 29.2.");
  });

  it("sagt nur „Blatt“, wenn das Datum unlesbar ist", () => {
    // Kein Wurf und kein erfundener Tag: das Feld daneben trägt das Datum, und
    // der Vorschlag lässt sich überschreiben. Ein Titel „Blatt vom NaN.NaN."
    // wäre das Schlimmste von beidem.
    for (const value of [
      "",
      "   ",
      "heute",
      "14.9.2026",
      "2026-9-14",
      "2026-13-01",
      "2026-02-30",
      "2026-02-31",
      "2025-02-29",
      "0000-00-00",
    ]) {
      assert.equal(defaultMaterialTitle(value), "Blatt", value);
    }
  });
});

describe("materialInputSchema", () => {
  it("nimmt ein ausgefülltes Formular an", () => {
    const result = materialInputSchema.safeParse(form());

    assert.ok(result.success);
    assert.deepEqual(result.data, {
      subjectId: "3f7c1a2e-8b4d-4c9a-9e51-0d6f2a7b1c34",
      title: "Kettenregel Übungen",
      capturedOn: SCHULTAG,
      note: null,
    });
  });

  it("verlangt ein Fach und nennt es beim Namen", () => {
    assert.deepEqual(issuesFor("subjectId", form({ subjectId: "" })), [
      "Zu welchem Fach gehört das Blatt?",
    ]);
    assert.deepEqual(issuesFor("subjectId", form({ subjectId: "mathe" })), [
      "Zu welchem Fach gehört das Blatt?",
    ]);
  });

  it("verlangt einen Titel, auch wenn nur Leerzeichen darin stehen", () => {
    assert.deepEqual(issuesFor("title", form({ title: "" })), [
      "Wie soll das Blatt heißen?",
    ]);
    assert.deepEqual(issuesFor("title", form({ title: "   " })), [
      "Wie soll das Blatt heißen?",
    ]);
  });

  it("schneidet die Leerzeichen um den Titel weg", () => {
    const result = materialInputSchema.safeParse(form({ title: "  Vektoren " }));

    assert.ok(result.success);
    assert.equal(result.data.title, "Vektoren");
  });

  it("lässt genau achtzig Zeichen zu und einen mehr nicht", () => {
    assert.deepEqual(
      issuesFor("title", form({ title: "a".repeat(MATERIAL_TITLE_MAX) })),
      [],
    );
    assert.deepEqual(
      issuesFor("title", form({ title: "a".repeat(MATERIAL_TITLE_MAX + 1) })),
      ["Der Titel ist zu lang — höchstens 80 Zeichen."],
    );
  });

  it("misst den Titel nach dem Abschneiden der Leerzeichen", () => {
    const padded = ` ${"a".repeat(MATERIAL_TITLE_MAX)} `;
    assert.deepEqual(issuesFor("title", form({ title: padded })), []);
  });

  it("weist ein Datum ab, das es nicht gibt", () => {
    for (const value of ["", "heute", "2026-02-31", "14.9.2026"]) {
      assert.deepEqual(
        issuesFor("capturedOn", form({ capturedOn: value })),
        ["Dieses Datum gibt es nicht."],
        value,
      );
    }
  });

  it("stellt an ein unlesbares Datum genau eine Meldung", () => {
    // Der Zukunfts-Test hält sich zurück, solange das Datum überhaupt nicht
    // lesbar ist — sonst stünden zwei Sätze unter demselben Feld.
    assert.equal(issuesFor("capturedOn", form({ capturedOn: "morgen" })).length, 1);
  });

  it("nimmt den heutigen Tag an und lehnt den morgigen ab", () => {
    // „Heute" kommt aus derselben Quelle wie im Schema, sonst kippte der Test
    // um Mitternacht Berliner Zeit.
    const today = todayInBerlin();

    assert.deepEqual(issuesFor("capturedOn", form({ capturedOn: today })), []);
    assert.deepEqual(
      issuesFor("capturedOn", form({ capturedOn: addDays(today, -1) })),
      [],
    );
    assert.deepEqual(
      issuesFor("capturedOn", form({ capturedOn: addDays(today, 1) })),
      ["Dieser Tag ist noch nicht gewesen."],
    );
    assert.deepEqual(
      issuesFor("capturedOn", form({ capturedOn: addDays(today, 400) })),
      ["Dieser Tag ist noch nicht gewesen."],
    );
  });

  it("macht aus einer leeren Notiz null und nicht die leere Zeichenkette", () => {
    // In der Spalte steht sonst "" — und die Ansicht müsste zwischen „keine
    // Notiz" und „eine leere Notiz" unterscheiden, die es gar nicht gibt.
    for (const value of ["", "   ", null, undefined]) {
      const result = materialInputSchema.safeParse(form({ note: value }));

      assert.ok(result.success, String(value));
      assert.equal(result.data.note, null, String(value));
    }
  });

  it("behält eine ausgefüllte Notiz, ohne die Ränder", () => {
    const result = materialInputSchema.safeParse(
      form({ note: "  Seite 2 fehlt  " }),
    );

    assert.ok(result.success);
    assert.equal(result.data.note, "Seite 2 fehlt");
  });

  it("lässt genau fünfhundert Zeichen Notiz zu und einen mehr nicht", () => {
    assert.deepEqual(
      issuesFor("note", form({ note: "n".repeat(MATERIAL_NOTE_MAX) })),
      [],
    );
    assert.deepEqual(
      issuesFor("note", form({ note: "n".repeat(MATERIAL_NOTE_MAX + 1) })),
      ["Die Notiz ist zu lang — höchstens 500 Zeichen."],
    );
  });

  it("sammelt die Meldungen aller Felder ein, statt beim ersten aufzuhören", () => {
    // Das Formular zeigt sie alle auf einmal an; wer dreimal absenden muss, um
    // drei Fehler zu sehen, gibt vorher auf.
    const result = materialInputSchema.safeParse({
      subjectId: "mathe",
      title: "",
      capturedOn: "irgendwann",
      note: "x".repeat(MATERIAL_NOTE_MAX + 1),
    });

    assert.ok(!result.success);
    assert.deepEqual(
      [...new Set(result.error.issues.map((issue) => issue.path[0]))].sort(),
      ["capturedOn", "note", "subjectId", "title"],
    );
  });
});
