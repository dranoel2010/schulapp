import type { ProposalKind } from "@/db/schema";
import {
  daysBetween,
  formatGerman,
  isCalendarDate,
  todayInBerlin,
} from "@/lib/dates";
import {
  blocksForDay,
  getExam,
  listExams,
  type ExamListItem,
} from "@/lib/exams";
import { gradeLabel } from "@/lib/grade-scale";
import { gradeSummary } from "@/lib/grades";
import { listHomework } from "@/lib/homework";
import { formatBytes } from "@/lib/images";
import { getMaterial, listMaterials, readPageImage } from "@/lib/materials";
import type { Caller } from "@/lib/oauth";
import {
  createProposal,
  listProposals,
  proposalHeadline,
} from "@/lib/proposals";
import { listTopics } from "@/lib/subject-topics";
import { listSubjects } from "@/lib/subjects";
import { WEEKDAYS, loadWeek } from "@/lib/timetable";

/**
 * Die Werkzeuge, die dieser Server einem Agenten anbietet.
 *
 * **Sie sitzen neben den Server Actions, nicht darüber.** Beide rufen dieselben
 * Funktionen in @/lib. Über die Actions zu gehen wäre nicht bloß unschön,
 * sondern unmöglich: eine Server Action endet mit `redirect()`, und das wirft
 * intern — ein Werkzeug bekäme nie ein Ergebnis, sondern eine Ausnahme.
 *
 * **`read_*` und `propose_*`, und sonst nichts.** Es gibt kein Werkzeug, das
 * anlegt, ändert oder löscht — nicht abgeschaltet, nicht hinter einem Scope,
 * sondern gar nicht vorhanden. Was der Agent will, legt er als Vorschlag in
 * den Eingangskorb; übernommen wird er von einem Menschen, durch dieselbe Tür
 * wie ein Formular. Das ist keine Vorsichtsmaßnahme, sondern die Bedingung des
 * ganzen Vorhabens: wer nicht vertrauenswürdige Blätter liest und zugleich
 * schreiben dürfte, ist über das Blatt selbst angreifbar. Auf einem
 * abfotografierten Arbeitsblatt kann stehen, was will — es kommt hier nur als
 * Vorschlag heraus.
 *
 * **Und die Gegenrichtung: alles, was hier steht, geht auch von Hand.** Jedes
 * `propose_*` hat seine Entsprechung unter `/eingang/neu`, jedes `read_*` seine
 * Seite in der App. Ein Werkzeug ohne Weg in der Oberfläche wäre eine Fähigkeit,
 * die der Agent hat und der Mensch nicht.
 *
 * Die Feldnamen sind deutsch wie der Rest der App. Ein Agent, der „faellig“
 * liest, schreibt seine Vorschläge auch auf Deutsch — und wer das Ergebnis
 * eines Werkzeugs neben die Oberfläche legt, soll dieselben Wörter finden.
 *
 * **Jede Antwort ist gedeckelt.** Ein Werkzeugergebnis darf bei Claude rund
 * 25.000 Token groß sein; eine ungebremste Liste über ein Schuljahr reißt das.
 * Wo gedeckelt wird, sagt die Antwort es (`gekuerzt`), statt still abzuschneiden
 * — dieselbe Regel wie in der Ablage.
 */

/** Ein Werkzeug, so wie `tools/list` es beschreibt. */
export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

/** Was in einem Werkzeugergebnis stehen kann. */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolOutcome = {
  content: ToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
};

type Tool = ToolDefinition & {
  run: (caller: Caller, args: Record<string, unknown>) => Promise<ToolOutcome>;
};

/**
 * So viele Zeilen gibt eine Liste höchstens heraus, wenn nichts anderes
 * gefragt ist. Zwanzig Blätter oder Aufgaben sind ein überschaubarer Ausschnitt
 * und bleiben weit unter jeder Größengrenze.
 */
const DEFAULT_LIMIT = 20;

/** Mehr als das gibt kein Werkzeug heraus, auch wenn danach gefragt wird. */
const MAX_LIMIT = 100;

/** Nur Lesen: die Umgebung bleibt, wie sie ist. */
const READS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  // Diese App ist eine geschlossene Welt: ein Werkzeug hier fragt die eigene
  // Datenbank und sonst nichts.
  openWorldHint: false,
} as const;

/**
 * Schreibt — aber nur in den Eingangskorb, und nur hinzu.
 *
 * `destructiveHint: false` ist hier keine Höflichkeit: ein Vorschlag legt eine
 * Zeile an und fasst keine andere an. `idempotentHint: true` gilt, weil
 * derselbe Vorschlag zum zweiten Mal nichts hinzufügt — der eindeutige Index
 * über den Abdruck weist ihn ab.
 */
const PROPOSES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/* -------------------------------------------------------------------------
   Kleine Helfer
   ------------------------------------------------------------------------- */

/** Ein Ergebnis: die Daten als JSON-Text und daneben als Struktur. */
function ok(data: Record<string, unknown>): ToolOutcome {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/**
 * Ein Fehler, den das Modell sehen und beantworten soll.
 *
 * Ausdrücklich `isError` im Ergebnis und kein JSON-RPC-Fehler: ein
 * Protokollfehler kommt beim Modell gar nicht erst an, es könnte sich also
 * nicht selbst korrigieren. „Dieses Blatt gibt es nicht“ ist aber genau ein
 * Satz, aus dem sich etwas machen lässt.
 */
function fail(satz: string): ToolOutcome {
  return { content: [{ type: "text", text: satz }], isError: true };
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function optStr(args: Record<string, unknown>, key: string): string | null {
  const value = str(args, key);
  return value === "" ? null : value;
}

function bool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function strings(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

function limitOf(args: Record<string, unknown>): number {
  const value = args.limit;
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;

  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

/** „gekuerzt: true“ heißt: hier fehlt etwas, und zwar absichtlich. */
function truncated<T>(rows: T[], limit: number): { rows: T[]; gekuerzt: boolean } {
  return { rows: rows.slice(0, limit), gekuerzt: rows.length > limit };
}

/** Ein Kalendertag aus den Argumenten, sonst heute. */
function dayOf(args: Record<string, unknown>): string | null {
  const value = optStr(args, "tag");
  if (value === null) return todayInBerlin();

  return isCalendarDate(value) ? value : null;
}

/** Das immer gleiche Fach-Häppchen unter jedem Eintrag. */
function subjectOf(subject: { id: string; name: string; short: string }) {
  return { id: subject.id, name: subject.name, kuerzel: subject.short };
}

/** Ein Objekt-Schema ohne Parameter — der Fall „dieses Werkzeug fragt nichts“. */
const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

/** Der Verweis auf ein Blatt, wie ihn jedes `propose_*` verlangt. */
const BLATT_ID = {
  type: "string",
  description:
    "Die id des Blattes, aus dem der Vorschlag gelesen wurde. Kommt aus read_material oder read_blatt.",
};

const BEGRUENDUNG = {
  type: "string",
  description:
    "Ein Satz, woran du das festmachst. Steht später beim Vorschlag im Eingangskorb.",
};

/* -------------------------------------------------------------------------
   Die Werkzeuge
   ------------------------------------------------------------------------- */

const TOOLS: Tool[] = [
  {
    name: "read_faecher",
    title: "Fächer",
    description:
      "Alle Schulfächer mit Kürzel, Lehrkraft, Raum und Notengewichtung. Der Einstiegspunkt: fast alles andere hängt an einer Fach-id.",
    inputSchema: {
      type: "object",
      properties: {
        archivierte: {
          type: "boolean",
          description:
            "Auch abgewählte Fächer mitliefern. Vorgabe: nein — sie zählen im Alltag nicht mehr mit.",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Fächer lesen", ...READS },
    async run(caller, args) {
      const subjects = await listSubjects(caller.userId, {
        includeArchived: bool(args, "archivierte"),
      });

      return ok({
        faecher: subjects.map((subject) => ({
          ...subjectOf(subject),
          farbe: subject.color,
          lehrkraft: subject.teacher,
          raum: subject.room,
          gewichtSchriftlichProzent: subject.weightWritten,
          archiviert: subject.archived,
        })),
      });
    },
  },

  {
    name: "read_stundenplan",
    title: "Stundenplan",
    description:
      "Der feste Wochenplan von Montag bis Freitag samt Stundenraster (wann welche Stunde beginnt und endet).",
    inputSchema: NO_ARGS,
    annotations: { title: "Stundenplan lesen", ...READS },
    async run(caller) {
      const week = await loadWeek(caller.userId);

      return ok({
        stundenraster: week.periods.map((period) => ({
          nummer: period.number,
          beginn: period.startsAt,
          ende: period.endsAt,
        })),
        woche: week.days.map((day) => ({
          wochentag: day.weekday,
          name:
            WEEKDAYS.find((entry) => entry.value === day.weekday)?.long ?? "",
          stunden: day.lessons.map((lesson) => ({
            stunde: lesson.period,
            fach: subjectOf(lesson.subject),
            raum: lesson.room ?? lesson.subject.room,
            notiz: lesson.note,
          })),
        })),
      });
    },
  },

  {
    name: "read_hausaufgaben",
    title: "Hausaufgaben",
    description:
      "Die Aufgabenliste. Ohne Argumente kommen die offenen Aufgaben, die früheste Fälligkeit zuerst.",
    inputSchema: {
      type: "object",
      properties: {
        auchErledigte: {
          type: "boolean",
          description:
            "Auch abgehakte Aufgaben mitliefern. Gelöscht wird eine Aufgabe nie, hier kommen also auch alte.",
        },
        limit: {
          type: "integer",
          description: `Wie viele Aufgaben höchstens (1 bis ${MAX_LIMIT}, Vorgabe ${DEFAULT_LIMIT}).`,
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Hausaufgaben lesen", ...READS },
    async run(caller, args) {
      const items = await listHomework(caller.userId, {
        includeDone: bool(args, "auchErledigte"),
      });
      const { rows, gekuerzt } = truncated(items, limitOf(args));
      const today = todayInBerlin();

      return ok({
        heute: today,
        gekuerzt,
        aufgaben: rows.map((item) => ({
          id: item.id,
          fach: subjectOf(item.subject),
          titel: item.title,
          notiz: item.details,
          faellig: item.dueDate,
          ueberfaellig: !item.done && item.dueDate < today,
          erledigt: item.done,
        })),
      });
    },
  },

  {
    name: "read_klausuren",
    title: "Klausuren und Prüfungen",
    description:
      "Alle Prüfungstermine mit Countdown und Lernfortschritt. Mit einer id kommt eine einzelne Prüfung samt ihren Themen.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "Die id einer Prüfung. Dann kommen auch ihre Themen und ihr Lernplan.",
        },
        limit: {
          type: "integer",
          description: `Wie viele Prüfungen höchstens (1 bis ${MAX_LIMIT}, Vorgabe ${DEFAULT_LIMIT}).`,
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Prüfungen lesen", ...READS },
    async run(caller, args) {
      const today = todayInBerlin();
      const id = optStr(args, "id");

      if (id) {
        const detail = await getExam(caller.userId, id);
        if (!detail) return fail("Diese Prüfung gibt es nicht.");

        return ok({
          heute: today,
          pruefung: {
            id: detail.exam.id,
            fach: subjectOf(detail.subject),
            art: detail.exam.kind,
            titel: detail.exam.title,
            datum: detail.exam.date,
            tageBis: daysBetween(today, detail.exam.date),
            vorlaufTage: detail.exam.leadDays,
            minutenProTag: detail.exam.minutesPerDay,
            notiz: detail.exam.notes,
            themen: detail.topics.map((topic) => topic.title),
            lernbloecke: detail.blocks.map((block) => ({
              tag: block.date,
              minuten: block.minutes,
              art: block.kind,
              zustand: block.status,
              thema: block.topic?.title ?? null,
            })),
          },
        });
      }

      const exams = await listExams(caller.userId);
      const { rows, gekuerzt } = truncated(exams, limitOf(args));

      return ok({
        heute: today,
        gekuerzt,
        pruefungen: rows.map((exam: ExamListItem) => ({
          id: exam.id,
          fach: subjectOf(exam.subject),
          art: exam.kind,
          titel: exam.title,
          datum: exam.date,
          tageBis: daysBetween(today, exam.date),
          anzahlThemen: exam.topicCount,
          lernbloecke: {
            offen: exam.openBlocks,
            erledigt: exam.doneBlocks,
            gesamt: exam.totalBlocks,
          },
        })),
      });
    },
  },

  {
    name: "read_noten",
    title: "Noten",
    description:
      "Gesamtschnitt und Schnitt je Fach. Die Werte sind deutsche Noten von 1,0 bis 6,0 — kleiner ist besser.",
    inputSchema: NO_ARGS,
    annotations: { title: "Noten lesen", ...READS },
    async run(caller) {
      const summary = await gradeSummary(caller.userId);

      return ok({
        gesamtschnitt: summary.overall,
        anzahlNoten: summary.gradeCount,
        faecherMitNoten: summary.gradedSubjects,
        letzteNote: summary.latest
          ? {
              fach: subjectOf(summary.latest.subject),
              note: gradeLabel(summary.latest.value),
              art: summary.latest.kind,
              titel: summary.latest.title,
              datum: summary.latest.date,
            }
          : null,
        faecher: summary.perSubject.map((entry) => ({
          fach: subjectOf(entry.subject),
          schnitt: entry.average,
          anzahl: entry.count,
        })),
      });
    },
  },

  {
    name: "read_themen",
    title: "Themen eines Fachs",
    description:
      "Das Themen-Vokabular eines Fachs: die Schreibweisen, aus denen Klausuren und Blätter schöpfen. Vor propose_themen lesen — dann trifft ein Vorschlag die Schreibweise, die es schon gibt.",
    inputSchema: {
      type: "object",
      properties: {
        fachId: {
          type: "string",
          description: "Die id des Fachs, aus read_faecher.",
        },
        limit: {
          type: "integer",
          description: `Wie viele Themen höchstens (1 bis ${MAX_LIMIT}, Vorgabe ${DEFAULT_LIMIT}).`,
        },
      },
      required: ["fachId"],
      additionalProperties: false,
    },
    annotations: { title: "Themen lesen", ...READS },
    async run(caller, args) {
      const subjectId = str(args, "fachId");
      if (!subjectId) return fail("Ohne fachId geht es nicht.");

      const topics = await listTopics(caller.userId, subjectId);
      const { rows, gekuerzt } = truncated(topics, limitOf(args));

      return ok({
        gekuerzt,
        themen: rows.map((topic) => ({
          id: topic.id,
          titel: topic.title,
          herkunft: topic.origin,
          zuletzt: topic.lastSeenAt,
          inKlausuren: topic.examCount,
          anBlaettern: topic.materialCount,
        })),
      });
    },
  },

  {
    name: "read_material",
    title: "Blätter",
    description:
      "Die abfotografierten Blätter — Arbeitsblätter, Tafelbilder, Kopien. Ohne Bilder; die holt read_blatt.",
    inputSchema: {
      type: "object",
      properties: {
        fachId: {
          type: "string",
          description: "Nur Blätter dieses Fachs.",
        },
        limit: {
          type: "integer",
          description: `Wie viele Blätter höchstens (1 bis ${MAX_LIMIT}, Vorgabe ${DEFAULT_LIMIT}).`,
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Blätter lesen", ...READS },
    async run(caller, args) {
      const limit = limitOf(args);
      const items = await listMaterials(caller.userId, {
        subjectId: optStr(args, "fachId") ?? undefined,
        limit: limit + 1,
      });
      const { rows, gekuerzt } = truncated(items, limit);

      return ok({
        gekuerzt,
        blaetter: rows.map((item) => ({
          id: item.id,
          titel: item.title,
          fach: subjectOf(item.subject),
          schultag: item.capturedOn,
          notiz: item.note,
          seiten: item.pageCount,
          themen: item.topics.map((topic) => topic.title),
        })),
      });
    },
  },

  {
    name: "read_blatt",
    title: "Ein Blatt ansehen",
    description:
      "Ein einzelnes Blatt samt dem Foto einer Seite. Das Bild kommt als Bildinhalt zurück — lies daraus ab, was auf dem Papier steht. Mehrseitige Blätter Seite für Seite abfragen.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Die id des Blattes, aus read_material.",
        },
        seite: {
          type: "integer",
          description: "Welche Seite, beginnend bei 1. Vorgabe: die erste.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Blatt ansehen", ...READS },
    async run(caller, args) {
      const id = str(args, "id");
      if (!id) return fail("Ohne id geht es nicht.");

      const material = await getMaterial(caller.userId, id);
      if (!material) return fail("Dieses Blatt gibt es nicht.");

      const wanted =
        typeof args.seite === "number" && Number.isFinite(args.seite)
          ? Math.trunc(args.seite)
          : 1;

      if (wanted < 1 || wanted > material.pages.length) {
        return fail(
          `Dieses Blatt hat ${material.pages.length} ${
            material.pages.length === 1 ? "Seite" : "Seiten"
          } — Seite ${wanted} gibt es nicht.`,
        );
      }

      const page = material.pages[wanted - 1];
      if (!page) return fail("Diese Seite gibt es nicht mehr.");

      const image = await readPageImage(caller.userId, page.id, "voll");
      if (!image) return fail("Diese Seite gibt es nicht mehr.");

      const blatt = {
        id: material.id,
        titel: material.title,
        fach: subjectOf(material.subject),
        schultag: material.capturedOn,
        notiz: material.note,
        themen: material.topics.map((topic) => topic.title),
        seiten: material.pages.length,
        seite: wanted,
        groesse: formatBytes(page.byteSize),
      };

      return {
        content: [
          { type: "text", text: JSON.stringify(blatt, null, 2) },
          {
            type: "image",
            data: Buffer.from(image.bytes).toString("base64"),
            mimeType: image.mimeType,
          },
        ],
        structuredContent: blatt,
      };
    },
  },

  {
    name: "read_lernplan",
    title: "Lernplan eines Tages",
    description:
      "Die Lernblöcke eines Tages: welches Thema für welche Prüfung, wie lange, und ob es schon abgehakt ist.",
    inputSchema: {
      type: "object",
      properties: {
        tag: {
          type: "string",
          description: "Ein Kalendertag als YYYY-MM-DD. Vorgabe: heute.",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Lernplan lesen", ...READS },
    async run(caller, args) {
      const day = dayOf(args);
      if (!day) return fail("Diesen Tag gibt es nicht. Erwartet wird YYYY-MM-DD.");

      const blocks = await blocksForDay(caller.userId, day);

      return ok({
        tag: day,
        beschriftung: formatGerman(day),
        bloecke: blocks.map((block) => ({
          fach: subjectOf(block.subject),
          pruefungId: block.examId,
          pruefungAm: block.exam.date,
          thema: block.topic?.title ?? null,
          minuten: block.minutes,
          art: block.kind,
          zustand: block.status,
        })),
      });
    },
  },

  {
    name: "read_eingang",
    title: "Eingangskorb",
    description:
      "Was schon im Eingangskorb liegt. Vor einem propose_* lesen: derselbe Vorschlag zum zweiten Mal wird abgewiesen.",
    inputSchema: {
      type: "object",
      properties: {
        auchEntschiedene: {
          type: "boolean",
          description:
            "Auch übernommene und verworfene Vorschläge der letzten 14 Tage.",
        },
        limit: {
          type: "integer",
          description: `Wie viele Vorschläge höchstens (1 bis ${MAX_LIMIT}, Vorgabe ${DEFAULT_LIMIT}).`,
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Eingangskorb lesen", ...READS },
    async run(caller, args) {
      const items = await listProposals(caller.userId, {
        includeDecided: bool(args, "auchEntschiedene"),
      });
      const { rows, gekuerzt } = truncated(items, limitOf(args));

      return ok({
        gekuerzt,
        vorschlaege: rows.map((item) => ({
          id: item.id,
          art: item.kind,
          zustand: item.status,
          herkunft: item.source,
          ueberschrift: proposalHeadline(item.kind, item.payload),
          inhalt: item.payload,
          begruendung: item.reason,
          blatt: {
            id: item.material.id,
            titel: item.material.title,
            fach: subjectOf(item.material.subject),
            schultag: item.material.capturedOn,
          },
        })),
      });
    },
  },

  {
    name: "propose_themen",
    title: "Themen vorschlagen",
    description:
      "Schlägt vor, welche Themen an ein Blatt gehören. Er landet im Eingangskorb; erst ein Mensch übernimmt ihn. Vorher read_themen lesen und die vorhandene Schreibweise treffen — sonst entsteht dasselbe Thema zweimal.",
    inputSchema: {
      type: "object",
      properties: {
        blattId: BLATT_ID,
        themen: {
          type: "array",
          items: { type: "string" },
          description:
            "Die Themen als Titel, z.B. „Kettenregel“. Ein Thema braucht ein Fachwort — „Übungen“ oder „Arbeitsblatt 3“ zeigen auf eine Fundstelle und werden abgewiesen.",
        },
        begruendung: BEGRUENDUNG,
      },
      required: ["blattId", "themen"],
      additionalProperties: false,
    },
    annotations: { title: "Themen vorschlagen", ...PROPOSES },
    run(caller, args) {
      return propose(caller, "themen", args, {
        titel: strings(args, "themen"),
      });
    },
  },

  {
    name: "propose_hausaufgabe",
    title: "Hausaufgabe vorschlagen",
    description:
      "Schlägt eine Aufgabe vor, die auf einem Blatt steht. Das Fach kommt vom Blatt. Er landet im Eingangskorb; erst ein Mensch übernimmt ihn.",
    inputSchema: {
      type: "object",
      properties: {
        blattId: BLATT_ID,
        titel: {
          type: "string",
          description: "Was aufgegeben ist, z.B. „S. 47 Nr. 3–7“.",
        },
        faellig: {
          type: "string",
          description:
            "Der Tag als YYYY-MM-DD. Weglassen, wenn auf dem Blatt keiner steht — dann schlägt die App beim Übernehmen die nächste Stunde des Fachs vor.",
        },
        notiz: {
          type: "string",
          description: "Was im Titel keinen Platz hat.",
        },
        begruendung: BEGRUENDUNG,
      },
      required: ["blattId", "titel"],
      additionalProperties: false,
    },
    annotations: { title: "Hausaufgabe vorschlagen", ...PROPOSES },
    run(caller, args) {
      return propose(caller, "hausaufgabe", args, {
        titel: str(args, "titel"),
        faellig: optStr(args, "faellig"),
        notiz: optStr(args, "notiz"),
      });
    },
  },

  {
    name: "propose_klausur",
    title: "Prüfungstermin vorschlagen",
    description:
      "Schlägt einen Prüfungstermin vor, der auf einem Blatt angekündigt ist. Das Fach kommt vom Blatt. Übernommen baut die App daraus den Lernplan.",
    inputSchema: {
      type: "object",
      properties: {
        blattId: BLATT_ID,
        datum: {
          type: "string",
          description: "Der Tag der Prüfung als YYYY-MM-DD.",
        },
        art: {
          type: "string",
          enum: ["klausur", "test", "referat", "muendlich"],
          description: "Vorgabe: klausur.",
        },
        titel: {
          type: "string",
          description: "Nur wenn das Fach allein zu wenig sagt, z.B. „Analysis“.",
        },
        themen: {
          type: "array",
          items: { type: "string" },
          description: "Was drankommt — daraus verteilt die App die Lernblöcke.",
        },
        begruendung: BEGRUENDUNG,
      },
      required: ["blattId", "datum"],
      additionalProperties: false,
    },
    annotations: { title: "Termin vorschlagen", ...PROPOSES },
    run(caller, args) {
      return propose(caller, "klausur", args, {
        datum: str(args, "datum"),
        art: optStr(args, "art") ?? "klausur",
        titel: optStr(args, "titel"),
        themen: strings(args, "themen"),
      });
    },
  },
];

/**
 * Der gemeinsame Rumpf aller drei `propose_*`.
 *
 * Geprüft wird der Inhalt nicht hier, sondern in `createProposal()` — mit
 * demselben Schema, durch das auch das Formular unter `/eingang/neu` geht.
 * Hier steht nur die Übersetzung der Werkzeug-Argumente in dessen Form und die
 * Übersetzung der Antwort zurück in einen Satz, mit dem ein Modell etwas
 * anfangen kann.
 */
async function propose(
  caller: Caller,
  kind: ProposalKind,
  args: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<ToolOutcome> {
  const result = await createProposal(caller.userId, {
    materialId: str(args, "blattId"),
    kind,
    payload,
    reason: optStr(args, "begruendung"),
    source: "agent",
  });

  if (!result.ok) return fail(result.satz);

  return ok({
    vorschlagId: result.id,
    zustand: "offen",
    hinweis:
      "Im Eingangskorb abgelegt. Er steht nicht in der App, bis ein Mensch ihn übernimmt.",
  });
}

/**
 * Die Beschreibungen für `tools/list` — ohne die Funktionen dahinter.
 *
 * Abgeleitet und nicht daneben gepflegt: so kann kein Werkzeug beschrieben
 * werden, das es nicht gibt, und keins fehlen, das es gibt. Die Reihenfolge
 * bleibt die dieser Datei; die Spezifikation verlangt, dass sie sich zwischen
 * zwei Anfragen nicht ändert.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map((tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: tool.annotations,
}));

/**
 * Ruft ein Werkzeug auf. `null` heißt: dieses Werkzeug gibt es nicht — und das
 * ist ein Protokollfehler und kein Werkzeugfehler, deshalb steht es nicht als
 * `isError` da.
 *
 * Eine Ausnahme aus der Datenschicht wird hier zu einem Satz. Sie darf nicht
 * bis in den Route Handler durchschlagen: dort würde daraus ein
 * Protokollfehler, den das Modell nicht zu sehen bekommt — es wüsste dann
 * nicht, dass sein Aufruf gescheitert ist, und probierte es nicht anders.
 */
export async function callTool(
  caller: Caller,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome | null> {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) return null;

  try {
    return await tool.run(caller, args);
  } catch (error) {
    console.error(`Werkzeug ${name} fehlgeschlagen`, error);

    return fail(
      "Das hat auf dem Server nicht geklappt. Versuch es noch einmal oder anders.",
    );
  }
}
