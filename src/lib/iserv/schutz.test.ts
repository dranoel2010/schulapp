import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IservFehler } from "@/lib/iserv/client";
import { fingerprint, pruefe, type QuellAntwort, type Snapshot } from "@/lib/iserv/schutz";
import type { IservItem, IservQuelle } from "@/lib/iserv/types";

const JETZT = new Date("2026-10-05T10:15:00Z");
const FENSTER = "2026-09-21";
const URTEIL = { genommen: true, regel: "test-urteil" };

function item(n: number, letzterTag = "2026-10-20", quelle: IservQuelle = "klasse"): IservItem {
  return {
    quelle,
    fremdId: `cal|uid-${n}|`,
    kalender: "Arbeitsmaterial_10",
    titel: `Termin ${n}`,
    ort: null,
    beschreibung: null,
    link: null,
    ganztaegig: true,
    ersterTag: letzterTag,
    letzterTag,
    beginn: null,
    ende: null,
  };
}

function items(von: number, bis: number, letzterTag?: string, quelle?: IservQuelle): IservItem[] {
  return Array.from({ length: bis - von + 1 }, (_, i) => item(von + i, letzterTag, quelle));
}

function snap(quelle: IservQuelle, liste: IservItem[], ausstehend: Snapshot["ausstehend"] = null): Snapshot {
  return {
    quelle,
    remoteId: quelle === "oeffentlich" ? "/+public/calendar" : "/arbeitsmaterial.10/calendar",
    label: quelle === "oeffentlich" ? "Öffentlich" : "Arbeitsmaterial_10",
    items: liste,
    fetchedAt: new Date("2026-10-04T10:15:00Z"),
    gesehenAm: new Date("2026-10-04T10:15:00Z"),
    ausstehend,
  };
}

const ok = (liste: IservItem[]): QuellAntwort => ({ art: "ok", items: liste, remoteId: "/r", label: "L" });

function lauf(quelle: IservQuelle, alt: Snapshot | null, antwort: QuellAntwort, jetzt = JETZT) {
  return pruefe({ quelle, alt, antwort, fensterStart: FENSTER, jetzt, beurteile: () => URTEIL });
}

describe("pruefe", () => {
  it("übernimmt eine normale Antwort", () => {
    const p = lauf("klasse", snap("klasse", items(1, 5)), ok(items(1, 6)));

    assert.equal(p.entscheidung, "uebernehmen");
    assert.equal(p.neu?.items.length, 6);
    assert.equal(p.neu?.fetchedAt, JETZT);
    assert.equal(p.neu?.ausstehend, null);
    assert.equal(p.warnung, null);
  });

  it("übernimmt beim ersten Abruf ohne Prüfung, auch leer", () => {
    assert.equal(lauf("oeffentlich", null, ok([])).entscheidung, "uebernehmen");
    assert.equal(lauf("klasse", null, ok(items(1, 3))).neu?.items.length, 3);
  });

  it("nimmt den öffentlichen Kalender leer NIE — auch nicht beim dritten Mal", () => {
    let alt = snap("oeffentlich", items(1, 40, undefined, "oeffentlich"));

    for (let mal = 1; mal <= 4; mal += 1) {
      const p = lauf("oeffentlich", alt, ok([]));
      assert.equal(p.entscheidung, "fehler", `Mal ${mal}`);
      assert.equal(p.neu, null);
      assert.match(p.satz ?? "", /leer — alter Stand bleibt/);
      alt = p.neu ?? alt;
    }
  });

  it("hält ein leeres Klassenkalender-Ergebnis zweimal zurück und übernimmt es beim dritten gleichen", () => {
    let alt = snap("klasse", items(1, 12));

    const eins = lauf("klasse", alt, ok([]));
    assert.equal(eins.entscheidung, "behalten");
    assert.equal(eins.neu?.items.length, 12, "der alte Stand bleibt");
    assert.equal(eins.neu?.ausstehend?.anzahl, 1);
    assert.match(eins.warnung ?? "", /0 statt 12 Termine — alter Stand bleibt, bis es 3-mal so kommt \(1 von 3\)/);
    alt = eins.neu!;

    const zwei = lauf("klasse", alt, ok([]), new Date(JETZT.getTime() + 3 * 3_600_000));
    assert.equal(zwei.entscheidung, "behalten");
    assert.equal(zwei.neu?.ausstehend?.anzahl, 2);
    assert.equal(zwei.neu?.ausstehend?.seit, JETZT, "seit dem ersten Mal");
    alt = zwei.neu!;

    const drei = lauf("klasse", alt, ok([]), new Date(JETZT.getTime() + 6 * 3_600_000));
    assert.equal(drei.entscheidung, "uebernehmen");
    assert.equal(drei.neu?.items.length, 0);
    assert.equal(drei.neu?.ausstehend, null);
    assert.match(drei.warnung ?? "", /nach 3 gleichen Antworten übernommen — jetzt 0 statt 12/);
  });

  it("fängt bei einem anderen Fingerprint von vorn an", () => {
    const alt = snap("klasse", items(1, 20), { fingerprint: fingerprint(items(1, 2)), anzahl: 2, seit: JETZT });
    const p = lauf("klasse", alt, ok(items(1, 3)));

    assert.equal(p.entscheidung, "behalten");
    assert.equal(p.neu?.ausstehend?.anzahl, 1);
    assert.equal(p.neu?.ausstehend?.fingerprint, fingerprint(items(1, 3)));
  });

  it("hält eine Halbierung bei ≥ 10 zurück, nimmt aber eine kleine Änderung", () => {
    assert.equal(lauf("klasse", snap("klasse", items(1, 10)), ok(items(1, 4))).entscheidung, "behalten");
    assert.equal(lauf("klasse", snap("klasse", items(1, 10)), ok(items(1, 5))).entscheidung, "uebernehmen");
    assert.equal(lauf("klasse", snap("klasse", items(1, 9)), ok(items(1, 1))).entscheidung, "uebernehmen");
    assert.equal(lauf("klasse", snap("klasse", items(1, 3)), ok([])).entscheidung, "behalten");
  });

  it("hält auch einen Klassenkalender mit nur einem oder zwei Terminen zurück, wenn er leer kommt", () => {
    // Im Klassenkalender sind ein, zwei Termine der Normalfall — sie dürfen
    // nicht nach einer einzigen leeren Antwort verschwinden.
    for (const n of [1, 2]) {
      const p = lauf("klasse", snap("klasse", items(1, n)), ok([]));
      assert.equal(p.entscheidung, "behalten", `${n} Termine`);
      assert.equal(p.neu?.items.length, n);
    }
    assert.equal(lauf("aufgaben", snap("aufgaben", items(1, 1, undefined, "aufgaben")), ok([])).entscheidung, "behalten");
  });

  it("zählt nur, was im Fenster liegt und nicht eingefroren ist", () => {
    const alt = snap("klasse", [
      ...items(1, 12, "2026-09-01"),
      ...items(20, 21).map((i) => ({ ...i, fest: URTEIL })),
    ]);
    assert.equal(lauf("klasse", alt, ok([])).entscheidung, "uebernehmen");
  });

  it("macht aus einer fehlenden Quelle mit kommenden Terminen einen Fehler — nicht ein leeres Ergebnis", () => {
    const fehlt: QuellAntwort = { art: "fehlt", grund: "Klassenkalender: keiner erkannt." };

    for (const n of [1, 2, 5]) {
      const p = lauf("klasse", snap("klasse", items(1, n)), fehlt);
      assert.equal(p.entscheidung, "fehler", `${n} Termine`);
      assert.equal(p.neu, null, "der alte Stand bleibt");
      assert.equal(p.satz, `Klassenkalender: keiner erkannt. Der alte Stand (${n} Termine) bleibt.`);
    }

    const aufgaben = lauf("aufgaben", snap("aufgaben", items(1, 2, undefined, "aufgaben")), { art: "fehlt", grund: "weg" });
    assert.equal(aufgaben.entscheidung, "fehler");
  });

  it("nimmt eine fehlende Quelle als leer, wenn von ihr nichts mehr kommt", () => {
    const fehlt: QuellAntwort = { art: "fehlt", grund: "Klassenkalender: keiner erkannt." };
    const vergangen = snap("klasse", items(1, 3, "2026-09-01"));

    const p = lauf("klasse", vergangen, fehlt);
    assert.equal(p.entscheidung, "uebernehmen");
    assert.equal(p.neu?.remoteId, "/arbeitsmaterial.10/calendar", "bleibt beim alten Kalender");
    assert.equal(p.neu?.items.length, 3, "das Vergangene bleibt eingefroren");
    assert.ok(p.neu?.items.every((i) => i.fest));
    assert.match(p.warnung ?? "", /^Klassenkalender: keiner erkannt\./);
  });

  it("macht aus einem fehlenden öffentlichen Kalender einen Fehler", () => {
    const p = lauf("oeffentlich", snap("oeffentlich", items(1, 5)), { art: "fehlt", grund: "weg" });
    assert.equal(p.entscheidung, "fehler");
    assert.equal(p.satz, "weg");
  });

  it("lässt bei einem Fehler alles, wie es ist", () => {
    const fehler = new IservFehler("voruebergehend", "IServ war nicht erreichbar.");
    const p = lauf("oeffentlich", snap("oeffentlich", items(1, 5)), { art: "fehler", fehler });

    assert.equal(p.entscheidung, "fehler");
    assert.equal(p.neu, null);
    assert.equal(p.satz, "IServ war nicht erreichbar.");
  });

  it("friert Vergangenes ein, das IServ nicht mehr liefert — mit dem Urteil von jetzt", () => {
    const vergangen = items(1, 3, "2026-09-10");
    const imFenster = items(10, 12, "2026-10-20");
    const alt = snap("oeffentlich", [
      ...vergangen,
      { ...item(4, "2026-09-11"), fest: { genommen: false, regel: "alt" } },
      ...imFenster,
    ]);

    const p = lauf("oeffentlich", alt, ok([item(10), item(11), item(30)]));
    const nachId = new Map(p.neu?.items.map((i) => [i.fremdId, i]));

    assert.equal(p.entscheidung, "uebernehmen");
    assert.deepEqual(nachId.get("cal|uid-1|")?.fest, URTEIL, "eingefroren mit dem Urteil von jetzt");
    assert.deepEqual(nachId.get("cal|uid-4|")?.fest, { genommen: false, regel: "alt" }, "schon eingefroren bleibt");
    assert.equal(nachId.has("cal|uid-12|"), false, "im Fenster und weg: weg");
    assert.equal(nachId.get("cal|uid-30|")?.fest, undefined);
    assert.equal(p.neu?.items.length, 7);
  });

  it("nimmt bei gleicher fremdId den neuen Stand", () => {
    const alt = snap("oeffentlich", [{ ...item(1, "2026-09-10"), titel: "alt" }]);
    const neu = { ...item(1, "2026-09-10"), titel: "neu" };
    const p = lauf("oeffentlich", alt, ok([neu]));

    assert.deepEqual(p.neu?.items, [neu]);
  });
});

describe("fingerprint", () => {
  it("hängt nicht an der Reihenfolge", () => {
    assert.equal(fingerprint(items(1, 5)), fingerprint(items(1, 5).reverse()));
    assert.notEqual(fingerprint(items(1, 5)), fingerprint(items(1, 4)));
  });
});
