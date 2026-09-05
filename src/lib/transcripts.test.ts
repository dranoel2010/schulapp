import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UNCERTAIN_CLOSE,
  UNCERTAIN_OPEN,
  outdatedTranscriptPages,
  splitTranscript,
  transcriptBaseline,
  transcriptBaselineFieldName,
  transcriptFieldId,
  transcriptFieldName,
  transcriptPreview,
  transcriptsFromForm,
  uncertainSpans,
} from "@/lib/transcripts";

/**
 * Die Zusage, ohne die die Hervorhebung nicht sein dürfte: aneinandergehängt
 * ergeben die Stücke wieder genau die Eingabe. Solange das gilt, kann die
 * Anzeige den Text nicht verfälschen — sie legt nur Farbe darüber.
 */
function unveraendert(text: string): void {
  assert.equal(
    splitTranscript(text)
      .map((part) => part.text)
      .join(""),
    text,
    "die Zerlegung hat den Text verändert",
  );
}

describe("splitTranscript", () => {
  it("gibt den Text unverändert zurück", () => {
    unveraendert("");
    unveraendert("Kurvendiskussion");
    unveraendert("f(x) = ⟨2x⟩ + 3");
    unveraendert("⟨ganz unsicher⟩");
    unveraendert("⟨a⟩⟨b⟩");
    unveraendert("Zeile 1\nZeile ⟨2?⟩\n\nZeile 4");
  });

  it("markiert die Klammern samt Inhalt", () => {
    assert.deepEqual(splitTranscript("a ⟨b⟩ c"), [
      { text: "a ", uncertain: false },
      { text: "⟨b⟩", uncertain: true },
      { text: " c", uncertain: false },
    ]);
  });

  it("schneidet die Klammern nicht ab", () => {
    // Sie müssen im Ausschnitt stehen bleiben: das Feld darunter zeigt
    // denselben Text, und wer eine Stelle sucht, sucht nach der Klammer.
    const [part] = splitTranscript("⟨Kettenregel?⟩");
    assert.equal(part.text, "⟨Kettenregel?⟩");
  });

  it("rät bei einer offenen Klammer nichts dazu", () => {
    const text = "hier fehlt ⟨ das Gegenstück";
    assert.deepEqual(splitTranscript(text), [{ text, uncertain: false }]);
  });

  it("hängt zwei Klammern nicht zu einer zusammen", () => {
    // Fräße die Zeichenklasse die schließende Klammer mit, wäre „⟩ und ⟨" ein
    // einziges unsicheres Stück — und der sichere Text dazwischen stünde
    // hervorgehoben da, obwohl niemand an ihm gezweifelt hat.
    assert.deepEqual(uncertainSpans("⟨a⟩ sicher ⟨b⟩"), ["⟨a⟩", "⟨b⟩"]);
  });
});

describe("uncertainSpans", () => {
  it("zählt jede Stelle einzeln", () => {
    assert.deepEqual(uncertainSpans("⟨a⟩ und ⟨b c⟩"), ["⟨a⟩", "⟨b c⟩"]);
  });

  it("hält kleiner und größer aus", () => {
    // Der Grund, warum es U+27E8 und U+27E9 sind und nicht < und >: auf einem
    // Arbeitsblatt in Mathematik steht das in jeder zweiten Zeile.
    assert.deepEqual(uncertainSpans("für alle x mit 0 < x < 5 gilt"), []);
  });

  it("findet genau die Zeichen, die die Konstanten nennen", () => {
    // Der Ausdruck steht als ⟨…⟩ im Quelltext, die beiden Konstanten
    // als Zeichen. Liefen sie auseinander, hieße die Oberfläche den Nutzer
    // nach Klammern suchen, die die Rechnung gar nicht kennt.
    const text = `${UNCERTAIN_OPEN}Kettenregel${UNCERTAIN_CLOSE}`;
    assert.deepEqual(uncertainSpans(text), [text]);
  });

  it("gibt bei jedem Aufruf dasselbe zurück", () => {
    // Ein im Modul liegender Ausdruck mit `g` schleppte seinen lastIndex mit
    // und überspränge beim zweiten Aufruf die Hälfte. Hier tippt jemand, und
    // jeder Tastendruck ruft neu.
    const text = "⟨a⟩ ⟨b⟩ ⟨c⟩";
    assert.deepEqual(uncertainSpans(text), uncertainSpans(text));
  });
});

describe("transcriptPreview", () => {
  it("nimmt die erste Zeile", () => {
    assert.equal(
      transcriptPreview("Kurvendiskussion\nAufgabe 1\nAufgabe 2"),
      "Kurvendiskussion",
    );
  });

  it("übergeht führenden Leerraum", () => {
    assert.equal(transcriptPreview("\n\n  Zellatmung\nmehr"), "Zellatmung");
  });

  it("kürzt mit Auslassungszeichen", () => {
    const preview = transcriptPreview("x".repeat(200));
    assert.equal(preview.length, 80);
    assert.ok(preview.endsWith("…"));
  });

  it("gibt für eine leere Abschrift nichts zurück", () => {
    // Der leere String heißt „gelesen, und es stand nichts darauf" — die
    // Oberfläche setzt dafür ihren eigenen Satz und darf keinen Ersatztext
    // von hier bekommen.
    assert.equal(transcriptPreview(""), "");
    assert.equal(transcriptPreview("   \n "), "");
  });
});

describe("die Feldnamen", () => {
  it("nennen die Seite im Namen", () => {
    assert.equal(transcriptFieldName("abc"), "abschrift:abc");
  });

  it("trennen den Anker anders als das Feld", () => {
    // Der Doppelpunkt ist in einem CSS-Selektor ein Sonderzeichen; im Anker
    // steht deshalb ein Bindestrich. Fielen die beiden zusammen, hinge der
    // Sprung aus der Leseansicht an einem Selektor, der nichts findet.
    assert.equal(transcriptFieldId("abc"), "abschrift-abc");
    assert.notEqual(transcriptFieldId("abc"), transcriptFieldName("abc"));
  });

  it("halten das versteckte Standfeld vom Textfeld getrennt", () => {
    // Fielen die beiden Namen zusammen, überschriebe das versteckte Feld die
    // Abschrift, die daneben getippt wurde — und zwar still.
    assert.notEqual(
      transcriptBaselineFieldName("abc"),
      transcriptFieldName("abc"),
    );
    assert.notEqual(
      transcriptBaselineFieldName("abc"),
      transcriptFieldId("abc"),
    );
  });
});

describe("transcriptBaseline", () => {
  it("hält NULL und den leeren String auseinander", () => {
    // Der Unterschied, an dem die ganze Spalte hängt: „noch niemand hat
    // gelesen" gegen „gelesen, es stand nichts darauf". Fielen beide auf
    // dasselbe Zeichen, merkte niemand, dass eine Seite inzwischen gelesen
    // wurde.
    assert.notEqual(transcriptBaseline(null), transcriptBaseline(0));
  });

  it("unterscheidet zwei Längen", () => {
    assert.notEqual(transcriptBaseline(0), transcriptBaseline(1240));
    assert.notEqual(transcriptBaseline(1240), transcriptBaseline(1241));
  });

  it("gibt für denselben Stand dasselbe Zeichen", () => {
    assert.equal(transcriptBaseline(1240), transcriptBaseline(1240));
    assert.equal(transcriptBaseline(null), transcriptBaseline(null));
  });
});

describe("transcriptsFromForm", () => {
  /** Ein Formular mit genau diesen Abschriftfeldern. */
  function formular(felder: Record<string, string>): FormData {
    const formData = new FormData();

    formData.set("title", "Arbeitsblatt");
    for (const [pageId, text] of Object.entries(felder)) {
      formData.set(transcriptFieldName(pageId), text);
    }

    return formData;
  }

  it("schreibt, was im Feld steht", () => {
    assert.deepEqual(
      transcriptsFromForm(formular({ p1: "Kurvendiskussion" }), [
        { pageId: "p1", known: false },
      ]),
      [{ pageId: "p1", text: "Kurvendiskussion" }],
    );
  });

  it("lässt eine ungelesene Seite bei einem leeren Feld in Ruhe", () => {
    // Der wichtigste der drei Fälle: NULL heißt „hat noch niemand gelesen",
    // und ein Formular, das zwölf leere Felder mitschickt, darf daraus nicht
    // zwölfmal „gelesen, nichts darauf" machen.
    assert.deepEqual(
      transcriptsFromForm(formular({ p1: "" }), [
        { pageId: "p1", known: false },
      ]),
      [],
    );
  });

  it("schreibt den leeren String, wo schon eine Abschrift steht", () => {
    assert.deepEqual(
      transcriptsFromForm(formular({ p1: "" }), [{ pageId: "p1", known: true }]),
      [{ pageId: "p1", text: "" }],
    );
  });

  it("hält eine Seite aus lauter Leerraum für leer", () => {
    assert.deepEqual(
      transcriptsFromForm(formular({ p1: "  \n\n " }), [
        { pageId: "p1", known: false },
      ]),
      [],
    );
  });

  it("lässt die Leerzeilen INNERHALB einer Seite stehen", () => {
    // Ein Tafelanschrieb ist untereinander geschrieben. Nur die Ränder fallen
    // weg — dieselbe Regel wie in `transcriptSchema`.
    const [entry] = transcriptsFromForm(formular({ p1: "\nA\n\nB\n" }), [
      { pageId: "p1", known: false },
    ]);

    assert.equal(entry.text, "A\n\nB");
  });

  it("fasst eine Seite ohne Feld nicht an", () => {
    // Zwischen Anzeigen und Abschicken kann eine Seite gelöscht worden sein,
    // und ein altes Formular schickt sie trotzdem mit. Umgekehrt gilt: was
    // kein Feld hat, behält, was an ihm steht.
    assert.deepEqual(
      transcriptsFromForm(formular({ p1: "steht so da" }), [
        { pageId: "p1", known: true },
        { pageId: "p2", known: true },
      ]),
      [{ pageId: "p1", text: "steht so da" }],
    );
  });

  it("nimmt keine Seite an, die nicht zum Blatt gehört", () => {
    // Gelaufen wird über die Seiten des Blattes. Ein untergeschobener
    // Feldname zeigt auf nichts, was gefragt wird — er wird deshalb nicht
    // abgewiesen, sondern gar nicht erst gelesen.
    assert.deepEqual(
      transcriptsFromForm(formular({ fremd: "eingeschmuggelt" }), [
        { pageId: "p1", known: true },
      ]),
      [],
    );
  });

  it("hält die Reihenfolge der Seiten", () => {
    assert.deepEqual(
      transcriptsFromForm(formular({ p1: "eins", p2: "zwei" }), [
        { pageId: "p2", known: true },
        { pageId: "p1", known: true },
      ]),
      [
        { pageId: "p2", text: "zwei" },
        { pageId: "p1", text: "eins" },
      ],
    );
  });

  it("hält eine Datei unter dem Feldnamen für nichts", () => {
    const formData = new FormData();
    formData.set(transcriptFieldName("p1"), new File([], "bild.webp"));

    assert.deepEqual(
      transcriptsFromForm(formData, [{ pageId: "p1", known: true }]),
      [],
    );
  });
});

/**
 * Der Bildschirm, der vor einer fremden Änderung gerendert wurde.
 *
 * Der Ablauf, den diese Prüfung festhält: die Seite trägt beim Rendern NULL,
 * das Feld steht deshalb leer und zugeklappt da; dann schreibt der Postbote
 * 1240 Zeichen hinein; dann drückt derselbe alte Bildschirm auf „Speichern".
 * Ohne den mitgeschickten Stand kommt das leere Feld an, `known` ist inzwischen
 * `true`, und daraus wird "" — die 1240 Zeichen sind weg, ohne Meldung.
 */
describe("transcriptsFromForm gegen einen überholten Bildschirm", () => {
  /**
   * Ein Formular, wie das gerenderte es abschickt: je Seite das Textfeld und
   * daneben der Stand, den die Seite BEIM RENDERN hatte.
   */
  function formularMitStand(
    felder: Record<string, { text: string; gerendert: number | null }>,
  ): FormData {
    const formData = new FormData();

    for (const [pageId, { text, gerendert }] of Object.entries(felder)) {
      formData.set(transcriptFieldName(pageId), text);
      formData.set(
        transcriptBaselineFieldName(pageId),
        transcriptBaseline(gerendert),
      );
    }

    return formData;
  }

  it("überschreibt eine frische Abschrift nicht mit dem leeren String", () => {
    // Der Fund selbst, Zug um Zug: gerendert bei NULL, inzwischen 1240 Zeichen.
    const formData = formularMitStand({ p1: { text: "", gerendert: null } });
    const seiten = [
      { pageId: "p1", known: true, baseline: transcriptBaseline(1240) },
    ];

    assert.deepEqual(transcriptsFromForm(formData, seiten), []);
    assert.deepEqual(outdatedTranscriptPages(formData, seiten), ["p1"]);
  });

  it("schreibt, solange sich der Stand nicht geändert hat", () => {
    const formData = formularMitStand({
      p1: { text: "Kurvendiskussion", gerendert: 3 },
    });
    const seiten = [
      { pageId: "p1", known: true, baseline: transcriptBaseline(3) },
    ];

    assert.deepEqual(transcriptsFromForm(formData, seiten), [
      { pageId: "p1", text: "Kurvendiskussion" },
    ]);
    assert.deepEqual(outdatedTranscriptPages(formData, seiten), []);
  });

  it("erkennt auch die Änderung an einer schon gelesenen Seite", () => {
    // Gerendert stand dort „gelesen, nichts darauf"; inzwischen steht doch
    // etwas da. Ein getippter Text dürfte das nicht blind ersetzen.
    const formData = formularMitStand({
      p1: { text: "meine Fassung", gerendert: 0 },
    });
    const seiten = [
      { pageId: "p1", known: true, baseline: transcriptBaseline(1240) },
    ];

    assert.deepEqual(transcriptsFromForm(formData, seiten), []);
    assert.deepEqual(outdatedTranscriptPages(formData, seiten), ["p1"]);
  });

  it("lässt die übrigen Seiten trotzdem durch", () => {
    // Eine fremde Änderung an Seite 2 darf nicht die Eingabe an Seite 1 und 3
    // verwerfen — deshalb ein Standfeld je Seite und keins fürs Blatt.
    const formData = formularMitStand({
      p1: { text: "eins", gerendert: 4 },
      p2: { text: "", gerendert: null },
      p3: { text: "drei", gerendert: null },
    });
    const seiten = [
      { pageId: "p1", known: true, baseline: transcriptBaseline(4) },
      { pageId: "p2", known: true, baseline: transcriptBaseline(1240) },
      { pageId: "p3", known: false, baseline: transcriptBaseline(null) },
    ];

    assert.deepEqual(transcriptsFromForm(formData, seiten), [
      { pageId: "p1", text: "eins" },
      { pageId: "p3", text: "drei" },
    ]);
    assert.deepEqual(outdatedTranscriptPages(formData, seiten), ["p2"]);
  });

  it("prüft nichts, wo der Aufrufer keinen Stand angibt", () => {
    // `confirmProposalAction` rechnet sein `known` aus Bestand ODER Vorschlag
    // und führt den Vergleich heute nicht. Ohne `baseline` muss deshalb genau
    // das alte Verhalten herauskommen.
    const formData = formularMitStand({ p1: { text: "", gerendert: null } });
    const seiten = [{ pageId: "p1", known: true }];

    assert.deepEqual(transcriptsFromForm(formData, seiten), [
      { pageId: "p1", text: "" },
    ]);
    assert.deepEqual(outdatedTranscriptPages(formData, seiten), []);
  });

  it("erkennt eine Ersetzung durch gleich viele Zeichen NICHT", () => {
    // Die Grenze des Verfahrens, ausgeschrieben statt verschwiegen: das
    // Zeichen zählt Zeichen, es liest sie nicht. Wer den Stand eines Tages
    // genauer fasst, muss diese Zeile ändern — und dann auch den Absatz an
    // `transcriptBaseline()`, der die Lücke heute zugibt.
    const formData = formularMitStand({
      p1: { text: "meine Fassung", gerendert: 4 },
    });
    const seiten = [
      { pageId: "p1", known: true, baseline: transcriptBaseline(4) },
    ];

    assert.deepEqual(transcriptsFromForm(formData, seiten), [
      { pageId: "p1", text: "meine Fassung" },
    ]);
  });

  describe("ein Bildschirm, der den Stand gar nicht mitschickt", () => {
    // Eine Seite aus dem PAGE_CACHE des Service Workers stammt womöglich von
    // vor dieser Änderung und kennt das versteckte Feld nicht. Dann greift der
    // teure Teilfall: Text wird von einem leeren Feld nicht gelöscht.
    function formularOhneStand(text: string): FormData {
      const formData = new FormData();
      formData.set(transcriptFieldName("p1"), text);

      return formData;
    }

    it("löscht eine vorhandene Abschrift nicht mit einem leeren Feld", () => {
      const formData = formularOhneStand("");
      const seiten = [
        { pageId: "p1", known: true, baseline: transcriptBaseline(1240) },
      ];

      assert.deepEqual(transcriptsFromForm(formData, seiten), []);
      assert.deepEqual(outdatedTranscriptPages(formData, seiten), ["p1"]);
    });

    it("schreibt trotzdem, was jemand hineingetippt hat", () => {
      // Ersetzen bleibt erlaubt: dort sieht der Nutzer, was er schreibt, und
      // es gilt dieselbe Letzter-gewinnt-Regel wie für Titel und Notiz.
      const formData = formularOhneStand("meine Fassung");
      const seiten = [
        { pageId: "p1", known: true, baseline: transcriptBaseline(1240) },
      ];

      assert.deepEqual(transcriptsFromForm(formData, seiten), [
        { pageId: "p1", text: "meine Fassung" },
      ]);
      assert.deepEqual(outdatedTranscriptPages(formData, seiten), []);
    });

    it("macht aus einer schon leeren Seite keinen Fund", () => {
      // „Gelesen, nichts darauf" noch einmal auf "" zu setzen ändert nichts.
      // Ein Hinweis darüber wäre eine Meldung über einen Vorgang, den es nicht
      // gab.
      const formData = formularOhneStand("");
      const seiten = [
        { pageId: "p1", known: true, baseline: transcriptBaseline(0) },
      ];

      assert.deepEqual(transcriptsFromForm(formData, seiten), [
        { pageId: "p1", text: "" },
      ]);
      assert.deepEqual(outdatedTranscriptPages(formData, seiten), []);
    });
  });

  it("meldet keine Seite, die ohnehin nicht angefasst würde", () => {
    // Ungelesene Seite, leeres Feld: sie bleibt NULL, so wie vorher. Stünde
    // sie in der Meldung, läse der Nutzer, an einer Seite habe jemand anders
    // geschrieben, an der nach wie vor nichts steht.
    const formData = formularMitStand({ p1: { text: "", gerendert: null } });
    const seiten = [
      { pageId: "p1", known: false, baseline: transcriptBaseline(1240) },
    ];

    assert.deepEqual(transcriptsFromForm(formData, seiten), []);
    assert.deepEqual(outdatedTranscriptPages(formData, seiten), []);
  });
});
