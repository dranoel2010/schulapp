import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { IservStateRow } from "@/db/schema";
import type { PushPayload } from "@/lib/push";
import { KLASSE_PUSH, runIservFetch, type AbrufDeps, type AbrufErgebnis } from "@/lib/iserv/abruf";
import { neuerSitzungsSpeicher } from "@/lib/iserv/client";
import { IservZugang, type IservConfig } from "@/lib/iserv/config";
import {
  AUFGABEN_FEED,
  EVENTSOURCES,
  fakeIserv,
  json,
  klassenFeed,
  oeffentlicherFeed,
  ORIGIN,
  QUELLE_AUFGABEN,
  QUELLE_KLASSE_11,
  QUELLE_OEFFENTLICH,
  QUELLE_ZWEITE_KLASSE_10,
  type FakeOptionen,
} from "@/lib/iserv/fixtures";
import type { Snapshot } from "@/lib/iserv/schutz";
import type { IservStore, RunInput } from "@/lib/iserv/store";
import { iservItemsSchema, type IservQuelle } from "@/lib/iserv/types";

/**
 * Ein ganzer Abruf gegen die Attrappe von IServ und einen Speicher im
 * Arbeitsspeicher — wie execute.test.ts für den Kalender. Kein Test öffnet
 * die Datenbank des Nutzers.
 */

const PASSWORT = "Ge heim&<'\"+ä%Abruf";
const BENUTZER = "test.schueler";
const USER_ID = "00000000-0000-4000-8000-0000000000aa";
/** 12:15 in Berlin */
const JETZT = new Date("2026-10-05T10:15:00Z");
const spaeter = (stunden: number) => new Date(JETZT.getTime() + stunden * 3_600_000);

/** Der Speicher im Arbeitsspeicher. Snapshots gehen als JSON hinein und durch das Schema heraus, wie in der Datenbank. */
class SpeicherStore implements IservStore {
  state: IservStateRow | null = null;
  rows = new Map<IservQuelle, { json: string; snap: Omit<Snapshot, "items"> }>();
  saves: RunInput[] = [];

  ensureState = async (userId: string) => {
    this.state ??= {
      userId,
      createdAt: new Date("2026-10-01T10:00:00Z"),
      blockedAt: null,
      blockedReason: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      failuresInRow: 0,
      lastError: null,
      lastErrorAt: null,
      lastWarning: null,
      staleNotifiedAt: null,
      sourcesJson: "[]",
      exerciseFields: null,
    };
  };

  readState = async () => (this.state ? { ...this.state } : null);

  readSnapshots = async () => {
    const map = new Map<IservQuelle, Snapshot>();
    for (const [quelle, row] of this.rows) {
      map.set(quelle, { ...row.snap, items: iservItemsSchema.parse(JSON.parse(row.json)) });
    }
    return map;
  };

  saveRun = async (_userId: string, input: RunInput) => {
    this.saves.push(input);
    for (const snap of input.snapshots) {
      const { items, ...rest } = snap;
      this.rows.set(snap.quelle, { json: JSON.stringify(items), snap: rest });
    }
    const s = this.state!;
    s.lastAttemptAt = input.attemptAt;
    s.lastWarning = input.warning;
    if (input.sourcesJson !== undefined) s.sourcesJson = input.sourcesJson;
    if (input.exerciseFields !== undefined) s.exerciseFields ??= input.exerciseFields;
    if (input.success) {
      s.lastSuccessAt = input.attemptAt;
      s.failuresInRow = 0;
      s.lastError = null;
      s.lastErrorAt = null;
    } else {
      s.failuresInRow += 1;
      s.lastError = input.error;
      s.lastErrorAt = input.attemptAt;
    }
  };

  blockIserv = async (_userId: string, reason: string, sentence: string) => {
    const s = this.state!;
    if (s.blockedAt) return false;
    s.blockedAt = new Date();
    s.blockedReason = reason;
    s.lastError = sentence;
    s.lastErrorAt = new Date();
    s.lastAttemptAt = new Date();
    s.failuresInRow += 1;
    return true;
  };

  markStaleNotified = async () => false;
}

type Aufbau = {
  fake: ReturnType<typeof fakeIserv>;
  store: SpeicherStore;
  pushes: PushPayload[];
  deps: AbrufDeps;
  lauf(jetzt?: Date, anlass?: "cron" | "hand"): Promise<AbrufErgebnis>;
};

function aufbau(optionen: Partial<FakeOptionen> = {}, passwort = PASSWORT): Aufbau {
  const fake = fakeIserv({ passwort: PASSWORT, benutzer: BENUTZER, ...optionen });
  const store = new SpeicherStore();
  const pushes: PushPayload[] = [];
  const config: IservConfig = {
    zugang: new IservZugang(ORIGIN, BENUTZER, passwort),
    klasse: 10,
    auch: [],
    nie: [],
    klassenkalender: null,
  };
  const deps: AbrufDeps = {
    config,
    store,
    freieZeiten: async () => [],
    fetch: fake.fetch,
    speicher: neuerSitzungsSpeicher(),
    push: async (_userId, payload) => {
      pushes.push(payload);
    },
  };

  return {
    fake,
    store,
    pushes,
    deps,
    lauf: (jetzt = JETZT, anlass = "cron") =>
      runIservFetch(USER_ID, { anlass, jetzt, deadline: Date.now() + 60_000 }, deps),
  };
}

// ── Das Protokoll mitschreiben ───────────────────────────────────────────────

const protokoll: string[] = [];
const echt = { info: console.info, error: console.error, log: console.log, warn: console.warn };

beforeEach(() => {
  protokoll.length = 0;
  for (const name of ["info", "error", "log", "warn"] as const) {
    console[name] = (...werte: unknown[]) => {
      protokoll.push(werte.map((w) => (typeof w === "string" ? w : JSON.stringify(w))).join(" "));
    };
  }
});

afterEach(() => {
  Object.assign(console, echt);
});

function enthaeltPasswort(text: string): boolean {
  return [
    PASSWORT,
    encodeURIComponent(PASSWORT),
    new URLSearchParams({ p: PASSWORT }).toString().slice(2),
    "Ge heim",
    "Ge%20heim",
    "Ge+heim",
    "Ge&#",
  ].some((form) => text.includes(form));
}

// ── Die Fälle ────────────────────────────────────────────────────────────────

describe("runIservFetch", () => {
  it("liest alles und schreibt drei Snapshots", async () => {
    const { store, fake, lauf } = aufbau();
    const ergebnis = await lauf();

    assert.equal(ergebnis.status, "gelesen", JSON.stringify(ergebnis));
    assert.equal(ergebnis.satz, null);
    assert.deepEqual([...store.rows.keys()].sort(), ["aufgaben", "klasse", "oeffentlich"]);
    assert.equal(store.state?.lastSuccessAt, JETZT);
    assert.equal(store.state?.failuresInRow, 0);
    assert.equal(fake.posts().length, 1);

    const quellen = JSON.parse(store.state?.sourcesJson ?? "[]") as { url: string | null }[];
    assert.equal(quellen.length, 4);
    assert.ok(quellen.every((q) => q.url === null || !q.url.includes("?")), "Feed-Adressen ohne Query");

    const snaps = await store.readSnapshots();
    assert.equal(snaps.get("oeffentlich")?.items.length, 37);
    assert.equal(snaps.get("klasse")?.items.length, 4);
    assert.equal(snaps.get("aufgaben")?.items.length, 3);
  });

  it("merkt sich die Feldnamen der Aufgaben einmal", async () => {
    let felder = AUFGABEN_FEED;
    const { store, lauf } = aufbau({
      routen: {
        "/iserv/calendar4/plugin": () => json(felder),
      },
    });

    await lauf();
    assert.equal(store.state?.exerciseFields, "allDay, displayFields, editable, end, id, plugin, start, title, url");
    assert.equal(protokoll.filter((zeile) => zeile.includes("Aufgaben-Format")).length, 1);

    felder = AUFGABEN_FEED.map((a) => ({ ...a, neuesFeld: 1 }));
    await lauf(spaeter(3));
    assert.equal(store.state?.exerciseFields, "allDay, displayFields, editable, end, id, plugin, start, title, url");
    assert.equal(protokoll.filter((zeile) => zeile.includes("Aufgaben-Format")).length, 1);
  });

  it("fragt nicht, solange es nicht fällig ist", async () => {
    const { fake, lauf } = aufbau();
    await lauf();
    const anfragen = fake.protokoll.length;

    assert.equal((await lauf(spaeter(1))).status, "nicht-faellig");
    assert.equal(fake.protokoll.length, anfragen);

    // Ein Abruf drei Stunden später nutzt die Session: vier Anfragen, keine Anmeldung.
    assert.equal((await lauf(spaeter(3))).status, "gelesen");
    assert.equal(fake.protokoll.length, anfragen + 4);
    assert.equal(fake.posts().length, 1);
  });

  it("abgelehnt → blockiert, genau eine Push; danach weder Netz noch Push", async () => {
    const { fake, store, pushes, lauf } = aufbau({ echoPasswort: true }, `${PASSWORT}-falsch`);

    const erster = await lauf();
    assert.equal(erster.status, "blockiert");
    assert.equal(store.state?.blockedReason, "abgelehnt");
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].title, "IServ: Anmeldung abgelehnt");
    assert.equal(fake.posts().length, 1);

    const anfragen = fake.protokoll.length;
    const zweiter = await lauf(spaeter(3));
    assert.equal(zweiter.status, "blockiert");
    assert.equal(fake.protokoll.length, anfragen, "kein Netz");
    assert.equal(pushes.length, 1, "keine zweite Push");
    assert.equal(store.rows.size, 0);
  });

  it("500 bei eventsources → Fehler, der alte Stand bleibt", async () => {
    let kaputt = false;
    const { store, lauf } = aufbau({
      routen: {
        "/iserv/calendar/api/eventsources": () => (kaputt ? json({ error: "x" }, 500) : json(EVENTSOURCES)),
      },
    });
    await lauf();
    const vorher = store.rows.get("oeffentlich")?.json;

    kaputt = true;
    const ergebnis = await lauf(spaeter(3));
    assert.equal(ergebnis.status, "fehler");
    assert.match(ergebnis.satz ?? "", /HTTP 500 auf \/iserv\/calendar\/api\/eventsources/);
    assert.equal(store.rows.get("oeffentlich")?.json, vorher);
    assert.equal(store.state?.failuresInRow, 1);
    assert.equal(store.state?.lastSuccessAt, JETZT);

    // Nach genau einem Fehlschlag: eine Wiederholung in der nächsten Stunde.
    kaputt = false;
    assert.equal((await lauf(spaeter(4))).status, "gelesen");
  });

  it("öffentlicher Kalender kaputt → Fehler; Klassenkalender kaputt → teilweise", async () => {
    const { store, lauf } = aufbau({
      routen: { "/iserv/calendar/feed/calendar": () => json({ error: "x" }, 503) },
    });
    const ergebnis = await lauf();
    assert.equal(ergebnis.status, "fehler");
    assert.match(ergebnis.satz ?? "", /^Öffentlicher Kalender: IServ war nicht erreichbar/);
    assert.equal(store.rows.has("oeffentlich"), false);

    const zwei = aufbau({
      routen: {
        "/iserv/calendar/feed/calendar": ({ url }) =>
          url.searchParams.get("cal") === "/+public/calendar" ? json([]) : json({ error: "x" }, 503),
      },
    });
    const teilweise = await zwei.lauf();
    assert.equal(teilweise.status, "teilweise");
    assert.match(teilweise.satz ?? "", /^Klassenkalender:/);
    assert.equal(zwei.store.state?.lastSuccessAt, JETZT);
    assert.match(zwei.store.state?.lastWarning ?? "", /Klassenkalender:/);
  });

  it("hält einen plötzlich leeren Klassenkalender zurück", async () => {
    let leer = false;
    const { store, lauf } = aufbau({
      routen: {
        "/iserv/calendar/feed/calendar": ({ url }) => {
          const cal = url.searchParams.get("cal");
          if (cal === "/+public/calendar") return json(oeffentlicherFeed());
          if (cal === "/arbeitsmaterial.10/calendar") return json(leer ? [] : klassenFeed());
          return json([], 404);
        },
      },
    });
    await lauf();

    leer = true;
    const ergebnis = await lauf(spaeter(3));
    assert.equal(ergebnis.status, "gelesen");
    assert.match(ergebnis.warnung ?? "", /Klassenkalender: 0 statt 4 Termine — alter Stand bleibt/);
    assert.equal((await store.readSnapshots()).get("klasse")?.items.length, 4);
    assert.equal((await store.readSnapshots()).get("klasse")?.ausstehend?.anzahl, 1);
  });

  it("404 auf den gerade genannten Klassenkalender → teilweise, der alte Stand bleibt", async () => {
    let weg = false;
    const { store, lauf } = aufbau({
      routen: {
        "/iserv/calendar/feed/calendar": ({ url }) => {
          const cal = url.searchParams.get("cal");
          if (cal === "/+public/calendar") return json(oeffentlicherFeed());
          if (cal === "/arbeitsmaterial.10/calendar" && !weg) return json(klassenFeed());
          return json([], 404);
        },
      },
    });
    await lauf();

    weg = true;
    const ergebnis = await lauf(spaeter(3));
    assert.equal(ergebnis.status, "teilweise");
    assert.match(ergebnis.satz ?? "", /^Klassenkalender:/);
    assert.equal((await store.readSnapshots()).get("klasse")?.items.length, 4);
  });

  it("mehrdeutiger Klassenkalender → teilweise, alter Stand bleibt, EINE Push", async () => {
    let zwei = false;
    const { store, pushes, lauf } = aufbau({
      routen: {
        "/iserv/calendar/api/eventsources": () =>
          json(zwei ? [...EVENTSOURCES, QUELLE_ZWEITE_KLASSE_10] : EVENTSOURCES),
      },
    });
    await lauf();
    assert.equal(pushes.length, 0);

    zwei = true;
    const ergebnis = await lauf(spaeter(3));
    assert.equal(ergebnis.status, "teilweise");
    assert.match(ergebnis.satz ?? "", /^Klassenkalender: Mehrere Kalender passen zu Klasse 10/);
    assert.equal((await store.readSnapshots()).get("klasse")?.items.length, 4, "nicht als leer genommen");
    assert.deepEqual(pushes, [KLASSE_PUSH]);

    // Der nächste Lauf mit demselben Problem: keine zweite Push, weiter laut.
    assert.equal((await lauf(spaeter(6))).status, "teilweise");
    assert.equal(pushes.length, 1);
    assert.equal((await store.readSnapshots()).get("klasse")?.items.length, 4);
  });

  it("veraltete ISERV_KLASSE → teilweise, eine Push, und die Rolle steht in sources_json", async () => {
    const { store, pushes, lauf } = aufbau({
      routen: {
        "/iserv/calendar/api/eventsources": () => json([QUELLE_KLASSE_11, QUELLE_OEFFENTLICH, QUELLE_AUFGABEN]),
      },
    });

    const ergebnis = await lauf();
    assert.equal(ergebnis.status, "teilweise");
    assert.match(ergebnis.satz ?? "", /ISERV_KLASSE=10 ist womöglich vom letzten Schuljahr/);
    assert.deepEqual(pushes, [KLASSE_PUSH]);
    assert.ok(!JSON.stringify(ergebnis).includes("arbeitsmaterial"), "kein Text aus IServ im Satz");

    const quellen = JSON.parse(store.state?.sourcesJson ?? "[]") as { id: string; rolle: string }[];
    assert.equal(quellen.find((q) => q.id === "/arbeitsmaterial.11/calendar")?.rolle, "naechste-klasse");
    assert.equal(store.rows.has("klasse"), false, "der Kalender der 11 wird nicht gelesen");
  });

  it("hält einen Klassenkalender mit wenigen Terminen zurück, wenn er leer kommt", async () => {
    let leer = false;
    const { store, lauf } = aufbau({
      routen: {
        "/iserv/calendar/feed/calendar": ({ url }) => {
          const cal = url.searchParams.get("cal");
          if (cal === "/+public/calendar") return json(oeffentlicherFeed());
          if (cal === "/arbeitsmaterial.10/calendar") return json(leer ? [] : klassenFeed().slice(0, 2));
          return json([], 404);
        },
      },
    });
    await lauf();
    assert.equal((await store.readSnapshots()).get("klasse")?.items.length, 2);

    leer = true;
    const ergebnis = await lauf(spaeter(3));
    assert.match(ergebnis.warnung ?? "", /Klassenkalender: 0 statt 2 Termine — alter Stand bleibt/);
    assert.equal((await store.readSnapshots()).get("klasse")?.items.length, 2);
  });

  it("zwei gleichzeitige Aufrufe teilen sich einen Lauf", async () => {
    const { fake, lauf } = aufbau();
    const [a, b] = await Promise.all([lauf(), lauf()]);

    assert.deepEqual(a, b);
    assert.equal(fake.posts().length, 1);
    assert.equal(fake.protokoll.filter((x) => x.pfad === "/iserv/calendar/api/eventsources").length, 1);
  });

  it("„Erneut versuchen“ ist immer fällig", async () => {
    const { lauf } = aufbau();
    await lauf();
    assert.equal((await lauf(spaeter(0.5), "hand")).status, "gelesen");
  });

  it("lässt das Passwort nirgends liegen: Protokoll, Fehler, Ergebnis, Push, Datenbank", async () => {
    const ergebnisse: AbrufErgebnis[] = [];
    const gut = aufbau();
    ergebnisse.push(await gut.lauf());
    const schlecht = aufbau({ echoPasswort: true }, `${PASSWORT}x`);
    ergebnisse.push(await schlecht.lauf());
    const kaputt = aufbau({ routen: { "/iserv/calendar/api/eventsources": () => json({}, 500) } });
    ergebnisse.push(await kaputt.lauf());

    const alles = [
      ...protokoll,
      JSON.stringify(ergebnisse),
      JSON.stringify([gut.pushes, schlecht.pushes, kaputt.pushes]),
      JSON.stringify([gut.store.state, schlecht.store.state, kaputt.store.state]),
      JSON.stringify([...gut.store.rows.values(), ...schlecht.store.rows.values()]),
      JSON.stringify([gut.store.saves, schlecht.store.saves, kaputt.store.saves]),
      JSON.stringify(gut.deps.config),
    ].join("\n");

    assert.ok(alles.length > 1000);
    assert.ok(!enthaeltPasswort(alles), "das Passwort steht irgendwo");
    assert.ok(!alles.includes(BENUTZER), "der Benutzer steht irgendwo");
    assert.ok(!/code=c-456|state=s-123/.test(alles), "eine Adresse mit Query steht irgendwo");
  });
});
