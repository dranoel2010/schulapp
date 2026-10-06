import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eventHash, eventIdFor, ISERV_FOOTER, iservIdentity } from "@/lib/calendar/events";
import { planSync, type EventRow } from "@/lib/calendar/plan";
import { iservAuswahl, vonFreienTagenGedeckt } from "@/lib/iserv/auswahl";
import { AUFGABEN_FEED, klassenFeed, oeffentlicherFeed, ORIGIN } from "@/lib/iserv/fixtures";
import type { FilterConfig } from "@/lib/iserv/klasse";
import { parseAufgabenFeed, parseKalenderFeed } from "@/lib/iserv/parse";
import type { IservItem } from "@/lib/iserv/types";

const APP = "https://schulapp.example.test";
const FILTER: FilterConfig = { klasse: 10, auch: [], nie: [] };

const oeffentlich = (abruf = 1) => parseKalenderFeed(oeffentlicherFeed(abruf), "oeffentlich", "Öffentlich").items;
const klasse = (abruf = 1) => parseKalenderFeed(klassenFeed(abruf), "klasse", "Arbeitsmaterial_10").items;
const aufgaben = () => parseAufgabenFeed(AUFGABEN_FEED, "Aufgaben", ORIGIN).items;

function auswahl(items: IservItem[], freieZeiten: { startsOn: string; endsOn: string }[] = [], filter = FILTER) {
  return iservAuswahl({ items, filter, freieZeiten, iservOrigin: ORIGIN, appOrigin: APP });
}

const wunsch = (a: ReturnType<typeof auswahl>, teil: string) =>
  a.wuensche.find((w) => w.body.summary.includes(teil));

describe("iservAuswahl — was hineinkommt", () => {
  it("nimmt den Klassenkalender ganz", () => {
    const a = auswahl(klasse());
    assert.equal(a.genommen.length, 4);
    assert.ok(a.genommen.every((e) => e.regel === "klassenkalender"));
    assert.equal(a.wuensche.length, 4);
  });

  it("nimmt die Aufgaben ganz", () => {
    const a = auswahl(aufgaben());
    assert.equal(a.wuensche.length, 3);
    assert.ok(a.genommen.every((e) => e.regel === "aufgabe"));
  });

  it("filtert den öffentlichen Kalender nach Klasse 10", () => {
    const a = auswahl(oeffentlich());

    assert.equal(a.genommen.length, 13);
    assert.equal(a.knapp.length, 2);
    assert.equal(a.zweifel.length, 7);
    assert.equal(a.ausgeschlossen, 17);
    assert.deepEqual(
      a.knapp.map((e) => e.titel.slice(0, 12)).sort(),
      ["Brückentag_S", "Elternsprech"],
    );
    assert.ok(a.zweifel.some((e) => e.titel === "EA 10.Kl"));
    assert.ok(!a.genommen.some((e) => /Gartenkreis|LF\/gf|Hort_|EA 6/.test(e.titel)));
  });

  it("nimmt ein Doppel nur einmal — der Klassenkalender gewinnt", () => {
    const a = auswahl([...oeffentlich(), ...klasse(), ...aufgaben()]);
    const keys = a.wuensche.map((w) => w.key);

    assert.equal(a.doppelt, 1);
    assert.equal(new Set(keys).size, keys.length);
    const praesentation = a.genommen.filter((e) => e.titel === "Kl. 10_Vorstellung der Praktikumsberichte");
    assert.equal(praesentation.length, 1);
    assert.equal(praesentation[0].quelle, "klasse");
  });
});

describe("iservAuswahl — freie Tage", () => {
  const HERBST_APP = [{ startsOn: "2026-10-26", endsOn: "2026-11-06" }];

  it("lässt die Herbstferien aus, wenn die App Mo–Fr schon als frei kennt", () => {
    const a = auswahl(oeffentlich(), HERBST_APP);

    assert.equal(wunsch(a, "Herbstferien"), undefined);
    assert.deepEqual(a.ausgelassenFrei.map((e) => e.titel.slice(0, 12)), ["Herbstferien"]);
    // Die Pädagogischen Tage davor liegen nicht in den freien Tagen.
    assert.ok(wunsch(a, "Pädagogischer Tag, Tag 1 von 2"));
  });

  it("lässt sie stehen, wenn ein Werktag offen ist", () => {
    const a = auswahl(oeffentlich(), [{ startsOn: "2026-10-26", endsOn: "2026-11-05" }]);
    assert.ok(wunsch(a, "Herbstferien"));
  });

  it("prüft bei einem Wochenend-Termin alle seine Tage", () => {
    assert.ok(vonFreienTagenGedeckt("2026-10-31", "2026-11-01", HERBST_APP));
    assert.ok(!vonFreienTagenGedeckt("2026-11-07", "2026-11-08", HERBST_APP));
    assert.ok(vonFreienTagenGedeckt("2026-10-24", "2026-11-07", HERBST_APP), "Sa bis Sa, Werktage gedeckt");
    assert.ok(!vonFreienTagenGedeckt("2026-10-24", "2026-11-07", []));
  });

  it("lässt Termine mit Uhrzeit, Schulsamstage und Aufgaben nie wegen freier Tage aus", () => {
    const frei = [{ startsOn: "2026-10-01", endsOn: "2026-12-31" }];
    const a = auswahl([...oeffentlich(), ...aufgaben()], frei);

    assert.ok(wunsch(a, "Adventsbasar, Schulsamstag"), "mit Uhrzeit");
    assert.ok(wunsch(a, "Unterrichtsende um 11:30 Uhr"), "Punkt-Termin");
    assert.equal(a.wuensche.filter((w) => w.body.summary.startsWith("Abgabe ")).length, 3);
    assert.equal(wunsch(a, "3. Pädagogischer Tag"), undefined, "ganztägig, frei und gedeckt");
  });

  it("lässt den Klassenkalender ganz — auch eine Abgabe am Ferientag", () => {
    // „Epochenheft Geschichte abgeben“ steht ganztägig am Fr, 30.10. — mitten in
    // den Herbstferien, die die App kennt. Das ist ein Termin, keine Ferien.
    const a = auswahl([...klasse(), ...oeffentlich()], HERBST_APP);

    assert.ok(wunsch(a, "Epochenheft Geschichte abgeben"));
    assert.equal(a.genommen.filter((e) => e.quelle === "klasse").length, 4);
    assert.deepEqual(a.ausgelassenFrei.map((e) => e.quelle), ["oeffentlich"]);
  });

  it("lässt einen ganztägigen Termin der eigenen Klasse stehen, der keine Ferien ist", () => {
    const [vermessung] = oeffentlich().filter((item) => item.titel.startsWith("10.Kl_Vermessung"));
    const a = auswahl([vermessung], [{ startsOn: "2026-09-14", endsOn: "2026-09-25" }]);

    assert.equal(a.genommen.length, 1, "eine Fahrt der Klasse ist kein Doppel der freien Tage");
    assert.equal(a.ausgelassenFrei.length, 0);
    // Zwölf Tage, zwölf Termine — je Tag einer, mit eigenem Schlüssel; Tag 1
    // behält den des ungeteilten Termins.
    assert.equal(a.wuensche.length, 12);
    const keys = a.wuensche.map((w) => w.key);
    assert.equal(new Set(keys).size, 12);
    assert.equal(keys[0], iservIdentity(vermessung.fremdId).key);
    assert.equal(keys[11], iservIdentity(vermessung.fremdId, 12).key);
  });
});

describe("iservAuswahl — die Termine für Google", () => {
  const a = auswahl([...oeffentlich(), ...klasse(), ...aufgaben()]);

  it("baut Schlüssel und Event-ID aus der fremdId", () => {
    for (const w of a.wuensche) {
      assert.equal(w.kind, "iserv");
      assert.match(w.key, /^iserv-[0-9a-f]{32}$/);
      assert.match(w.idBase, /^sai[0-9a-f]{32}$/);
      assert.match(eventIdFor(w.idBase, 0), /^[0-9a-v]{5,1024}$/);
      assert.equal(w.body.extendedProperties.private.schulapp, w.key);
    }
  });

  it("färbt Pfau, ohne Präfix und ohne „_“, erinnert nicht", () => {
    for (const w of a.wuensche) {
      assert.equal(w.body.colorId, "7");
      assert.ok(!w.body.summary.startsWith("IServ"), w.body.summary);
      assert.ok(!w.body.summary.includes("_"), w.body.summary);
      assert.deepEqual(w.body.reminders, { useDefault: false, overrides: [] });
      assert.equal(w.body.transparency, "transparent");
    }
  });

  it("schreibt ganztägige Termine mit exklusivem Ende", () => {
    const herbst = wunsch(a, "Herbstferien");
    assert.deepEqual(herbst?.body.start, { date: "2026-10-24" });
    assert.deepEqual(herbst?.body.end, { date: "2026-11-08" });
    assert.equal(herbst?.body.summary, "Herbstferien");
  });

  it("schreibt Termine mit Beginn und Ende mit Uhrzeit", () => {
    const termin = wunsch(a, "Vorstellung der Praktikumsberichte");
    assert.deepEqual(termin?.body.start, { dateTime: "2026-10-08T16:00:00.000Z", timeZone: "Europe/Berlin" });
    assert.deepEqual(termin?.body.end, { dateTime: "2026-10-08T17:30:00.000Z", timeZone: "Europe/Berlin" });
    assert.equal(termin?.body.summary, "Vorstellung der Praktikumsberichte");
  });

  it("macht einen Punkt-Termin ganztägig, mit der Uhrzeit im Titel", () => {
    const punkt = wunsch(a, "Unterrichtsende um 11:30 Uhr");
    assert.equal(punkt?.body.summary, "Unterrichtsende um 11:30 Uhr");
    assert.deepEqual(punkt?.body.start, { date: "2026-12-17" });
    assert.deepEqual(punkt?.body.end, { date: "2026-12-18" });
  });

  it("schreibt Aufgaben mit Abgabezeit in den Titel", () => {
    assert.equal(wunsch(a, "Erörterung")?.body.summary, "Abgabe Deutsch: Erörterung bis 23:59 Uhr");
    assert.deepEqual(wunsch(a, "Erörterung")?.body.start, { date: "2026-10-20" });
    assert.equal(wunsch(a, "Funktionen")?.body.summary, "Abgabe Mathe: Arbeitsblatt Funktionen");
    assert.match(wunsch(a, "Funktionen")?.body.description ?? "", /In IServ: https:\/\/iserv\.example\.test\/iserv\/exercise\/show\/4711/);
  });

  it("nimmt den Ort, und kein Tag gerät in die Beschreibung", () => {
    const nach = wunsch(a, "Nachschreibklausur");
    assert.equal(nach?.body.location, "Raum 21");
    assert.equal(wunsch(a, "Herbstferien")?.body.location, undefined);

    for (const w of a.wuensche) {
      assert.ok(w.body.description.startsWith("Titel in IServ: „"), w.body.description);
      assert.ok(!/[<>]/.test(w.body.description), w.body.description);
      assert.ok(w.body.description.endsWith(ISERV_FOOTER));
      assert.ok(w.body.description.includes(`${APP}/einstellungen#iserv`));
    }
    assert.match(nach?.body.description ?? "", /Aus IServ, Kalender „Öffentlich“/);
  });

  it("teilt den Pädagogischen Tag in zwei Termine, frei", () => {
    assert.deepEqual(
      a.wuensche.filter((w) => w.body.summary.startsWith("Pädagogischer Tag")).map((w) => [w.firstDay, w.body.summary]),
      [
        ["2026-10-22", "Pädagogischer Tag, Tag 1 von 2, frei"],
        ["2026-10-23", "Pädagogischer Tag, Tag 2 von 2, frei"],
      ],
    );
    assert.ok(wunsch(a, "Adventsbasar, Schulsamstag"));
    assert.equal(wunsch(a, "3. Pädagogischer Tag")?.body.summary, "3. Pädagogischer Tag, frei");
  });

  it("nennt den Titel in Google bei genommenen, bei den anderen nicht", () => {
    const b = auswahl([...oeffentlich(), ...klasse(), ...aufgaben()]);

    assert.ok(b.genommen.every((e) => typeof e.kalenderTitel === "string" && e.kalenderTitel.length > 0));
    assert.ok(b.zweifel.length > 0 && b.zweifel.every((e) => e.kalenderTitel === null));
    const paed = b.genommen.find((e) => e.titel.startsWith("1. + 2. Pädagogischer Tag"));
    assert.equal(paed?.kalenderTitel, "Pädagogischer Tag, frei");
    assert.equal(paed?.tag, "2026-10-22");
    assert.equal(paed?.bisTag, "2026-10-23");
  });

  it("sortiert nach Tag, dann Schlüssel", () => {
    const tage = a.wuensche.map((w) => `${w.firstDay}|${w.key}`);
    assert.deepEqual(tage, [...tage].sort());
  });

  it("ändert den Hash nicht, wenn IServ nur id, hash und when neu würfelt", () => {
    const zweiter = auswahl([...oeffentlich(2), ...klasse(2), ...aufgaben()]);
    assert.deepEqual(
      zweiter.wuensche.map((w) => eventHash(w.body)),
      a.wuensche.map((w) => eventHash(w.body)),
    );
  });
});

describe("iservAuswahl — der Übergang vom Balken zu Tages-Terminen", () => {
  const [paed] = oeffentlich().filter((item) => item.titel.startsWith("1. + 2. Pädagogischer Tag"));
  const neu = auswahl([paed]).wuensche;
  const alt = iservIdentity(paed.fremdId);
  const balken: EventRow = {
    key: alt.key,
    kind: "iserv",
    eventId: eventIdFor(alt.idBase, 0),
    generation: 0,
    hash: "hash-des-alten-balkens",
    state: "geliefert",
    title: "IServ: Pädagogischer Tag (vor dem 6.10.2026)",
  };
  const ALLE = new Set(["iserv"]);

  /** Die Zeilen, wie sie nach einem gelungenen Lauf in der Datenbank stehen. */
  const zeilenNach = (steps: ReturnType<typeof planSync>["steps"]): EventRow[] =>
    steps
      .filter((s) => s.op !== "loeschen")
      .map((s): EventRow => ({
        key: s.key,
        kind: s.kind,
        eventId: s.eventId,
        generation: s.generation,
        hash: s.hash,
        state: "geliefert",
        title: s.title,
      }));

  it("macht aus dem alten Balken Tag 1 und legt Tag 2 an — ohne Doppel", () => {
    const plan = planSync({ wanted: neu, complete: ALLE, rows: [balken], today: "2026-10-06" });

    assert.deepEqual(
      plan.steps.map((s) => [s.op, s.key]),
      [
        ["aendern", alt.key],
        ["anlegen", iservIdentity(paed.fremdId, 2).key],
      ],
    );
    const [tag1] = plan.steps;
    assert.equal(tag1.eventId, balken.eventId, "derselbe Termin in Google");
    assert.ok(tag1.op === "aendern");
    assert.deepEqual([tag1.body.start, tag1.body.end], [{ date: "2026-10-22" }, { date: "2026-10-23" }]);
  });

  it("hat beim zweiten Lauf nichts mehr zu tun", () => {
    const erster = planSync({ wanted: neu, complete: ALLE, rows: [balken], today: "2026-10-06" });
    const zweiter = planSync({ wanted: neu, complete: ALLE, rows: zeilenNach(erster.steps), today: "2026-10-06" });

    assert.equal(zweiter.steps.length, 0);
    assert.equal(zweiter.unveraendert, 2);
  });

  it("holt einen Tag, den der Nutzer gelöscht hat, nicht zurück — auch nicht, wenn IServ die Tage verschiebt", () => {
    const zeilen = zeilenNach(planSync({ wanted: neu, complete: ALLE, rows: [balken], today: "2026-10-06" }).steps);
    const geloescht = zeilen.map((z): EventRow => ({ ...z, state: "verworfen" }));
    const verschoben = auswahl([{ ...paed, ersterTag: "2026-11-05", letzterTag: "2026-11-06" }]).wuensche;

    const plan = planSync({ wanted: verschoben, complete: ALLE, rows: geloescht, today: "2026-10-06" });

    assert.equal(plan.steps.length, 0);
    assert.equal(plan.verworfenBekannt, 2);
  });
});

describe("iservAuswahl — eingefrorene Termine", () => {
  it("beurteilt `fest` nicht neu", () => {
    const [gartenkreis] = oeffentlich().filter((item) => item.titel === "Gartenkreis");
    const [feld] = oeffentlich().filter((item) => item.titel.startsWith("10.Kl_Vermessung"));

    const a = auswahl([
      { ...gartenkreis, fest: { genommen: true, regel: "alle-unterricht" } },
      { ...feld, fest: { genommen: false, regel: "nie" } },
    ]);

    assert.deepEqual(a.genommen.map((e) => e.titel), ["Gartenkreis"]);
    assert.equal(a.genommen[0].regel, "alle-unterricht");
    assert.equal(a.ausgeschlossen, 1);
  });

  it("lässt auch einen eingefrorenen Termin nicht wegen freier Tage weg", () => {
    const [herbst] = oeffentlich().filter((item) => item.titel.startsWith("Herbstferien"));
    const a = auswahl([{ ...herbst, fest: { genommen: true, regel: "alle-unterricht" } }], [
      { startsOn: "2026-10-01", endsOn: "2026-11-30" },
    ]);
    assert.equal(a.wuensche.length, 1);
  });
});
