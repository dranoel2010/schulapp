import { z } from "zod";

import type { User } from "@/db/schema";
import { blattVorschlagen } from "@/lib/blatt-vorschlag";
import { formatGerman, todayInBerlin } from "@/lib/dates";
import { getExam, listExams } from "@/lib/exams";
import { formatAverage, gradeLabel } from "@/lib/grade-scale";
import { gradeSummary, gradesBySubject } from "@/lib/grades";
import { listHomework } from "@/lib/homework";
import { formatBytes, isAllowedMime } from "@/lib/images";
import { listInbox, INBOX_LIMIT } from "@/lib/inbox";
import { stoffAuskunft, vorschlagsFragen } from "@/lib/klausur-stoff";
import {
  getMaterial,
  listMaterialTranscripts,
  listMaterials,
  listPageActivity,
  readPageImage,
  resolveMaterialTopic,
  LIST_LIMIT,
  type MaterialListItem,
  type MaterialPageTranscript,
  type PageActivity,
} from "@/lib/materials";
import { zuteilungAnstossen } from "@/lib/leser/zuteilung";
import { listSubjects } from "@/lib/subjects";
import {
  vorschlagAnlegen,
  FRAGEN_MAX,
  ZITAT_MIN,
  type VorschlagAbweisung,
} from "@/recall/proposals";
import { stoffZuKlausur, type KlausurStoff } from "@/recall/source";
import { listTopics, listTopicsForSubjects } from "@/lib/subject-topics";
import { loadWeek, WEEKDAYS } from "@/lib/timetable";

import { MAX_DATA_CHARS, auskunftZeichen, tausender, zahl } from "./auskunft";
import { looksLikeId, matchSubject, matchTopic, type Match } from "./resolve";
import { TOOLS, type ToolArgs, type ToolName } from "./tools";
import { verworfenSatz } from "./verwerfen";

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
      `${zahl(items.filter((item) => !item.done).length, "offene Aufgabe", "offene Aufgaben", "f")}, davon ${ueberfaellig.length} überfällig. ${heuteSatz(heute)}`,
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
      `${zahl(exams.length, "Prüfung", "Prüfungen", "f")}. ${heuteSatz(todayInBerlin())}`,
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

    // Nur Blätter mit nachgereichten, ungelesenen Seiten — gebaut als Frage
    // des Postboten (4.10.2026), seit dem 11.10.2026 für Chats, die
    // abschreiben; der Claude-Leser der App fragt die Datenbank selbst.
    // Gefiltert wird in der Abfrage, vor der Grenze von zweihundert, und Fach
    // und Thema wirken daneben weiter.
    if (args.nachgereicht) {
      ueberschrift = `${ueberschrift}, nur eingeordnete Blätter mit nachgereichten ungelesenen Seiten`;
    }

    const sheets = await listMaterials(user.id, {
      subjectId,
      topicId,
      limit: args.limit,
      nachgereicht: args.nachgereicht === true,
    });
    const seitenstand = await listPageActivity(
      user.id,
      sheets.map((sheet) => sheet.id),
    );

    return daten(
      `${ueberschrift}: ${zahl(sheets.length, "Blatt", "Blätter")}.${grenzeErreicht(
        sheets,
        args.limit,
        LIST_LIMIT,
        "filtere nach Fach oder Thema.",
      )} ${heuteSatz(todayInBerlin())}`,
      sheets.map((sheet) => listRow(sheet, seitenstand)),
    );
  },

  async read_sheet(user, args) {
    // `lastPageAt` VOR dem Blatt gelesen, nicht danach (4.10.2026). Wer sich
    // ein Blatt unter diesem Stand merkt — bis zum 11.10.2026 der Postbote,
    // seitdem nach derselben Reihenfolge der Claude-Leser der App
    // (@/lib/leser/claude-leser) —, baut seinen Auftrag aus den Seiten unten.
    // Käme der Stand später, könnte er eine Seite
    // mitzählen, die unten noch fehlt — und die verschwände hinter dem
    // Schlüssel, ohne je gelesen zu werden. Früher gelesen ist er höchstens
    // älter als die Seiten, und dann kommt das Blatt einmal zu viel dran.
    const aktivitaet = (await listPageActivity(user.id, [args.sheet])).get(
      args.sheet,
    );
    const sheet = await getMaterial(user.id, args.sheet);
    if (!sheet) return fehler("Dieses Blatt gibt es nicht.");

    // Wie viele Seiten schon abgeschrieben sind, steht im Satz und nicht nur in
    // den Zahlen darunter: ein Modell soll nach EINEM Aufruf wissen, ob es die
    // Abschrift überhaupt geben kann und mit welchem Werkzeug es sie holt. Bei
    // null Seiten bleibt der Satz still — das ist der Normalfall jedes Blattes,
    // das noch niemand gelesen hat, und ein Halbsatz darüber wäre Rauschen.
    const abgeschrieben = sheet.pages.filter(
      (page) => page.transcriptLength !== null,
    ).length;

    // Wer welche Seite liest (seit dem 6.10.2026), ebenfalls im Satz und aus
    // demselben Grund: ein Modell im Chat soll nach EINEM Aufruf wissen, dass
    // es eine Seite nicht abschreiben soll, weil die App sie gerade selbst
    // liest — und dass eine Abschrift von der App kommt und nicht von einem
    // Menschen. Bei null bleibt der Halbsatz weg, wie oben.
    const beiDerApp = sheet.pages.filter((page) => page.leser === "offen").length;
    const maschinell = sheet.pages.filter((page) => page.maschinell).length;

    return daten(
      `„${sheet.title}“ aus ${sheet.subject.name}, ${zahl(sheet.pages.length, "Seite", "Seiten", "f")}.${
        abgeschrieben > 0
          ? ` Davon ${zahl(abgeschrieben, "Seite", "Seiten", "f")} abgeschrieben — den Wortlaut holt read_transcript.`
          : ""
      }${
        maschinell > 0
          ? ` ${maschinell === 1 ? "Eine davon hat" : `${maschinell} davon hat`} die App maschinell gelesen (Docling).`
          : ""
      }${
        beiDerApp > 0
          ? ` ${beiDerApp === 1 ? "Eine Seite liest" : `${beiDerApp} Seiten liest`} die App gerade selbst — die schreibst du nicht ab.`
          : ""
      }${sheet.filedAt ? "" : " Es liegt noch im Eingangskorb."}`,
      {
        ...sheetRow(sheet),
        filedAt: sheet.filedAt,
        /** Dieselbe Angabe wie in read_inbox, in derselben Schreibweise. */
        lastPageAt: aktivitaet?.lastPageAt ?? null,
        pages: sheet.pages.map((page) => ({
          id: page.id,
          sortOrder: page.sortOrder,
          width: page.width,
          height: page.height,
          size: formatBytes(page.byteSize),
          /**
           * Die LÄNGE der Abschrift, nicht die Abschrift.
           *
           * Zwölf volle Seiten wären 96 000 Zeichen in einer Antwort, die vor
           * allem dazu da ist, Seiten-ids zu nennen — und sie kämen bei jedem
           * Aufruf mit, auch wenn niemand sie lesen will. Mit der Zahl
           * entscheidet das Modell, ob sich read_transcript überhaupt lohnt.
           *
           * `null` heißt „diese Seite hat noch niemand gelesen", `0` heißt
           * „gelesen, und es stand nichts darauf". Beides steht so in der
           * Datenbank und wird hier nicht eingeebnet; ein `?? 0` an dieser
           * Stelle machte aus jeder ungelesenen Seite eine leere.
           *
           * Draußen `transcriptChars`, drinnen `transcriptLength` — dieselbe
           * Umbenennung an derselben Tür wie `coverPageId` nach `firstPageId`
           * in `sheetRow()`. „Chars" sagt einem Modell, dass es Zeichen zählt
           * und nicht Zeilen; gezählt wird in Postgres mit `length()`, also in
           * Zeichen und nicht in UTF-16-Einheiten.
           */
          transcriptChars: page.transcriptLength,
          /**
           * Wer diese Seite liest (seit dem 6.10.2026) — die Antwort der App
           * auf die Frage, die bis dahin ein Satz im Auftrag des Postboten
           * beantwortete. „offen": die App liest sie gerade selbst;
           * „docling": die App hat sie maschinell gelesen; „claude": sie
           * wartet auf jemanden, der sie vom Foto abschreibt; `null`: eine
           * Seite von vorher, sie wird gelesen wie bisher.
           *
           * Ein Chat, der abschreibt, nimmt daraus die Seiten für seinen
           * Vorschlag und lässt ein Blatt mit einer offenen Seite liegen — so
           * tat es bis zum 11.10.2026 der Postbote. Dieselben Werte stehen an
           * der Spalte in src/db/schema.ts; hier wird nichts übersetzt, damit
           * Agent und Datenbank dasselbe Wort für dieselbe Sache haben.
           */
          leser: page.leser,
          /**
           * Hat die App die heutige Abschrift maschinell geschrieben
           * (Docling)? Dann hat sie niemand gegengelesen, und Lesefehler sind
           * nicht mit ⟨Klammern⟩ markiert. Ein Mensch, der den Text ändert,
           * macht daraus eine Abschrift von Hand — dann steht hier `false`.
           */
          maschinell: page.maschinell,
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

  async read_transcript(user, args) {
    // Zwei Abfragen, und die erste ist keine Bequemlichkeit. `listMaterial-
    // Transcripts()` gibt zu einem Blatt, das es nicht gibt, dieselbe leere
    // Liste zurück wie zu einem, das noch niemand gelesen hat — ein Modell, das
    // versehentlich eine Seiten-id geschickt hat (die beiden sehen gleich aus,
    // siehe read_page), läse dann „noch nicht abgeschrieben" und glaubte es.
    // Das ist die eine Antwort, die schlimmer ist als ein Fehler: sie sieht
    // richtig aus. `getMaterial()` beantwortet die Frage und bringt den Titel
    // für den Satz gleich mit; den Text schleppt es nicht mit, an den Seiten
    // hängt nur `transcriptLength`.
    const sheet = await getMaterial(user.id, args.sheet);

    if (!sheet) {
      return fehler(
        "Dieses Blatt gibt es nicht. Die id eines Blattes steht in read_material und read_inbox — die id einer Seite ist eine andere.",
      );
    }

    const pages = await listMaterialTranscripts(user.id, args.sheet);
    const gelesen = pages.filter((page) => page.transcript !== null).length;
    const zeichen = pages.reduce(
      (summe, page) => summe + (page.transcript?.length ?? 0),
      0,
    );
    const offen = pages.length - gelesen;
    // Seit dem 6.10.2026 kann eine Abschrift auch von der App stammen
    // (Docling). Der Satz über die ⟨Klammern⟩ stimmt für sie nicht: Docling
    // markiert nichts, was es falsch gelesen hat. Das steht deshalb eigens da,
    // sobald eine solche Seite dabei ist — wer daraus zitiert, soll wissen,
    // dass die glatte Zeile nicht „sicher gelesen" heißt.
    const maschinell = pages.filter(
      (page) => page.maschinell && page.transcript !== null,
    ).length;

    // Kein Fehler, sondern eine Antwort — dieselbe Entscheidung wie bei einem
    // Fach ohne Noten ein paar Handler weiter oben. `isError` hieße für das
    // Modell „frag anders", und es gibt nichts anders zu fragen: der
    // Normalzustand jeder Seite ist, dass noch niemand sie gelesen hat.
    if (gelesen === 0) {
      return daten(
        `Von „${sheet.title}“ ist noch keine Seite abgeschrieben — was darauf steht, siehst du mit read_page.`,
        { sheet: args.sheet, pages: transcriptRows(pages) },
      );
    }

    return daten(
      `Die Abschrift von „${sheet.title}“: ${gelesen} von ${pages.length} ${
        pages.length === 1 ? "Seite" : "Seiten"
      } abgeschrieben, ${tausender(zeichen)} Zeichen. Was in ⟨spitzen Klammern⟩ steht, war beim Abschreiben unsicher.${
        maschinell > 0
          ? ` ${maschinell === 1 ? "Eine Seite hat" : `${maschinell} Seiten hat`} die App maschinell gelesen (Docling, „maschinell: true“) — dort markiert keine Klammer, was falsch gelesen sein kann; im Zweifel gilt das Foto.`
          : ""
      }${
        offen > 0
          ? ` Die übrigen ${offen} stehen mit „transcript: null“ da — die hat noch niemand gelesen, dafür read_page.`
          : ""
      }`,
      { sheet: args.sheet, pages: transcriptRows(pages) },
      // Der einzige Rat, der hier trägt: dieses Werkzeug hat kein `limit` und
      // kein Seitenargument, mit dem sich enger fragen ließe. Zu groß wird
      // diese Antwort ohnehin nur, wenn jemand von Hand eine Abschrift
      // hineingeschrieben hat, die durch keine Tür der App gepasst hätte.
      "Diese Abschrift ist zu lang für ein Werkzeugergebnis — sieh dir die Seiten einzeln als Foto mit read_page an.",
    );
  },

  async read_inbox(user, args) {
    // Ein Anstoß der Zuteilung (seit dem 6.10.2026). Bis zum 11.10.2026 war
    // er das Netz nach einem Neustart: der Postbote fragte den Korb alle 15
    // Sekunden, also kam der Anstoß von selbst. Dieses Netz ist seitdem der
    // Start der App (`register()` in src/instrumentation.ts). Hier bleibt der
    // Anstoß, weil ein Chat, der in den Korb sieht, nicht vor Seiten stehen
    // soll, die seit einem Neustart auf „offen" hängen — und am Ende der
    // Zuteilung kommt der Claude-Leser dran, der vor jedem Aufruf sein
    // Gedächtnis fragt; ein Chat löst also kein zweites Bezahlen aus.
    //
    // Kein Takt, der irgendetwas wiederholt: angefasst werden nur Seiten mit
    // leser „offen", und ein Fehlschlag von Docling oder Jev entscheidet sofort
    // für Claude. Idempotent über die Queue in @/lib/leser/zuteilung — ein
    // Anstoß, während ein Lauf schon wartet, hängt sich an ihn an. Er kehrt
    // sofort zurück und wirft nie; die Antwort hier wartet auf nichts davon.
    //
    // Und er ist keine Schreibtür für einen Agenten: was mit einer Seite
    // geschieht, entscheiden Docling, die feste Regel und Jev. Der Aufrufer
    // bestimmt nur, WANN die App sich schon hochgeladene Seiten ansieht.
    zuteilungAnstossen(user.id);

    const entries = await listInbox(user.id, { limit: args.limit });
    const offen = entries.filter((entry) => entry.filedAt === null).length;
    const seitenstand = await listPageActivity(
      user.id,
      entries.map((entry) => entry.id),
    );

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
      )} ${heuteSatz(todayInBerlin())}`,
      entries.map((entry) => ({
        ...listRow(entry, seitenstand),
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

    // Durch die Tür @/lib/blatt-vorschlag (seit dem 11.10.2026): dieselbe,
    // durch die der Leser der App geht, der Opus selbst ruft. Was dort
    // geprüft wird — die Seiten gegen das Blatt, ein Leser je Seite, das
    // Schema des Handformulars, `createProposal(…, "agent")`, gleich danach
    // `autoFile()` —, steht dort; hier steht nur, was davon ein Modell im
    // Chat zu lesen bekommt. Die Sätze sind die von vorher, Wort für Wort:
    // ein Modell im Chat merkt von dem Umzug nichts.
    const ergebnis = await blattVorschlagen(user.id, {
      sheet: args.sheet,
      subjectId,
      title: args.title,
      capturedOn: args.captured_on,
      note: args.note,
      topics: args.topics,
      transcripts: args.transcripts,
    });

    if (ergebnis.art === "abgewiesen") {
      switch (ergebnis.grund) {
        case "kein-blatt":
          return fehler("Dieses Blatt gibt es nicht.");
        case "fremde-seiten":
          // Die fremden ids beim Namen, damit ein Modell, das die Blatt-id
          // statt der Seiten-id geschickt hat, im selben Satz liest, wo die
          // richtige steht.
          return fehler(
            `Zu diesem Blatt gehören diese Seiten nicht: ${ergebnis.seiten.join(", ")}. Die ids seiner Seiten stehen in read_sheet unter „pages“ — die id des Blattes ist eine andere.`,
          );
        case "ungueltig":
          return fehler(ergebnis.meldungen.join(" "));
        case "nicht-angelegt":
          // Der dritte Grund steht nur da, wenn er überhaupt in Frage kommt:
          // seit der Abschrift sagt `createProposal()` auch dann Nein, wenn
          // eine der genannten Seiten nicht zu diesem Blatt gehört. Die Tür
          // hat das gerade erst verneint — bleibt das Rennen: wird die Seite
          // in den Millisekunden dazwischen gelöscht (ein unscharfes Foto,
          // das jemand wegwirft, während der Agent liest), ist sie hier weg.
          // Ohne diesen Satz suchte das Modell den Fehler bei Blatt und Fach,
          // die beide in Ordnung sind.
          return fehler(
            `Der Vorschlag konnte nicht angelegt werden: das Blatt gibt es nicht, oder das vorgeschlagene Fach gehört nicht dazu.${
              ergebnis.mitAbschrift
                ? " Möglich ist auch, dass eine der abgeschriebenen Seiten inzwischen weg ist — read_sheet nennt die, die es noch gibt."
                : ""
            }`,
          );
      }
    }

    // Nur Verworfenes ist kein Fehler, sondern das Ergebnis der Regel „ein
    // Leser je Seite“: der Aufrufer hat nur Seiten abgeschrieben, die die App
    // selbst liest. Als `isError` liefe es auf dasselbe hinaus wie das
    // Abweisen, das das Verwerfen gerade vermeiden soll.
    if (ergebnis.art === "leer") {
      return daten(
        `Nichts angelegt: ${verworfenSatz(ergebnis.verworfen)} Sonst stand nichts im Vorschlag, also gibt es keinen.`,
        { id: null, sheet: args.sheet, verworfen: ergebnis.verworfen },
      );
    }

    const { id, verworfen, vorschlag, eingeordnet } = ergebnis;

    // Was wirklich angekommen ist, und nicht, was hereinkam: `vorschlag` ist
    // das, was das Schema durchgelassen hat. Nähme @/lib/inbox das Feld
    // `transcripts` eines Tages nicht mehr an, stünde hier eine leere Liste —
    // und niemand läse „Der Vorschlag liegt im Eingangskorb" und glaubte, die
    // Abschrift sei mit drin.
    const gespeichert = vorschlag.transcripts ?? [];

    return daten(
      // `zahl()` steht hier nicht: es baut den Nominativ („eine Seite"), und
      // „mit der Abschrift von eine Seite" wäre ein schiefer Satz in einem
      // Chatfenster.
      `Der Vorschlag liegt im Eingangskorb${
        gespeichert.length > 0
          ? `, mit der Abschrift von ${gespeichert.length} Seite${gespeichert.length === 1 ? "" : "n"}`
          : ""
      }. ${
        !eingeordnet.ok
          ? `Er bleibt im Korb, bis ein Mensch ihn übernimmt (${eingeordnet.grund}).`
          : eingeordnet.art === "jev"
            ? `Jev hat ihn übernommen: ${eingeordnet.subjectName}${mitThemen(eingeordnet.topics)}.`
            : `Das Blatt war schon eingeordnet, also hat die App nur die Abschrift übernommen (${zahl(eingeordnet.seiten, "Seite", "Seiten", "f")}); Fach und Themen bleiben: ${eingeordnet.subjectName}${mitThemen(eingeordnet.topics)}.`
      }${verworfen.length > 0 ? ` ${verworfenSatz(verworfen)}` : ""}`,
      {
        id,
        sheet: args.sheet,
        // Was nicht in den Vorschlag kam, je Seite mit Grund — leer, wenn
        // alles ankam. Steht immer da, damit ein Aufrufer nicht zwischen
        // „fehlt" und „nichts verworfen" unterscheiden muss.
        verworfen,
        // `via` sagt, welcher der beiden Wege übernommen hat. Beim Weg ohne
        // Jev gibt es keine Sicherheit, die man nennen könnte — dort steht
        // `null` und keine erfundene Eins.
        eingeordnet: !eingeordnet.ok
          ? null
          : eingeordnet.art === "jev"
            ? {
                via: "jev",
                subject: eingeordnet.subjectName,
                confidence: eingeordnet.confidence,
                topics: eingeordnet.topics,
              }
            : {
                via: "abschrift",
                subject: eingeordnet.subjectName,
                confidence: null,
                topics: eingeordnet.topics,
                pages: eingeordnet.seiten,
              },
        subjectId: vorschlag.subjectId,
        title: vorschlag.title,
        capturedOn: vorschlag.capturedOn,
        note: vorschlag.note,
        topics: vorschlag.topics,
        // Je Seite die Länge und nicht der Text. Der Text stünde sonst zweimal
        // in derselben Unterhaltung — einmal hingeschickt, einmal
        // zurückgelesen — und verdoppelte die Kosten des Aufrufs für nichts.
        // Die Länge beantwortet trotzdem die einzige Frage, die offen ist: ist
        // die leere Seite als leer angekommen (0) oder gar nicht?
        transcripts: gespeichert.map((eintrag) => ({
          page: eintrag.pageId,
          chars: eintrag.text.length,
        })),
      },
    );
  },

  async read_exam_material(user, args) {
    const stoff = await stoffZuKlausur(user.id, args.exam);
    if (!stoff) return fehler("Diese Prüfung gibt es nicht.");

    const themen = args.topic ? einThema(stoff, args.topic) : stoff.themen;
    if ("fehler" in themen) return themen.fehler;

    // Satz, Warnungen und Daten stehen seit dem 11.10.2026 in
    // @/lib/klausur-stoff: der Fragenlauf der App gibt Opus dieselbe Auskunft
    // über die API, und zwei Fassungen davon liefen auseinander. Die Grenze
    // prüft hier wie überall `daten()`; sie zählt genau so wie die Auskunft.
    const auskunft = await stoffAuskunft(user.id, stoff, themen);

    return daten(
      auskunft.satz,
      auskunft.daten,
      "read_exam_material nimmt `topic` — damit kommt nur ein Thema dieser Klausur, und die Antwort wird entsprechend kleiner.",
    );
  },

  async propose_questions(user, args) {
    const ergebnis = await vorschlagAnlegen(
      user.id,
      args.exam,
      vorschlagsFragen(args.questions),
      args.note ?? null,
    );

    if (!ergebnis.ok) return fehler(ABWEISUNG_SATZ[ergebnis.grund]);

    // Die Zahl aus dem Ergebnis und nicht die der Anfrage. Sie kann kleiner
    // sein: Fragen auf eine fremde Seite fallen weg, und ein Satz, der die
    // hereingekommene Zahl wiederholte, behauptete etwas, das nicht in der
    // Datenbank steht.
    const weg = args.questions.length - ergebnis.fragen;

    return daten(
      `${zahl(ergebnis.fragen, "Frage liegt", "Fragen liegen", "f")} im Eingangskorb.${
        weg > 0
          ? weg === 1
            ? " Eine Frage nannte eine Seite, die nicht zum Stoff dieser Prüfung gehört; sie wurde nicht abgelegt."
            : ` ${weg} Fragen nannten Seiten, die nicht zum Stoff dieser Prüfung gehören; sie wurden nicht abgelegt.`
          : ""
      }${
        ergebnis.themenVerworfen > 0
          ? ` Bei ${ergebnis.themenVerworfen} ${ergebnis.themenVerworfen === 1 ? "Frage gehörte das genannte Thema" : "Fragen gehörten die genannten Themen"} nicht zum Fach dieser Klausur; ${ergebnis.themenVerworfen === 1 ? "sie liegt" : "sie liegen"} ohne Thema im Korb. In „topic“ gehört die subjectTopicId aus read_exam_material — nicht die id des Klausurthemas und keine aus einem anderen Fach.`
          : ""
      } Es ändert sich nichts, bis ein Mensch sie übernimmt; dann wird jedes Zitat gegen die Abschrift geprüft.`,
      {
        id: ergebnis.proposalId,
        exam: args.exam,
        questions: ergebnis.fragen,
        skipped: weg,
        topicsDropped: ergebnis.themenVerworfen,
      },
    );
  },
};

/**
 * Warum gar kein Vorschlag entstand — als Satz, der sagt, was zu tun ist.
 *
 * Die Gründe kommen aus dem Abrufkern (`VorschlagAbweisung`); die Sätze stehen
 * hier, weil sie an ein Modell gehen und nicht in ein Protokoll. `Record<…>`
 * und nicht `switch`: Kommt im Kern ein Grund dazu, hält der Compiler diese
 * Stelle an, statt sie stillschweigend „unbekannter Fehler" antworten zu
 * lassen.
 */
const ABWEISUNG_SATZ: Record<VorschlagAbweisung, string> = {
  "keine-klausur":
    "Diese Prüfung gibt es nicht. read_exams zeigt, welche anstehen — die id daraus gehört in `exam`.",
  "keine-fragen": `Ohne Fragen gibt es keinen Vorschlag, und mehr als ${FRAGEN_MAX} nimmt diese Tür nicht. Schick sie in zwei Aufrufen, wenn es mehr sein sollen.`,
  "zu-lang":
    "Eine der Fragen ist zu lang — die Grenzen stehen an den einzelnen Feldern im Verzeichnis. Abgelegt wurde nichts: Aus einer Liste still eine Frage zu entfernen hieße, dass der Mensch eine unvollständige für eine vollständige hält.",
  "zu-kurz": `Eine der Fragen ist zu kurz. Ein Zitat unter ${ZITAT_MIN} Zeichen bezeichnet keine Stelle — je kürzer der Ausschnitt, desto beliebiger die Stelle, die er trifft —, und der Verwechslungssatz darf nicht bloß ein Wort sein. Abgelegt wurde nichts.`,
  "fremde-seiten":
    "Keine der genannten Seiten gehört zum Stoff dieser Prüfung. Die erlaubten ids stehen in `pages` von read_exam_material zu genau dieser Prüfung — die id eines Blattes oder eines Themas ist eine andere, und eine Seite aus einem anderen Fach zählt nicht dazu.",
};

/**
 * Ein einzelnes Thema einer Klausur — oder ein Satz, warum es nicht eindeutig
 * war.
 *
 * `satzZuMatch()` steht hier nicht: Der rät zu read_subjects, und das ist an
 * dieser Tür der falsche Rat. Wer ein Thema dieser Klausur sucht, findet die
 * Liste in derselben Antwort, die er gerade bekommen hat — ohne `topic`.
 */
function einThema(
  stoff: KlausurStoff,
  frage: string,
): KlausurStoff["themen"] | { fehler: ToolOutcome } {
  const treffer = matchTopic(
    stoff.themen.map((thema) => ({ id: thema.examTopicId, title: thema.title })),
    frage,
  );

  if (treffer.art === "mehrere") {
    return {
      fehler: fehler(
        `„${frage}“ passt auf mehrere Themen dieser Klausur: ${treffer.namen.join(", ")}.`,
      ),
    };
  }

  if (treffer.art === "keins") {
    return {
      fehler: fehler(
        `Ein Thema namens „${frage}“ steht nicht auf dieser Klausur. Ohne „topic“ kommen alle ${stoff.themen.length} Themen mit.`,
      ),
    };
  }

  const gemeint = treffer.treffer.id;
  return stoff.themen.filter((thema) => thema.examTopicId === gemeint);
}

/**
 * Wie schwer ein Bild in einem Tool-Ergebnis sein darf.
 *
 * Die Claude-App nimmt ein Ergebnis bis rund 150 000 Zeichen an, und Base64
 * macht aus drei Bytes vier Zeichen. 105 000 Bytes ergeben genau 140 000
 * Zeichen und lassen damit zehntausend für alles andere in der Antwort: den
 * Satz davor, den JSON-RPC-Umschlag, die Feldnamen. Das ist die Rechnung, und
 * sie geht knapp auf — deshalb steht sie hier und nicht als runde Zahl im
 * Vorbeigehen.
 *
 * Die Lesefassung zielt beim Aufnehmen auf 100 KB (`READING_TARGET_BYTES` in
 * @/lib/images); diese Zahl hier ist der Prüfstein daneben und absichtlich
 * etwas größer: sie soll nur anschlagen, wenn die Qualitätsleiter im Browser
 * ihr Ziel wirklich verfehlt hat. Gemessen an zwei Blättern: 69 und 89 KB.
 */
const MAX_IMAGE_BYTES = 105_000;

/**
 * Ein Blatt, wie es in jeder der drei Listen steht.
 *
 * `firstPageId` steht mit dabei, obwohl es aussieht wie ein Detail für die
 * Detailansicht. Es ist die Abkürzung, die den Korb überhaupt benutzbar macht:
 * ohne sie müsste ein Agent zwischen `read_inbox` und `read_page` immer erst
 * `read_sheet` rufen, nur um eine id nachzuschlagen, die die Liste längst
 * geladen hat. Bei einem Blatt mit mehreren Seiten führt der Weg trotzdem über
 * `read_sheet` — die zweite Seite kennt nur das Detail.
 */
function sheetRow(sheet: MaterialListItem) {
  return {
    id: sheet.id,
    title: sheet.title,
    capturedOn: sheet.capturedOn,
    note: sheet.note,
    subject: sheet.subject.name,
    subjectId: sheet.subject.id,
    pageCount: sheet.pageCount,
    /** Für read_page. Bei mehrseitigen Blättern stehen die übrigen in read_sheet. */
    firstPageId: sheet.coverPageId,
    topics: sheet.topics.map((topic) => topic.title),
  };
}

/**
 * Ein Blatt in `read_inbox` und `read_material`: die Zeile von `sheetRow()`,
 * dazu wann zuletzt eine Seite kam und welche nachgereichten noch niemand
 * gelesen hat — als Zahl (`unreadAttachedPages`) und als ids
 * (`unreadAttachedPageIds`, in der Reihenfolge des Blattes).
 *
 * Seit dem 4.10.2026 — gebaut für den Postboten, seit dem 11.10.2026 für
 * Chats, die abschreiben —, und nur an diesen beiden Türen —
 * `read_sheet` nennt jede Seite einzeln mit der Länge ihrer Abschrift und
 * braucht die Zusammenfassung nicht. Was „nachgereicht" heißt und warum die
 * Altblätter dabei leer ausgehen, steht an `nachgereichtUngelesen()` in
 * @/lib/materials. Die ids stehen da, damit ein Agent genau diese Seiten
 * abschreibt und keine andere ungelesene daneben.
 *
 * Fehlt ein Blatt in `seitenstand`, hat es keine Seite. Über die App kommt das
 * nicht vor (`deletePage()` lässt die letzte stehen); dann steht `null` da und
 * kein erfundener Zeitpunkt.
 */
function listRow(
  sheet: MaterialListItem,
  seitenstand: Map<string, PageActivity>,
) {
  const stand = seitenstand.get(sheet.id);

  return {
    ...sheetRow(sheet),
    lastPageAt: stand?.lastPageAt ?? null,
    unreadAttachedPages: stand?.unreadAttachedPages ?? 0,
    unreadAttachedPageIds: stand?.unreadAttachedPageIds ?? [],
  };
}

/** „, Kettenregel, Ableitung" hinter dem Fach — oder nichts. */
function mitThemen(topics: string[]): string {
  return topics.length > 0 ? `, ${topics.join(", ")}` : "";
}

/**
 * Die Abschriften eines Blattes, wie read_transcript sie ausliefert.
 *
 * `id` und nicht `pageId`, weil read_sheet die Seite dieses Blattes schon so
 * nennt — dieselbe Sache heißt an dieser Tür überall gleich, und ein Modell
 * soll die beiden Listen nebeneinanderlegen können, ohne zu übersetzen.
 *
 * ALLE Seiten kommen mit, auch die ungelesenen. Nur die mit Text auszuliefern
 * wäre kürzer und wäre eine stille Lücke: eine Antwort, in der zwischen Seite 2
 * und Seite 4 nichts steht, sieht aus wie ein vollständiges Blatt und ist es
 * nicht. Mit `transcript: null` steht dort, was wirklich der Fall ist — diese
 * Seite hat noch niemand gelesen —, und der Unterschied zu `""` bleibt erhalten.
 */
function transcriptRows(pages: MaterialPageTranscript[]) {
  return pages.map((page) => ({
    id: page.pageId,
    sortOrder: page.sortOrder,
    transcript: page.transcript,
    /** Die App hat diese Abschrift maschinell geschrieben (Docling); gegengelesen hat sie niemand. */
    maschinell: page.maschinell,
  }));
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

  // Eine id geht denselben Weg wie in der Ablage: über `resolveMaterialTopic()`,
  // und das folgt einer zusammengelegten Schreibweise auf ihr Ziel. Über die
  // Liste unten fände sie sich nicht — `listTopics()` lässt Aliasse draußen,
  // weil sie in einer Vorschlagsliste doppelt dastünden. Wer eine id aus einem
  // früheren Aufruf mitbringt, soll trotzdem die Blätter bekommen, die inzwischen
  // unter dem anderen Namen hängen.
  if (looksLikeId(query)) {
    const aufgeloest = await resolveMaterialTopic(user.id, query);

    if (!aufgeloest) {
      return { fehler: fehler(`Ein Thema mit dieser id gibt es nicht: ${query}`) };
    }

    return {
      treffer: { id: aufgeloest.id, title: aufgeloest.title },
      fach:
        subjects.find((subject) => subject.id === aufgeloest.subjectId)?.name ??
        "unbekanntes Fach",
    };
  }

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
 * Welcher Tag heute ist — in beiden Schreibweisen.
 *
 * Die deutsche steht da, weil der Satz deutsch ist; die andere, weil sie das
 * Format ist, das `propose_sheet` verlangt. Ohne sie müsste ein Modell seinen
 * eigenen Kalender befragen, und der ist nicht der dieser App: gerechnet wird
 * hier durchweg in Berliner Zeit, und um kurz nach Mitternacht liegen die
 * beiden Antworten einen Tag auseinander. Ein Schultag in der Zukunft wird beim
 * Vorschlag abgewiesen — dann lieber die Zahl mitliefern als den Fehler.
 */
function heuteSatz(heute: string): string {
  // „Heute ist Montag, 24. August" — `formatGerman()` bringt den Wochentag
  // schon mit, ein „der" davor wäre einer zu viel.
  return `Heute ist ${formatGerman(heute)} (${heute}).`;
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

/**
 * Ein Datenergebnis — und die Prüfung, ob es überhaupt eines werden kann.
 *
 * Gemessen wird genau der Text, den der Route Handler gleich zusammensetzt:
 * Satz, Zeilenumbruch, JSON (`toolResult()` in @/app/api/mcp/route.ts), mit
 * `auskunftZeichen()` und gegen `MAX_DATA_CHARS` aus ./auskunft — dort stehen
 * sie seit dem 11.10.2026, weil der Fragenlauf der App den Stoff einer Klausur
 * mit derselben Zahl misst. `grossAmAnfang()` ändert nur einen Buchstaben und
 * keine Länge, die Rechnung stimmt also auf das Zeichen.
 *
 * Dass dabei zweimal serialisiert wird — hier zum Messen, dort zum Senden — ist
 * der bewusste Preis dafür, dass `ToolOutcome` weiterhin Daten trägt und keinen
 * fertigen String: sonst müsste diese Datei wissen, wie die Antwort draußen
 * aussieht. Bei der größten erlaubten Antwort kostet der zweite Durchgang den
 * Bruchteil einer Millisekunde, und er kostet ihn einmal je Aufruf.
 *
 * Die Prüfung sitzt hier und nicht in den einzelnen Handlern, weil jedes
 * Datenergebnis durch diese eine Funktion geht — auch jedes künftige. Zurück
 * kommt ein gewöhnlicher Fehler (`isError`) und kein Protokollfehler: das
 * Modell soll ihn lesen und es enger noch einmal versuchen können.
 *
 * `rat` ist der Satz, mit dem sich DIESES Werkzeug kleiner fragen lässt —
 * derselbe Gedanke wie bei `grenzeErreicht()`: ein allgemeiner Rat wäre an der
 * Stelle, an der es darauf ankommt, der falsche. „Nimm `limit`" hilft an einem
 * Werkzeug ohne `limit` nicht weiter.
 */
function daten(satz: string, daten: unknown, rat?: string): ToolOutcome {
  const zeichen = auskunftZeichen(satz, daten);

  if (zeichen > MAX_DATA_CHARS) {
    return fehler(
      `Diese Antwort wäre ${tausender(zeichen)} Zeichen lang und passt damit nicht in ein Werkzeugergebnis (Grenze rund ${tausender(MAX_DATA_CHARS)}). Abgeschnitten wird sie nicht: eine halbe Antwort sähe aus wie eine ganze, und du würdest mit ihr weiterrechnen. ${rat ?? "Frag enger — die Lese-Werkzeuge nehmen dafür `limit`, ein Fach oder ein Thema."}`,
    );
  }

  return { art: "daten", satz: grossAmAnfang(satz), daten };
}

function fehler(satz: string): ToolOutcome {
  return { art: "fehler", satz: grossAmAnfang(satz) };
}
