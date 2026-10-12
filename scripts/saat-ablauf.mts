import { and, asc, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  homework,
  lessons,
  materialPages,
  materialTopics,
  materials,
  periods,
  subjectTopics,
  subjects,
  users,
} from "@/db/schema";
import { appTagGrenzen } from "@/lib/kombi/blaetter";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { topicKey } from "@/lib/topics";

/**
 * Saat für den Ablauf nach der Schule (Modell 23, Abschnitt C), nach den
 * Beispieldaten aus KOMBI-VORGABE-V2 Abschnitt 2: Stundenplan der Woche mit
 * den Zeiten des Prototyps, Hauptunterricht Geschichte („Industrialisierung“),
 * die Hausaufgaben für Dienstag und eine heute erledigte.
 *
 *   npx tsx scripts/saat-abruf.mts        # zuerst: Konto „Probe“
 *   npx tsx scripts/saat-ablauf.mts       # dann das hier
 *   npx tsx scripts/saat-ablauf.mts jev   # „Jev“ für die heutigen Korbblätter spielen
 *
 * Nur bei ausgeschaltetem Server (zwei PGlite-Instanzen auf denselben
 * Dateien zerstören sie). Schreibt nur in `.data/pglite`, nie mit DATABASE_URL.
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt. Dieses Skript sät nur in die lokale Datei-Datenbank.");
  process.exit(1);
}

const [nutzer] = await db.select({ id: users.id }).from(users).limit(1);
if (!nutzer) {
  console.error("Kein Konto. Zuerst: npx tsx scripts/saat-abruf.mts");
  process.exit(1);
}
const uid = nutzer.id;

async function fach(name: string, short: string): Promise<string> {
  const [da] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, uid), eq(subjects.name, name)))
    .limit(1);
  if (da) return da.id;
  const [neu] = await db.insert(subjects).values({ userId: uid, name, short }).returning({ id: subjects.id });
  return neu.id;
}

async function thema(subjectId: string, title: string): Promise<string> {
  const [da] = await db
    .select({ id: subjectTopics.id })
    .from(subjectTopics)
    .where(and(eq(subjectTopics.subjectId, subjectId), eq(subjectTopics.title, title)))
    .limit(1);
  if (da) return da.id;
  const [neu] = await db
    .insert(subjectTopics)
    .values({ userId: uid, subjectId, title, matchKey: topicKey(title), origin: "blatt", lastSeenAt: "2026-10-08" })
    .returning({ id: subjectTopics.id });
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

if (process.argv[2] === "jev") {
  // Jev spielen: die heutigen Korbblätter der Reihe nach als Geschichte, Mathe, Bio einordnen
  const JEV: [keyof typeof F, string, string][] = [
    ["ge", "Arbeiterbewegung", "Industrialisierung in Deutschland"],
    ["ma", "Scheitelpunktform, Aufgaben", "Quadratische Funktionen"],
    ["bi", "Zellatmung", "Zellatmung"],
  ];
  const [von] = appTagGrenzen(appTagVon(new Date()));
  const offen = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, uid), isNull(materials.filedAt), gte(materials.createdAt, von)))
    .orderBy(asc(materials.createdAt));
  for (const [i, m] of offen.entries()) {
    const [k, titel, th] = JEV[i % JEV.length];
    await db.update(materials).set({ subjectId: F[k], title: titel, filedAt: new Date() }).where(eq(materials.id, m.id));
    await db.insert(materialTopics).values({ materialId: m.id, subjectTopicId: await thema(F[k], th) }).onConflictDoNothing();
    await db
      .update(materialPages)
      .set({ transcript: `${titel}\n\nAbschrift der Seite.`, leser: "claude" })
      .where(eq(materialPages.materialId, m.id));
  }
  console.log(`${offen.length} Blätter eingeordnet.`);
  process.exit(0);
}

// Was die Saat vorher heute anlegte (Probeblatt), gehört nicht zu den Blättern von heute
await db
  .update(materials)
  .set({ createdAt: new Date(Date.now() - 2 * 864e5) })
  .where(and(eq(materials.userId, uid), gte(materials.createdAt, appTagGrenzen(appTagVon(new Date()))[0])));

// Raster wie im Prototyp
const RASTER: [number, string, string][] = [
  [1, "08:00", "09:30"],
  [2, "09:50", "11:20"],
  [3, "11:40", "13:10"],
  [4, "13:30", "14:15"],
];
await db.delete(periods).where(eq(periods.userId, uid));
await db.insert(periods).values(RASTER.map(([number, startsAt, endsAt]) => ({ userId: uid, number, startsAt, endsAt })));

const PLAN: Record<number, [number, keyof typeof F, string][]> = {
  1: [[1, "ge", "R. 104"], [2, "ma", "R. 208"], [3, "bi", "Bio 1"]],
  2: [[1, "ge", "R. 104"], [2, "de", "R. 104"], [3, "ma", "R. 208"], [4, "en", "R. 112"]],
  3: [[1, "ge", "R. 104"], [2, "fr", "R. 110"], [3, "en", "R. 112"]],
  4: [[1, "ge", "R. 104"], [2, "bi", "Bio 1"], [3, "ma", "R. 208"]],
  5: [[1, "ge", "R. 104"], [2, "ma", "R. 208"], [3, "fr", "R. 110"]],
};
await db.delete(lessons).where(eq(lessons.userId, uid));
await db.insert(lessons).values(
  Object.entries(PLAN).flatMap(([wd, liste]) =>
    liste.map(([period, k, room]) => ({ userId: uid, subjectId: F[k], weekday: Number(wd), period, room })),
  ),
);

// Epoche: ein Blatt mit dem Thema „Industrialisierung“ (Hauptunterricht · Industrialisierung)
const [epochenBlatt] = await db
  .select({ id: materials.id })
  .from(materials)
  .where(and(eq(materials.userId, uid), eq(materials.title, "Die erste Eisenbahn in Deutschland")))
  .limit(1);
if (!epochenBlatt) {
  const [m] = await db
    .insert(materials)
    .values({ userId: uid, subjectId: F.ge, title: "Die erste Eisenbahn in Deutschland", capturedOn: "2026-10-08", filedAt: new Date("2026-10-08T15:00:00Z"), createdAt: new Date("2026-10-08T15:00:00Z") })
    .returning({ id: materials.id });
  const leer = new Uint8Array([0]);
  await db.insert(materialPages).values({ materialId: m.id, width: 10, height: 14, byteSize: 1, image: leer, reading: leer, thumb: leer, transcript: "Die erste Eisenbahn" });
  await db.insert(materialTopics).values({ materialId: m.id, subjectTopicId: await thema(F.ge, "Industrialisierung") });
}

// Hausaufgaben (V2 2.2)
const heute = appTagVon(new Date());
await db.delete(homework).where(eq(homework.userId, uid));
const morgen = new Date(Date.parse(`${heute}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
await db.insert(homework).values([
  { userId: uid, subjectId: F.ma, title: "S. 84, Nr. 3–5", dueDate: morgen, createdAt: new Date(Date.now() - 3 * 864e5) },
  { userId: uid, subjectId: F.de, title: "Gedichtanalyse beenden", dueDate: morgen, createdAt: new Date(Date.now() - 2 * 864e5) },
  { userId: uid, subjectId: F.ge, title: "Fragen zur Dampfmaschine", dueDate: heute, doneAt: new Date(`${heute}T05:12:00Z`) },
  { userId: uid, subjectId: F.en, title: "Vokabeln Unit 3", dueDate: heute, doneAt: new Date(Date.parse(`${heute}T16:00:00Z`) - 864e5) },
]);

console.log("Stundenplan, Epoche und Hausaufgaben gesät.");
process.exit(0);
