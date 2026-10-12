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
 *
 * Die Suche deckt beide Unique-Indizes ab, sonst scheitert das INSERT still
 * am anderen Index und nichts wird gefunden:
 * - mit Block zuerst nach (user_id, study_block_id) — der Block hat genau
 *   ein Blatt, auch wenn es an einem anderen Tag oder Thema angelegt wurde;
 * - mit Thema nach (user_id, subject_topic_id, tag). Gibt es dort heute
 *   schon ein Blatt ohne Block (Wiederholung des Themas), übernimmt der Block
 *   dieses Blatt: `study_block_id` wird nachgetragen. Hängt es schon an einem
 *   anderen Block, teilen sich beide das Blatt — höchstens eins je Thema und
 *   Tag gilt vor „eins je Block“.
 * Danach gibt es höchstens einen Wiederholungsversuch (ein paralleler Aufruf
 * war schneller), dann einen Fehler.
 */
export async function arbeitsblattFuer(
  userId: string,
  ziel: Ziel,
  tag: string,
  versuch = 0,
): Promise<ArbeitsblattZeile> {
  const themaId = ziel.subjectTopicId ?? null;
  const blockId = ziel.studyBlockId ?? null;
  if (!themaId && !blockId) throw new Error("Arbeitsblatt ohne Thema und Block");

  if (blockId) {
    const [amBlock] = await db
      .select()
      .from(arbeitsblaetter)
      .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.studyBlockId, blockId)))
      .limit(1);
    if (amBlock) return amBlock;
  }

  if (themaId) {
    const [amThema] = await db
      .select()
      .from(arbeitsblaetter)
      .where(
        and(
          eq(arbeitsblaetter.userId, userId),
          eq(arbeitsblaetter.subjectTopicId, themaId),
          eq(arbeitsblaetter.tag, tag),
        ),
      )
      .limit(1);
    if (amThema) {
      if (!blockId || amThema.studyBlockId) return amThema;
      const [uebernommen] = await db
        .update(arbeitsblaetter)
        .set({ studyBlockId: blockId })
        .where(and(eq(arbeitsblaetter.id, amThema.id), isNull(arbeitsblaetter.studyBlockId)))
        .returning();
      if (uebernommen) return uebernommen;
      // Ein anderer Block war schneller: neu lesen.
    } else {
      const [neu] = await db
        .insert(arbeitsblaetter)
        .values({ userId, subjectTopicId: themaId, studyBlockId: blockId, tag })
        .onConflictDoNothing()
        .returning();
      if (neu) return neu;
    }
  } else {
    const [neu] = await db
      .insert(arbeitsblaetter)
      .values({ userId, subjectTopicId: null, studyBlockId: blockId, tag })
      .onConflictDoNothing()
      .returning();
    if (neu) return neu;
  }

  // Ein zweiter Aufruf war schneller: dessen Zeile gilt. Nur einmal.
  if (versuch >= 1) throw new Error("Arbeitsblatt ließ sich weder finden noch anlegen");
  return arbeitsblattFuer(userId, ziel, tag, versuch + 1);
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
  const [getroffen] = await db
    .update(arbeitsblaetter)
    .set({ gedrucktAm: now })
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)))
    .returning({ id: arbeitsblaetter.id });
  if (!getroffen) throw new Error("Arbeitsblatt nicht gefunden");
  return protokollieren(userId, tag, "blatt_gedruckt", id);
}

/** Eine Zeile in „Wie lief es?“: Aufgabe `nr` richtig oder falsch. */
export async function wertungSetzen(
  userId: string,
  id: string,
  nr: number,
  richtig: boolean,
): Promise<void> {
  await besitzPruefen(userId, id);

  await db
    .insert(arbeitsblattWertung)
    .values({ arbeitsblattId: id, nr, richtig })
    .onConflictDoUpdate({
      target: [arbeitsblattWertung.arbeitsblattId, arbeitsblattWertung.nr],
      set: { richtig },
    });
}

async function besitzPruefen(userId: string, id: string): Promise<void> {
  const [eigen] = await db
    .select({ id: arbeitsblaetter.id })
    .from(arbeitsblaetter)
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)));
  if (!eigen) throw new Error("Arbeitsblatt nicht gefunden");
}

export async function wertungLesen(
  userId: string,
  id: string,
): Promise<Map<number, boolean>> {
  await besitzPruefen(userId, id);
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
  const wertung = await wertungLesen(userId, id);
  for (let nr = 1; nr <= aufgabenZahl; nr += 1) {
    if (!wertung.has(nr)) throw new Error(`Aufgabe ${nr} ist noch nicht bewertet`);
  }
  const richtig = [...wertung.entries()].filter(
    ([nr, ok]) => nr <= aufgabenZahl && ok,
  ).length;

  const [getroffen] = await db
    .update(arbeitsblaetter)
    .set({ ausgewertetAm: now })
    .where(
      and(
        eq(arbeitsblaetter.userId, userId),
        eq(arbeitsblaetter.id, id),
        isNull(arbeitsblaetter.ausgewertetAm),
      ),
    )
    .returning({ id: arbeitsblaetter.id });
  if (!getroffen) throw new Error("Arbeitsblatt ist schon ausgewertet");
  const protokollId = await protokollieren(userId, tag, "blatt_ausgewertet", id, {
    n: aufgabenZahl,
    richtig,
  });
  return { n: aufgabenZahl, richtig, protokollId };
}
