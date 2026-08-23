import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formErrors } from "@/lib/form-errors";

/**
 * Die Meldungen sind erfunden, die Pfade nicht: so schreibt zod sie. Ein
 * `.refine()` über dem ganzen Objekt liefert `path: []`, eines an einem Feld
 * `path: ["title"]`, und eines an einem Listeneintrag `path: ["themen", 3]`.
 */
type Issue = { path: PropertyKey[]; message: string };

const issue = (path: PropertyKey[], message: string): Issue => ({
  path,
  message,
});

describe("formErrors", () => {
  it("gibt bei nichts zu meckern nichts zurück", () => {
    const { message, errors } = formErrors([]);

    assert.equal(message, undefined);
    assert.deepEqual(errors, {});
  });

  it("hängt einen Fehler mit Pfad unter sein Feld", () => {
    const { message, errors } = formErrors<"title">([
      issue(["title"], "Der Titel ist zu lang."),
    ]);

    assert.equal(message, undefined);
    assert.deepEqual(errors, { title: "Der Titel ist zu lang." });
  });

  it("stellt einen Fehler ohne Pfad über das Formular", () => {
    const { message, errors } = formErrors([
      issue([], "Ein Vorschlag, der nichts vorschlägt, ist keiner."),
    ]);

    assert.equal(message, "Ein Vorschlag, der nichts vorschlägt, ist keiner.");
    assert.deepEqual(errors, {});
  });

  it("trennt beide Sorten voneinander", () => {
    const { message, errors } = formErrors<"title" | "note">([
      issue([], "So geht das gar nicht."),
      issue(["title"], "Der Titel ist zu lang."),
      issue(["note"], "Die Notiz ist zu lang."),
    ]);

    assert.equal(message, "So geht das gar nicht.");
    assert.deepEqual(errors, {
      title: "Der Titel ist zu lang.",
      note: "Die Notiz ist zu lang.",
    });
  });

  it("behält je Feld die erste Meldung", () => {
    // Genau der Fall aus dem Prüfschema: erst „dieses Datum gibt es nicht",
    // dann „dieser Tag ist noch nicht gewesen". Unter das Feld passt eine.
    const { errors } = formErrors<"capturedOn">([
      issue(["capturedOn"], "Dieses Datum gibt es nicht."),
      issue(["capturedOn"], "Dieser Tag ist noch nicht gewesen."),
    ]);

    assert.deepEqual(errors, { capturedOn: "Dieses Datum gibt es nicht." });
  });

  it("behält über dem Formular die erste Meldung ohne Pfad", () => {
    const { message } = formErrors([
      issue([], "Der erste Satz."),
      issue([], "Der zweite Satz."),
    ]);

    assert.equal(message, "Der erste Satz.");
  });

  /**
   * Ein Fehler an einem einzelnen Listeneintrag gehört unter das Feld der
   * ganzen Liste: `path[0]` ist bei zod der Feldname, die Nummer des Eintrags
   * steht erst dahinter. Ein eigenes Feld für den vierten Eintrag gibt es auf
   * keinem Bildschirm — unter „Themen" steht das Eingabefeld, in dem alle
   * zusammen stehen, und dort gehört die Meldung hin.
   */
  it("hängt einen Fehler an einem Listeneintrag unter das Feld der Liste", () => {
    const { message, errors } = formErrors<"themen">([
      issue(["themen", 3], "Dieses Thema ist zu lang."),
    ]);

    assert.equal(message, undefined);
    assert.deepEqual(errors, { themen: "Dieses Thema ist zu lang." });
  });

  it("hängt einen Fehler an der ganzen Liste unter dasselbe Feld", () => {
    const { errors } = formErrors<"themen">([
      issue(["themen"], "Zu viele Themen."),
    ]);

    assert.deepEqual(errors, { themen: "Zu viele Themen." });
  });

  /**
   * Der eine Fall, in dem `path[0]` keine Zeichenkette ist: ein Prüfschema,
   * das an seiner Wurzel eine Liste ist. Ein Feld gibt es dafür nicht — die
   * Meldung steht dann über dem Formular statt verschluckt zu werden.
   */
  it("stellt eine Meldung ohne Feldnamen über das Formular", () => {
    const { message, errors } = formErrors([
      issue([0, "title"], "Der erste Eintrag stimmt nicht."),
    ]);

    assert.equal(message, "Der erste Eintrag stimmt nicht.");
    assert.deepEqual(errors, {});
  });
});
