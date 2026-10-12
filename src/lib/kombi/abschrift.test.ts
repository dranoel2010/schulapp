import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { abschriftTeile, istFormelzeile } from "./abschrift";

describe("abschriftTeile", () => {
  it("erkennt Überschrift, Formelzeile und Absatz", () => {
    assert.deepEqual(
      abschriftTeile([
        "# Die Scheitelpunktform",
        "f(x) = a(x − d)² + e",
        "Der Scheitelpunkt ist S(d | e). Ist a negativ, ist die Parabel nach unten geöffnet.",
      ]),
      [
        { art: "h", text: "Die Scheitelpunktform" },
        { art: "f", text: "f(x) = a(x − d)² + e" },
        { art: "p", text: "Der Scheitelpunkt ist S(d | e). Ist a negativ, ist die Parabel nach unten geöffnet." },
      ],
    );
  });

  it("Formeln in geschweiften Klammern", () => {
    assert.deepEqual(abschriftTeile(["{x = −p/2 ± √((p/2)² − q)}"]), [
      { art: "f", text: "x = −p/2 ± √((p/2)² − q)" },
    ]);
  });

  it("ein Satz mit Gleichheitszeichen bleibt ein Absatz", () => {
    assert.equal(istFormelzeile("x = −p/2 ± √((p/2)² − q)"), true);
    assert.equal(istFormelzeile("Die Lösung ist x = 3"), false);
    assert.equal(istFormelzeile("a = 2\nb = 3"), false);
    assert.equal(istFormelzeile("Seite 3"), false);
  });

  it("leere Absätze fallen weg", () => {
    assert.deepEqual(abschriftTeile(["", "  "]), []);
  });
});
