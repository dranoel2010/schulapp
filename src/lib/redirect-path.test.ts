import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeNextPath } from "@/lib/redirect-path";

/**
 * Die eine Regel, mit der ein Parameter aus der Adresse zu einer Umleitung
 * werden darf.
 *
 * Sie steht hier so ausführlich unter Beobachtung, weil ein Fehler darin
 * genau die Falle baut, gegen die eine Anmeldeseite schützen soll: eine echte
 * Anmeldeseite dieser App, die am Ende auf eine nachgebaute führt. Die Fälle
 * unten sind keine Fantasie — `/\host` ist der bekannte Nachbar von `//host`,
 * und ein Filter, der nur den zweiten kennt, lässt den ersten durch.
 */

describe("safeNextPath", () => {
  it("lässt einen gewöhnlichen Pfad durch", () => {
    assert.equal(safeNextPath("/eingang"), "/eingang");
    assert.equal(
      safeNextPath("/oauth/authorize?response_type=code&state=x"),
      "/oauth/authorize?response_type=code&state=x",
    );
  });

  it("fällt ohne Angabe auf die Startseite zurück", () => {
    for (const value of [undefined, null, "", "   "]) {
      assert.equal(safeNextPath(value), "/", String(value));
    }
  });

  it("weist alles ab, was auf einen fremden Ursprung zeigt", () => {
    const angriffe = [
      "//evil.example",
      "//evil.example/login",
      "/\\evil.example",
      "/\\\\evil.example",
      "/\\/evil.example",
      "//\\evil.example",
      "https://evil.example",
      "http://evil.example",
      "//evil.example\\@schulapp.example",
      "/\n//evil.example",
    ];

    for (const value of angriffe) {
      assert.equal(safeNextPath(value), "/", JSON.stringify(value));
    }
  });

  it("weist ab, was gar kein Pfad ist", () => {
    for (const value of [
      "eingang",
      "mailto:du@example.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "?a=b",
      "#oben",
    ]) {
      assert.equal(safeNextPath(value), "/", value);
    }
  });

  it("gibt zurück, was der Parser daraus gemacht hat", () => {
    // Geprüft und umgeleitet wird derselbe Text — sonst ließe sich zwischen
    // beiden ein Unterschied hineinschreiben.
    assert.equal(safeNextPath("/a/../b"), "/b");
    assert.equal(safeNextPath("  /eingang  "), "/eingang");
    // Ein Steuerzeichen wirft der Parser weg. Übrig bleibt ein Pfad auf
    // diesem Server, und der ist erlaubt — er zeigt nirgendwohin sonst.
    assert.equal(safeNextPath("/\tevil"), "/evil");
  });

  it("lässt einen Rückwärts-Schrägstrich im Pfad stehen, wenn er kodiert ist", () => {
    // %5C ist ein Zeichen im Pfad und keine Ursprungsgrenze — der Parser macht
    // daraus keine fremde Adresse, also ist es keine.
    assert.equal(safeNextPath("/%5Cevil.example"), "/%5Cevil.example");
  });
});
