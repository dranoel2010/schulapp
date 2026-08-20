import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BEST_GRADE,
  GRADE_STEPS,
  WORST_GRADE,
  formatAverage,
  gradeLabel,
  isGradeValue,
  neededForTarget,
  overallAverage,
  subjectAverage,
  weightedAverage,
  type GradeEntry,
  type TargetOutcome,
} from "@/lib/grade-scale";

/** Liest sich unten wie im Notenheft: „eine 2 schriftlich, doppelt gewichtet“. */
function written(value: number, weight = 1): GradeEntry {
  return { value, weight, kind: "schriftlich" };
}

function oral(value: number, weight = 1): GradeEntry {
  return { value, weight, kind: "muendlich" };
}

type TargetInput = Parameters<typeof neededForTarget>[0];

/**
 * Vorgabe für die Zielfrage: keine Noten, nur schriftlich, nächste Note
 * einfach. Jeder Test nennt genau das, worauf es ihm ankommt.
 */
function need(input: Partial<TargetInput> & { target: number }): TargetOutcome {
  return neededForTarget({
    entries: [],
    weightWritten: 100,
    next: { kind: "schriftlich", weight: 1 },
    ...input,
  });
}

describe("GRADE_STEPS", () => {
  it("hat sechzehn Stufen mit den Werten der Notentabelle", () => {
    assert.equal(GRADE_STEPS.length, 16);
    assert.deepEqual(
      GRADE_STEPS.map((step) => step.value),
      [7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40, 43, 47, 50, 53, 60],
    );
  });

  it("beschriftet jede Stufe so, wie sie im Heft steht", () => {
    assert.deepEqual(
      GRADE_STEPS.map((step) => step.label),
      [
        "1+",
        "1",
        "1−",
        "2+",
        "2",
        "2−",
        "3+",
        "3",
        "3−",
        "4+",
        "4",
        "4−",
        "5+",
        "5",
        "5−",
        "6",
      ],
    );
  });

  it("beginnt bei der besten und endet bei der schlechtesten Note (R6)", () => {
    assert.equal(BEST_GRADE, 7);
    assert.equal(WORST_GRADE, 60);
    assert.equal(GRADE_STEPS[0].value, BEST_GRADE);
    assert.equal(GRADE_STEPS[GRADE_STEPS.length - 1].value, WORST_GRADE);
  });

  it("zählt aufwärts, weil kleiner besser ist (R6)", () => {
    GRADE_STEPS.forEach((step, index) => {
      if (index === 0) return;
      assert.ok(
        step.value > GRADE_STEPS[index - 1].value,
        `${step.label} steht nicht hinter ${GRADE_STEPS[index - 1].label}`,
      );
    });
  });

  it("lässt zwischen 5− und 6 absichtlich Platz", () => {
    // Eine Sechs trägt keine Tendenz: kein 6+, kein 6−, also auch kein 57.
    assert.equal(gradeLabel(53), "5−");
    assert.equal(gradeLabel(60), "6");
    assert.ok(!isGradeValue(57));
    assert.ok(!isGradeValue(63));
    assert.equal(WORST_GRADE - 53, 7, "die Lücke ist gewollt");
  });

  it("schreibt das Minus typografisch, nicht als Bindestrich", () => {
    assert.equal(gradeLabel(13), "1−");
    assert.ok(!GRADE_STEPS.some((step) => step.label.includes("-")));
  });
});

describe("isGradeValue und gradeLabel", () => {
  it("kennt jede Stufe der Skala", () => {
    for (const step of GRADE_STEPS) {
      assert.ok(isGradeValue(step.value), `${step.label} fehlt`);
      assert.equal(gradeLabel(step.value), step.label);
    }
  });

  it("weist zurück, was zwischen den Stufen liegt", () => {
    for (const value of [0, 6, 8, 9, 11, 19, 55, 61, 100, -7, 1.5]) {
      assert.ok(!isGradeValue(value), `${value} ist keine Note`);
    }
  });

  it("zeigt einen unbekannten Wert als Zahl statt gar nicht", () => {
    assert.equal(gradeLabel(19), "1,9");
    assert.equal(gradeLabel(25), "2,5");
  });
});

describe("weightedAverage (R1)", () => {
  it("mittelt gleich gewichtete Noten", () => {
    assert.equal(weightedAverage([written(20), written(40)]), 3);
  });

  it("lässt das Gewicht durchschlagen", () => {
    // Eine 2 dreifach und eine 4 einfach: (60 + 40) / 4 Gewichte.
    assert.equal(weightedAverage([written(20, 3), written(40, 1)]), 2.5);
    assert.equal(weightedAverage([written(20, 1), written(40, 3)]), 3.5);
  });

  it("rechnet in Zehnteln und trifft damit die glatte Zahl", () => {
    // In Gleitkomma ergäben 1,3 und 2,3 zusammen 3.5999999999999996 und der
    // Schnitt daraus 1.7999999999999998 — in Zehnteln sind es genau 36 und 1,8.
    assert.equal(weightedAverage([written(13), written(23)]), 1.8);
  });

  it("gibt ohne Noten nichts zurück", () => {
    assert.equal(weightedAverage([]), null);
  });

  it("übergeht Noten ohne Gewicht", () => {
    assert.equal(weightedAverage([written(20, 0), written(40, 1)]), 4);
    assert.equal(weightedAverage([written(20, -3), written(40, 1)]), 4);
  });

  it("gibt nichts zurück, wenn kein einziges Gewicht übrig bleibt", () => {
    assert.equal(weightedAverage([written(20, 0)]), null);
    assert.equal(weightedAverage([written(20, -1), written(40, 0)]), null);
  });
});

describe("subjectAverage (R2)", () => {
  /** Eine 2 schriftlich, eine 4 mündlich — daran lässt sich jedes Gewicht ablesen. */
  const beideToepfe = [written(20), oral(40)];

  it("nimmt bei nur schriftlichen Noten den schriftlichen Schnitt", () => {
    // Der leere mündliche Topf zählt nicht als 0 und nicht als 4, sondern
    // gar nicht — sonst stünde nach der ersten Klausur eine erfundene Zahl da.
    assert.equal(subjectAverage([written(20), written(30)], 50), 2.5);
    assert.equal(subjectAverage([written(20), written(30)], 0), 2.5);
  });

  it("nimmt bei nur mündlichen Noten den mündlichen Schnitt", () => {
    assert.equal(subjectAverage([oral(10), oral(30)], 50), 2);
    assert.equal(subjectAverage([oral(10), oral(30)], 100), 2);
  });

  it("mischt beide Töpfe nach dem Gewicht des Fachs", () => {
    assert.equal(subjectAverage(beideToepfe, 50), 3);
    assert.equal(subjectAverage(beideToepfe, 25), 3.5);
    assert.equal(subjectAverage(beideToepfe, 75), 2.5);
  });

  it("lässt bei 100 nur schriftlich und bei 0 nur mündlich zählen", () => {
    assert.equal(subjectAverage(beideToepfe, 100), 2);
    assert.equal(subjectAverage(beideToepfe, 0), 4);
  });

  it("begrenzt das Gewicht auf 0 bis 100", () => {
    assert.equal(subjectAverage(beideToepfe, 140), 2);
    assert.equal(subjectAverage(beideToepfe, -40), 4);
  });

  it("nimmt auch innerhalb eines Topfes die Gewichte mit", () => {
    // Die Klausur zählt doppelt gegenüber dem Test, beide sind schriftlich.
    const schriftlich = subjectAverage([written(20, 2), written(50, 1)], 100);
    assert.equal(schriftlich, 3);
  });

  it("gibt ohne Noten nichts zurück", () => {
    assert.equal(subjectAverage([], 50), null);
    assert.equal(subjectAverage([written(20, 0)], 50), null);
  });
});

describe("overallAverage (R3)", () => {
  it("gibt ohne Fächer nichts zurück", () => {
    assert.equal(overallAverage([]), null);
  });

  it("mittelt die Fachschnitte", () => {
    assert.equal(overallAverage([2, 3, 4]), 3);
    assert.equal(overallAverage([1.5, 2.5]), 2);
    assert.equal(overallAverage([2.5]), 2.5);
  });

  it("lässt jedes Fach einmal zählen, egal wie viele Noten darin stehen", () => {
    const deutsch = subjectAverage(
      [written(10), written(10), written(10), written(10)],
      100,
    );
    const mathe = subjectAverage([written(30)], 100);

    assert.equal(deutsch, 1);
    assert.equal(mathe, 3);
    // Alle fünf Noten in einen Topf ergäben 1,4. Das Zeugnis meint 2,0.
    assert.equal(overallAverage([1, 3]), 2);
  });
});

describe("formatAverage (R4)", () => {
  it("schreibt mit Komma und zwei festen Stellen", () => {
    assert.equal(formatAverage(2), "2,00");
    assert.equal(formatAverage(1.5), "1,50");
    assert.equal(formatAverage(2.166), "2,17");
    assert.equal(formatAverage(2.164), "2,16");
  });

  it("nimmt auf Wunsch weniger Stellen", () => {
    assert.equal(formatAverage(2.35, 1), "2,4");
    assert.equal(formatAverage(2.34, 1), "2,3");
    assert.equal(formatAverage(2.4, 0), "2");
  });

  it("rundet kaufmännisch: ,5 geht aufwärts", () => {
    // Genau hier versagt toFixed: 1,005 liegt im Binärsystem knapp darunter
    // und würde zu „1,00“.
    assert.equal(formatAverage(1.005), "1,01");
    assert.equal(formatAverage(2.125), "2,13");
    assert.equal(formatAverage(2.5, 0), "3");
    assert.equal(formatAverage(1.5, 0), "2");
  });
});

describe("neededForTarget (R5)", () => {
  it("nennt die schlechteste Note, die noch reicht", () => {
    // Eine 1 steht schon, das Ziel ist eine 2: (10 + x) / 2 ≤ 20, also x ≤ 30.
    const outcome = need({ entries: [written(10)], target: 2 });

    assert.deepEqual(outcome, { status: "reicht", value: 30 });
    assert.equal(gradeLabel(30), "3");
  });

  it("sagt „sicher“, wenn selbst eine 6 das Ziel hält", () => {
    // Zehn Einsen im Rücken, Ziel eine 4: schlimmstenfalls 1,45.
    assert.deepEqual(need({ entries: [written(10, 10)], target: 4 }), {
      status: "sicher",
    });
  });

  it("sagt „unmoeglich“, wenn nicht einmal eine 1+ reicht", () => {
    // Eine dreifach zählende 5, Ziel eine 2: bestenfalls 3,93.
    assert.deepEqual(need({ entries: [written(50, 3)], target: 2 }), {
      status: "unmoeglich",
    });
  });

  it("kommt ohne bisherige Noten aus — dann ist die nächste allein der Schnitt", () => {
    assert.deepEqual(need({ target: 2 }), { status: "reicht", value: 20 });
    assert.deepEqual(need({ target: 2.3 }), { status: "reicht", value: 23 });
    assert.deepEqual(need({ target: 6 }), { status: "sicher" });
  });

  it("verlangt für das bessere Ziel die bessere Note (R6)", () => {
    const entries = [written(20)];

    assert.deepEqual(need({ entries, target: 2 }), {
      status: "reicht",
      value: 20,
    });
    assert.deepEqual(need({ entries, target: 1.5 }), {
      status: "reicht",
      value: 10,
    });
  });

  it("ändert die Antwort mit dem Gewicht der nächsten Note", () => {
    const entries = [written(10)];

    // Zählt die nächste Note einfach, reicht eine 3. Zählt sie dreifach —
    // etwa als Klausur statt als Test —, muss es eine 2− sein.
    assert.deepEqual(need({ entries, target: 2 }), {
      status: "reicht",
      value: 30,
    });
    assert.deepEqual(
      need({ entries, target: 2, next: { kind: "schriftlich", weight: 3 } }),
      { status: "reicht", value: 23 },
    );
  });

  it("beachtet, in welchen Topf die nächste Note fällt", () => {
    // Schriftlich steht eine 1, mündlich eine 3, beide Töpfe wiegen gleich.
    const entries = [written(10), oral(30)];
    const base = { entries, weightWritten: 50, target: 2 };

    // Schriftlich darf der Schnitt nicht steigen: es muss wieder eine 1 sein.
    assert.deepEqual(need({ ...base, next: { kind: "schriftlich", weight: 1 } }), {
      status: "reicht",
      value: 10,
    });
    // Mündlich ist dagegen noch Luft bis zur 3.
    assert.deepEqual(need({ ...base, next: { kind: "muendlich", weight: 1 } }), {
      status: "reicht",
      value: 30,
    });
  });

  it("urteilt nach der gerundeten Zahl, die auch angezeigt wird", () => {
    // Sechzig Gewichte auf einer glatten 2, dazu eine einfache 2−: das ergibt
    // 2,00492. Angezeigt wird „2,00“, also gilt das Ziel als gehalten — sonst
    // stünde die 2 auf dem Schirm und die App sagte „verfehlt“.
    const entries = [written(20, 60)];
    const average = subjectAverage([...entries, written(23)], 100) ?? 0;

    assert.ok(average > 2, "der Schnitt liegt rechnerisch über dem Ziel");
    assert.equal(formatAverage(average), "2,00");
    assert.deepEqual(need({ entries, target: 2 }), {
      status: "reicht",
      value: 23,
    });
  });

  it("kippt, sobald die Rundung nicht mehr trägt", () => {
    // Dieselbe Rechnung mit weniger Gewicht im Rücken: 2,00732 zeigt „2,01“,
    // und damit reicht die 2− nicht mehr.
    const entries = [written(20, 40)];
    const average = subjectAverage([...entries, written(23)], 100) ?? 0;

    assert.equal(formatAverage(average), "2,01");
    assert.deepEqual(need({ entries, target: 2 }), {
      status: "reicht",
      value: 20,
    });
  });
});
