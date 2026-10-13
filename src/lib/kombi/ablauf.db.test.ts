import { dbBereit, testDb, testNutzer } from "@/test/db-harness";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { lessons, materialTopics, materials, periods, subjectTopics, subjects, tagesprotokoll } from "@/db/schema";
import { ablaufBeenden, ladeAblauf } from "@/lib/kombi/ablauf";
import { blaetterVomTag, fachAendern } from "@/lib/kombi/blaetter";
import { blattAnlegen, seiteAnhaengen } from "@/lib/kombi/blatt-aufnahme";
import { protokollVomTag } from "@/lib/protokoll";

/** Eine Seite, wie sie `readPage()` liefert: winzig, aber gültig. */
const SEITE = {
  mimeType: "image/jpeg",
  width: 10,
  height: 14,
  image: new Uint8Array([1, 2, 3]),
  reading: new Uint8Array([1, 2]),
  thumb: new Uint8Array([1]),
};

let nutzer = "";
let mathe = "";
let geschichte = "";
let bio = "";

before(async () => {
  await dbBereit();
  nutzer = await testNutzer();
  const f = await testDb
    .insert(subjects)
    .values([
      { userId: nutzer, name: "Geschichte", short: "Ge" },
      { userId: nutzer, name: "Mathematik", short: "M" },
      { userId: nutzer, name: "Biologie", short: "Bi" },
    ])
    .returning({ id: subjects.id, name: subjects.name });
  geschichte = f.find((x) => x.name === "Geschichte")!.id;
  mathe = f.find((x) => x.name === "Mathematik")!.id;
  bio = f.find((x) => x.name === "Biologie")!.id;
  await testDb.insert(periods).values([
    { userId: nutzer, number: 1, startsAt: "08:00", endsAt: "09:30" },
    { userId: nutzer, number: 2, startsAt: "09:50", endsAt: "11:20" },
    { userId: nutzer, number: 3, startsAt: "11:40", endsAt: "13:10" },
  ]);
  // Montag: Geschichte (Hauptunterricht), Mathe, Bio; Dienstag/Donnerstag: Geschichte, Mathe bzw. Bio
  await testDb.insert(lessons).values([
    { userId: nutzer, subjectId: geschichte, weekday: 1, period: 1 },
    { userId: nutzer, subjectId: mathe, weekday: 1, period: 2 },
    { userId: nutzer, subjectId: bio, weekday: 1, period: 3 },
    { userId: nutzer, subjectId: geschichte, weekday: 2, period: 1 },
    { userId: nutzer, subjectId: mathe, weekday: 2, period: 3 },
    { userId: nutzer, subjectId: geschichte, weekday: 4, period: 1 },
    { userId: nutzer, subjectId: bio, weekday: 4, period: 2 },
  ]);
});

describe("Blätter ohne Fachwahl (Plan 3.8)", () => {
  it("legt ein Blatt mit vorläufigem Fach an, filed_at bleibt leer, protokolliert blatt_abgelegt", async () => {
    // Mo 12.10. 10:00 Berliner Zeit: Mathe läuft
    const now = new Date("2026-10-12T08:00:00Z");
    const r = await blattAnlegen(nutzer, now, SEITE, { seiten: 2, ziel: "liste" });
    assert.ok(r.ok);
    const [m] = await testDb.select().from(materials).where(eq(materials.id, r.id));
    assert.equal(m.subjectId, mathe);
    assert.equal(m.filedAt, null);
    assert.equal(m.capturedOn, "2026-10-12");
    const log = await protokollVomTag(nutzer, "2026-10-12");
    const e = log.find((x) => x.ref === r.id);
    assert.equal(e?.typ, "blatt_abgelegt");
    assert.deepEqual(e?.daten, { n: 2, row: "liste" });

    // die zweite Seite gehört dazu und schreibt kein seite_dazu
    const s = await seiteAnhaengen(nutzer, now, r.id, SEITE, { folge: true });
    assert.ok(s.ok);
    assert.equal((await protokollVomTag(nutzer, "2026-10-12")).filter((x) => x.typ === "seite_dazu").length, 0);
    // „Seite dazu“ schreibt eins
    await seiteAnhaengen(nutzer, now, r.id, SEITE);
    assert.equal((await protokollVomTag(nutzer, "2026-10-12")).filter((x) => x.typ === "seite_dazu").length, 1);

    // created_at kommt von der echten Uhr: auf den Montag der Testuhr rücken
    await testDb.update(materials).set({ createdAt: now }).where(eq(materials.id, r.id));
    const [kurz] = (await blaetterVomTag(nutzer, "2026-10-12")).filter((b) => b.id === r.id);
    assert.equal(kurz.fach, null, "ohne filed_at zeigt die Liste kein Fach");
    assert.equal(kurz.seiten, 3);
    assert.equal(kurz.status, "einordnen");
  });

  it("nach Schulschluss nimmt es die letzte Stunde des Tages", async () => {
    const r = await blattAnlegen(nutzer, new Date("2026-10-12T14:30:00Z"), SEITE);
    assert.ok(r.ok);
    const [m] = await testDb.select().from(materials).where(eq(materials.id, r.id));
    assert.equal(m.subjectId, bio);
  });

  it("fachAendern setzt Fach und filed_at, die Themen des alten Fachs fallen weg", async () => {
    const r = await blattAnlegen(nutzer, new Date("2026-10-12T08:00:00Z"), SEITE);
    assert.ok(r.ok);
    const [t] = await testDb
      .insert(subjectTopics)
      .values({ userId: nutzer, subjectId: mathe, title: "Quadratische Funktionen", matchKey: "quadratische funktionen", lastSeenAt: "2026-10-12" })
      .returning({ id: subjectTopics.id });
    await testDb.insert(materialTopics).values({ materialId: r.id, subjectTopicId: t.id });

    assert.equal(await fachAendern(nutzer, r.id, geschichte), true);
    const [m] = await testDb.select().from(materials).where(eq(materials.id, r.id));
    assert.equal(m.subjectId, geschichte);
    assert.notEqual(m.filedAt, null);
    assert.equal((await testDb.select().from(materialTopics).where(eq(materialTopics.materialId, r.id))).length, 0);

    const fremd = await testNutzer("Fremd");
    assert.equal(await fachAendern(fremd, r.id, geschichte), false, "fremdes Blatt");
    // kein Protokoll, wie im Prototyp
    assert.equal((await testDb.select().from(tagesprotokoll).where(eq(tagesprotokoll.ref, r.id))).length, 1);
  });

  it("blaetterVomTag: der App-Tag wechselt um 04:00 Berliner Zeit", async () => {
    const spaet = await blattAnlegen(nutzer, new Date("2026-10-14T01:30:00Z"), SEITE); // Mi 03:30 → App-Tag Di
    const frueh = await blattAnlegen(nutzer, new Date("2026-10-14T02:30:00Z"), SEITE); // Mi 04:30 → Mi
    assert.ok(spaet.ok && frueh.ok);
    await testDb.update(materials).set({ createdAt: new Date("2026-10-14T01:30:00Z") }).where(eq(materials.id, spaet.id));
    await testDb.update(materials).set({ createdAt: new Date("2026-10-14T02:30:00Z") }).where(eq(materials.id, frueh.id));
    const di = (await blaetterVomTag(nutzer, "2026-10-13")).map((b) => b.id);
    const mi = (await blaetterVomTag(nutzer, "2026-10-14")).map((b) => b.id);
    assert.ok(di.includes(spaet.id) && !di.includes(frueh.id));
    assert.ok(mi.includes(frueh.id) && !mi.includes(spaet.id));
  });
});

describe("Ablauf nach der Schule", () => {
  it("Überspringen → Nach der Schule → Überspringen ergibt genau ein ablauf_uebersprungen", async () => {
    const tag = "2026-10-19";
    assert.equal(await ablaufBeenden(nutzer, tag, "ablauf_uebersprungen", false), "übersprungen");
    // aus dem Menü wieder geöffnet und erneut übersprungen: nichts Neues
    assert.equal(await ablaufBeenden(nutzer, tag, "ablauf_uebersprungen", true), "übersprungen");
    assert.equal(await ablaufBeenden(nutzer, tag, "ablauf_uebersprungen", false), "übersprungen");
    const log = await protokollVomTag(nutzer, tag);
    assert.equal(log.filter((e) => e.typ === "ablauf_uebersprungen").length, 1);
    // aus dem Menü abgeschlossen: erledigt
    assert.equal(await ablaufBeenden(nutzer, tag, "ablauf_beendet", true), "erledigt");
    assert.equal((await protokollVomTag(nutzer, tag)).filter((e) => e.typ === "ablauf_beendet").length, 1);
  });

  it("die Ansicht: Montag 13:09 nein, 13:11 Ablauf, Samstag nie", async () => {
    const vor = await ladeAblauf(nutzer, new Date("2026-10-12T11:09:00Z"));
    assert.equal(vor.schultag, true);
    assert.equal(vor.ansichtAblauf, false);
    const nach = await ladeAblauf(nutzer, new Date("2026-10-12T11:11:00Z"));
    assert.equal(nach.ansichtAblauf, true);
    assert.equal(nach.schritt, "blaetter");
    // Fächer von heute in Stundenreihenfolge, Hauptunterricht mit Thema, sonst nächste Stunde
    assert.deepEqual(
      nach.faecher.map((f) => [f.name, f.sub]),
      [
        ["Geschichte", "Hauptunterricht"],
        ["Mathematik", "Nächste Stunde Dienstag"],
        ["Biologie", "Nächste Stunde Donnerstag"],
      ],
    );
    assert.equal(nach.faecher[2].naechste, "2026-10-15");
    assert.equal(nach.faecher[1].kurz, "Mathe");
    const sa = await ladeAblauf(nutzer, new Date("2026-10-17T10:00:00Z"));
    assert.equal(sa.schultag, false);
    assert.equal(sa.ansichtAblauf, false);
  });
});
