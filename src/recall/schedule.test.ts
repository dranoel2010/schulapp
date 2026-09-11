import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, daysBetween } from "@/lib/dates";
import {
  istFaellig,
  planeFaelligkeiten,
  type Faelligkeitsplan,
  type GeplanteFaelligkeit,
  type PlanEingabe,
} from "@/recall/schedule";

/**
 * Die Prüfung der Verteilrechnung.
 *
 * Geprüft werden Invarianten und keine Einzelwerte: „kein Termin hinter der
 * Klausur" gilt für jede Eingabe, „der siebte Termin ist der 14.5." gilt für
 * eine. Die Vorgabewerte dieser Rechnung sind ausdrücklich Setzungen (P1–P9 des
 * Architektenberichts), und ein Test, der Setzungen festschreibt, macht aus
 * einer offenen Zahl eine geschlossene.
 *
 * ── Was hier NICHT geprüft werden kann ───────────────────────────────────────
 *
 * Ob der Takt der richtige ist. Die Forschung legt ihn nicht fest — bei zehn
 * Tagen Prüfabstand waren 1, 2, 4 und 7 Tage gleichwertig. Diese Datei prüft,
 * dass die Rechnung tut, was sie verspricht, nicht dass das Versprechen stimmt.
 */

function eingabe(
  overrides: Partial<PlanEingabe> & { klausurtag: string | null },
): PlanEingabe {
  return {
    heute: "2026-05-01",
    aufgenommenAm: "2026-05-01",
    ...overrides,
  };
}

const vorKlausur = (plan: Faelligkeitsplan): GeplanteFaelligkeit[] =>
  plan.faelligkeiten.filter((f) => f.mode === "klausur");

const nachKlausur = (plan: Faelligkeitsplan): GeplanteFaelligkeit[] =>
  plan.faelligkeiten.filter((f) => f.mode === "erhaltung");

/**
 * A7: Kein Fälligkeitsdatum der Betriebsart `klausur` liegt hinter dem Termin,
 * und am Klausurtag selbst wird nicht mehr geübt — da wird geschrieben.
 */
function assertNichtsHinterDerKlausur(
  plan: Faelligkeitsplan,
  klausurtag: string,
): void {
  for (const f of vorKlausur(plan)) {
    assert.ok(
      daysBetween(f.dueOn, klausurtag) > 0,
      `${f.dueOn} liegt nicht vor der Klausur am ${klausurtag}`,
    );
  }
  for (const f of nachKlausur(plan)) {
    assert.ok(
      daysBetween(klausurtag, f.dueOn) > 0,
      `Erhaltungstermin ${f.dueOn} liegt nicht nach der Klausur`,
    );
  }
}

/** Die Runden zählen lückenlos von 1 hoch, über beide Betriebsarten hinweg. */
function assertRundenLueckenlos(plan: Faelligkeitsplan): void {
  plan.faelligkeiten.forEach((f, index) => {
    assert.equal(f.round, index + 1, `Lücke in der Rundenzählung bei ${f.dueOn}`);
    assert.equal(f.sortOrder, index, `Lücke in der Reihenfolge bei ${f.dueOn}`);
  });
}

/** Die Termine stehen aufsteigend und kein Tag doppelt. */
function assertAufsteigendUndEinmalig(plan: Faelligkeitsplan): void {
  const tage = plan.faelligkeiten.map((f) => f.dueOn);
  for (let i = 1; i < tage.length; i += 1) {
    assert.ok(
      daysBetween(tage[i - 1], tage[i]) > 0,
      `${tage[i]} steht nicht nach ${tage[i - 1]}`,
    );
  }
}

/** Kein Termin fällt auf einen gesperrten Tag. */
function assertKeineSperrtage(
  plan: Faelligkeitsplan,
  sperrtage: string[],
): void {
  const gesperrt = new Set(sperrtage);
  for (const f of plan.faelligkeiten) {
    assert.ok(!gesperrt.has(f.dueOn), `${f.dueOn} ist gesperrt`);
  }
}

/** Alle Zusagen auf einmal — jeder Test ruft das am Ende. */
function assertAlleZusagen(
  plan: Faelligkeitsplan,
  klausurtag: string | null,
  sperrtage: string[] = [],
): void {
  assertRundenLueckenlos(plan);
  assertAufsteigendUndEinmalig(plan);
  assertKeineSperrtage(plan, sperrtage);
  if (klausurtag !== null) assertNichtsHinterDerKlausur(plan, klausurtag);
}

describe("planeFaelligkeiten — A6: mindestens vier Begegnungen", () => {
  it("legt bei reichlich Zeit mindestens vier Termine vor die Klausur", () => {
    const plan = planeFaelligkeiten(eingabe({ klausurtag: "2026-05-29" }));

    assert.ok(
      vorKlausur(plan).length >= 4,
      `nur ${vorKlausur(plan).length} Termine vor der Klausur`,
    );
    assert.deepEqual(plan.warnungen, []);
    assertAlleZusagen(plan, "2026-05-29");
  });

  it("verdichtet den Takt, statt Begegnungen aufzugeben", () => {
    // Sechs Tage bis zur Klausur: im Grundtakt von drei Tagen reichte das für
    // zwei Termine. A6 verlangt vier, also muss die Rechnung enger takten.
    const klausurtag = "2026-05-07";
    const plan = planeFaelligkeiten(
      eingabe({ klausurtag, letzteWocheTaeglich: false }),
    );

    assert.ok(
      vorKlausur(plan).length >= 4,
      `nur ${vorKlausur(plan).length} Termine — der Takt wurde nicht verdichtet`,
    );
    assertAlleZusagen(plan, klausurtag);
  });

  it("meldet `zu-knapp`, wenn selbst täglich nicht für vier reicht", () => {
    // Aufgenommen am Vortag der Klausur: da ist nichts mehr zu verdichten.
    const plan = planeFaelligkeiten(
      eingabe({
        heute: "2026-05-05",
        aufgenommenAm: "2026-05-05",
        klausurtag: "2026-05-07",
      }),
    );

    assert.ok(plan.warnungen.includes("zu-knapp"));
    assert.ok(vorKlausur(plan).length < 4);
    assertAlleZusagen(plan, "2026-05-07");
  });

  it("meldet `keine-tage`, wenn die Klausur schon morgen ist", () => {
    const plan = planeFaelligkeiten(
      eingabe({
        heute: "2026-05-06",
        aufgenommenAm: "2026-05-06",
        klausurtag: "2026-05-07",
      }),
    );

    assert.ok(plan.warnungen.includes("keine-tage"));
    assert.equal(vorKlausur(plan).length, 0);
  });

  it("hält die Zusagen über Monats-, Jahres- und Schaltjahresgrenzen", () => {
    const faelle: Array<[string, string]> = [
      ["2026-01-28", "2026-02-20"],
      ["2026-12-20", "2027-01-15"],
      ["2028-02-20", "2028-03-10"], // 2028 ist ein Schaltjahr
      ["2026-10-20", "2026-11-05"], // Zeitumstellung liegt darin
    ];

    for (const [heute, klausurtag] of faelle) {
      const plan = planeFaelligkeiten(
        eingabe({ heute, aufgenommenAm: heute, klausurtag }),
      );
      assert.ok(
        vorKlausur(plan).length >= 4,
        `${heute} → ${klausurtag}: nur ${vorKlausur(plan).length} Termine`,
      );
      assertAlleZusagen(plan, klausurtag);
    }
  });
});

describe("planeFaelligkeiten — A7: nichts hinter dem Termin", () => {
  it("hält die Zusage für jeden Abstand von 1 bis 60 Tagen", () => {
    const heute = "2026-05-01";

    for (let abstand = 1; abstand <= 60; abstand += 1) {
      const klausurtag = addDays(heute, abstand);
      const plan = planeFaelligkeiten(
        eingabe({ heute, aufgenommenAm: heute, klausurtag }),
      );
      assertAlleZusagen(plan, klausurtag);
    }
  });

  it("plant kein Intervall, das länger ist als die Restzeit", () => {
    const heute = "2026-05-01";
    const klausurtag = "2026-05-10";
    const plan = planeFaelligkeiten(
      eingabe({ heute, aufgenommenAm: heute, klausurtag }),
    );

    const tage = vorKlausur(plan).map((f) => f.dueOn);
    for (let i = 1; i < tage.length; i += 1) {
      const abstand = daysBetween(tage[i - 1], tage[i]);
      const restzeit = daysBetween(tage[i - 1], klausurtag);
      assert.ok(
        abstand <= restzeit,
        `Abstand ${abstand} ist länger als die Restzeit ${restzeit}`,
      );
    }
  });
});

describe("planeFaelligkeiten — A8: die zweite Betriebsart", () => {
  it("hängt Erhaltungstermine hinter die Klausur", () => {
    const klausurtag = "2026-05-29";
    const plan = planeFaelligkeiten(eingabe({ klausurtag }));

    assert.equal(nachKlausur(plan).length, 3);
    assertAlleZusagen(plan, klausurtag);
  });

  it("rechnet die Erhaltung vom Klausurtag und nicht vom letzten Übungstag", () => {
    // Sonst verschöbe ein knapper Endspurt die ganze Erhaltung mit nach vorn.
    const klausurtag = "2026-05-29";
    const weit = planeFaelligkeiten(eingabe({ klausurtag }));
    const knapp = planeFaelligkeiten(
      eingabe({
        heute: "2026-05-27",
        aufgenommenAm: "2026-05-27",
        klausurtag,
      }),
    );

    assert.deepEqual(
      nachKlausur(knapp).map((f) => f.dueOn),
      nachKlausur(weit).map((f) => f.dueOn),
    );
  });

  it("lässt sich in Takt und Anzahl einstellen — P6 und P7 sind offen", () => {
    const plan = planeFaelligkeiten(
      eingabe({
        klausurtag: "2026-05-29",
        erhaltungstakt: 7,
        erhaltungstermine: 5,
      }),
    );

    const tage = nachKlausur(plan).map((f) => f.dueOn);
    assert.equal(tage.length, 5);
    assert.equal(daysBetween("2026-05-29", tage[0]), 7);
    assert.equal(daysBetween(tage[0], tage[1]), 7);
  });
});

describe("planeFaelligkeiten — Sperrtage", () => {
  it("verschiebt nach hinten und hält dabei A6", () => {
    // A16: gedeckelt werden Zeit und neue Bausteine, nie fällige
    // Wiederholungen. Ein gesperrter Tag verschiebt deshalb nach hinten,
    // statt den Termin fallen zu lassen.
    //
    // Was er NICHT kann: die Zahl der Termine unverändert lassen. Das Fenster
    // bis zur Klausur ist endlich — wer vier Tage daraus sperrt, hat vier Tage
    // weniger, und zwei Termine, die auf denselben freien Tag geschoben
    // werden, sind danach einer. Die Zusage lautet deshalb: mindestens die
    // vier Begegnungen aus A6, und keiner davon auf einem gesperrten Tag.
    const klausurtag = "2026-05-29";
    const sperrtage = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07"];

    const mit = planeFaelligkeiten(eingabe({ klausurtag, sperrtage }));

    assert.ok(
      vorKlausur(mit).length >= 4,
      `nur ${vorKlausur(mit).length} Termine trotz vierwöchigem Fenster`,
    );
    assert.deepEqual(mit.warnungen, []);
    assertAlleZusagen(mit, klausurtag, sperrtage);
  });

  it("lässt einen Termin entfallen, wenn die Sperre länger ist als die Restzeit", () => {
    const klausurtag = "2026-05-10";
    const sperrtage = Array.from({ length: 14 }, (_, i) =>
      addDays("2026-05-02", i),
    );
    const plan = planeFaelligkeiten(eingabe({ klausurtag, sperrtage }));

    assert.equal(vorKlausur(plan).length, 0);
    assertAlleZusagen(plan, klausurtag, sperrtage);
  });
});

describe("planeFaelligkeiten — ohne Klausurtermin", () => {
  it("plant im Grundtakt weiter und sagt, dass das Ziel fehlt", () => {
    const plan = planeFaelligkeiten(eingabe({ klausurtag: null }));

    assert.ok(plan.warnungen.includes("kein-termin"));
    assert.equal(plan.faelligkeiten.length, 4);
    assert.ok(plan.faelligkeiten.every((f) => f.mode === "klausur"));
    assertAlleZusagen(plan, null);
  });
});

describe("planeFaelligkeiten — dieselbe Eingabe, dieselbe Ausgabe", () => {
  it("rechnet ohne Systemuhr und ohne Zufall", () => {
    const zwei = [1, 2].map(() =>
      planeFaelligkeiten(eingabe({ klausurtag: "2026-05-29" })),
    );
    assert.deepEqual(zwei[0], zwei[1]);
  });

  it("plant nichts in die Vergangenheit, wenn der Baustein älter ist", () => {
    const plan = planeFaelligkeiten(
      eingabe({
        aufgenommenAm: "2026-04-01",
        heute: "2026-05-01",
        klausurtag: "2026-05-29",
      }),
    );

    for (const f of plan.faelligkeiten) {
      assert.ok(
        daysBetween("2026-05-01", f.dueOn) >= 0,
        `${f.dueOn} liegt in der Vergangenheit`,
      );
    }
  });
});

describe("istFaellig", () => {
  it("nimmt Überfälliges mit — ein Termin von gestern wartet, er verfällt nicht", () => {
    assert.equal(
      istFaellig({ dueOn: "2026-05-01", doneAt: null }, "2026-05-03"),
      true,
    );
  });

  it("nimmt heute mit und morgen nicht", () => {
    assert.equal(
      istFaellig({ dueOn: "2026-05-03", doneAt: null }, "2026-05-03"),
      true,
    );
    assert.equal(
      istFaellig({ dueOn: "2026-05-04", doneAt: null }, "2026-05-03"),
      false,
    );
  });

  it("lässt Erledigtes liegen", () => {
    assert.equal(
      istFaellig(
        { dueOn: "2026-05-01", doneAt: new Date("2026-05-01T18:00:00Z") },
        "2026-05-03",
      ),
      false,
    );
  });
});
