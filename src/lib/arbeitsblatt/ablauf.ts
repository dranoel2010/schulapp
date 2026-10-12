import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";

import { db } from "@/db";
import {
  arbeitsblaetter,
  examTopics,
  exams,
  studyBlocks,
  subjectTopics,
  subjects,
  type StudyBlock,
} from "@/db/schema";
import { addDays, berlinDay, todayInBerlin } from "@/lib/dates";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { blockAngefangen, blockErledigt, blockMinuten } from "@/lib/lernblock";
import { themaArt } from "@/lib/themen-art";
import { recallItems, recallSchedule } from "@/recall/schema";

import { blockAlsBlatt, blockZiel } from "./quelle";
import { inhaltSchema, type ArbeitsblattInhalt } from "./schema";
import {
  arbeitsblattFuer,
  auswerten,
  darfBauen,
  wertungLesen,
  weiterNachfragen,
  type ArbeitsblattZeile,
} from "./stand";

/**
 * Das Arbeitsblatt im Alltag (Modell 23, Plan H): welches Blatt gilt für ein
 * Thema oder einen Lernblock, wie es der Oberfläche erscheint, was die
 * Auswertung an den Terminen ändert, und welche Blätter vorab gebaut werden.
 *
 * ── Termine nach der Auswertung (Frage 3, Antwort a vom 12.10.2026) ──────────
 *
 * Die am Auswertungstag fälligen, offenen Termine der Fragen des Themas
 * (`due_on ≤ heute`) bekommen `done_at` — wie nach einer Kartenrunde, in der
 * jede Frage am Ende „Saß“. Kein Termin wird neu gerechnet, kein `due_on`
 * ändert sich. Der Tag ist dabei der Berliner Kalendertag, wie bei jedem
 * Schreibweg des Abrufkerns (Plan 3.1).
 *
 * ── Ein Blatt je Termin ──────────────────────────────────────────────────────
 *
 * Höchstens ein Blatt je Thema und Tag (Unique-Index) — und darüber hinaus:
 * - ein noch nicht ausgewertetes Blatt des Themas gilt weiter, auch an einem
 *   späteren Tag (gedruckt am Montag, ausgewertet am Dienstag: dasselbe Blatt);
 * - nach einer Auswertung wird erst wieder gebaut, wenn nach dem App-Tag der
 *   Auswertung ein Termin fällig wird (Plan 3.4, H).
 */

// ── Themen auflösen ──────────────────────────────────────────────────────────

type ThemaInfo = { id: string; title: string; art: "abfragen" | "ueben"; fach: string };

/** Alle Themen des Nutzers mit Alias-Auflösung — eine Abfrage statt einer je Frage. */
async function themenKarte(userId: string) {
  const zeilen = await db
    .select({
      id: subjectTopics.id,
      title: subjectTopics.title,
      art: subjectTopics.art,
      mergedInto: subjectTopics.mergedInto,
      fach: subjects.name,
    })
    .from(subjectTopics)
    .innerJoin(subjects, eq(subjects.id, subjectTopics.subjectId))
    .where(eq(subjectTopics.userId, userId));
  const roh = new Map(zeilen.map((z) => [z.id, z]));
  const aufloesen = (id: string): string => {
    let akt = roh.get(id);
    for (let i = 0; akt?.mergedInto && i < 8; i += 1) {
      const next = roh.get(akt.mergedInto);
      if (!next) break;
      akt = next;
    }
    return akt?.id ?? id;
  };
  const info = (id: string): ThemaInfo | null => {
    const z = roh.get(aufloesen(id));
    if (!z) return null;
    return { id: z.id, title: z.title, fach: z.fach, art: themaArt({ title: z.title, art: z.art ?? null }, { name: z.fach }) };
  };
  return { aufloesen, info };
}

// ── Welches Blatt gilt ───────────────────────────────────────────────────────

/** Das jüngste Blatt des Themas, das noch nicht ausgewertet und nicht gescheitert ist. */
async function offenesBlatt(userId: string, topicId: string, bis: string) {
  const [zeile] = await db
    .select()
    .from(arbeitsblaetter)
    .where(
      and(
        eq(arbeitsblaetter.userId, userId),
        eq(arbeitsblaetter.subjectTopicId, topicId),
        isNull(arbeitsblaetter.ausgewertetAm),
        ne(arbeitsblaetter.status, "fehlgeschlagen"),
        lte(arbeitsblaetter.tag, bis),
      ),
    )
    .orderBy(desc(arbeitsblaetter.tag))
    .limit(1);
  return zeile ?? null;
}

/**
 * Das Blatt eines Übungsthemas für diesen App-Tag: ein offenes (auch von
 * einem früheren Tag), sonst das des Tages — angelegt, falls nötig.
 */
export async function blattFuerThema(
  userId: string,
  topicId: string,
  tag: string,
): Promise<ArbeitsblattZeile> {
  const offen = await offenesBlatt(userId, topicId, tag);
  if (offen) return offen;
  return arbeitsblattFuer(userId, { subjectTopicId: topicId }, tag);
}

/**
 * Das Blatt eines Lernblocks — oder null, wenn der Block kein Arbeitsblatt
 * ist (Kriterium 4: nur bei Übungsthemen). Ein Blatt des Themas von heute
 * übernimmt der Block (./stand): Wiederholen und Lernblock teilen den Stand.
 */
export async function blattFuerBlock(
  userId: string,
  blockId: string,
): Promise<ArbeitsblattZeile | null> {
  const ziel = await blockZiel(userId, blockId);
  if (!ziel || !blockAlsBlatt(ziel)) return null;
  const [block] = await db
    .select({ date: studyBlocks.date })
    .from(studyBlocks)
    .where(eq(studyBlocks.id, blockId));
  if (!block) return null;
  return arbeitsblattFuer(
    userId,
    ziel.subjectTopicId
      ? { subjectTopicId: ziel.subjectTopicId, studyBlockId: blockId }
      : { studyBlockId: blockId },
    block.date,
  );
}

// ── Was die Oberfläche sieht ─────────────────────────────────────────────────

export type BlattStand = {
  id: string;
  status: ArbeitsblattZeile["status"];
  /** Soll die Oberfläche in 3 s wieder fragen? */
  weiter: boolean;
  /** Darf ein Bau starten (für den Anstoß beim Öffnen)? */
  bauBar: boolean;
  fach: string;
  /** Thema des Blatts; beim Block ohne Fach-Thema „Gesamtwiederholung“ */
  thema: string;
  topicId: string | null;
  blockId: string | null;
  /** App-Tag, für den gebaut wurde — steht im Kopf des Blatts */
  tag: string;
  inhalt: ArbeitsblattInhalt | null;
  /** ISO oder null */
  gedrucktAm: string | null;
  ausgewertetAm: string | null;
  /** Wertung je Aufgabe, Schlüssel ist die Nummer ab 1 */
  wertung: Record<number, boolean>;
  /** Hat das Thema Fragen? Dann gibt es „Dieses Thema lieber abfragen“. */
  hatFragen: boolean;
  /** Nur beim Blatt eines Lernblocks: Tag der Klausur und der Name des Blocks */
  block: { klausurtag: string; label: string } | null;
};

/** „Lernblock · ⟨Thema⟩“, „Lernblock · Wiederholung“ oder „… · Gesamtwiederholung“ (Plan 3.5). */
export function blockLabel(ziel: { themaTitel: string | null; kind: string }): string {
  if (ziel.themaTitel) return ziel.themaTitel;
  return ziel.kind === "review" ? "Wiederholung" : "Gesamtwiederholung";
}

export async function blattStand(
  userId: string,
  id: string,
  now: Date,
): Promise<BlattStand | null> {
  const [zeile] = await db
    .select()
    .from(arbeitsblaetter)
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)));
  if (!zeile) return null;

  let fach = "";
  let thema = "";
  let block: BlattStand["block"] = null;
  if (zeile.studyBlockId) {
    const ziel = await blockZiel(userId, zeile.studyBlockId);
    if (ziel) {
      block = { klausurtag: ziel.klausurtag, label: blockLabel(ziel) };
      fach = ziel.fach;
      thema = ziel.themaTitel ?? "Gesamtwiederholung";
    }
  }
  if (zeile.subjectTopicId) {
    const [t] = await db
      .select({ title: subjectTopics.title, fach: subjects.name })
      .from(subjectTopics)
      .innerJoin(subjects, eq(subjects.id, subjectTopics.subjectId))
      .where(eq(subjectTopics.id, zeile.subjectTopicId));
    fach = t?.fach ?? "";
    thema = t?.title ?? "";
  }

  const inhalt = zeile.inhalt ? inhaltSchema.safeParse(zeile.inhalt) : null;
  const wertung = await wertungLesen(userId, id);

  let hatFragen = false;
  if (zeile.subjectTopicId) {
    const [frage] = await db
      .select({ id: recallItems.id })
      .from(recallItems)
      .where(
        and(
          eq(recallItems.userId, userId),
          eq(recallItems.subjectTopicId, zeile.subjectTopicId),
          isNull(recallItems.retiredAt),
        ),
      )
      .limit(1);
    hatFragen = Boolean(frage);
  }

  return {
    id: zeile.id,
    status: zeile.status,
    weiter: weiterNachfragen(zeile, now),
    bauBar: darfBauen(zeile, now),
    fach,
    thema,
    topicId: zeile.subjectTopicId,
    blockId: zeile.studyBlockId,
    tag: zeile.tag,
    inhalt: inhalt?.success ? inhalt.data : null,
    gedrucktAm: zeile.gedrucktAm?.toISOString() ?? null,
    ausgewertetAm: zeile.ausgewertetAm?.toISOString() ?? null,
    wertung: Object.fromEntries(wertung),
    hatFragen,
    block,
  };
}

// ── Auswerten ────────────────────────────────────────────────────────────────

/** Die Fragen, deren Termine eine Auswertung schließt: die des Themas, beim Block ohne Thema die der Klausur. */
async function fragenZumBlatt(userId: string, zeile: ArbeitsblattZeile): Promise<string[]> {
  const karte = await themenKarte(userId);
  const items = await db
    .select({ id: recallItems.id, topic: recallItems.subjectTopicId, examId: recallItems.examId })
    .from(recallItems)
    .where(and(eq(recallItems.userId, userId), isNull(recallItems.retiredAt)));

  if (zeile.subjectTopicId) {
    const ziel = karte.aufloesen(zeile.subjectTopicId);
    return items.filter((i) => i.topic && karte.aufloesen(i.topic) === ziel).map((i) => i.id);
  }
  if (!zeile.studyBlockId) return [];
  const ziel = await blockZiel(userId, zeile.studyBlockId);
  if (!ziel) return [];
  const themen = new Set(ziel.klausurThemen.map((t) => karte.aufloesen(t.subjectTopicId)));
  return items
    .filter((i) => (i.topic && themen.has(karte.aufloesen(i.topic))) || i.examId === ziel.examId)
    .map((i) => i.id);
}

export type Auswertung = {
  n: number;
  richtig: number;
  /** Nummern der falschen Aufgaben, aufsteigend */
  falsch: number[];
  protokollId: string;
  /** Termine, die `done_at` bekamen (Antwort a) */
  termineErledigt: number;
  /** Nächster offener Termin der Fragen nach heute — „Wieder dran“; null ohne */
  wiederDran: string | null;
  /** Der heutige Lernblock zählt jetzt als erledigt */
  blockErledigt: boolean;
};

/**
 * „Fertig“ nach „Wie lief es?“ (Kriterium 3): erst wenn jede Aufgabe
 * bewertet ist. Schließt die heute fälligen Termine (Antwort a), und ist es
 * das Blatt des heutigen Lernblocks, ist der Block erledigt — egal ob im
 * Block oder beim Wiederholen ausgewertet (`perWH`).
 */
export async function blattAuswerten(
  userId: string,
  id: string,
  now: Date,
  imBlock: boolean,
): Promise<Auswertung> {
  const [zeile] = await db
    .select()
    .from(arbeitsblaetter)
    .where(and(eq(arbeitsblaetter.userId, userId), eq(arbeitsblaetter.id, id)));
  if (!zeile) throw new Error("Arbeitsblatt nicht gefunden");
  const inhalt = inhaltSchema.safeParse(zeile.inhalt);
  if (!inhalt.success) throw new Error("Arbeitsblatt hat keinen Inhalt");
  const n = inhalt.data.aufgaben.length;

  const appTag = appTagVon(now);
  const ergebnis = await auswerten(userId, id, n, now, appTag);
  const wertung = await wertungLesen(userId, id);
  const falsch = [...wertung.entries()]
    .filter(([nr, ok]) => nr <= n && !ok)
    .map(([nr]) => nr)
    .sort((a, b) => a - b);

  // Antwort a: die heute fälligen, offenen Termine der Fragen schließen.
  const kalendertag = todayInBerlin(now);
  const fragen = await fragenZumBlatt(userId, zeile);
  let termineErledigt = 0;
  let wiederDran: string | null = null;
  if (fragen.length > 0) {
    const geschlossen = await db
      .update(recallSchedule)
      .set({ doneAt: now })
      .where(
        and(
          inArray(recallSchedule.itemId, fragen),
          isNull(recallSchedule.doneAt),
          lte(recallSchedule.dueOn, kalendertag),
        ),
      )
      .returning({ id: recallSchedule.id });
    termineErledigt = geschlossen.length;

    const [naechster] = await db
      .select({ dueOn: recallSchedule.dueOn })
      .from(recallSchedule)
      .where(
        and(
          inArray(recallSchedule.itemId, fragen),
          isNull(recallSchedule.doneAt),
          gt(recallSchedule.dueOn, appTag),
        ),
      )
      .orderBy(asc(recallSchedule.dueOn))
      .limit(1);
    wiederDran = naechster?.dueOn ?? null;
  }

  let blockFertig = false;
  if (zeile.studyBlockId) {
    const [block] = await db
      .select({ block: studyBlocks })
      .from(studyBlocks)
      .innerJoin(exams, eq(exams.id, studyBlocks.examId))
      .where(and(eq(studyBlocks.id, zeile.studyBlockId), eq(exams.userId, userId)));
    const b: StudyBlock | undefined = block?.block;
    if (b && b.status !== "done" && b.date === appTag) {
      const minuten = blockAngefangen(b) ? Math.max(1, blockMinuten(b, now)) : 0;
      await blockErledigt(userId, b.id, minuten, appTag, !imBlock);
      blockFertig = true;
    }
  }

  return {
    n,
    richtig: ergebnis.richtig,
    falsch,
    protokollId: ergebnis.protokollId,
    termineErledigt,
    wiederDran,
    blockErledigt: blockFertig,
  };
}

// ── Fällige Übungsthemen und vorab bauen ─────────────────────────────────────

export type FaelligesUebungsthema = {
  topicId: string;
  /** Der Termin, den das nächste Blatt bedient */
  dueOn: string;
};

/**
 * Die Übungsthemen, die am Tag `bis` fällig sind — mit der Leseregel für
 * ausgewertete Blätter (Plan 3.4): nach einer Auswertung zählt nur ein
 * offener Termin, der NACH dem App-Tag der Auswertung liegt. Fällige Termine
 * davor werden beim Lesen übergangen, nicht geändert.
 *
 * Ein Thema, dessen Blatt an `bis` endgültig gescheitert ist
 * (`fehlgeschlagen`, zwei Versuche), fällt heraus: dafür baut niemand mehr.
 */
export async function faelligeUebungsthemen(
  userId: string,
  bis: string,
): Promise<FaelligesUebungsthema[]> {
  const karte = await themenKarte(userId);
  const termine = await db
    .select({ topic: recallItems.subjectTopicId, dueOn: recallSchedule.dueOn })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .where(
      and(
        eq(recallItems.userId, userId),
        isNull(recallItems.retiredAt),
        isNull(recallSchedule.doneAt),
        isNotNull(recallItems.subjectTopicId),
        lte(recallSchedule.dueOn, bis),
      ),
    );

  const jeThema = new Map<string, string[]>();
  for (const t of termine) {
    if (!t.topic) continue;
    const info = karte.info(t.topic);
    if (!info || info.art !== "ueben") continue;
    const liste = jeThema.get(info.id) ?? [];
    liste.push(t.dueOn);
    jeThema.set(info.id, liste);
  }
  if (jeThema.size === 0) return [];

  const blaetter = await db
    .select({
      topic: arbeitsblaetter.subjectTopicId,
      tag: arbeitsblaetter.tag,
      status: arbeitsblaetter.status,
      versuche: arbeitsblaetter.versuche,
      ausgewertetAm: arbeitsblaetter.ausgewertetAm,
    })
    .from(arbeitsblaetter)
    .where(
      and(
        eq(arbeitsblaetter.userId, userId),
        inArray(arbeitsblaetter.subjectTopicId, [...jeThema.keys()]),
      ),
    );

  const out: FaelligesUebungsthema[] = [];
  for (const [topicId, faellig] of jeThema) {
    const eigene = blaetter.filter((b) => b.topic === topicId);
    const ausgewertet = eigene
      .map((b) => (b.ausgewertetAm ? appTagVon(b.ausgewertetAm) : null))
      .filter((d): d is string => d !== null)
      .sort()
      .pop();
    const zaehlt = faellig.filter((d) => !ausgewertet || d > ausgewertet).sort();
    if (zaehlt.length === 0) continue;
    const gescheitert = eigene.some(
      (b) => b.tag === bis && b.status === "fehlgeschlagen" && b.versuche >= 2,
    );
    if (gescheitert) continue;
    out.push({ topicId, dueOn: zaehlt[0] });
  }
  return out.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
}

/**
 * Vorab bauen (Plan H, Frage 7): für Übungsthemen, die heute oder morgen
 * fällig sind, und für Lernblöcke von heute und morgen, die Arbeitsblätter
 * sind. Legt die Zeilen an und gibt die ids zurück, deren Bau starten darf —
 * den Anstoß übernimmt der Aufrufer (`blattAnstossen`), damit diese Funktion
 * ohne Claude prüfbar bleibt.
 */
export async function vorabBlaetter(userId: string, now: Date): Promise<string[]> {
  const heute = appTagVon(now);
  const morgen = addDays(heute, 1);
  const ids: string[] = [];

  const heuteFaellig = new Set((await faelligeUebungsthemen(userId, heute)).map((t) => t.topicId));
  for (const t of await faelligeUebungsthemen(userId, morgen)) {
    // Fällig heute: das Blatt von heute. Erst morgen fällig: das von morgen —
    // es sei denn, ein offenes Blatt des Themas gilt schon (ein Blatt je Termin).
    const zeile = heuteFaellig.has(t.topicId)
      ? await blattFuerThema(userId, t.topicId, heute)
      : await blattFuerThema(userId, t.topicId, morgen);
    if (darfBauen(zeile, now)) ids.push(zeile.id);
  }

  const bloecke = await db
    .select({ id: studyBlocks.id })
    .from(studyBlocks)
    .innerJoin(exams, eq(exams.id, studyBlocks.examId))
    .where(
      and(
        eq(exams.userId, userId),
        eq(studyBlocks.status, "open"),
        or(eq(studyBlocks.date, heute), eq(studyBlocks.date, morgen)),
      ),
    );
  for (const b of bloecke) {
    const zeile = await blattFuerBlock(userId, b.id);
    if (zeile && darfBauen(zeile, now) && !ids.includes(zeile.id)) ids.push(zeile.id);
  }
  return ids;
}

/** Ein Klausurthema als Fach-Thema: nur gelesen, für die Oberfläche (Kopf des Tisches). */
export async function klausurVonBlock(userId: string, blockId: string) {
  const [z] = await db
    .select({ examId: exams.id, date: exams.date, fach: subjects.name, topicTitle: examTopics.title })
    .from(studyBlocks)
    .innerJoin(exams, eq(exams.id, studyBlocks.examId))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(and(eq(studyBlocks.id, blockId), eq(exams.userId, userId)));
  return z ?? null;
}

/** Der Berliner Tag eines Zeitpunkts — für Anzeigen „gedruckt um …“. */
export const tagVon = (d: Date) => berlinDay(d);
