import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { tagesprotokoll } from "@/db/schema";

/**
 * Das Tagesprotokoll (Modell 23, Plan 3.3): was an einem App-Tag geschah.
 *
 * Daraus rechnet der Server die Ansicht (Ablauf erledigt oder übersprungen?),
 * den Schritt des Ablaufs und was heute eingetragen wurde. Rückgängig löscht
 * den zugehörigen Eintrag wieder (Kriterium 57): jede Action, die
 * protokolliert, gibt die Protokoll-ID zurück, Rückgängig ruft die
 * Gegen-Action und danach `protokollLoeschen`.
 *
 * `tag` ist immer der App-Tag (Wechsel 04:00, `appTag()`), nie der
 * Kalendertag.
 *
 * Die Typen stehen hier und nicht als CHECK in der Datenbank: ein neuer Typ
 * bleibt so eine Zeile Code und keine Wanderung mit `DROP CONSTRAINT`.
 */
export const PROTOKOLL_TYPEN = [
  "ablauf_schritt",
  "ablauf_beendet",
  "ablauf_uebersprungen",
  "aufgabe_eingetragen",
  "aufgabe_abgehakt",
  "aufgabe_geoeffnet",
  "aufgabe_geloescht",
  "blatt_abgelegt",
  "seite_dazu",
  "thema_art",
  "thema_beendet",
  "frage_zurueckgezogen",
  "lernblock_gestartet",
  "lernblock_pausiert",
  "lernblock_fortgesetzt",
  "lernblock_erledigt",
  "blatt_gedruckt",
  "blatt_ausgewertet",
] as const;

export type ProtokollTyp = (typeof PROTOKOLL_TYPEN)[number];

/** Die beiden Schritte des Ablaufs nach der Schule. */
export type AblaufSchritt = "blaetter" | "ha";

export type AblaufStand = "erledigt" | "übersprungen" | null;

const eintragSchema = z.object({
  userId: z.uuid(),
  tag: z.iso.date(),
  typ: z.enum(PROTOKOLL_TYPEN),
  ref: z.string().min(1).max(200).nullable(),
  daten: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * Schreibt einen Eintrag und gibt seine ID zurück. Ein unbekannter `typ`
 * wird abgewiesen (zod), bevor etwas in der Datenbank ankommt.
 */
export async function protokollieren(
  userId: string,
  tag: string,
  typ: ProtokollTyp,
  ref?: string | null,
  daten?: Record<string, unknown> | null,
): Promise<string> {
  const eintrag = eintragSchema.parse({
    userId,
    tag,
    typ,
    ref: ref ?? null,
    daten: daten ?? null,
  });

  const [zeile] = await db
    .insert(tagesprotokoll)
    .values(eintrag)
    .returning({ id: tagesprotokoll.id });
  return zeile.id;
}

/** Rückgängig: löscht genau diesen Eintrag dieses Nutzers. */
export async function protokollLoeschen(
  userId: string,
  id: string,
): Promise<void> {
  await db
    .delete(tagesprotokoll)
    .where(and(eq(tagesprotokoll.userId, userId), eq(tagesprotokoll.id, id)));
}

/** Alle Einträge eines Tages, älteste zuerst. */
export async function protokollVomTag(userId: string, tag: string) {
  return db
    .select()
    .from(tagesprotokoll)
    .where(and(eq(tagesprotokoll.userId, userId), eq(tagesprotokoll.tag, tag)))
    .orderBy(asc(tagesprotokoll.createdAt));
}

/**
 * Wie der Ablauf nach der Schule an diesem Tag ausging: `erledigt` vor
 * `übersprungen` (wer erst übersprang und ihn dann aus der Zeile doch
 * abschloss, hat ihn erledigt), sonst null.
 */
export async function ablaufStand(
  userId: string,
  tag: string,
): Promise<AblaufStand> {
  const zeilen = await db
    .select({ typ: tagesprotokoll.typ })
    .from(tagesprotokoll)
    .where(
      and(
        eq(tagesprotokoll.userId, userId),
        eq(tagesprotokoll.tag, tag),
        inArray(tagesprotokoll.typ, ["ablauf_beendet", "ablauf_uebersprungen"]),
      ),
    );
  if (zeilen.some((z) => z.typ === "ablauf_beendet")) return "erledigt";
  if (zeilen.some((z) => z.typ === "ablauf_uebersprungen")) return "übersprungen";
  return null;
}

/** Der Schritt, bei dem er zuletzt war; ohne Eintrag `blaetter`. */
export async function ablaufSchritt(
  userId: string,
  tag: string,
): Promise<AblaufSchritt> {
  const [zeile] = await db
    .select({ ref: tagesprotokoll.ref })
    .from(tagesprotokoll)
    .where(
      and(
        eq(tagesprotokoll.userId, userId),
        eq(tagesprotokoll.tag, tag),
        eq(tagesprotokoll.typ, "ablauf_schritt"),
      ),
    )
    .orderBy(desc(tagesprotokoll.createdAt))
    .limit(1);
  return zeile?.ref === "ha" ? "ha" : "blaetter";
}

/**
 * Die Aufgaben, die heute eingetragen und nicht wieder gelöscht wurden —
 * als IDs (`ref` des Eintrags). Hängt an der ID: wird eine gelöschte Aufgabe
 * mit ihrer alten ID wiederhergestellt und der Eintrag `aufgabe_geloescht`
 * entfernt, zählt sie wieder genau einmal.
 */
export async function eingetragenHeute(
  userId: string,
  tag: string,
): Promise<string[]> {
  const zeilen = await db
    .select({ typ: tagesprotokoll.typ, ref: tagesprotokoll.ref })
    .from(tagesprotokoll)
    .where(
      and(
        eq(tagesprotokoll.userId, userId),
        eq(tagesprotokoll.tag, tag),
        inArray(tagesprotokoll.typ, ["aufgabe_eingetragen", "aufgabe_geloescht"]),
      ),
    )
    .orderBy(asc(tagesprotokoll.createdAt));

  const geloescht = new Set(
    zeilen.filter((z) => z.typ === "aufgabe_geloescht").map((z) => z.ref),
  );
  const ids: string[] = [];
  for (const z of zeilen) {
    if (z.typ !== "aufgabe_eingetragen" || !z.ref) continue;
    if (geloescht.has(z.ref) || ids.includes(z.ref)) continue;
    ids.push(z.ref);
  }
  return ids;
}

/**
 * „Block beenden“ unter einer Minute: der Block geht zurück auf Ruhe, und es
 * bleibt keine Spur im Protokoll. Löscht alle `lernblock_*`-Einträge des
 * Tages zu diesem Block (`ref` = Block-ID). Gibt die Zahl zurück.
 */
export async function lernblockEreignisseLoeschen(
  userId: string,
  tag: string,
  blockId: string,
): Promise<number> {
  const weg = await db
    .delete(tagesprotokoll)
    .where(
      and(
        eq(tagesprotokoll.userId, userId),
        eq(tagesprotokoll.tag, tag),
        eq(tagesprotokoll.ref, blockId),
        like(tagesprotokoll.typ, "lernblock\\_%"),
      ),
    )
    .returning({ id: tagesprotokoll.id });
  return weg.length;
}
