import { and, asc, eq, gt, gte, inArray, isNull, lt, lte } from "drizzle-orm";

import { db } from "@/db";
import { arbeitsblaetter, subjectTopics, type ThemaArt } from "@/db/schema";
import { addDays, berlinDay } from "@/lib/dates";
import { naechsteKlausur } from "@/recall/items";
import { istId } from "@/recall/ids";
import {
  epochenFach,
  fachName,
  fragenText,
  freePeriodToday,
  protokollVomTag,
  themaArt,
  weekdayOrDate,
  whText,
  whUnterzeile,
  type WhStand,
} from "@/recall/source";
import { recallAttempts, recallItems, recallSchedule } from "@/recall/schema";
import { faelligHeute, type FaelligerBaustein } from "@/recall/sessions";

/**
 * Wiederholen nach Themen (Modell 23, Plan 3.4; V2 Abschnitt 6) — **nur
 * lesen.** Diese Datei bündelt, was `faelligHeute()` liefert, nach Thema und
 * sortiert die Themen. Sie rechnet keinen Termin aus und schreibt keinen:
 * `planeFaelligkeiten()`, `createItem()`, `neuPlanen()`, `versuchFesthalten()`
 * und `urteilFesthalten()` bleiben, wie sie sind (Entscheidung vom 15.9.2026,
 * der Takt bleibt unverändert). „Wieder dran“ und „Nächstes Thema …“ lesen
 * vorhandene Termine aus `recall_schedule`.
 *
 * ── Welcher Tag ─────────────────────────────────────────────────────────────
 *
 * `heute` ist hier immer der **App-Tag** (Wechsel um 04:00, Plan 3.1). Wer um
 * 00:30 übt, sieht die Fragen des Vortags. Die Versuche selbst tragen aber
 * den Kalendertag (`answered_on`, geschrieben von `versuchFesthalten()` mit
 * `todayInBerlin()`); deshalb liest diese Datei die Versuche eines App-Tags
 * über ein Fenster: `answered_on` ist der App-Tag oder der Tag danach, und
 * `created_at` liegt zwischen 04:00 des App-Tags und 04:00 des Folgetags.
 *
 * ── Was ein Thema ist ───────────────────────────────────────────────────────
 *
 * Ein Eintrag im Themenvokabular eines Fachs, aufgelöst über die
 * Alias-Kette (`merged_into`, wie `resolveTopic()`). Fragen ohne Thema bilden
 * je Fach ein eigenes Thema „⟨Fach⟩ · ohne Thema“. Der Schlüssel eines Themas
 * ist die id des aufgelösten Themas bzw. `ohne:<subjectId>`.
 */

/** Wie viele Alias-Schritte höchstens verfolgt werden (wie `resolveTopic`). */
const MAX_ALIAS_HOPS = 10;

export type { WhStand };

export const OHNE_THEMA = "ohne Thema";

export type FaelligesThema = {
  /** id des aufgelösten Themas oder `ohne:<subjectId>` */
  key: string;
  subjectId: string;
  /** voller Fachname („Geschichte“) */
  fach: string;
  topicId: string | null;
  /** Thementitel oder „ohne Thema“ */
  titel: string;
  /** geltende Art für heute; ein gescheitertes Blatt fällt auf `abfragen` zurück */
  art: ThemaArt;
  /** „n Fragen“ oder „Arbeitsblatt“ */
  umfang: string;
  istEpoche: boolean;
  /** Zahl der heute fälligen Fragen */
  fragen: number;
  /** ältester offener Termin des Themas */
  aeltester: string;
  /** heute schon angefangen (Versuche oder gedrucktes, nicht ausgewertetes Blatt) */
  angefangen: boolean;
  /** gedrucktes, nicht ausgewertetes Arbeitsblatt von heute */
  blattAngefangen: boolean;
  /** nächste Klausur des Fachs, falls eine kommt */
  klausur: string | null;
};

export const themaSchluessel = (subjectId: string, topicId: string | null): string =>
  topicId ?? `ohne:${subjectId}`;

/**
 * Ist das ein Themenschlüssel, wie `themaSchluessel()` ihn baut — die id
 * eines Fach-Themas oder `ohne:` mit der id eines Fachs? Alles andere ist
 * kein Thema (und darf nie als uuid an Postgres gehen).
 */
export function istThemaSchluessel(key: string): boolean {
  const id = key.startsWith("ohne:") ? key.slice(5) : key;
  return id === id.trim() && istId(id);
}


// ── Zeitfenster eines App-Tags ───────────────────────────────────────────────

let stundeFormat: Intl.DateTimeFormat | null = null;

/** Der Zeitpunkt „tag, HH:00 in Berlin“ — Sommer- und Winterzeit richtig. */
export function berlinStunde(tag: string, stunde: number): Date {
  stundeFormat ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const hh = String(stunde).padStart(2, "0");
  for (const offset of ["+02:00", "+01:00"]) {
    const d = new Date(`${tag}T${hh}:00:00${offset}`);
    if (berlinDay(d) === tag && Number(stundeFormat.format(d)) === stunde) return d;
  }
  return new Date(`${tag}T${hh}:00:00+01:00`);
}

/** Der App-Tag eines Zeitpunkts: Berliner Kalendertag von „Zeitpunkt minus 4 Stunden“. */
export function appTagVon(zeitpunkt: Date): string {
  return berlinDay(new Date(zeitpunkt.getTime() - 4 * 3600_000));
}

/** Die Versuche eines App-Tags (siehe Dateikopf), älteste zuerst. */
async function versucheDesTages(userId: string, heute: string) {
  return db
    .select({
      id: recallAttempts.id,
      itemId: recallAttempts.itemId,
      correct: recallAttempts.correct,
    })
    .from(recallAttempts)
    .where(
      and(
        eq(recallAttempts.userId, userId),
        inArray(recallAttempts.answeredOn, [heute, addDays(heute, 1)]),
        gte(recallAttempts.createdAt, berlinStunde(heute, 4)),
        lt(recallAttempts.createdAt, berlinStunde(addDays(heute, 1), 4)),
      ),
    )
    .orderBy(asc(recallAttempts.createdAt));
}

// ── Themen und Fragen eines Nutzers ──────────────────────────────────────────

type Thema = { id: string; title: string; subjectId: string; art: ThemaArt | null; mergedInto: string | null };

/** Alle Themen des Nutzers mit der Auflösung der Alias-Kette, im Speicher. */
async function themenAufloeser(userId: string) {
  const zeilen: Thema[] = await db
    .select({
      id: subjectTopics.id,
      title: subjectTopics.title,
      subjectId: subjectTopics.subjectId,
      art: subjectTopics.art,
      mergedInto: subjectTopics.mergedInto,
    })
    .from(subjectTopics)
    .where(eq(subjectTopics.userId, userId));
  const jeId = new Map(zeilen.map((z) => [z.id, z]));
  const aufloesen = (id: string | null): Thema | null => {
    if (!id) return null;
    let t = jeId.get(id) ?? null;
    for (let hop = 0; t?.mergedInto && hop < MAX_ALIAS_HOPS; hop += 1) {
      const next = jeId.get(t.mergedInto);
      if (!next) break;
      t = next;
    }
    return t;
  };
  return aufloesen;
}

/** Schlüssel des Themas, zu dem eine Frage gehört. */
function schluesselVon(
  aufloesen: (id: string | null) => Thema | null,
  frage: { subjectId: string; subjectTopicId: string | null },
): string {
  const t = aufloesen(frage.subjectTopicId);
  return themaSchluessel(frage.subjectId, t?.id ?? null);
}

/** Die nicht zurückgezogenen Fragen eines Themas (ids), über die Alias-Kette. */
async function fragenIdsZumThema(
  userId: string,
  aufloesen: (id: string | null) => Thema | null,
  key: string,
): Promise<string[]> {
  if (!istThemaSchluessel(key)) return [];
  const ohne = key.startsWith("ohne:") ? key.slice(5) : null;
  const zeilen = await db
    .select({ id: recallItems.id, subjectId: recallItems.subjectId, subjectTopicId: recallItems.subjectTopicId })
    .from(recallItems)
    .where(
      and(
        eq(recallItems.userId, userId),
        isNull(recallItems.retiredAt),
        ...(ohne ? [eq(recallItems.subjectId, ohne)] : []),
      ),
    );
  return zeilen.filter((z) => schluesselVon(aufloesen, z) === key).map((z) => z.id);
}

type BlattStand = {
  /** App-Tag des jüngsten `ausgewertet_am` */
  ausgewertet: string | null;
  /** heute gedruckt, nicht ausgewertet */
  angefangen: boolean;
  /** heutiges Blatt gescheitert */
  fehlgeschlagen: boolean;
};

/** Stand der Arbeitsblätter je Thema (nur lesen; gebaut werden sie in Abschnitt H). */
async function blattStaende(userId: string, topicIds: string[], heute: string): Promise<Map<string, BlattStand>> {
  const stand = new Map<string, BlattStand>();
  if (topicIds.length === 0) return stand;
  const zeilen = await db
    .select({
      subjectTopicId: arbeitsblaetter.subjectTopicId,
      tag: arbeitsblaetter.tag,
      status: arbeitsblaetter.status,
      gedrucktAm: arbeitsblaetter.gedrucktAm,
      ausgewertetAm: arbeitsblaetter.ausgewertetAm,
    })
    .from(arbeitsblaetter)
    .where(and(eq(arbeitsblaetter.userId, userId), inArray(arbeitsblaetter.subjectTopicId, topicIds)));
  for (const z of zeilen) {
    if (!z.subjectTopicId) continue;
    const s = stand.get(z.subjectTopicId) ?? { ausgewertet: null, angefangen: false, fehlgeschlagen: false };
    if (z.ausgewertetAm) {
      const a = appTagVon(z.ausgewertetAm);
      if (!s.ausgewertet || a > s.ausgewertet) s.ausgewertet = a;
    }
    if (z.gedrucktAm && !z.ausgewertetAm && appTagVon(z.gedrucktAm) === heute) s.angefangen = true;
    if (z.tag === heute && z.status === "fehlgeschlagen") s.fehlgeschlagen = true;
    stand.set(z.subjectTopicId, s);
  }
  return stand;
}

/**
 * Fragen, die ein ausgewertetes Übungsthema heute noch fällig machen: nur
 * offene Termine **nach** dem App-Tag der Auswertung (Plan 3.4). Fällige
 * Termine davor werden beim Lesen übergangen, nicht geändert.
 */
async function nachAuswertungFaellig(
  itemIds: string[],
  ausgewertet: string,
  heute: string,
): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const zeilen = await db
    .select({ itemId: recallSchedule.itemId })
    .from(recallSchedule)
    .where(
      and(
        inArray(recallSchedule.itemId, itemIds),
        isNull(recallSchedule.doneAt),
        gt(recallSchedule.dueOn, ausgewertet),
        lte(recallSchedule.dueOn, heute),
      ),
    );
  return new Set(zeilen.map((z) => z.itemId));
}

type Gruppe = {
  key: string;
  subjectId: string;
  fach: string;
  topic: Thema | null;
  fragen: FaelligerBaustein[];
};

/** `faelligHeute()` nach Thema gebündelt, samt Regeln für Arbeitsblätter. */
async function gruppiert(userId: string, heute: string, subjectId?: string) {
  const [faellig, aufloesen] = await Promise.all([faelligHeute(userId, heute), themenAufloeser(userId)]);
  const gruppen = new Map<string, Gruppe>();
  for (const f of faellig) {
    if (subjectId && f.subjectId !== subjectId) continue;
    const topic = aufloesen(f.subjectTopicId);
    const key = themaSchluessel(f.subjectId, topic?.id ?? null);
    let g = gruppen.get(key);
    if (!g) {
      g = { key, subjectId: f.subjectId, fach: f.subjectName, topic, fragen: [] };
      gruppen.set(key, g);
    }
    g.fragen.push(f);
  }
  const topicIds = [...gruppen.values()].flatMap((g) => (g.topic ? [g.topic.id] : []));
  const blaetter = await blattStaende(userId, topicIds, heute);

  // Ausgewertete Übungsthemen: erst ab dem nächsten Termin nach der Auswertung
  for (const g of gruppen.values()) {
    const b = g.topic ? blaetter.get(g.topic.id) : undefined;
    if (!b?.ausgewertet) continue;
    const bleiben = await nachAuswertungFaellig(
      g.fragen.map((f) => f.itemId),
      b.ausgewertet,
      heute,
    );
    g.fragen = g.fragen.filter((f) => bleiben.has(f.itemId));
    if (g.fragen.length === 0) gruppen.delete(g.key);
  }
  return { gruppen, blaetter, aufloesen };
}

/**
 * Die fälligen Themen in der Reihenfolge aus Plan 3.4 (V2 6.2):
 *
 * 1. angefangen (heute Versuche an Fragen des Themas, oder ein heute
 *    gedrucktes, nicht ausgewertetes Arbeitsblatt);
 * 2. ältester offener Termin;
 * 3. nähere Klausur des Fachs;
 * 4. mehr fällige Fragen;
 * 5. alphabetisch nach Fach und Thema.
 *
 * In Ferien ist die Liste leer. Ein Übungsthema, dessen Blatt heute
 * gescheitert ist, fällt für heute auf Karten zurück.
 */
export async function faelligeThemen(
  userId: string,
  heute: string,
  optionen: { subjectId?: string } = {},
): Promise<FaelligesThema[]> {
  if (await freePeriodToday(userId, heute)) return [];

  const { gruppen, blaetter, aufloesen } = await gruppiert(userId, heute, optionen.subjectId);
  if (gruppen.size === 0) return [];

  // Angefangen: heutige Versuche an Fragen dieses Themas (Plan 3.4). Bewusste
  // Abweichung vom Prototyp: dort gilt ein Thema schon als angefangen, wenn der
  // Tisch es nur geöffnet hat (`persistSession` setzt `started`), auch ohne
  // Antwort. Hier zählt erst ein Versuch — es gibt keine Sitzungstabelle und
  // keinen Protokolltyp fürs Öffnen; wer ohne Antwort schließt, sieht weiter
  // „Zuerst …“ statt „Weiter mit …“.
  const versuche = await versucheDesTages(userId, heute);
  const versuchtIds = [...new Set(versuche.flatMap((v) => (v.itemId ? [v.itemId] : [])))];
  const angefangeneKeys = new Set<string>();
  if (versuchtIds.length) {
    const zeilen = await db
      .select({ subjectId: recallItems.subjectId, subjectTopicId: recallItems.subjectTopicId })
      .from(recallItems)
      .where(and(eq(recallItems.userId, userId), inArray(recallItems.id, versuchtIds)));
    for (const z of zeilen) angefangeneKeys.add(schluesselVon(aufloesen, z));
  }

  const faecher = [...new Set([...gruppen.values()].map((g) => g.subjectId))];
  const [klausuren, epoche] = await Promise.all([
    Promise.all(faecher.map(async (id) => [id, await naechsteKlausur(userId, id, heute)] as const)),
    epochenFach(userId),
  ]);
  const klausurJeFach = new Map(klausuren);

  const themen: FaelligesThema[] = [];
  for (const g of gruppen.values()) {
    const b = g.topic ? blaetter.get(g.topic.id) : undefined;
    // Ein Thema ohne Fach-Thema kann kein Blatt haben: dort bleibt es bei Karten.
    const geltend = g.topic ? themaArt(g.topic, { name: g.fach }) : "abfragen";
    const art: ThemaArt = geltend === "ueben" && !b?.fehlgeschlagen ? "ueben" : "abfragen";
    themen.push({
      key: g.key,
      subjectId: g.subjectId,
      fach: g.fach,
      topicId: g.topic?.id ?? null,
      titel: g.topic?.title ?? OHNE_THEMA,
      art,
      umfang: art === "ueben" ? "Arbeitsblatt" : fragenText(g.fragen.length),
      istEpoche: g.subjectId === epoche,
      fragen: g.fragen.length,
      aeltester: g.fragen.reduce((m, f) => (f.dueOn < m ? f.dueOn : m), g.fragen[0].dueOn),
      angefangen: angefangeneKeys.has(g.key) || !!b?.angefangen,
      blattAngefangen: !!b?.angefangen,
      klausur: klausurJeFach.get(g.subjectId) ?? null,
    });
  }

  const klausurRang = (t: FaelligesThema) => t.klausur ?? "9999-12-31";
  return themen.sort(
    (a, b) =>
      Number(b.angefangen) - Number(a.angefangen) ||
      (a.aeltester < b.aeltester ? -1 : a.aeltester > b.aeltester ? 1 : 0) ||
      (klausurRang(a) < klausurRang(b) ? -1 : klausurRang(a) > klausurRang(b) ? 1 : 0) ||
      b.fragen - a.fragen ||
      `${a.fach} ${a.titel}`.localeCompare(`${b.fach} ${b.titel}`, "de"),
  );
}

/** Wie viele Themen heute fällig sind (die Zahl auf dem Überblick). */
export async function zahlFaelligeThemen(userId: string, heute: string): Promise<number> {
  return (await faelligeThemen(userId, heute)).length;
}

/**
 * Die fälligen Fragen nur dieses Themas, in der Reihenfolge von
 * `faelligHeute()` (heute schon danebengegangene hinten).
 */
export async function fragenZumThema(
  userId: string,
  heute: string,
  key: string,
): Promise<FaelligerBaustein[]> {
  if (await freePeriodToday(userId, heute)) return [];
  const { gruppen } = await gruppiert(userId, heute);
  return gruppen.get(key)?.fragen ?? [];
}

/**
 * „Wieder dran“: der kleinste offene Termin des Themas nach heute. Ohne
 * späteren Termin `null` — dann entfällt die Zeile (V2 6.5). Für ein
 * ausgewertetes Übungsthema gilt dieselbe Zahl: Termine nach heute liegen
 * immer auch nach dem Tag der Auswertung.
 */
export async function naechsterTerminThema(
  userId: string,
  key: string,
  heute: string,
): Promise<string | null> {
  const aufloesen = await themenAufloeser(userId);
  const ids = await fragenIdsZumThema(userId, aufloesen, key);
  if (ids.length === 0) return null;
  const [zeile] = await db
    .select({ dueOn: recallSchedule.dueOn })
    .from(recallSchedule)
    .where(and(inArray(recallSchedule.itemId, ids), isNull(recallSchedule.doneAt), gt(recallSchedule.dueOn, heute)))
    .orderBy(asc(recallSchedule.dueOn))
    .limit(1);
  return zeile?.dueOn ?? null;
}

/** „Nächstes Thema ⟨Tag⟩“: der kleinste offene Termin überhaupt nach heute. */
export async function naechsterTerminUeberhaupt(userId: string, heute: string): Promise<string | null> {
  const [zeile] = await db
    .select({ dueOn: recallSchedule.dueOn })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .where(
      and(
        eq(recallItems.userId, userId),
        isNull(recallItems.retiredAt),
        isNull(recallSchedule.doneAt),
        gt(recallSchedule.dueOn, heute),
      ),
    )
    .orderBy(asc(recallSchedule.dueOn))
    .limit(1);
  return zeile?.dueOn ?? null;
}

export type ThemaBericht = {
  /** Fragen des Themas, die heute beantwortet wurden */
  fragen: number;
  /** davon beim ersten Versuch des Tages „Saß“ */
  beimErstenMal: number;
  /** je Frage: saß der erste Versuch des Tages? */
  erste: Record<string, boolean>;
};

/**
 * Was heute an diesem Thema geschah, für das Themenende („10 Fragen, 8 beim
 * ersten Mal.“): aus `recall_attempts` des App-Tags, auch über Mitternacht.
 * Eine Zählung, kein Prozentwert (Kommentar an `tagesbericht()`).
 */
export async function themaTagesbericht(
  userId: string,
  key: string,
  heute: string,
): Promise<ThemaBericht> {
  const aufloesen = await themenAufloeser(userId);
  const versuche = await versucheDesTages(userId, heute);
  const ids = [...new Set(versuche.flatMap((v) => (v.itemId ? [v.itemId] : [])))];
  const erste: Record<string, boolean> = {};
  if (ids.length) {
    const zeilen = await db
      .select({ id: recallItems.id, subjectId: recallItems.subjectId, subjectTopicId: recallItems.subjectTopicId })
      .from(recallItems)
      // zurückgezogene Fragen zählen nicht mehr (V2 6.4)
      .where(and(eq(recallItems.userId, userId), inArray(recallItems.id, ids), isNull(recallItems.retiredAt)));
    const imThema = new Set(zeilen.filter((z) => schluesselVon(aufloesen, z) === key).map((z) => z.id));
    for (const v of versuche) {
      if (!v.itemId || !imThema.has(v.itemId) || v.itemId in erste) continue;
      erste[v.itemId] = v.correct;
    }
  }
  const werte = Object.values(erste);
  return { fragen: werte.length, beimErstenMal: werte.filter(Boolean).length, erste };
}

/** „Nächstes Thema …“ als Text, oder null. */
export async function naechstesThemaText(userId: string, heute: string): Promise<string | null> {
  const t = await naechsterTerminUeberhaupt(userId, heute);
  return t ? weekdayOrDate(t, heute) : null;
}

/** Der ganze Stand für den Überblick. */
export async function wiederholenStand(userId: string, heute: string): Promise<WhStand> {
  if (await freePeriodToday(userId, heute)) return { kind: "ferien" };
  const [eine] = await db
    .select({ id: recallItems.id })
    .from(recallItems)
    .where(and(eq(recallItems.userId, userId), isNull(recallItems.retiredAt)))
    .limit(1);
  if (!eine) return { kind: "leer" };
  const themen = await faelligeThemen(userId, heute);
  if (themen.length) return { kind: "knopf", n: themen.length, sub: whUnterzeile(themen[0]) };
  const [durch, nd] = await Promise.all([heuteDurch(userId, heute), naechstesThemaText(userId, heute)]);
  return { kind: "text", text: whText(durch, nd), ok: durch };
}

/** „Für heute durch.“: wurde heute (App-Tag) schon ein Thema beendet? */
export async function heuteDurch(userId: string, heute: string): Promise<boolean> {
  const protokoll = await protokollVomTag(userId, heute);
  return protokoll.some((e) => e.typ === "thema_beendet");
}

/**
 * Was der Tisch sagt, wenn er beim Öffnen nichts Fälliges findet (V2 6.7,
 * Prototyp `openTisch`, Z. 4243): mit Fach dessen Name („In Mathematik ist
 * heute nichts fällig.“), ohne Fach der Satz des Überblicks („Für heute
 * durch. …“ nach einem Themenende, sonst „Heute ist nichts fällig. …“).
 */
export async function leerStand(
  userId: string,
  heute: string,
  subjectId: string | null,
): Promise<{ fachName: string | null; durch: boolean }> {
  const [name, durch] = await Promise.all([
    subjectId ? fachName(userId, subjectId) : Promise.resolve(null),
    heuteDurch(userId, heute),
  ]);
  return { fachName: name, durch };
}
