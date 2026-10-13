import { and, asc, eq, gte, inArray, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { examTopics, materialTopics, materials, studyBlocks, subjectTopics } from "@/db/schema";
import { berlinDay } from "@/lib/dates";
import { planEintragArt, planEintragTitel } from "@/lib/study-plan";
import { blocksForDay, listExams } from "@/lib/exams";
import { listFreePeriods } from "@/lib/free-days";
import { gradeLabel } from "@/lib/grade-scale";
import { gradesBySubject } from "@/lib/grades";
import { lessonRoom } from "@/lib/home";
import { listHomework } from "@/lib/homework";
import { fachEintraege } from "@/lib/kombi/fach-alias";
import { grammatikThemen } from "@/lib/kombi/grammatik-themen";
import { klausurImArchiv } from "@/lib/kombi/archiv";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { diffDays } from "@/lib/kombi/text";
import {
  ERLEDIGT_SUCHE_TAGE,
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
import { themenAuswahl, wiederholenStand, type FaelligesThema } from "@/recall/themen";

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

  // ── Aufgaben: offene und die der letzten zwei Wochen (für „Erledigt“ in der
  // Suche: die Hausaufgabenliste zeigt Erledigtes nur zwei Tage, die Zeile
  // findet es so lange, wie es früher in der Liste stand) ──
  const grenze = now.getTime() - ERLEDIGT_SUCHE_TAGE * 864e5;
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
        art: planEintragArt(r.block.kind),
        thema: r.block.kind === "probe" ? "ohne Hilfsmittel" : (r.topic?.title ?? "Gesamtwiederholung"),
        min: r.block.minutes,
        erledigt: r.block.status === "done",
      }));
  // Was im Archiv steht (ab Tag 15 nach dem Klausurtag), findet die Zeile nicht
  // mehr, wie die Liste „Klausuren“ und die Seite eines Fachs (klausurListe);
  // dorthin führt „archiv“
  const klausuren: VorratKlausur[] = klausurenRoh
    .filter((k) => aktiv.has(k.subjectId) && !klausurImArchiv(k.date, heute))
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
  // Dieselbe Folge und Art wie Überblick und Tisch (Abschnitt E, src/recall/themen.ts):
  // ein Übungsthema heißt „Arbeitsblatt“, ein ausgewertetes fehlt bis zum nächsten Termin
  // `themen` hält Maß (eins am Tag ohne Klausur); `themenAlle` ist ungekürzt für
  // „wiederholen ⟨Fach⟩“: wer ein Fach selbst öffnet, sieht dort alles Fällige
  // (wie GET /api/wiederholen?fach=…, Prototyp Z. 2405)
  const auswahl = inFerienHeute ? { themen: [], alle: [] } : await themenAuswahl(userId, heute);
  const alsVorrat = (t: FaelligesThema): VorratThema => ({ key: t.key, fachId: t.subjectId, name: t.titel, umfang: t.umfang });
  const themen: VorratThema[] = auswahl.themen.map(alsVorrat);
  const themenAlle: VorratThema[] = auswahl.alle.map(alsVorrat);
  const whE = await wiederholenStand(userId, heute);
  const wh: VorratWh = whE.kind === "text" ? { kind: "text", text: whE.text } : whE;

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
            label: planEintragTitel(offen.kind, offen.topic?.title),
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

  // ── Grammatikthemen für „Blatt Grammatik …“ (Antwort 5) ──────────────────
  const grammatik = await grammatikThemen(userId, faecher);

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
    themenAlle,
    wh,
    lernblock,
    epoche,
    themenListe,
    grammatik,
  };
}

/**
 * Fällige Themen, gebündelt je Fach-Thema (Plan 3.4, nur lesen). Fragen ohne
 * Thema werden je Fach zu „⟨Fach⟩ · ohne Thema“ zusammengefasst.
 */
