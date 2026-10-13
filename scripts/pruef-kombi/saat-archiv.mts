import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { exams, homework, subjects, users } from "@/db/schema";

/**
 * Vergangenes für das Archiv (Antwort 11), auf die Saat der Startseite
 * gesetzt (App-Tag dort: Montag, 12.10.2026):
 *
 *   npx tsx scripts/pruef-kombi/saat-startseite.mts
 *   npx tsx scripts/pruef-kombi/saat-archiv.mts
 *
 * - Klausuren am 2.10. (Tag 10: unten in der Liste, blasser) und am
 *   28.9. (Tag 14: noch in der Liste), am 27.9. (Tag 15) und am 10.9.
 *   (beide im Archiv).
 * - Erledigte Aufgaben: am 9.10. abgehakt (Archiv, die Suche findet sie
 *   noch) und am 14.9. (nur noch im Archiv).
 *
 * ⚠ Nur lokal: weigert sich mit `DATABASE_URL`. Legt die Einträge jedes Mal
 * neu an; vorher löscht es die Einträge dieser Saat (am Titel erkannt).
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt. Diese Saat schreibt nur in die lokale Datei-Datenbank. Abgebrochen.");
  process.exit(1);
}

const um = (tag: string, hhmm: string) => new Date(`${tag}T${hhmm}:00+02:00`);

const KLAUSUREN = [
  { fach: "Biologie", title: "Zellteilung", date: "2026-10-02" },
  { fach: "Mathematik", title: "Lineare Gleichungen", date: "2026-09-28" },
  { fach: "Englisch", title: "Unit 2", date: "2026-09-27" },
  { fach: "Geschichte", title: "Französische Revolution", date: "2026-09-10" },
];

const AUFGABEN = [
  { fach: "Mathematik", title: "S. 71, Nr. 1–4", due: "2026-10-09", doneAt: um("2026-10-09", "17:20") },
  { fach: "Deutsch", title: "Lesetagebuch Kapitel 2", due: "2026-09-15", doneAt: um("2026-09-14", "18:05") },
];

async function saat() {
  const [nutzer] = await db.select({ id: users.id }).from(users).where(eq(users.name, "Probe")).limit(1);
  if (!nutzer) throw new Error("Kein Konto „Probe“. Zuerst saat-startseite.mts.");
  const uid = nutzer.id;
  const faecher = await db.select({ id: subjects.id, name: subjects.name }).from(subjects).where(eq(subjects.userId, uid));
  const fach = (name: string) => {
    const f = faecher.find((x) => x.name === name);
    if (!f) throw new Error(`Kein Fach ${name}. Zuerst saat-startseite.mts.`);
    return f.id;
  };

  await db.delete(exams).where(and(eq(exams.userId, uid), inArray(exams.title, KLAUSUREN.map((k) => k.title))));
  await db.delete(homework).where(and(eq(homework.userId, uid), inArray(homework.title, AUFGABEN.map((a) => a.title))));

  await db.insert(exams).values(
    KLAUSUREN.map((k) => ({ userId: uid, subjectId: fach(k.fach), title: k.title, kind: "klausur", date: k.date, leadDays: 5, minutesPerDay: 25 })),
  );
  await db.insert(homework).values(
    AUFGABEN.map((a) => ({ userId: uid, subjectId: fach(a.fach), title: a.title, dueDate: a.due, doneAt: a.doneAt, createdAt: um(a.due, "08:00") })),
  );
  console.log(`Archiv-Saat: ${KLAUSUREN.length} vergangene Klausuren, ${AUFGABEN.length} erledigte Aufgaben.`);
}

saat().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
