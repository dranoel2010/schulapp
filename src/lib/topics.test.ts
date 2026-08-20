import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TOPIC_LIMIT,
  TOPIC_MAX_LENGTH,
  hasVocabularyKey,
  normalizeTopics,
  topicKey,
  vocabularyKey,
} from "@/lib/topics";

/**
 * Zwei Titel meinen dasselbe Fachthema. Der Schlüssel darf dabei nicht leer
 * sein — sonst bestünde der Test auch dann noch, wenn `vocabularyKey()` gar
 * nichts mehr zurückgäbe.
 */
function gleich(a: string, b: string): void {
  const key = vocabularyKey(a);
  assert.notEqual(key, "", `„${a}" hat gar keinen Schlüssel`);
  assert.equal(key, vocabularyKey(b), `„${a}" und „${b}" wurden verschmolzen`);
}

/** Zwei Titel meinen verschiedene Themen und müssen es auch bleiben. */
function verschieden(a: string, b: string): void {
  assert.notEqual(
    vocabularyKey(a),
    vocabularyKey(b),
    `„${a}" und „${b}" fielen zu einem Thema zusammen`,
  );
}

describe("topicKey", () => {
  it("faltet Rand und Groß-/Kleinschreibung", () => {
    assert.equal(topicKey("  Kettenregel "), topicKey("kettenregel"));
  });

  it("hält verschiedene Themen auseinander", () => {
    assert.notEqual(topicKey("Ableitungsregeln"), topicKey("Kettenregel"));
  });

  it("erkennt keine Umformulierung — das ist Absicht", () => {
    assert.notEqual(topicKey("Erste Ableitung"), topicKey("Ableitung"));
  });

  it("bleibt strenger als das Vokabular", () => {
    // Die beiden Schlüssel dürfen nicht zusammengelegt werden: an einem
    // Klausurthema hängen die Lernblöcke, an einem Vokabeleintrag nicht.
    assert.notEqual(topicKey("Kettenregel"), topicKey("Die Kettenregel"));
    gleich("Kettenregel", "Die Kettenregel");
  });
});

describe("normalizeTopics", () => {
  it("behält die Reihenfolge", () => {
    assert.deepEqual(normalizeTopics(["B", "A", "C"]), ["B", "A", "C"]);
  });

  it("wirft Leeres und reinen Leerraum weg", () => {
    assert.deepEqual(normalizeTopics(["", "   ", "Zellatmung"]), ["Zellatmung"]);
  });

  it("trimmt, ohne den Titel sonst anzufassen", () => {
    assert.deepEqual(normalizeTopics(["  Genetik  "]), ["Genetik"]);
  });

  it("behält bei Dubletten den ersten Titel", () => {
    assert.deepEqual(normalizeTopics(["Kettenregel", "kettenregel"]), [
      "Kettenregel",
    ]);
  });

  it("kürzt auf die Höchstlänge", () => {
    const lang = "x".repeat(TOPIC_MAX_LENGTH + 20);
    const [erstes] = normalizeTopics([lang]);
    assert.equal(erstes?.length, TOPIC_MAX_LENGTH);
  });

  it("deckelt die Anzahl", () => {
    const viele = Array.from({ length: TOPIC_LIMIT + 10 }, (_, i) => `T${i}`);
    assert.equal(normalizeTopics(viele).length, TOPIC_LIMIT);
  });

  it("zählt erst nach dem Aussortieren — Leeres verbraucht keinen Platz", () => {
    const mit = ["", ...Array.from({ length: TOPIC_LIMIT }, (_, i) => `T${i}`)];
    assert.equal(normalizeTopics(mit).length, TOPIC_LIMIT);
  });

  it("nimmt eine leere Liste an", () => {
    assert.deepEqual(normalizeTopics([]), []);
  });
});

describe("vocabularyKey — die Form des Schlüssels", () => {
  it("gibt die Inhaltswörter gefaltet und mit Leerzeichen verbunden zurück", () => {
    assert.equal(vocabularyKey("Die Kettenregel"), "kettenregel");
    assert.equal(vocabularyKey("Arbeitsblatt 3: Zellatmung"), "zellatmung");
  });

  it("sortiert die Wörter, damit die Reihenfolge im Titel nichts entscheidet", () => {
    assert.equal(vocabularyKey("Zweite Ableitung"), "ableitung zweit");
    gleich("Zellatmung beim Menschen", "Der Mensch: Zellatmung");
  });

  it("enthält nur Kleinbuchstaben, Ziffern und einfache Leerzeichen", () => {
    const key = vocabularyKey("Säure-Base-Reaktionen (Übung 3) — Teil 2!");
    assert.match(key, /^[a-z0-9]+( [a-z0-9]+)*$/);
  });

  it("nimmt jedes Wort nur einmal auf", () => {
    assert.equal(vocabularyKey("Zellatmung, Zellatmung"), "zellatmung");
    assert.equal(vocabularyKey("Ökosystem Ökosysteme"), "oekosystem");
  });
});

describe("vocabularyKey — was zusammengehört", () => {
  it("übergeht Rand, Schreibweise und Artikel", () => {
    gleich("Kettenregel", "kettenregel ");
    gleich("Kettenregel", "Die Kettenregel");
  });

  it("übergeht die Schulwörter am Titel", () => {
    gleich("Ableitungsregeln (Übung)", "Ableitungsregeln");
    gleich("Integralrechnung", "Integralrechnung Übungen");
    gleich("Übungen zur Kettenregel", "Kettenregel");
    gleich("Wiederholung: Zellatmung", "Zellatmung");
  });

  it("übergeht Blatt- und Aufgabennummern", () => {
    gleich("Arbeitsblatt 3: Zellatmung", "Zellatmung");
    gleich("AB 7 — Alkane", "Alkane");
    gleich("Hausaufgabe Nr. 5: Bruchrechnung", "Bruchrechnung");
  });

  it("schreibt ph wie f — beide Schreibweisen stehen im Heft", () => {
    gleich("Photosynthese", "Fotosynthese");
    gleich("Photosynthese Arbeitsblatt", "Fotosynthese");
    gleich("Geographie Klimazonen", "Geografie Klimazonen");
  });

  it("schreibt Umlaute aus, statt sie abzutragen", () => {
    gleich("Lösungsformel", "Loesungsformel");
    gleich("Ökosystem Wald", "Oekosystem Wald");
    gleich("Größen und Einheiten", "Groessen und Einheiten");
    gleich("Maßstab", "Massstab");
    // Auch wenn das Umlautzeichen zerlegt hereinkommt (o + Trema), wie es
    // Tastaturen und Zwischenablagen gelegentlich liefern.
    gleich("Lo\u0308sungsformel", "Lösungsformel");
  });

  it("übergeht Akzente, statt Wörter an ihnen zu zerschneiden", () => {
    // Französisch, Spanisch und Latein stehen in der Fächer-Schnellauswahl:
    // é und í dürfen ein Wort nicht in zwei Bruchstücke zerlegen.
    gleich("Les verbes réguliers", "Les verbes reguliers");
    gleich("El pretérito indefinido", "El preterito indefinido");
    assert.equal(vocabularyKey("réguliers"), "reguliers");
    verschieden("El pretérito indefinido", "El presente");
  });

  it("lässt die Blattnummer weg, die Jahreszahl aber stehen", () => {
    gleich("Arbeitsblatt 3: Revolution 1848", "Revolution 1848");
    assert.equal(vocabularyKey("Revolution 1848"), "1848 revolution");
  });

  it("legt Singular und Plural zusammen", () => {
    gleich("Vektor", "Vektoren");
    gleich("Lineare Funktion", "Lineare Funktionen");
    gleich("Zelle", "Zellen");
    gleich("Elektron", "Elektronen");
    gleich("Quadratische Gleichung", "Quadratische Gleichungen");
  });

  it("legt gebeugte Formen desselben Titels zusammen", () => {
    gleich("Ohmsches Gesetz", "Ohmsche Gesetze");
    gleich("Der Erste Weltkrieg", "Erster Weltkrieg");
  });
});

describe("vocabularyKey — was getrennt bleiben muss", () => {
  it("trennt Wörter, die sich nur in einem Buchstaben unterscheiden", () => {
    verschieden("Alkane", "Alkene");
    verschieden("Mitose", "Meiose");
  });

  it("trennt, was die Ordnungszahl unterscheidet", () => {
    verschieden("Erste Ableitung", "Zweite Ableitung");
    verschieden("Erster Weltkrieg", "Zweiter Weltkrieg");
  });

  it("trennt die Ordnungszahl auch als Ziffer — so steht sie im Heft", () => {
    // Ausgeschrieben trennten die Titel längst; in der kürzeren Schreibweise
    // fielen sie zusammen, obwohl die Rauschliste ausdrücklich das Gegenteil
    // verspricht.
    verschieden("1. Weltkrieg", "2. Weltkrieg");
    verschieden("1. Ableitung", "2. Ableitung");
    verschieden("1. Newtonsches Gesetz", "2. Newtonsches Gesetz");
    verschieden("Faust 1", "Faust 2");
  });

  it("trennt, was die Jahreszahl unterscheidet — in Geschichte ist sie der Inhalt", () => {
    verschieden("Revolution 1848", "Revolution 1918");
    verschieden("Deutschland nach 1945", "Deutschland vor 1933");
    verschieden("Europa nach 1815", "Europa nach 1945");
    // Auch wenn eine Fundstelle danebensteht, die sonst jede Zahl schluckt.
    verschieden(
      "Arbeitsblatt 3: Revolution 1848",
      "Arbeitsblatt 3: Revolution 1918",
    );
    // Die Grenze ist die Stellenzahl und nicht der Jahresbereich: eine lange
    // Zahl ist keine Blattnummer, auch wenn sie kein Jahr ist.
    verschieden(
      "Arbeitsblatt: Primfaktorzerlegung von 3600",
      "Arbeitsblatt: Primfaktorzerlegung von 4500",
    );
  });

  it("trennt, was nur ein Wort unterscheidet", () => {
    verschieden("Ökosystem See", "Ökosystem Wald");
    verschieden("Weimarer Republik", "Römische Republik");
    verschieden("Bruchrechnung", "Bruchgleichungen");
  });

  it("trennt, was gar nichts miteinander zu tun hat", () => {
    verschieden("Zellatmung", "Photosynthese");
    verschieden("Präsens", "Präteritum");
    verschieden("Säure-Base-Reaktionen", "Redoxreaktionen");
    verschieden("Ableitungsregeln", "Kettenregel");
  });

  it("legt den engeren Titel nicht auf den weiteren", () => {
    // „Erste Ableitung" ist ein Ausschnitt von „Ableitung", kein anderer Name
    // dafür. Zusammengelegt verschwände das eine hinter dem anderen.
    verschieden("Erste Ableitung", "Ableitung");
    verschieden("Lineare Funktionen", "Funktionen");
  });
});

describe("hasVocabularyKey", () => {
  it("verneint Titel, die nur eine Fundstelle nennen", () => {
    for (const titel of [
      "Übungen",
      "Arbeitsblatt 7",
      "Wiederholung",
      "AB 3",
      "   ",
      "2026",
      "Zusammenfassung Kapitel 3",
      "HA Nr. 5",
      "Klausuren",
      "Übungsblatt 2 — Lösungen",
    ]) {
      assert.equal(
        hasVocabularyKey(titel),
        false,
        `„${titel}" wurde für ein Thema gehalten`,
      );
    }
  });

  it("verneint eine Zahl ohne Fachwort — auch die Jahreszahl", () => {
    // Eine Zahl darf einen Schlüssel schärfen, aber nie allein tragen. Der
    // Preis dieser Grenze steht daneben: wer „1848" als ganzen Titel einträgt,
    // bekommt keine Vokabel. „2026" wäre sonst ein Thema, und das ist es nicht.
    for (const titel of ["2026", "1848", "3", "1. 2."]) {
      assert.equal(
        hasVocabularyKey(titel),
        false,
        `„${titel}" wurde für ein Thema gehalten`,
      );
    }
  });

  it("verneint auch die gebeugten Schulwörter", () => {
    // Dafür gab es einmal einen zweiten Rauschtest auf dem Stamm. Er hat
    // Fachwörter mitgenommen; jetzt stehen die Formen selbst auf der Liste.
    for (const titel of [
      "Klausuren",
      "Wiederholungen",
      "Vorbereitungen",
      "Zusammenfassungen",
      "Klassenarbeiten",
      "Einführungen",
    ]) {
      assert.equal(
        hasVocabularyKey(titel),
        false,
        `„${titel}" wurde für ein Thema gehalten`,
      );
    }
    gleich("Wiederholungen zur Bruchrechnung", "Bruchrechnung");
  });

  it("verschluckt kein Fachwort still, dessen Stamm nach Rauschen aussieht", () => {
    // „Teiler" wurde zu „teil", stand damit auf der Rauschliste und ergab
    // einen leeren Schlüssel — ein Thema, das die App lautlos ablehnte.
    for (const titel of [
      "Teiler",
      "Größter gemeinsamer Teiler",
      "Teiler und Vielfache",
      "Training",
      "Lernen am Modell",
    ]) {
      assert.equal(
        hasVocabularyKey(titel),
        true,
        `„${titel}" bekam keinen Schlüssel`,
      );
    }
    verschieden("Teiler", "Vielfache");
    gleich("Teiler und Vielfache", "Vielfache und Teiler");
  });

  it("bejaht jeden Titel mit einem Fachwort", () => {
    for (const titel of [
      "Zellatmung",
      "Arbeitsblatt 3: Zellatmung",
      "AB 3 — Alkene",
      "Übungen zur Kettenregel",
      "Ökosystem See",
    ]) {
      assert.equal(
        hasVocabularyKey(titel),
        true,
        `„${titel}" bekam keinen Schlüssel`,
      );
    }
  });

  it("stimmt mit dem leeren Schlüssel überein", () => {
    assert.equal(vocabularyKey("Arbeitsblatt 7"), "");
    assert.equal(hasVocabularyKey("Arbeitsblatt 7"), false);
  });
});
