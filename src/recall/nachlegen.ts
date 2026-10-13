import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { arbeitsblaetter } from "@/db/schema";
import { nachlegenPlan } from "@/recall/dauertakt";
import { naechsteKlausur } from "@/recall/items";
import { recallItems, recallSchedule } from "@/recall/schema";
import { sperrtageAb } from "@/recall/source";
import { appTagVon, themenAufloeser } from "@/recall/themen";

/**
 * Legt den Dauertakt nach (Antwort 6, siehe @/recall/dauertakt): Jeder
 * Übungsbaustein in einem Fach ohne anstehende Klausur, der keinen offenen
 * Termin mehr hat, bekommt genau einen neuen, `DAUERTAKT` Tage nach dem
 * letzten Kontakt (Betriebsart `erhaltung`).
 *
 * Läuft beim Laden der Startseite (`ladeTag()`). Es schreibt nur, wo ein
 * Termin fehlt, und ist deshalb beliebig oft aufrufbar: Der Tag des neuen
 * Termins hängt nicht am heutigen Tag, sondern am letzten Kontakt.
 *
 * Gleichzeitige Aufrufe (Server-Render und `/api/tag/daten` beim Neuladen)
 * laufen nacheinander: Das Lesen der Termine und das Schreiben stehen in
 * einer Transaktion, die zuerst eine Sperre je Nutzer nimmt
 * (`pg_advisory_xact_lock`). Ohne sie sähe unter READ COMMITTED keiner der
 * beiden die noch nicht festgeschriebene Zeile des anderen, und beide
 * schrieben ihren Termin. Die Sperre endet mit der Transaktion.
 *
 * Auch das Epochenfach bekommt den Dauertakt, solange dort keine Klausur
 * ansteht: Sonst verschwänden seine Themen nach dem Grundtakt ganz. Auf der
 * Startseite zählt es nicht zur Grenze „eins am Tag“ (`zaehltZurGrenze()`).
 *
 * Fächer mit Klausur plant der Lernplan (`createItem()`/`neuPlanen()`). Steht
 * dort aber vor der Klausur kein zählender Termin mehr offen (die Klausur kam
 * erst, als der Baustein seine Termine schon hinter sich hatte, oder sein
 * Dauertakt-Termin liegt hinter ihr), rechnet dieselbe Funktion die Termine
 * bis zur Klausur ab dem letzten Kontakt nach (`nachlegenPlan()`). Sonst
 * schaltete ausgerechnet ein angekündigter Test das Abfragen ab.
 *
 * Bausteine des Messvorrats bekommen nie einen Termin (A12), zurückgezogene
 * auch nicht.
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
  const ids = bausteine.map((b) => b.id);
  const aufloesen = await themenAufloeser(userId);

  // Jüngste Auswertung eines Arbeitsblatts je (aufgelöstem) Thema
  const themaVon = new Map(bausteine.map((b) => [b.id, aufloesen(b.subjectTopicId)?.id ?? null]));
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

  // Ferien sperren nur die Termine bis zur Klausur; der Dauertakt-Tag rückt beim Anzeigen
  const sperrtage = [...klausuren.values()].some(Boolean) ? await sperrtageAb(userId, heute) : [];

  // Ab hier unter der Sperre je Nutzer: Termine lesen und schreiben (siehe Kopf).
  // In der Transaktion nur `tx`, nie `db`: PGlite hat eine einzige Verbindung.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dauertakt:${userId}`}))`);
    const termine = await tx
      .select({
        itemId: recallSchedule.itemId,
        dueOn: recallSchedule.dueOn,
        doneAt: recallSchedule.doneAt,
        round: recallSchedule.round,
        sortOrder: recallSchedule.sortOrder,
      })
      .from(recallSchedule)
      .where(inArray(recallSchedule.itemId, ids));
    const jeBaustein = new Map<string, typeof termine>();
    for (const t of termine) {
      const l = jeBaustein.get(t.itemId) ?? [];
      l.push(t);
      jeBaustein.set(t.itemId, l);
    }

    let neu = 0;
    for (const b of bausteine) {
      const t = jeBaustein.get(b.id) ?? [];
      const thema = themaVon.get(b.id);
      const ausg = thema ? (ausgewertet.get(thema) ?? null) : null;
      const erledigt = t.flatMap((x) => (x.doneAt ? [appTagVon(x.doneAt)] : [])).sort();
      const klausurtag = klausuren.get(b.subjectId) ?? null;
      const plan = nachlegenPlan({
        klausurtag,
        heute,
        sperrtage,
        offen: t.filter((x) => !x.doneAt).map((x) => x.dueOn),
        zuletzt: erledigt.at(-1) ?? null,
        aufgenommen: appTagVon(b.createdAt),
        ausgewertet: ausg,
      });
      if (plan.length === 0) continue;
      const runde = t.reduce((m, x) => Math.max(m, x.round), 0) + 1;
      const sortierung = t.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1;
      if (klausurtag) {
        // Unter der Sperre gelesen und geschrieben: kein zweiter Aufruf sieht diesen Stand
        await tx.insert(recallSchedule).values(
          plan.map((f, k) => ({ itemId: b.id, dueOn: f.dueOn, round: runde + k, mode: f.mode, sortOrder: sortierung + k })),
        );
        neu += plan.length;
        continue;
      }
      const tag = plan[0].dueOn;
      // Zweite Sicherung neben der Sperre: geschrieben wird nur, solange kein zählender offener Termin da ist
      const ergebnis: unknown = await tx.execute(sql`
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
  });
}
