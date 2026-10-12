import { sql } from "drizzle-orm";

import { db } from "@/db";
import { norm } from "@/lib/kombi/fach-alias";

/**
 * Volltextsuche über die Blätter (Modell 23, Plan 3.7) für die Zeile.
 *
 * - Jedes Wort ab drei Zeichen wird zum Präfix (`wort:*`), kürzere müssen
 *   als ganzes Wort stehen; **alle** Wörter müssen treffen — in Titel, Thema,
 *   Fachname oder Abschrift, zusammen genommen wie der Prototyp
 *   (`serverSuche`, Z. 2451). Konfiguration 'simple': kein Stemmer, keine
 *   Stoppwörter, also dasselbe wie `startsWith` im Prototyp.
 * - Rang je Wort: Treffer im Titel 4, im Thema 2, sonst 1 (Titel vor Thema
 *   vor Text). Bei Gleichstand das jüngere Blatt zuerst.
 * - `unaccent` fehlt in PGlite. Deshalb bekommt jedes Wort seine Umlaut-
 *   Schreibweisen als Alternative mit: „dampfmaschiene“ bleibt, aber „kaese“
 *   findet auch „Käse“ und „Käse“ auch „kaese“ (ä/ae, ö/oe, ü/ue, ß/ss).
 * - Die Vorauswahl läuft über die beiden GIN-Indizes aus
 *   `scripts/kombi-suche.sql` (derselbe Ausdruck, sonst nimmt Postgres sie
 *   nicht); erst danach wird auf „alle Wörter“ geprüft.
 * - Der Ausschnitt ist derselbe wie im Prototyp (`snippet`): drei Wörter vor
 *   dem ersten Treffer, sechs danach, „…“ an abgeschnittenen Enden, ohne die
 *   ⟨⟩ der unsicheren Stellen.
 */

export type BlattSuchtreffer = {
  id: string;
  titel: string;
  fachId: string;
  seiteId: string | null;
  ausschnitt: string;
  rang: number;
};

/** Wörter der Anfrage in Originalschreibweise (mit Umlauten), klein. */
export function suchWoerter(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
}

/** Schreibweisen eines Worts: wie getippt, mit Umlauten, mit ae/oe/ue/ss. */
export function schreibweisen(w: string): string[] {
  const aus = w.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const ein = w.replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü");
  const ss = ein.replace(/ss/g, "ß");
  return [...new Set([w, aus, ein, ss])].filter((x) => /^[\p{L}\p{N}]+$/u.test(x));
}

/**
 * Ein Wort als tsquery wie `wordHit` im Prototyp (Z. 2349): ab drei Zeichen
 * ein Präfix (`wort:*`), darunter nur das ganze Wort. Immer mit der
 * Konfiguration 'simple' — ohne Stemmer (sonst wird „industrie“ zu
 * „industri:*“ und trifft „Industrialisierung“) und ohne Stoppwortliste
 * (sonst fallen „nach“, „über“ still weg und „alle Wörter“ gilt nicht mehr).
 */
export const teilQuery = (w: string) =>
  `(${schreibweisen(w).map((x) => (w.length >= 3 ? `${x}:*` : x)).join(" | ")})`;

/** Text der Abschrift für den Ausschnitt: ohne ⟨⟩ und Auszeichnung. */
export function abschriftText(s: string): string {
  return s.replace(/[⟨⟩{}#*_`]/g, "").replace(/\s+/g, " ").trim();
}

const textWords = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Ausschnitt um den ersten Treffer (Prototyp `snippet`, Z. 2468). */
export function ausschnitt(text: string, qs: readonly string[]): string {
  const ws = text.split(/\s+/).filter(Boolean);
  const i = ws.findIndex((w) => qs.some((q) => textWords(w).some((x) => x.startsWith(q))));
  if (i < 0) return "";
  const a = Math.max(0, i - 3);
  const z = Math.min(ws.length, i + 6);
  return (a > 0 ? "… " : "") + ws.slice(a, z).join(" ") + (z < ws.length ? " …" : "");
}

/**
 * @param woerter die Wörter, die geprüft werden (schon ohne Füllwörter)
 * @param markieren die Wörter, um die der Ausschnitt liegt (normalisiert); leer = `woerter`
 */
export async function sucheBlaetter(
  userId: string,
  woerter: readonly string[],
  limit = 8,
  markieren: readonly string[] = [],
): Promise<BlattSuchtreffer[]> {
  const ws = woerter.filter(Boolean);
  if (!ws.length) return [];
  const alle = ws.map(teilQuery).join(" & ");
  const irgendeins = ws.map(teilQuery).join(" | ");

  const result = await db.execute<{
    id: string;
    titel: string;
    fach_id: string;
    seite_id: string | null;
    text: string | null;
    treffer: string;
  }>(sql`
    with kandidat as (
      select m.id from materials m
       where m.user_id = ${userId}
         and to_tsvector('simple', coalesce(m.title, '')) @@ to_tsquery('simple', ${irgendeins})
      union
      select p.material_id from material_pages p
        join materials m on m.id = p.material_id and m.user_id = ${userId}
       where to_tsvector('simple', coalesce(p.transcript, '')) @@ to_tsquery('simple', ${irgendeins})
      union
      select mt.material_id from material_topics mt
        join subject_topics st on st.id = mt.subject_topic_id
        join materials m on m.id = mt.material_id and m.user_id = ${userId}
       where to_tsvector('simple', st.title) @@ to_tsquery('simple', ${irgendeins})
      union
      select m.id from materials m
        join subjects s on s.id = m.subject_id
       where m.user_id = ${userId}
         and to_tsvector('simple', s.name) @@ to_tsquery('simple', ${irgendeins})
    ),
    blatt as (
      select m.id, m.title as titel, m.subject_id as fach_id, m.captured_on, m.created_at,
             s.name as fach,
             (select string_agg(st.title, ' ') from material_topics mt
                join subject_topics st on st.id = mt.subject_topic_id
               where mt.material_id = m.id) as themen,
             (select string_agg(coalesce(p.transcript, ''), ' ' order by p.sort_order) from material_pages p
               where p.material_id = m.id) as text,
             (select p.id from material_pages p where p.material_id = m.id order by p.sort_order limit 1) as seite_id
        from materials m
        join subjects s on s.id = m.subject_id
       where m.id in (select id from kandidat)
    )
    select id, titel, fach_id, seite_id, text,
           -- je Wort: 4 im Titel, 2 im Thema, sonst 1
           ${sql.join(
             ws.map(
               (w) => sql`(case when to_tsvector('simple', coalesce(titel, '')) @@ to_tsquery('simple', ${teilQuery(w)}) then 4
                               when to_tsvector('simple', coalesce(themen, '')) @@ to_tsquery('simple', ${teilQuery(w)}) then 2
                               else 1 end)`,
             ),
             sql` + `,
           )} as treffer
      from blatt
     where (to_tsvector('simple', coalesce(titel, '')) || to_tsvector('simple', coalesce(themen, ''))
            || to_tsvector('simple', coalesce(fach, '')) || to_tsvector('simple', coalesce(text, '')))
           @@ to_tsquery('simple', ${alle})
     order by treffer desc, captured_on desc, created_at desc
     limit ${limit}
  `);

  const zeilen = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
    id: string;
    titel: string;
    fach_id: string;
    seite_id: string | null;
    text: string | null;
    treffer: number | string;
  }[];
  const mark = markieren.length ? markieren : ws.map((w) => norm(w));
  return zeilen.map((z) => ({
    id: z.id,
    titel: z.titel,
    fachId: z.fach_id,
    seiteId: z.seite_id,
    ausschnitt: ausschnitt(abschriftText(z.text ?? ""), mark),
    rang: Number(z.treffer),
  }));
}
