import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BlattVorschlagErgebnis } from "@/lib/blatt-vorschlag";
import {
  ABBRUCH_VERFALL_MS,
  ABBRUECHE_GESAMT,
  PAUSEN_JE_BLATT,
  PAUSE_ANFANG_MS,
  PAUSE_HOECHSTENS_MS,
  SPAETER_HOECHSTENS,
  auswaehlen,
  erledigt,
  gedaechtnisAus,
  kostenSatz,
  laufAnzeige,
  nachleseSatz,
  nachleseZaehlen,
  naechstePause,
  pausenFolge,
  planen,
  tuerErgebnis,
  vorschlagJuenger,
  type BlattStand,
  type Erinnerung,
  type GedaechtnisZeile,
  type Kandidat,
  type LaufZeile,
} from "@/lib/leser/claude-ablauf";
import { RUHE_MS } from "@/lib/leser/regel";

/**
 * Wann der Leser der App liest, was er sich merkt und wann er Pause macht —
 * nur mit erfundenen Blättern. Die Abfragen dazu prüft
 * scripts/probe-claude-leser.mts gegen eine echte Datenbank.
 *
 * Bis zum 11.10.2026 stand diese Logik im Postboten (harness/postbote.mts),
 * und kein Test las sie. Jetzt kostet jeder Fehler hier Geld: ein Blatt, das
 * als nicht erledigt gilt, obwohl es das ist, wird ein zweites Mal bezahlt.
 */

const STAND = "2026-10-11T09:00:00.000Z";
const SPAETER = "2026-10-11T09:05:00.000Z";

function kandidat(teil: Partial<Kandidat> & { materialId: string }): Kandidat {
  return {
    eingeordnet: false,
    lastPageAt: STAND,
    seitLetzterSeiteMs: 60_000,
    offen: 0,
    fuerClaude: 1,
    claudeSeiten: 1,
    nachgereicht: [],
    vorschlaege: 0,
    juengsterVorschlagAt: null,
    ...teil,
  };
}

const NICHTS_GEMERKT = gedaechtnisAus([]);
const OPTIONEN = { ruheMs: RUHE_MS, ausgenommen: new Set<string>() };

function zeile(teil: Partial<GedaechtnisZeile>): GedaechtnisZeile {
  return {
    materialId: "blatt",
    art: "einordnen",
    schluessel: STAND,
    ergebnis: "nichts",
    abbruch: null,
    abgeschrieben: null,
    fristRestMs: null,
    ...teil,
  };
}

function erinnerung(teil: Partial<Erinnerung> = {}): Erinnerung {
  return { gemerkt: false, abbrueche: 0, laeuftNochMs: null, schonAbgeschrieben: new Set(), ...teil };
}

describe("gedaechtnisAus", () => {
  it("merkt ein Ergebnis für genau diesen Stand", () => {
    const g = gedaechtnisAus([zeile({})]);
    assert.equal(g("einordnen", "blatt", STAND).gemerkt, true);
    // Eine neue Seite ist ein neuer Fall.
    assert.equal(g("einordnen", "blatt", SPAETER).gemerkt, false);
    assert.equal(g("einordnen", "anderes", STAND).gemerkt, false);
  });

  it("zählt ein Ergebnis jeder Art für beide Arten — Abhaken und Zurücklegen lösen kein neues Lesen aus", () => {
    // Nachlese → „wieder in den Korb“: das Einordnen fragt dasselbe Gedächtnis.
    const nachNachlese = gedaechtnisAus([zeile({ art: "nachlese", ergebnis: "kein-vorschlag" })]);
    assert.equal(nachNachlese("einordnen", "blatt", STAND).gemerkt, true);
    // Einordnen mit Vorschlag → verworfen und abgehakt: die Nachlese liest die
    // Seiten, die das Einordnen abgeschrieben hatte, nicht noch einmal.
    const nachEinordnen = gedaechtnisAus([
      zeile({ ergebnis: "vorschlag", abgeschrieben: ["p1", "p2"] }),
    ]);
    assert.equal(nachEinordnen("nachlese", "blatt", STAND, ["p1", "p2"]).gemerkt, true);
    // Von Hand erledigt beide.
    const vonHand = gedaechtnisAus([zeile({ art: "von-hand", ergebnis: "kein-vorschlag" })]);
    assert.equal(vonHand("einordnen", "blatt", STAND).gemerkt, true);
    assert.equal(vonHand("nachlese", "blatt", STAND, ["p1"]).gemerkt, true);
  });

  it("lässt der Nachlese genau die Seiten, die das Einordnen NICHT abgeschrieben hat", () => {
    const g = gedaechtnisAus([zeile({ ergebnis: "vorschlag", abgeschrieben: ["p1"] })]);
    const e = g("nachlese", "blatt", STAND, ["p1", "p2"]);
    assert.equal(e.gemerkt, false);
    assert.deepEqual([...e.schonAbgeschrieben], ["p1"]);
    // Ohne Liste (ein „nichts“, eine Zeile von vor dem Wechsel) ist keine
    // Seite abgeschrieben — die Nachlese bekommt ihren zweiten Versuch.
    assert.equal(gedaechtnisAus([zeile({})])("nachlese", "blatt", STAND, ["p1"]).gemerkt, false);
    // Eine gemerkte Nachlese erledigt den Stand ganz, auch für eine unlesbare Seite.
    const zweiterVersuch = gedaechtnisAus([
      zeile({ ergebnis: "vorschlag", abgeschrieben: ["p1"] }),
      zeile({ art: "nachlese", ergebnis: "kein-vorschlag", abgeschrieben: [] }),
    ]);
    assert.equal(zweiterVersuch("nachlese", "blatt", STAND, ["p2"]).gemerkt, true);
  });

  it("zählt nur bezahlte Abbrüche, die am Blatt liegen können — auch an einer Pause, nie einen Ausfall der API", () => {
    const g = gedaechtnisAus([
      // Nichts gekostet: eine Pause, ein „später“ vor dem Strom.
      zeile({ ergebnis: "pause" }),
      zeile({ ergebnis: "spaeter" }),
      zeile({ ergebnis: "spaeter", abbruch: "frist" }),
      zeile({ ergebnis: "spaeter", abbruch: "rueckfall", art: "von-hand" }),
      zeile({ ergebnis: "spaeter", abbruch: "ablage", art: "nachlese" }),
      // Mitten im Strom abgerissen — ein `api_error` (eine Pause), ein 400
      // (später): bezahlt, und am Blatt nicht ausgeschlossen. Bis zur
      // Regression vom 11.10.2026 zählten sie nicht, und ein solches Blatt
      // kostete jeden Anstoß aufs Neue.
      zeile({ ergebnis: "pause", abbruch: "strom", art: "von-hand" }),
      zeile({ ergebnis: "spaeter", abbruch: "strom" }),
      // Bezahlt, aber die API: eine Überlastung im Strom. Zählt nie.
      zeile({ ergebnis: "pause", abbruch: "ausfall" }),
    ]);
    assert.equal(g("einordnen", "blatt", STAND).gemerkt, false);
    assert.equal(g("einordnen", "blatt", STAND).abbrueche, 5);
  });

  it("legt nach beliebig vielen Ausfällen der API kein Blatt still", () => {
    const ausfall = Array.from({ length: 12 }, () => zeile({ ergebnis: "pause", abbruch: "ausfall" }));
    const e = gedaechtnisAus(ausfall)("einordnen", "blatt", STAND);
    assert.equal(e.abbrueche, 0);
    assert.equal(erledigt(e), false);
  });

  it(`gibt ein Blatt, an dem der Strom jedes Mal abreißt, nach ${SPAETER_HOECHSTENS} bezahlten Versuchen dem Knopf`, () => {
    for (const ergebnis of ["pause", "spaeter"] as const) {
      const einer = gedaechtnisAus([zeile({ ergebnis, abbruch: "strom" })])("einordnen", "blatt", STAND);
      assert.equal(erledigt(einer), false, ergebnis);
      const zwei = gedaechtnisAus(
        Array.from({ length: SPAETER_HOECHSTENS }, () => zeile({ ergebnis, abbruch: "strom" })),
      )("einordnen", "blatt", STAND);
      assert.equal(erledigt(zwei), true, ergebnis);
    }
  });

  it("lässt bezahlte Abbrüche nach einem Tag verfallen — kein Ausfall legt ein Blatt für immer still", () => {
    const alt = ABBRUCH_VERFALL_MS + 1;
    const gestern = gedaechtnisAus([
      zeile({ ergebnis: "pause", abbruch: "strom", alterMs: alt }),
      zeile({ ergebnis: "spaeter", abbruch: "rueckfall", alterMs: alt }),
    ])("einordnen", "blatt", STAND);
    assert.equal(gestern.abbrueche, 0);
    assert.equal(erledigt(gestern), false);

    // Frist, Ablage und verwaiste Zeilen verfallen nicht.
    const bleibt = gedaechtnisAus([
      zeile({ ergebnis: "spaeter", abbruch: "frist", alterMs: alt }),
      zeile({ ergebnis: "laeuft", fristRestMs: -5, alterMs: alt }),
    ])("einordnen", "blatt", STAND);
    assert.equal(bleibt.abbrueche, 2);
    assert.equal(erledigt(bleibt), true);

    // Und auch die verfallenden nicht ohne Ende: über alle Tage höchstens ABBRUECHE_GESAMT.
    const viele = gedaechtnisAus(
      Array.from({ length: ABBRUECHE_GESAMT }, () => zeile({ ergebnis: "pause", abbruch: "strom", alterMs: alt })),
    )("einordnen", "blatt", STAND);
    assert.equal(erledigt(viele), true);

    const heute = gedaechtnisAus([
      zeile({ ergebnis: "pause", abbruch: "strom", alterMs: alt }),
      zeile({ ergebnis: "spaeter", abbruch: "strom", alterMs: 1_000 }),
      zeile({ ergebnis: "spaeter", abbruch: "frist", alterMs: 60_000 }),
    ])("einordnen", "blatt", STAND);
    assert.equal(heute.abbrueche, 2);
    assert.equal(erledigt(heute), true);

    // Ein gemerktes Ergebnis verfällt nicht: das ist kein Abbruch.
    const gemerkt = gedaechtnisAus([zeile({ ergebnis: "nichts", alterMs: alt * 10 })])("einordnen", "blatt", STAND);
    assert.equal(erledigt(gemerkt), true);
  });

  it("sieht eine frische „läuft“-Zeile als laufend und eine verwaiste als bezahlten Abbruch", () => {
    const laeuft = gedaechtnisAus([zeile({ ergebnis: "laeuft", fristRestMs: 120_000 })]);
    assert.equal(laeuft("einordnen", "blatt", STAND).laeuftNochMs, 120_000);
    assert.equal(laeuft("einordnen", "blatt", STAND).abbrueche, 0);

    const verwaist = gedaechtnisAus([zeile({ ergebnis: "laeuft", fristRestMs: -5 })]);
    assert.equal(verwaist("einordnen", "blatt", STAND).laeuftNochMs, null);
    assert.equal(verwaist("einordnen", "blatt", STAND).abbrueche, 1);
  });

  it(`gibt ein Blatt nach ${SPAETER_HOECHSTENS} bezahlten Abbrüchen im selben Stand dem Knopf`, () => {
    assert.equal(SPAETER_HOECHSTENS, 2);
    assert.equal(erledigt(erinnerung({ abbrueche: SPAETER_HOECHSTENS - 1 })), false);
    assert.equal(erledigt(erinnerung({ abbrueche: SPAETER_HOECHSTENS })), true);
    assert.equal(erledigt(erinnerung({ gemerkt: true })), true);
  });
});

describe("vorschlagJuenger", () => {
  it("sieht nur einen Vorschlag, der NACH der letzten Seite kam", () => {
    assert.equal(vorschlagJuenger(STAND, null), false);
    assert.equal(vorschlagJuenger(STAND, SPAETER), true);
    assert.equal(vorschlagJuenger(SPAETER, STAND), false);
    assert.equal(vorschlagJuenger(STAND, STAND), false);
    assert.equal(vorschlagJuenger("kaputt", SPAETER), false);
  });
});

describe("auswaehlen", () => {
  it("nimmt Korbblätter vor der Nachlese, jeweils das älteste zuerst", () => {
    const auswahl = auswaehlen(
      [
        kandidat({ materialId: "korb-neu", lastPageAt: SPAETER }),
        kandidat({ materialId: "nach", eingeordnet: true, nachgereicht: ["s"] }),
        kandidat({ materialId: "korb-alt" }),
      ],
      NICHTS_GEMERKT,
      OPTIONEN,
    );
    assert.deepEqual(auswahl, { einordnen: ["korb-alt", "korb-neu"], nachlese: ["nach"], wecker: [] });
  });

  it("lässt im Korb liegen: mit Vorschlag, ohne Seite für Claude, mit offener Seite, erledigt", () => {
    const g = gedaechtnisAus([zeile({ materialId: "gemerkt" })]);
    const auswahl = auswaehlen(
      [
        kandidat({ materialId: "vorschlag", vorschlaege: 1 }),
        kandidat({ materialId: "docling", fuerClaude: 0, claudeSeiten: 0 }),
        kandidat({ materialId: "offen", offen: 1, seitLetzterSeiteMs: 1_000 }),
        kandidat({ materialId: "gemerkt" }),
        kandidat({ materialId: "dran" }),
      ],
      g,
      OPTIONEN,
    );
    // Die offene Seite bekommt auch keinen Wecker: sie wartet auf die
    // Zuteilung, nicht auf die Uhr — deren Ende stößt den Leser an.
    assert.deepEqual(auswahl, { einordnen: ["dran"], nachlese: [], wecker: [] });
  });

  it("liest ein Altblatt im Korb nie von selbst — seine Seiten ohne Leser gehören dem Knopf", () => {
    // „wieder in den Korb“: kein Vorschlag, ungelesene Seiten — aber keine,
    // die die App Claude zugeteilt hat.
    const auswahl = auswaehlen(
      [kandidat({ materialId: "altblatt", fuerClaude: 2, claudeSeiten: 0 })],
      NICHTS_GEMERKT,
      OPTIONEN,
    );
    assert.deepEqual(auswahl, { einordnen: [], nachlese: [], wecker: [] });
  });

  it("lässt bei der Nachlese liegen: keine nachgereichte Seite, ein jüngerer Vorschlag, erledigt", () => {
    const g = gedaechtnisAus([
      zeile({ materialId: "gemerkt", art: "nachlese", ergebnis: "kein-vorschlag" }),
    ]);
    const auswahl = auswaehlen(
      [
        kandidat({ materialId: "altblatt", eingeordnet: true, nachgereicht: [] }),
        kandidat({ materialId: "wartet", eingeordnet: true, nachgereicht: ["s"], vorschlaege: 1, juengsterVorschlagAt: SPAETER }),
        kandidat({ materialId: "gemerkt", eingeordnet: true, nachgereicht: ["s"] }),
        // Ein älterer Vorschlag hält die Nachlese nicht auf.
        kandidat({ materialId: "dran", eingeordnet: true, nachgereicht: ["s"], vorschlaege: 1, juengsterVorschlagAt: "2026-10-01T00:00:00.000Z" }),
      ],
      g,
      OPTIONEN,
    );
    assert.deepEqual(auswahl.nachlese, ["dran"]);
  });

  it("stellt für ein Blatt, das noch nicht ruhig ist, einen Wecker auf den Rest", () => {
    const auswahl = auswaehlen(
      [kandidat({ materialId: "frisch", seitLetzterSeiteMs: 5_000 })],
      NICHTS_GEMERKT,
      OPTIONEN,
    );
    assert.deepEqual(auswahl, {
      einordnen: [],
      nachlese: [],
      wecker: [{ materialId: "frisch", ms: RUHE_MS - 5_000 + 500 }],
    });
  });

  it("nimmt nichts, was dieser Lauf schon versucht hat oder was nach einer Frist ruht", () => {
    const auswahl = auswaehlen([kandidat({ materialId: "x" })], NICHTS_GEMERKT, {
      ruheMs: RUHE_MS,
      ausgenommen: new Set(["x"]),
    });
    assert.deepEqual(auswahl, { einordnen: [], nachlese: [], wecker: [] });
  });

  it("hört nach den bezahlten Abbrüchen auf, von selbst zu lesen — nach einem 400 vor dem Strom nie", () => {
    const bezahlt = Array.from({ length: SPAETER_HOECHSTENS }, () =>
      zeile({ materialId: "zaeh", ergebnis: "spaeter", abbruch: "frist" }),
    );
    assert.deepEqual(
      auswaehlen([kandidat({ materialId: "zaeh" })], gedaechtnisAus(bezahlt), OPTIONEN).einordnen,
      [],
    );

    const umsonst = Array.from({ length: 10 }, () =>
      zeile({ materialId: "vierhundert", ergebnis: "spaeter", abbruch: null }),
    );
    assert.deepEqual(
      auswaehlen([kandidat({ materialId: "vierhundert" })], gedaechtnisAus(umsonst), OPTIONEN).einordnen,
      ["vierhundert"],
    );
  });

  it("wartet an einem Blatt, an dem gerade ein Aufruf läuft, mit einem Wecker auf dessen Frist", () => {
    const g = gedaechtnisAus([zeile({ materialId: "laeuft", ergebnis: "laeuft", fristRestMs: 60_000 })]);
    assert.deepEqual(auswaehlen([kandidat({ materialId: "laeuft" })], g, OPTIONEN), {
      einordnen: [],
      nachlese: [],
      wecker: [{ materialId: "laeuft", ms: 60_500 }],
    });
  });
});

describe("planen", () => {
  function stand(teil: Partial<BlattStand> = {}): BlattStand {
    return {
      eingeordnet: false,
      capturedOn: "2026-10-01",
      seiten: [
        { id: "d1", leser: "docling", gelesen: true },
        { id: "c2", leser: "claude", gelesen: false },
        { id: "n3", leser: null, gelesen: false },
        { id: "c4", leser: "claude", gelesen: true },
      ],
      lastPageAt: STAND,
      nachgereicht: [],
      vorschlaege: 0,
      juengsterVorschlagAt: null,
      ...teil,
    };
  }

  it("läuft nie, solange die App eine Seite noch selbst liest — für keine Art", () => {
    const offen = stand({
      seiten: [
        { id: "o1", leser: "offen", gelesen: false },
        { id: "c2", leser: "claude", gelesen: false },
      ],
    });
    for (const modus of ["einordnen", "nachlese", "von-hand"] as const) {
      assert.equal(planen(modus, offen).art, "kein-lauf", modus);
    }
  });

  it("ordnet von selbst ein: nur die ungelesenen Claude-Seiten, mit ihrer Nummer am Blatt", () => {
    // Die Seite ohne Leser (n3) liest im Korb nur der Knopf.
    assert.deepEqual(planen("einordnen", stand()), {
      art: "einordnen",
      laufArt: "einordnen",
      vorab: {
        capturedOn: "2026-10-01",
        seiten: [{ id: "c2", nummer: 2 }],
        vollstaendig: false,
        ersteSeiteDabei: false,
      },
    });
  });

  it("ordnet nicht ein: eingeordnet, mit Vorschlag, oder nichts für Claude", () => {
    assert.equal(planen("einordnen", stand({ eingeordnet: true })).art, "kein-lauf");
    assert.equal(planen("einordnen", stand({ vorschlaege: 1 })).art, "kein-lauf");
    assert.equal(
      planen("einordnen", stand({ seiten: [{ id: "d1", leser: "docling", gelesen: true }] })).art,
      "kein-lauf",
    );
  });

  it("liest bei der Nachlese genau die nachgereichten, die noch ungelesen sind", () => {
    const plan = planen(
      "nachlese",
      stand({ eingeordnet: true, nachgereicht: ["c2", "c4", "d1", "fremd"] }),
    );
    assert.deepEqual(plan, {
      art: "nachlese",
      laufArt: "nachlese",
      vorab: { seiten: [{ id: "c2", nummer: 2 }], nachgereicht: true },
    });
  });

  it("liest bei der Nachlese keine Seite, die ein Einordnen in diesem Stand schon abgeschrieben hat", () => {
    const blatt = stand({
      eingeordnet: true,
      seiten: [
        { id: "c1", leser: "claude", gelesen: false },
        { id: "c2", leser: "claude", gelesen: false },
      ],
      nachgereicht: ["c1", "c2"],
    });
    assert.deepEqual(planen("nachlese", blatt, new Set(["c1"])), {
      art: "nachlese",
      laufArt: "nachlese",
      vorab: { seiten: [{ id: "c2", nummer: 2 }], nachgereicht: true },
    });
    assert.equal(planen("nachlese", blatt, new Set(["c1", "c2"])).art, "kein-lauf");
  });

  it("liest bei der Nachlese nicht: im Korb, mit jüngerem Vorschlag, oder die Liste ist leer", () => {
    assert.equal(planen("nachlese", stand({ nachgereicht: ["c2"] })).art, "kein-lauf");
    assert.equal(
      planen(
        "nachlese",
        stand({ eingeordnet: true, nachgereicht: ["c2"], vorschlaege: 1, juengsterVorschlagAt: SPAETER }),
      ).art,
      "kein-lauf",
    );
    // Die alte NULL-Seite eines Altblattes ist nicht nachgereicht — leer heißt
    // hier: kein Lauf, nie „alle“.
    assert.equal(planen("nachlese", stand({ eingeordnet: true, nachgereicht: [] })).art, "kein-lauf");
  });

  it("liest von Hand an einem eingeordneten Blatt jede ungelesene Seite für Claude", () => {
    assert.deepEqual(planen("von-hand", stand({ eingeordnet: true, nachgereicht: ["c2"] })), {
      art: "nachlese",
      laufArt: "von-hand",
      vorab: {
        seiten: [
          { id: "c2", nummer: 2 },
          { id: "n3", nummer: 3 },
        ],
        // Nicht alle sind nachgereicht: der Auftrag sagt es dann nicht.
        nachgereicht: false,
      },
    });
  });

  it("liest von Hand im Korb wie beim Einordnen, auch die Seiten ohne Leser — und nie, solange ein Vorschlag liegt", () => {
    const plan = planen("von-hand", stand());
    assert.equal(plan.art, "einordnen");
    assert.equal(plan.art === "einordnen" && plan.laufArt, "von-hand");
    assert.deepEqual(plan.art === "einordnen" && plan.vorab.seiten, [
      { id: "c2", nummer: 2 },
      { id: "n3", nummer: 3 },
    ]);
    assert.equal(planen("von-hand", stand({ vorschlaege: 1 })).art, "kein-lauf");
    assert.equal(planen("von-hand", stand({ eingeordnet: true, vorschlaege: 1 })).art, "kein-lauf");
  });
});

describe("naechstePause", () => {
  it("verdoppelt von fünf Minuten bis höchstens einer halben Stunde", () => {
    const folge = [PAUSE_ANFANG_MS];
    for (let i = 0; i < 4; i += 1) folge.push(naechstePause(folge[folge.length - 1]!));
    assert.deepEqual(
      folge.map((ms) => ms / 60_000),
      [5, 10, 20, 30, 30],
    );
    assert.equal(naechstePause(PAUSE_HOECHSTENS_MS), PAUSE_HOECHSTENS_MS);
  });
});

describe("pausenFolge", () => {
  it(`zählt Pausen in Folge an demselben Blatt — ab ${PAUSEN_JE_BLATT} ruht es`, () => {
    let folge = pausenFolge(null, "x", true);
    folge = pausenFolge(folge, "x", true);
    folge = pausenFolge(folge, "x", true);
    assert.deepEqual(folge, { materialId: "x", anzahl: PAUSEN_JE_BLATT });
    // Ein anderes Blatt beginnt von vorn.
    assert.deepEqual(pausenFolge(folge, "y", true), { materialId: "y", anzahl: 1 });
  });

  it("rechnet eine Pause, die nicht am Blatt liegen kann, dem Blatt nicht zu — und lässt die Folge stehen", () => {
    // Abrechnung, Schlüssel, 429, Netz: kein Blatt ruht deshalb, wie lange es
    // auch dauert (Nachprüfung vom 11.10.2026).
    let folge: ReturnType<typeof pausenFolge> = null;
    for (let i = 0; i < 10; i += 1) folge = pausenFolge(folge, "x", false);
    assert.equal(folge, null);
    // Eine Folge am Blatt bleibt, wie sie war — weder mehr noch gerissen.
    const zwei = pausenFolge(pausenFolge(null, "x", true), "x", true);
    assert.deepEqual(pausenFolge(zwei, "x", false), { materialId: "x", anzahl: 2 });
    assert.deepEqual(pausenFolge(zwei, "y", false), { materialId: "x", anzahl: 2 });
  });
});

describe("tuerErgebnis", () => {
  const vorschlag = {
    subjectId: null,
    title: null,
    capturedOn: null,
    note: null,
    topics: [],
    transcripts: [{ pageId: "p", text: "x" }],
  };

  it("sagt, wo ein angelegter Vorschlag geblieben ist", () => {
    const jev = tuerErgebnis({
      art: "angelegt",
      id: "v",
      verworfen: [{ page: "d", grund: "docling" }],
      vorschlag,
      eingeordnet: { ok: true, art: "jev", subjectName: "Mathe", confidence: 0.9, topics: ["Kettenregel"] },
    });
    assert.deepEqual(jev, {
      ergebnis: "vorschlag",
      grund: "eingeordnet: Mathe: Kettenregel; 1 Seite verworfen (gelesen oder Docling)",
    });

    const korb = tuerErgebnis({
      art: "angelegt",
      id: "v",
      verworfen: [],
      vorschlag,
      eingeordnet: { ok: false, grund: "Jev war nicht erreichbar." },
    });
    assert.deepEqual(korb, { ergebnis: "vorschlag", grund: "Vorschlag liegt im Korb: Jev war nicht erreichbar." });
  });

  it("macht aus nur Verworfenem „kein-vorschlag“, aus einem Nein „nichts“ — und aus einem Rennen „später“", () => {
    assert.equal(tuerErgebnis({ art: "leer", verworfen: [] }).ergebnis, "kein-vorschlag");

    const nein: BlattVorschlagErgebnis[] = [
      { art: "abgewiesen", grund: "kein-blatt" },
      { art: "abgewiesen", grund: "ungueltig", meldungen: ["Der Titel ist zu lang."] },
    ];
    for (const tuer of nein) assert.equal(tuerErgebnis(tuer).ergebnis, "nichts");

    // Eine Seite, die zwischen dem frischen Blick und der Tür verschwand:
    // nicht gemerkt, sonst läse niemand die übrigen je wieder.
    const rennen: BlattVorschlagErgebnis[] = [
      { art: "abgewiesen", grund: "fremde-seiten", seiten: ["x"] },
      { art: "abgewiesen", grund: "nicht-angelegt", mitAbschrift: true },
    ];
    for (const tuer of rennen) assert.equal(tuerErgebnis(tuer).ergebnis, "spaeter");
  });
});

describe("nachleseZaehlen", () => {
  it("zählt an den Seiten, nicht an dem, was das Modell sagt", () => {
    const zaehlung = nachleseZaehlen(
      ["a", "b"],
      ["a", "b", "alt"],
      new Map([
        ["a", true],
        ["b", false],
        ["alt", true],
      ]),
    );
    assert.deepEqual(zaehlung, { uebernommen: 1, offen: 1, fremd: 1 });
    assert.equal(
      nachleseSatz(zaehlung, 2),
      "1 von 2 Seiten übernommen, 1 nicht zu lesen, bleibt offen, dazu 1 Seite gelesen, die nicht im Auftrag standen",
    );
  });

  it("zählt eine gelöschte Seite nicht als übernommen", () => {
    assert.deepEqual(nachleseZaehlen(["a"], ["a"], new Map()), { uebernommen: 0, offen: 1, fremd: 0 });
    assert.equal(nachleseSatz({ uebernommen: 0, offen: 1, fremd: 0 }, 1), "nichts übernommen");
  });
});

const LAUF: Omit<LaufZeile, "art" | "ergebnis" | "grund" | "kostenUsd" | "createdAt"> = {
  abbruch: null,
  gemessen: true,
  fristRestMs: null,
};

describe("laufAnzeige", () => {
  it("sagt bei einem bezahlten Abbruch ohne Messung, dass er bezahlt war", () => {
    assert.equal(
      laufAnzeige({
        art: "einordnen",
        ergebnis: "spaeter",
        grund: "Die Frist dieses Laufs ist abgelaufen.",
        kostenUsd: null,
        abbruch: "frist",
        gemessen: false,
        fristRestMs: null,
        createdAt: new Date("2026-10-11T12:03:00Z"),
      }),
      "Zuletzt So, 11.10., 14:03 Uhr: nicht fertig geworden: Die Frist dieses Laufs ist abgelaufen. · bezahlt, Betrag unbekannt",
    );
  });

  it("nennt eine laufende Zeile „liest gerade“ und eine verwaiste einen abgebrochenen Lauf", () => {
    const laeuft = { art: "einordnen" as const, ergebnis: "laeuft" as const, grund: "", kostenUsd: null, abbruch: null, gemessen: false, createdAt: new Date("2026-10-11T12:03:00Z") };
    assert.equal(laufAnzeige({ ...laeuft, fristRestMs: 60_000 }), "Zuletzt So, 11.10., 14:03 Uhr: liest gerade");
    assert.equal(
      laufAnzeige({ ...laeuft, fristRestMs: -1 }),
      "Zuletzt So, 11.10., 14:03 Uhr: abgebrochen (die App startete mitten im Lauf neu) · bezahlt, Betrag unbekannt",
    );
  });

  it("sagt wann, was, warum und was es gekostet hat — in Berliner Zeit", () => {
    assert.equal(
      laufAnzeige({
        ...LAUF,
        art: "von-hand",
        ergebnis: "nichts",
        grund: "Abgelehnt (bio), auch nach dem Rückfall.",
        kostenUsd: 0.1234,
        createdAt: new Date("2026-10-11T12:03:00Z"),
      }),
      "Zuletzt So, 11.10., 14:03 Uhr (von Hand angestoßen): ohne Ergebnis: Abgelehnt (bio), auch nach dem Rückfall. · 0,123 $",
    );
  });

  it("lässt Grund und Betrag weg, wenn es keine gibt", () => {
    assert.equal(
      laufAnzeige({
        ...LAUF,
        art: "einordnen",
        ergebnis: "pause",
        grund: "",
        kostenUsd: null,
        createdAt: new Date("2026-01-05T07:00:00Z"),
      }),
      "Zuletzt Mo, 5.1., 08:00 Uhr: angehalten",
    );
  });

  it("nennt einen Vorschlag des Fragenlaufs „Fragen vorgeschlagen“ und nicht „abgeschrieben“", () => {
    // Dieselbe Zeile steht an der Klausurseite des Abrufs (@/lib/fragenlauf).
    assert.equal(
      laufAnzeige({
        ...LAUF,
        art: "fragen",
        ergebnis: "vorschlag",
        grund: "12 Fragen liegen im Eingang",
        kostenUsd: 0.5,
        createdAt: new Date("2026-10-11T12:03:00Z"),
      }),
      "Zuletzt So, 11.10., 14:03 Uhr: Fragen vorgeschlagen: 12 Fragen liegen im Eingang · 0,500 $",
    );
    assert.match(
      laufAnzeige({
        ...LAUF,
        art: "fragen",
        ergebnis: "kein-vorschlag",
        grund: "nur Überschriften",
        kostenUsd: null,
        createdAt: new Date("2026-10-11T12:03:00Z"),
      }),
      /: kein Vorschlag: nur Überschriften$/,
    );
  });
});

describe("kostenSatz", () => {
  it("nennt eine vollständige Summe ohne Zusatz", () => {
    assert.equal(kostenSatz({ laeufe: 3, usd: 0.412, unbekannt: 0, abgebrochen: 0 }), "0,412 $ für 3 Läufe mit Antwort");
  });

  it("macht die Summe zur Untergrenze, sobald ein bezahlter Abbruch ohne Messung dazukam", () => {
    assert.equal(
      kostenSatz({ laeufe: 3, usd: 0.412, unbekannt: 0, abgebrochen: 2 }),
      "mindestens 0,412 $ für 3 Läufe mit Antwort (dazu 2 abgebrochene Läufe, deren Kosten nicht bekannt sind)",
    );
    assert.equal(
      kostenSatz({ laeufe: 1, usd: 0, unbekannt: 1, abgebrochen: 1 }),
      "mindestens 0,000 $ für 1 Lauf mit Antwort (1 davon ohne bekannten Preis; dazu 1 abgebrochener Lauf, dessen Kosten nicht bekannt sind)",
    );
  });
});
