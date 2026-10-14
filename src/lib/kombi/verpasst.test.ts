import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { klausurNamen, verpasstSatz, type VerpasstEintrag } from "@/lib/kombi/verpasst";

const verpasstNamen = (
  v: Omit<VerpasstEintrag, "name">[],
  gezeigt: { id: string; kurz: string } | null,
  weitere: { examId: string; kurz: string; datum: string }[],
) => klausurNamen(v, gezeigt, weitere).verpasst;

/**
 * Abnahmerunde 18: Unter der Zeile der nächsten Klausur nennt ein Hinweis auf
 * verpasste Blöcke einer anderen Klausur deren Fach, bei zwei Klausuren im
 * selben Fach auch den Tag der Klausur. Nur der Hinweis zur gezeigten
 * Klausur bleibt ohne Fach.
 */

const HEUTE = "2026-10-16"; // Freitag

describe("verpasste Lernblöcke im Block „Klausur“", () => {
  it("gezeigte Klausur ohne Fach, eine andere mit Fach", () => {
    const v = verpasstNamen(
      [
        { examId: "ma", anzahl: 1, tag: "2026-10-13", kurz: "Mathe", datum: "2026-10-17" },
        { examId: "en", anzahl: 1, tag: "2026-10-15", kurz: "Englisch", datum: "2026-10-22" },
      ],
      { id: "ma", kurz: "Mathe" },
      [],
    );
    assert.deepEqual(
      v.map((x) => verpasstSatz(x, HEUTE)),
      ["Ein Lernblock von Dienstag ist offen", "Englisch: ein Lernblock von Donnerstag ist offen"],
    );
  });

  it("zwei Klausuren im selben Fach: die andere mit dem Tag der Klausur", () => {
    const v = verpasstNamen(
      [
        { examId: "ma1", anzahl: 3, tag: "2026-10-13", kurz: "Mathe", datum: "2026-10-16" },
        { examId: "ma2", anzahl: 1, tag: "2026-10-13", kurz: "Mathe", datum: "2026-10-17" },
      ],
      { id: "ma1", kurz: "Mathe" },
      [],
    );
    assert.deepEqual(
      v.map((x) => verpasstSatz(x, "2026-10-14")),
      ["Drei Lernblöcke sind offen", "Mathe Sa 17.10.: ein Lernblock von Dienstag ist offen"],
    );
  });

  it("nach dem Nachholen der gezeigten Klausur bleibt die zweite Mathe-Klausur erkennbar", () => {
    const v = verpasstNamen(
      [{ examId: "ma2", anzahl: 1, tag: "2026-10-13", kurz: "Mathe", datum: "2026-10-17" }],
      { id: "ma1", kurz: "Mathe" },
      [],
    );
    assert.equal(verpasstSatz(v[0], "2026-10-14"), "Mathe Sa 17.10.: ein Lernblock von Dienstag ist offen");
  });

  it("ohne gezeigte Klausur, ein Fach allein: nur das Fach", () => {
    const v = verpasstNamen([{ examId: "bi", anzahl: 2, tag: "2026-10-14", kurz: "Bio", datum: "2026-10-27" }], null, []);
    assert.equal(verpasstSatz(v[0], HEUTE), "Bio: zwei Lernblöcke sind offen");
  });

  it("ein Fach, das schon unter „Noch ein Lernblock heute“ mit einer anderen Klausur steht, bekommt den Tag", () => {
    const v = verpasstNamen(
      [{ examId: "en2", anzahl: 1, tag: "2026-10-15", kurz: "Englisch", datum: "2026-10-29" }],
      { id: "ma", kurz: "Mathe" },
      [{ examId: "en1", kurz: "Englisch", datum: "2026-10-20" }],
    );
    assert.equal(v[0].name, "Englisch Do 29.10.");
  });

  it("„Noch ein Lernblock heute“ zu einer zweiten Klausur im Fach der gezeigten nennt den Tag", () => {
    const { heuteWeitere } = klausurNamen([], { id: "ma1", kurz: "Mathe" }, [
      { examId: "ma2", kurz: "Mathe", datum: "2026-10-18" },
      { examId: "bi", kurz: "Bio", datum: "2026-10-20" },
    ]);
    assert.deepEqual(heuteWeitere, [
      { examId: "ma2", kurz: "Mathe So 18.10." },
      { examId: "bi", kurz: "Bio" },
    ]);
  });
});
