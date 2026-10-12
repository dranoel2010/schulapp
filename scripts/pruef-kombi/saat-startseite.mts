import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  examTopics,
  exams,
  freePeriods,
  homework,
  lessons,
  materialPages,
  materialTopics,
  materials,
  periods,
  studyBlocks,
  subjectTopics,
  subjects,
  tagesprotokoll,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/password";

/**
 * Die Beispieldaten aus KOMBI-VORGABE-V2, Abschnitt 2, für die Startseite
 * (Modell 23, Abschnitt B) — damit sich App und Prototyp mit denselben Daten
 * nebeneinanderlegen lassen.
 *
 *   npx tsx scripts/pruef-kombi/saat-startseite.mts [ordner-mit-blattbildern]
 *
 * Die Blattbilder (b1.jpg … b7.jpg) zeichnet scripts/pruef-kombi/
 * blattbilder.mjs wie die Miniaturen des Prototyps.
 *
 * ⚠ Nur lokal: weigert sich mit `DATABASE_URL`. Setzt das Konto „Probe“
 * (Passwort `probe1234`) auf genau diese Daten zurück — Fächer, Stundenplan,
 * Aufgaben, Klausuren, Blätter, freie Tage und Tagesprotokoll dieses Kontos
 * werden vorher gelöscht.
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt. Diese Saat schreibt nur in die lokale Datei-Datenbank. Abgebrochen.");
  process.exit(1);
}

const bildOrdner = process.argv[2];
const leer = Buffer.from([0]);
const bild = (id: string) => {
  const p = bildOrdner ? path.join(bildOrdner, `${id}.jpg`) : "";
  return p && existsSync(p) ? readFileSync(p) : leer;
};

/** Berliner Wanduhrzeit im Oktober (MESZ, UTC+2) als Zeitpunkt. */
const um = (tag: string, hhmm: string) => new Date(`${tag}T${hhmm}:00+02:00`);

const FAECHER = [
  { key: "ge", name: "Geschichte", short: "Ge", raum: "R. 104" },
  { key: "ma", name: "Mathematik", short: "Ma", raum: "R. 208" },
  { key: "bi", name: "Biologie", short: "Bi", raum: "Bio 1" },
  { key: "de", name: "Deutsch", short: "De", raum: "R. 104" },
  { key: "fr", name: "Französisch", short: "Fr", raum: "R. 110" },
  { key: "en", name: "Englisch", short: "En", raum: "R. 112" },
] as const;

const RASTER = [
  [1, "08:00", "09:30"],
  [2, "09:50", "11:20"],
  [3, "11:40", "13:10"],
  [4, "13:30", "14:15"],
] as const;

/** Stundenplan je Wochentag (1 = Montag): Stunde, Fach, Raum (V2 2.1). */
const PLAN: Record<number, [number, string, string][]> = {
  1: [[1, "ge", "R. 104"], [2, "ma", "R. 208"], [3, "bi", "Bio 1"]],
  2: [[1, "ge", "R. 104"], [2, "de", "R. 104"], [3, "ma", "R. 208"], [4, "en", "R. 112"]],
  3: [[1, "ge", "R. 104"], [2, "fr", "R. 110"], [3, "en", "R. 112"]],
  4: [[1, "ge", "R. 104"], [2, "bi", "Bio 1"], [3, "ma", "R. 208"]],
  5: [[1, "ge", "R. 104"], [2, "ma", "R. 208"], [3, "fr", "R. 110"]],
};

const BLAETTER = [
  { id: "b1", fach: "ge", titel: "Die Dampfmaschine", thema: "Industrialisierung in England", datum: "2026-09-30", seiten: 2 },
  { id: "b2", fach: "fr", titel: "Passé composé avec être", thema: "Passé composé mit être", datum: "2026-10-01", seiten: 1 },
  { id: "b3", fach: "ge", titel: "Spinnmaschine und Fabrik", thema: "Industrialisierung in England", datum: "2026-10-02", seiten: 2 },
  { id: "b4", fach: "fr", titel: "Exercices 3 et 4", thema: "Passé composé mit être", datum: "2026-10-05", seiten: 1 },
  { id: "b5", fach: "ge", titel: "Arbeit in der Fabrik, Kinderarbeit", thema: "Industrialisierung in England", datum: "2026-10-06", seiten: 3 },
  { id: "b6", fach: "ge", titel: "Die erste Eisenbahn in Deutschland", thema: "Industrialisierung in Deutschland", datum: "2026-10-08", seiten: 1 },
  { id: "b7", fach: "ma", titel: "Scheitelpunktform, Übungen", thema: "Quadratische Funktionen", datum: "2026-10-08", seiten: 2 },
];

async function saat() {
  const hash = await hashPassword("probe1234");
  const [vorhanden] = await db.select({ id: users.id }).from(users).limit(1);
  const uid = vorhanden
    ? (await db.update(users).set({ passwordHash: hash }).where(eq(users.id, vorhanden.id)).returning({ id: users.id }))[0].id
    : (await db.insert(users).values({ name: "Probe", passwordHash: hash }).returning({ id: users.id }))[0].id;

  // Zurücksetzen (Fächer nehmen Stunden, Aufgaben, Klausuren, Blätter, Themen mit)
  await db.delete(tagesprotokoll).where(eq(tagesprotokoll.userId, uid));
  await db.delete(freePeriods).where(eq(freePeriods.userId, uid));
  await db.delete(materials).where(eq(materials.userId, uid));
  await db.delete(exams).where(eq(exams.userId, uid));
  await db.delete(homework).where(eq(homework.userId, uid));
  await db.delete(lessons).where(eq(lessons.userId, uid));
  await db.delete(subjects).where(eq(subjects.userId, uid));
  await db.delete(periods).where(eq(periods.userId, uid));

  const fach: Record<string, string> = {};
  for (const [i, f] of FAECHER.entries()) {
    const [z] = await db
      .insert(subjects)
      .values({ userId: uid, name: f.name, short: f.short, room: f.raum, sortOrder: i })
      .returning({ id: subjects.id });
    fach[f.key] = z.id;
  }

  await db.insert(periods).values(RASTER.map(([number, startsAt, endsAt]) => ({ userId: uid, number, startsAt, endsAt })));
  await db.insert(lessons).values(
    Object.entries(PLAN).flatMap(([wd, liste]) =>
      liste.map(([period, f, room]) => ({ userId: uid, subjectId: fach[f], weekday: Number(wd), period, room })),
    ),
  );

  await db.insert(freePeriods).values({ userId: uid, kind: "ferien", startsOn: "2026-10-26", endsOn: "2026-10-30" });

  await db.insert(homework).values([
    { userId: uid, subjectId: fach.ma, title: "S. 84, Nr. 3–5", dueDate: "2026-10-13", createdAt: um("2026-10-09", "15:00") },
    { userId: uid, subjectId: fach.de, title: "Gedichtanalyse beenden", dueDate: "2026-10-13", createdAt: um("2026-10-09", "15:01") },
    { userId: uid, subjectId: fach.en, title: "Vokabeln Unit 3", dueDate: "2026-10-12", doneAt: um("2026-10-11", "19:12"), createdAt: um("2026-10-08", "15:00") },
    { userId: uid, subjectId: fach.ge, title: "Fragen zur Dampfmaschine", dueDate: "2026-10-12", createdAt: um("2026-10-08", "15:01") },
  ]);

  // Mathematik-Klausur Fr 16.10., 2. Stunde, mit Lernplan (V2 2.3)
  const [klausur] = await db
    .insert(exams)
    .values({ userId: uid, subjectId: fach.ma, title: "Quadratische Funktionen", kind: "klausur", date: "2026-10-16", leadDays: 5, minutesPerDay: 25 })
    .returning({ id: exams.id });
  const [thema] = await db
    .insert(examTopics)
    .values({ examId: klausur.id, title: "Scheitelpunktform", sortOrder: 0 })
    .returning({ id: examTopics.id });
  await db.insert(studyBlocks).values([
    { examId: klausur.id, topicId: thema.id, date: "2026-10-12", minutes: 25, kind: "learn", sortOrder: 0 },
    { examId: klausur.id, topicId: thema.id, date: "2026-10-14", minutes: 25, kind: "review", sortOrder: 0 },
    { examId: klausur.id, topicId: null, date: "2026-10-15", minutes: 45, kind: "review", sortOrder: 0 },
  ]);

  // Blätter mit Thema, eingeordnet; aufgenommen am Schultag (b7 nach b6)
  const themen = new Map<string, string>();
  for (const [i, b] of BLAETTER.entries()) {
    const key = `${b.fach}:${b.thema}`;
    if (!themen.has(key)) {
      const [t] = await db
        .insert(subjectTopics)
        .values({ userId: uid, subjectId: fach[b.fach], title: b.thema, matchKey: b.thema.toLowerCase(), origin: "blatt", lastSeenAt: b.datum })
        .returning({ id: subjectTopics.id });
      themen.set(key, t.id);
    }
    const zeit = new Date(um(b.datum, "15:00").getTime() + i * 60_000);
    const [m] = await db
      .insert(materials)
      .values({ userId: uid, subjectId: fach[b.fach], title: b.titel, capturedOn: b.datum, filedAt: zeit, createdAt: zeit })
      .returning({ id: materials.id });
    const jpg = bild(b.id);
    await db.insert(materialPages).values(
      Array.from({ length: b.seiten }, (_, s) => ({
        materialId: m.id,
        sortOrder: s,
        width: 300,
        height: 424,
        byteSize: jpg.length,
        image: jpg,
        reading: jpg,
        thumb: jpg,
        transcript: s === 0 ? b.titel : null,
        createdAt: zeit,
      })),
    );
    await db.insert(materialTopics).values({ materialId: m.id, subjectTopicId: themen.get(key)! });
  }

  console.log("Beispieldaten aus V2 Abschnitt 2 angelegt (Konto Probe, Passwort probe1234).");
}

await saat();
process.exit(0);
