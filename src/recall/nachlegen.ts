import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { arbeitsblaetter } from "@/db/schema";
import { dauertaktTermin } from "@/recall/dauertakt";
import { naechsteKlausur } from "@/recall/items";
import { recallItems, recallSchedule } from "@/recall/schema";
import { appTagVon, themenAufloeser } from "@/recall/themen";

/**
 * Legt den Dauertakt nach (Antwort 6, siehe @/recall/dauertakt): Jeder
 * Übungsbaustein in einem Fach ohne anstehende Klausur, der keinen offenen
 * Termin mehr hat, bekommt genau einen neuen, `DAUERTAKT` Tage nach dem
 * letzten Kontakt (Betriebsart `erhaltung`).
 *
 * Läuft beim Laden der Startseite (`ladeTag()`). Es schreibt nur, wo ein
 * Termin fehlt, und ist deshalb beliebig oft aufrufbar: Der Tag des neuen
 * Termins hängt nicht am heutigen Tag, sondern am letzten Kontakt. Zwei
 * gleichzeitige Aufrufe legen keinen Termin doppelt an, weil jede Zeile nur
 * geschrieben wird, solange kein zählender offener Termin da ist.
 *
 * Bausteine des Messvorrats bekommen nie einen Termin (A12), zurückgezogene
 * auch nicht. Fächer mit Klausur plant weiter `createItem()`/`neuPlanen()`.
 *
 * @returns die Zahl der neu angelegten Termine
 */
export async function dauertaktNachlegen(userId: string, heute: string): Promise<number> {
  const bausteine = await db
    .select({
      id: recallItems.id,
      subjectId: recallItems.subjectId,
      subjectTopicId: recallItems.subjectTopicId,
      createdAt: recallItems.createdAt,
    })
    .from(recallItems)
    .where(and(eq(recallItems.userId, userId), isNull(recallItems.retiredAt), eq(recallItems.role, "uebung")));
  if (bausteine.length === 0) return 0;

  const faecher = [...new Set(bausteine.map((b) => b.subjectId))];
  const klausuren = new Map(
    await Promise.all(faecher.map(async (id) => [id, await naechsteKlausur(userId, id, heute)] as const)),
  );
  const ohneKlausur = bausteine.filter((b) => !klausuren.get(b.subjectId));
  if (ohneKlausur.length === 0) return 0;

  const ids = ohneKlausur.map((b) => b.id);
  const [termine, aufloesen] = await Promise.all([
    db
      .select({
        itemId: recallSchedule.itemId,
        dueOn: recallSchedule.dueOn,
        doneAt: recallSchedule.doneAt,
        round: recallSchedule.round,
        sortOrder: recallSchedule.sortOrder,
      })
      .from(recallSchedule)
      .where(inArray(recallSchedule.itemId, ids)),
    themenAufloeser(userId),
  ]);

  const jeBaustein = new Map<string, typeof termine>();
  for (const t of termine) {
    const l = jeBaustein.get(t.itemId) ?? [];
    l.push(t);
    jeBaustein.set(t.itemId, l);
  }

  // Jüngste Auswertung eines Arbeitsblatts je (aufgelöstem) Thema
  const themaVon = new Map(ohneKlausur.map((b) => [b.id, aufloesen(b.subjectTopicId)?.id ?? null]));
  const topicIds = [...new Set([...themaVon.values()].filter((t): t is string => !!t))];
  const ausgewertet = new Map<string, string>();
  if (topicIds.length) {
    const blaetter = await db
      .select({ subjectTopicId: arbeitsblaetter.subjectTopicId, ausgewertetAm: arbeitsblaetter.ausgewertetAm })
      .from(arbeitsblaetter)
      .where(
        and(
          eq(arbeitsblaetter.userId, userId),
          isNotNull(arbeitsblaetter.ausgewertetAm),
          inArray(arbeitsblaetter.subjectTopicId, topicIds),
        ),
      );
    for (const z of blaetter) {
      if (!z.subjectTopicId || !z.ausgewertetAm) continue;
      const tag = appTagVon(z.ausgewertetAm);
      const alt = ausgewertet.get(z.subjectTopicId);
      if (!alt || tag > alt) ausgewertet.set(z.subjectTopicId, tag);
    }
  }

  let neu = 0;
  for (const b of ohneKlausur) {
    const t = jeBaustein.get(b.id) ?? [];
    const thema = themaVon.get(b.id);
    const ausg = thema ? (ausgewertet.get(thema) ?? null) : null;
    const erledigt = t.flatMap((x) => (x.doneAt ? [appTagVon(x.doneAt)] : [])).sort();
    const tag = dauertaktTermin({
      klausur: false,
      offen: t.filter((x) => !x.doneAt).map((x) => x.dueOn),
      zuletzt: erledigt.at(-1) ?? null,
      aufgenommen: appTagVon(b.createdAt),
      ausgewertet: ausg,
    });
    if (!tag) continue;
    const runde = t.reduce((m, x) => Math.max(m, x.round), 0) + 1;
    const sortierung = t.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1;
    // Ein Schritt in der Datenbank: geschrieben wird nur, solange kein zählender offener Termin da ist
    const ergebnis: unknown = await db.execute(sql`
      insert into recall_schedule (item_id, due_on, round, mode, sort_order)
      select ${b.id}::uuid, ${tag}::date, ${runde}::int, 'erhaltung', ${sortierung}::int
      where not exists (
        select 1 from recall_schedule
        where item_id = ${b.id}::uuid and done_at is null
          and (${ausg}::date is null or due_on > ${ausg}::date)
      )
      returning id`);
    // postgres-js liefert die Zeilen als Array, PGlite als `{ rows }`
    const zeilen = Array.isArray(ergebnis) ? ergebnis : ((ergebnis as { rows?: unknown[] }).rows ?? []);
    neu += zeilen.length;
  }
  return neu;
}
