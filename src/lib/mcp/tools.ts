import { z } from "zod";

import { LIST_LIMIT, MATERIAL_NOTE_MAX, MATERIAL_TITLE_MAX } from "@/lib/materials";
import { INBOX_LIMIT, PROPOSAL_TOPIC_LIMIT } from "@/lib/inbox";

/**
 * Der Werkzeugkasten des Agenten — was er kann und wie er danach fragt.
 *
 * **Eine Wahrheit je Werkzeug.** Die Beschreibung der Argumente steht hier als
 * zod-Schema, und daraus wird beides: die Prüfung beim Aufruf und das
 * JSON-Schema, das im Verzeichnis (`tools/list`) steht. Von Hand geschrieben
 * wären es zwei Fassungen derselben Aussage, und die erste, die sich ändert,
 * wäre die falsche — ein Modell schickte dann Argumente, die die Prüfung
 * abweist, ohne dass jemand einen Fehler sähe.
 *
 * **Die Namen sind englisch, die Sätze deutsch.** Dieselbe Regel wie im
 * übrigen Code: Bezeichner englisch (`listSubjects`, `materialTopics`), Prosa
 * deutsch. Der Name eines Werkzeugs ist ein Bezeichner — er steht in einem
 * Protokoll neben `tools/call` —, seine Beschreibung ist Prosa, und sie geht an
 * ein Modell, das mit dem Nutzer Deutsch spricht. Ausgenommen bleibt, was in
 * @/lib/mcp/run.ts eine deutsche ANTWORT benennt (`art: "daten" | "fehler"`) —
 * dieselbe Freiheit nimmt sich `markFiled()` in @/lib/inbox mit „gesetzt",
 * „unveraendert", „weg".
 *
 * **Argumente heißen draußen `captured_on` und drinnen `capturedOn`.** Über die
 * Leitung ist snake_case die Gewohnheit jedes MCP-Servers, im Code ist
 * camelCase die dieses Projekts; übersetzt wird an einer Stelle, beim Bauen der
 * Eingabe in run.ts. Zwei Schreibweisen sind ein kleiner Preis dafür, dass
 * beide Seiten aussehen wie ihresgleichen.
 *
 * **`read_*` und `propose_*`, mehr nicht.** Das ist keine Sparsamkeit, sondern
 * die Bedingung des ganzen KI-Anschlusses, und sie steht so in KONZEPT.md: wer
 * nicht vertrauenswürdige Blätter liest und gleichzeitig schreiben darf, ist
 * über das Blatt selbst angreifbar. Es gibt deshalb kein `create_`, kein
 * `update_`, kein `delete_` und ausdrücklich auch kein `confirm_proposal` —
 * übernehmen kann nur ein Mensch, im selben Formular wie immer.
 *
 * **Jedes Werkzeug trägt `readOnlyHint`.** Das ist kein Beiwerk: die Claude-App
 * entscheidet daran, ob sie vor jedem Aufruf nachfragt. Ein lesendes Werkzeug
 * darf durchlaufen, `propose_sheet` fragt. Genau so soll es sein — ein
 * Vorschlag ist eine Zeile im Eingangskorb eines Menschen.
 */

/** Was ein Werkzeug ausmacht. */
type ToolSpec = {
  /** Die Überschrift, die ein Mensch in der Oberfläche sieht. */
  title: string;
  /** Was es tut — für das Modell. Ein Satz, was zurückkommt; dann die Feinheiten. */
  description: string;
  /** Liest es nur? Entscheidet, ob die Claude-App vor jedem Aufruf fragt. */
  readOnly: boolean;
  args: z.ZodType;
};

/**
 * Wie ein Fach oder ein Thema benannt werden darf.
 *
 * Ein Agent, der ein Blatt gelesen hat, kennt „Mathe" und nicht
 * `3f7c1a2e-…`. Ihn erst eine Liste holen zu lassen, nur um einen Namen in eine
 * id zu übersetzen, wäre ein Umweg, den die Oberfläche auch niemandem zumutet:
 * dort tippt man ein Fach an. Erlaubt sind deshalb id, Name und Kürzel; welcher
 * davon gemeint ist, entscheidet `matchSubject()` in ./resolve.
 */
const SUBJECT_ARG = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe("Fach: id, voller Name oder Kürzel — „Mathematik“, „Ma“ oder die id.");

const SHEET_ARG = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe("Die id eines Blattes, wie sie read_material oder read_inbox liefert.");

/**
 * Der Werkzeugkasten. Die Reihenfolge ist die, in der ein Verzeichnis sie
 * ausliefert — vom Groben zum Feinen, damit ein Modell die Liste von oben
 * lesen kann und dabei die Ordnung der App mitbekommt.
 */
export const TOOLS = {
  read_subjects: {
    title: "Fächer",
    description:
      "Alle Fächer mit id, Name, Kürzel, Lehrkraft, Raum und der Gewichtung schriftlich/mündlich. Der Einstieg in fast alles andere: die id von hier steht in read_topics, read_material und propose_sheet.",
    readOnly: true,
    args: z
      .object({
        include_archived: z
          .boolean()
          .optional()
          .describe(
            "Auch abgewählte Fächer. Vorgabe: nein — sie kommen im Alltag nicht mehr vor, ihre alten Noten zählen aber weiter.",
          ),
      })
      .strict(),
  },

  read_topics: {
    title: "Themen eines Fachs",
    description:
      "Das Themen-Vokabular eines Fachs, das zuletzt gesehene zuerst, mit der Zahl der Blätter je Thema. Aus diesen Themen schöpfen Klausuren und Blätter. Zusammengelegte Schreibweisen bleiben draußen.",
    readOnly: true,
    args: z.object({ subject: SUBJECT_ARG }).strict(),
  },

  read_timetable: {
    title: "Stundenplan",
    description:
      "Der feste Wochenplan Mo–Fr mit dem Stundenraster (wann welche Stunde beginnt und endet). Er wiederholt sich jede Woche; einen Kalender mit einzelnen Tagen gibt es nicht.",
    readOnly: true,
    args: z.object({}).strict(),
  },

  read_homework: {
    title: "Hausaufgaben",
    description:
      "Die Hausaufgaben mit Fach, Fälligkeit und Notiz — offene zuerst, überfällige ganz oben. Abgehaktes ist standardmäßig nicht dabei.",
    readOnly: true,
    args: z
      .object({
        include_done: z
          .boolean()
          .optional()
          .describe("Auch erledigte Aufgaben, das zuletzt Abgehakte zuerst."),
      })
      .strict(),
  },

  read_exams: {
    title: "Klausuren und Lernplan",
    description:
      "Kommende Prüfungen mit Datum, Art, Fach, Themenzahl und dem Fortschritt ihres Lernplans (wie viele Blöcke geplant, erledigt, offen). Mit `exam` stattdessen eine einzelne Prüfung, dann mit allen Themen und allen Lernblöcken.",
    readOnly: true,
    args: z
      .object({
        include_past: z
          .boolean()
          .optional()
          .describe("Auch geschriebene Prüfungen, die zuletzt geschriebene zuerst."),
        exam: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .optional()
          .describe("Die id einer Prüfung aus einem vorherigen Aufruf."),
      })
      .strict(),
  },

  read_grades: {
    title: "Noten",
    description:
      "Der Gesamtschnitt und der Schnitt je Fach. Mit `subject` zusätzlich die einzelnen Noten dieses Fachs, getrennt nach schriftlich und mündlich. Noten stehen als deutsche Noten mit Tendenz („2+“) und als Zahl (1,7).",
    readOnly: true,
    args: z
      .object({
        subject: SUBJECT_ARG.optional().describe(
          "Nur dieses Fach, dafür mit allen einzelnen Noten.",
        ),
      })
      .strict(),
  },

  read_material: {
    title: "Ablage durchsuchen",
    description:
      "Abfotografierte Blätter, das neueste zuerst: id, Titel, Schultag, Fach, Themen und wie viele Seiten. Ohne Filter die ganze Ablage; mit `topic` beantwortet dieses Werkzeug „was habe ich zur Kettenregel?“. Das Foto selbst kommt aus read_page.",
    readOnly: true,
    args: z
      .object({
        subject: SUBJECT_ARG.optional(),
        topic: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .describe(
            "Thema: id oder Titel. Ein Thema gehört zu genau einem Fach — damit steht das Fach schon fest, und `subject` ist daneben überflüssig.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIST_LIMIT)
          .optional()
          .describe(`Wie viele Blätter höchstens. Vorgabe und Grenze: ${LIST_LIMIT}.`),
      })
      .strict(),
  },

  read_sheet: {
    title: "Ein Blatt",
    description:
      "Ein einzelnes Blatt mit allen Seiten: je Seite die id (für read_page), die Maße und die Größe. Dazu Fach, Titel, Schultag, Notiz, Themen und ob es noch im Eingangskorb liegt.",
    readOnly: true,
    args: z.object({ sheet: SHEET_ARG }).strict(),
  },

  read_page: {
    title: "Das Foto einer Seite",
    description:
      "Das Foto einer Seite als Bild, in einer Fassung zum Lesen (lange Kante 1000 Pixel). Damit liest du, was auf dem Blatt steht. Die id einer Seite kommt aus read_sheet — nicht die id des Blattes.",
    readOnly: true,
    args: z
      .object({
        page: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .describe("Die id einer Seite aus read_sheet."),
      })
      .strict(),
  },

  read_inbox: {
    title: "Eingangskorb",
    description:
      "Was noch eine Entscheidung braucht: Blätter, die niemand durchgesehen hat, und offene Vorschläge dazu. Der Einstieg, wenn du beim Einordnen helfen sollst — lies die Blätter mit read_page und leg mit propose_sheet einen Vorschlag daneben.",
    readOnly: true,
    args: z
      .object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(INBOX_LIMIT)
          .optional()
          .describe(`Wie viele Zeilen höchstens. Vorgabe und Grenze: ${INBOX_LIMIT}.`),
      })
      .strict(),
  },

  propose_sheet: {
    title: "Vorschlag zu einem Blatt",
    description: [
      "Legt einen Vorschlag zu einem Blatt in den Eingangskorb: Fach, Titel, Schultag, Notiz, Themen.",
      "Er ändert nichts. Er liegt neben dem Blatt, bis ein Mensch ihn im Formular übernimmt — und dabei jedes Feld noch ändern kann.",
      "Jedes Feld darf fehlen, und fehlen heißt überall dasselbe: „dazu sage ich nichts, es bleibt, wie es am Blatt steht“. Erfinde also keinen Titel, nur damit das Feld gefüllt ist. Nur ganz leer darf ein Vorschlag nicht sein.",
      "Themen sind freier Text und dürfen im Vokabular noch fehlen — schreib sie so, wie sie auf dem Blatt stehen.",
      "Eine Ausnahme von „leer heißt: es bleibt“: schlägst du ein anderes Fach vor und nennst keine Themen, fallen die Themen des Blattes weg. Sie gehören dem Vokabular des alten Fachs.",
    ].join(" "),
    readOnly: false,
    args: z
      .object({
        sheet: SHEET_ARG,
        subject: SUBJECT_ARG.optional().describe(
          "Das vorgeschlagene Fach. Fehlt es, bleibt das Fach des Blattes.",
        ),
        title: z
          .string()
          .trim()
          .max(MATERIAL_TITLE_MAX)
          .optional()
          .describe(
            `Der vorgeschlagene Titel, höchstens ${MATERIAL_TITLE_MAX} Zeichen — die Überschrift des Blattes, nicht seine Zusammenfassung.`,
          ),
        captured_on: z
          .string()
          .trim()
          .optional()
          .describe(
            "Der Schultag als Kalenderdatum (JJJJ-MM-TT). Er darf nicht in der Zukunft liegen.",
          ),
        note: z
          .string()
          .trim()
          .max(MATERIAL_NOTE_MAX)
          .optional()
          .describe(`Ein Randvermerk, höchstens ${MATERIAL_NOTE_MAX} Zeichen.`),
        topics: z
          .array(z.string())
          .max(PROPOSAL_TOPIC_LIMIT)
          .optional()
          .describe(
            `Die Themen des Blattes als freier Text, höchstens ${PROPOSAL_TOPIC_LIMIT}. Kurze Fachwörter, keine Sätze.`,
          ),
      })
      .strict(),
  },
} as const satisfies Record<string, ToolSpec>;

export type ToolName = keyof typeof TOOLS;

/** Die geprüften Argumente eines Werkzeugs. */
export type ToolArgs<K extends ToolName> = z.infer<(typeof TOOLS)[K]["args"]>;

/** Gibt es dieses Werkzeug? Fragt der Aufruf, bevor er etwas ausführt. */
export function isToolName(value: string): value is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOLS, value);
}

/**
 * Das Verzeichnis für `tools/list`.
 *
 * Das JSON-Schema entsteht aus demselben zod-Schema, mit dem der Aufruf später
 * prüft. `io: "input"` ist dabei wichtig und nicht Geschmack: es beschreibt,
 * was hineingeht, und nicht, was nach der Umwandlung herauskommt — ein Feld mit
 * Vorgabewert ist eingehend freiwillig und ausgehend gesetzt.
 */
export function toolList(): Record<string, unknown>[] {
  return Object.entries(TOOLS).map(([name, spec]) => ({
    name,
    title: spec.title,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.args, {
      target: "draft-2020-12",
      io: "input",
    }),
    annotations: {
      title: spec.title,
      readOnlyHint: spec.readOnly,
      // Nur sinnvoll, wenn nicht nur gelesen wird: ein Vorschlag legt eine
      // Zeile an und nimmt keine weg. Zerstörend ist er also nicht — und weil
      // die Vorgabe der Spezifikation „ja, zerstörend" lautet, muss das
      // ausdrücklich dastehen.
      ...(spec.readOnly ? {} : { destructiveHint: false, idempotentHint: false }),
      // Nichts an dieser App liegt außerhalb ihrer selbst.
      openWorldHint: false,
    },
  }));
}
