import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  arbeitsblaetter,
  examTopics,
  exams,
  materialPages,
  materialTopics,
  materials,
  studyBlocks,
  subjects,
  subjectTopics,
  tagesprotokoll,
  users,
} from "@/db/schema";
import { blattErgebnis, papierFuer, type BlattAntwort } from "@/lib/arbeitsblatt/auftrag";
import {
  ABSCHRIFT_FRANZOESISCH,
  ABSCHRIFT_MATHE,
  UEBUNG_FRANZOESISCH,
  UEBUNG_MATHE,
} from "@/lib/arbeitsblatt/beispiel";
import { addDays } from "@/lib/dates";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * Saat für die Arbeitsblätter (Modell 23, Abschnitt H) in der lokalen
 * Datei-Datenbank — nach scripts/saat-abruf.mts (Konto „Probe“).
 *
 *   npx tsx scripts/saat-arbeitsblatt.mts
 *
 * Legt die Beispiele aus dem Prototyp an, damit sich Tisch, Vorschau,
 * Lesegröße, Druck und Wertung ohne API-Schlüssel neben den Prototyp legen
 * lassen: Mathematik · Quadratische Funktionen und Französisch · Passé
 * composé mit être, beide heute fällig und mit fertigem Blatt (Inhalt wie
 * `UEBUNG` im Prototyp, durch die Quellbindung geschickt); eine Mathe-Klausur
 * am Freitag mit Lernblock heute; Physik mit einem heute gescheiterten Blatt
 * und Deutsch mit einem Blatt, das gerade gebaut wird.
 *
 * Mit `--neu` setzt sie vorher alles zurück, was eine Prüfung verändert:
 * Arbeitsblätter samt Wertung, die Art der Themen, die erledigten Termine
 * und den Lernblock. Nur bei gestopptem Server (zwei PGlite auf denselben
 * Dateien zerstören sie).
 *
 * Wie saat-abruf.mts: nie mit DATABASE_URL.
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt. Diese Saat schreibt nur in die lokale Datei-Datenbank.");
  process.exit(1);
}

const TAG = appTagVon(new Date());
const leer = Buffer.from([0]);

const [nutzer] = await db.select({ id: users.id }).from(users).limit(1);
if (!nutzer) {
  console.error("Kein Konto. Erst scripts/saat-abruf.mts laufen lassen.");
  process.exit(1);
}
const userId = nutzer.id;

if (process.argv.includes("--neu")) {
  await db.delete(arbeitsblaetter).where(eq(arbeitsblaetter.userId, userId));
  await db.update(subjectTopics).set({ art: null }).where(eq(subjectTopics.userId, userId));
  const items = await db.select({ id: recallItems.id }).from(recallItems).where(eq(recallItems.userId, userId));
  for (const { id } of items) await db.update(recallSchedule).set({ doneAt: null }).where(eq(recallSchedule.itemId, id));
  const eigene = await db.select({ id: exams.id }).from(exams).where(eq(exams.userId, userId));
  for (const { id } of eigene) {
    await db.update(studyBlocks).set({ status: "open", laeuftSeit: null, pausiertSeit: null, pauseMs: 0, minutenGelernt: null }).where(eq(studyBlocks.examId, id));
  }
  await db.delete(tagesprotokoll).where(eq(tagesprotokoll.userId, userId));
  console.log("Zurückgesetzt.");
}

async function fach(name: string, short: string): Promise<string> {
  const [da] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.userId, userId), eq(subjects.name, name)));
  if (da) return da.id;
  const [neu] = await db.insert(subjects).values({ userId, name, short }).returning({ id: subjects.id });
  return neu.id;
}

async function thema(subjectId: string, title: string): Promise<string> {
  const [da] = await db.select({ id: subjectTopics.id }).from(subjectTopics).where(and(eq(subjectTopics.subjectId, subjectId), eq(subjectTopics.title, title)));
  if (da) return da.id;
  const [neu] = await db
    .insert(subjectTopics)
    .values({ userId, subjectId, title, matchKey: title.toLowerCase(), origin: "blatt", lastSeenAt: TAG })
    .returning({ id: subjectTopics.id });
  return neu.id;
}

async function blatt(subjectId: string, topicId: string, titel: string, datum: string, abschrift: string): Promise<{ id: string; titel: string; datum: string }> {
  const [da] = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.userId, userId), eq(materials.title, titel)));
  if (da) return { id: da.id, titel, datum };
  const [m] = await db.insert(materials).values({ userId, subjectId, title: titel, capturedOn: datum, filedAt: new Date() }).returning({ id: materials.id });
  await db.insert(materialPages).values({ materialId: m.id, width: 1200, height: 1600, byteSize: 1, image: leer, reading: leer, thumb: leer, transcript: abschrift, leser: "claude" });
  await db.insert(materialTopics).values({ materialId: m.id, subjectTopicId: topicId }).onConflictDoNothing();
  return { id: m.id, titel, datum };
}

async function fragen(subjectId: string, topicId: string, n: number, termine: string[]): Promise<void> {
  const [da] = await db.select({ id: recallItems.id }).from(recallItems).where(and(eq(recallItems.userId, userId), eq(recallItems.subjectTopicId, topicId))).limit(1);
  if (da) return;
  for (let i = 0; i < n; i += 1) {
    const [item] = await db
      .insert(recallItems)
      .values({ userId, subjectId, subjectTopicId: topicId, promptFree: `Frage ${i + 1}`, solution: "Lösung", misconception: "Verwechslung", sourceQuote: "Zitat", sourceLength: 5 })
      .returning({ id: recallItems.id });
    for (const [k, dueOn] of termine.entries()) {
      await db.insert(recallSchedule).values({ itemId: item.id, dueOn, round: k + 1, sortOrder: k });
    }
  }
}

async function fertigesBlatt(topicId: string, fachName: string, themaName: string, quelle: { id: string; titel: string; datum: string }, antwort: BlattAntwort, abschrift: string) {
  const e = blattErgebnis(
    antwort,
    { fach: fachName, thema: themaName, blaetter: [{ materialId: quelle.id, titel: quelle.titel, datum: quelle.datum, seiten: [abschrift] }] },
    papierFuer(fachName),
  );
  if (e.art !== "fertig") throw new Error(`${fachName}: Beispiel fällt durch die Quellbindung`);
  await db
    .insert(arbeitsblaetter)
    .values({ userId, subjectTopicId: topicId, tag: TAG, status: "fertig", versuche: 1, inhalt: e.inhalt as unknown as Record<string, unknown>, erzeugtAm: new Date() })
    .onConflictDoNothing();
}

// Mathematik · Quadratische Funktionen
const ma = await fach("Mathematik", "Ma");
const qf = await thema(ma, "Quadratische Funktionen");
const qfBlatt = await blatt(ma, qf, "Scheitelpunktform, Übungen", addDays(TAG, -4), ABSCHRIFT_MATHE);
await fragen(ma, qf, 4, [TAG, addDays(TAG, 1), addDays(TAG, 3)]);
await fertigesBlatt(qf, "Mathematik", "Quadratische Funktionen", qfBlatt, UEBUNG_MATHE, ABSCHRIFT_MATHE);

// Klausur am Freitag mit Lernblock heute (Kriterium 4: ein Lernblock vor einer Mathe-Klausur ist ein Arbeitsblatt)
const freitag = addDays(TAG, 4);
let [klausur] = await db.select({ id: exams.id }).from(exams).where(and(eq(exams.userId, userId), eq(exams.subjectId, ma), eq(exams.date, freitag)));
if (!klausur) {
  [klausur] = await db.insert(exams).values({ userId, subjectId: ma, kind: "klausur", date: freitag, title: "Quadratische Funktionen" }).returning({ id: exams.id });
  const [et] = await db.insert(examTopics).values({ examId: klausur.id, title: "Scheitelpunktform", sortOrder: 0, subjectTopicId: qf }).returning({ id: examTopics.id });
  await db.insert(studyBlocks).values({ examId: klausur.id, topicId: et.id, date: TAG, minutes: 25, kind: "learn" });
}
const [block] = await db.select({ id: studyBlocks.id }).from(studyBlocks).where(and(eq(studyBlocks.examId, klausur.id), eq(studyBlocks.date, TAG)));

// Französisch · Passé composé mit être (Grammatik: üben)
const fr = await fach("Französisch", "F");
const pc = await thema(fr, "Passé composé mit être");
const pcBlatt = await blatt(fr, pc, "Passé composé avec être", addDays(TAG, -11), ABSCHRIFT_FRANZOESISCH);
await fragen(fr, pc, 3, [TAG, addDays(TAG, 3)]);
await fertigesBlatt(pc, "Französisch", "Passé composé mit être", pcBlatt, UEBUNG_FRANZOESISCH, ABSCHRIFT_FRANZOESISCH);

// Physik: heute zweimal gescheitert
const ph = await fach("Physik", "Ph");
const hg = await thema(ph, "Hebelgesetz");
await fragen(ph, hg, 2, [TAG]);
await db.insert(arbeitsblaetter).values({ userId, subjectTopicId: hg, tag: TAG, status: "fehlgeschlagen", versuche: 2 }).onConflictDoNothing();

// Deutsch: das Blatt wird gerade gebaut
const de = await fach("Deutsch", "D");
const ks = await thema(de, "Kommasetzung");
await fragen(de, ks, 2, [TAG]);
await db
  .insert(arbeitsblaetter)
  .values({ userId, subjectTopicId: ks, tag: TAG, status: "laeuft", versuche: 1, fristBis: new Date(Date.now() + 15 * 60_000) })
  .onConflictDoNothing();

// Mathematik · Lange Aufgaben: acht Aufgaben je 40 mm mit langer Frage — Befund der Abnahme von H
// (lief über die Seite). Ohne Termine, also nie fällig; geöffnet nur mit `openTisch({ blatt })`.
const la = await thema(ma, "Lange Aufgaben");
const laQuelle = await blatt(ma, la, "Scheitelpunktform, lange Fassung", addDays(TAG, -3), ABSCHRIFT_MATHE);
const lang = (i: number) => ({
  kurz: i === 3 ? "Symmetrieachsenbestimmungsaufgabe mit Parameterdiskussion" : `Symmetrie ${i}`,
  q: "Gib die Symmetrieachse von {f(x) = −½(x − 5)² + 4} an. Ist die Parabel nach oben oder nach unten geöffnet, gestreckt oder gestaucht? Begründe deine Antwort mit einem ganzen Satz.",
  teile: ["{f(x) = (x − 4)² + 1}", "{g(x) = −(x + 3)² + 2}", "{h(x) = 2(x − 1)² − 5}"],
  platz: 40,
  zitat: "Die Symmetrieachse ist die Gerade x = d.",
  l: [{ art: "p" as const, text: "Die Symmetrieachse ist {x = 5}." }],
});
await fertigesBlatt(la, "Mathematik", "Lange Aufgaben", laQuelle, { teil: "Symmetrie", minuten: 25, grund: "", aufgaben: Array.from({ length: 8 }, (_, i) => lang(i + 1)) }, ABSCHRIFT_MATHE);

// Die Blätter selbst: ohne Schlüssel öffnet ein Thema ohne fertiges Blatt die Karten — die Zustände „gebaut“ und „gescheitert“ zeigt `openTisch({ blatt })`
const blattVon = async (topic: string) =>
  (await db.select({ id: arbeitsblaetter.id }).from(arbeitsblaetter).where(and(eq(arbeitsblaetter.subjectTopicId, topic), eq(arbeitsblaetter.tag, TAG))))[0]?.id ?? null;

console.log(
  JSON.stringify({
    tag: TAG,
    mathe: qf,
    franzoesisch: pc,
    physik: hg,
    deutsch: ks,
    block: block?.id ?? null,
    fachMathe: ma,
    physikBlatt: await blattVon(hg),
    deutschBlatt: await blattVon(ks),
    langBlatt: await blattVon(la),
  }),
);
process.exit(0);
