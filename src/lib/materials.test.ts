import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, germanShortParts, todayInBerlin } from "@/lib/dates";
import { MAX_PAGES } from "@/lib/images";
import {
  LIST_LIMIT,
  MATERIAL_NOTE_MAX,
  MATERIAL_TITLE_MAX,
  MATERIAL_TRANSCRIPT_MAX,
  TRANSCRIPT_EXPORT_LIMIT,
  type TranscriptCursor,
  defaultMaterialTitle,
  isCursorTimestamp,
  materialInputSchema,
  transcriptSchema,
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

describe("transcriptSchema", () => {
  it("lässt eine gewöhnliche Abschrift unangetastet durch", () => {
    const text = "Aufgabe 1\n\na) f(x) = 3x² − 2x\nb) ⟨unleserlich⟩";
    const result = transcriptSchema.safeParse(text);

    assert.ok(result.success);
    assert.equal(result.data, text);
  });

  it("rührt die ⟨spitzen Klammern⟩ des Agenten nicht an", () => {
    // Damit markiert der Agent, was er nicht sicher lesen konnte. Das ist reiner
    // Text und keine Auszeichnung — wer hier anfängt, ihn zu zählen oder zu
    // entfernen, nimmt dem Menschen die einzige Stelle, an der steht, wo die
    // Abschrift unsicher ist.
    const result = transcriptSchema.safeParse("Der ⟨Satz des Pythagoras⟩ gilt");

    assert.ok(result.success);
    assert.equal(result.data, "Der ⟨Satz des Pythagoras⟩ gilt");
  });

  it("lässt den leeren String stehen, statt null daraus zu machen", () => {
    // Der Unterschied trägt die ganze Abschrift: null heißt „diese Seite hat
    // noch niemand gelesen“, "" heißt „gelesen, und es stand nichts darauf“.
    // Fielen beide zusammen, legte der Postbote dieselbe leere Seite bei jedem
    // Lauf wieder vor. Genau darin unterscheidet sich diese Prüfung von
    // optionalText(), das für die Notiz das Gegenteil tut.
    for (const value of ["", "   ", "\n\n", "\t \n"]) {
      const result = transcriptSchema.safeParse(value);

      assert.ok(result.success, JSON.stringify(value));
      assert.equal(result.data, "", JSON.stringify(value));
    }
  });

  it("schneidet nur die Ränder weg und lässt die Zeilen dazwischen in Ruhe", () => {
    // Die Einrückung einer Aufgabe ist Teil dessen, was auf dem Blatt steht.
    const result = transcriptSchema.safeParse("  Zeile 1\n\n   Zeile 2  ");

    assert.ok(result.success);
    assert.equal(result.data, "Zeile 1\n\n   Zeile 2");
  });

  it("lässt genau achttausend Zeichen zu und einen mehr nicht", () => {
    const gerade = transcriptSchema.safeParse(
      "a".repeat(MATERIAL_TRANSCRIPT_MAX),
    );
    assert.ok(gerade.success);

    const zuLang = transcriptSchema.safeParse(
      "a".repeat(MATERIAL_TRANSCRIPT_MAX + 1),
    );
    assert.ok(!zuLang.success);
    assert.deepEqual(
      zuLang.error.issues.map((issue) => issue.message),
      ["Die Abschrift einer Seite ist zu lang — höchstens 8000 Zeichen."],
    );
  });

  it("nennt in der Meldung dieselbe Zahl, die auch die Grenze ist", () => {
    // Die Meldung schreibt die 8000 aus, wie es bei Titel und Notiz auch steht —
    // ein Satz mit einer eingesetzten Zahl liest sich schlechter. Der Preis ist
    // diese Prüfung: wer MATERIAL_TRANSCRIPT_MAX senkt und die Meldung vergisst,
    // stellt dem Nutzer eine Zahl hin, die nicht gilt.
    const result = transcriptSchema.safeParse(
      "a".repeat(MATERIAL_TRANSCRIPT_MAX + 1),
    );

    assert.ok(!result.success);
    assert.ok(
      result.error.issues[0]?.message.includes(String(MATERIAL_TRANSCRIPT_MAX)),
      result.error.issues[0]?.message,
    );
  });

  it("misst die Abschrift nach dem Abschneiden der Ränder", () => {
    // Sonst entschiede ein nachgestellter Zeilenumbruch darüber, ob eine
    // Abschrift durch die Tür passt — dieselbe Regel wie beim Titel.
    const padded = `\n ${"a".repeat(MATERIAL_TRANSCRIPT_MAX)} \n`;
    const result = transcriptSchema.safeParse(padded);

    assert.ok(result.success);
    assert.equal(result.data.length, MATERIAL_TRANSCRIPT_MAX);
  });

  it("nimmt nur Text an", () => {
    for (const value of [null, undefined, 42, ["a"], { text: "a" }]) {
      const result = transcriptSchema.safeParse(value);
      assert.ok(!result.success, String(value));
    }
  });
});

describe("die Grenzen der Abschrift", () => {
  it("lässt zwölf volle Seiten durch ein Werkzeugergebnis passen", () => {
    // Ein Werkzeugergebnis endet in der Claude-App bei rund 150 000 Zeichen —
    // dieselbe Grenze, aus der in @/lib/mcp/run.ts MAX_IMAGE_BYTES gerechnet
    // ist. `transcripts` an propose_sheet trägt bis zu MAX_PAGES Abschriften in
    // EINEM Aufruf. Wächst eine der beiden Zahlen über diese Rechnung hinaus,
    // bekommt der Agent keine Fehlermeldung, sondern eine abgeschnittene
    // Antwort — dann schlägt hier zuerst der Test an.
    const werkzeugErgebnis = 150_000;
    const rahmen = 20_000; // Feldnamen, zwölf ids, Satz davor, JSON-RPC-Umschlag

    assert.ok(MATERIAL_TRANSCRIPT_MAX * MAX_PAGES + rahmen < werkzeugErgebnis);
  });

  it("lässt eine dicht beschriebene Seite mit Abstand durch", () => {
    // Grob geschätzt trägt eine eng vollgeschriebene A4-Seite rund 3000
    // Zeichen. Die Grenze ist das Netz und nicht die Erwartung: sie darf eine
    // ehrliche Abschrift nie treffen. (Sobald ein echtes Blatt abgeschrieben
    // ist, gehört an diese Stelle die gemessene Zahl statt der geschätzten.)
    assert.ok(MATERIAL_TRANSCRIPT_MAX >= 2 * 3_000);
  });

  it("hält eine Runde des Exports klein genug für eine Antwort", () => {
    // Diese eine Liste trägt als einzige den Volltext mit. Mit der Decke der
    // Ablage wären es im schlimmsten Fall 19,2 Millionen Zeichen in einer
    // Antwort; deshalb hat der Export eine eigene, niedrigere.
    assert.ok(TRANSCRIPT_EXPORT_LIMIT < LIST_LIMIT);
    assert.ok(
      TRANSCRIPT_EXPORT_LIMIT * MAX_PAGES * MATERIAL_TRANSCRIPT_MAX <=
        5_000_000,
    );
  });
});

/**
 * Der Zeitstempel im Export-Cursor.
 *
 * Was ohne diese Prüfung geschah, ist gemessen und steht ausführlich an
 * `TranscriptCursor.createdAt`: der Zeitstempel lief als JS-`Date` durch den
 * Cursor, verlor dabei die drei letzten Stellen der Mikrosekunde und zeigte
 * danach VOR das Blatt, das er markiert. An jeder Rundengrenze kam dieses Blatt
 * ein zweites Mal heraus; bei drei Blättern derselben Millisekunde rückte der
 * Cursor gar nicht mehr vor. Die Wiki-Übergabe brach daran ab, das Fach-PDF
 * füllte sich mit Wiederholungen.
 *
 * Die Runde selbst braucht eine Datenbank und steht deshalb als Probe 9 in
 * scripts/probe-abschrift.mts — mit von Hand gesetzten Mikrosekunden, weil
 * PGlites `now()` nur Millisekunden liefert und der Fehler sich sonst gar nicht
 * herstellen lässt. Hier steht der Teil, der ohne Datenbank auskommt: dass ein
 * Zeitstempel mit Millisekunden als Cursor NICHT durchgeht, und dass der Typ
 * eine Zeichenkette verlangt und kein `Date`.
 */
describe("isCursorTimestamp", () => {
  it("nimmt an, was eine Runde des Exports ausgibt", () => {
    assert.ok(isCursorTimestamp("2026-09-01T10:00:00.123456Z"));
    assert.ok(isCursorTimestamp("2026-01-01T00:00:00.000000Z"));
    assert.ok(isCursorTimestamp("2024-02-29T23:59:59.999999Z"));
  });

  it("weist einen Zeitstempel mit Millisekunden ab", () => {
    // Genau die Form, die `new Date(…).toISOString()` schreibt — also der
    // Fehler selbst. Drei Stellen statt sechs heißen: hier war ein `Date` im
    // Weg, und der Wert ist um bis zu 999 Mikrosekunden zu klein. Eine leere
    // Antwort darauf ist unangenehm; eine Runde, die Blätter doppelt
    // herausgibt, ist schlimmer.
    assert.ok(!isCursorTimestamp("2026-09-01T10:00:00.123Z"));
    assert.ok(!isCursorTimestamp("2026-09-01T10:00:00Z"));
    assert.ok(!isCursorTimestamp("2026-09-01T10:00:00.1234567Z"));
  });

  it("weist ab, was Postgres mit einem Typfehler quittieren würde", () => {
    // Ein Muster allein reicht nicht: den 31. Februar gibt es nicht, und
    // `'2026-02-31…'::timestamptz` wirft. Aus dem Wurf würde im PDF ein
    // abgestürzter Route Handler — dieselbe Überlegung wie bei `isId()`.
    assert.ok(!isCursorTimestamp("2026-02-31T10:00:00.000000Z"));
    assert.ok(!isCursorTimestamp("2026-13-01T10:00:00.000000Z"));
    assert.ok(!isCursorTimestamp("2026-09-01T24:00:00.000000Z"));
    assert.ok(!isCursorTimestamp("2026-09-01T10:60:00.000000Z"));
  });

  it("nimmt keine andere Schreibweise desselben Zeitpunkts", () => {
    // Der Wert wird unverändert als `::timestamptz` eingesetzt, also muss er
    // genau das Format tragen, das `to_char()` schreibt. Alles andere ist ein
    // Cursor, den diese Datei nicht ausgegeben hat.
    assert.ok(!isCursorTimestamp("2026-09-01 10:00:00.123456+00"));
    assert.ok(!isCursorTimestamp("2026-09-01T10:00:00.123456+00:00"));
    assert.ok(!isCursorTimestamp(""));
    assert.ok(!isCursorTimestamp("heute"));
  });

  it("verlangt im Cursor eine Zeichenkette und kein Date", () => {
    // Dieser Test prüft nichts zur Laufzeit — er steht für den Compiler da.
    // Wird `createdAt` je wieder ein `Date`, ist `npx tsc --noEmit` rot, und
    // zwar hier, mit dem Kommentar daneben, der sagt warum.
    const cursor: TranscriptCursor = {
      capturedOn: "2026-09-01",
      createdAt: "2026-09-01T10:00:00.123456Z",
      id: "3f7c1a2e-8b4d-4c9a-9e51-0d6f2a7b1c34",
    };

    assert.ok(isCursorTimestamp(cursor.createdAt));
  });
});
