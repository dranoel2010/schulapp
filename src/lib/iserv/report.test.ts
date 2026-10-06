import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IservStateRow } from "@/db/schema";
import { iservAuswahl } from "@/lib/iserv/auswahl";
import { readIservConfig } from "@/lib/iserv/config";
import { oeffentlicherFeed, ORIGIN } from "@/lib/iserv/fixtures";
import { parseKalenderFeed } from "@/lib/iserv/parse";
import {
  BLOCK_GRUENDE,
  BLOCK_TEXT,
  baueIservStatus,
  deriveIservState,
  iservStaleSince,
  leseQuellen,
} from "@/lib/iserv/report";
import type { Snapshot } from "@/lib/iserv/schutz";

const PASSWORT = "Ge heim-Report-42";
const OK = readIservConfig({
  ISERV_URL: ORIGIN,
  ISERV_USER: "test.schueler",
  ISERV_PASSWORD: PASSWORT,
  ISERV_KLASSE: "10",
});
const MISSING = readIservConfig({});
const JETZT = new Date("2026-10-05T12:00:00Z");

function row(overrides: Partial<IservStateRow> = {}): IservStateRow {
  return {
    userId: "u",
    createdAt: new Date("2026-10-01T10:00:00Z"),
    blockedAt: null,
    blockedReason: null,
    lastAttemptAt: new Date("2026-10-05T09:15:00Z"),
    lastSuccessAt: new Date("2026-10-05T09:15:00Z"),
    failuresInRow: 0,
    lastError: null,
    lastErrorAt: null,
    lastWarning: null,
    staleNotifiedAt: null,
    sourcesJson: "[]",
    exerciseFields: null,
    ...overrides,
  };
}

describe("deriveIservState", () => {
  it("nicht eingerichtet, sobald die Umgebung fehlt — egal, was in der Zeile steht", () => {
    const state = deriveIservState({ config: MISSING, ruhtGrund: null, row: row({ blockedAt: JETZT }) });
    assert.equal(state.kind, "nicht-eingerichtet");
    assert.ok(state.kind === "nicht-eingerichtet");
    assert.deepEqual(state.missing, ["ISERV_URL", "ISERV_USER", "ISERV_PASSWORD", "ISERV_KLASSE"]);
  });

  it("ruht ohne Google Kalender", () => {
    assert.deepEqual(deriveIservState({ config: OK, ruhtGrund: "ohne Google", row: row() }), {
      kind: "ruht",
      grund: "ohne Google",
    });
  });

  it("blockiert mit Grund und Zeitpunkt; ein unbekannter Grund wird „abgelehnt“", () => {
    assert.deepEqual(
      deriveIservState({ config: OK, ruhtGrund: null, row: row({ blockedAt: JETZT, blockedReason: "captcha" }) }),
      { kind: "blockiert", reason: "captcha", since: JETZT },
    );
    const unbekannt = deriveIservState({ config: OK, ruhtGrund: null, row: row({ blockedAt: JETZT, blockedReason: "???" }) });
    assert.ok(unbekannt.kind === "blockiert" && unbekannt.reason === "abgelehnt");
  });

  it("noch nie, ohne Zeile und ohne Versuch — sonst aktiv", () => {
    assert.equal(deriveIservState({ config: OK, ruhtGrund: null, row: null }).kind, "noch-nie");
    assert.equal(deriveIservState({ config: OK, ruhtGrund: null, row: row({ lastAttemptAt: null }) }).kind, "noch-nie");
    assert.equal(deriveIservState({ config: OK, ruhtGrund: null, row: row() }).kind, "aktiv");
  });
});

describe("Sätze", () => {
  it("haben je Grund einen Text — und keiner nennt Passwort oder Benutzer", () => {
    for (const grund of BLOCK_GRUENDE) {
      assert.ok(BLOCK_TEXT[grund].length > 20, grund);
      assert.ok(!BLOCK_TEXT[grund].includes(PASSWORT));
      assert.ok(!BLOCK_TEXT[grund].includes("test.schueler"));
    }
    assert.match(BLOCK_TEXT.abgelehnt, /--neues-passwort/);
  });

  it("die Karte zeigt nur Host und Klasse", () => {
    const status = baueIservStatus({
      config: OK,
      ruhtGrund: null,
      row: row({ lastError: "IServ war nicht erreichbar.", lastErrorAt: JETZT }),
      snapshots: new Map(),
      auswertung: null,
      heute: "2026-10-05",
      jetzt: JETZT,
      running: false,
    });

    assert.equal(status.host, "iserv.example.test");
    assert.equal(status.klasse, 10);
    const text = JSON.stringify(status);
    assert.ok(!text.includes(PASSWORT));
    assert.ok(!text.includes("test.schueler"));
  });
});

describe("iservStaleSince", () => {
  it("schweigt innerhalb eines Tages und meldet danach den letzten Erfolg", () => {
    assert.equal(iservStaleSince(row(), JETZT), null);
    const alt = new Date("2026-10-03T09:15:00Z");
    assert.equal(iservStaleSince(row({ lastSuccessAt: alt }), JETZT), alt);
    assert.equal(iservStaleSince(row({ lastSuccessAt: null }), JETZT)?.toISOString(), "2026-10-01T10:00:00.000Z");
  });
});

describe("baueIservStatus", () => {
  it("zeigt ab heute: die nächsten fünf, die Zweifel, die knappen", () => {
    const items = parseKalenderFeed(oeffentlicherFeed(), "oeffentlich", "Öffentlich").items;
    const auswertung = iservAuswahl({
      items,
      filter: { klasse: 10, auch: [], nie: [] },
      freieZeiten: [],
      iservOrigin: ORIGIN,
      appOrigin: "",
    });
    const snap: Snapshot = {
      quelle: "oeffentlich",
      remoteId: "/+public/calendar",
      label: "Öffentlich",
      items,
      fetchedAt: JETZT,
      gesehenAm: JETZT,
      ausstehend: null,
    };

    const status = baueIservStatus({
      config: OK,
      ruhtGrund: null,
      row: row({ sourcesJson: JSON.stringify([{ id: "/+public/calendar", label: "Öffentlich", typ: "cal", rolle: "oeffentlich", url: "/iserv/calendar/feed/calendar", grund: "x" }]) }),
      snapshots: new Map([["oeffentlich", snap]]),
      auswertung,
      heute: "2026-10-05",
      jetzt: JETZT,
      running: true,
    });

    assert.equal(status.naechste.length, 5);
    assert.equal(status.naechste[0].titel, "Nachschreibklausur_7. - 12. Kl_Ab");
    // Die Karte zeigt unter „Als Nächstes“, was in Google steht.
    assert.equal(status.naechste[0].kalenderTitel, "Nachschreibklausur");
    assert.ok(status.naechste.every((e) => e.bisTag >= "2026-10-05"));
    assert.ok(!status.zweifel.some((e) => e.titel === "Gartensamstag"), "Gartensamstag war am 19.9.");
    assert.ok(status.zweifel.some((e) => e.titel === "EA 10.Kl"));
    assert.equal(status.knapp.length, 2);
    assert.equal(status.counts.genommen, 13);
    assert.equal(status.zahlen.oeffentlich, items.length);
    assert.equal(status.quellen[0].rolle, "oeffentlich");
    assert.equal(status.running, true);
  });

  it("liest kaputtes sources_json als leer", () => {
    assert.deepEqual(leseQuellen("kein json"), []);
    assert.deepEqual(leseQuellen('{"a":1}'), []);
    assert.deepEqual(leseQuellen('[{"id":"x","label":"y","grund":"z","rolle":"erfunden"}]'), []);
  });
});
