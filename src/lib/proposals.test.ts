import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXAM_TITLE_MAX,
  HOMEWORK_TITLE_MAX,
  PROPOSAL_KINDS,
  fingerprintOf,
  hausaufgabePayloadSchema,
  isProposalKind,
  klausurPayloadSchema,
  parsePayload,
  proposalHeadline,
  themenPayloadSchema,
} from "@/lib/proposals";
import { TOPIC_LIMIT, TOPIC_MAX_LENGTH } from "@/lib/topics";

/**
 * Die reinen Teile von @/lib/proposals: die drei Prüfschemata, der Abdruck und
 * die Überschrift einer Karte.
 *
 * Sie laufen ohne Datenbank — `@/db` gibt einen faulen Proxy heraus, die
 * Verbindung entsteht erst bei der ersten echten Abfrage. Ein Import dieser
 * Datei öffnet also keine PGlite.
 *
 * Warum gerade diese drei geprüft werden: sie sind die Tür, durch die ein
 * Agent in die App hineinredet. Was das Schema durchlässt, steht später auf
 * einem Bildschirm und wird von einem Menschen mit einem Tipp übernommen — ein
 * Loch hier ist ein Loch im ganzen Weg. Der Abdruck wiederum trägt die einzige
 * Zusage, die den Korb vor einem eifrigen Agenten schützt.
 */

const BLATT = "3f7c1a2e-8b4d-4c9a-9e51-0d6f2a7b1c34";
const ANDERES_BLATT = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

/** Die Meldungen zu einem Feld, so wie ein Formular sie einsammeln würde. */
function issuesFor(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } },
  field: string,
  input: unknown,
): string[] {
  const result = schema.safeParse(input);
  if (result.success) return [];

  return (result.error?.issues ?? [])
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

describe("themenPayloadSchema", () => {
  it("nimmt eine gewöhnliche Themenliste an", () => {
    const parsed = themenPayloadSchema.safeParse({
      titel: ["Kettenregel", "Produktregel"],
    });

    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.data?.titel, ["Kettenregel", "Produktregel"]);
  });

  it("schneidet mit denselben Regeln zu wie jedes Formular der App", () => {
    // normalizeTopics: getrimmt, ohne Leerzeilen, ohne Dubletten, erster
    // gewinnt. Ein Agent bekommt hier keine großzügigere Behandlung als ein
    // Mensch — stünde hier eine eigene Regel, nähme die App an einer Tür an,
    // was sie an einer anderen ablehnt.
    const parsed = themenPayloadSchema.safeParse({
      titel: ["  Kettenregel  ", "", "kettenregel", "Produktregel"],
    });

    assert.deepEqual(parsed.data?.titel, ["Kettenregel", "Produktregel"]);
  });

  it("kürzt einen zu langen Titel, statt den ganzen Vorschlag abzulehnen", () => {
    const parsed = themenPayloadSchema.safeParse({
      titel: ["x".repeat(TOPIC_MAX_LENGTH + 20)],
    });

    assert.equal(parsed.data?.titel[0]?.length, TOPIC_MAX_LENGTH);
  });

  it("deckelt bei TOPIC_LIMIT", () => {
    const viele = Array.from({ length: TOPIC_LIMIT + 10 }, (_, i) => `Thema ${i}`);
    const parsed = themenPayloadSchema.safeParse({ titel: viele });

    assert.equal(parsed.data?.titel.length, TOPIC_LIMIT);
  });

  it("weist eine Liste ab, aus der nach dem Zuschnitt nichts bleibt", () => {
    // Der Fall ist nicht theoretisch: ein Agent, der nichts gefunden hat, mag
    // trotzdem antworten — mit leeren Zeichenketten. Daraus darf keine Karte
    // werden, die auf dem Bildschirm gar nichts sagt.
    for (const titel of [[], ["", "   "], ["\n"]]) {
      assert.equal(
        themenPayloadSchema.safeParse({ titel }).success,
        false,
        JSON.stringify(titel),
      );
    }
  });

  it("weist alles ab, was keine Liste von Zeichenketten ist", () => {
    for (const titel of ["Kettenregel", 42, null, { a: 1 }, [1, 2]]) {
      assert.equal(
        themenPayloadSchema.safeParse({ titel }).success,
        false,
        JSON.stringify(titel),
      );
    }
  });
});

describe("hausaufgabePayloadSchema", () => {
  it("nimmt Titel, Tag und Notiz an", () => {
    const parsed = hausaufgabePayloadSchema.safeParse({
      titel: "S. 47 Nr. 3–7",
      faellig: "2026-09-14",
      notiz: "Die Zeichnung nicht vergessen.",
    });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.faellig, "2026-09-14");
  });

  it("lässt den Tag weg, wenn auf dem Blatt keiner stand", () => {
    // Kein erfundenes Datum: das Formular schlägt beim Übernehmen die nächste
    // Stunde des Fachs vor, so wie beim Eintragen von Hand.
    for (const faellig of [undefined, null, "", "   "]) {
      const parsed = hausaufgabePayloadSchema.safeParse({
        titel: "S. 47",
        faellig,
      });

      assert.equal(parsed.success, true, String(faellig));
      assert.equal(parsed.data?.faellig, null);
    }
  });

  it("nimmt einen Tag in der Vergangenheit an", () => {
    // Ein Vorschlag ist eine Behauptung über ein Blatt und kein Eintrag. Ob
    // der Tag noch geht, entscheidet das Formular beim Übernehmen — sonst
    // ließe sich ein zwei Wochen alter Vorschlag gar nicht mehr ansehen.
    const parsed = hausaufgabePayloadSchema.safeParse({
      titel: "S. 47",
      faellig: "2020-01-02",
    });

    assert.equal(parsed.success, true);
  });

  it("weist einen Tag ab, den es nicht gibt", () => {
    for (const faellig of ["2026-02-30", "14.9.2026", "2026-9-14", "morgen"]) {
      assert.equal(
        hausaufgabePayloadSchema.safeParse({ titel: "S. 47", faellig }).success,
        false,
        faellig,
      );
    }
  });

  it("besteht auf einem Titel", () => {
    assert.deepEqual(issuesFor(hausaufgabePayloadSchema, "titel", { titel: "  " }), [
      "Was ist aufgegeben?",
    ]);
  });

  it("hält dieselbe Titellänge ein wie das Formular", () => {
    const gerade = "x".repeat(HOMEWORK_TITLE_MAX);
    const zuviel = "x".repeat(HOMEWORK_TITLE_MAX + 1);

    assert.equal(
      hausaufgabePayloadSchema.safeParse({ titel: gerade }).success,
      true,
    );
    assert.equal(
      hausaufgabePayloadSchema.safeParse({ titel: zuviel }).success,
      false,
    );
  });

  it("macht aus einer leeren Notiz null und nicht \"\"", () => {
    const parsed = hausaufgabePayloadSchema.safeParse({
      titel: "S. 47",
      notiz: "   ",
    });

    assert.equal(parsed.data?.notiz, null);
  });
});

describe("klausurPayloadSchema", () => {
  it("nimmt Datum, Art, Titel und Themen an", () => {
    const parsed = klausurPayloadSchema.safeParse({
      datum: "2026-10-14",
      art: "test",
      titel: "Analysis",
      themen: ["Kettenregel"],
    });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.art, "test");
    assert.deepEqual(parsed.data?.themen, ["Kettenregel"]);
  });

  it("nimmt „klausur“ an, wenn die Art fehlt", () => {
    const parsed = klausurPayloadSchema.safeParse({ datum: "2026-10-14" });

    assert.equal(parsed.data?.art, "klausur");
    assert.deepEqual(parsed.data?.themen, []);
  });

  it("kennt genau die vier Arten der App", () => {
    for (const art of ["klausur", "test", "referat", "muendlich"]) {
      assert.equal(
        klausurPayloadSchema.safeParse({ datum: "2026-10-14", art }).success,
        true,
        art,
      );
    }

    for (const art of ["Klausur", "exam", "schulaufgabe", ""]) {
      assert.equal(
        klausurPayloadSchema.safeParse({ datum: "2026-10-14", art }).success,
        false,
        art,
      );
    }
  });

  it("besteht auf einem Datum, das es gibt", () => {
    for (const datum of ["", "2026-02-30", "14.10.2026", "bald"]) {
      assert.equal(
        klausurPayloadSchema.safeParse({ datum }).success,
        false,
        datum,
      );
    }
  });

  it("hält dieselbe Titellänge ein wie das Klausurformular", () => {
    assert.equal(
      klausurPayloadSchema.safeParse({
        datum: "2026-10-14",
        titel: "x".repeat(EXAM_TITLE_MAX + 1),
      }).success,
      false,
    );
  });
});

describe("parsePayload", () => {
  it("gibt zu jeder bekannten Art ihren geprüften Inhalt zurück", () => {
    const themen = parsePayload("themen", { titel: ["Kettenregel"] });
    assert.equal(themen.ok, true);
    assert.deepEqual(themen.ok && themen.payload.titel, ["Kettenregel"]);

    const klausur = parsePayload("klausur", { datum: "2026-10-14" });
    assert.equal(klausur.ok, true);
    assert.equal(klausur.ok && klausur.payload.datum, "2026-10-14");
  });

  it("gibt einen deutschen Satz zurück und keine zod-Meldung", () => {
    const result = parsePayload("hausaufgabe", { titel: "" });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.satz, "Was ist aufgegeben?");
  });

  it("kennt genau die drei Arten aus dem Schema", () => {
    assert.deepEqual([...PROPOSAL_KINDS].sort(), [
      "hausaufgabe",
      "klausur",
      "themen",
    ]);

    for (const kind of PROPOSAL_KINDS) assert.equal(isProposalKind(kind), true);
    for (const kind of ["note", "blatt", "", "Themen"]) {
      assert.equal(isProposalKind(kind), false, kind);
    }
  });
});

describe("fingerprintOf", () => {
  const themen = (titel: string[]) => ({ titel });

  it("ist derselbe, egal in welcher Reihenfolge die Themen kamen", () => {
    // Der Fall, für den der Abdruck gebaut ist: derselbe Agent liest dasselbe
    // Blatt ein zweites Mal und nennt die Themen anders herum. Zwei Karten mit
    // demselben Inhalt wären der Anfang eines unbenutzbaren Korbs.
    assert.equal(
      fingerprintOf(BLATT, "themen", themen(["Kettenregel", "Produktregel"])),
      fingerprintOf(BLATT, "themen", themen(["Produktregel", "Kettenregel"])),
    );
  });

  it("ist derselbe bei anderer Groß-/Kleinschreibung", () => {
    assert.equal(
      fingerprintOf(BLATT, "themen", themen(["Kettenregel"])),
      fingerprintOf(BLATT, "themen", themen(["kettenregel"])),
    );
  });

  it("unterscheidet zwei Titel, die nur ähnlich sind", () => {
    // Hier wird ausdrücklich mit topicKey gefaltet und nicht mit
    // vocabularyKey: „Kettenregel Übungen“ ist ein anderer Vorschlag als
    // „Kettenregel“, auch wenn am Ende dieselbe Vokabel daraus wird.
    assert.notEqual(
      fingerprintOf(BLATT, "themen", themen(["Kettenregel"])),
      fingerprintOf(BLATT, "themen", themen(["Kettenregel Übungen"])),
    );
  });

  it("unterscheidet nach Blatt und nach Art", () => {
    assert.notEqual(
      fingerprintOf(BLATT, "themen", themen(["Kettenregel"])),
      fingerprintOf(ANDERES_BLATT, "themen", themen(["Kettenregel"])),
    );

    assert.notEqual(
      fingerprintOf(BLATT, "themen", themen(["Kettenregel"])),
      fingerprintOf(BLATT, "hausaufgabe", {
        titel: "Kettenregel",
        faellig: null,
        notiz: null,
      }),
    );
  });

  it("unterscheidet zwei Aufgaben mit verschiedenem Tag", () => {
    const aufgabe = (faellig: string | null) => ({
      titel: "S. 47",
      faellig,
      notiz: null,
    });

    assert.notEqual(
      fingerprintOf(BLATT, "hausaufgabe", aufgabe("2026-09-14")),
      fingerprintOf(BLATT, "hausaufgabe", aufgabe("2026-09-15")),
    );
    assert.equal(
      fingerprintOf(BLATT, "hausaufgabe", aufgabe(null)),
      fingerprintOf(BLATT, "hausaufgabe", aufgabe(null)),
    );
  });

  it("unterscheidet zwei Termine mit verschiedener Art", () => {
    const termin = (art: "klausur" | "test") => ({
      datum: "2026-10-14",
      art,
      titel: null,
      themen: [],
    });

    assert.notEqual(
      fingerprintOf(BLATT, "klausur", termin("klausur")),
      fingerprintOf(BLATT, "klausur", termin("test")),
    );
  });

  it("ist ein Hash fester Länge und nicht der Inhalt selbst", () => {
    // Die Spalte trägt einen Index. Ein Vorschlag mit vierzig Themen wäre als
    // Text ein Kilobyte lang.
    const viele = Array.from({ length: TOPIC_LIMIT }, (_, i) => `Thema ${i}`);

    assert.match(fingerprintOf(BLATT, "themen", themen(viele)), /^[0-9a-f]{64}$/);
  });
});

describe("proposalHeadline", () => {
  it("zählt Themen und trifft beide Zahlformen", () => {
    assert.equal(
      proposalHeadline("themen", { titel: ["Kettenregel"] }),
      "Ein Thema für dieses Blatt",
    );
    assert.equal(
      proposalHeadline("themen", { titel: ["Kettenregel", "Produktregel"] }),
      "2 Themen für dieses Blatt",
    );
  });

  it("nennt eine Aufgabe eine Aufgabe", () => {
    assert.equal(
      proposalHeadline("hausaufgabe", {
        titel: "S. 47",
        faellig: null,
        notiz: null,
      }),
      "Eine Aufgabe von diesem Blatt",
    );
  });

  it("nennt bei einem Termin Art und Tag", () => {
    const termin = (art: "klausur" | "test" | "referat" | "muendlich") => ({
      datum: "2026-10-14",
      art,
      titel: null,
      themen: [],
    });

    assert.equal(
      proposalHeadline("klausur", termin("klausur")),
      "Eine Klausur am 14.10.",
    );
    assert.equal(proposalHeadline("klausur", termin("test")), "Ein Test am 14.10.");
    assert.equal(
      proposalHeadline("klausur", termin("referat")),
      "Ein Referat am 14.10.",
    );
    assert.equal(
      proposalHeadline("klausur", termin("muendlich")),
      "Eine mündliche Prüfung am 14.10.",
    );
  });
});
