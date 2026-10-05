import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  eventIdFor,
  examEvent,
  freePeriodEvent,
  homeworkEvent,
  type CalendarEventBody,
  type WantedEvent,
} from "@/lib/calendar/events";
import { executeSteps, type StepStore } from "@/lib/calendar/execute";
import {
  classifyApiError,
  GoogleApiError,
  type CalendarApi,
  type RemoteEvent,
} from "@/lib/calendar/google-api";
import { planSync, type EventRow } from "@/lib/calendar/plan";

/**
 * Der ganze Abgleich gegen eine Attrappe von Google — Plan und Ausführung,
 * Lauf für Lauf, ohne Netz und ohne Datenbank.
 *
 * Die Attrappe benimmt sich in den Punkten wie Google, auf die es ankommt:
 * Eine vorhandene ID beim Anlegen gibt 409, auch wenn der Termin gelöscht
 * oder längst ausgeräumt ist. Ein gelöschter Termin steht als `cancelled`
 * da, ein zweites Löschen gibt 410. Jede Schreibung ändert das etag, und ein
 * PUT mit altem etag gibt 412. Dazu lassen sich Fehler einspielen — auch der
 * gemeine: Google hat es getan, aber die Antwort kam nie an.
 *
 * Geprüft werden die Zusagen „nie doppelt" und „nie wiederbelebt", und dass
 * die App eine Löschung durch den Nutzer nie mit ihrer eigenen verwechselt.
 */

const CAL = "schule@group.calendar.google.com";
const ORIGIN = "https://treskownas.tail3a40b0.ts.net";
const TODAY = "2026-10-05";
const ALL = new Set(["klausur", "hausaufgabe", "frei"]);

type Kind = Parameters<typeof classifyApiError>[0];

function apiError(status: Kind): GoogleApiError {
  if (status === null) {
    return new GoogleApiError(
      classifyApiError(null, new DOMException("timeout", "TimeoutError")),
      null,
    );
  }
  return new GoogleApiError(classifyApiError(status, {}), status);
}

type Ev = { status: "confirmed" | "cancelled"; etag: number; body: CalendarEventBody; purged: boolean };
type Method = "calendarState" | "getEvent" | "insertEvent" | "updateEvent" | "deleteEvent";

/** Google im Speicher. */
class FakeGoogle implements CalendarApi {
  events = new Map<string, Ev>();
  calendarDeleted = false;
  /** Nur die Aufrufe bei Google — der Zähler für „kein einziger Aufruf". */
  calls: string[] = [];
  private etag = 0;
  private hooks: { method: Method; run: () => void }[] = [];
  private faults: { method: Method; error: GoogleApiError; afterSuccess: boolean }[] = [];

  /** `journal` teilt sich die Attrappe mit dem Speicher: was in welcher Reihenfolge geschah. */
  constructor(private journal: string[] = []) {}

  /** Beim nächsten Aufruf dieser Methode: werfen — vorher, oder nachdem Google es getan hat. */
  fail(method: Method, status: Kind, options: { afterSuccess?: boolean } = {}) {
    this.faults.push({ method, error: apiError(status), afterSuccess: options.afterSuccess ?? false });
  }

  /** Beim nächsten Aufruf dieser Methode zuerst das hier tun — etwa der Nutzer, der dazwischenfunkt. */
  before(method: Method, run: () => void) {
    this.hooks.push({ method, run });
  }

  private enter(method: Method, id = ""): { afterSuccess: GoogleApiError | null } {
    const call = id ? `${method}:${id}` : method;
    this.calls.push(call);
    this.journal.push(call);

    const hook = this.hooks.findIndex((entry) => entry.method === method);
    if (hook >= 0) this.hooks.splice(hook, 1)[0].run();

    const index = this.faults.findIndex((entry) => entry.method === method);
    if (index < 0) return { afterSuccess: null };

    const fault = this.faults.splice(index, 1)[0];
    if (!fault.afterSuccess) throw fault.error;
    return { afterSuccess: fault.error };
  }

  private bump(ev: Ev) {
    this.etag += 1;
    ev.etag = this.etag;
  }

  async createCalendar(): Promise<string> {
    this.calls.push("createCalendar");
    return CAL;
  }

  async calendarState(): Promise<"da" | "fehlt" | "kein-zugriff"> {
    this.enter("calendarState");
    return this.calendarDeleted ? "fehlt" : "da";
  }

  async getEvent(_cal: string, id: string): Promise<RemoteEvent | null> {
    this.enter("getEvent", id);
    const ev = this.events.get(id);
    if (this.calendarDeleted || !ev || ev.purged) return null;

    return { status: ev.status === "cancelled" ? "geloescht" : "aktiv", etag: `"${ev.etag}"` };
  }

  async insertEvent(_cal: string, id: string, body: CalendarEventBody) {
    const { afterSuccess } = this.enter("insertEvent", id);
    if (this.calendarDeleted) throw apiError(404);
    if (this.events.has(id)) throw apiError(409);

    const ev: Ev = { status: "confirmed", etag: 0, body, purged: false };
    this.bump(ev);
    this.events.set(id, ev);

    if (afterSuccess) throw afterSuccess;
    return { creatorEmail: "schueler@example.com" };
  }

  async updateEvent(_cal: string, id: string, body: CalendarEventBody, etag: string | null) {
    const { afterSuccess } = this.enter("updateEvent", id);
    const ev = this.events.get(id);
    if (this.calendarDeleted || !ev || ev.purged) throw apiError(404);
    if (etag !== null && etag !== `"${ev.etag}"`) throw apiError(412);
    if (ev.status === "cancelled") throw apiError(410);

    ev.body = body;
    this.bump(ev);

    if (afterSuccess) throw afterSuccess;
  }

  async deleteEvent(_cal: string, id: string): Promise<"geloescht" | "schon-weg"> {
    const { afterSuccess } = this.enter("deleteEvent", id);
    const ev = this.events.get(id);
    if (this.calendarDeleted || !ev || ev.purged || ev.status === "cancelled") {
      return "schon-weg";
    }

    ev.status = "cancelled";
    this.bump(ev);

    if (afterSuccess) throw afterSuccess;
    return "geloescht";
  }

  // ── Was der Nutzer in Google tut ──

  userDelete(id: string) {
    const ev = this.events.get(id);
    assert.ok(ev, `kein Termin ${id}`);
    ev.status = "cancelled";
    this.bump(ev);
  }

  userEdit(id: string) {
    const ev = this.events.get(id);
    assert.ok(ev, `kein Termin ${id}`);
    ev.body = { ...ev.body, summary: `${ev.body.summary} (vom Nutzer umbenannt)` };
    this.bump(ev);
  }

  /** Google räumt einen gelöschten Termin aus: GET sagt 404, die ID bleibt für das Anlegen belegt. */
  purge(id: string) {
    const ev = this.events.get(id);
    assert.ok(ev, `kein Termin ${id}`);
    ev.purged = true;
  }

  active(): string[] {
    return [...this.events.entries()]
      .filter(([, ev]) => ev.status === "confirmed" && !ev.purged)
      .map(([id]) => id)
      .sort();
  }
}

class FakeStore implements StepStore {
  rows = new Map<string, EventRow>();
  emails: string[] = [];

  constructor(private journal: string[] = []) {}

  async saveRow(row: EventRow): Promise<void> {
    this.journal.push(`saveRow:${row.key}:${row.state}`);
    this.rows.set(row.key, { ...row });
  }

  async noteCreatorEmail(email: string): Promise<void> {
    this.emails.push(email);
  }

  row(key: string): EventRow | undefined {
    return this.rows.get(key);
  }
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function hw(n: number, title = `Aufgabe ${n}`, dueDate = "2026-10-10"): WantedEvent {
  return homeworkEvent({
    homework: { id: uuid(n), title, details: null, dueDate },
    subjectName: "Mathe",
    reminderHour: 17,
    appOrigin: ORIGIN,
  });
}

function id(wish: WantedEvent, generation = 0): string {
  return eventIdFor(wish.idBase, generation);
}

let journal: string[];
let google: FakeGoogle;
let store: FakeStore;

beforeEach(() => {
  journal = [];
  google = new FakeGoogle(journal);
  store = new FakeStore(journal);
});

/** Ein Lauf: planen gegen den Speicher, abarbeiten gegen die Attrappe. */
async function sync(
  wanted: WantedEvent[],
  options: { deadline?: number; now?: () => number } = {},
) {
  const plan = planSync({
    wanted,
    complete: ALL,
    rows: [...store.rows.values()],
    today: TODAY,
  });

  return executeSteps(plan.steps, {
    api: google,
    store,
    calendarId: CAL,
    deadline: options.deadline ?? Date.now() + 600_000,
    now: options.now,
  });
}

describe("executeSteps gegen eine Attrappe von Google", () => {
  it("1. macht beim zweiten Lauf ohne Änderung keinen einzigen Aufruf", async () => {
    const wanted = [
      hw(1),
      examEvent({
        exam: { id: uuid(2), kind: "klausur", title: null, date: "2026-11-12", notes: null },
        subjectName: "Mathe",
        topics: ["Kettenregel"],
        appOrigin: ORIGIN,
      }),
      freePeriodEvent({
        period: { id: uuid(3), kind: "ferien", title: "Herbstferien", startsOn: "2026-10-19", endsOn: "2026-10-30" },
        appOrigin: ORIGIN,
      }),
    ];

    const erster = await sync(wanted);
    assert.equal(erster.neu, 3);
    assert.deepEqual(store.emails, ["schueler@example.com", "schueler@example.com", "schueler@example.com"]);

    google.calls.length = 0;
    const zweiter = await sync(wanted);

    assert.deepEqual(google.calls, []);
    assert.deepEqual(
      { ...zweiter, errors: zweiter.errors.length },
      { neu: 0, geaendert: 0, entfernt: 0, verworfen: 0, ausstehend: 0, errors: 0, stoppedBy: null },
    );
  });

  it("2. übernimmt ein Anlegen, dessen Antwort verloren ging — genau ein Termin", async () => {
    const wish = hw(1);
    google.fail("insertEvent", null, { afterSuccess: true });

    const erster = await sync([wish]);
    assert.equal(erster.stoppedBy, "voruebergehend");
    assert.equal(erster.errors.length, 1);
    assert.equal(store.row(wish.key), undefined, "ohne Antwort keine Zeile");
    assert.deepEqual(google.active(), [id(wish)], "bei Google steht er trotzdem");

    google.calls.length = 0;
    const zweiter = await sync([wish]);

    assert.deepEqual(google.calls, [
      `insertEvent:${id(wish)}`,
      `getEvent:${id(wish)}`,
      `updateEvent:${id(wish)}`,
    ]);
    assert.equal(zweiter.neu, 1);
    assert.deepEqual(google.active(), [id(wish)], "genau einer, kein Doppel");
    assert.equal(store.row(wish.key)?.state, "geliefert");
  });

  it("3. trägt nie wieder ein, was der Nutzer in Google gelöscht hat", async () => {
    await sync([hw(1)]);
    google.userDelete(id(hw(1)));

    const geaendert = await sync([hw(1, "Aufgabe 1, jetzt mit Rechenweg")]);
    assert.equal(geaendert.verworfen, 1);
    assert.equal(store.row(hw(1).key)?.state, "verworfen");
    assert.deepEqual(google.active(), []);

    google.calls.length = 0;
    await sync([hw(1, "Aufgabe 1, noch einmal anders")]);
    assert.deepEqual(google.calls, [], "eine weitere Änderung fragt Google gar nicht erst");

    await sync([]);
    assert.deepEqual(google.calls, [], "Löschen in der App auch nicht");
    assert.equal(store.row(hw(1).key)?.state, "verworfen");
  });

  it("4. Abhaken nimmt heraus, wieder öffnen legt unter neuer ID an", async () => {
    const wish = hw(1);
    await sync([wish]);

    const abhaken = await sync([]);
    assert.equal(abhaken.entfernt, 1);
    assert.equal(store.row(wish.key)?.state, "entfernt");

    const oeffnen = await sync([wish]);
    assert.equal(oeffnen.neu, 1);
    assert.equal(store.row(wish.key)?.generation, 1);
    assert.equal(store.row(wish.key)?.state, "geliefert");
    assert.deepEqual(google.active(), [id(wish, 1)]);
    assert.equal(google.events.get(id(wish, 0))?.status, "cancelled");
  });

  it("5. hält ein verlorenes Löschen nicht für eine Löschung des Nutzers", async () => {
    const wish = hw(1);
    await sync([wish]);

    google.fail("deleteEvent", null, { afterSuccess: true });
    const erster = await sync([]);
    assert.equal(erster.stoppedBy, "voruebergehend");
    assert.equal(store.row(wish.key)?.state, "entfernen");
    assert.equal(google.events.get(id(wish))?.status, "cancelled");

    const zweiter = await sync([]);
    assert.equal(zweiter.entfernt, 1);
    assert.equal(zweiter.verworfen, 0);
    assert.equal(store.row(wish.key)?.state, "entfernt", "NICHT verworfen");

    const oeffnen = await sync([wish]);
    assert.equal(oeffnen.neu, 1);
    assert.deepEqual(google.active(), [id(wish, 1)], "der Termin kommt zurück");
  });

  it("6. erkennt eine Löschung des Nutzers am ersten Löschversuch", async () => {
    const wish = hw(1);
    await sync([wish]);
    google.userDelete(id(wish));

    const loeschen = await sync([]);
    assert.equal(loeschen.verworfen, 1);
    assert.equal(store.row(wish.key)?.state, "verworfen");

    google.calls.length = 0;
    await sync([wish]);
    assert.deepEqual(google.calls, [], "wieder öffnen bleibt draußen");
    assert.deepEqual(google.active(), []);
  });

  it("7a. entfernen mit Wunsch, und der Termin steht noch: ändern", async () => {
    const wish = hw(1);
    await sync([wish]);

    google.fail("deleteEvent", 503);
    await sync([]);
    assert.equal(store.row(wish.key)?.state, "entfernen");
    assert.deepEqual(google.active(), [id(wish)]);

    const zurueck = await sync([wish]);
    assert.equal(zurueck.geaendert, 1);
    assert.equal(store.row(wish.key)?.state, "geliefert");
    assert.equal(store.row(wish.key)?.generation, 0);
    assert.deepEqual(google.active(), [id(wish)]);
  });

  it("7b. entfernen mit Wunsch, und der Termin ist weg: neu mit Generation + 1", async () => {
    const wish = hw(1);
    await sync([wish]);

    google.fail("deleteEvent", null, { afterSuccess: true });
    await sync([]);

    const zurueck = await sync([wish]);
    assert.equal(zurueck.neu, 1);
    assert.equal(zurueck.verworfen, 0);
    assert.equal(store.row(wish.key)?.generation, 1);
    assert.equal(store.row(wish.key)?.state, "geliefert");
    assert.deepEqual(google.active(), [id(wish, 1)]);
  });

  it("8a. holt nach einem 412 zwischen GET und PUT neu und schreibt", async () => {
    const wish = hw(1);
    await sync([wish]);

    google.before("updateEvent", () => google.userEdit(id(wish)));
    const changed = hw(1, "Neuer Titel");
    const lauf = await sync([changed]);

    assert.equal(lauf.geaendert, 1);
    assert.equal(lauf.errors.length, 0);
    assert.equal(google.events.get(id(wish))?.body.summary, "HA Mathe: Neuer Titel");
    assert.equal(store.row(wish.key)?.title, "HA Mathe: Neuer Titel");
  });

  it("8b. lässt den Termin nach einem zweiten 412 für den nächsten Lauf liegen", async () => {
    const wish = hw(1);
    await sync([wish]);
    const vorher = store.row(wish.key);

    google.before("updateEvent", () => google.userEdit(id(wish)));
    google.before("updateEvent", () => google.userEdit(id(wish)));
    const lauf = await sync([hw(1, "Neuer Titel")]);

    assert.equal(lauf.ausstehend, 1);
    assert.equal(lauf.errors.length, 0, "kein Fehler");
    assert.deepEqual(store.row(wish.key), vorher, "die Zeile bleibt, wie sie war");

    const naechster = await sync([hw(1, "Neuer Titel")]);
    assert.equal(naechster.geaendert, 1);
  });

  it("9a. verwirft nichts, wenn der Kalender selbst weg ist", async () => {
    await sync([hw(1), hw(2)]);
    google.calendarDeleted = true;

    const lauf = await sync([hw(1, "anders"), hw(2, "auch anders")]);

    assert.equal(lauf.stoppedBy, "kalender-weg");
    assert.equal(lauf.verworfen, 0);
    assert.equal(lauf.ausstehend, 2);
    assert.equal(store.row(hw(1).key)?.state, "geliefert");
    assert.equal(store.row(hw(2).key)?.state, "geliefert");
  });

  it("9b. verwirft bei 404, wenn der Kalender da ist — und prüft ihn nur einmal", async () => {
    await sync([hw(1), hw(2)]);
    google.userDelete(id(hw(1)));
    google.purge(id(hw(1)));
    google.userDelete(id(hw(2)));
    google.purge(id(hw(2)));

    google.calls.length = 0;
    const lauf = await sync([hw(1, "anders"), hw(2, "auch anders")]);

    assert.equal(lauf.verworfen, 2);
    assert.equal(google.calls.filter((call) => call === "calendarState").length, 1);
  });

  it("9c. verwirft beim Löschen nichts, wenn der Kalender weg ist", async () => {
    await sync([hw(1)]);
    google.calendarDeleted = true;

    const lauf = await sync([]);

    assert.equal(lauf.stoppedBy, "kalender-weg");
    assert.equal(lauf.verworfen, 0);
    assert.equal(store.row(hw(1).key)?.state, "geliefert", "ohne DELETE auch keine Absicht");
    assert.ok(!google.calls.includes(`deleteEvent:${id(hw(1))}`));
  });

  it("10. verwirft nach 409, wenn Google den Termin schon ausgeräumt hat", async () => {
    const wish = hw(1);
    google.fail("insertEvent", null, { afterSuccess: true });
    await sync([wish]);
    google.userDelete(id(wish));
    google.purge(id(wish));

    const lauf = await sync([wish]);

    assert.equal(lauf.verworfen, 1);
    assert.equal(store.row(wish.key)?.state, "verworfen");
    assert.deepEqual(google.active(), []);
  });

  it("10b. verwirft nach 409, wenn der Termin cancelled ist", async () => {
    const wish = hw(1);
    google.fail("insertEvent", null, { afterSuccess: true });
    await sync([wish]);
    google.userDelete(id(wish));

    const lauf = await sync([wish]);

    assert.equal(lauf.verworfen, 1);
    assert.deepEqual(google.active(), []);
  });

  it("11. lässt mit abgelaufenem Budget alles liegen, ohne Fehler", async () => {
    const lauf = await sync([hw(1), hw(2), hw(3)], { deadline: Date.now() - 1 });

    assert.equal(lauf.stoppedBy, "budget");
    assert.equal(lauf.ausstehend, 3);
    assert.equal(lauf.errors.length, 0);
    assert.deepEqual(google.calls, []);
  });

  it("11b. hört auf, sobald für einen Schritt keine 20 Sekunden mehr bleiben", async () => {
    let zeit = 0;
    const lauf = await sync([hw(1, "a", "2026-10-06"), hw(2, "b", "2026-10-07"), hw(3, "c", "2026-10-08")], {
      deadline: 49_000,
      now: () => {
        const jetzt = zeit;
        zeit += 15_000;
        return jetzt;
      },
    });

    assert.equal(lauf.neu, 2);
    assert.equal(lauf.ausstehend, 1);
    assert.equal(lauf.stoppedBy, "budget");
    assert.deepEqual(google.active(), [id(hw(1)), id(hw(2))].sort(), "das Nächste zuerst");
  });

  it("12a. hört bei Drosselung auf", async () => {
    google.fail("insertEvent", 429);

    const lauf = await sync([hw(1), hw(2), hw(3)]);

    assert.equal(lauf.stoppedBy, "drosselung");
    assert.equal(lauf.errors.length, 1);
    assert.equal(lauf.errors[0].kind, "drosselung");
    assert.equal(lauf.ausstehend, 2);
    assert.equal(lauf.neu, 0);
  });

  it("12b. macht nach einem 400 mit dem nächsten Termin weiter", async () => {
    google.fail("insertEvent", 400);

    const lauf = await sync([hw(1), hw(2), hw(3)]);

    assert.equal(lauf.stoppedBy, null);
    assert.equal(lauf.errors.length, 1);
    assert.equal(lauf.errors[0].kind, "anfrage");
    assert.equal(lauf.errors[0].title, "HA Mathe: Aufgabe 1");
    assert.equal(lauf.neu, 2);
  });

  it("12c. hört auf, wenn der Zugang nicht mehr gilt", async () => {
    google.fail("insertEvent", 401);

    const lauf = await sync([hw(1), hw(2)]);

    assert.equal(lauf.stoppedBy, "token");
    assert.equal(lauf.ausstehend, 1);
  });

  it("13. lässt Klausur, Hausaufgabe und freien Tag mit derselben UUID nicht zusammenstoßen", async () => {
    const same = uuid(7);
    const wanted = [
      examEvent({
        exam: { id: same, kind: "test", title: null, date: "2026-11-12", notes: null },
        subjectName: "Mathe",
        topics: [],
        appOrigin: ORIGIN,
      }),
      homeworkEvent({
        homework: { id: same, title: "x", details: null, dueDate: "2026-10-10" },
        subjectName: "Mathe",
        reminderHour: 17,
        appOrigin: ORIGIN,
      }),
      freePeriodEvent({
        period: { id: same, kind: "frei", title: null, startsOn: "2026-10-12", endsOn: "2026-10-12" },
        appOrigin: ORIGIN,
      }),
    ];

    const lauf = await sync(wanted);

    assert.equal(lauf.neu, 3);
    assert.equal(lauf.errors.length, 0);
    assert.equal(google.active().length, 3);
    assert.equal(store.rows.size, 3);
  });

  it("14. sieht vor dem Löschen nach und schreibt dann die Absicht", async () => {
    const wish = hw(1);
    await sync([wish]);

    journal.length = 0;
    await sync([]);

    assert.deepEqual(journal, [
      `getEvent:${id(wish)}`,
      `saveRow:${wish.key}:entfernen`,
      `deleteEvent:${id(wish)}`,
      `saveRow:${wish.key}:entfernt`,
    ]);
  });

  it("15. ändert unter der gespeicherten ID mit If-Match und überschreibt, was der Nutzer geändert hat", async () => {
    const wish = hw(1);
    await sync([wish]);
    google.userEdit(id(wish));

    const lauf = await sync([hw(1, "Aus der App")]);

    assert.equal(lauf.geaendert, 1);
    assert.equal(google.events.get(id(wish))?.body.summary, "HA Mathe: Aus der App");
  });

  it("16. ein ungewisser Fehler beim Löschen lässt die Absicht für den nächsten Lauf stehen", async () => {
    const wish = hw(1);
    await sync([wish]);

    google.fail("deleteEvent", 503);
    const lauf = await sync([]);

    assert.equal(lauf.errors.length, 1);
    assert.equal(store.row(wish.key)?.state, "entfernen");

    google.calls.length = 0;
    const naechster = await sync([]);
    assert.equal(naechster.entfernt, 1);
    assert.equal(store.row(wish.key)?.state, "entfernt");
    assert.deepEqual(google.calls, [`deleteEvent:${id(wish)}`], "der zweite Versuch löscht gleich");
  });

  it("17. eine Löschung des Nutzers vor einem gescheiterten DELETE bleibt verworfen — auch nach dem Wieder-Öffnen", async () => {
    // Der Fall aus der Prüfung: Nutzer löscht in Google, die App hakt ab, und
    // der DELETE bekäme 503. Das GET davor sieht den Termin schon gelöscht.
    const wish = hw(1);
    await sync([wish]);
    google.userDelete(id(wish));
    google.fail("deleteEvent", 503);

    const abhaken = await sync([]);
    assert.equal(abhaken.verworfen, 1);
    assert.equal(abhaken.errors.length, 0);
    assert.equal(store.row(wish.key)?.state, "verworfen");
    assert.ok(!google.calls.includes(`deleteEvent:${id(wish)}`), "kein DELETE nötig");

    google.calls.length = 0;
    await sync([wish]);
    assert.deepEqual(google.calls, [], "wieder öffnen bleibt draußen");
    assert.deepEqual(google.active(), []);
  });

  it("18. ein sicher abgewiesener DELETE nimmt die Absicht zurück", async () => {
    for (const status of [429, 401, 403, 400] as const) {
      store = new FakeStore(journal);
      google = new FakeGoogle(journal);
      const wish = hw(1);
      await sync([wish]);

      google.fail("deleteEvent", status);
      const lauf = await sync([]);

      assert.equal(lauf.errors.length, 1, `bei ${status}`);
      assert.equal(store.row(wish.key)?.state, "geliefert", `bei ${status} zurück auf geliefert`);
      assert.deepEqual(google.active(), [id(wish)], "nichts gelöscht");

      // Löscht der Nutzer jetzt, merkt das der nächste Versuch als erster.
      google.userDelete(id(wish));
      const naechster = await sync([]);
      assert.equal(naechster.verworfen, 1, `bei ${status}`);

      google.calls.length = 0;
      await sync([wish]);
      assert.deepEqual(google.calls, [], `bei ${status}: wieder öffnen bleibt draußen`);
    }
  });

  it("19. ein erster DELETE, der „schon weg“ hört, nachdem das GET den Termin noch sah: der Nutzer — verworfen", async () => {
    const wish = hw(1);
    await sync([wish]);
    google.before("deleteEvent", () => google.userDelete(id(wish)));

    const lauf = await sync([]);

    assert.equal(lauf.verworfen, 1);
    assert.equal(store.row(wish.key)?.state, "verworfen");
  });
});
