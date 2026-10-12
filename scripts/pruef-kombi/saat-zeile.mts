import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  examTopics,
  exams,
  freePeriods,
  grades,
  homework,
  lessons,
  materialPages,
  materials,
  materialTopics,
  periods,
  studyBlocks,
  subjects,
  subjectTopics,
  users,
} from "@/db/schema";

/**
 * Nur lokal, nur zum Prüfen von Abschnitt D (Zeile): legt im Konto „Probe“
 * die Welt des Prototyps an (Z. 1092–1300) — sechs Fächer, Stundenplan,
 * Herbstferien, vier Aufgaben, die Mathe-Klausur am Freitag, 16.10., mit
 * Lernplan, Noten und sieben Blätter mit Abschrift. Damit lassen sich
 * Prototyp und App mit denselben Daten nebeneinanderlegen.
 *
 *   npx tsx scripts/saat-abruf.mts          # Konto zuerst
 *   npx tsx scripts/pruef-kombi/saat-zeile.mts
 *
 * Weigert sich bei gesetztem DATABASE_URL (schreibt nur in .data/pglite).
 * Mehrfach ausführbar: was es schon gibt, bleibt.
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt. Abgebrochen — dieses Skript sät nur lokal.");
  process.exit(1);
}

const [nutzer] = await db.select({ id: users.id }).from(users).limit(1);
if (!nutzer) {
  console.error("Kein Konto. Erst: npx tsx scripts/saat-abruf.mts");
  process.exit(1);
}
const U = nutzer.id;

async function fach(name: string, short: string): Promise<string> {
  const [da] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.userId, U), eq(subjects.name, name))).limit(1);
  if (da) return da.id;
  const [neu] = await db.insert(subjects).values({ userId: U, name, short, color: "slate" }).returning({ id: subjects.id });
  return neu.id;
}

const F = {
  ge: await fach("Geschichte", "Ge"),
  ma: await fach("Mathematik", "Ma"),
  bi: await fach("Biologie", "Bi"),
  de: await fach("Deutsch", "De"),
  fr: await fach("Französisch", "Fr"),
  en: await fach("Englisch", "En"),
};

// ── Raster und Stundenplan (Prototyp PERIODS, PLAN) ──────────────────────────
await db.delete(periods).where(eq(periods.userId, U));
await db.insert(periods).values(
  [
    [1, "08:00", "09:30"],
    [2, "09:50", "11:20"],
    [3, "11:40", "13:10"],
    [4, "13:30", "14:15"],
  ].map(([number, startsAt, endsAt]) => ({ userId: U, number: number as number, startsAt: startsAt as string, endsAt: endsAt as string })),
);
const PLAN: Record<number, [number, keyof typeof F, string][]> = {
  1: [[1, "ge", "R. 104"], [2, "ma", "R. 208"], [3, "bi", "Bio 1"]],
  2: [[1, "ge", "R. 104"], [2, "de", "R. 104"], [3, "ma", "R. 208"], [4, "en", "R. 112"]],
  3: [[1, "ge", "R. 104"], [2, "fr", "R. 110"], [3, "en", "R. 112"]],
  4: [[1, "ge", "R. 104"], [2, "bi", "Bio 1"], [3, "ma", "R. 208"]],
  5: [[1, "ge", "R. 104"], [2, "ma", "R. 208"], [3, "fr", "R. 110"]],
};
await db.delete(lessons).where(eq(lessons.userId, U));
for (const [w, ls] of Object.entries(PLAN))
  await db.insert(lessons).values(
    ls.map(([period, f, room]) => ({ userId: U, weekday: Number(w), period, subjectId: F[f], room, createdAt: new Date("2026-09-28T06:00:00Z") })),
  );

await db.delete(freePeriods).where(eq(freePeriods.userId, U));
await db.insert(freePeriods).values({ userId: U, kind: "ferien", title: "Herbstferien", startsOn: "2026-10-26", endsOn: "2026-10-30" });

// ── Aufgaben (Prototyp db.aufgaben) ──────────────────────────────────────────
await db.delete(homework).where(eq(homework.userId, U));
await db.insert(homework).values([
  { userId: U, subjectId: F.ma, title: "S. 84, Nr. 3–5", dueDate: "2026-10-13" },
  { userId: U, subjectId: F.de, title: "Gedichtanalyse beenden", dueDate: "2026-10-13" },
  { userId: U, subjectId: F.en, title: "Vokabeln Unit 3", dueDate: "2026-10-12", doneAt: new Date("2026-10-11T17:12:00Z") },
  { userId: U, subjectId: F.ge, title: "Fragen zur Dampfmaschine", dueDate: "2026-10-12", doneAt: new Date("2026-10-12T05:12:00Z") },
]);

// ── Klausur Mathe am 16.10. mit Lernplan ─────────────────────────────────────
const [kDa] = await db.select({ id: exams.id }).from(exams).where(and(eq(exams.userId, U), eq(exams.date, "2026-10-16"))).limit(1);
if (!kDa) {
  const [k] = await db.insert(exams).values({ userId: U, subjectId: F.ma, date: "2026-10-16", title: "Quadratische Funktionen" }).returning({ id: exams.id });
  const [t1] = await db.insert(examTopics).values({ examId: k.id, title: "Scheitelpunktform", sortOrder: 0 }).returning({ id: examTopics.id });
  const [t2] = await db.insert(examTopics).values({ examId: k.id, title: "Alles bis Scheitelpunktform", sortOrder: 1 }).returning({ id: examTopics.id });
  await db.insert(studyBlocks).values([
    { examId: k.id, topicId: t1.id, date: "2026-10-12", minutes: 25, kind: "learn", sortOrder: 0 },
    { examId: k.id, topicId: t2.id, date: "2026-10-14", minutes: 25, kind: "review", sortOrder: 1 },
  ]);
}

// ── Noten ────────────────────────────────────────────────────────────────────
await db.delete(grades).where(eq(grades.userId, U));
await db.insert(grades).values([
  { userId: U, subjectId: F.ma, value: 20, kind: "schriftlich", date: "2026-09-17", title: "Klausur" },
  { userId: U, subjectId: F.ma, value: 27, kind: "schriftlich", date: "2026-09-29", title: "Test" },
  { userId: U, subjectId: F.ma, value: 23, kind: "muendlich", date: "2026-10-07", title: "Mitarbeit" },
  { userId: U, subjectId: F.ge, value: 17, kind: "muendlich", date: "2026-10-02", title: "Referat" },
  { userId: U, subjectId: F.fr, value: 30, kind: "schriftlich", date: "2026-09-24", title: "Klausur" },
  { userId: U, subjectId: F.fr, value: 23, kind: "muendlich", date: "2026-10-06", title: "Mitarbeit" },
]);

// ── Blätter mit Abschrift (Prototyp ABSCHRIFT, BLAETTER0) ───────────────────
const ABSCHRIFT: Record<string, string> = {
  b1: "Die Dampfmaschine\nDie Industrialisierung begann um 1760 in England.\nGründe: Kohle und Eisenerz im eigenen Land, Kapital aus Handel und Kolonien und eine wachsende Bevölkerung.\nThomas Newcomen baute 1712 die erste brauchbare Dampfmaschine. Newcomens Maschine pumpte Wasser aus Bergwerken.\nJames Watt verbesserte sie 1769. Er baute einen eigenen Kondensator, getrennt vom Zylinder. Die Maschine brauchte dadurch viel weniger Kohle.",
  b2: "Passé composé avec être\nMit être: aller, venir, partir, arriver, entrer, sortir, monter, descendre, naître, mourir, rester, tomber und alle reflexiven Verben.\nDas Partizip richtet sich nach dem Subjekt: il est allé, elle est allée, ils sont allés, elles sont allées.",
  b3: "Spinnmaschine und Fabrik\n1764 baute James Hargreaves die Spinning Jenny. Eine Person spann damit an mehreren Spindeln zugleich.\nIn der Manufaktur arbeiteten viele Menschen von Hand, jeder an einem Arbeitsschritt. In der Fabrik trieben Dampf oder Wasser die Maschinen an.",
  b4: "Exercices 3 et 4\n1. Elle ___ (aller) au cinéma.\n2. Ils ___ (arriver) hier.\n3. Nous ___ (partir) à huit heures.",
  b5: "Arbeit in der Fabrik\nEin Arbeitstag dauerte 12 bis 16 Stunden, sechs Tage in der Woche.\nAuf dem Land gab es nicht genug Arbeit für die wachsende Bevölkerung. Viele zogen deshalb in die Städte zu den Fabriken.\nKinderarbeit\nDer Factory Act von 1833 verbot Kinderarbeit unter 9 Jahren in Textilfabriken.",
  b6: "Die erste Eisenbahn in Deutschland\n1835 fuhr die erste Eisenbahn in Deutschland von Nürnberg nach Fürth. Die Lokomotive hieß Adler und kam aus England.\nMit der Eisenbahn wuchs der Bedarf an Kohle und Stahl. Das Ruhrgebiet wurde zum Zentrum der Industrie.",
  b7: "Die Scheitelpunktform\nf(x) = a(x − d)² + e\nDer Scheitelpunkt ist S(d | e). Ist a negativ, ist die Parabel nach unten geöffnet. Ist |a| größer als 1, ist die Parabel gestreckt.",
};
const BLAETTER: [string, keyof typeof F, string, string, string][] = [
  ["b7", "ma", "Scheitelpunktform, Übungen", "Quadratische Funktionen", "2026-10-08"],
  ["b6", "ge", "Die erste Eisenbahn in Deutschland", "Industrialisierung in Deutschland", "2026-10-08"],
  ["b5", "ge", "Arbeit in der Fabrik, Kinderarbeit", "Industrialisierung in England", "2026-10-06"],
  ["b4", "fr", "Exercices 3 et 4", "Passé composé mit être", "2026-10-05"],
  ["b3", "ge", "Spinnmaschine und Fabrik", "Industrialisierung in England", "2026-10-02"],
  ["b2", "fr", "Passé composé avec être", "Passé composé mit être", "2026-10-01"],
  ["b1", "ge", "Die Dampfmaschine", "Industrialisierung in England", "2026-09-30"],
];
const leer = Buffer.from([0]);
for (const [key, f, titel, thema, datum] of BLAETTER) {
  const [da] = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.userId, U), eq(materials.title, titel))).limit(1);
  if (da) continue;
  const [m] = await db
    .insert(materials)
    .values({ userId: U, subjectId: F[f], title: titel, capturedOn: datum, filedAt: new Date(`${datum}T15:00:00Z`) })
    .returning({ id: materials.id });
  await db.insert(materialPages).values({ materialId: m.id, sortOrder: 0, width: 1200, height: 1600, byteSize: 1, image: leer, reading: leer, thumb: leer, transcript: ABSCHRIFT[key] });
  const mk = thema.toLowerCase();
  const [tDa] = await db.select({ id: subjectTopics.id }).from(subjectTopics).where(and(eq(subjectTopics.subjectId, F[f]), eq(subjectTopics.matchKey, mk))).limit(1);
  const tid =
    tDa?.id ??
    (await db.insert(subjectTopics).values({ userId: U, subjectId: F[f], title: thema, matchKey: mk, origin: "blatt", lastSeenAt: datum }).returning({ id: subjectTopics.id }))[0].id;
  await db.insert(materialTopics).values({ materialId: m.id, subjectTopicId: tid });
}

console.log("Welt des Prototyps angelegt.");
process.exit(0);
