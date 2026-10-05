import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IservFehler } from "@/lib/iserv/client";
import {
  AUFGABEN_FEED,
  EVENTSOURCES,
  FEIERTAGE_FEED,
  iservTermin,
  klassenFeed,
  LANGER_TITEL,
  oeffentlicherFeed,
  OEFFENTLICH_ROH,
  ORIGIN,
  QUELLE_ABO,
  QUELLE_AUFGABEN,
  QUELLE_FREMDER_HOST,
  QUELLE_KLASSE,
  QUELLE_KLASSE_11,
  QUELLE_KLAUSURPLAN,
  QUELLE_OEFFENTLICH,
  QUELLE_ZWEITE_GRUPPE,
  QUELLE_ZWEITE_KLASSE_10,
} from "@/lib/iserv/fixtures";
import {
  klassenProblem,
  klasseVeraltet,
  parseAufgabenFeed,
  parseEventSources,
  parseKalenderFeed,
} from "@/lib/iserv/parse";
import { leseQuellen } from "@/lib/iserv/report";

const CFG = { klasse: 10, klassenkalender: null };

function wirft(lauf: () => unknown, art: string) {
  assert.throws(lauf, (fehler: unknown) => fehler instanceof IservFehler && fehler.art === art);
}

describe("parseEventSources", () => {
  it("erkennt die vier Quellen wie beim Schüler", () => {
    const { quellen, hinweise, problem } = parseEventSources(EVENTSOURCES, ORIGIN, CFG);

    assert.equal(problem, null);
    assert.deepEqual(
      quellen.map((q) => [q.id, q.rolle]),
      [
        ["/arbeitsmaterial.10/calendar", "klasse"],
        ["/+public/calendar", "oeffentlich"],
        ["exercise", "aufgaben"],
        ["holiday", "feiertage"],
      ],
    );
    assert.deepEqual(hinweise, []);
    assert.equal(quellen[1].url, `${ORIGIN}/iserv/calendar/feed/calendar?cal=/%2Bpublic/calendar`);
    assert.equal(quellen[2].url, `${ORIGIN}/iserv/calendar4/plugin?plugin=exercise`);
    assert.equal(quellen[3].url, null, "Feiertage werden nicht geholt");
    assert.equal(quellen[0].label, "Arbeitsmaterial_10");
  });

  it("übergeht Abos, erkennt den Klausurplan, holt ihn aber nicht", () => {
    const { quellen } = parseEventSources([...EVENTSOURCES, QUELLE_ABO, QUELLE_KLAUSURPLAN], ORIGIN, CFG);

    assert.equal(quellen.find((q) => q.id === "/abo.10/calendar")?.rolle, "abo");
    const plan = quellen.find((q) => q.id === "exam-plan");
    assert.equal(plan?.rolle, "klausurplan");
    assert.equal(plan?.url, null);
    assert.match(plan?.grund ?? "", /noch nicht übernommen/);
  });

  it("nimmt weitere Gruppenkalender nicht", () => {
    const { quellen } = parseEventSources([...EVENTSOURCES, QUELLE_ZWEITE_GRUPPE], ORIGIN, CFG);
    assert.equal(quellen.find((q) => q.id === "/chor-ag/calendar")?.rolle, "andere");
    assert.equal(quellen.find((q) => q.id === "/arbeitsmaterial.10/calendar")?.rolle, "klasse");
  });

  it("nimmt bei mehreren passenden keinen und meldet es als Problem", () => {
    const { quellen, hinweise, problem } = parseEventSources([...EVENTSOURCES, QUELLE_ZWEITE_KLASSE_10], ORIGIN, CFG);

    assert.ok(!quellen.some((q) => q.rolle === "klasse"));
    assert.equal(quellen.filter((q) => q.rolle === "mehrdeutig").length, 2);
    assert.match(hinweise[0], /\/klasse\.10b\/calendar — einen davon in ISERV_KLASSENKALENDER setzen/);
    assert.match(problem ?? "", /^Mehrere Kalender passen zu Klasse 10/);
    assert.ok(!(problem ?? "").includes("/klasse.10b"), "kein Text aus IServ im festen Satz");
  });

  it("nimmt mit ISERV_KLASSENKALENDER genau den genannten", () => {
    const { quellen, hinweise } = parseEventSources(
      [...EVENTSOURCES, QUELLE_ZWEITE_KLASSE_10],
      ORIGIN,
      { klasse: 10, klassenkalender: "/klasse.10b/calendar" },
    );

    assert.deepEqual(quellen.filter((q) => q.rolle === "klasse").map((q) => q.id), ["/klasse.10b/calendar"]);
    assert.deepEqual(hinweise, []);

    const fehlt = parseEventSources(EVENTSOURCES, ORIGIN, { klasse: 10, klassenkalender: "/gibt.es.nicht/calendar" });
    assert.ok(!fehlt.quellen.some((q) => q.rolle === "klasse"));
    assert.match(fehlt.hinweise[0], /steht nicht in der Liste/);
    assert.match(fehlt.problem ?? "", /^Den Kalender aus ISERV_KLASSENKALENDER gibt es in IServ nicht/);
  });

  it("sagt „kein Klassenkalender“ nur als Hinweis — es gibt Schulen ohne", () => {
    const ohne = parseEventSources([QUELLE_OEFFENTLICH, QUELLE_AUFGABEN], ORIGIN, CFG);
    assert.deepEqual(ohne.hinweise, ["Kein Klassenkalender für Klasse 10 gefunden."]);
    assert.equal(ohne.problem, null);
  });

  it("erkennt beim Schuljahreswechsel die veraltete Klasse — als Problem, nicht als Hinweis", () => {
    const neu = parseEventSources([QUELLE_KLASSE_11, QUELLE_OEFFENTLICH], ORIGIN, CFG);

    assert.equal(neu.quellen[0].rolle, "naechste-klasse");
    assert.equal(neu.quellen[0].url, null, "der Kalender der nächsten Klasse wird nicht gelesen");
    assert.match(neu.quellen[0].grund, /Klasse 11 — neues Schuljahr\? ISERV_KLASSE anheben/);
    assert.match(neu.problem ?? "", /^ISERV_KLASSE=10 ist womöglich vom letzten Schuljahr/);
    assert.deepEqual(neu.hinweise, []);

    // Mit ISERV_KLASSE=11 passt er.
    const elf = parseEventSources([QUELLE_KLASSE_11, QUELLE_OEFFENTLICH], ORIGIN, { klasse: 11, klassenkalender: null });
    assert.equal(elf.quellen[0].rolle, "klasse");
    assert.equal(elf.problem, null);
  });

  it("prüft Origin und Pfad der Feed-Adressen", () => {
    wirft(() => parseEventSources([QUELLE_KLASSE, QUELLE_FREMDER_HOST], ORIGIN, CFG), "fremde-adresse");
    wirft(
      () => parseEventSources([{ ...QUELLE_OEFFENTLICH, url: "/iserv/etwas/anderes?cal=x" }], ORIGIN, CFG),
      "format",
    );
    wirft(
      () => parseEventSources([QUELLE_OEFFENTLICH, { ...QUELLE_AUFGABEN, url: "/iserv/exercise" }], ORIGIN, CFG),
      "format",
    );
    // Beide Plugin-Pfade, die es je nach Version gibt.
    const alt = parseEventSources(
      [QUELLE_OEFFENTLICH, { ...QUELLE_AUFGABEN, url: "/iserv/calendar/feed/plugin?plugin=exercise" }],
      ORIGIN,
      CFG,
    );
    assert.equal(alt.quellen[1].rolle, "aufgaben");
  });

  it("wirft „format“ ohne öffentlichen Kalender oder bei kaputter Liste", () => {
    wirft(() => parseEventSources([QUELLE_KLASSE, QUELLE_AUFGABEN], ORIGIN, CFG), "format");
    wirft(() => parseEventSources({ eventSources: [] }, ORIGIN, CFG), "format");
    wirft(() => parseEventSources([{ id: 1, url: "/x", type: "cal" }], ORIGIN, CFG), "format");
    wirft(() => parseEventSources(Array.from({ length: 51 }, () => QUELLE_OEFFENTLICH), ORIGIN, CFG), "format");
  });
});

describe("klasseVeraltet und klassenProblem", () => {
  const neu = parseEventSources([QUELLE_KLASSE_11, QUELLE_OEFFENTLICH], ORIGIN, CFG).quellen;
  // So, wie die Liste in `sources_json` steht und wieder herauskommt.
  const gespeichert = leseQuellen(JSON.stringify(neu.map((q) => ({ ...q, url: q.url ? new URL(q.url).pathname : null }))));

  it("liest auch die gespeicherte Liste — mit der Klasse von jetzt", () => {
    assert.equal(klasseVeraltet(gespeichert, 10, null), true);
    assert.equal(klasseVeraltet(gespeichert, 11, null), false, "ISERV_KLASSE angehoben: sofort wieder sicher");
    assert.equal(klasseVeraltet(gespeichert, 10, "/arbeitsmaterial.11/calendar"), false, "ein Mensch hat entschieden");
    assert.equal(klasseVeraltet(gespeichert, 13, null), false);
  });

  it("zählt Abos und den öffentlichen Kalender nicht als Klassenkalender", () => {
    const quellen = parseEventSources([QUELLE_OEFFENTLICH, { ...QUELLE_KLASSE_11, subscription: true }], ORIGIN, CFG).quellen;
    assert.equal(klasseVeraltet(quellen, 10, null), false);
  });

  it("schweigt, wenn alles passt", () => {
    const quellen = parseEventSources(EVENTSOURCES, ORIGIN, CFG).quellen;
    assert.equal(klassenProblem(quellen, CFG), null);
    assert.equal(klassenProblem([], CFG), null);
  });
});

describe("parseKalenderFeed", () => {
  const { items, unlesbar } = parseKalenderFeed(oeffentlicherFeed(), "oeffentlich", "Öffentlich");
  const nach = (titel: string) => items.find((item) => item.titel.startsWith(titel));

  it("liest alle Termine außer dem abgesagten", () => {
    assert.equal(unlesbar, 0);
    assert.equal(items.length, OEFFENTLICH_ROH.length - 1);
    assert.equal(nach("Kl. 10_Ausflug"), undefined);
  });

  it("zählt das Ende ganztägiger Termine exklusiv — auch über die Zeitumstellung", () => {
    const herbst = nach("Herbstferien");
    assert.equal(herbst?.ersterTag, "2026-10-24");
    assert.equal(herbst?.letzterTag, "2026-11-07");
    assert.equal(herbst?.ganztaegig, true);
    assert.equal(herbst?.beginn, null);

    const ostern = nach("Osterferien");
    assert.equal(ostern?.ersterTag, "2027-03-20");
    assert.equal(ostern?.letzterTag, "2027-04-04");

    const eintag = nach("3.Pädagogischer Tag");
    assert.equal(eintag?.ersterTag, "2026-11-30");
    assert.equal(eintag?.letzterTag, "2026-11-30");
  });

  it("legt Feiertage im 02:00-Stil auf den richtigen Tag", () => {
    const feiertage = parseKalenderFeed(
      FEIERTAGE_FEED.map((f, i) => ({ ...f, uid: `feiertag-${i}` })),
      "oeffentlich",
      "x",
    ).items;

    assert.deepEqual(
      feiertage.map((f) => [f.ersterTag, f.letzterTag]),
      [
        ["2026-10-03", "2026-10-03"],
        ["2026-12-25", "2026-12-25"],
      ],
    );
  });

  it("schreibt Uhrzeiten als ISO in UTC", () => {
    const termin = nach("Kl. 10_Vorstellung");
    assert.equal(termin?.ganztaegig, false);
    assert.equal(termin?.beginn, "2026-10-08T16:00:00.000Z");
    assert.equal(termin?.ende, "2026-10-08T17:30:00.000Z");
    assert.equal(termin?.ersterTag, "2026-10-08");
  });

  it("erkennt einen Punkt-Termin (11:30–11:30)", () => {
    const punkt = nach("Unterrichtsende um 11:30 Uhr");
    assert.equal(punkt?.beginn, "2026-12-17T10:30:00.000Z");
    assert.equal(punkt?.ende, punkt?.beginn);
  });

  it("baut den Schlüssel aus uid und recurrenceId", () => {
    const serie = items.filter((item) => item.titel === "Inklusionskreis");
    assert.deepEqual(
      serie.map((item) => item.fremdId),
      [
        "cal|20260610-145225-0014aa@iserv.example.test|20261020T143000Z",
        "cal|20260610-145225-0014aa@iserv.example.test|20261117T153000Z",
      ],
    );
    assert.equal(nach("Gartenkreis")?.fremdId, "cal|20260610-145225-0007aa@iserv.example.test|");
  });

  it("nimmt Ort und Beschreibung gesäubert, nie das HTML", () => {
    assert.equal(nach("SGK")?.ort, "Aula");
    assert.equal(nach("Nachschreibklausur")?.beschreibung, "Anmeldung & Material:\nbis Freitag\n\nim Sekretariat");
    assert.equal(nach("Gartenkreis")?.beschreibung, null);
    assert.equal(nach("Gartenkreis")?.ort, null);
  });

  it("lässt den Titel von 99 Zeichen + „…“ stehen", () => {
    assert.equal(LANGER_TITEL.length, 100);
    assert.equal(nach("12.Kl+13.KL")?.titel, LANGER_TITEL);
  });

  it("liest nichts aus id, hash, when, creator — zwei Abrufe ergeben dieselben Termine", () => {
    const zweiter = parseKalenderFeed(oeffentlicherFeed(2), "oeffentlich", "Öffentlich").items;

    assert.notDeepEqual(oeffentlicherFeed(1)[0].id, oeffentlicherFeed(2)[0].id);
    assert.deepEqual(zweiter, items);
    assert.ok(!JSON.stringify(items).includes("Verwaltung"), "creator steht nicht drin");
    assert.ok(!JSON.stringify(items).includes("deadbeef"), "hash steht nicht drin");
  });

  it("überspringt und zählt Unlesbares", () => {
    const feed = [
      ...oeffentlicherFeed().slice(0, 3),
      { ...iservTermin(OEFFENTLICH_ROH[0]), uid: "" },
      { ...iservTermin(OEFFENTLICH_ROH[0]), start: "kein datum" },
      { ...iservTermin(OEFFENTLICH_ROH[0]), title: "<b> </b>" },
      "kein objekt",
    ];
    const ergebnis = parseKalenderFeed(feed, "oeffentlich", "x");
    assert.equal(ergebnis.items.length, 3);
    assert.equal(ergebnis.unlesbar, 4);
  });

  it("wirft „format“, wenn ALLES unlesbar ist, bei keiner Liste und bei zu vielen", () => {
    wirft(() => parseKalenderFeed([{ title: "x" }, { uid: "y" }], "oeffentlich", "x"), "format");
    wirft(() => parseKalenderFeed({ events: [] }, "oeffentlich", "x"), "format");
    wirft(() => parseKalenderFeed(Array.from({ length: 2001 }, () => ({})), "oeffentlich", "x"), "format");
  });

  it("nimmt eine Liste nur aus Abgesagtem als leer, nicht als kaputt", () => {
    const abgesagt = parseKalenderFeed(
      [iservTermin({ ...OEFFENTLICH_ROH[0], status: "cancelled" })],
      "oeffentlich",
      "x",
    );
    assert.deepEqual(abgesagt, { items: [], unlesbar: 0 });
    assert.deepEqual(parseKalenderFeed([], "oeffentlich", "x"), { items: [], unlesbar: 0 });
  });

  it("liest den Klassenkalender mit seiner Quelle", () => {
    const klasse = parseKalenderFeed(klassenFeed(), "klasse", "Arbeitsmaterial_10").items;
    assert.ok(klasse.every((item) => item.quelle === "klasse" && item.kalender === "Arbeitsmaterial_10"));
    assert.equal(klasse.find((item) => item.titel.startsWith("Theaterprobe"))?.titel, "Theaterprobe Faust");
    // Kodiertes Markup in der Beschreibung bleibt Text — kein Link landet in Google.
    assert.equal(
      klasse.find((item) => item.titel === "Vortreffen Praktikum")?.beschreibung,
      "Bitte pünktlich . Infos: IServ-Anmeldung",
    );
  });
});

describe("parseAufgabenFeed (angenommenes Format)", () => {
  const { items, unlesbar, felder } = parseAufgabenFeed(AUFGABEN_FEED, "Aufgaben", ORIGIN);

  it("liest ganztägige Aufgaben auf den Abgabetag", () => {
    const mathe = items[0];
    assert.equal(mathe.ganztaegig, true);
    assert.equal(mathe.ersterTag, "2026-10-12");
    assert.equal(mathe.letzterTag, "2026-10-12");
    assert.equal(mathe.fremdId, "aufgabe|4711");
    assert.equal(mathe.link, "/iserv/exercise/show/4711");
  });

  it("nimmt bei Uhrzeit das Ende als Abgabe — als Punkt", () => {
    const deutsch = items[1];
    assert.equal(deutsch.ganztaegig, false);
    assert.equal(deutsch.beginn, "2026-10-20T21:59:00.000Z");
    assert.equal(deutsch.ende, null);
    assert.equal(deutsch.ersterTag, "2026-10-20");
    assert.equal(deutsch.fremdId, "aufgabe|4712", "absolute Adresse auf demselben Server");
  });

  it("nimmt ohne Ende den Anfang und ohne Adresse die id", () => {
    const bio = items[2];
    assert.equal(bio.beginn, "2026-10-15T21:59:00.000Z");
    assert.equal(bio.fremdId, "aufgabe|id:4713");
    assert.equal(bio.link, null);
  });

  it("merkt sich nur die Feldnamen, keine Werte", () => {
    assert.equal(unlesbar, 0);
    assert.deepEqual(felder, ["allDay", "displayFields", "editable", "end", "id", "plugin", "start", "title", "url"]);
  });

  it("nimmt keine show-Nummer von einem fremden Server", () => {
    const fremd = parseAufgabenFeed(
      [{ id: 9, title: "x", start: "2026-10-12T10:00:00+02:00", url: "https://fremd.example.test/iserv/exercise/show/9" }],
      "Aufgaben",
      ORIGIN,
    );
    assert.equal(fremd.items[0].fremdId, "aufgabe|id:9");
    assert.equal(fremd.items[0].link, null);
  });

  it("wirft „format“, wenn alles unlesbar ist", () => {
    wirft(() => parseAufgabenFeed([{ title: "x" }], "Aufgaben", ORIGIN), "format");
    assert.deepEqual(parseAufgabenFeed([], "Aufgaben", ORIGIN), { items: [], unlesbar: 0, felder: [] });
  });
});
