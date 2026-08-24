import { z } from "zod";

import type { User } from "@/db/schema";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { getExam, listExams } from "@/lib/exams";
import { formatAverage, gradeLabel } from "@/lib/grade-scale";
import { gradeSummary, gradesBySubject } from "@/lib/grades";
import { listHomework } from "@/lib/homework";
import { formatBytes, isAllowedMime } from "@/lib/images";
import {
  createProposal,
  listInbox,
  proposalInputSchema,
  INBOX_LIMIT,
} from "@/lib/inbox";
import {
  getMaterial,
  listMaterials,
  readPageImage,
  LIST_LIMIT,
  type MaterialListItem,
} from "@/lib/materials";
import { listSubjects } from "@/lib/subjects";
import { listTopics, listTopicsForSubjects } from "@/lib/subject-topics";
import { loadWeek, WEEKDAYS } from "@/lib/timetable";

import { matchSubject, matchTopic, type Match } from "./resolve";
import { TOOLS, type ToolArgs, type ToolName } from "./tools";

/**
 * Was die Werkzeuge tun, wenn sie gerufen werden.
 *
 * **Sie sitzen NEBEN den Server Actions auf derselben @/lib und nicht darüber.**
 * Das ist die Regel aus KONZEPT.md, und sie hat einen handfesten Grund: eine
 * Server Action endet mit `redirect()`, und das wirft intern — ein Werkzeug
 * bekäme nie ein Ergebnis. Hier steht deshalb keine einzige Zeile Fachlogik,
 * die es nicht schon gibt; jede Funktion holt aus @/lib, was die Oberfläche
 * auch holt, und macht daraus etwas, das ein Modell lesen kann.
 *
 * **Ausgeliefert wird JSON mit einem deutschen Satz davor.** Der Satz ist die
 * Antwort auf „was ist hier eigentlich zurückgekommen?" — er nennt die Zahl der
 * Zeilen und was fehlt. Das JSON darunter trägt die ids, ohne die kein zweiter
 * Aufruf möglich wäre. Nur Prosa verlöre die ids, nur JSON verlöre den
 * Überblick.
 *
 * **Ein Fehler ist ein Ergebnis und keine Ausnahme.** Die Spezifikation ist an
 * der Stelle deutlich: was beim AUSFÜHREN schiefgeht — ein Blatt, das es nicht
 * gibt, ein Fach, das zweimal passt —, gehört als `isError: true` in ein
 * gewöhnliches Ergebnis, damit das Modell es liest und es besser machen kann.
 * Ein JSON-RPC-Fehler ist etwas anderes: den bekommt nur, wer ein Werkzeug ruft,
 * das es nicht gibt.
 */

/** Was ein Werkzeug zurückgibt, bevor daraus MCP-Inhalt wird. */
export type ToolOutcome =
  | { art: "daten"; satz: string; daten: unknown }
  | { art: "bild"; satz: string; base64: string; mimeType: string }
  | { art: "fehler"; satz: string };

/**
 * Ruft ein Werkzeug auf.
 *
 * Geprüft werden die Argumente mit genau dem Schema, aus dem auch das
 * Verzeichnis gebaut wurde. Eine Meldung daraus geht als Ergebnis zurück und
 * nicht als Protokollfehler — sie ist für das Modell gedacht, das den Aufruf
 * gleich noch einmal versucht.
 */
export async function callTool(
  user: User,
  name: ToolName,
  rawArgs: unknown,
): Promise<ToolOutcome> {
  const parsed = TOOLS[name].args.safeParse(rawArgs ?? {}, { error: ZOD_DEUTSCH });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const stelle = issue?.path.join(".") ?? "";

    return {
      art: "fehler",
      satz: stelle
        ? `Das Argument „${stelle}“ passt nicht: ${issue?.message ?? "unbekannter Fehler"}`
        : (issue?.message ?? "Diese Argumente passen nicht."),
    };
  }

  // Der Umweg über `handlers[name]` mit einem Cast ist der Preis dafür, dass
  // jedes Werkzeug seinen eigenen Argumenttyp hat: TypeScript kann über eine
  // Vereinigung von Funktionen nicht mehr entscheiden, welche gerade gemeint
  // ist. Die Zusicherung, dass zu jedem Namen genau ein Handler gehört, macht
  // dagegen der Compiler — `HANDLERS` ist als vollständige Abbildung getippt.
  const handler = HANDLERS[name] as (
    user: User,
    args: unknown,
  ) => Promise<ToolOutcome>;

  return handler(user, parsed.data);
}

/**
 * Die Meldungen der Prüfung auf Deutsch.
 *
 * Ohne diese Zeile stünde „Invalid input: expected string, received undefined"
 * mitten in einem deutschen Satz — und dieser Satz geht an ein Modell, das dem
 * Nutzer gleich darauf antwortet. zod bringt die Übersetzung mit; sie hier zu
 * nehmen ist billiger und vollständiger, als sie Fall für Fall selbst zu
 * schreiben.
 */
const ZOD_DEUTSCH = z.locales.de().localeError;

type Handlers = {
  [K in ToolName]: (user: User, args: ToolArgs<K>) => Promise<ToolOutcome>;
};

const HANDLERS: Handlers = {
  async read_subjects(user, args) {
    const subjects = await listSubjects(user.id, {
      includeArchived: args.include_archived === true,
    });

    return daten(
      `${zahl(subjects.length, "Fach", "Fächer")}${args.include_archived ? " (mit archivierten)" : ""}.`,
      subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        short: subject.short,
        teacher: subject.teacher,
        room: subject.room,
        weightWritten: subject.weightWritten,
        archived: subject.archived,
      })),
    );
  },

  async read_topics(user, args) {
    const subject = await findSubject(user, args.subject);
    if ("fehler" in subject) return subject.fehler;

    const topics = await listTopics(user.id, subject.treffer.id);

    return daten(
      `${zahl(topics.length, "Thema", "Themen")} in ${subject.treffer.name}.`,
      {
        subject: { id: subject.treffer.id, name: subject.treffer.name },
        topics: topics.map((topic) => ({
          id: topic.id,
          title: topic.title,
          materialCount: topic.materialCount,
          examCount: topic.examCount,
          lastSeenAt: topic.lastSeenAt,
        })),
      },
    );
  },

  async read_timetable(user) {
    const week = await loadWeek(user.id);

    return daten(
      `Stundenraster mit ${zahl(week.periods.length, "Stunde", "Stunden", "f")}, dazu der Wochenplan.`,
      {
        periods: week.periods.map((period) => ({
          number: period.number,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
        })),
        days: week.days.map((day) => ({
          weekday: day.weekday,
          name: WEEKDAYS.find((entry) => entry.value === day.weekday)?.long ?? "",
          lessons: day.lessons.map((lesson) => ({
            period: lesson.period,
            subject: lesson.subject.name,
            subjectId: lesson.subject.id,
            // Leer heißt am Datenmodell: der Raum des Fachs gilt. Das hier
            // aufzulösen wäre die Aufgabe der Oberfläche; ein Modell soll den
            // Unterschied sehen dürfen.
            room: lesson.room ?? lesson.subject.room,
            note: lesson.note,
          })),
        })),
      },
    );
  },

  async read_homework(user, args) {
    const items = await listHomework(user.id, {
      includeDone: args.include_done === true,
    });
    const heute = todayInBerlin();
    const ueberfaellig = items.filter((item) => !item.done && item.dueDate < heute);

    return daten(
      `${zahl(items.filter((item) => !item.done).length, "offene Aufgabe", "offene Aufgaben", "f")}, davon ${ueberfaellig.length} überfällig. Heute ist der ${formatGerman(heute)}.`,
      items.map((item) => ({
        id: item.id,
        title: item.title,
        details: item.details,
        subject: item.subject.name,
        subjectId: item.subject.id,
        dueDate: item.dueDate,
        done: item.done,
      })),
    );
  },

  async read_exams(user, args) {
    if (args.exam) {
      const detail = await getExam(user.id, args.exam);
      if (!detail) return fehler("Diese Prüfung gibt es nicht.");

      return daten(
        `${detail.subject.name} am ${formatGerman(detail.exam.date)}, ${zahl(detail.topics.length, "Thema", "Themen")} und ${zahl(detail.blocks.length, "Lernblock", "Lernblöcke", "m")}.`,
        {
          id: detail.exam.id,
          subject: detail.subject.name,
          subjectId: detail.subject.id,
          title: detail.exam.title,
          kind: detail.exam.kind,
          date: detail.exam.date,
          notes: detail.exam.notes,
          leadDays: detail.exam.leadDays,
          minutesPerDay: detail.exam.minutesPerDay,
          topics: detail.topics.map((topic) => ({
            id: topic.id,
            title: topic.title,
          })),
          blocks: detail.blocks.map((block) => ({
            date: block.date,
            minutes: block.minutes,
            kind: block.kind,
            status: block.status,
            topic: block.topic?.title ?? null,
          })),
        },
      );
    }

    const exams = await listExams(user.id, {
      includePast: args.include_past === true,
    });

    return daten(
      `${zahl(exams.length, "Prüfung", "Prüfungen", "f")}. Heute ist der ${formatGerman(todayInBerlin())}.`,
      exams.map((exam) => ({
        id: exam.id,
        subject: exam.subject.name,
        subjectId: exam.subject.id,
        title: exam.title,
        kind: exam.kind,
        date: exam.date,
        topicCount: exam.topicCount,
        blocks: {
          total: exam.totalBlocks,
          done: exam.doneBlocks,
          open: exam.openBlocks,
        },
      })),
    );
  },

  async read_grades(user, args) {
    if (args.subject) {
      const subject = await findSubject(user, args.subject);
      if ("fehler" in subject) return subject.fehler;

      const alle = await gradesBySubject(user.id);
      const fach = alle.find((entry) => entry.subject.id === subject.treffer.id);

      // Ein Fach ohne Noten ist kein Fehler, sondern eine Antwort — dieselbe,
      // die `read_topics` bei einem Fach ohne Themen gibt. Ein `isError` hier
      // hieße für das Modell „frag anders", und es gibt nichts anders zu
      // fragen: im September hat noch kein Fach eine Note.
      if (!fach) {
        return daten(
          `${subject.treffer.name}: noch keine Note eingetragen.`,
          {
            subject: subject.treffer.name,
            subjectId: subject.treffer.id,
            average: null,
            averageLabel: schnitt(null),
            written: null,
            oral: null,
            grades: [],
          },
        );
      }

      return daten(
        fach.grades.length === 0
          ? `${fach.subject.name}: noch keine Note eingetragen.`
          : `${fach.subject.name}: Schnitt ${schnitt(fach.average)} aus ${zahl(fach.grades.length, "Note", "Noten", "f")}.`,
        {
          subject: fach.subject.name,
          subjectId: fach.subject.id,
          average: fach.average,
          averageLabel: schnitt(fach.average),
          written: fach.written,
          oral: fach.oral,
          weightWritten: fach.subject.weightWritten,
          grades: fach.grades.map((grade) => ({
            id: grade.id,
            value: grade.value / 10,
            label: gradeLabel(grade.value),
            kind: grade.kind,
            weight: grade.weight,
            date: grade.date,
            title: grade.title,
          })),
        },
      );
    }

    const summary = await gradeSummary(user.id);

    return daten(
      summary.gradeCount === 0
        ? "Noch keine Note eingetragen — es gibt also auch keinen Schnitt."
        : `Gesamtschnitt ${schnitt(summary.overall)} aus ${zahl(summary.gradeCount, "Note", "Noten", "f")} in ${zahl(summary.gradedSubjects, "Fach", "Fächern")}.`,
      {
        overall: summary.overall,
        overallLabel: schnitt(summary.overall),
        gradeCount: summary.gradeCount,
        perSubject: summary.perSubject.map((entry) => ({
          subject: entry.subject.name,
          subjectId: entry.subject.id,
          average: entry.average,
          averageLabel: schnitt(entry.average),
          count: entry.count,
        })),
      },
    );
  },

  async read_material(user, args) {
    let subjectId: string | undefined;
    let topicId: string | undefined;
    let ueberschrift = "Die ganze Ablage";

    if (args.subject) {
      const subject = await findSubject(user, args.subject);
      if ("fehler" in subject) return subject.fehler;

      subjectId = subject.treffer.id;
      ueberschrift = subject.treffer.name;
    }

    if (args.topic) {
      // Ein Thema gehört zu genau einem Fach. Ohne genanntes Fach muss also
      // erst gesucht werden, in welchem — und das geht nur, indem man die
      // Vokabulare durchsieht. Bei einem Dutzend Fächern ist das ein Dutzend
      // kurzer Abfragen und immer noch besser, als vom Modell eine id zu
      // verlangen, die es nicht haben kann.
      const gefunden = await findTopic(user, args.topic, subjectId);
      if ("fehler" in gefunden) return gefunden.fehler;

      topicId = gefunden.treffer.id;
      subjectId = undefined;
      ueberschrift = `„${gefunden.treffer.title}“ (${gefunden.fach})`;
    }

    const sheets = await listMaterials(user.id, {
      subjectId,
      topicId,
      limit: args.limit,
    });

    return daten(
      `${ueberschrift}: ${zahl(sheets.length, "Blatt", "Blätter")}.${grenzeErreicht(
        sheets,
        args.limit,
        LIST_LIMIT,
        "filtere nach Fach oder Thema.",
      )}`,
      sheets.map(sheetRow),
    );
  },

  async read_sheet(user, args) {
    const sheet = await getMaterial(user.id, args.sheet);
    if (!sheet) return fehler("Dieses Blatt gibt es nicht.");

    return daten(
      `„${sheet.title}“ aus ${sheet.subject.name}, ${zahl(sheet.pages.length, "Seite", "Seiten", "f")}.${sheet.filedAt ? "" : " Es liegt noch im Eingangskorb."}`,
      {
        ...sheetRow(sheet),
        filedAt: sheet.filedAt,
        pages: sheet.pages.map((page) => ({
          id: page.id,
          sortOrder: page.sortOrder,
          width: page.width,
          height: page.height,
          size: formatBytes(page.byteSize),
        })),
      },
    );
  },

  async read_page(user, args) {
    const page = await readPageImage(user.id, args.page, "lesefassung");

    if (!page) {
      return fehler(
        "Diese Seite gibt es nicht. Die id einer Seite steht in read_sheet unter „pages“ — die id des Blattes ist eine andere.",
      );
    }

    // Die Lesefassung wird beim Aufnehmen auf rund 100 KB gerechnet und bleibt
    // damit unter der Grenze, die ein Tool-Ergebnis in der Claude-App hat. Ein
    // Blatt, das sich partout nicht kleinrechnen ließ, wird hier trotzdem nicht
    // stillschweigend abgeschnitten: dann steht ein Satz da, mit dem sich etwas
    // anfangen lässt.
    // Dasselbe Misstrauen wie an der Bildadresse in @/app/api/material: steht
    // in der Zeile ein Format, das die App gar nicht annimmt, ist die Zeile
    // kaputt — dann wird nichts ausgeliefert, statt einem Modell Bytes unter
    // einem erfundenen Format vorzulegen.
    if (!isAllowedMime(page.mimeType)) {
      return fehler("Diese Seite trägt ein Format, das die App nicht ausliefert.");
    }

    if (page.bytes.byteLength > MAX_IMAGE_BYTES) {
      return fehler(
        `Diese Seite wiegt ${formatBytes(page.bytes.byteLength)} und passt damit nicht in ein Tool-Ergebnis (Grenze rund ${formatBytes(MAX_IMAGE_BYTES)}). Das kommt bei einem sehr dichten Foto vor — einem Tafelbild im Halbdunkel etwa. In der App ist das Blatt vollständig zu sehen; hilf dir für den Moment mit read_sheet und frag den Menschen, ob er die Seite enger aufnehmen kann.`,
      );
    }

    return {
      art: "bild",
      satz: `Die Seite als Bild, ${formatBytes(page.bytes.byteLength)}.`,
      base64: Buffer.from(page.bytes).toString("base64"),
      mimeType: page.mimeType,
    };
  },

  async read_inbox(user, args) {
    const entries = await listInbox(user.id, { limit: args.limit });
    const offen = entries.filter((entry) => entry.filedAt === null).length;

    return daten(
      `${
        entries.length === 0
          ? "Der Eingangskorb ist leer."
          : `${zahl(entries.length, "Zeile", "Zeilen", "f")} im Eingangskorb, davon ${offen} noch nicht durchgesehen.`
      }${grenzeErreicht(
        entries,
        args.limit,
        INBOX_LIMIT,
        "der Korb ist damit nicht leer, sondern abgeschnitten.",
      )}`,
      entries.map((entry) => ({
        ...sheetRow(entry),
        filedAt: entry.filedAt,
        proposals: entry.proposals.map((proposal) => ({
          id: proposal.id,
          origin: proposal.origin,
          createdAt: proposal.createdAt,
          subjectId: proposal.subjectId,
          title: proposal.title,
          capturedOn: proposal.capturedOn,
          note: proposal.note,
          topics: proposal.topics,
        })),
      })),
    );
  },

  async propose_sheet(user, args) {
    let subjectId: string | null = null;

    if (args.subject) {
      const subject = await findSubject(user, args.subject);
      if ("fehler" in subject) return subject.fehler;

      subjectId = subject.treffer.id;
    }

    // Geprüft wird mit genau dem Schema, das auch das Handformular benutzt —
    // sonst käme durch diese Tür ein Vorschlag herein, den die andere nicht
    // annimmt, und niemand könnte ihn übernehmen.
    const parsed = proposalInputSchema.safeParse({
      subjectId,
      title: args.title ?? null,
      capturedOn: args.captured_on ?? null,
      note: args.note ?? null,
      topics: args.topics ?? [],
    });

    if (!parsed.success) {
      return fehler(
        parsed.error.issues.map((issue) => issue.message).join(" "),
      );
    }

    const id = await createProposal(user.id, args.sheet, parsed.data, "agent");

    if (!id) {
      return fehler(
        "Der Vorschlag konnte nicht angelegt werden: das Blatt gibt es nicht, oder das vorgeschlagene Fach gehört nicht dazu.",
      );
    }

    return daten(
      "Der Vorschlag liegt im Eingangskorb. Er ändert nichts, bis ein Mensch ihn übernimmt.",
      {
        id,
        sheet: args.sheet,
        subjectId: parsed.data.subjectId,
        title: parsed.data.title,
        capturedOn: parsed.data.capturedOn,
        note: parsed.data.note,
        topics: parsed.data.topics,
      },
    );
  },
};

/**
 * Wie schwer ein Bild in einem Tool-Ergebnis sein darf.
 *
 * Die Claude-App nimmt ein Ergebnis bis rund 150 000 Zeichen an, und Base64
 * macht aus drei Bytes vier Zeichen — 110 KB sind damit die Grenze, mit etwas
 * Luft für den Rest der Antwort. Die Lesefassung zielt beim Aufnehmen auf
 * 100 KB (`READING_TARGET_BYTES` in @/lib/images); diese Zahl hier ist der
 * Prüfstein daneben und absichtlich etwas größer: sie soll nur anschlagen,
 * wenn wirklich etwas nicht gepasst hat.
 */
const MAX_IMAGE_BYTES = 110_000;

/** Ein Blatt, wie es in jeder der drei Listen steht. */
function sheetRow(sheet: MaterialListItem) {
  return {
    id: sheet.id,
    title: sheet.title,
    capturedOn: sheet.capturedOn,
    note: sheet.note,
    subject: sheet.subject.name,
    subjectId: sheet.subject.id,
    pageCount: sheet.pageCount,
    topics: sheet.topics.map((topic) => topic.title),
  };
}

/**
 * Das Fach, das gemeint war — oder ein Ergebnis, das dem Modell sagt, warum
 * nicht.
 *
 * Die Rückfrage bei mehreren Treffern ist der Grund, warum diese Funktion
 * überhaupt existiert: „Deutsch" könnte zwei Fächer meinen, und eines davon zu
 * raten hieße, ein Blatt in ein Fach zu legen, in dem es niemand sucht.
 */
async function findSubject(
  user: User,
  query: string,
): Promise<{ treffer: { id: string; name: string } } | { fehler: ToolOutcome }> {
  const subjects = await listSubjects(user.id, { includeArchived: true });
  const match = matchSubject(subjects, query);

  if (match.art === "eins") return { treffer: match.treffer };

  return { fehler: fehler(satzZuMatch(match, `Ein Fach namens „${query}“`)) };
}

/**
 * Das Thema, das gemeint war. Ohne Fach wird in allen Fächern gesucht — ein
 * Thema gehört zu genau einem, damit ist die Frage trotzdem eindeutig
 * gestellt, solange nicht zwei Fächer dasselbe Wort führen.
 */
async function findTopic(
  user: User,
  query: string,
  subjectId: string | undefined,
): Promise<Gefunden | { fehler: ToolOutcome }> {
  const subjects = await listSubjects(user.id, { includeArchived: true });

  // Ist ein Fach genannt, gilt es zuerst — dort kann dasselbe Wort eindeutig
  // sein, das über alle Fächer hinweg mehrdeutig wäre. Findet sich dort nichts,
  // wird trotzdem weitergesucht: ein Thema gehört zu genau einem Fach, und
  // wenn beide Angaben sich widersprechen, gewinnt das Thema. Dieselbe Regel
  // gilt in der Ablage für `?fach=` und `?thema=`; sie steht im KONZEPT.
  if (subjectId) {
    const eng = await sucheThema(
      user,
      query,
      subjects.filter((subject) => subject.id === subjectId),
    );

    if (eng !== "nichts") return eng;
  }

  const weit = await sucheThema(user, query, subjects);

  if (weit === "nichts") {
    return { fehler: fehler(`Ein Thema namens „${query}“ gibt es nicht.`) };
  }

  return weit;
}

/** Ein gefundenes Thema samt dem Fach, in dem es steht. */
type Gefunden = { treffer: { id: string; title: string }; fach: string };

/**
 * Sucht ein Thema in den angegebenen Fächern.
 *
 * „nichts" ist etwas anderes als ein Fehler: der Aufrufer entscheidet, ob er
 * daraufhin weitersucht oder aufgibt. Eine Mehrdeutigkeit dagegen ist ein
 * Ergebnis und wird sofort zurückgegeben — sie verschwindet nicht dadurch, dass
 * man den Suchraum vergrößert.
 */
async function sucheThema(
  user: User,
  query: string,
  subjects: readonly { id: string; name: string }[],
): Promise<Gefunden | { fehler: ToolOutcome } | "nichts"> {
  const kandidaten: { id: string; title: string; fach: string }[] = [];

  // Eine Abfrage für alle Fächer und nicht eine je Fach: `listTopicsForSubjects`
  // ist genau dafür gebaut (siehe @/lib/subject-topics), und bei dreizehn
  // Fächern wären es sonst dreizehn Wege zur Datenbank für eine einzige Frage.
  const proFach = await listTopicsForSubjects(
    user.id,
    subjects.map((subject) => subject.id),
  );

  for (const subject of subjects) {
    const topics = proFach.get(subject.id) ?? [];
    const match = matchTopic(topics, query);

    if (match.art === "eins") {
      kandidaten.push({
        id: match.treffer.id,
        title: match.treffer.title,
        fach: subject.name,
      });
    } else if (match.art === "mehrere") {
      return {
        fehler: fehler(
          `„${query}“ passt in ${subject.name} auf mehrere Themen: ${match.namen.join(", ")}.`,
        ),
      };
    }
  }

  if (kandidaten.length === 1) {
    const treffer = kandidaten[0]!;
    return { treffer: { id: treffer.id, title: treffer.title }, fach: treffer.fach };
  }

  if (kandidaten.length > 1) {
    return {
      fehler: fehler(
        `„${query}“ gibt es in mehreren Fächern: ${kandidaten.map((k) => `${k.title} (${k.fach})`).join(", ")}. Nenn das Fach dazu.`,
      ),
    };
  }

  return "nichts";
}

/** Aus einem mehrdeutigen oder leeren Treffer wird ein Satz für das Modell. */
function satzZuMatch(match: Match<unknown>, was: string): string {
  if (match.art === "mehrere") {
    return `${was} ist nicht eindeutig — es passt auf: ${match.namen.join(", ")}.`;
  }

  return `${was} gibt es nicht. read_subjects zeigt, welche es gibt.`;
}

/**
 * Der Hinweis, dass die Liste an ihrer Grenze steht.
 *
 * Dieselbe Ehrlichkeit wie in der Ablage und im Korb: eine Abfrage gibt Zeilen
 * zurück und sagt nicht, ob dahinter noch etwas liegt. Wer genau so viele
 * bekommt, wie er gefragt hat, weiß, dass er am Anschlag steht — und das gehört
 * hingeschrieben, statt still zu kürzen.
 *
 * Die Grenze steht als Parameter da und nicht als Vorgabe in dieser Funktion:
 * die Ablage hört bei `LIST_LIMIT` auf, der Korb bei `INBOX_LIMIT`, und eine
 * Funktion, die für beide dieselbe Zahl annimmt, schwiege an der einen Stelle
 * genau dann, wenn es darauf ankommt. Der Rat gehört aus demselben Grund
 * dazu — „filtere nach Fach" hilft an einem Werkzeug ohne Fach-Argument nicht.
 */
function grenzeErreicht(
  rows: unknown[],
  limit: number | undefined,
  grenze: number,
  rat: string,
): string {
  if (rows.length < (limit ?? grenze)) return "";

  return ` Das ist die Obergrenze dieser Abfrage — es liegen möglicherweise mehr da; ${rat}`;
}

/**
 * „3 Blätter", „ein Blatt", „keine Seite" — Zahlen, die sich lesen lassen.
 *
 * Das Geschlecht steht dabei, weil es im Deutschen nicht am Wort abzulesen ist
 * und weil „ein Seite" auffällt: diese Sätze gehen an ein Modell, das dem
 * Nutzer gleich darauf antwortet, und ein schiefer Satz hier wird oben im
 * Chatfenster wiederholt. Vorgabe ist sächlich — das ist bei Blatt, Fach und
 * Thema richtig, also bei der Mehrzahl der Fälle.
 */
function zahl(
  anzahl: number,
  einzahl: string,
  mehrzahl: string,
  genus: "m" | "f" | "n" = "n",
): string {
  const artikel = genus === "f" ? "eine" : "ein";

  if (anzahl === 0) return `k${artikel} ${einzahl}`;
  if (anzahl === 1) return `${artikel} ${einzahl}`;

  return `${anzahl} ${mehrzahl}`;
}

/**
 * Der erste Buchstabe eines Satzes gehört groß.
 *
 * Nötig, weil die Sätze aus Bausteinen entstehen und oft mit `zahl()`
 * beginnen — „kein Thema in Mathematik." fängt sonst klein an. Angefasst wird
 * nur der erste Buchstabe und nur, wenn er einer ist: Sätze, die mit einem
 * Anführungszeichen beginnen, bleiben, wie sie sind.
 */
function grossAmAnfang(satz: string): string {
  return satz.replace(/^\p{Ll}/u, (buchstabe) => buchstabe.toLocaleUpperCase("de"));
}

/** Ein Schnitt als Text, mit einem Strich, wo keine Zahl steht. */
function schnitt(average: number | null): string {
  return average === null ? "—" : formatAverage(average);
}

function daten(satz: string, daten: unknown): ToolOutcome {
  return { art: "daten", satz: grossAmAnfang(satz), daten };
}

function fehler(satz: string): ToolOutcome {
  return { art: "fehler", satz: grossAmAnfang(satz) };
}
