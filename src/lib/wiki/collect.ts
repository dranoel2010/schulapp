import { getExam, listExams } from "@/lib/exams";
import { gradesBySubject } from "@/lib/grades";
import { listHomework } from "@/lib/homework";
import {
  TRANSCRIPT_EXPORT_LIMIT,
  listMaterialsWithTranscripts,
  type MaterialTranscriptExport,
  type TranscriptCursor,
} from "@/lib/materials";
import { listSubjects } from "@/lib/subjects";
import { listTopicsForSubjects } from "@/lib/subject-topics";
import { WEEKDAYS, listLessons, listPeriods } from "@/lib/timetable";
import {
  examDocument,
  gradesDocument,
  homeworkDocument,
  sheetDocument,
  subjectDocument,
  timetableDocument,
  type WikiDocument,
} from "@/lib/wiki/documents";

/**
 * Was in eine Übergabe kommt — der Bestand eines Nutzers, vollständig.
 *
 * „Vollständig" ist hier keine Höflichkeitsformel, sondern die Bedingung dafür,
 * dass die Delta-Erkennung funktioniert. Der Lauf vergleicht, was hier
 * herauskommt, mit dem, was in `wiki_deliveries` steht — und was hier FEHLT,
 * gilt als gelöscht und wird im MANIFEST als entfallen gemeldet. Eine Liste,
 * die still bei fünfzig Blättern aufhört, meldete also nicht „ich habe nicht
 * alles", sondern „den Rest gibt es nicht mehr".
 *
 * ── Deshalb: jede Decke wird gedreht ─────────────────────────────────────────
 *
 * `listMaterialsWithTranscripts()` gibt je Runde höchstens
 * `TRANSCRIPT_EXPORT_LIMIT` = 50 Blätter und sagt mit `next`, wo es weitergeht.
 * Wer die erste Runde nimmt und aufhört, sieht das 51. Blatt nicht — und
 * bekommt dabei keinen Fehler, nur ein zu kurzes Ergebnis. Hier wird deshalb
 * gedreht, bis `next` null ist.
 *
 * Alle anderen benutzten Listen wurden daraufhin einzeln nachgesehen und haben
 * keine Decke: `listSubjects()`, `listTopicsForSubjects()`, `listPeriods()`,
 * `listLessons()`, `listHomework()`, `listExams()` und `gradesBySubject()`
 * geben zurück, was da ist. `LIST_LIMIT` = 200 gilt für die Ablageliste
 * (`listMaterials()`), die hier bewusst nicht benutzt wird.
 *
 * ── Und: nichts wird dabei geschrieben ───────────────────────────────────────
 *
 * Ein nächtlicher Lauf liest. Der einzige Weg, auf dem er versehentlich etwas
 * anlegen könnte, ist der Stundenplan — dazu steht die Begründung an
 * `weekPlan()`.
 */

/**
 * Wie viele Runden der Abschriften-Export höchstens dreht.
 *
 * 400 Runden zu je 50 Blättern sind 20 000 Blätter — das Vielfache eines
 * Schuljahres. Die Schranke steht nicht wegen der Menge da, sondern wegen der
 * einen Art, wie eine Cursor-Schleife kaputtgeht: rückt der Cursor nicht vor,
 * läuft sie ewig und der Lauf hängt still, bis jemand den Container neu
 * startet. So wird daraus ein Fehler mit einem Satz daneben.
 */
const MAX_TRANSCRIPT_ROUNDS = 400;

/**
 * Alle Dokumente eines Nutzers, in einer festen Reihenfolge.
 *
 * Die Reihenfolge ist nicht Geschmack: Das MANIFEST listet die Dateien in
 * genau dieser Folge, und ein Lauf, der zweimal dasselbe liefert, soll zweimal
 * dieselbe Datei schreiben. Sortiert wird nicht nachträglich — jede benutzte
 * Abfrage sortiert schon, und diese Funktion hängt die Ergebnisse in der
 * Reihenfolge aneinander, in der ein Mensch sie beschreiben würde: erst die
 * Fächer, dann der Plan, dann was ansteht, dann was war, dann das Papier.
 */
export async function collectDocuments(
  userId: string,
): Promise<WikiDocument[]> {
  const documents: WikiDocument[] = [];

  // Archivierte Fächer sind dabei: an ihnen hängen Noten, Blätter und
  // Klausuren, die es weiterhin gab. Ohne sie fehlte im Wiki ein halbes
  // Schuljahr — und ihre Blätter fielen aus der Schleife unten heraus, weil
  // Blätter je Fach geholt werden.
  const subjects = await listSubjects(userId, { includeArchived: true });
  const topics = await listTopicsForSubjects(
    userId,
    subjects.map((subject) => subject.id),
  );

  for (const subject of subjects) {
    documents.push(subjectDocument(subject, topics.get(subject.id) ?? []));
  }

  documents.push(timetableDocument(userId, await weekPlan(userId)));

  // Auch die erledigten. Warum, steht an `homeworkDocument()`.
  for (const item of await listHomework(userId, { includeDone: true })) {
    documents.push(homeworkDocument(item));
  }

  // Auch die vergangenen — eine geschriebene Klausur ist genau das, was man im
  // Wiki nachschlägt.
  for (const exam of await listExams(userId, { includePast: true })) {
    const detail = await getExam(userId, exam.id);

    // Zwischen der Liste und dieser Frage kann eine Klausur gelöscht worden
    // sein. Dann gibt es sie nicht mehr, und das ist kein Fehler: sie fehlt in
    // dieser Übergabe und wird beim nächsten Lauf als entfallen gemeldet.
    if (detail) documents.push(examDocument(detail));
  }

  // `gradesBySubject()` gibt jedes nicht archivierte Fach zurück, auch eines
  // ohne eine einzige Note. Ein Notenblatt ohne Noten wäre eine leere Datei mit
  // einer Kennung, die der Agent verwalten müsste — und sobald die erste Note
  // eingetragen ist, entsteht sie von selbst.
  for (const entry of await gradesBySubject(userId)) {
    if (entry.grades.length === 0) continue;
    documents.push(gradesDocument(entry));
  }

  for (const subject of subjects) {
    for (const sheet of await allSheets(userId, subject.id)) {
      documents.push(sheetDocument(sheet));
    }
  }

  return documents;
}

/**
 * Alle Blätter eines Fachs samt ihren Abschriften — über so viele Runden, wie
 * es braucht.
 *
 * `includeUnread: true`, also auch Blätter, an denen noch keine Seite gelesen
 * wurde. Das ist der Unterschied zum Fach-PDF, und er ist Absicht: Ein PDF ist
 * ein Text zum Lesen, und vierzig stumme Stummel darin machen es unleserlicher.
 * Das Wiki ist die Ablage — dort ist „dieses Blatt gibt es, und es hat noch
 * niemand gelesen" eine Auskunft, die man haben will, und sie steht in der
 * Datei Seite für Seite. Ohne sie fiele ein frisch abfotografiertes Blatt aus
 * dem Bestand, und sobald jemand es liest, sähe es aus wie ein neues.
 */
async function allSheets(
  userId: string,
  subjectId: string,
): Promise<MaterialTranscriptExport[]> {
  const alle: MaterialTranscriptExport[] = [];
  let cursor: TranscriptCursor | null = null;

  for (let runde = 0; runde < MAX_TRANSCRIPT_ROUNDS; runde += 1) {
    const seite = await listMaterialsWithTranscripts(userId, subjectId, {
      after: cursor ?? undefined,
      includeUnread: true,
    });

    alle.push(...seite.sheets);
    cursor = seite.next;

    if (cursor === null) return alle;
  }

  throw new Error(
    `Der Abschriften-Export dreht sich im Kreis: mehr als ${MAX_TRANSCRIPT_ROUNDS} Runden ` +
      `zu je ${TRANSCRIPT_EXPORT_LIMIT} Blättern im Fach ${subjectId}.`,
  );
}

/**
 * Der Wochenplan — gelesen, nicht `loadWeek()`.
 *
 * `loadWeek()` ruft `ensurePeriods()`, und das LEGT das Vorgaberaster AN, wenn
 * noch keines dasteht. Für eine Seite, die jemand öffnet, ist das genau
 * richtig; für einen nächtlichen Lauf ist es das nicht. Ein Nutzer, der den
 * Stundenplan nie aufgemacht hat, fände darin sonst am nächsten Morgen zwölf
 * Stunden mit erfundenen Uhrzeiten — angelegt von einem Vorgang, der nur
 * abschreiben sollte, und im Wiki stünden sie dann als sein Raster.
 *
 * Der Preis sind vier Zeilen, die `loadWeek()` nachbauen. Sie stehen hier und
 * nicht als zweite Fassung in @/lib/timetable, weil der Unterschied genau der
 * ist: diese hier schreibt nicht.
 */
async function weekPlan(userId: string) {
  const [periods, lessons] = await Promise.all([
    listPeriods(userId),
    listLessons(userId),
  ]);

  return {
    periods,
    days: WEEKDAYS.map((day) => ({
      weekday: day.value,
      lessons: lessons.filter((lesson) => lesson.weekday === day.value),
    })),
  };
}
