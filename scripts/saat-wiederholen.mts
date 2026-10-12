import { readFileSync } from "node:fs";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  exams,
  lessons,
  materialPages,
  materialTopics,
  materials,
  subjectTopics,
  subjects,
  tagesprotokoll,
  users,
} from "@/db/schema";
import { recallAttempts, recallItems, recallSchedule } from "@/recall/schema";

/**
 * Die drei Beispielthemen aus V2 2.5 und 6.8 für die lokale Datenbank, damit
 * der Tisch (Modell 23, Abschnitt E) mit denselben Fragen läuft wie der
 * Prototyp und sich Bild neben Bild legen lässt:
 *
 *   npx tsx scripts/saat-wiederholen.mts [--zuruecksetzen]
 *
 * Fragen, Musterlösungen, Verwechslungssätze, Zitate und Abschriften stehen
 * wörtlich im Prototyp (`FRAGEN`, `ABSCHRIFT`, Z. 1148–1215) und werden von
 * dort gelesen, nicht abgetippt. Die Termine sind die aus `THEMEN`
 * (Z. 1218–1222): Geschichte fällig seit Sa 10.10., Mathematik und
 * Französisch am Mo 12.10., Mathe-Klausur Fr 16.10. Geschichte steht in der
 * ersten Stunde (Hauptunterricht, also „Epoche · Geschichte“).
 *
 * `--zuruecksetzen` löscht vorher die Fragen dieser drei Fächer samt Versuchen
 * und das Tagesprotokoll, für eine frische Runde.
 *
 * Wie `saat-abruf.mts`: nur die Datei-Datenbank unter `.data/pglite`, nie mit
 * gesetztem `DATABASE_URL`.
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt. Dieses Skript sät nur in die lokale Datei-Datenbank. Abgebrochen.");
  process.exit(1);
}

type Q = { id: string; thema: string; b: string; q: string; l: string[]; v: string; z: string };
type Abschrift = Record<string, [string, string][]>;

const html = readFileSync(new URL("../entwurf-modelle/23-kombi-v2/index.html", import.meta.url), "utf8");
const block = (start: string, ende: string) => {
  const i = html.indexOf(start);
  const j = html.indexOf(ende, i);
  if (i < 0 || j < 0) throw new Error(`Im Prototyp nicht gefunden: ${start}`);
  return html.slice(i + start.length, j);
};
const ABSCHRIFT = new Function(`return {${block("const ABSCHRIFT = {", "const BLAETTER0")}`.replace(/;\s*$/, ""))() as Abschrift;
const FRAGEN = new Function(
  "Q",
  `return [${block("const FRAGEN = [", "const FR = id")}`.replace(/;\s*$/, ""),
)((id: string, thema: string, b: string, q: string, l: string[], v: string, z: string) => ({ id, thema, b, q, l, v, z })) as Q[];

const FAECHER = { ge: ["Geschichte", "Ge"], ma: ["Mathematik", "Ma"], fr: ["Französisch", "Fr"] } as const;
const THEMEN = {
  "ge-en": { fach: "ge", titel: "Industrialisierung in England", termine: ["2026-10-10", "2026-10-13", "2026-10-16"] },
  "ma-qf": { fach: "ma", titel: "Quadratische Funktionen", termine: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"] },
  "fr-pc": { fach: "fr", titel: "Passé composé mit être", termine: ["2026-10-12", "2026-10-15"] },
} as const;
const BLAETTER = {
  b1: { fach: "ge", titel: "Die Dampfmaschine", thema: "ge-en", datum: "2026-09-30", seiten: 2 },
  b2: { fach: "fr", titel: "Passé composé avec être", thema: "fr-pc", datum: "2026-10-01", seiten: 1 },
  b3: { fach: "ge", titel: "Spinnmaschine und Fabrik", thema: "ge-en", datum: "2026-10-02", seiten: 2 },
  b4: { fach: "fr", titel: "Exercices 3 et 4", thema: "fr-pc", datum: "2026-10-05", seiten: 1 },
  b5: { fach: "ge", titel: "Arbeit in der Fabrik, Kinderarbeit", thema: "ge-en", datum: "2026-10-06", seiten: 3 },
  b7: { fach: "ma", titel: "Scheitelpunktform, Übungen", thema: "ma-qf", datum: "2026-10-08", seiten: 2 },
} as const;

const ohneKlammern = (s: string) => s.replace(/[{}]/g, "");
const leer = Buffer.from([0]);

const [nutzer] = await db.select({ id: users.id }).from(users).limit(1);
if (!nutzer) {
  console.error("Kein Konto. Erst `npx tsx scripts/saat-abruf.mts` laufen lassen.");
  process.exit(1);
}
const userId = nutzer.id;

// ── Fächer ───────────────────────────────────────────────────────────────────
const fachId: Record<string, string> = {};
for (const [k, [name, short]] of Object.entries(FAECHER)) {
  const [da] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.userId, userId), eq(subjects.name, name)));
  fachId[k] = da?.id ?? (await db.insert(subjects).values({ userId, name, short }).returning({ id: subjects.id }))[0].id;
}

if (process.argv.includes("--zuruecksetzen")) {
  const alte = await db
    .select({ id: recallItems.id })
    .from(recallItems)
    .where(and(eq(recallItems.userId, userId), inArray(recallItems.subjectId, Object.values(fachId))));
  if (alte.length) {
    await db.delete(recallAttempts).where(inArray(recallAttempts.itemId, alte.map((a) => a.id)));
    await db.delete(recallItems).where(inArray(recallItems.id, alte.map((a) => a.id)));
  }
  await db.delete(tagesprotokoll).where(eq(tagesprotokoll.userId, userId));
  console.log(`Zurückgesetzt: ${alte.length} Fragen und das Tagesprotokoll.`);
}

// ── Themen ───────────────────────────────────────────────────────────────────
const themaId: Record<string, string> = {};
for (const [k, t] of Object.entries(THEMEN)) {
  const sid = fachId[t.fach];
  const [da] = await db
    .select({ id: subjectTopics.id })
    .from(subjectTopics)
    .where(and(eq(subjectTopics.subjectId, sid), eq(subjectTopics.title, t.titel)));
  themaId[k] =
    da?.id ??
    (
      await db
        .insert(subjectTopics)
        .values({ userId, subjectId: sid, title: t.titel, matchKey: t.titel.toLowerCase(), origin: "blatt", lastSeenAt: "2026-10-08" })
        .returning({ id: subjectTopics.id })
    )[0].id;
}

// ── Blätter mit Abschrift ────────────────────────────────────────────────────
// Seitenzahl wie im Prototyp (`BLAETTER0`, Z. 1170): die Abschrift steht auf
// Seite 1, weitere Seiten sind gelesen und leer ("" heißt gelesen).
const seiteVon: Record<string, string> = {};
for (const [k, b] of Object.entries(BLAETTER)) {
  const [da] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.title, b.titel)));
  const mid =
    da?.id ??
    (
      await db
        .insert(materials)
        .values({ userId, subjectId: fachId[b.fach], title: b.titel, capturedOn: b.datum, filedAt: new Date() })
        .returning({ id: materials.id })
    )[0].id;
  const vorhanden = await db
    .select({ id: materialPages.id, sortOrder: materialPages.sortOrder })
    .from(materialPages)
    .where(eq(materialPages.materialId, mid))
    .orderBy(asc(materialPages.sortOrder));
  const text = (ABSCHRIFT[k] ?? []).map(([, s]) => ohneKlammern(s)).join("\n\n");
  for (let n = vorhanden.length; n < b.seiten; n += 1) {
    const [seite] = await db
      .insert(materialPages)
      .values({ materialId: mid, sortOrder: n, width: 1200, height: 1600, byteSize: 1, image: leer, reading: leer, thumb: leer, transcript: n === 0 ? text : "" })
      .returning({ id: materialPages.id, sortOrder: materialPages.sortOrder });
    vorhanden.push(seite);
  }
  seiteVon[k] = vorhanden[0].id;
  await db.insert(materialTopics).values({ materialId: mid, subjectTopicId: themaId[b.thema] }).onConflictDoNothing();
}

// ── Hauptunterricht und Klausur ──────────────────────────────────────────────
for (const weekday of [1, 2, 3, 4, 5]) {
  await db.insert(lessons).values({ userId, subjectId: fachId.ge, weekday, period: 1 }).onConflictDoNothing();
}
const [klausur] = await db
  .select({ id: exams.id })
  .from(exams)
  .where(and(eq(exams.userId, userId), eq(exams.subjectId, fachId.ma), eq(exams.date, "2026-10-16")));
if (!klausur) {
  await db.insert(exams).values({ userId, subjectId: fachId.ma, kind: "klausur", date: "2026-10-16", title: "Quadratische Funktionen" });
}

// ── Fragen mit Terminen ──────────────────────────────────────────────────────
let neu = 0;
for (const [sort, q] of FRAGEN.entries()) {
  const t = THEMEN[q.thema as keyof typeof THEMEN];
  const [da] = await db
    .select({ id: recallItems.id })
    .from(recallItems)
    .where(and(eq(recallItems.userId, userId), eq(recallItems.promptFree, q.q)));
  if (da) continue;
  const zitat = ohneKlammern(q.z);
  const [item] = await db
    .insert(recallItems)
    .values({
      userId,
      pageId: seiteVon[q.b],
      subjectId: fachId[t.fach],
      subjectTopicId: themaId[q.thema],
      promptFree: q.q,
      solution: q.l.join("\n"),
      misconception: q.v,
      sourceQuote: zitat,
      sourceLength: zitat.length,
    })
    .returning({ id: recallItems.id });
  await db
    .insert(recallSchedule)
    .values(t.termine.map((dueOn, k) => ({ itemId: item.id, dueOn, round: k + 1, sortOrder: sort })));
  neu += 1;
}
console.log(`${neu} Fragen angelegt (${FRAGEN.length} im Prototyp).`);
process.exit(0);
