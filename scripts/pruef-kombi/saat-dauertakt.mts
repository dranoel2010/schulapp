import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { subjectTopics, subjects, users } from "@/db/schema";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * Fragen für „Wiederholen ohne Klausur“ (Antwort 6), auf die Saat der
 * Startseite gesetzt:
 *
 *   npx tsx scripts/pruef-kombi/saat-startseite.mts
 *   npx tsx scripts/pruef-kombi/saat-dauertakt.mts
 *
 * Englisch und Französisch haben keine Klausur; ihre Termine sind im
 * September ausgelaufen, Englisch früher als Französisch. Mathematik hat die
 * Klausur am 16.10. und eine fällige Frage am 12.10. Beim ersten Laden der
 * Startseite legt die App den Dauertakt nach.
 *
 * ⚠ Nur lokal: weigert sich mit `DATABASE_URL`. Löscht vorher alle Fragen
 * des Kontos „Probe“.
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt. Diese Saat schreibt nur in die lokale Datei-Datenbank. Abgebrochen.");
  process.exit(1);
}

const um = (tag: string, hhmm: string) => new Date(`${tag}T${hhmm}:00+02:00`);

async function saat() {
  const [nutzer] = await db.select({ id: users.id }).from(users).where(eq(users.name, "Probe")).limit(1);
  if (!nutzer) throw new Error("Kein Konto „Probe“. Zuerst saat-startseite.mts.");
  const uid = nutzer.id;
  const faecher = await db
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(and(eq(subjects.userId, uid), inArray(subjects.name, ["Englisch", "Französisch", "Mathematik"])));
  const fach = Object.fromEntries(faecher.map((f) => [f.name, f.id]));

  await db.delete(recallItems).where(eq(recallItems.userId, uid));

  const thema = async (subjectId: string, title: string) => {
    const [vorhanden] = await db
      .select({ id: subjectTopics.id })
      .from(subjectTopics)
      .where(and(eq(subjectTopics.userId, uid), eq(subjectTopics.subjectId, subjectId), eq(subjectTopics.title, title)))
      .limit(1);
    if (vorhanden) return vorhanden.id;
    const [z] = await db
      .insert(subjectTopics)
      .values({ userId: uid, subjectId, title, matchKey: title.toLowerCase(), origin: "blatt", lastSeenAt: "2026-09-01", art: "abfragen" })
      .returning({ id: subjectTopics.id });
    return z.id;
  };

  const fragen = async (subjectId: string, topicId: string, n: number, erledigt: string[], offen: string[]) => {
    for (let k = 0; k < n; k++) {
      const [i] = await db
        .insert(recallItems)
        .values({
          userId: uid,
          subjectId,
          subjectTopicId: topicId,
          promptFree: `Frage ${k + 1}`,
          solution: "Lösung",
          misconception: "Verwechslung",
          sourceQuote: "Zitat",
          sourceLength: 6,
          createdAt: um("2026-09-01", "17:00"),
        })
        .returning({ id: recallItems.id });
      const zeilen = [
        ...erledigt.map((d) => ({ dueOn: d, doneAt: um(d, "18:00") as Date | null })),
        ...offen.map((d) => ({ dueOn: d, doneAt: null })),
      ];
      await db
        .insert(recallSchedule)
        .values(zeilen.map((z, r) => ({ itemId: i.id, dueOn: z.dueOn, doneAt: z.doneAt, round: r + 1, sortOrder: r })));
    }
  };

  await fragen(fach.Englisch, await thema(fach.Englisch, "Wortschatz Reisen"), 6, ["2026-09-04", "2026-09-10"], []);
  await fragen(fach["Französisch"], await thema(fach["Französisch"], "Vocabulaire Unité 2"), 5, ["2026-09-08", "2026-09-20"], []);
  await fragen(fach.Mathematik, await thema(fach.Mathematik, "Quadratische Funktionen"), 4, [], ["2026-10-12", "2026-10-14"]);
  console.log("Fragen für Wiederholen ohne Klausur angelegt (Englisch, Französisch, Mathematik).");
}

saat().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
