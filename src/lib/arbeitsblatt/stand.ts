import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  arbeitsblaetter,
  arbeitsblattWertung,
  type ArbeitsblattStatus,
} from "@/db/schema";
import {
  FRIST_MS,
  MAX_VERSUCHE,
  type ArbeitsblattInhalt,
} from "@/lib/arbeitsblatt/schema";
import { protokollieren } from "@/lib/protokoll";

/**
 * Der Lebenslauf eines Arbeitsblatts in der Datenbank (Modell 23, Plan 3.6,
 * „Hängende und gescheiterte Läufe“):
 *
 *   wartet ─► laeuft ─► fertig
 *                 └──► fehlgeschlagen
 *
 * - Höchstens ein Blatt je Thema und App-Tag, eins je Lernblock (Unique-
 *   Indizes). Angelegt wird idempotent.
 * - Ein Bau beginnt per UPDATE: `laeuft`, `frist_bis = jetzt + 15 min`,
 *   `versuche + 1`. Neu angestoßen werden nur `wartet`, `fehlgeschlagen` und
 *   hängende Zeilen (`laeuft` mit abgelaufener Frist), nie per neuer Zeile.
 * - Höchstens MAX_VERSUCHE (2) je Blatt; danach bleibt `fehlgeschlagen`
 *   Endstatus für den Tag.
 * - `fertig` und `fehlgeschlagen` sind Endstatus: das Nachfragen der
 *   Oberfläche endet dort.
 *
 * Den Bau selbst (Opus, zod, Warteschlange an `globalThis`) bringt Abschnitt
 * H in `bauen.ts`; diese Datei ist nur der Zustand.
 */

export type ArbeitsblattZeile = typeof arbeitsblaetter.$inferSelect;

export function istEndstatus(status: ArbeitsblattStatus): boolean {
  return status === "fertig" || status === "fehlgeschlagen";
}

/** `laeuft`, aber die Frist ist vorbei: der Container wurde neu gestartet. */
export function istHaengend(
  zeile: Pick<ArbeitsblattZeile, "status" | "fristBis">,
  now: Date,
): boolean {
  return (
    zeile.status === "laeuft" &&
    (zeile.fristBis === null || zeile.fristBis.getTime() <= now.getTime())
  );
}

/** Darf ein neuer Bau starten? */
export function darfBauen(
  zeile: Pick<ArbeitsblattZeile, "status" | "fristBis" | "versuche">,
  now: Date,
): boolean {
  if (zeile.versuche >= MAX_VERSUCHE) return false;
  if (zeile.status === "wartet" || zeile.status === "fehlgeschlagen") return true;
  return istHaengend(zeile, now);
}

/** Soll die Oberfläche weiter nachfragen (alle 3 s)? */
export function weiterNachfragen(
  zeile: Pick<ArbeitsblattZeile, "status" | "fristBis">,
  now: Date,
): boolean {
  if (istEndstatus(zeile.status)) return false;
  if (zeile.status === "laeuft") return !istHaengend(zeile, now);
  return true;
}

export type Ziel =
  | { subjectTopicId: string; studyBlockId?: string | null }
  | { subjectTopicId?: null; studyBlockId: string };

/**
 * Das Blatt für dieses Ziel an diesem Tag — angelegt, falls es noch keins
 * gibt. Ein Blatt für einen Block ohne Fach-Thema hängt nur am Block.
 */
export async function arbeitsblattFuer(
  userId: string,
  ziel: Ziel,
  tag: string,
): Promise<ArbeitsblattZeile> {
  const themaId = ziel.subjectTopicId ?? null;
  const blockId = ziel.studyBlockId ?? null;

  const vorhanden = await db
    .select()
    .from(arbeitsblaetter)
    .where(
      and(
        eq(arbeitsblaetter.userId, userId),
        themaId
          ? and(eq(arbeitsblaetter.subjectTopicId, themaId), eq(arbeitsblaetter.tag, tag))
          : eq(arbeitsblaetter.studyBlockId, blockId!),
      ),
    )
    .limit(1);
  if (vorhanden[0]) return vorhanden[0];

  const [neu] = await db
    .insert(arbeitsblaetter)
    .values({ userId, subjectTopicId: themaId, studyBlockId: blockId, tag })
    .onConflictDoNothing()
    .returning();
  if (neu) return neu;

  // Ein zweiter Aufruf war schneller: dessen Zeile gilt.
  return arbeitsblattFuer(userId, ziel, tag);
}

/**
 * Startet einen Bau per UPDATE, wenn er darf. Gibt die Zeile im Stand
 * `laeuft` zurück oder null, wenn kein Bau starten darf (Endstatus, laufend
 * mit gültiger Frist, oder Versuche aufgebraucht).
 */
export async function bauStarten(
  userId: string,
  id: string,
  now: Date,
): Promise<ArbeitsblattZeile | null> {
  const [zeile] = await db
    .update(arbeitsblaetter)
    .set({
      status: "laeuft",
      fristBis: new Date(now.getTime() + FRIST_MS),
      versuche: sql`${arbeitsblaetter.versuche} + 1`,
    })
    .where(
      and(
        eq(arbeitsblaetter.userId, userId),
        eq(arbeitsblaetter.id, id),
        lt(arbeitsblaetter.versuche, MAX_VERSUCHE),
        or(
          eq(arbeitsblaetter.status, "wartet"),
          eq(arbeitsblaetter.status, "fehlgeschlagen"),
          and(
            eq(arbeitsblaetter.status, "laeuft"),
            or(isNull(arbeitsblaetter.fristBis), lt(arbeitsblaetter.fristBis, now)),
          ),
        ),
      ),
    )
    .returning();
  return zeile ?? null;
}

export async function bauFertig(
  userId: string,
  id: string,
  inhalt: ArbeitsblattInhalt,
  now: Date,
): Promise<void> {
  await db
    .update(arbeitsblaetter)
    .set({
      status: "fertig",
      inhalt: inhalt as unknown as Record<string, unknown>,
      erzeugtAm: now,
      fristBis: null,
    })
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)));
}

export async function bauFehlgeschlagen(userId: string, id: string): Promise<void> {
  await db
    .update(arbeitsblaetter)
    .set({ status: "fehlgeschlagen", fristBis: null })
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)));
}

/** „Arbeitsblatt drucken“: `gedruckt_am` und Protokoll `blatt_gedruckt`. */
export async function gedrucktSetzen(
  userId: string,
  id: string,
  now: Date,
  tag: string,
): Promise<string> {
  await db
    .update(arbeitsblaetter)
    .set({ gedrucktAm: now })
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)));
  return protokollieren(userId, tag, "blatt_gedruckt", id);
}

/** Eine Zeile in „Wie lief es?“: Aufgabe `nr` richtig oder falsch. */
export async function wertungSetzen(
  userId: string,
  id: string,
  nr: number,
  richtig: boolean,
): Promise<void> {
  const [eigen] = await db
    .select({ id: arbeitsblaetter.id })
    .from(arbeitsblaetter)
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)));
  if (!eigen) throw new Error("Arbeitsblatt nicht gefunden");

  await db
    .insert(arbeitsblattWertung)
    .values({ arbeitsblattId: id, nr, richtig })
    .onConflictDoUpdate({
      target: [arbeitsblattWertung.arbeitsblattId, arbeitsblattWertung.nr],
      set: { richtig },
    });
}

export async function wertungLesen(
  id: string,
): Promise<Map<number, boolean>> {
  const zeilen = await db
    .select()
    .from(arbeitsblattWertung)
    .where(eq(arbeitsblattWertung.arbeitsblattId, id));
  return new Map(zeilen.map((z) => [z.nr, z.richtig]));
}

/**
 * „Fertig“ nach „Wie lief es?“: erst wenn jede Aufgabe bewertet ist
 * (Kriterium 3). Setzt `ausgewertet_am` und schreibt `blatt_ausgewertet`
 * {n, richtig}. Was das für die Termine heißt (Frage 3, Vorschlag a), regelt
 * Abschnitt H in der Action; hier ändert sich kein Termin.
 */
export async function auswerten(
  userId: string,
  id: string,
  aufgabenZahl: number,
  now: Date,
  tag: string,
): Promise<{ n: number; richtig: number; protokollId: string }> {
  const wertung = await wertungLesen(id);
  for (let nr = 1; nr <= aufgabenZahl; nr += 1) {
    if (!wertung.has(nr)) throw new Error(`Aufgabe ${nr} ist noch nicht bewertet`);
  }
  const richtig = [...wertung.entries()].filter(
    ([nr, ok]) => nr <= aufgabenZahl && ok,
  ).length;

  await db
    .update(arbeitsblaetter)
    .set({ ausgewertetAm: now })
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)));
  const protokollId = await protokollieren(userId, tag, "blatt_ausgewertet", id, {
    n: aufgabenZahl,
    richtig,
  });
  return { n: aufgabenZahl, richtig, protokollId };
}
