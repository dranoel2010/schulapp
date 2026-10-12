import { and, asc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";

import { db } from "@/db";
import { examTopics, materialTopics, materials, studyBlocks, subjectTopics, subjects } from "@/db/schema";
import { berlinDay } from "@/lib/dates";
import { blocksForDay, listExams } from "@/lib/exams";
import { listFreePeriods } from "@/lib/free-days";
import { gradeLabel } from "@/lib/grade-scale";
import { gradesBySubject } from "@/lib/grades";
import { lessonRoom } from "@/lib/home";
import { listHomework } from "@/lib/homework";
import { fachEintraege } from "@/lib/kombi/fach-alias";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { diffDays, weekdayOrDate } from "@/lib/kombi/text";
import {
  isSchool,
  schluss,
  type VorratKlausur,
  type VorratNote,
  type VorratPlanEintrag,
  type VorratStunde,
  type VorratThema,
  type VorratThemaTreffer,
  type VorratWh,
  type ZeilenVorrat,
} from "@/lib/kombi/vorrat";
import { blockRest, blockZustand } from "@/lib/lernblock";
import { ablaufSchritt, ablaufStand, protokollVomTag } from "@/lib/protokoll";
import { listSubjects } from "@/lib/subjects";
import { DEFAULT_PERIODS, listLessons, listPeriods, periodTimes } from "@/lib/timetable";
import { recallItems, recallSchedule } from "@/recall/schema";

/**
 * `zeilenVorrat(userId, now)` — der Vorrat der Zeile (Plan 3.2, D). Alles,
 * was die Antworten beim Tippen brauchen, damit nichts nachlädt oder
 * flackert. Rein und serialisierbar, unter 30 KB.
 *
 * Eigene Datei statt in `tag-daten.ts`: die Startseite (Abschnitt B) baut
 * `ladeTag()` dort zur selben Zeit um.
 *
 * Fällige Themen liest der Vorrat vorerst selbst, gebündelt je Fach-Thema in
 * der Reihenfolge des Plans (3.4: ältestes `due_on`, nähere Klausur, mehr
 * Fragen, alphabetisch). Sobald `faelligeThemen()` aus Abschnitt E steht,
 * nimmt der Vorrat diese Funktion.
 */

const ZEITFORMAT = (iso: Date) => berlinDay(iso);

export async function zeilenVorrat(userId: string, now: Date): Promise<ZeilenVorrat> {
  const heute = appTagVon(now);

  const [faecherRoh, periodenRoh, stundenRoh, freiRoh, aufgabenRoh, klausurenRoh, notenRoh, bloeckeHeute, stand, protokoll, schritt] =
    await Promise.all([
      listSubjects(userId),
      listPeriods(userId),
      listLessons(userId),
      listFreePeriods(userId, heute),
      listHomework(userId, { includeDone: true }),
      listExams(userId, { includePast: true }),
      gradesBySubject(userId),
      blocksForDay(userId, heute),
      ablaufStand(userId, heute),
      protokollVomTag(userId, heute),
      ablaufSchritt(userId, heute),
    ]);

  const faecher = fachEintraege(faecherRoh);
  const aktiv = new Set(faecher.map((f) => f.id));

  // ── Stundenplan ──────────────────────────────────────────────────────────
  const zeiten = periodTimes(periodenRoh.length ? periodenRoh : [...DEFAULT_PERIODS]);
  // Hauptunterricht: das Fach, das in der ersten Stunde an den meisten Tagen steht
  const ersteStunde = new Map<string, number>();
  for (const l of stundenRoh) if (l.period === 1) ersteStunde.set(l.subjectId, (ersteStunde.get(l.subjectId) ?? 0) + 1);
  let epochenFach: string | null = null;
  let meiste = 1;
  for (const [id, n] of ersteStunde)
    if (n > meiste) {
      meiste = n;
      epochenFach = id;
    }
  const stunden: Record<string, VorratStunde[]> = {};
  for (let w = 1; w <= 5; w++) {
    const tag = stundenRoh.filter((l) => l.weekday === w && !l.subject.archived).sort((a, b) => a.period - b.period);
    const liste: VorratStunde[] = [];
    for (const l of tag) {
      const z = zeiten.get(l.period);
      if (!z) continue;
      const vorige = liste[liste.length - 1];
      // Doppelstunde: zusammenfassen, die Zeile nennt das Fach einmal
      if (vorige && vorige.fachId === l.subjectId && vorige.raum === lessonRoom(l)) {
        vorige.bis = z.endsAt;
        continue;
      }
      liste.push({
        nr: l.period,
        von: z.startsAt,
        bis: z.endsAt,
        fachId: l.subjectId,
        raum: lessonRoom(l),
        hu: l.period === 1 && l.subjectId === epochenFach,
      });
    }
    stunden[String(w)] = liste;
  }
  const frei = freiRoh.map((f) => ({ von: f.startsOn, bis: f.endsOn, ferien: f.kind === "ferien" }));
  const kal = { stunden, frei };

  // ── Aufgaben: offene und die der letzten Tage (für „Erledigt“ in der Suche) ──
  const grenze = now.getTime() - 3 * 864e5;
  const aufgaben = aufgabenRoh
    .filter((a) => aktiv.has(a.subjectId) && (!a.doneAt || a.doneAt.getTime() >= grenze))
    .map((a) => ({
      id: a.id,
      fachId: a.subjectId,
      text: a.title,
      due: a.dueDate,
      done: a.doneAt ? a.doneAt.getTime() : null,
      details: !!a.details,
    }));

  // ── Klausuren mit Planzeilen für die nächsten 14 Tage ─────────────────────
  const bald = klausurenRoh.filter((k) => k.date >= heute && diffDays(heute, k.date) <= 14).map((k) => k.id);
  const planRoh = bald.length
    ? await db
        .select({ block: studyBlocks, topic: examTopics })
        .from(studyBlocks)
        .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
        .where(and(inArray(studyBlocks.examId, bald), gte(studyBlocks.date, heute), ne(studyBlocks.status, "skipped")))
        .orderBy(asc(studyBlocks.date), asc(studyBlocks.sortOrder))
    : [];
  const planVon = (examId: string): VorratPlanEintrag[] =>
    planRoh
      .filter((r) => r.block.examId === examId)
      .map((r) => ({
        tag: r.block.date,
        art: r.block.kind === "review" ? "Wiederholung" : "Lernblock",
        thema: r.topic?.title ?? "Gesamtwiederholung",
        min: r.block.minutes,
        erledigt: r.block.status === "done",
      }));
  const klausuren: VorratKlausur[] = klausurenRoh
    .filter((k) => aktiv.has(k.subjectId))
    .map((k) => ({ id: k.id, fachId: k.subjectId, datum: k.date, thema: k.title?.trim() || "Klausur", plan: planVon(k.id) }));

  // ── Noten je Fach, älteste zuerst ─────────────────────────────────────────
  const noten: Record<string, VorratNote[]> = {};
  for (const s of notenRoh) {
    if (!s.grades.length) continue;
    noten[s.subject.id] = [...s.grades]
      .reverse()
      .map((g) => ({ label: gradeLabel(g.value), titel: g.title?.trim() || (g.kind === "muendlich" ? "Mündlich" : "Schriftlich"), datum: g.date }));
  }

  // ── Fällige Themen (nur lesen, Takt unverändert) ──────────────────────────
  const inFerienHeute = frei.some((f) => heute >= f.von && heute <= f.bis);
  const themen: VorratThema[] = inFerienHeute ? [] : await faelligeThemenKurz(userId, heute, klausuren);
  const wh = await whStand(userId, heute, themen, inFerienHeute, protokoll.some((e) => e.typ === "thema_beendet"));

  // ── Lernblock von heute ───────────────────────────────────────────────────
  const offen = bloeckeHeute.find((b) => b.status === "open");
  const erledigtHeute = protokoll.some((e) => e.typ === "lernblock_erledigt");
  const lernblock =
    offen && !erledigtHeute
      ? (() => {
          const z = blockZustand(offen);
          return {
            key: offen.id,
            examId: offen.examId,
            label: offen.kind === "review" ? "Wiederholung" : (offen.topic?.title ?? "Gesamtwiederholung"),
            minuten: offen.minutes,
            zustand: z === "erledigt" ? ("ruhe" as const) : z,
            restMs: blockRest(offen, now),
          };
        })()
      : null;

  // ── Epoche ────────────────────────────────────────────────────────────────
  let epoche: ZeilenVorrat["epoche"] = null;
  if (epochenFach && aktiv.has(epochenFach)) {
    const seitMs = stundenRoh
      .filter((l) => l.period === 1 && l.subjectId === epochenFach)
      .map((l) => l.createdAt.getTime())
      .sort((a, b) => a - b)[0];
    epoche = { fachId: epochenFach, seit: seitMs ? ZEITFORMAT(new Date(seitMs)) : null };
  }

  // ── Themen für die Suche: Klausuren, Lernblöcke, Themen der Blätter ───────
  const themenListe: VorratThemaTreffer[] = [];
  for (const k of klausuren) {
    themenListe.push({ t: k.thema, fachId: k.fachId, ziel: { art: "klausur", id: k.id }, lb: false });
    for (const p of k.plan)
      if (p.art === "Lernblock") themenListe.push({ t: p.thema, fachId: k.fachId, ziel: { art: "klausur", id: k.id }, lb: p.tag === heute });
  }
  const blattThemen = await db
    .selectDistinct({ title: subjectTopics.title, subjectId: subjectTopics.subjectId })
    .from(materialTopics)
    .innerJoin(subjectTopics, eq(subjectTopics.id, materialTopics.subjectTopicId))
    .innerJoin(materials, eq(materials.id, materialTopics.materialId))
    .where(and(eq(materials.userId, userId), isNull(subjectTopics.mergedInto)));
  for (const b of blattThemen)
    if (aktiv.has(b.subjectId) && !themenListe.some((o) => o.t === b.title))
      themenListe.push({ t: b.title, fachId: b.subjectId, ziel: { art: "fach", id: b.subjectId }, lb: false });

  // ── Ansicht (bis Abschnitt B sie liefert: Prototyp `ansicht`, Z. 1335) ────
  const s = schluss(kal, heute);
  const jetztHHMM = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const ansicht: ZeilenVorrat["ansicht"] = !isSchool(kal, heute)
    ? "ueberblick"
    : s && berlinDay(now) === heute && jetztHHMM < s
      ? "morgens"
      : !stand
        ? "ablauf"
        : "ueberblick";

  return {
    heute,
    jetzt: now.getTime(),
    ansicht,
    ablauf: stand,
    schritt,
    faecher,
    stunden,
    frei,
    aufgaben,
    klausuren,
    noten,
    themen,
    wh,
    lernblock,
    epoche,
    themenListe,
  };
}

/**
 * Fällige Themen, gebündelt je Fach-Thema (Plan 3.4, nur lesen). Fragen ohne
 * Thema werden je Fach zu „⟨Fach⟩ · ohne Thema“ zusammengefasst.
 */
async function faelligeThemenKurz(userId: string, heute: string, klausuren: VorratKlausur[]): Promise<VorratThema[]> {
  const zeilen = await db
    .select({
      itemId: recallItems.id,
      subjectId: recallItems.subjectId,
      subjectName: subjects.name,
      topicId: recallItems.subjectTopicId,
      topicTitle: subjectTopics.title,
      mergedInto: subjectTopics.mergedInto,
      dueOn: recallSchedule.dueOn,
    })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .innerJoin(subjects, eq(subjects.id, recallItems.subjectId))
    .leftJoin(subjectTopics, eq(subjectTopics.id, recallItems.subjectTopicId))
    .where(
      and(eq(recallItems.userId, userId), isNull(recallItems.retiredAt), isNull(recallSchedule.doneAt), lte(recallSchedule.dueOn, heute)),
    )
    .orderBy(asc(recallSchedule.dueOn));

  // Alias-Kette: ein zusammengelegtes Thema zählt beim Ziel
  const ziele = new Map<string, string>();
  const offen = [...new Set(zeilen.map((z) => z.mergedInto).filter((x): x is string => !!x))];
  if (offen.length) {
    const rows = await db.select({ id: subjectTopics.id, title: subjectTopics.title }).from(subjectTopics).where(inArray(subjectTopics.id, offen));
    for (const r of rows) ziele.set(r.id, r.title);
  }

  type Buendel = { key: string; fachId: string; name: string; items: Set<string>; seit: string };
  const b = new Map<string, Buendel>();
  for (const z of zeilen) {
    const key = z.topicId ? (z.mergedInto ?? z.topicId) : `ohne:${z.subjectId}`;
    const name = z.topicId ? (z.mergedInto ? (ziele.get(z.mergedInto) ?? z.topicTitle ?? "") : (z.topicTitle ?? "")) : `${z.subjectName} · ohne Thema`;
    const e = b.get(key) ?? { key, fachId: z.subjectId, name, items: new Set(), seit: z.dueOn };
    e.items.add(z.itemId);
    if (z.dueOn < e.seit) e.seit = z.dueOn;
    b.set(key, e);
  }
  const naechsteKlausur = (fachId: string) => {
    const k = klausuren.filter((x) => x.fachId === fachId && x.datum >= heute).sort((x, y) => (x.datum < y.datum ? -1 : 1))[0];
    return k ? diffDays(heute, k.datum) : 9999;
  };
  return [...b.values()]
    .sort(
      (x, y) =>
        (x.seit < y.seit ? -1 : x.seit > y.seit ? 1 : 0) ||
        naechsteKlausur(x.fachId) - naechsteKlausur(y.fachId) ||
        y.items.size - x.items.size ||
        x.name.localeCompare(y.name, "de"),
    )
    .map((e) => ({ key: e.key, fachId: e.fachId, name: e.name, umfang: `${e.items.size} ${e.items.size === 1 ? "Frage" : "Fragen"}` }));
}

/** „Wiederholen“ wie auf dem Überblick (Prototyp `whState`, Z. 2016). */
async function whStand(userId: string, heute: string, themen: VorratThema[], ferien: boolean, durch: boolean): Promise<VorratWh> {
  if (ferien) return { kind: "ferien" };
  if (themen.length) {
    const [erstes] = themen;
    const fach = await db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, erstes.fachId)).limit(1);
    const label = erstes.key.startsWith("ohne:") ? erstes.name : `${fach[0]?.name ?? ""} · ${erstes.name}`;
    return { kind: "knopf", n: themen.length, sub: `Zuerst ${label}` };
  }
  const [naechster] = await db
    .select({ dueOn: recallSchedule.dueOn })
    .from(recallSchedule)
    .innerJoin(recallItems, eq(recallItems.id, recallSchedule.itemId))
    .where(and(eq(recallItems.userId, userId), isNull(recallItems.retiredAt), isNull(recallSchedule.doneAt), gte(recallSchedule.dueOn, heute)))
    .orderBy(asc(recallSchedule.dueOn))
    .limit(1);
  const [irgendeine] = await db.select({ id: recallItems.id }).from(recallItems).where(eq(recallItems.userId, userId)).limit(1);
  if (!irgendeine) return { kind: "leer" };
  const nd = naechster && naechster.dueOn > heute ? weekdayOrDate(naechster.dueOn, heute) : null;
  return {
    kind: "text",
    text: durch ? `Für heute durch.${nd ? ` Nächstes Thema ${nd}.` : ""}` : `Heute ist nichts fällig.${nd ? ` Nächstes Thema ${nd}.` : ""}`,
  };
}
