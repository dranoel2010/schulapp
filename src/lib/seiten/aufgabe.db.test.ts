import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { lessons, periods } from "@/db/schema";
import { createExam } from "@/lib/exams";
import { createGrade } from "@/lib/grades";
import { createHomework, setHomeworkDone } from "@/lib/homework";
import { createSubject } from "@/lib/subjects";
import { berlinZeitpunkt } from "@/lib/tag";

import { aufgabeSeite, gruppeVon, hausaufgabenSeite } from "./hausaufgaben";
import { klausurSeite } from "./klausur";

/**
 * Am Rechner: Liste und Detail der Hausaufgaben und die Klausur im Detail.
 *
 * - Jede Aufgabe außerhalb des Archivs steht zu jeder Zeit in genau einer
 *   Gruppe; eine erledigte alte Aufgabe, wieder geöffnet, steht nach
 *   Schulschluss unter „Für ⟨Tag⟩“ (der Fehler des ersten Entwurfs: sie fiel
 *   aus allen Gruppen).
 * - Das Detail einer Aufgabe: Stunde aus dem Stundenplan, Eingetragen, Erledigt.
 * - Die Klausur: Beginn der Stunde und die Noten des Fachs mit Schnitt.
 */

let nutzer = "";
let fachId = "";
const ids: Record<string, string> = {};

before(async () => {
  await dbBereit();
  nutzer = await testNutzer("Rechner Listen");
  const fach = await createSubject(nutzer, {
    name: "Mathematik",
    short: "Ma",
    color: "blue",
    teacher: null,
    room: "R. 208",
    weightWritten: 50,
  } as never);
  fachId = fach.id;
  await testDb.insert(periods).values([
    { userId: nutzer, number: 1, startsAt: "08:00", endsAt: "09:30" },
    { userId: nutzer, number: 2, startsAt: "09:50", endsAt: "11:20" },
  ]);
  // Mo bis Fr in der 2. Stunde, mittwochs auch in der 1. (dann zählt die 1.)
  await testDb.insert(lessons).values([
    ...[1, 2, 3, 4, 5].map((weekday) => ({ userId: nutzer, subjectId: fach.id, weekday, period: 2 })),
    { userId: nutzer, subjectId: fach.id, weekday: 3, period: 1, room: "R. 110" },
  ]);
  const anlegen = async (key: string, title: string, dueDate: string) => {
    ids[key] = await createHomework(nutzer, { subjectId: fach.id, title, dueDate });
  };
  await anlegen("alt", "S. 40 Nr. 1", "2026-10-13");
  await anlegen("heute", "S. 42 Nr. 3", "2026-10-14");
  await anlegen("morgen", "S. 44 Nr. 5", "2026-10-15");
  await anlegen("spaeter", "S. 50 Nr. 2", "2026-10-21");
  await anlegen("archiv", "S. 30 Nr. 1", "2026-10-02");
  // „alt“ am Dienstag abgehakt, „archiv“ vor einer Woche
  await setHomeworkDone(nutzer, ids.alt, true, berlinZeitpunkt("2026-10-13", "17:00"));
  await setHomeworkDone(nutzer, ids.archiv, true, berlinZeitpunkt("2026-10-05", "17:00"));
});

const ZEITEN: [string, string][] = [
  ["2026-10-14", "07:10"],
  ["2026-10-14", "16:40"],
  ["2026-10-16", "20:00"],
  ["2026-10-17", "10:00"],
  ["2026-10-18", "21:00"],
];

describe("Hausaufgaben am Rechner: jede Aufgabe in genau einer Gruppe", () => {
  it("vor und nach dem Wiederöffnen, zu jeder Zeit", async () => {
    for (const offen of [false, true]) {
      if (offen) await setHomeworkDone(nutzer, ids.alt, false, berlinZeitpunkt("2026-10-14", "16:40"));
      for (const [tag, uhr] of ZEITEN) {
        const d = await hausaufgabenSeite(nutzer, berlinZeitpunkt(tag, uhr));
        const gruppen = [d.heuteFaellig, d.fuer, d.spaeter, d.erledigt].flat().map((a) => a.id);
        assert.equal(new Set(gruppen).size, gruppen.length, `${tag} ${uhr}: doppelt`);
        for (const key of ["heute", "morgen", "spaeter"]) {
          assert.ok(gruppeVon(d, ids[key]), `${tag} ${uhr}: ${key} fehlt`);
        }
        // die alte Aufgabe fällt nie heraus: erledigt (zwei Tage), danach Archiv; wieder offen immer in einer Gruppe
        if (offen) assert.ok(gruppeVon(d, ids.alt), `${tag} ${uhr}: wieder geöffnete alte Aufgabe fehlt`);
        assert.equal(gruppeVon(d, ids.archiv), null);
        assert.ok(d.archiv >= 1);
      }
      if (offen) await setHomeworkDone(nutzer, ids.alt, true, berlinZeitpunkt("2026-10-13", "17:00"));
    }
  });

  it("Mi 16:40: erledigte alte Aufgabe wieder geöffnet steht unter „Für Donnerstag“", async () => {
    const jetzt = berlinZeitpunkt("2026-10-14", "16:40");
    assert.equal(gruppeVon(await hausaufgabenSeite(nutzer, jetzt), ids.alt), "erledigt");
    await setHomeworkDone(nutzer, ids.alt, false, jetzt);
    const d = await hausaufgabenSeite(nutzer, jetzt);
    assert.equal(d.ns, "2026-10-15");
    assert.equal(gruppeVon(d, ids.alt), "fuer");
    assert.equal(d.fuer[0].id, ids.alt);
    // morgens bis Schulschluss stünde sie unter „Heute“
    assert.equal(gruppeVon(await hausaufgabenSeite(nutzer, berlinZeitpunkt("2026-10-14", "07:10")), ids.alt), "heute");
    await setHomeworkDone(nutzer, ids.alt, true, berlinZeitpunkt("2026-10-13", "17:00"));
  });
});

describe("Aufgabe im Detail", () => {
  it("Abgabe Mittwoch: die erste Stunde des Fachs, mit Beginn und Raum der Stunde", async () => {
    const a = await aufgabeSeite(nutzer, { id: ids.heute }, berlinZeitpunkt("2026-10-14", "16:40"));
    assert.ok(a);
    assert.equal(a.fachName, "Mathematik");
    assert.equal(a.fach, "Mathe");
    assert.deepEqual(a.stunde, { nr: 1, von: "08:00", raum: "R. 110" });
    assert.equal(a.heute, "2026-10-14");
    assert.match(a.eingetragen, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(a.erledigtAm, null);
    assert.equal(a.imArchiv, false);
    assert.deepEqual(a.blaetter, []);
  });

  it("Abgabe Donnerstag: 2. Stunde, Raum des Fachs", async () => {
    const a = await aufgabeSeite(nutzer, { id: ids.morgen }, berlinZeitpunkt("2026-10-14", "16:40"));
    assert.deepEqual(a?.stunde, { nr: 2, von: "09:50", raum: "R. 208" });
  });

  it("erledigt und im Archiv: Tag des Abhakens", async () => {
    const a = await aufgabeSeite(nutzer, { id: ids.archiv }, berlinZeitpunkt("2026-10-14", "16:40"));
    assert.equal(a?.done, true);
    assert.equal(a?.erledigtAm, "2026-10-05");
    assert.equal(a?.imArchiv, true);
  });

  it("unbekannte oder fremde Aufgabe: null", async () => {
    assert.equal(await aufgabeSeite(nutzer, { id: "00000000-0000-4000-8000-000000000000" }), null);
    assert.equal(await aufgabeSeite(nutzer, { id: "kaputt" }), null);
    const fremd = await testNutzer("Fremd");
    assert.equal(await aufgabeSeite(fremd, { id: ids.heute }), null);
  });
});

describe("Klausur im Detail", () => {
  it("Beginn der Stunde und Noten des Fachs, älteste zuerst, mit Schnitt", async () => {
    const k = await createExam(nutzer, { subjectId: fachId, title: "Quadratische Funktionen", kind: "klausur", date: "2026-10-21", leadDays: 5, minutesPerDay: 30, notes: null });
    await createGrade(nutzer, { subjectId: fachId, value: 20, kind: "schriftlich", weight: 1, date: "2026-09-20", title: "Test" });
    await createGrade(nutzer, { subjectId: fachId, value: 30, kind: "muendlich", weight: 1, date: "2026-10-01" });
    const d = await klausurSeite(nutzer, { id: k.id });
    assert.ok(d);
    // Mittwoch: die 1. Stunde
    assert.equal(d.stunde, 1);
    assert.equal(d.stundeVon, "08:00");
    assert.deepEqual(
      d.notenListe.map((n) => [n.label, n.titel, n.datum, n.art]),
      [
        ["2", "Test", "2026-09-20", "schriftlich"],
        ["3", null, "2026-10-01", "mündlich"],
      ],
    );
    assert.equal(typeof d.schnitt, "number");
    assert.equal(d.noten, "2 · 3");
  });
});
