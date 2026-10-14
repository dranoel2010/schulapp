import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { appTag } from "@/lib/tag";
import { nextLessonDate } from "@/lib/timetable";

/**
 * Abnahmerunde 18: „Stoff der Klausur“ und „Stundenplan bearbeiten“ rechnen
 * wie die übrigen Seiten mit dem App-Tag (bis 4 Uhr gilt der Vortag) und der
 * App-Uhr (`jetzt()`, mit Testuhr die Testuhr), nicht mit dem Kalendertag.
 * Abnahmerunde 19: dasselbe für „Neue Aufgabe“, eine Aufgabe bearbeiten,
 * „Neue Note“ und eine Note bearbeiten.
 * Abnahmerunde 20: „Neue Klausur“, eine Klausur bearbeiten und ihr Speichern
 * (Lernplan, Prüfung des Datums) wie „Lernplan neu erstellen“.
 */

const SEITEN = [
  "src/app/(app)/abruf/klausur/page.tsx",
  "src/app/(app)/stundenplan/bearbeiten/page.tsx",
  "src/app/(app)/hausaufgaben/neu/page.tsx",
  "src/app/(app)/hausaufgaben/[id]/page.tsx",
  "src/app/(app)/noten/neu/page.tsx",
  "src/app/(app)/noten/[id]/page.tsx",
  "src/app/(app)/klausuren/neu/page.tsx",
  "src/app/(app)/klausuren/[id]/bearbeiten/page.tsx",
  "src/app/(app)/klausuren/actions.ts",
];

describe("Seiten mit dem App-Tag", () => {
  for (const seite of SEITEN) {
    it(seite, () => {
      const text = readFileSync(join(process.cwd(), seite), "utf8");
      assert.match(text, /appTag\(await jetzt\(\)\)/);
      assert.doesNotMatch(text, /todayInBerlin\(/);
    });
  }

  it("Do 15.10. 01:30 und 00:30: heute ist Mi 14.10., die nächste tägliche Stunde Do 15.10.", () => {
    const taeglich = [1, 2, 3, 4, 5];
    for (const uhr of ["2026-10-14T23:30:00Z", "2026-10-14T22:30:00Z"]) {
      const heute = appTag(new Date(uhr));
      assert.equal(heute, "2026-10-14");
      assert.equal(nextLessonDate(heute, taeglich), "2026-10-15");
    }
    // Um 04:30 gilt der neue Tag.
    assert.equal(appTag(new Date("2026-10-15T02:30:00Z")), "2026-10-15");
  });

  it("„Lernplan neu erstellen“ und das Speichern einer Klausur rechnen den Plan mit demselben Tag", () => {
    const lesen = (datei: string) => readFileSync(join(process.cwd(), datei), "utf8");
    assert.match(lesen("src/app/(app)/lernblock-actions.ts"), /generatePlan\(user\.id, examId, appTag\(await jetzt\(\)\)\)/);
    const klausur = lesen("src/app/(app)/klausuren/actions.ts");
    assert.match(klausur, /const heute = appTag\(await jetzt\(\)\);[\s\S]*generatePlan\(user\.id, exam\.id, heute\)/);
    assert.match(klausur, /const today = appTag\(await jetzt\(\)\);[\s\S]*generatePlan\(user\.id, examId, today\)/);
  });
});
