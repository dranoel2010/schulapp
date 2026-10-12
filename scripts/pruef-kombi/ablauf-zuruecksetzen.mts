import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { materials, tagesprotokoll, users } from "@/db/schema";
import { appTagGrenzen } from "@/lib/kombi/blaetter";
import { appTagVon } from "@/lib/kombi/tag-daten";

/**
 * Für die Prüfung von Abschnitt C: den heutigen App-Tag zurück auf „Ablauf
 * offen“ — Tagesprotokoll und die heute abgelegten Blätter weg. Nur lokal,
 * nur bei ausgeschaltetem Server, nie mit DATABASE_URL.
 *
 *   npx tsx scripts/pruef-kombi/ablauf-zuruecksetzen.mts
 */
if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL ist gesetzt. Abgebrochen.");
  process.exit(1);
}
const tag = appTagVon(new Date());
const [von] = appTagGrenzen(tag);
const [nutzer] = await db.select({ id: users.id }).from(users).limit(1);
if (nutzer) {
  await db.delete(tagesprotokoll).where(and(eq(tagesprotokoll.userId, nutzer.id), eq(tagesprotokoll.tag, tag)));
  await db.delete(materials).where(and(eq(materials.userId, nutzer.id), gte(materials.createdAt, von)));
}
console.log(`App-Tag ${tag} zurückgesetzt.`);
process.exit(0);
