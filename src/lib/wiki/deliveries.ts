import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { wikiDeliveries, type WikiDelivery } from "@/db/schema";
import type { WikiDocument } from "@/lib/wiki/documents";

/**
 * Das Gedächtnis der Übergabe — Zugriff auf `wiki_deliveries`.
 *
 * Warum es diese Tabelle gibt und wie ihre Spalten gemeint sind, steht
 * ausführlich am Tabellenkommentar in src/db/schema.ts. Hier stehen nur die
 * beiden Wege dorthin: nachsehen, was schon geliefert wurde, und festhalten,
 * was gerade geliefert wurde.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche, kein Import aus
 * Next. Jede Abfrage filtert nach userId, auch dort, wo die `doc_id` schon
 * eindeutig wäre — dieselbe Regel wie überall sonst in @/lib.
 */

/**
 * So viele Zeilen fasst eine gebündelte Anweisung höchstens.
 *
 * Dieselbe Zahl und derselbe Grund wie in @/lib/subject-topics: Postgres nimmt
 * 65535 Parameter je Anweisung entgegen, bei sechs Parametern je Zeile wäre die
 * Grenze erst bei gut zehntausend Zeilen erreicht. Der erste Lauf eines
 * Schuljahres schreibt ein paar hundert; die Schranke ist da, damit aus „drei
 * Jahre Bestand auf einmal" keine Anweisung wird, die die Datenbank zurückweist.
 */
const MAX_ROWS_PER_STATEMENT = 200;

/**
 * Was von einem Nutzer schon im Wiki liegt, nach Kennung nachschlagbar.
 *
 * Alle Zeilen auf einmal und nicht eine Frage je Dokument: Ein Bestand von
 * tausend Dokumenten wären sonst tausend Wege zur Datenbank für einen Lauf,
 * der ohnehin alles vergleicht.
 */
export async function listDeliveries(
  userId: string,
): Promise<Map<string, WikiDelivery>> {
  const rows = await db
    .select()
    .from(wikiDeliveries)
    .where(eq(wikiDeliveries.userId, userId));

  return new Map(rows.map((row) => [row.docId, row]));
}

/** Ein Dokument mit dem Abdruck, unter dem es abgelegt wurde. */
export type DeliveredDocument = {
  document: WikiDocument;
  hash: string;
};

/**
 * Schreibt fest, was gerade übergeben wurde — und vergisst, was es nicht mehr
 * gibt.
 *
 * **Aufgerufen wird das erst, wenn der Übergabeordner an seinem Platz steht.**
 * Die umgekehrte Reihenfolge wäre die gefährliche: die App hielte Dateien für
 * abgeliefert, die nie ankamen, und lieferte sie nie wieder — der Vault hätte
 * eine Lücke, die niemand mehr sieht. So herum ist der schlimmste Fall eine
 * doppelte Lieferung desselben Inhalts unter derselben Kennung, und die legt
 * der Agent übereinander statt nebeneinander.
 *
 * Beides in EINER Transaktion. Ein Lauf, der die neuen Abdrücke schreibt und
 * beim Vergessen der gelöschten abbricht, meldete den Wegfall beim nächsten Mal
 * ein zweites Mal — die Meldung stünde dann in zwei MANIFEST.md, und die zweite
 * wäre eine Behauptung über etwas, das der Agent längst weggeräumt hat.
 */
export async function recordDeliveries(input: {
  userId: string;
  /** Name des Ordners, in dem die Dateien liegen, z.B. "2026-09-05". */
  folder: string;
  deliveredAt: Date;
  written: readonly DeliveredDocument[];
  /** Kennungen, deren Entität es nicht mehr gibt. */
  removed: readonly string[];
}): Promise<void> {
  if (input.written.length === 0 && input.removed.length === 0) return;

  await db.transaction(async (tx) => {
    for (const teil of chunks(input.written, MAX_ROWS_PER_STATEMENT)) {
      await tx
        .insert(wikiDeliveries)
        .values(
          teil.map(({ document, hash }) => ({
            userId: input.userId,
            docId: document.id,
            kind: document.kind,
            title: document.title,
            hash,
            folder: input.folder,
            deliveredAt: input.deliveredAt,
          })),
        )
        // Die Zeile gibt es beim zweiten Mal schon — geändert hat sich alles
        // ausser der Kennung. `excluded` ist die Zeile, die einfügen wollte;
        // sie steht hier, weil bei einer gebündelten Anweisung jede Zeile ihre
        // eigenen Werte braucht und ein festes `set` allen denselben gäbe.
        .onConflictDoUpdate({
          target: [wikiDeliveries.userId, wikiDeliveries.docId],
          set: {
            kind: sql`excluded.kind`,
            title: sql`excluded.title`,
            hash: sql`excluded.hash`,
            folder: sql`excluded.folder`,
            deliveredAt: sql`excluded.delivered_at`,
          },
        });
    }

    for (const teil of chunks(input.removed, MAX_ROWS_PER_STATEMENT)) {
      await tx
        .delete(wikiDeliveries)
        .where(
          and(
            eq(wikiDeliveries.userId, input.userId),
            inArray(wikiDeliveries.docId, [...teil]),
          ),
        );
    }
  });
}

/** Zerlegt eine Liste in Stücke von höchstens `size` Einträgen. */
function chunks<T>(values: readonly T[], size: number): T[][] {
  const stuecke: T[][] = [];

  for (let i = 0; i < values.length; i += size) {
    stuecke.push(values.slice(i, i + size));
  }

  return stuecke;
}
