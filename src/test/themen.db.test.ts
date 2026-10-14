import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { asc, eq, gte, inArray } from "drizzle-orm";

import { arbeitsblaetter, exams, freePeriods, lessons, subjectTopics, subjects } from "@/db/schema";
import { protokollieren } from "@/lib/protokoll";
import { guessEpochSubject, loadWeek } from "@/lib/timetable";
import { epochenFach } from "@/recall/source";
import { recallAttempts, recallItems, recallSchedule } from "@/recall/schema";
import { urteilFesthalten, versuchFesthalten } from "@/recall/sessions";
import {
  appTagVon,
  berlinStunde,
  faelligeThemen,
  fragenZumThema,
  istThemaSchluessel,
  leerStand,
  naechsterTerminThema,
  naechsterTerminUeberhaupt,
  themaTagesbericht,
  themaSchluessel,
  wiederholenStand,
} from "@/recall/themen";
import { whLeerText } from "@/lib/kombi/wiederholen-text";

/**
 * Wiederholen nach Themen (Plan E, Tests aus 3.4): Sortierung, Alias-Kette,
 * „ohne Thema“, angefangen zuerst, Ferien, Mitternacht, Arbeitsblätter — und
 * vor allem: eine ganze Runde ändert an den Terminen nichts außer `done_at`
 * bei „Saß“.
 */

const MO = "2026-10-12";

/**
 * Versuche tragen `created_at` und hier (ohne übergebene Uhr) `answered_at`
 * der echten Uhr; „heute“ heißt in diesen Tests aber Mo 12.10. Was nach
 * dessen App-Tag angelegt wurde, rückt auf 17 Uhr am Montag, sonst hingen
 * die Tests am Kalender.
 */
async function versucheAufMontag() {
  await testDb
    .update(recallAttempts)
    .set({ createdAt: berlinStunde(MO, 17) })
    .where(gte(recallAttempts.createdAt, berlinStunde("2026-10-13", 4)));
  await testDb
    .update(recallAttempts)
    .set({ answeredAt: berlinStunde(MO, 17) })
    .where(gte(recallAttempts.answeredAt, berlinStunde("2026-10-13", 4)));
}

async function fach(nutzer: string, name: string, short: string) {
  const [z] = await testDb.insert(subjects).values({ userId: nutzer, name, short }).returning({ id: subjects.id });
  return z.id;
}

async function thema(nutzer: string, subjectId: string, title: string, mergedInto: string | null = null) {
  const [z] = await testDb
    .insert(subjectTopics)
    .values({ userId: nutzer, subjectId, title, matchKey: title.toLowerCase(), origin: "blatt", lastSeenAt: MO, mergedInto })
    .returning({ id: subjectTopics.id });
  return z.id;
}

/** Eine Frage mit Terminen; der erste Termin ist der älteste. */
async function frage(nutzer: string, subjectId: string, topicId: string | null, termine: string[], text = "Frage") {
  const [i] = await testDb
    .insert(recallItems)
    .values({
      userId: nutzer,
      subjectId,
      subjectTopicId: topicId,
      promptFree: text,
      solution: "Lösung",
      misconception: "Verwechslung",
      sourceQuote: "Zitat",
      sourceLength: 6,
    })
    .returning({ id: recallItems.id });
  await testDb.insert(recallSchedule).values(termine.map((dueOn, k) => ({ itemId: i.id, dueOn, round: k + 1, sortOrder: k })));
  return i.id;
}

/**
 * Eine ferne Klausur im Fach: Einzelne Tests hier prüfen die Reihenfolge
 * mehrerer Themen außerhalb der Epoche. Ohne Klausur käme davon nur eins am
 * Tag (Antwort 6, eigene Tests in dauertakt.db.test.ts). Die Grundlage V2 2.5
 * (Geschichte als Epoche, Mathe mit Klausur, Französisch) braucht keine: die
 * Epoche zählt nicht zur Grenze.
 */
async function klausurSpaeter(nutzer: string, subjectId: string) {
  await testDb.insert(exams).values({ userId: nutzer, subjectId, kind: "klausur", date: "2026-12-18", title: "Später" });
}

let nutzer = "";
let ge = "";
let ma = "";
let fr = "";
let tGe = "";
let tMa = "";
let tFr = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  ge = await fach(nutzer, "Geschichte", "Ge");
  ma = await fach(nutzer, "Mathematik", "M");
  fr = await fach(nutzer, "Französisch", "F");
  tGe = await thema(nutzer, ge, "Industrialisierung in England");
  tMa = await thema(nutzer, ma, "Quadratische Funktionen");
  tFr = await thema(nutzer, fr, "Passé composé mit être");
  // Hauptunterricht: Geschichte in der ersten Stunde an allen fünf Tagen
  await testDb.insert(lessons).values([1, 2, 3, 4, 5].map((weekday) => ({ userId: nutzer, subjectId: ge, weekday, period: 1 })));
  await testDb.insert(exams).values({ userId: nutzer, subjectId: ma, kind: "klausur", date: "2026-10-16", title: "QF" });
  // V2 2.5: Geschichte seit Sa 10.10. (10 Fragen), Mathe am 12.10. mit Klausur (12), Französisch am 12.10. (8)
  for (let k = 0; k < 10; k++) await frage(nutzer, ge, tGe, ["2026-10-10", "2026-10-13"], `G${k}`);
  for (let k = 0; k < 12; k++) await frage(nutzer, ma, tMa, [MO, "2026-10-15"], `M${k}`);
  for (let k = 0; k < 8; k++) await frage(nutzer, fr, tFr, [MO, "2026-10-20"], `F${k}`);
});

describe("faelligeThemen", () => {
  it("sortiert nach ältestem Termin, dann naher Klausur, und trägt Art, Umfang und Epoche", async () => {
    const t = await faelligeThemen(nutzer, MO);
    assert.deepEqual(
      t.map((x) => x.titel),
      ["Industrialisierung in England", "Quadratische Funktionen", "Passé composé mit être"],
    );
    assert.equal(t[0].istEpoche, true);
    assert.equal(t[0].umfang, "10 Fragen");
    assert.equal(t[0].art, "abfragen");
    assert.equal(t[1].art, "ueben");
    assert.equal(t[1].umfang, "Arbeitsblatt");
    assert.equal(t[1].klausur, "2026-10-16");
    assert.equal(t[2].art, "ueben", "passé ist ein Grammatik-Stichwort");
    assert.equal(t[2].istEpoche, false);
  });

  it("bei Gleichstand: mehr fällige Fragen zuerst, dann alphabetisch", async () => {
    const n = await testNutzer("Sort");
    const a = await fach(n, "Biologie", "Bio");
    const b = await fach(n, "Chemie", "Ch");
    const ta = await thema(n, a, "Zelle");
    const tb = await thema(n, b, "Atome");
    await klausurSpaeter(n, a);
    await klausurSpaeter(n, b);
    await frage(n, a, ta, [MO]);
    await frage(n, b, tb, [MO]);
    await frage(n, b, tb, [MO]);
    assert.deepEqual((await faelligeThemen(n, MO)).map((x) => x.titel), ["Atome", "Zelle"]);
    await frage(n, a, ta, [MO]);
    // Gleich viele: alphabetisch nach Fach und Thema (Biologie vor Chemie)
    assert.deepEqual((await faelligeThemen(n, MO)).map((x) => x.titel), ["Zelle", "Atome"]);
  });

  it("folgt der Alias-Kette bis zum eigenständigen Thema", async () => {
    const n = await testNutzer("Alias");
    const f = await fach(n, "Geschichte", "Ge");
    const ziel = await thema(n, f, "Französische Revolution");
    const mitte = await thema(n, f, "Franz. Revolution", ziel);
    const alt = await thema(n, f, "Frz Revolution", mitte);
    await frage(n, f, alt, [MO]);
    await frage(n, f, ziel, [MO]);
    const t = await faelligeThemen(n, MO);
    assert.equal(t.length, 1);
    assert.equal(t[0].key, ziel);
    assert.equal(t[0].titel, "Französische Revolution");
    assert.equal(t[0].fragen, 2);
    assert.equal((await fragenZumThema(n, MO, ziel)).length, 2);
  });

  it("bündelt Fragen ohne Thema je Fach zu „ohne Thema“", async () => {
    const n = await testNutzer("Ohne");
    const f = await fach(n, "Biologie", "Bio");
    await frage(n, f, null, [MO]);
    await frage(n, f, null, [MO]);
    const t = await faelligeThemen(n, MO);
    assert.equal(t.length, 1);
    assert.equal(t[0].key, `ohne:${f}`);
    assert.equal(t[0].titel, "ohne Thema");
    assert.equal(t[0].umfang, "2 Fragen");
    assert.equal(t[0].art, "abfragen");
  });

  it("ein angefangenes Thema kommt zuerst, auch über ein gedrucktes, nicht ausgewertetes Arbeitsblatt", async () => {
    const n = await testNutzer("Angefangen");
    const a = await fach(n, "Geschichte", "Ge");
    const b = await fach(n, "Englisch", "E");
    const c = await fach(n, "Mathematik", "M");
    const ta = await thema(n, a, "Alt");
    const tb = await thema(n, b, "Vokabeln");
    const tc = await thema(n, c, "Brüche");
    for (const f of [a, b, c]) await klausurSpaeter(n, f);
    await frage(n, a, ta, ["2026-10-01"]);
    const eng = await frage(n, b, tb, [MO]);
    const s = await testDb.select().from(recallSchedule).where(inArray(recallSchedule.itemId, [eng]));
    await frage(n, b, tb, [MO]);
    await frage(n, c, tc, [MO]);
    assert.equal((await faelligeThemen(n, MO))[0].titel, "Alt");

    // ein Versuch heute (Kalendertag = App-Tag um 17 Uhr) an Englisch
    const v = await versuchFesthalten(n, { scheduleId: s[0].id, itemId: s[0].itemId, answerText: "x" }, MO);
    assert.ok(v.ok);
    await versucheAufMontag();
    let t = await faelligeThemen(n, MO);
    assert.equal(t[0].titel, "Vokabeln");
    assert.equal(t[0].angefangen, true);

    // ein gedrucktes Blatt in Mathe, heute, nicht ausgewertet
    await testDb.insert(arbeitsblaetter).values({
      userId: n,
      subjectTopicId: tc,
      tag: MO,
      status: "fertig",
      gedrucktAm: berlinStunde(MO, 16),
    });
    t = await faelligeThemen(n, MO);
    const m = t.find((x) => x.titel === "Brüche")!;
    assert.equal(m.blattAngefangen, true);
    assert.equal(m.angefangen, true);
    assert.notEqual(t[t.length - 1].titel, "Brüche");
  });

  it("ein heute gescheitertes Blatt fällt auf Karten zurück", async () => {
    const n = await testNutzer("Gescheitert");
    const f = await fach(n, "Mathematik", "M");
    const t1 = await thema(n, f, "Potenzen");
    await frage(n, f, t1, [MO]);
    assert.equal((await faelligeThemen(n, MO))[0].umfang, "Arbeitsblatt");
    await testDb.insert(arbeitsblaetter).values({ userId: n, subjectTopicId: t1, tag: MO, status: "fehlgeschlagen" });
    const t = await faelligeThemen(n, MO);
    assert.equal(t[0].art, "abfragen");
    assert.equal(t[0].umfang, "1 Frage");
  });

  it("ein ausgewertetes Übungsthema ist erst am nächsten Termin wieder dran", async () => {
    const n = await testNutzer("Ausgewertet");
    const f = await fach(n, "Mathematik", "M");
    const t1 = await thema(n, f, "Quadratische Funktionen");
    await frage(n, f, t1, [MO, "2026-10-16"]);
    await testDb.insert(arbeitsblaetter).values({
      userId: n,
      subjectTopicId: t1,
      tag: MO,
      status: "fertig",
      gedrucktAm: berlinStunde(MO, 16),
      ausgewertetAm: berlinStunde(MO, 17),
    });
    assert.equal((await faelligeThemen(n, MO)).length, 0);
    assert.equal((await faelligeThemen(n, "2026-10-13")).length, 0);
    assert.equal(await naechsterTerminThema(n, t1, "2026-10-13"), "2026-10-16");
    assert.equal((await faelligeThemen(n, "2026-10-16")).length, 1);
  });

  it("in Ferien ist die Liste leer, und der Block fehlt", async () => {
    const n = await testNutzer("Ferien");
    const f = await fach(n, "Biologie", "Bio");
    await frage(n, f, await thema(n, f, "Zelle"), [MO]);
    await testDb.insert(freePeriods).values({ userId: n, kind: "ferien", startsOn: MO, endsOn: "2026-10-23" });
    assert.deepEqual(await faelligeThemen(n, MO), []);
    assert.deepEqual(await wiederholenStand(n, MO), { kind: "ferien" });
  });

  it("filtert auf ein Fach", async () => {
    const t = await faelligeThemen(nutzer, MO, { subjectId: fr });
    assert.deepEqual(t.map((x) => x.fach), ["Französisch"]);
  });
});

describe("Termine und Stand", () => {
  it("„Wieder dran“ und „Nächstes Thema“ lesen vorhandene Termine", async () => {
    assert.equal(await naechsterTerminThema(nutzer, tGe, MO), "2026-10-13");
    assert.equal(await naechsterTerminThema(nutzer, tFr, MO), "2026-10-20");
    assert.equal(await naechsterTerminUeberhaupt(nutzer, MO), "2026-10-13");
  });

  it("der Knopf zeigt die Zahl der Themen und das erste Thema", async () => {
    assert.deepEqual(await wiederholenStand(nutzer, MO), {
      kind: "knopf",
      n: 3,
      sub: "Zuerst Geschichte · Industrialisierung in England",
    });
  });

  it("ohne Fragen: „Noch keine Fragen“", async () => {
    const n = await testNutzer("Leer");
    assert.deepEqual(await wiederholenStand(n, MO), { kind: "leer" });
  });

  it("nichts fällig: Textzeile mit dem nächsten Thema; nach einem Themenende „Für heute durch.“", async () => {
    const n = await testNutzer("Durch");
    const f = await fach(n, "Biologie", "Bio");
    await frage(n, f, await thema(n, f, "Zelle"), ["2026-10-13"]);
    assert.deepEqual(await wiederholenStand(n, MO), {
      kind: "text",
      text: "Heute ist nichts fällig. Nächstes Thema Dienstag.",
      ok: false,
    });
    await protokollieren(n, MO, "thema_beendet", "x", { n: 1 });
    assert.deepEqual(await wiederholenStand(n, MO), {
      kind: "text",
      text: "Für heute durch. Nächstes Thema Dienstag.",
      ok: true,
    });
  });
});

describe("Tisch öffnet ohne Fälliges", () => {
  it("mit Fach: „In ⟨Fach⟩ ist heute nichts fällig.“; ohne Fach der Satz des Überblicks", async () => {
    const n = await testNutzer("LeerTisch");
    const f = await fach(n, "Biologie", "Bio");
    await frage(n, f, await thema(n, f, "Zelle"), ["2026-10-13"]);
    assert.deepEqual(await faelligeThemen(n, MO, { subjectId: f }), []);

    const mitFach = await leerStand(n, MO, f);
    assert.equal(mitFach.fachName, "Biologie");
    assert.equal(
      whLeerText({ ferien: false, naechstesThema: "Dienstag", ...mitFach }),
      "In Biologie ist heute nichts fällig.",
    );

    const ohneFach = await leerStand(n, MO, null);
    assert.deepEqual(ohneFach, { fachName: null, durch: false });
    assert.equal(
      whLeerText({ ferien: false, naechstesThema: "Dienstag", ...ohneFach }),
      "Heute ist nichts fällig. Nächstes Thema Dienstag.",
    );

    // nach einem Themenende sagt der Tisch dasselbe wie der Überblick
    await protokollieren(n, MO, "thema_beendet", themaSchluessel(f, null), { n: 1 });
    const durch = await leerStand(n, MO, null);
    assert.equal(durch.durch, true);
    assert.equal(
      whLeerText({ ferien: false, naechstesThema: "Dienstag", ...durch }),
      "Für heute durch. Nächstes Thema Dienstag.",
    );
    assert.equal(
      whLeerText({ ferien: true, naechstesThema: null, ...durch }),
      "In den Ferien wird nicht wiederholt.",
    );
  });

  it("ein fremdes oder unbekanntes Fach hat keinen Namen", async () => {
    const n = await testNutzer("FremdesFach");
    assert.equal((await leerStand(n, MO, ge)).fachName, null);
    assert.equal((await leerStand(n, MO, "kein-fach")).fachName, null);
  });
});

describe("Themenschlüssel", () => {
  it("nur eine Themen-id oder „ohne:“ mit einer Fach-id", () => {
    assert.equal(istThemaSchluessel(tGe), true);
    assert.equal(istThemaSchluessel(themaSchluessel(ge, null)), true);
    for (const falsch of ["", "xyz", "ohne:", "ohne:abc", `ohne:${tGe}x`, `${tGe} `, `ohne: ${ge}`, "ohne:ohne:" + ge]) {
      assert.equal(istThemaSchluessel(falsch), false, falsch);
    }
  });

  it("ein falscher Schlüssel ergibt leere Antworten statt einer Ausnahme aus Postgres", async () => {
    assert.deepEqual(await fragenZumThema(nutzer, MO, "ohne:abc"), []);
    assert.equal(await naechsterTerminThema(nutzer, "ohne:abc", MO), null);
    assert.equal((await themaTagesbericht(nutzer, "ohne:abc", MO)).fragen, 0);
  });
});

describe("Epoche", () => {
  it("epochenFach folgt derselben Regel wie die Epoche-Seite (erste Stunde, meiste Tage)", async () => {
    const n = await testNutzer("Epoche");
    const a = await fach(n, "Deutsch", "D");
    const b = await fach(n, "Physik", "Ph");
    // Deutsch an drei Tagen in der ersten Stunde, Physik an zwei und dazu oft in der zweiten
    await testDb.insert(lessons).values([
      ...[1, 2, 3].map((weekday) => ({ userId: n, subjectId: a, weekday, period: 1 })),
      ...[4, 5].map((weekday) => ({ userId: n, subjectId: b, weekday, period: 1 })),
      ...[1, 2, 3, 4, 5].map((weekday) => ({ userId: n, subjectId: b, weekday, period: 2 })),
    ]);
    const woche = await loadWeek(n);
    const seite = guessEpochSubject(
      woche.days.flatMap((d) => d.lessons.map((l) => ({ period: l.period, subjectId: l.subject.id }))),
    );
    assert.equal(seite, a);
    assert.equal(await epochenFach(n), seite);
    assert.equal(await epochenFach(nutzer), ge);
    assert.equal(await epochenFach(await testNutzer("OhnePlan")), null);
  });
});

describe("eine ganze Runde", () => {
  it("ändert an den Terminen nichts außer done_at bei „Saß“, und das Themenende zählt richtig", async () => {
    const vorher = await testDb.select().from(recallSchedule).orderBy(asc(recallSchedule.id));
    const fragen = await fragenZumThema(nutzer, MO, tGe);
    assert.equal(fragen.length, 10);

    // Frage 1 erst daneben, dann saß; alle anderen sitzen beim ersten Mal
    const gesessen = new Set<string>();
    for (const [k, f] of fragen.entries()) {
      const v = await versuchFesthalten(nutzer, { scheduleId: f.scheduleId, itemId: f.itemId, answerText: "a" }, MO);
      assert.ok(v.ok);
      await urteilFesthalten(nutzer, v.attemptId, k !== 0);
      if (k !== 0) gesessen.add(f.scheduleId);
    }
    // Daneben kommt in derselben Runde wieder, hinten angestellt
    const nochmal = await fragenZumThema(nutzer, MO, tGe);
    assert.equal(nochmal.length, 1);
    assert.equal(nochmal[0].heuteDaneben, 1);
    const v = await versuchFesthalten(nutzer, { scheduleId: nochmal[0].scheduleId, itemId: nochmal[0].itemId, answerText: "b" }, MO);
    assert.ok(v.ok);
    await urteilFesthalten(nutzer, v.attemptId, true);
    gesessen.add(nochmal[0].scheduleId);
    await versucheAufMontag();

    const nachher = await testDb.select().from(recallSchedule).orderBy(asc(recallSchedule.id));
    assert.equal(nachher.length, vorher.length, "kein Termin dazu oder weg");
    for (const [i, a] of vorher.entries()) {
      const b = nachher[i];
      assert.deepEqual(
        { id: b.id, itemId: b.itemId, dueOn: b.dueOn, round: b.round, mode: b.mode, sortOrder: b.sortOrder },
        { id: a.id, itemId: a.itemId, dueOn: a.dueOn, round: a.round, mode: a.mode, sortOrder: a.sortOrder },
      );
      if (gesessen.has(a.id)) assert.ok(b.doneAt, "Saß setzt done_at");
      else assert.equal(b.doneAt, a.doneAt, "sonst unverändert");
    }

    const bericht = await themaTagesbericht(nutzer, tGe, MO);
    assert.equal(bericht.fragen, 10);
    assert.equal(bericht.beimErstenMal, 9);
    assert.equal((await faelligeThemen(nutzer, MO))[0].titel, "Quadratische Funktionen");
  });

  it("ein Versuch um 00:30 trägt den Kalendertag, zählt aber zum App-Tag", async () => {
    const [f] = await fragenZumThema(nutzer, MO, tFr);
    // 00:30 am Dienstag: der App-Tag ist noch Montag, geschrieben wird der Kalendertag
    const nacht = new Date("2026-10-12T22:30:00Z");
    assert.equal(appTagVon(nacht), MO);
    const v = await versuchFesthalten(nutzer, { scheduleId: f.scheduleId, itemId: f.itemId, answerText: "c" }, "2026-10-13");
    assert.ok(v.ok);
    await testDb.update(recallAttempts).set({ createdAt: nacht, answeredAt: nacht }).where(eq(recallAttempts.id, v.attemptId));
    const [zeile] = await testDb.select().from(recallAttempts).where(eq(recallAttempts.id, v.attemptId));
    assert.equal(zeile.answeredOn, "2026-10-13");
    const bericht = await themaTagesbericht(nutzer, tFr, MO);
    assert.equal(bericht.fragen, 1);
    // am App-Tag Dienstag gehört er nicht mehr dazu
    assert.equal((await themaTagesbericht(nutzer, tFr, "2026-10-13")).fragen, 0);
  });
});

describe("ein Baustein mit zwei überfälligen Terminen", () => {
  it("kommt an einem Tag nur einmal, „Wieder dran“ ist morgen, und das Ende zählt nur diesen Durchgang", async () => {
    const n = await testNutzer("Zweimal");
    const f = await fach(n, "Geschichte", "Ge");
    const t = await thema(n, f, "Industrialisierung");
    const item = await frage(n, f, t, ["2026-10-09", "2026-10-11", "2026-10-16"]);
    const vorher = await testDb.select().from(recallSchedule).where(eq(recallSchedule.itemId, item)).orderBy(asc(recallSchedule.dueOn));

    assert.equal((await faelligeThemen(n, MO)).length, 1);
    const [erste] = await fragenZumThema(n, MO, t);
    assert.equal(erste.dueOn, "2026-10-09");
    // der Termin vom 11.10. bleibt offen und kommt morgen, nicht der vom 16.10.
    assert.equal(await naechsterTerminThema(n, t, MO), "2026-10-13");

    const v = await versuchFesthalten(n, { scheduleId: erste.scheduleId, itemId: item, answerText: "a" }, MO);
    assert.ok(v.ok);
    await urteilFesthalten(n, v.attemptId, true);
    await versucheAufMontag();

    // schon vor dem Themenende: keine zweite Runde mit derselben Frage
    assert.deepEqual(await fragenZumThema(n, MO, t), []);
    assert.deepEqual(await faelligeThemen(n, MO), []);
    assert.deepEqual(await themaTagesbericht(n, t, MO).then((b) => [b.fragen, b.beimErstenMal]), [1, 1]);

    await protokollieren(n, MO, "thema_beendet", t, { n: 1 });
    assert.deepEqual(await faelligeThemen(n, MO), []);
    assert.equal((await wiederholenStand(n, MO)).kind, "text");
    // ein neuer Durchgang zählt die Versuche des vorigen nicht mit
    assert.equal((await themaTagesbericht(n, t, MO)).fragen, 0);

    // am nächsten Tag ist der Termin vom 11.10. dran, danach der 16.10.
    const di = await faelligeThemen(n, "2026-10-13");
    assert.equal(di.length, 1);
    assert.equal(di[0].aeltester, "2026-10-11");
    assert.equal(await naechsterTerminThema(n, t, "2026-10-13"), "2026-10-16");

    // der Takt bleibt: nur done_at des ältesten Termins hat sich geändert
    const nachher = await testDb.select().from(recallSchedule).where(eq(recallSchedule.itemId, item)).orderBy(asc(recallSchedule.dueOn));
    assert.deepEqual(
      nachher.map((z) => [z.id, z.dueOn, z.round, !!z.doneAt]),
      vorher.map((z, k) => [z.id, z.dueOn, z.round, k === 0]),
    );
  });
});
