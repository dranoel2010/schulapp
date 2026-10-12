import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { db } from "@/db";
import { examTopics, materials, studyBlocks } from "@/db/schema";
import { berlinDay } from "@/lib/dates";
import { blocksForDay, listExams, missedBlocks, type TodayBlock } from "@/lib/exams";
import { freeLabel, freePeriodOn } from "@/lib/free-days";
import { homeworkForRange, listHomework, type HomeworkItem } from "@/lib/homework";
import { countInbox } from "@/lib/inbox";
import { fachKurz } from "@/lib/kombi/fach-kurz";
import { lernblockUeberblick } from "@/lib/kombi/lernblock-daten";
import type {
  AufgabeT,
  BlattT,
  KlausurT,
  LernblockT,
  MorgenT,
  TagDaten,
} from "@/lib/kombi/startseite";
import { diffDays } from "@/lib/kombi/text";
import { blockZustand } from "@/lib/lernblock";
import { juengstesThema, listMaterialCards } from "@/lib/materials";
import {
  ansicht as ansichtLaden,
  istSchultag,
  ladeKalender,
  nachSchulschluss,
  naechsterSchultagIn,
  stundenAm,
  type Schulkalender,
} from "@/lib/tag";
import { guessEpochSubject } from "@/lib/timetable";
import { wiederholenStand } from "@/recall/themen";

export type { TagDaten } from "@/lib/kombi/startseite";

/**
 * Alles, was die Startseite braucht (Modell 23, Plan 3.2) — ein reines,
 * serialisierbares Objekt. `ladeTag()` läuft beim Server-Rendern von `/` (als
 * Startwert für die Shell) und sonst über `GET /api/tag/daten` (Plan 2.4,
 * Punkt 1). Es ersetzt `loadHomeData` für die neue Oberfläche.
 *
 * Wiederholen (Abschnitt E) und der Ablauf (C) ergänzen ihre Felder hier.
 */

/** Der App-Tag: der Berliner Kalendertag von „jetzt minus 4 Stunden“. */
export function appTagVon(now: Date): string {
  return berlinDay(new Date(now.getTime() - 4 * 3600_000));
}

/** Klausuren in höchstens so vielen Tagen stehen auf dem Überblick (V2 4.1). */
const KLAUSUR_TAGE = 14;

function aufgabeT(h: HomeworkItem): AufgabeT {
  return {
    id: h.id,
    fachId: h.subject.id,
    fach: fachKurz(h.subject.name),
    fachName: h.subject.name,
    text: h.title,
    due: h.dueDate,
    done: h.done,
    doneAt: h.doneAt ? h.doneAt.toISOString() : null,
    details: !!h.details,
  };
}

/** Planeintrag → „Scheitelpunktform“, „Wiederholung“, „Gesamtwiederholung“ (Plan 3.5). */
function blockLabel(kind: string, thema: string | null | undefined): string {
  if (kind === "review") return "Wiederholung";
  return thema ? thema : "Gesamtwiederholung";
}

function lernblockT(b: TodayBlock): LernblockT {
  return {
    id: b.id,
    examId: b.examId,
    label: blockLabel(b.kind, b.topic?.title),
    minuten: b.minutes,
    zustand: blockZustand(b),
    laeuftSeit: b.laeuftSeit ? b.laeuftSeit.toISOString() : null,
    pausiertSeit: b.pausiertSeit ? b.pausiertSeit.toISOString() : null,
    pauseMs: b.pauseMs,
    minutenGelernt: b.minutenGelernt,
  };
}

async function morgenFuer(
  userId: string,
  k: Schulkalender,
  tag: string,
  epochenFach: string | null,
  klausuren: Awaited<ReturnType<typeof listExams>>,
): Promise<MorgenT> {
  const stunden = stundenAm(k, tag);
  const huFach = stunden.find((s) => s.period === 1 && s.subject.id === epochenFach);
  const thema = huFach ? await juengstesThema(userId, huFach.subject.id) : "";
  const klausur = klausuren.find((e) => e.date === tag) ?? null;
  let klausurText: string | null = null;
  if (klausur) {
    const stunde = stunden.find((s) => s.subject.id === klausur.subjectId);
    klausurText = [
      klausur.subject.name,
      stunde ? `${stunde.period}. Stunde` : null,
      klausur.title?.trim() || null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return {
    tag,
    stunden: stunden.map((s) => ({
      nr: s.period,
      von: k.raster.get(s.period)?.startsAt ?? "",
      fach: s.subject.name,
      raum: s.room ?? s.subject.room ?? null,
      hu:
        s === huFach
          ? `Hauptunterricht${thema ? ` · ${thema}` : ""}`
          : null,
    })),
    klausur: klausurText,
  };
}

export async function ladeTag(userId: string, now: Date): Promise<TagDaten> {
  const k = await ladeKalender(userId);
  const stand = await ansichtLaden(userId, now, k);
  const tag = stand.tag;
  const ns = naechsterSchultagIn(k, tag);
  const frei = freePeriodOn(k.frei, tag);

  const alleStunden = [...k.stunden.values()].flat();
  const epochenFach = guessEpochSubject(
    alleStunden.map((s) => ({ period: s.period, subjectId: s.subject.id })),
  );

  const [offen, bisNs, klausuren, heuteBloecke, verpasst, karten, korb, wiederholen, klausurBlock] = await Promise.all([
    listHomework(userId),
    homeworkForRange(userId, tag, ns),
    listExams(userId, { heute: tag }),
    blocksForDay(userId, tag),
    missedBlocks(userId, tag),
    listMaterialCards(userId, { limit: 3, order: "aufnahme" }),
    countInbox(userId),
    wiederholenStand(userId, tag),
    frei ? Promise.resolve(null) : lernblockUeberblick(userId, tag),
  ]);

  // Offene Aufgaben und die erledigten bis zum nächsten Schultag (Morgens,
  // Morgen früh), ohne doppelte.
  // Eine feste Reihenfolge (fällig, dann eingetragen), unabhängig vom Haken:
  // sonst rutschte eine eben abgehakte Zeile beim Nachladen ans Ende, während
  // sie noch 350 ms an ihrer Stelle stehen soll.
  const gesehen = new Set<string>();
  const aufgaben: AufgabeT[] = [...offen, ...bisNs]
    .filter((h) => (gesehen.has(h.id) ? false : (gesehen.add(h.id), true)))
    .sort((a, b) =>
      a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map(aufgabeT);

  const [morgens, frueh] = await Promise.all([
    morgenFuer(userId, k, tag, epochenFach, klausuren),
    morgenFuer(userId, k, ns, epochenFach, klausuren),
  ]);

  const klausurenBald: KlausurT[] = klausuren
    .filter((e) => e.date > tag && diffDays(tag, e.date) <= KLAUSUR_TAGE)
    .map((e) => ({ id: e.id, fach: fachKurz(e.subject.name), fachName: e.subject.name, datum: e.date }));

  const naechste = klausurenBald[0] ?? null;
  const block = naechste ? heuteBloecke.find((b) => b.examId === naechste.id) : undefined;
  let naechsterLernblock: TagDaten["naechsterLernblock"] = null;
  if (naechste && !block) {
    const [nx] = await db
      .select({ date: studyBlocks.date, kind: studyBlocks.kind, thema: examTopics.title })
      .from(studyBlocks)
      .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
      .where(
        and(
          eq(studyBlocks.examId, naechste.id),
          gt(studyBlocks.date, tag),
          inArray(studyBlocks.status, ["open"]),
        ),
      )
      .orderBy(asc(studyBlocks.date), asc(studyBlocks.sortOrder))
      .limit(1);
    if (nx) naechsterLernblock = { tag: nx.date, label: blockLabel(nx.kind, nx.thema) };
  }

  const verpasstHier = naechste ? verpasst.filter((b) => b.examId === naechste.id) : [];

  // Ob ein Blatt schon eingeordnet ist, steht nicht an der Karte.
  const eingeordnet = karten.length
    ? await db
        .select({ id: materials.id, filedAt: materials.filedAt })
        .from(materials)
        .where(and(eq(materials.userId, userId), inArray(materials.id, karten.map((b) => b.id))))
    : [];
  const blaetter: BlattT[] = karten.map((b) => ({
    id: b.id,
    titel: b.title,
    fachName: b.subject.name,
    cover: b.coverPageId,
    einordnen: !eingeordnet.find((e) => e.id === b.id)?.filedAt,
  }));

  return {
    tag,
    stand: now.toISOString(),
    ansicht: stand.ansicht,
    schritt: stand.schritt,
    ablaufStand: stand.stand,
    schultag: istSchultag(k, tag),
    nachSchluss: nachSchulschluss(k, now),
    naechsterSchultag: ns,
    ferien: frei ? { bis: frei.endsOn, titel: freeLabel(frei) } : null,
    // In den Ferien zeigt der Überblick keine Aufgaben (die Ansicht blendet sie
    // aus); die Liste selbst bleibt für „Morgen früh“ und die Zeile.
    aufgaben,
    morgens,
    frueh,
    klausurenBald: frei ? [] : klausurenBald,
    lernblock: frei || !block ? null : lernblockT(block),
    naechsterLernblock: frei ? null : naechsterLernblock,
    verpasst:
      !frei && verpasstHier.length
        ? { anzahl: verpasstHier.length, tag: verpasstHier[0].date, examId: verpasstHier[0].examId }
        : null,
    blaetter,
    eingangskorb: korb,
    klausurBlock,
    wiederholen,
  };
}
