import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { examInputSchemaAb } from "@/lib/exams";
import { formErrors } from "@/lib/form-errors";

/** „Klausur eintragen“ ohne Datum: die Meldung sagt, dass es fehlt, nicht, dass es das Datum nicht gibt. */
describe("Klausur: Datum", () => {
  const eingabe = (date: string) => ({ subjectId: "7ab70ea2-7285-461e-8ff2-0d009291c113", kind: "klausur", date, leadDays: "5", minutesPerDay: "25", title: "" });
  const fehler = (date: string) => {
    const r = examInputSchemaAb("2026-10-15").safeParse(eingabe(date));
    assert.equal(r.success, false);
    return formErrors<"date">(r.error!.issues).errors.date;
  };
  it("leer heißt „Datum fehlt.“", () => assert.equal(fehler(""), "Datum fehlt."));
  it("ein unmögliches Datum bleibt „Dieses Datum gibt es nicht.“", () => assert.equal(fehler("2026-02-30"), "Dieses Datum gibt es nicht."));
  it("ein vergangener Tag bleibt „Dieser Tag ist schon vorbei.“", () => assert.equal(fehler("2026-10-01"), "Dieser Tag ist schon vorbei."));
});
