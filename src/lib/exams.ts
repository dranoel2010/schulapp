import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  arbeitsblaetter,
  exams,
  examTopics,
  leserLaeufe,
  studyBlocks,
  subjects,
  type Exam,
  type ExamTopic,
  type StudyBlock,
  type Subject,
} from "@/db/schema";
import { isCalendarDate, todayInBerlin } from "@/lib/dates";
import { freeDatesFrom } from "@/lib/free-days";
import { blockAngefangen } from "@/lib/lernblock";
import { normalizeTopics, topicKey } from "@/lib/topics";
import {
  buildPlan,
  PROBE_MINUTEN,
  probeTagFuer,
  probeTagGueltig,
  replanOpen,
  studyDaysFor,
  type Plan,
  type PlanKind,
  type PlanTopic,
} from "@/lib/study-plan";

/**
 * Klausuren, Themen und Lernblöcke — Validierung und Datenzugriff.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche. Der Lernplan
 * selbst wird in @/lib/study-plan gerechnet, hier wird er nur gespeichert.
 *
 * Jede Abfrage filtert zusätzlich nach userId, auch dort, wo die examId schon
 * eindeutig wäre. So kann kein fremder Datensatz durchrutschen, egal welche id
 * in der Adresszeile steht.
 *
 * Datumsfelder sind reine Kalenderdaten als Zeichenkette ("2026-09-14"). Sie
 * lassen sich als Zeichenketten vergleichen und sortieren; gerechnet wird
 * ausschließlich in @/lib/dates.
 */

const EXAM_KINDS = ["klausur", "test", "referat", "muendlich"] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eine kaputte id aus der Adresszeile würde Postgres sonst mit einem Typfehler
 * quittieren — hier wird daraus ein sauberes "gibt es nicht".
 */
function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Leere Eingabe soll als NULL in der Datenbank landen, nicht als "". */
function optionalText(maxLength: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(maxLength, tooLong)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null));
}

/**
 * Die Eingabe einer Prüfung, geprüft gegen den App-Tag `heute` (bis 4 Uhr
 * gilt der Vortag): Anlegen, Bearbeiten und „Lernplan neu erstellen“ rechnen
 * mit demselben Tag (Runde 20).
 */
export const examInputSchemaAb = (heute: string) => z.object({
  subjectId: z.uuid("Zu welchem Fach gehört die Prüfung?"),
  title: optionalText(80, "Der Titel ist zu lang. Höchstens 80 Zeichen."),
  kind: z.enum(EXAM_KINDS, "Diese Art von Prüfung kennt die App nicht."),
  date: z
    .string("Wann ist die Prüfung?")
    .trim()
    .refine(isCalendarDate, "Dieses Datum gibt es nicht.")
    // Der Vergangenheits-Test greift nur, wenn das Datum überhaupt lesbar ist —
    // sonst stünden zwei Meldungen an einem Feld.
    .refine(
      (value) => !isCalendarDate(value) || value >= heute,
      "Dieser Tag ist schon vorbei.",
    ),
  leadDays: z.coerce
    .number("Die Vorlaufzeit ist keine Zahl.")
    .int("Die Vorlaufzeit muss eine ganze Zahl sein.")
    .min(1, "Mindestens ein Lerntag.")
    .max(60, "Höchstens 60 Tage Vorlauf."),
  minutesPerDay: z.coerce
    .number("Die Lernzeit ist keine Zahl.")
    .int("Die Lernzeit muss eine ganze Zahl sein.")
    .min(10, "Mindestens 10 Minuten pro Tag.")
    .max(240, "Höchstens 240 Minuten pro Tag."),
  notes: optionalText(2000, "Die Notiz ist zu lang. Höchstens 2000 Zeichen."),
});

export type ExamInput = z.infer<ReturnType<typeof examInputSchemaAb>>;

/** Eine Prüfung in der Liste, mit Fach und Fortschritt. */
export type ExamListItem = Exam & {
  subject: Subject;
  topicCount: number;
  openBlocks: number;
  doneBlocks: number;
  /** Geplante Blöcke ohne die gestrichenen */
  totalBlocks: number;
};

/** Alles, was die Detailseite einer Prüfung braucht. */
export type ExamDetail = {
  exam: Exam;
  subject: Subject;
  topics: ExamTopic[];
  blocks: (StudyBlock & { topic: ExamTopic | null })[];
};

/** Ein Lernblock mit allem, was für die Anzeige an einem Tag nötig ist. */
export type TodayBlock = StudyBlock & {
  exam: Exam;
  subject: Subject;
  topic: ExamTopic | null;
};

/**
 * Ein Zählwert pro Prüfung, aufgeschlüsselt nach Zustand der Lernblöcke.
 * `total` zählt ohne die gestrichenen — genau wie die Detailseite, sonst
 * stünde in der Liste eine andere Zahl als auf der Prüfung selbst.
 */
type BlockCounts = { total: number; open: number; done: number };

export async function listExams(
  userId: string,
  options?: {
    includePast?: boolean;
    /** Der heutige Tag — Vorgabe der Kalendertag in Berlin; die Startseite reicht den App-Tag (Testuhr) durch. */
    heute?: string;
  },
): Promise<ExamListItem[]> {
  const today = options?.heute ?? todayInBerlin();

  const rows = await db
    .select({ exam: exams, subject: subjects })
    .from(exams)
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .where(
      options?.includePast
        ? eq(exams.userId, userId)
        : and(eq(exams.userId, userId), gte(exams.date, today)),
    )
    .orderBy(asc(exams.date));

  const examIds = rows.map((row) => row.exam.id);
  const [topicCounts, blockCounts] = await Promise.all([
    countTopics(examIds),
    countBlocks(examIds),
  ]);

  const items = rows.map((row): ExamListItem => {
    const counts = blockCounts.get(row.exam.id) ?? { total: 0, open: 0, done: 0 };
    return {
      ...row.exam,
      subject: row.subject,
      topicCount: topicCounts.get(row.exam.id) ?? 0,
      openBlocks: counts.open,
      doneBlocks: counts.done,
      totalBlocks: counts.total,
    };
  });

  // Kommende zuerst, die nächste oben. Vergangene hängen hinten dran, die
  // zuletzt geschriebene zuerst — die interessiert am ehesten.
  const upcoming = items.filter((item) => item.date >= today);
  const past = items
    .filter((item) => item.date < today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return [...upcoming, ...past];
}

export async function getExam(
  userId: string,
  examId: string,
): Promise<ExamDetail | null> {
  if (!isId(examId)) return null;

  const [row] = await db
    .select({ exam: exams, subject: subjects })
    .from(exams)
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .where(and(eq(exams.userId, userId), eq(exams.id, examId)))
    .limit(1);

  if (!row) return null;

  const [topics, blockRows] = await Promise.all([
    db
      .select()
      .from(examTopics)
      .where(eq(examTopics.examId, examId))
      .orderBy(asc(examTopics.sortOrder), asc(examTopics.title)),
    db
      .select({ block: studyBlocks, topic: examTopics })
      .from(studyBlocks)
      .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
      .where(eq(studyBlocks.examId, examId))
      .orderBy(asc(studyBlocks.date), asc(studyBlocks.sortOrder)),
  ]);

  return {
    exam: row.exam,
    subject: row.subject,
    topics,
    blocks: blockRows.map((entry) => ({
      ...entry.block,
      topic: entry.topic ?? null,
    })),
  };
}

export async function createExam(
  userId: string,
  input: ExamInput,
): Promise<Exam> {
  if (!(await ownsSubject(userId, input.subjectId))) {
    throw new Error("Dieses Fach gibt es nicht.");
  }

  const [exam] = await db
    .insert(exams)
    .values({ ...input, userId })
    .returning();

  if (!exam) {
    throw new Error("Die Prüfung konnte nicht gespeichert werden.");
  }

  return exam;
}

export async function updateExam(
  userId: string,
  examId: string,
  input: ExamInput,
): Promise<void> {
  if (!isId(examId)) return;
  if (!(await ownsSubject(userId, input.subjectId))) {
    throw new Error("Dieses Fach gibt es nicht.");
  }

  await db
    .update(exams)
    .set(input)
    .where(and(eq(exams.userId, userId), eq(exams.id, examId)));
}

export async function deleteExam(
  userId: string,
  examId: string,
): Promise<void> {
  if (!isId(examId)) return;

  await db.transaction(async (tx) => {
    await blockBlaetterLoeschen(
      tx,
      userId,
      inArray(
        studyBlocks.examId,
        tx.select({ id: exams.id }).from(exams).where(and(eq(exams.userId, userId), eq(exams.id, examId))),
      ),
    );
    await tx
      .delete(exams)
      .where(and(eq(exams.userId, userId), eq(exams.id, examId)));
  });
}

type Schreiber = Pick<typeof db, "select" | "delete">;

/**
 * Löscht die Arbeitsblätter, die nur an Lernblöcken hängen (Probeklausur,
 * Gesamtwiederholung: kein Fach-Thema), samt ihren Bauläufen — bevor die
 * Blöcke selbst gehen. Sonst setzte der Fremdschlüssel `study_block_id` auf
 * null, und `arbeitsblaetter_ziel_check` (Thema oder Block) wiese das Löschen
 * der Klausur oder des Fachs ab; ebenso `leser_laeufe_ziel_check` beim Lauf.
 * Die Bauläufe einer Klausur (Fragen) gehen beim Löschen ohnehin mit ihr.
 */
export async function blockBlaetterLoeschen(tx: Schreiber, userId: string, bloecke: SQL | undefined): Promise<void> {
  const blaetter = tx
    .select({ id: arbeitsblaetter.id })
    .from(arbeitsblaetter)
    .where(
      and(
        eq(arbeitsblaetter.userId, userId),
        isNull(arbeitsblaetter.subjectTopicId),
        inArray(arbeitsblaetter.studyBlockId, tx.select({ id: studyBlocks.id }).from(studyBlocks).where(bloecke)),
      ),
    );
  await tx.delete(leserLaeufe).where(and(eq(leserLaeufe.userId, userId), inArray(leserLaeufe.arbeitsblattId, blaetter)));
  await tx.delete(arbeitsblaetter).where(and(eq(arbeitsblaetter.userId, userId), inArray(arbeitsblaetter.id, blaetter)));
}

/**
 * Die Blöcke, an denen ein Arbeitsblatt ohne Fach-Thema hängt (Probeklausur,
 * Gesamtwiederholung). Beim Neuplanen bleiben sie stehen wie angefangene:
 * ihr Blatt hängt nur an ihnen und ist vielleicht schon gebaut oder gedruckt.
 */
async function bloeckeMitEigenemBlatt(blockIds: string[]): Promise<Set<string>> {
  if (blockIds.length === 0) return new Set();
  const zeilen = await db
    .select({ id: arbeitsblaetter.studyBlockId })
    .from(arbeitsblaetter)
    .where(and(isNull(arbeitsblaetter.subjectTopicId), inArray(arbeitsblaetter.studyBlockId, blockIds)));
  return new Set(zeilen.map((z) => z.id).filter((id): id is string => id !== null));
}

/**
 * Ersetzt die Themenliste einer Prüfung.
 *
 * Unveränderte Themen behalten ihre id — daran hängen die Lernblöcke. Deshalb
 * wird nach Titel verglichen und nur angelegt, was wirklich neu ist, und nur
 * gelöscht, was wirklich weg ist.
 */
export async function setTopics(
  userId: string,
  examId: string,
  titles: string[],
): Promise<void> {
  const exam = await findExam(userId, examId);
  if (!exam) return;

  // Zuschneiden nach denselben Regeln wie im Formular: getrimmt, gekürzt,
  // ohne Dubletten, gedeckelt. Vorher galten Länge und Anzahl nur auf dem Weg
  // übers Formular — ein direkter Aufruf kam ungebremst durch.
  const wanted = normalizeTopics(titles);

  const existing = await db
    .select()
    .from(examTopics)
    .where(eq(examTopics.examId, examId));

  const keptIds = new Set<string>();
  const updates: { id: string; title: string; sortOrder: number }[] = [];
  const inserts: { examId: string; title: string; sortOrder: number }[] = [];

  wanted.forEach((title, index) => {
    const match = existing.find(
      (topic) =>
        !keptIds.has(topic.id) &&
        topicKey(topic.title) === topicKey(title),
    );

    if (!match) {
      inserts.push({ examId, title, sortOrder: index });
      return;
    }

    keptIds.add(match.id);
    if (match.title !== title || match.sortOrder !== index) {
      updates.push({ id: match.id, title, sortOrder: index });
    }
  });

  const wegfallend = existing
    .filter((topic) => !keptIds.has(topic.id))
    .map((topic) => topic.id);

  // Ein Thema mit angefangenem Block bleibt stehen, bis der Block beendet ist:
  // an `exam_topics` hängen die Blöcke per cascade, und die Uhr ginge mit.
  const gehalten =
    wegfallend.length > 0
      ? await db
          .selectDistinct({ topicId: studyBlocks.topicId })
          .from(studyBlocks)
          .where(
            and(
              inArray(studyBlocks.topicId, wegfallend),
              eq(studyBlocks.status, "open"),
              or(isNotNull(studyBlocks.laeuftSeit), gt(studyBlocks.pauseMs, 0)),
            ),
          )
      : [];
  const halten = new Set(gehalten.map((zeile) => zeile.topicId));
  const removed = wegfallend.filter((id) => !halten.has(id));

  if (updates.length === 0 && inserts.length === 0 && removed.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    for (const update of updates) {
      await tx
        .update(examTopics)
        .set({ title: update.title, sortOrder: update.sortOrder })
        .where(eq(examTopics.id, update.id));
    }

    if (removed.length > 0) {
      await blockBlaetterLoeschen(tx, userId, inArray(studyBlocks.topicId, removed));
      await tx.delete(examTopics).where(inArray(examTopics.id, removed));
    }

    if (inserts.length > 0) {
      await tx.insert(examTopics).values(inserts);
    }
  });
}

/**
 * Rechnet den Lernplan neu und speichert ihn.
 *
 * Erledigte und gestrichene Blöcke bleiben unangetastet — sie sind die
 * Geschichte der Lernphase. Geplant wird nur, was davon noch übrig ist.
 */
/**
 * Ein Block, der beim Neuplanen stehen bleibt: erledigt, oder angefangen
 * (die Uhr lief schon, Modell 23, Plan 3.5). Ein angefangener Block ist noch
 * `open`, darf aber weder gelöscht noch verlegt werden — sonst ginge der
 * Uhrstand verloren, ein Arbeitsblatt verlöre seinen Block, und die Einträge
 * `lernblock_*` im Tagesprotokoll zeigten ins Leere. Seine Minuten zählen wie
 * die eines erledigten als belegt.
 */
function blockSteht(block: StudyBlock): boolean {
  return block.status === "done" || (block.status === "open" && blockAngefangen(block));
}

/** Offen und nicht angefangen: nur solche Blöcke plant das Neuverteilen um. */
function frei(block: StudyBlock): boolean {
  return block.status === "open" && !blockAngefangen(block);
}

/** SQL-Gegenstück zu `frei()` für das Löschen offener Blöcke. */
const freiSql = and(
  eq(studyBlocks.status, "open"),
  isNull(studyBlocks.laeuftSeit),
  eq(studyBlocks.pauseMs, 0),
);

/**
 * Minuten, die an einem Tag schon durch erledigte Blöcke dieser Prüfung
 * verbraucht sind. Gestrichene zählen nicht mit — die geben ihre Zeit wieder
 * frei.
 */
function occupiedMinutes(blocks: StudyBlock[]): Record<string, number> {
  const byDay: Record<string, number> = {};
  for (const block of blocks) {
    if (!blockSteht(block)) continue;
    byDay[block.date] = (byDay[block.date] ?? 0) + block.minutes;
  }
  return byDay;
}

/**
 * Alles, was an einem Tag schon vergeben ist: die erledigten Blöcke dieser
 * Prüfung — und was an dem Tag für **andere** Prüfungen geplant oder erledigt
 * ist.
 *
 * Der zweite Teil hat lange gefehlt, und es war ein Fehler mit Folgen. Jede
 * Prüfung plante für sich, und drei Klausuren mit überlappenden Lernphasen
 * legten drei Blöcke auf denselben Dienstag: 135 Minuten an einem Tag, den
 * niemand als überfüllt erkannt hat. Wer mehr Klausuren einträgt, bekam so
 * einen unrealistischeren Plan — Erfassen wurde bestraft.
 *
 * Bei den anderen Prüfungen zählen offene Blöcke mit, nicht nur erledigte: ein
 * geplanter Dienstag ist belegt, auch wenn er noch vor einem liegt.
 * Gestrichene zählen nirgends — die geben ihre Zeit wieder frei.
 *
 * Wer zuerst geplant wird, belegt die Tage; die nächste Prüfung bekommt, was
 * übrig bleibt. Das ist Absicht und keine Nachlässigkeit: ein gemeinsames
 * Neuverteilen aller Pläne würde einen Plan, an dem schon abgehakt wurde,
 * unter dem Nutzer wegziehen, sobald er die nächste Klausur einträgt.
 */
async function occupiedAcrossExams(
  userId: string,
  examId: string,
  ownBlocks: StudyBlock[],
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      date: studyBlocks.date,
      minutes: sql<number>`cast(sum(${studyBlocks.minutes}) as int)`,
    })
    .from(studyBlocks)
    .innerJoin(
      exams,
      and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)),
    )
    .where(
      and(ne(studyBlocks.examId, examId), ne(studyBlocks.status, "skipped")),
    )
    .groupBy(studyBlocks.date);

  const byDay = occupiedMinutes(ownBlocks);

  for (const row of rows) {
    byDay[row.date] = (byDay[row.date] ?? 0) + Number(row.minutes);
  }

  return byDay;
}

/**
 * Zieht eine Probeklausur auf einen neuen Tag nach: ein noch nicht gebautes
 * Blatt bekommt den neuen Tag in den Kopf.
 */
async function probeBlattTagNachziehen(tx: Pick<typeof db, "update">, userId: string, blockId: string, tag: string): Promise<void> {
  await tx
    .update(arbeitsblaetter)
    .set({ tag })
    .where(
      and(
        eq(arbeitsblaetter.userId, userId),
        eq(arbeitsblaetter.studyBlockId, blockId),
        isNull(arbeitsblaetter.subjectTopicId),
        eq(arbeitsblaetter.status, "wartet"),
      ),
    );
}

export async function generatePlan(
  userId: string,
  examId: string,
  today: string,
): Promise<Plan> {
  const exam = await findExam(userId, examId);
  if (!exam) {
    throw new Error("Diese Prüfung gibt es nicht.");
  }

  const [topics, blocks] = await Promise.all([
    db
      .select()
      .from(examTopics)
      .where(eq(examTopics.examId, examId))
      .orderBy(asc(examTopics.sortOrder), asc(examTopics.title)),
    db.select().from(studyBlocks).where(eq(studyBlocks.examId, examId)),
  ]);

  const planTopics: PlanTopic[] = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
  }));

  const [occupied, excludedDates] = await Promise.all([
    occupiedAcrossExams(userId, examId, blocks),
    freeDatesFrom(userId, today),
  ]);

  const plan = buildPlan({
    examDate: exam.date,
    today,
    topics: planTopics,
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
    excludedDates,
    occupied,
    probe: mitProbe(exam.kind),
  });

  // Erledigt, gestrichen, angefangen oder mit eigenem Arbeitsblatt: das bleibt stehen.
  // Ausnahme ist die offene Probeklausur mit Blatt: das Blatt bleibt, ihr Tag
  // aber folgt dem neuen Termin (sonst läge sie nach dem Vorverlegen am
  // Klausurtag oder nach dem Verschieben eine Woche zu früh).
  const eigenesBlatt = await bloeckeMitEigenemBlatt(blocks.map((block) => block.id));
  const wandernd = blocks.filter(
    (block) => frei(block) && block.kind === "probe" && eigenesBlatt.has(block.id),
  );
  const wanderndIds = new Set(wandernd.map((block) => block.id));
  const settled = blocks.filter(
    (block) => !wanderndIds.has(block.id) && (!frei(block) || eigenesBlatt.has(block.id)),
  );

  // Die Probe, die schon im Plan steht (mit Blatt zuerst), bleibt auf ihrem
  // Tag, solange er gilt (`replanOpen`, `probeTagGueltig`).
  const bisherigeProbe = wandernd[0] ?? blocks.find((block) => frei(block) && block.kind === "probe");

  if (settled.length === 0 && !bisherigeProbe) {
    // Nichts angefangen: der alte Plan darf komplett weichen.
    await db.transaction(async (tx) => {
      await tx.delete(studyBlocks).where(eq(studyBlocks.examId, examId));
      if (plan.blocks.length > 0) {
        await tx.insert(studyBlocks).values(
          plan.blocks.map((block) => ({
            examId,
            topicId: block.topicId,
            date: block.date,
            minutes: block.minutes,
            kind: block.kind,
            sortOrder: block.sortOrder,
            status: "open",
          })),
        );
      }
    });

    return plan;
  }

  // Jeder erledigte oder gestrichene Block deckt einen Posten des neuen Plans
  // schon ab. Was übrig bleibt, wird auf die Tage ab heute verteilt.
  const remaining = [...plan.blocks];
  for (const block of settled) {
    const index = remaining.findIndex(
      (entry) =>
        entry.topicId === block.topicId && entry.kind === toPlanKind(block.kind),
    );
    if (index >= 0) remaining.splice(index, 1);
  }

  // Der neue Plan lässt die Probe weg, wenn vor ihr kein Tag zum
  // Durcharbeiten liegt. Ist aber schon alles durchgearbeitet (der Stoff
  // steckt in `settled`) oder steht sie schon heute im Plan, gehört sie
  // trotzdem hinein: das entscheidet `replanOpen`, wie beim Nachholen. Eine
  // erledigte oder gestrichene Probe deckt ihren Posten schon ab.
  if (
    mitProbe(exam.kind) &&
    !plan.blocks.some((block) => block.kind === "probe") &&
    !settled.some((block) => block.kind === "probe") &&
    probeTagFuer(exam.date, plan.studyDays, excludedDates)
  ) {
    remaining.push({ date: today, topicId: null, kind: "probe", minutes: PROBE_MINUTEN, sortOrder: 0 });
  }

  const scheduled = replanOpen({
    examDate: exam.date,
    today,
    topics: planTopics,
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
    excludedDates,
    occupied,
    probe: mitProbe(exam.kind),
    open: remaining.map((block, index) => ({
      id: String(index),
      topicId: block.topicId,
      kind: block.kind,
      date: block.kind === "probe" ? (bisherigeProbe?.date ?? null) : null,
    })),
  });

  const placed = new Map(scheduled.map((entry) => [entry.id, entry]));
  // Der Probe-Posten des neuen Plans geht an die erste wandernde Probeklausur:
  // sie zieht samt Blatt auf den neuen Tag. Bekommt er keinen Tag (oder es gibt
  // ihn nicht, weil schon eine Probe erledigt ist), wird sie gestrichen.
  const verlegt: { id: string; date: string; minutes: number; sortOrder: number }[] = [];
  const rows = remaining.flatMap((block, index) => {
    const slot = placed.get(String(index));
    if (!slot) return [];
    if (block.kind === "probe" && verlegt.length < wandernd.length) {
      verlegt.push({ id: wandernd[verlegt.length].id, date: slot.date, minutes: slot.minutes, sortOrder: slot.sortOrder });
      return [];
    }
    return [
      {
        examId,
        topicId: block.topicId,
        date: slot.date,
        minutes: slot.minutes,
        kind: block.kind,
        sortOrder: slot.sortOrder,
        status: "open",
      },
    ];
  });
  const verlegtIds = new Set(verlegt.map((v) => v.id));
  const gestrichen = wandernd.filter((block) => !verlegtIds.has(block.id));

  await db.transaction(async (tx) => {
    await tx
      .delete(studyBlocks)
      .where(
        and(
          eq(studyBlocks.examId, examId),
          freiSql,
          eigenesBlatt.size > 0 ? notInArray(studyBlocks.id, [...eigenesBlatt]) : undefined,
        ),
      );
    for (const v of verlegt) {
      await tx
        .update(studyBlocks)
        .set({ date: v.date, minutes: v.minutes, sortOrder: v.sortOrder })
        .where(and(eq(studyBlocks.id, v.id), eq(studyBlocks.examId, examId)));
      // Ein noch nicht gebautes Blatt bekommt den neuen Tag in den Kopf.
      await probeBlattTagNachziehen(tx, userId, v.id, v.date);
    }
    if (gestrichen.length > 0) {
      await tx
        .update(studyBlocks)
        .set({ status: "skipped" })
        .where(
          and(
            eq(studyBlocks.examId, examId),
            inArray(studyBlocks.id, gestrichen.map((block) => block.id)),
          ),
        );
    }
    if (rows.length > 0) {
      await tx.insert(studyBlocks).values(rows);
    }
  });

  return plan;
}

export async function setBlockStatus(
  userId: string,
  blockId: string,
  status: "open" | "done" | "skipped",
): Promise<void> {
  if (!isId(blockId)) return;

  await db
    .update(studyBlocks)
    .set({ status })
    .where(and(eq(studyBlocks.id, blockId), inArray(studyBlocks.examId, ownExamIds(userId))));
}

/**
 * Nachholen: alle offenen Blöcke — die verpassten und die noch anstehenden —
 * werden auf die verbleibenden Tage neu verteilt. Erledigtes und Gestrichenes
 * bleibt, wo es ist.
 */
export async function catchUpMissed(
  userId: string,
  examId: string,
  today: string,
): Promise<void> {
  const exam = await findExam(userId, examId);
  if (!exam) return;
  if (!isCalendarDate(today)) return;
  // Am Klausurtag und danach wird nichts mehr verteilt: die Blöcke bleiben,
  // wo sie sind, statt auf einen Nachmittag nach der Klausur zu rutschen.
  if (exam.date <= today) return;

  const [topics, all] = await Promise.all([
    db
      .select()
      .from(examTopics)
      .where(eq(examTopics.examId, examId))
      .orderBy(asc(examTopics.sortOrder), asc(examTopics.title)),
    db
      .select()
      .from(studyBlocks)
      .where(eq(studyBlocks.examId, examId))
      .orderBy(asc(studyBlocks.date), asc(studyBlocks.sortOrder)),
  ]);

  // Die erledigten brauchen wir nicht zum Verschieben, aber um zu wissen,
  // an welchen Tagen schon Lernzeit verbraucht ist.
  // Angefangene Blöcke bleiben, wo sie sind (blockSteht).
  const open = all.filter(frei);
  if (open.length === 0) return;

  const [occupied, excludedDates] = await Promise.all([
    occupiedAcrossExams(userId, examId, all),
    freeDatesFrom(userId, today),
  ]);

  const scheduled = replanOpen({
    examDate: exam.date,
    today,
    topics: topics.map((topic) => ({ id: topic.id, title: topic.title })),
    leadDays: exam.leadDays,
    minutesPerDay: exam.minutesPerDay,
    excludedDates,
    occupied,
    probe: mitProbe(exam.kind),
    open: open.map((block) => ({
      id: block.id,
      topicId: block.topicId,
      kind: toPlanKind(block.kind),
      date: block.date,
    })),
  });

  const placed = new Map(scheduled.map((entry) => [entry.id, entry]));

  await db.transaction(async (tx) => {
    for (const block of open) {
      const slot = placed.get(block.id);

      if (slot) {
        if (block.kind === "probe" && slot.date !== block.date) {
          await probeBlattTagNachziehen(tx, userId, block.id, slot.date);
        }
        await tx
          .update(studyBlocks)
          .set({
            date: slot.date,
            minutes: slot.minutes,
            sortOrder: slot.sortOrder,
          })
          .where(
            and(eq(studyBlocks.id, block.id), eq(studyBlocks.examId, examId)),
          );
        continue;
      }

      // Eine Probeklausur ohne Tag vor der Prüfung fällt weg: am Prüfungstag
      // selbst schreibt niemand eine Probe.
      if (block.kind === "probe") {
        await tx
          .update(studyBlocks)
          .set({ status: "skipped" })
          .where(
            and(eq(studyBlocks.id, block.id), eq(studyBlocks.examId, examId)),
          );
        continue;
      }

      // Kein Platz mehr gefunden: der Block rutscht auf heute, statt in der
      // Vergangenheit hängen zu bleiben und morgen wieder nachzufragen. Ist
      // heute frei, bleibt er stehen: Ferien bleiben frei, und dort fragt die
      // Startseite nicht nach.
      if (block.date < today && !excludedDates.includes(today)) {
        await tx
          .update(studyBlocks)
          .set({ date: today })
          .where(
            and(eq(studyBlocks.id, block.id), eq(studyBlocks.examId, examId)),
          );
      }
    }
  });
}

/**
 * Räumt die freien Tage frei, nachdem Ferien oder eine Klassenfahrt
 * eingetragen wurden.
 *
 * Neu verteilt werden nur die offenen Blöcke ab heute, und nur bei Prüfungen,
 * von denen mindestens einer auf einen freien Tag fällt. Verpasste Blöcke aus
 * der Vergangenheit bleiben, wo sie sind — über die entscheidet die Nachfrage
 * auf der Startseite, nicht das Eintragen von Ferien.
 *
 * Gibt die Zahl der Prüfungen zurück, deren Plan sich bewegt hat.
 */
export async function moveOffFreeDays(
  userId: string,
  today: string,
): Promise<number> {
  if (!isCalendarDate(today)) return 0;

  const excludedDates = await freeDatesFrom(userId, today);
  if (excludedDates.length === 0) return 0;
  const free = new Set(excludedDates);

  const upcoming = await db
    .select()
    .from(exams)
    .where(and(eq(exams.userId, userId), gte(exams.date, today)));

  let moved = 0;

  for (const exam of upcoming) {
    const [topics, all] = await Promise.all([
      db
        .select()
        .from(examTopics)
        .where(eq(examTopics.examId, exam.id))
        .orderBy(asc(examTopics.sortOrder), asc(examTopics.title)),
      db
        .select()
        .from(studyBlocks)
        .where(eq(studyBlocks.examId, exam.id))
        .orderBy(asc(studyBlocks.date), asc(studyBlocks.sortOrder)),
    ]);

    const open = all.filter((block) => frei(block) && block.date >= today);
    // Die Probe darf an ihrem freien Tag liegen (letzter Ferientag vor der
    // Klausur, `probeTagFuer`); nur alles andere muss aus den Ferien.
    const lerntage = studyDaysFor({ examDate: exam.date, today, leadDays: exam.leadDays, excludedDates });
    const darfBleiben = (block: StudyBlock) =>
      block.kind === "probe" && probeTagGueltig(exam.date, lerntage, block.date, excludedDates);
    if (!open.some((block) => free.has(block.date) && !darfBleiben(block))) continue;

    const occupied = await occupiedAcrossExams(userId, exam.id, all);

    const scheduled = replanOpen({
      examDate: exam.date,
      today,
      topics: topics.map((topic) => ({ id: topic.id, title: topic.title })),
      leadDays: exam.leadDays,
      minutesPerDay: exam.minutesPerDay,
      excludedDates,
      occupied,
      probe: mitProbe(exam.kind),
      open: open.map((block) => ({
        id: block.id,
        topicId: block.topicId,
        kind: toPlanKind(block.kind),
        date: block.date,
      })),
    });

    const placed = new Map(scheduled.map((entry) => [entry.id, entry]));

    await db.transaction(async (tx) => {
      for (const block of open) {
        const slot = placed.get(block.id);
        if (!slot) {
          // Eine Probeklausur ohne Schultag vor der Prüfung fällt weg.
          if (block.kind === "probe") {
            await tx
              .update(studyBlocks)
              .set({ status: "skipped" })
              .where(
                and(eq(studyBlocks.id, block.id), eq(studyBlocks.examId, exam.id)),
              );
          }
          continue;
        }

        if (block.kind === "probe" && slot.date !== block.date) {
          await probeBlattTagNachziehen(tx, userId, block.id, slot.date);
        }
        await tx
          .update(studyBlocks)
          .set({
            date: slot.date,
            minutes: slot.minutes,
            sortOrder: slot.sortOrder,
          })
          .where(
            and(eq(studyBlocks.id, block.id), eq(studyBlocks.examId, exam.id)),
          );
      }
    });

    moved += 1;
  }

  return moved;
}

/** Streichen: die verpassten Blöcke werden abgehakt, ohne neuen Termin. */
export async function skipMissed(
  userId: string,
  examId: string,
  today: string,
): Promise<void> {
  const exam = await findExam(userId, examId);
  if (!exam) return;
  if (!isCalendarDate(today)) return;

  await db
    .update(studyBlocks)
    .set({ status: "skipped" })
    .where(
      and(
        eq(studyBlocks.examId, examId),
        eq(studyBlocks.status, "open"),
        lt(studyBlocks.date, today),
      ),
    );
}

/**
 * Was an einem Tag ansteht. Gestrichene Blöcke bleiben draußen, erledigte nicht
 * — sonst würde ein Häkchen den Block aus der Liste werfen.
 */
export async function blocksForDay(
  userId: string,
  day: string,
): Promise<TodayBlock[]> {
  if (!isCalendarDate(day)) return [];

  const rows = await db
    .select({
      block: studyBlocks,
      exam: exams,
      subject: subjects,
      topic: examTopics,
    })
    .from(studyBlocks)
    .innerJoin(
      exams,
      and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)),
    )
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(and(eq(studyBlocks.date, day), ne(studyBlocks.status, "skipped")))
    .orderBy(asc(exams.date), asc(studyBlocks.sortOrder));

  return rows.map((row) => ({
    ...row.block,
    exam: row.exam,
    subject: row.subject,
    topic: row.topic ?? null,
  }));
}

/**
 * Offene Blöcke aus der Vergangenheit — die Grundlage für die Nachfrage
 * "gestern nicht geschafft". Prüfungen, die heute sind oder schon vorbei,
 * fragen nicht mehr nach.
 */
export async function missedBlocks(
  userId: string,
  today: string,
): Promise<TodayBlock[]> {
  if (!isCalendarDate(today)) return [];

  const rows = await db
    .select({
      block: studyBlocks,
      exam: exams,
      subject: subjects,
      topic: examTopics,
    })
    .from(studyBlocks)
    .innerJoin(
      exams,
      and(eq(exams.id, studyBlocks.examId), eq(exams.userId, userId)),
    )
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .leftJoin(examTopics, eq(examTopics.id, studyBlocks.topicId))
    .where(
      and(
        eq(studyBlocks.status, "open"),
        lt(studyBlocks.date, today),
        // Am Klausurtag wird nicht mehr geübt: auch nicht nachgeholt.
        gt(exams.date, today),
      ),
    )
    .orderBy(asc(exams.date), asc(studyBlocks.date), asc(studyBlocks.sortOrder));

  return rows.map((row) => ({
    ...row.block,
    exam: row.exam,
    subject: row.subject,
    topic: row.topic ?? null,
  }));
}

export async function upcomingExams(
  userId: string,
  today: string,
  limit = 5,
): Promise<(Exam & { subject: Subject })[]> {
  if (!isCalendarDate(today)) return [];

  const rows = await db
    .select({ exam: exams, subject: subjects })
    .from(exams)
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .where(and(eq(exams.userId, userId), gte(exams.date, today)))
    .orderBy(asc(exams.date))
    .limit(limit);

  return rows.map((row) => ({ ...row.exam, subject: row.subject }));
}

/**
 * Die Themen aller Prüfungen eines Nutzers, je Prüfung in ihrer Reihenfolge —
 * für den Google Kalender (@/lib/calendar/sources), der sie in die
 * Beschreibung eines Klausurtermins schreibt.
 *
 * Eine Abfrage für alle statt `getExam()` je Prüfung: Der Abgleich läuft nach
 * jedem Speichern und stündlich, und ein Schuljahr hat zwanzig Prüfungen.
 */
export async function examTopicTitles(
  userId: string,
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ examId: examTopics.examId, title: examTopics.title })
    .from(examTopics)
    .innerJoin(exams, eq(exams.id, examTopics.examId))
    .where(eq(exams.userId, userId))
    // Dieselbe Reihenfolge wie auf der Prüfung selbst (`getExam()`).
    .orderBy(asc(examTopics.examId), asc(examTopics.sortOrder), asc(examTopics.title));

  const titles = new Map<string, string[]>();

  for (const row of rows) {
    const list = titles.get(row.examId);
    if (list) list.push(row.title);
    else titles.set(row.examId, [row.title]);
  }

  return titles;
}

/** Prüfung samt Besitzprüfung — jede schreibende Funktion geht hier durch. */
async function findExam(userId: string, examId: string): Promise<Exam | null> {
  if (!isId(examId)) return null;

  const [exam] = await db
    .select()
    .from(exams)
    .where(and(eq(exams.userId, userId), eq(exams.id, examId)))
    .limit(1);

  return exam ?? null;
}

async function ownsSubject(userId: string, subjectId: string): Promise<boolean> {
  if (!isId(subjectId)) return false;

  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, subjectId)))
    .limit(1);

  return subject !== undefined;
}

/** Unterabfrage: alle Prüfungen dieses Nutzers. */
function ownExamIds(userId: string) {
  return db.select({ id: exams.id }).from(exams).where(eq(exams.userId, userId));
}

function toPlanKind(kind: string): PlanKind {
  return kind === "review" || kind === "probe" ? kind : "learn";
}

/** Klausur und Test bekommen eine Probeklausur, Referat und Mündliches nicht. */
export function mitProbe(examKind: string): boolean {
  return examKind === "klausur" || examKind === "test";
}

async function countTopics(examIds: string[]): Promise<Map<string, number>> {
  if (examIds.length === 0) return new Map();

  const rows = await db
    .select({
      examId: examTopics.examId,
      total: sql<number>`cast(count(*) as int)`,
    })
    .from(examTopics)
    .where(inArray(examTopics.examId, examIds))
    .groupBy(examTopics.examId);

  return new Map(rows.map((row) => [row.examId, Number(row.total)]));
}

async function countBlocks(examIds: string[]): Promise<Map<string, BlockCounts>> {
  if (examIds.length === 0) return new Map();

  const rows = await db
    .select({
      examId: studyBlocks.examId,
      total: sql<number>`cast(count(*) filter (where ${studyBlocks.status} <> 'skipped') as int)`,
      open: sql<number>`cast(count(*) filter (where ${studyBlocks.status} = 'open') as int)`,
      done: sql<number>`cast(count(*) filter (where ${studyBlocks.status} = 'done') as int)`,
    })
    .from(studyBlocks)
    .where(inArray(studyBlocks.examId, examIds))
    .groupBy(studyBlocks.examId);

  return new Map(
    rows.map((row) => [
      row.examId,
      {
        total: Number(row.total),
        open: Number(row.open),
        done: Number(row.done),
      },
    ]),
  );
}
