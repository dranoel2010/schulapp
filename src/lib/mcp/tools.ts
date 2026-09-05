import { z } from "zod";

import { MAX_PAGES } from "@/lib/images";
import { LIST_LIMIT, MATERIAL_NOTE_MAX, MATERIAL_TITLE_MAX } from "@/lib/materials";
import {
  INBOX_LIMIT,
  PROPOSAL_TOPIC_LIMIT,
  PROPOSAL_TRANSCRIPT_MAX,
} from "@/lib/inbox";

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
 * Wie eine Seite benannt wird — immer als id, nie als „die zweite".
 *
 * Anders als beim Fach gibt es hier nichts aufzulösen: eine Seite hat keinen
 * Namen, und die Nummer, die ein Mensch ihr gäbe, steht in read_sheet neben
 * ihrer id. Der Satz in der Beschreibung ist deshalb der eigentliche Inhalt
 * dieses Arguments — Blatt-id und Seiten-id sehen gleich aus, und wer die
 * falsche schickt, bekommt eine Fehlermeldung statt eines Bildes.
 *
 * Eine Konstante und nicht zweimal derselbe Aufbau: read_page und die
 * Abschriften an propose_sheet meinen dasselbe. Jede Stelle darf die
 * Beschreibung mit `.describe()` überschreiben, so wie `SUBJECT_ARG` es an
 * read_grades tut.
 */
const PAGE_ARG = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe(
    "Die id einer Seite — `firstPageId` aus read_material oder read_inbox, oder eine aus read_sheet.",
  );

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
      "Abfotografierte Blätter, das neueste zuerst: id, Titel, Schultag, Fach, Themen, wie viele Seiten und `firstPageId` für read_page. Ohne Filter die ganze Ablage; mit `topic` beantwortet dieses Werkzeug „was habe ich zur Kettenregel?“.",
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
      "Ein einzelnes Blatt mit allen Seiten: je Seite die id (für read_page), die Maße, die Größe und `transcriptChars` — wie viele Zeichen ihre Abschrift hat. Dabei heißt `null` „diese Seite hat noch niemand gelesen“ und `0` „gelesen, und es stand nichts darauf“; den Wortlaut selbst holt read_transcript. Dazu Fach, Titel, Schultag, Notiz, Themen und ob es noch im Eingangskorb liegt.",
    readOnly: true,
    args: z.object({ sheet: SHEET_ARG }).strict(),
  },

  read_page: {
    title: "Das Foto einer Seite",
    description:
      "Das Foto einer Seite als Bild, in einer Fassung zum Lesen (lange Kante 1000 Pixel). Damit liest du, was auf dem Blatt steht. Die id einer Seite steht als `firstPageId` in read_material und read_inbox, alle Seiten eines Blattes in read_sheet — die id des Blattes ist eine andere.",
    readOnly: true,
    args: z.object({ page: PAGE_ARG }).strict(),
  },

  read_transcript: {
    title: "Die Abschrift eines Blattes",
    description:
      "Was auf den Seiten eines Blattes steht, als Text: je Seite die id, ihre Nummer und die Abschrift, die beim Einordnen übernommen wurde. Sie zu lesen ist billiger als die Fotos und lässt sich zitieren; ⟨spitze Klammern⟩ darin markieren, was schon beim Abschreiben unsicher war. `transcript: null` heißt „diese Seite hat noch niemand gelesen“ — dann hilft nur read_page. Welche Seiten überhaupt eine Abschrift haben, steht schon in read_sheet.",
    readOnly: true,
    args: z.object({ sheet: SHEET_ARG }).strict(),
  },

  read_inbox: {
    title: "Eingangskorb",
    description:
      "Was noch eine Entscheidung braucht: Blätter, die niemand durchgesehen hat, und offene Vorschläge dazu. Der Einstieg, wenn du beim Einordnen helfen sollst: jede Zeile nennt `firstPageId` — damit liest du das Foto direkt mit read_page und legst mit propose_sheet einen Vorschlag daneben. Hat ein Blatt mehrere Seiten, stehen die übrigen ids in read_sheet.",
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
      "Legt einen Vorschlag zu einem Blatt in den Eingangskorb: Fach, Titel, Schultag, Notiz, Themen — und die Abschrift dessen, was auf den Seiten steht.",
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
            "Der Schultag als Kalenderdatum (JJJJ-MM-TT). Er darf nicht in der Zukunft liegen — welcher Tag heute ist, sagt dir jedes Lese-Werkzeug am Ende seines Satzes. Meistens braucht es dieses Feld gar nicht: das Blatt trägt den Tag seiner Aufnahme schon.",
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
            [
              "Wonach der Mensch dieses Blatt später sucht — meist EINS bis DREI, höchstens " +
                PROPOSAL_TOPIC_LIMIT +
                ".",
              "Ein Thema ist der Griff zum Wiederfinden („was habe ich zur Kettenregel?“), nicht das Glossar des Blattes. Ein Hefteintrag über Siedlungsformen, der Einzelhof, Weiler, Haufendorf und Großstadt aufzählt, hat EIN Thema: „Siedlungsformen“. Die aufgezählten Begriffe sind sein Inhalt.",
              "Nimm eine Schreibweise, die im Vokabular des Fachs schon steht, wenn eine passt (read_topics). Aus jedem neuen Wort wird beim Übernehmen eine Vokabel, und Vokabeln lassen sich nicht mehr löschen — nur umbenennen oder zusammenlegen.",
              "Kurze Fachwörter, keine Sätze.",
            ].join(" "),
          ),
        /**
         * Die Abschrift — das einzige Feld, das an SEITEN hängt und nicht am
         * Blatt. Deshalb ein Array aus Paaren und kein Text: welcher Text zu
         * welcher Seite gehört, muss dastehen und darf nicht aus der
         * Reihenfolge geraten werden. Das Argument der Seite heißt `page`,
         * genau wie bei read_page — dieselbe Sache heißt an dieser Tür überall
         * gleich; nach `pageId` übersetzt wird einmal, beim Bauen der Eingabe
         * in @/lib/mcp/run.ts, genau wie `captured_on` nach `capturedOn`.
         *
         * **Diese Beschreibung ist das eigentliche Bauteil.** Sie ist das
         * Einzige, was steuert, WIE abgeschrieben wird, und deshalb steht sie
         * hier und nicht nur im Auftrag des Postboten: an der Claude-App sitzt
         * ein Mensch, der harness/auftrag.mts nie zu Gesicht bekommt. Der
         * Auftrag sagt dasselbe ausführlicher und beruft sich ausdrücklich
         * darauf, dass die Regeln hier stehen („Was hier NICHT steht, steht
         * schon in den Werkzeugen"). Wer einen dieser Sätze ändert, ändert den
         * dortigen mit — gingen die beiden auseinander, folgte der
         * unbeaufsichtigte Lauf einer anderen Regel als der Mensch im Chat.
         *
         * **Die Grenze kommt aus @/lib/inbox und ist nicht abgeschrieben.**
         * `PROPOSAL_TRANSCRIPT_MAX` ist die Zahl, gegen die
         * `proposalInputSchema` gleich darauf prüft — dieselbe Regel, nach der
         * `PROPOSAL_TOPIC_LIMIT` ein paar Zeilen weiter oben von dort kommt.
         * Stünde hier eine eigene, verspräche das Verzeichnis dem Modell etwas
         * anderes, als die Prüfung annimmt. `MAX_PAGES` deckelt nicht die
         * Wahrheit, sondern die Absurdität: mehr Abschriften als Seiten kann
         * kein Blatt haben.
         *
         * `.trim()` steht am Text, damit eine Seite aus lauter Leerraum als
         * „gelesen und leer" ankommt und nicht als Zeile voller Leerzeichen —
         * zod trimmt zuerst und misst dann. Die Leerzeilen INNERHALB bleiben:
         * sie sind die Gliederung der Seite.
         *
         * Die Doppelung zwischen dem `refine` und dem letzten Satz der
         * Beschreibung ist Absicht. `z.toJSONSchema()` lässt eine Verfeinerung
         * stillschweigend weg — im Verzeichnis stehen nur `maxItems` und
         * `maxLength` —, das Modell sieht die Regel also nicht. Stünde sie nur
         * im Code, bekäme es beim zweiten Eintrag zur selben Seite eine
         * Abweisung für etwas, das es nie lesen konnte. Andersherum genügt der
         * Satz allein auch nicht: @/lib/inbox faltet zwei Einträge zur selben
         * Seite still zusammen (der erste gilt), damit der zusammengesetzte
         * Primärschlüssel von `material_proposal_transcripts` nicht als
         * englischer Postgres-Fehler durch diese Tür zurückkommt — und „still"
         * heißt hier: die zweite Abschrift wäre weg, ohne dass jemand es sagt.
         * An der Tür wird sie deshalb abgewiesen, drinnen aufgefangen.
         */
        transcripts: z
          .array(
            z
              .object({
                page: PAGE_ARG.describe(
                  "Die id der Seite, zu der diese Abschrift gehört — aus read_sheet unter „pages“.",
                ),
                text: z
                  .string()
                  .trim()
                  .max(PROPOSAL_TRANSCRIPT_MAX)
                  .describe(
                    `Der Wortlaut dieser einen Seite, höchstens ${PROPOSAL_TRANSCRIPT_MAX} Zeichen. Leer heißt: gelesen, und es stand nichts darauf.`,
                  ),
              })
              .strict(),
          )
          .max(MAX_PAGES)
          .refine(
            (liste) =>
              new Set(liste.map((eintrag) => eintrag.page)).size === liste.length,
            "Zu jeder Seite gehört höchstens eine Abschrift — eine id steht zweimal da.",
          )
          .optional()
          .describe(
            [
              "Was auf den Seiten steht, wörtlich: je Seite ein Eintrag aus ihrer id (`page` — dieselbe wie bei read_page, alle ids eines Blattes stehen in read_sheet unter „pages“) und dem Text (`text`).",
              "Abschreiben, nicht zusammenfassen: Satz für Satz, Zeile für Zeile, in der Reihenfolge, in der es auf der Seite steht — Überschriften, Aufgabennummern und Vokabelzeilen mit, eine Tabelle zeilenweise. Nach dieser Abschrift sucht der Mensch sein Blatt später wieder; was du zusammenfasst, findet er nie.",
              "Die Schreibweise des Schülers bleibt stehen, auch die falsche: Rechtschreibfehler, Abkürzungen, Zahlen, ein fehlendes Komma und die Groß-/Kleinschreibung bleiben, wie sie dastehen, auch wenn sie mitten im Satz wechseln. Du schreibst ab, du korrigierst nicht — es ist sein Text und nicht deiner.",
              "Was du nicht sicher liest, kommt in ⟨spitze Klammern⟩: ⟨Kettenregel⟩ heißt „so lese ich es, sicher bin ich nicht“, ⟨Kettenregel/Kettenreqel⟩ nennt zwei mögliche Lesungen, ⟨unleserlich⟩ heißt „hier steht etwas, das ich nicht entziffern kann“. Rate NIE ein Wort ohne diese Klammern. Eine geratene Zeile steht danach als Tatsache in der App, und niemand sieht ihr an, dass sie geraten war; eine markierte liest der Mensch selbst nach.",
              "Was kein Text ist — eine Skizze, ein Diagramm, eine Zeichnung —, schreibst du nicht ab, sondern benennst es in denselben Klammern: ⟨Skizze: Kräfteparallelogramm⟩.",
              "Eine Seite, auf der nichts steht, bekommt einen LEEREN Text und wird nicht weggelassen: kein Eintrag heißt „diese Seite hat noch niemand gelesen“, ein leerer Text heißt „gelesen, und es stand nichts darauf“.",
              "Eine Seite, die du gar nicht lesen kannst — zu unscharf, zu dunkel, angeschnitten —, lässt du weg: keinen Eintrag, keinen halben Text, keinen geratenen. Sie gilt damit weiter als ungelesen und ist nach einem besseren Foto wieder dran. Die übrigen Seiten schickst du trotzdem mit: eine unlesbare Seite ist kein Grund, die übrigen wegzulassen.",
              `Höchstens ${MAX_PAGES} Einträge, je Seite höchstens ${PROPOSAL_TRANSCRIPT_MAX} Zeichen, und jede Seite höchstens einmal.`,
            ].join(" "),
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
