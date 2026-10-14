import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLAUDE_LANGSAM_TOK_S,
  CLAUDE_MAX_TOKENS,
  antwortFormat,
  type ClaudeInhalt,
} from "@/lib/claude/client";
import { PROPOSAL_TRANSCRIPT_MAX } from "@/lib/inbox";
import {
  EINORDNEN_ANTWORT,
  NACHLESE_ANTWORT,
  abschreibInhalt,
  abschriftenSieben,
  einordnenAuftrag,
  einordnenEingabe,
  fristFuer,
  maxTokensFuer,
  nachleseAuftrag,
  nachleseEingabe,
  type EinordnenAntwort,
  type EinordnenVorab,
} from "@/lib/leser/claude-auftrag";
import { MATERIAL_NOTE_MAX } from "@/lib/materials";

/**
 * Was der Leser der App dem Modell sagt und was er zurück annimmt — ohne
 * einen einzigen Aufruf. Der Systemtext mit den Abschreibregeln hat seinen
 * eigenen Test (abschrift-regeln.test.ts); hier geht es um das, was sich je
 * Blatt ändert, und um die Prüfung danach.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const BLATT = "99999999-9999-4999-8999-999999999999";

const GANZ: EinordnenVorab = {
  capturedOn: "2026-10-01",
  seiten: [
    { id: A, nummer: 1 },
    { id: B, nummer: 2 },
  ],
  vollstaendig: true,
  ersteSeiteDabei: true,
};

/** Eine Antwort zum Einordnen, an der alles stimmt. */
function antwort(teil: Partial<EinordnenAntwort> = {}): EinordnenAntwort {
  return {
    transcripts: [
      { page: A, text: "Vorderseite" },
      { page: B, text: "" },
    ],
    title: "Die Kettenregel",
    topics: ["Kettenregel"],
    captured_on: null,
    note: null,
    ergebnis: "vorschlag",
    grund: "",
    ...teil,
  };
}

describe("maxTokensFuer und fristFuer", () => {
  it("bindet die Grenze der Tokens an die Seitenzahl — 24 000 für eine Seite, ab sechs die Obergrenze", () => {
    assert.equal(maxTokensFuer(1), 24_000);
    assert.equal(maxTokensFuer(2), 32_000);
    assert.equal(maxTokensFuer(5), 56_000);
    assert.equal(maxTokensFuer(6), CLAUDE_MAX_TOKENS);
    assert.equal(maxTokensFuer(12), CLAUDE_MAX_TOKENS);
  });

  it("gibt jeder Seitenzahl eine Frist, die LÄNGER ist, als max_tokens bei langsamer API braucht", () => {
    // Die Abnahme vom 11.10.2026: vorher bekam ein Blatt mit fünf Seiten eine
    // Viertelstunde für 64 000 Tokens — max_tokens hätte über 71 Tokens je
    // Sekunde gebraucht, und eine ausufernde Antwort endete als „später“.
    for (let seiten = 1; seiten <= 12; seiten += 1) {
      const sekundenBisMaxTokens = maxTokensFuer(seiten) / CLAUDE_LANGSAM_TOK_S;
      assert.ok(fristFuer(seiten) > sekundenBisMaxTokens * 1000, `${seiten} Seiten`);
      // … und bei derselben Rate wie die Prüfer (35 Tok/s) sowieso.
      assert.ok(fristFuer(seiten) > (maxTokensFuer(seiten) / 35) * 1000, `${seiten} Seiten bei 35 Tok/s`);
    }
    assert.equal(Math.round(fristFuer(1) / 60_000), 19);
    assert.equal(Math.round(fristFuer(12) / 60_000), 46);
  });

  it("zählt eine Seitenzahl, die keine ist, wie zwölf — lieber zu lang als abgeschnitten", () => {
    for (const unsinn of [0, -3, 2.5, Number.NaN]) {
      assert.equal(fristFuer(unsinn), fristFuer(12));
      assert.equal(maxTokensFuer(unsinn), maxTokensFuer(12));
    }
  });
});

describe("die Antwortschemas", () => {
  it("geben der Nachlese gar keinen Platz für Titel, Thema, Tag oder Notiz", () => {
    assert.deepEqual(Object.keys(NACHLESE_ANTWORT.shape).sort(), ["ergebnis", "grund", "transcripts"]);
  });

  it("lassen die Abschrift zuerst schreiben — Notiz und Grund wissen erst danach etwas", () => {
    assert.equal(Object.keys(EINORDNEN_ANTWORT.shape)[0], "transcripts");
    assert.equal(Object.keys(NACHLESE_ANTWORT.shape)[0], "transcripts");
  });

  it("verlangen jedes Feld — „sagt nichts“ ist null oder leer, nie ein fehlendes Feld", () => {
    for (const schema of [EINORDNEN_ANTWORT, NACHLESE_ANTWORT]) {
      const format = antwortFormat(schema) as unknown as {
        schema: { required: string[]; properties: Record<string, unknown> };
      };
      assert.deepEqual(
        [...format.schema.required].sort(),
        Object.keys(format.schema.properties).sort(),
      );
    }
  });

  it("weisen einen dritten Wert für ergebnis und fremde Felder ab", () => {
    assert.equal(EINORDNEN_ANTWORT.safeParse(antwort({ ergebnis: "vielleicht" as "vorschlag" })).success, false);
    assert.equal(
      NACHLESE_ANTWORT.safeParse({ transcripts: [], ergebnis: "kein-vorschlag", grund: "", note: "x" }).success,
      false,
    );
  });

  it("nehmen ein zweites Thema und eine lange Abschrift erst einmal an — gesiebt wird danach je Feld", () => {
    const lang = "x".repeat(PROPOSAL_TRANSCRIPT_MAX + 1);
    assert.equal(
      EINORDNEN_ANTWORT.safeParse(
        antwort({ topics: ["Eins", "Zwei"], transcripts: [{ page: A, text: lang }] }),
      ).success,
      true,
    );
  });
});

describe("einordnenAuftrag", () => {
  it("nennt jede Seite mit Nummer und id und den eingetragenen Tag", () => {
    const text = einordnenAuftrag(GANZ);
    assert.match(text, new RegExp(`Seite 1 \\(id ${A}\\), Seite 2 \\(id ${B}\\)`));
    assert.match(text, /Eingetragener Tag: 2026-10-01\./);
    assert.match(text, /Ein Fach nennst du deshalb nicht/);
    assert.match(text, /höchstens EIN Thema/);
  });

  it("sagt die Sätze zum Teilblatt und zur fehlenden ersten Seite nur, wenn sie zutreffen", () => {
    const ganz = einordnenAuftrag(GANZ);
    assert.doesNotMatch(ganz, /schon selbst gelesen/);
    assert.doesNotMatch(ganz, /title bleibt null/);

    const teil = einordnenAuftrag({
      ...GANZ,
      seiten: [{ id: B, nummer: 2 }],
      vollstaendig: false,
      ersteSeiteDabei: false,
    });
    assert.match(teil, /schon selbst gelesen/);
    assert.match(teil, /schlag trotzdem vor: ohne transcripts, mit einer Notiz/);
    assert.match(teil, /title bleibt null/);
    assert.match(teil, /Abzuschreiben ist diese Seite: Seite 2/);
  });

  it("nennt Seiten ohne Foto und sagt, wohin das gehört", () => {
    const text = einordnenAuftrag(GANZ, [{ id: B, nummer: 2 }]);
    assert.match(text, new RegExp(`Von Seite 2 \\(id ${B}\\) kam kein Foto mit`));
    assert.match(text, /die Notiz nennt sie/);
  });

  it("nennt kein Werkzeug — der Aufruf hat keines", () => {
    assert.doesNotMatch(einordnenAuftrag(GANZ), /\b(read|propose)_[a-z_]+/);
  });
});

describe("nachleseAuftrag", () => {
  it("wirft bei einer leeren Liste — nie „alle ungelesenen“", () => {
    assert.throws(() => nachleseAuftrag({ seiten: [], nachgereicht: true }), /ohne Seiten/);
  });

  it("schweigt über alles außer der Abschrift und schickt Bemerkungen nach grund", () => {
    const text = nachleseAuftrag({ seiten: [{ id: C, nummer: 3 }], nachgereicht: true });
    assert.match(text, /genau EINE Seite/);
    assert.match(text, /SCHON EINGEORDNET/);
    assert.match(text, /nach dem Einordnen nachgereicht/);
    assert.match(text, /eine Notiz gibt es hier nicht/);
    assert.match(text, new RegExp(`ist genau diese Seite: Seite 3 \\(id ${C}\\)`));
    assert.doesNotMatch(text, /\b(read|propose)_[a-z_]+/);
  });

  it("sagt an einem Altblatt nicht „nachgereicht“", () => {
    const text = nachleseAuftrag({
      seiten: [
        { id: A, nummer: 1 },
        { id: B, nummer: 2 },
      ],
      nachgereicht: false,
    });
    assert.doesNotMatch(text, /nachgereicht/);
    assert.match(text, /genau 2 Seiten/);
    assert.match(text, /sie wurden noch nie gelesen/);
  });

  it("schickt eine Seite ohne Foto in grund, nicht in eine Notiz", () => {
    const text = nachleseAuftrag({ seiten: [{ id: C, nummer: 3 }], nachgereicht: true }, [{ id: C, nummer: 3 }]);
    assert.match(text, /grund nennt sie/);
  });
});

describe("abschreibInhalt", () => {
  const bild = (n: number): ClaudeInhalt => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: String(n) },
  });

  it("stellt vor jedes Foto Nummer und id und schließt mit einem Satz", () => {
    const inhalt = abschreibInhalt("AUFTRAG", [
      { seite: { id: A, nummer: 1 }, bild: bild(1) },
      { seite: { id: C, nummer: 3 }, bild: bild(3) },
    ]);

    assert.deepEqual(
      inhalt.map((block) => (block.type === "text" ? block.text : `Bild ${block.source.data}`)),
      [
        "AUFTRAG",
        `Seite 1 — id ${A}`,
        "Bild 1",
        `Seite 3 — id ${C}`,
        "Bild 3",
        "Das waren alle 2 Seiten. Antworte jetzt in der verlangten Form.",
      ],
    );
  });
});

describe("abschriftenSieben", () => {
  it("lässt nur Seiten aus dem Auftrag durch, je Seite die erste, und nichts über der Grenze", () => {
    const { bleiben, hinweise } = abschriftenSieben(
      [
        { page: ` ${A} `, text: "eins" },
        { page: A, text: "noch einmal" },
        { page: C, text: "fremd" },
        { page: B, text: "y".repeat(PROPOSAL_TRANSCRIPT_MAX + 1) },
      ],
      GANZ.seiten,
    );

    assert.deepEqual(bleiben, [{ page: A, text: "eins" }]);
    assert.equal(hinweise.length, 3);
    assert.match(hinweise.join(" "), /Seite 1 doppelt/);
    assert.match(hinweise.join(" "), /nicht im Auftrag stand \(33333333\)/);
    assert.match(hinweise.join(" "), /Seite 2 länger als 8000 Zeichen, weggelassen und ungelesen/);
  });

  it("zählt Leerraum am Rand nicht mit — die Tür trimmt ihn ohnehin", () => {
    const text = ` ${"z".repeat(PROPOSAL_TRANSCRIPT_MAX)}\n`;
    assert.equal(abschriftenSieben([{ page: A, text }], GANZ.seiten).bleiben.length, 1);
  });

  it("nimmt nur die Abschrift einer Seite heraus, die während des Laufs gelöscht wurde", () => {
    // Die Abnahme vom 11.10.2026: gesiebt wurde nur gegen den Plan, und die
    // Tür wies den ganzen, bezahlten Vorschlag ab.
    const { bleiben, hinweise } = abschriftenSieben(
      [
        { page: A, text: "verwackelt" },
        { page: B, text: "Rückseite" },
      ],
      GANZ.seiten,
      new Set([B]),
    );
    assert.deepEqual(bleiben, [{ page: B, text: "Rückseite" }]);
    assert.deepEqual(hinweise, ["Seite 1 während des Laufs gelöscht, ihre Abschrift verworfen"]);
  });
});

describe("einordnenEingabe", () => {
  it("folgt einem „kein-vorschlag“ und nimmt dann auch keine Abschrift", () => {
    assert.deepEqual(einordnenEingabe(BLATT, antwort({ ergebnis: "kein-vorschlag", grund: " alles unscharf " }), GANZ), {
      art: "kein-vorschlag",
      grund: "alles unscharf",
    });
  });

  it("baut die Eingabe der Tür — ohne Fach, mit höchstens einem Thema", () => {
    const ergebnis = einordnenEingabe(
      BLATT,
      antwort({ topics: [" Kettenregel ", "Ableitung", ""] }),
      GANZ,
    );
    assert.equal(ergebnis.art, "vorschlag");
    if (ergebnis.art !== "vorschlag") return;

    assert.equal(ergebnis.eingabe.sheet, BLATT);
    assert.equal(ergebnis.eingabe.subjectId, null);
    assert.deepEqual(ergebnis.eingabe.topics, ["Kettenregel"]);
    assert.equal(ergebnis.eingabe.title, "Die Kettenregel");
    assert.deepEqual(ergebnis.eingabe.transcripts, [
      { page: A, text: "Vorderseite" },
      { page: B, text: "" },
    ]);
    assert.match(ergebnis.hinweise.join(" "), /2 Themen genannt, nur das erste genommen/);
  });

  it("verwirft einen Titel, wenn die erste Seite fehlte oder er zu lang ist — nur ihn", () => {
    const ohneErste = einordnenEingabe(BLATT, antwort(), { ...GANZ, ersteSeiteDabei: false });
    assert.equal(ohneErste.art === "vorschlag" && ohneErste.eingabe.title, null);

    const lang = einordnenEingabe(BLATT, antwort({ title: "T".repeat(81) }), GANZ);
    assert.equal(lang.art, "vorschlag");
    if (lang.art !== "vorschlag") return;
    assert.equal(lang.eingabe.title, null);
    assert.equal(lang.eingabe.transcripts?.length, 2);
    assert.match(lang.hinweise.join(" "), /Titel verworfen, zu lang/);
  });

  it("nimmt einen Tag nur, wenn er abweicht, ein echtes Datum ist und schon war", () => {
    const tag = (captured_on: string) => {
      const ergebnis = einordnenEingabe(BLATT, antwort({ captured_on }), GANZ);
      return ergebnis.art === "vorschlag" ? ergebnis.eingabe.capturedOn : "kein Vorschlag";
    };

    assert.equal(tag("2026-09-30"), "2026-09-30");
    assert.equal(tag("2026-10-01"), null);
    assert.equal(tag("2026-02-30"), null);
    assert.equal(tag("21.8.2026"), null);
    assert.equal(tag("2999-01-01"), null);
  });

  it("kürzt eine zu lange Notiz mit „…“, statt sie oder den Vorschlag zu verlieren", () => {
    const ergebnis = einordnenEingabe(BLATT, antwort({ note: "n".repeat(MATERIAL_NOTE_MAX + 50) }), GANZ);
    assert.equal(ergebnis.art, "vorschlag");
    if (ergebnis.art !== "vorschlag") return;
    assert.equal(ergebnis.eingabe.note?.length, MATERIAL_NOTE_MAX);
    assert.equal(ergebnis.eingabe.note?.endsWith("…"), true);
  });

  it("macht aus einem Vorschlag, von dem nichts übrig bleibt, „nichts“ und sagt warum", () => {
    const ergebnis = einordnenEingabe(
      BLATT,
      antwort({ title: null, topics: [], transcripts: [{ page: C, text: "fremd" }] }),
      GANZ,
    );
    assert.equal(ergebnis.art, "nichts");
    assert.match(ergebnis.art === "nichts" ? ergebnis.grund : "", /nicht im Auftrag stand/);
  });

  it("lässt einen Vorschlag nur mit Notiz durch — das Teilblatt ohne lesbare Seite", () => {
    const ergebnis = einordnenEingabe(
      BLATT,
      antwort({ title: null, topics: [], transcripts: [], note: "Seite 2 zu unscharf." }),
      { ...GANZ, seiten: [{ id: B, nummer: 2 }], vollstaendig: false, ersteSeiteDabei: false },
    );
    assert.equal(ergebnis.art, "vorschlag");
    assert.equal(ergebnis.art === "vorschlag" && ergebnis.eingabe.note, "Seite 2 zu unscharf.");
  });
});

describe("nachleseEingabe", () => {
  const vorab = { seiten: [{ id: C, nummer: 3 }], nachgereicht: true };

  it("gibt der Tür nur Abschriften — nichts sonst", () => {
    const ergebnis = nachleseEingabe(
      BLATT,
      { transcripts: [{ page: C, text: "Rückseite" }], ergebnis: "vorschlag", grund: "" },
      vorab,
    );
    assert.deepEqual(ergebnis, {
      art: "vorschlag",
      eingabe: { sheet: BLATT, subjectId: null, transcripts: [{ page: C, text: "Rückseite" }] },
      hinweise: [],
    });
  });

  it("nimmt keine Seite, die nicht im Auftrag stand — dann ist es „nichts“", () => {
    const ergebnis = nachleseEingabe(
      BLATT,
      { transcripts: [{ page: A, text: "alte Seite" }], ergebnis: "vorschlag", grund: "" },
      vorab,
    );
    assert.equal(ergebnis.art, "nichts");
  });

  it("folgt einem „kein-vorschlag“", () => {
    assert.deepEqual(
      nachleseEingabe(BLATT, { transcripts: [], ergebnis: "kein-vorschlag", grund: "" }, vorab),
      { art: "kein-vorschlag", grund: "ohne Angabe" },
    );
  });
});
