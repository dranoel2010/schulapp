import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BERUEHRT_RUHE_MS,
  IN_ARBEIT_MINUTEN,
  KORB_FRISCH_MINUTEN,
  LEERER_STAND,
  NEU_LADEN_GEDULD_MS,
  TAKT_IN_ARBEIT_MS,
  TAKT_RUHIG_MS,
  ZURUECK_ABSTAND_MS,
  antwortLesen,
  beimKnopf,
  entscheiden,
  fingerabdruck,
  inArbeitAus,
  istEingabefeld,
  naechsteAbfrageIn,
  sofortFragen,
  sperreAus,
  type Sperre,
  type StandZahlen,
} from "@/lib/blaetter-stand";

/**
 * Der Stand der Blätter und die Frage, ob nachgeladen werden darf — nur mit
 * erfundenen Zahlen. Die Abfrage dahinter (`blaetterStand()` in
 * @/lib/materials) braucht eine Datenbank und ist hier nicht dabei.
 */

const VORLAGE: StandZahlen = {
  blaetter: 3,
  eingeordnet: 2,
  neuestesBlatt: "2026-03-01T08:00:00.000Z",
  zuletztEingeordnet: "2026-03-01T09:00:00.000Z",
  angaben: "0123456789abcdef0123456789abcdef",
  frischImKorb: 0,
  seiten: 5,
  offen: 0,
  docling: 2,
  claude: 1,
  gelesen: 4,
  maschinell: 2,
  abschriftBytes: 1234,
  neuesteSeite: "2026-03-01T08:00:01.000Z",
  seitenInArbeit: 0,
  vorschlaege: 1,
  neuesterVorschlag: null,
};

/** Ein Feld anders: Zahl +1, Text mit Zusatz, null wird ein Zeitpunkt. */
function geaendert(feld: keyof StandZahlen): StandZahlen {
  const wert = VORLAGE[feld];
  const neu =
    typeof wert === "number"
      ? wert + 1
      : wert === null
        ? "2026-01-01T00:00:00.000Z"
        : `${wert}x`;

  return { ...VORLAGE, [feld]: neu };
}

describe("fingerabdruck", () => {
  it("gibt für gleiche Zahlen denselben Text, egal in welcher Folge die Schlüssel stehen", () => {
    const umgedreht = Object.fromEntries(
      Object.entries(VORLAGE).reverse(),
    ) as StandZahlen;

    assert.equal(fingerabdruck({ ...VORLAGE }), fingerabdruck(VORLAGE));
    assert.equal(fingerabdruck(umgedreht), fingerabdruck(VORLAGE));
  });

  it("ändert sich mit jedem einzelnen Feld", () => {
    const felder = Object.keys(VORLAGE) as Array<keyof StandZahlen>;
    // Jedes Feld der Zahlen, und keines fehlt im Abdruck.
    assert.equal(felder.length, Object.keys(LEERER_STAND).length);

    for (const feld of felder) {
      assert.notEqual(
        fingerabdruck(geaendert(feld)),
        fingerabdruck(VORLAGE),
        `Feld ${feld} fehlt im Fingerabdruck`,
      );
    }
  });

  it("hält null und den leeren Text auseinander", () => {
    assert.notEqual(
      fingerabdruck({ ...VORLAGE, neuestesBlatt: null }),
      fingerabdruck({ ...VORLAGE, neuestesBlatt: "" }),
    );
  });
});

describe("inArbeitAus", () => {
  it("ist wahr, solange eine Seite gelesen wird", () => {
    assert.equal(inArbeitAus({ ...LEERER_STAND, seitenInArbeit: 1 }), true);
  });

  it("ist wahr bei einem frischen Korbblatt ohne Vorschlag", () => {
    assert.equal(inArbeitAus({ ...LEERER_STAND, frischImKorb: 1 }), true);
  });

  it("ist falsch ohne beides — auch wenn es offene oder Claude-Seiten gibt", () => {
    assert.equal(inArbeitAus(LEERER_STAND), false);
    assert.equal(
      inArbeitAus({ ...LEERER_STAND, offen: 2, claude: 3, seiten: 5 }),
      false,
    );
  });
});

describe("naechsteAbfrageIn", () => {
  const ruhig = { sichtbar: true, inArbeit: false, fehler: false, abgemeldet: false };

  it("fragt im versteckten Tab nicht, auch wenn gelesen wird", () => {
    assert.equal(naechsteAbfrageIn({ ...ruhig, sichtbar: false }), null);
    assert.equal(
      naechsteAbfrageIn({ ...ruhig, sichtbar: false, inArbeit: true }),
      null,
    );
  });

  it("fragt nach dem Abmelden nie wieder", () => {
    assert.equal(naechsteAbfrageIn({ ...ruhig, abgemeldet: true }), null);
    assert.equal(
      naechsteAbfrageIn({ ...ruhig, abgemeldet: true, inArbeit: true }),
      null,
    );
  });

  it("fragt nach einem Fehler ruhig weiter, auch wenn gelesen wird", () => {
    assert.equal(
      naechsteAbfrageIn({ ...ruhig, fehler: true, inArbeit: true }),
      TAKT_RUHIG_MS,
    );
  });

  it("fragt schnell, solange gelesen wird, sonst ruhig", () => {
    assert.equal(
      naechsteAbfrageIn({ ...ruhig, inArbeit: true }),
      TAKT_IN_ARBEIT_MS,
    );
    assert.equal(naechsteAbfrageIn(ruhig), TAKT_RUHIG_MS);
    assert.ok(TAKT_IN_ARBEIT_MS < TAKT_RUHIG_MS);
  });

  it("fragt bald wieder, wenn ein neuer Stand nur aufs Stillhalten wartet", () => {
    assert.equal(naechsteAbfrageIn({ ...ruhig, bald: true }), BERUEHRT_RUHE_MS);
    assert.equal(
      naechsteAbfrageIn({ ...ruhig, bald: true, inArbeit: true }),
      BERUEHRT_RUHE_MS,
    );
    assert.ok(BERUEHRT_RUHE_MS < TAKT_IN_ARBEIT_MS);
  });

  it("fragt auch bald nicht im versteckten Tab, abgemeldet oder nach einem Fehler", () => {
    assert.equal(naechsteAbfrageIn({ ...ruhig, bald: true, sichtbar: false }), null);
    assert.equal(naechsteAbfrageIn({ ...ruhig, bald: true, abgemeldet: true }), null);
    assert.equal(
      naechsteAbfrageIn({ ...ruhig, bald: true, fehler: true }),
      TAKT_RUHIG_MS,
    );
  });
});

describe("die Fenster für „in Arbeit“", () => {
  it("lässt das Korbblatt kürzer warten als eine Seite", () => {
    assert.ok(KORB_FRISCH_MINUTEN < IN_ARBEIT_MINUTEN);
  });

  it("bleibt unter einer Stunde — sonst stünde „wird gelesen“ zu lange da", () => {
    assert.ok(IN_ARBEIT_MINUTEN <= 60);
  });
});

describe("sofortFragen", () => {
  it("fragt, wenn noch nie gefragt wurde", () => {
    assert.equal(sofortFragen(5000, null), true);
  });

  it("fragt nicht zweimal kurz hintereinander", () => {
    assert.equal(sofortFragen(1000, 0), false);
  });

  it("fragt wieder, sobald der Abstand erreicht ist", () => {
    assert.equal(sofortFragen(ZURUECK_ABSTAND_MS, 0), true);
  });
});

describe("istEingabefeld", () => {
  const feld = (tag: string, typ: string | null = null, editierbar = false) =>
    istEingabefeld({ tag, typ, editierbar });

  it("zählt Textfelder aller Art", () => {
    for (const typ of ["text", "date", "search", "email", "number"]) {
      assert.equal(feld("INPUT", typ), true, typ);
    }
    assert.equal(feld("TEXTAREA"), true);
    assert.equal(feld("SELECT"), true);
    assert.equal(feld("DIV", null, true), true);
  });

  it("zählt Knöpfe, Häkchen und Dateiauswahl nicht", () => {
    for (const typ of [
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "file",
      "hidden",
    ]) {
      assert.equal(feld("INPUT", typ), false, typ);
    }
    assert.equal(feld("BUTTON"), false);
    assert.equal(feld("A"), false);
    assert.equal(feld("DIV"), false);
  });
});

describe("sperreAus", () => {
  it("sperrt nichts, wenn nichts los ist", () => {
    assert.equal(
      sperreAus({ aufnahme: false, ungespeichert: false, fokus: false }),
      "keine",
    );
  });

  it("nimmt das Schwerste zuerst", () => {
    assert.equal(
      sperreAus({ aufnahme: true, ungespeichert: true, fokus: true }),
      "aufnahme",
    );
    assert.equal(
      sperreAus({ aufnahme: false, ungespeichert: true, fokus: true }),
      "ungespeichert",
    );
    assert.equal(
      sperreAus({ aufnahme: false, ungespeichert: false, fokus: true }),
      "fokus",
    );
    assert.equal(
      sperreAus({ aufnahme: false, ungespeichert: false, fokus: true, beruehrt: true }),
      "fokus",
    );
    assert.equal(
      sperreAus({ aufnahme: false, ungespeichert: false, fokus: false, beruehrt: true }),
      "beruehrt",
    );
  });
});

describe("entscheiden", () => {
  const JETZT = 1_000_000;
  const grund = {
    bekannt: "alt",
    neu: "neu",
    sperre: "keine" as Sperre,
    angestossen: null,
    jetzt: JETZT,
  };

  it("tut nichts, solange der Stand gleich ist — bei jeder Sperre", () => {
    for (const sperre of ["keine", "aufnahme", "ungespeichert", "fokus", "beruehrt"] as const) {
      assert.equal(entscheiden({ ...grund, neu: "alt", sperre }), "nichts", sperre);
    }
  });

  it("lädt nach, wenn sich etwas getan hat und nichts dagegen spricht", () => {
    assert.equal(entscheiden(grund), "neu-laden");
  });

  it("lässt den Auslöser in Ruhe", () => {
    assert.equal(entscheiden({ ...grund, sperre: "aufnahme" }), "nichts");
  });

  it("wartet still, solange eben gescrollt oder gezeigt wurde", () => {
    assert.equal(entscheiden({ ...grund, sperre: "beruehrt" }), "spaeter");
  });

  it("gibt bei Eingaben nur einen Hinweis", () => {
    assert.equal(entscheiden({ ...grund, sperre: "ungespeichert" }), "hinweis");
    assert.equal(entscheiden({ ...grund, sperre: "fokus" }), "hinweis");
  });

  it("lädt nicht zweimal für denselben Stand, solange das erste unterwegs ist", () => {
    assert.equal(
      entscheiden({ ...grund, angestossen: { stand: "neu", seit: JETZT - 1000 } }),
      "nichts",
    );
    assert.equal(
      entscheiden({
        ...grund,
        sperre: "ungespeichert",
        angestossen: { stand: "neu", seit: JETZT - 1000 },
      }),
      "nichts",
    );
  });

  it("lädt wieder, wenn das erste Nachladen zu lange ausbleibt", () => {
    assert.equal(
      entscheiden({
        ...grund,
        angestossen: { stand: "neu", seit: JETZT - NEU_LADEN_GEDULD_MS },
      }),
      "neu-laden",
    );
  });

  it("lädt für einen anderen Stand trotz Anstoß", () => {
    assert.equal(
      entscheiden({ ...grund, angestossen: { stand: "dazwischen", seit: JETZT - 1000 } }),
      "neu-laden",
    );
  });
});

describe("beimKnopf", () => {
  it("lädt nach, wenn seit dem Hinweis nichts getippt wurde", () => {
    assert.equal(beimKnopf("keine"), "neu-laden");
    assert.equal(beimKnopf("fokus"), "neu-laden");
    // Der Druck auf den Knopf ist selbst eine Berührung.
    assert.equal(beimKnopf("beruehrt"), "neu-laden");
  });

  it("macht aus dem Knopf den Hinweis, wenn inzwischen getippt wurde", () => {
    assert.equal(
      beimKnopf(sperreAus({ aufnahme: false, ungespeichert: true, fokus: false })),
      "hinweis",
    );
  });

  it("lädt während einer Aufnahme nicht nach", () => {
    assert.equal(
      beimKnopf(sperreAus({ aufnahme: true, ungespeichert: true, fokus: false })),
      "nichts",
    );
  });
});

describe("antwortLesen", () => {
  it("nimmt einen Stand an", () => {
    assert.deepEqual(antwortLesen({ stand: "a", inArbeit: true }), {
      stand: "a",
      inArbeit: true,
    });
  });

  it("lässt überzählige Felder weg", () => {
    assert.deepEqual(antwortLesen({ stand: "a", inArbeit: false, ok: true }), {
      stand: "a",
      inArbeit: false,
    });
  });

  it("weist alles andere ab", () => {
    for (const wert of [
      null,
      [],
      "x",
      { stand: 1, inArbeit: true },
      { stand: "a" },
      { stand: "a", inArbeit: "ja" },
      { ok: false, error: "Nicht angemeldet." },
    ]) {
      assert.equal(antwortLesen(wert), null, JSON.stringify(wert));
    }
  });
});
