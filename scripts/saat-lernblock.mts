import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  examTopics,
  exams,
  grades,
  lessons,
  materialPages,
  materialTopics,
  materials,
  studyBlocks,
  subjectTopics,
  subjects,
  users,
} from "@/db/schema";
import { todayInBerlin } from "@/lib/dates";
import { generatePlan } from "@/lib/exams";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * Beispieldaten für Abschnitt F (Lernblock und Klausur), damit App und
 * Prototyp nebeneinander liegen: Mathematik-Klausur am Freitag 16.10.
 * „Quadratische Funktionen“ mit Lernplan (heute Scheitelpunktform), Noten
 * 2 · 3+ · 2−, das Blatt „Scheitelpunktform, Übungen“ vom 8.10., die
 * Klausur in der 2. Stunde, ein verpasster Block vom Freitag und eine
 * weitere Klausur. Läuft nach scripts/saat-abruf.mts (Konto „Probe“).
 *
 *   npx tsx scripts/saat-lernblock.mts            # Grundstand
 *   npx tsx scripts/saat-lernblock.mts --eng      # dazu: Klausur morgen (Warnung „tight“)
 *   npx tsx scripts/saat-lernblock.mts --leer     # dazu: Klausur ohne Themen
 *   npx tsx scripts/saat-lernblock.mts --fragen   # dazu: drei heute fällige Fragen zur Scheitelpunktform
 *
 * Schreibt nur in die lokale Datei-Datenbank (Riegel wie saat-abruf).
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt — abgebrochen, dieses Skript sät nur lokal.");
  process.exit(1);
}

const HEUTE = todayInBerlin();
const TITEL = ["Quadratische Funktionen", "Lektüre", "Probe: eng", "Probe: ohne Themen"];

async function fach(userId: string, name: string, short: string): Promise<string> {
  const [da] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.name, name)));
  if (da) return da.id;
  const [neu] = await db.insert(subjects).values({ userId, name, short }).returning({ id: subjects.id });
  return neu.id;
}

async function main() {
  const [nutzer] = await db.select({ id: users.id }).from(users).where(eq(users.name, "Probe"));
  if (!nutzer) throw new Error("Erst scripts/saat-abruf.mts laufen lassen.");
  const userId = nutzer.id;
  const mathe = await fach(userId, "Mathematik", "Ma");
  const englisch = await fach(userId, "Englisch", "E");
  const bio = await fach(userId, "Biologie", "Bi");

  // Alte Saat weg (Klausuren mit diesen Titeln, samt Blöcken)
  await db.delete(exams).where(and(eq(exams.userId, userId), inArray(exams.title, TITEL)));

  // Fach-Thema mit Blatt
  let [thema] = await db
    .select({ id: subjectTopics.id })
    .from(subjectTopics)
    .where(and(eq(subjectTopics.subjectId, mathe), eq(subjectTopics.matchKey, "scheitelpunktform")));
  if (!thema) {
    [thema] = await db
      .insert(subjectTopics)
      .values({ userId, subjectId: mathe, title: "Scheitelpunktform", matchKey: "scheitelpunktform", lastSeenAt: "2026-10-08" })
      .returning({ id: subjectTopics.id });
  }
  const [blattDa] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.title, "Scheitelpunktform, Übungen")));
  if (!blattDa) {
    const [blatt] = await db
      .insert(materials)
      .values({ userId, subjectId: mathe, title: "Scheitelpunktform, Übungen", capturedOn: "2026-10-08", filedAt: new Date() })
      .returning({ id: materials.id });
    const bild = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
      "base64",
    );
    await db.insert(materialPages).values([
      {
        materialId: blatt.id,
        sortOrder: 0,
        image: bild,
        reading: bild,
        thumb: bild,
        width: 1200,
        height: 1600,
        byteSize: bild.length,
        mimeType: "image/png",
        transcript:
          "# Die Scheitelpunktform\n\nf(x) = a(x − d)² + e\n\nDer Scheitelpunkt ist S(d | e). Ist a negativ, ist die Parabel nach unten geöffnet.",
      },
      {
        materialId: blatt.id,
        sortOrder: 1,
        image: bild,
        reading: bild,
        thumb: bild,
        width: 1200,
        height: 1600,
        byteSize: bild.length,
        mimeType: "image/png",
        transcript: "# Nullstellen\n\nx = −p/2 ± √((p/2)² − q)",
      },
    ]);
    await db.insert(materialTopics).values({ materialId: blatt.id, subjectTopicId: thema.id });
  }

  // Die Mathe-Klausur
  const [k] = await db
    .insert(exams)
    .values({ userId, subjectId: mathe, date: "2026-10-16", title: "Quadratische Funktionen", leadDays: 5, minutesPerDay: 25 })
    .returning({ id: exams.id });
  await db.insert(examTopics).values([
    { examId: k.id, title: "Scheitelpunktform", sortOrder: 0, subjectTopicId: thema.id },
    { examId: k.id, title: "Nullstellen", sortOrder: 1 },
  ]);
  await generatePlan(userId, k.id, HEUTE);
  // Ein verpasster Block vom Freitag
  const [nst] = await db.select({ id: examTopics.id }).from(examTopics).where(and(eq(examTopics.examId, k.id), eq(examTopics.title, "Nullstellen")));
  await db.insert(studyBlocks).values({ examId: k.id, topicId: nst.id, date: "2026-10-09", minutes: 25, kind: "learn", sortOrder: 0 });

  // Klausur in der 2. Stunde am Freitag
  const [stunde] = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.userId, userId), eq(lessons.weekday, 5), eq(lessons.period, 2)));
  if (!stunde) await db.insert(lessons).values({ userId, subjectId: mathe, weekday: 5, period: 2, room: "R 12" });

  // Noten 2 · 3+ · 2−
  const vorhanden = await db.select({ id: grades.id }).from(grades).where(and(eq(grades.userId, userId), eq(grades.subjectId, mathe)));
  if (vorhanden.length === 0) {
    await db.insert(grades).values([
      { userId, subjectId: mathe, value: 20, date: "2026-09-10", title: "Test" },
      { userId, subjectId: mathe, value: 27, date: "2026-09-24", title: "Mündlich", kind: "muendlich" },
      { userId, subjectId: mathe, value: 23, date: "2026-10-01", title: "Test" },
    ]);
  }

  // Eine weitere Klausur in ≤ 14 Tagen
  const [e] = await db
    .insert(exams)
    .values({ userId, subjectId: englisch, date: "2026-10-22", title: "Lektüre", leadDays: 7, minutesPerDay: 30 })
    .returning({ id: exams.id });
  await db.insert(examTopics).values({ examId: e.id, title: "Vocabulary", sortOrder: 0 });
  await generatePlan(userId, e.id, HEUTE);

  // Fragen der Klausur (ohne --fragen: keine, dann öffnet der Block mit dem Material)
  const alteFragen = await db
    .select({ id: recallItems.id })
    .from(recallItems)
    .where(and(eq(recallItems.userId, userId), eq(recallItems.sourceQuote, "Saat Lernblock")));
  if (alteFragen.length) await db.delete(recallItems).where(inArray(recallItems.id, alteFragen.map((f) => f.id)));
  if (process.argv.includes("--fragen")) {
    for (const text of [
      "Woran liest du in f(x) = a(x − d)² + e den Scheitelpunkt ab?",
      "Wann ist die Parabel nach unten geöffnet?",
      "Was bedeutet e in der Scheitelpunktform?",
    ]) {
      const [f] = await db
        .insert(recallItems)
        .values({
          userId,
          subjectId: mathe,
          subjectTopicId: thema.id,
          examId: k.id,
          promptFree: text,
          solution: "Siehe Blatt.",
          misconception: "Verwechslung von d und e",
          sourceQuote: "Saat Lernblock",
          sourceLength: 14,
        })
        .returning({ id: recallItems.id });
      await db.insert(recallSchedule).values({ itemId: f.id, dueOn: HEUTE });
    }
  }

  if (process.argv.includes("--eng")) {
    const morgen = new Date(Date.parse(`${HEUTE}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
    const [t] = await db
      .insert(exams)
      .values({ userId, subjectId: bio, date: morgen, title: "Probe: eng", leadDays: 5, minutesPerDay: 30 })
      .returning({ id: exams.id });
    await db.insert(examTopics).values({ examId: t.id, title: "Zellteilung", sortOrder: 0 });
    await generatePlan(userId, t.id, HEUTE);
    console.log("Klausur morgen:", t.id);
  }
  if (process.argv.includes("--leer")) {
    const [t] = await db
      .insert(exams)
      .values({ userId, subjectId: bio, date: "2026-11-20", title: "Probe: ohne Themen" })
      .returning({ id: exams.id });
    console.log("Klausur ohne Themen:", t.id);
  }

  console.log("Mathe-Klausur:", k.id);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
