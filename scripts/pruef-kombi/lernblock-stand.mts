import { and, eq, like } from "drizzle-orm";

import { db } from "@/db";
import { studyBlocks, tagesprotokoll, users } from "@/db/schema";
import { todayInBerlin } from "@/lib/dates";
import { faelligHeute } from "@/recall/sessions";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * Nach `lernblock-karten.mjs` (PHASE=ablauf), bei angehaltenem Server: was am
 * Server steht. Kriterium 47 (die im Block gesessenen Fragen sind auch für
 * Wiederholen erledigt) und Rückgängig nach dem Wiederöffnen (Minuten und
 * `lernblock_erledigt` wieder da).
 *
 *   npx tsx scripts/pruef-kombi/lernblock-stand.mts
 */

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt — abgebrochen, nur lokal.");
  process.exit(1);
}

async function main() {
  const [nutzer] = await db.select({ id: users.id }).from(users).where(eq(users.name, "Probe"));
  const heute = todayInBerlin();
  const saat = await db
    .select({ id: recallItems.id, doneAt: recallSchedule.doneAt })
    .from(recallItems)
    .innerJoin(recallSchedule, eq(recallSchedule.itemId, recallItems.id))
    .where(and(eq(recallItems.userId, nutzer.id), eq(recallItems.sourceQuote, "Saat Lernblock")));
  const faellig = await faelligHeute(nutzer.id, heute);
  const offen = faellig.filter((f) => saat.some((s) => s.id === f.itemId));
  console.log(`Fragen der Saat: ${saat.length}, mit done_at: ${saat.filter((s) => s.doneAt).length}`);
  console.log(`davon heute noch fällig (Wiederholen): ${offen.length}`);

  const bloecke = await db.select().from(studyBlocks).where(eq(studyBlocks.date, heute));
  for (const b of bloecke) {
    const eintraege = await db
      .select({ typ: tagesprotokoll.typ })
      .from(tagesprotokoll)
      .where(and(eq(tagesprotokoll.ref, b.id), like(tagesprotokoll.typ, "lernblock\\_%")));
    console.log(
      `Block ${b.date} ${b.status} minuten_gelernt=${b.minutenGelernt} protokoll=${eintraege.map((e) => e.typ).join(",")}`,
    );
  }
  const gruen = saat.length === 3 && offen.length === 0 && saat.every((s) => s.doneAt);
  console.log(gruen ? "Kriterium 47: grün" : "Kriterium 47: NICHT grün");
  process.exit(gruen ? 0 : 1);
}

void main();
