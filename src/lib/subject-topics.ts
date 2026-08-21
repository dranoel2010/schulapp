import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db";
import {
  exams,
  examTopics,
  materialTopics,
  materials,
  subjects,
  subjectTopics,
  type SubjectTopic,
  type TopicOrigin,
} from "@/db/schema";
import { addDays, isCalendarDate, todayInBerlin } from "@/lib/dates";
import { normalizeTopics, vocabularyKey } from "@/lib/topics";

/**
 * Das Themen-Vokabular eines Fachs — Datenzugriff.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche, kein Import aus
 * Next. Gefaltet wird ausschließlich in @/lib/topics; diese Datei weiß nicht,
 * was ein Fachwort ist, sie lädt Zeilen und reicht Titel weiter. So bleibt die
 * Faltung prüfbar, ohne dass ein Test eine Datenbank braucht.
 *
 * Jede Abfrage filtert zusätzlich nach userId, auch dort, wo die id schon
 * eindeutig wäre. So kann kein fremder Datensatz durchrutschen, egal welche id
 * in der Adresszeile steht.
 *
 * **Nichts wird je gelöscht.** `linkExamTopics()` und `seedTopicsFromExams()`
 * schreiben ausschließlich in die nullable Spalte
 * `exam_topics.subject_topic_id` und legen fehlende Vokabeln an. Sie fassen
 * weder `exam_topics.title` noch `sort_order` noch `study_blocks` an, und
 * `setTopics()` in @/lib/exams bleibt unberührt. Das ist die Bedingung dafür,
 * dass diese Stufe keine Lernhistorie zerstören kann: an einem Klausurthema
 * hängen über `study_blocks.topic_id` mit „cascade" die abgehakten Lernblöcke
 * eines Halbjahrs.
 *
 * Überschrieben wird genau ein Fall, und der steht bei `linkExamTopics()`
 * ausführlich: ein Verweis, der nach einem Fachwechsel der Prüfung in ein
 * fremdes Fach zeigt. Er wird auf die Vokabel des jetzigen Fachs umgehängt.
 * Auch das bleibt additiv — die alte Vokabel bleibt stehen, wo sie steht.
 *
 * **Die Regel für Zusammenlegungen: vor jedem Lesen und vor jedem Schreiben
 * wird eine id erst über `resolveTopic()` aufgelöst.** Ein Alias zeigt dadurch
 * immer auf ein eigenständiges Thema und nie auf einen weiteren Alias.
 *
 * Zwei Ausnahmen gibt es, und beide meinen dieselbe Zeile: `unmergeTopic()`
 * und `renameTopic()` fassen genau die genannte Alias-Zeile an. Sichtbar sind
 * Alias-Zeilen nur in der Pflegeansicht (`listTopics` mit `includeMerged`), und
 * dort stehen die beiden Schaltflächen nebeneinander an derselben Zeile — sie
 * dürfen nicht verschiedene Zeilen meinen. Würde `unmergeTopic()` auflösen,
 * träfe es das Ziel und die Trennung liefe ins Leere; würde `renameTopic()`
 * auflösen, änderte ein Tippen in der einen Zeile den Titel einer anderen.
 *
 * Datumsfelder sind reine Kalenderdaten als Zeichenkette („2026-09-14"). Sie
 * lassen sich als Zeichenketten vergleichen und sortieren; gerechnet wird
 * ausschließlich in @/lib/dates.
 */

/**
 * Ein Thema des Fachs mit dem, was die Liste darüber zeigt.
 *
 * `examCount` zählt die Klausuren des Fachs, in denen das Thema vorkommt,
 * `materialCount` die abfotografierten Blätter — beide einschließlich der
 * Schreibweisen, die in dieses Thema zusammengelegt wurden. Umgekehrt heißt
 * das: eine Alias-Zeile selbst zeigt zweimal 0, denn ihre Klausuren und ihre
 * Blätter zählen beim Ziel mit. Sichtbar wird das nur mit `includeMerged`.
 *
 * Zwei Zahlen und nicht eine Summe: seit die Ablage Themen anlegt
 * (`origin: "blatt"`), gibt es Themen, die an zwölf Blättern hängen und in
 * keiner Klausur vorkommen. Stünde in der Themenpflege allein die
 * Klausurzahl, sähen sie aus wie unbenutzte Tippfehler — und wer aufräumt,
 * legte sie mit etwas anderem zusammen und zöge die Blätter still mit.
 */
export type TopicItem = SubjectTopic & {
  /** In wie vielen Klausuren dieses Fachs es vorkommt */
  examCount: number;
  /** An wie vielen Blättern dieses Fachs es hängt */
  materialCount: number;
};

/** Wie viel ein Durchlauf über die Klausuren am Vokabular geändert hat. */
export type SeedResult = {
  /** Neu entstandene Vokabeln */
  angelegt: number;
  /** Klausurthemen, die dadurch einen Eintrag im Vokabular bekommen haben */
  verknuepft: number;
  /**
   * Klausurthemen, deren Verweis nach einem Fachwechsel in ein fremdes Fach
   * zeigte und jetzt auf der Vokabel des jetzigen Fachs steht. Eine eigene
   * Zahl, weil das der eine Fall ist, in dem etwas überschrieben wird — er
   * gehört nicht stillschweigend unter „verknüpft" gemischt.
   */
  umgehaengt: number;
};

/**
 * Wie weit `resolveTopic()` einer Zusammenlegung folgt.
 *
 * Nach der Regel oben ist eine Kette höchstens einen Schritt lang — mehr kann
 * nur entstehen, wenn jemand die Datenbank von Hand anfasst. Die Schranke
 * sorgt dafür, dass daraus eine falsche Zahl wird und keine Endlosschleife,
 * die die ganze Seite hängen lässt.
 */
const MAX_ALIAS_HOPS = 8;

/**
 * Das Fenster für die Vorschläge, wenn es im Fach noch keine frühere Prüfung
 * gibt: die letzten 90 Tage — ungefähr ein Quartal Unterricht.
 */
const SUGGEST_FALLBACK_DAYS = 90;

/**
 * So viele Zeilen fasst eine gebündelte Anweisung höchstens.
 *
 * Gebündelt heißt: alle Werte stehen als Parameter in einer einzigen Abfrage,
 * und Postgres nimmt davon 65535 entgegen. Bei fünf Parametern je Zeile wäre
 * die Grenze erst bei gut dreizehntausend Zeilen erreicht — ein Schuljahr hat
 * ein paar hundert. Die Schranke ist trotzdem da, damit aus „viele Jahre auf
 * einmal" keine Abfrage wird, die die Datenbank zurückweist.
 */
const MAX_ROWS_PER_STATEMENT = 200;

const TOPIC_ORIGINS: readonly TopicOrigin[] = ["klausur", "manuell", "blatt"];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eine kaputte id aus der Adresszeile würde Postgres sonst mit einem Typfehler
 * quittieren — hier wird daraus ein sauberes „gibt es nicht".
 */
function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isOrigin(value: string): value is TopicOrigin {
  return TOPIC_ORIGINS.some((origin) => origin === value);
}

/**
 * Die Themen eines Fachs, das zuletzt gesehene zuerst.
 *
 * Zusammengelegte Themen bleiben standardmäßig draußen: sie sind Aliasse und
 * keine eigenen Themen — als Vorschlag stünden sie doppelt neben ihrem Ziel.
 * `includeMerged` ist für die Pflegeansicht gedacht, in der man sieht, welche
 * Schreibweise worauf zeigt.
 *
 * Ein `since`, das kein Kalendertag ist, liefert eine leere Liste statt
 * stillschweigend das ganze Fach: eine sichtbare Lücke ist ehrlicher als eine
 * Vorschlagsliste, die heimlich weiter zurückreicht als gefragt.
 */
export async function listTopics(
  userId: string,
  subjectId: string,
  options?: { includeMerged?: boolean; since?: string },
): Promise<TopicItem[]> {
  if (!isId(subjectId)) return [];
  if (options?.since !== undefined && !isCalendarDate(options.since)) return [];

  const filters: SQL[] = [];
  if (!options?.includeMerged) {
    filters.push(isNull(subjectTopics.mergedInto));
  }
  if (options?.since) {
    filters.push(gte(subjectTopics.lastSeenAt, options.since));
  }

  return topicsWithCounts(
    userId,
    eq(subjectTopics.subjectId, subjectId),
    and(...filters),
  );
}

/**
 * Die Themen mehrerer Fächer in EINER Abfrage, je Fach in der Reihenfolge von
 * `listTopics()`.
 *
 * Für Seiten, die mehrere Fächer nebeneinander zeigen. Eine Abfrage je Fach
 * wären bei zwölf Fächern zwölf Wege zur Datenbank für dieselbe Seite. Dass je
 * Fach dieselbe Reihenfolge und dieselben Felder herauskommen wie einzeln, ist
 * keine Zusage nebenbei: beide Wege laufen durch `topicsWithCounts()` und
 * sortieren dort mit denselben Schlüsseln, und ein Ausschnitt aus einer
 * sortierten Liste steht in derselben Reihenfolge wie die Liste.
 *
 * Zusammengelegte Themen bleiben draußen, genau wie bei `listTopics()` ohne
 * `includeMerged` — sie sind Schreibweisen und keine eigenen Themen.
 *
 * Jedes genannte Fach steht in der Antwort, auch eines ohne ein einziges Thema
 * und auch eines, das es gar nicht gibt: dann mit leerer Liste. Ein fehlender
 * Schlüssel wäre von „keine Themen" nicht zu unterscheiden, und der Aufrufer
 * müsste raten, ob er nichts bekommen hat oder nichts da war.
 */
export async function listTopicsForSubjects(
  userId: string,
  subjectIds: string[],
): Promise<Map<string, TopicItem[]>> {
  const bySubject = new Map<string, TopicItem[]>();
  // Die Reihenfolge bleibt die des Aufrufers, jedes Fach steht genau einmal da.
  for (const subjectId of subjectIds) bySubject.set(subjectId, []);

  // Eine kaputte id quittierte Postgres mit einem Typfehler. Sie bleibt aus der
  // Abfrage heraus und steht trotzdem mit leerer Liste in der Antwort.
  const ids = [...bySubject.keys()].filter(isId);
  if (ids.length === 0) return bySubject;

  const rows = await topicsWithCounts(
    userId,
    inArray(subjectTopics.subjectId, ids),
    isNull(subjectTopics.mergedInto),
  );

  // Ein fremdes Fach hat keine Themen mit dieser userId — sein Schlüssel bleibt
  // stehen, seine Liste bleibt leer.
  for (const topic of rows) bySubject.get(topic.subjectId)?.push(topic);

  return bySubject;
}

/**
 * Legt ein Thema an oder gibt das vorhandene zurück.
 *
 * Gibt es den Schlüssel im Fach schon, entsteht nichts Neues; zeigt der
 * Treffer auf ein anderes Thema, kommt dieses zurück. Ein Titel ohne Fachwort
 * wird abgelehnt und nicht stillschweigend angelegt — „Übungen" ist kein
 * Thema, sondern das, was man damit macht.
 *
 * **Was zurückkommt, ist immer ein eigenständiges Thema und nie ein Alias.**
 * Beide Zweige halten das: eine frisch angelegte Zeile ist noch in keine andere
 * gelegt, und eine gefundene geht in `ensureVocabulary()` durch
 * `resolveTopic()`. Getragen wird die Zusage also von `ensureVocabulary()`, und
 * sie gilt für `ensureTopics()` genauso — dort steht sie noch einmal, weil sich
 * @/lib/materials darauf stützt. Wer `ensureVocabulary()` ändert, hält sie oder
 * geht beide Wege durch.
 */
export async function ensureTopic(
  userId: string,
  subjectId: string,
  title: string,
  options?: { origin?: TopicOrigin; seenAt?: string },
): Promise<SubjectTopic | null> {
  if (!(await ownsSubject(userId, subjectId))) return null;

  const { origin, seenAt } = topicDefaults(options);

  return ensureVocabulary(userId, subjectId, title, origin, seenAt);
}

/**
 * Dasselbe für mehrere Titel desselben Fachs: die Antworten stehen in der
 * Reihenfolge der Titel, mit einem `null` an jeder Stelle, aus der kein Thema
 * wird.
 *
 * Der einzige Unterschied zu `ensureTopic()` je Titel ist die Fachprüfung. Sie
 * hängt allein am Fach und fällt für alle Titel gleich aus; einmal gefragt
 * statt vierzigmal sind bei einem Blatt voller Themen neununddreißig Wege zur
 * Datenbank weniger, die alle dieselbe Antwort geholt hätten.
 *
 * Angelegt wird trotzdem ein Titel nach dem anderen und nicht alle zugleich:
 * zwei Schreibweisen können denselben Schlüssel treffen, und dann soll die
 * zweite das Thema der ersten bekommen. Genau das tut `ensureVocabulary()`
 * über seinen Konflikt-Zweig — aber nur, wenn die erste schon geschrieben hat.
 *
 * **Was zurückkommt, ist immer ein eigenständiges Thema und nie ein Alias** —
 * dieselbe Zusage wie bei `ensureTopic()`, und aus demselben Grund: beide gehen
 * durch `ensureVocabulary()`, das eine gefundene Zeile über `resolveTopic()`
 * schickt. Genau darauf stützt sich `setMaterialTopics()` in @/lib/materials
 * und spart je Thema eine Abfrage. Wer hier den Rumpf ändert — etwa auf einen
 * gebündelten Insert —, hält die Zusage oder löst beim Aufrufer selbst auf;
 * sonst stünden Alias-ids in `material_topics`, und die Regel im Kopf dieser
 * Datei wäre gebrochen.
 */
export async function ensureTopics(
  userId: string,
  subjectId: string,
  titles: string[],
  options?: { origin?: TopicOrigin; seenAt?: string },
): Promise<(SubjectTopic | null)[]> {
  if (!(await ownsSubject(userId, subjectId))) return titles.map(() => null);

  const { origin, seenAt } = topicDefaults(options);
  const found: (SubjectTopic | null)[] = [];

  for (const title of titles) {
    found.push(await ensureVocabulary(userId, subjectId, title, origin, seenAt));
  }

  return found;
}

/**
 * Ändert die Anzeigeform genau der genannten Zeile — und damit auch ihren
 * Schlüssel.
 *
 * Dass der Schlüssel mitwandert, ist Absicht: nach der Umbenennung soll die
 * neue Schreibweise auf dieses Thema treffen. Die alte trifft dann nichts mehr
 * und legt beim nächsten Mal eine neue Vokabel an; wer beide zusammenhalten
 * will, legt sie zusammen.
 *
 * Die id wird hier **nicht** aufgelöst — die zweite der beiden Ausnahmen von
 * der Regel im Kopf der Datei. Eine Alias-Zeile ist eine Schreibweise, und wer
 * eine Schreibweise umbenennt, meint die Schreibweise: er hat sich vertippt.
 * Würde aufgelöst, änderte das Tippen in der Alias-Zeile den Titel des
 * kanonischen Themas — die falsche Schreibweise stünde unverändert da, das
 * richtige Thema hieße plötzlich anders, und sein Schlüssel wanderte mit, so
 * dass die bisherige Schreibweise beim nächsten Verknüpfen eine zweite Vokabel
 * anlegte. Daneben in derselben Zeile steht `unmergeTopic()`, das schon immer
 * genau diese Zeile meint; zwei Schaltflächen einer Zeile dürfen nicht auf
 * verschiedene Zeilen zielen.
 *
 * Drei Fälle enden hier ausdrücklich mit einem Fehler statt mit einem stillen
 * Nichtstun: ein Titel ohne Fachwort, ein Schlüssel, den es im Fach schon gibt,
 * und ein Schlüssel, der genau auf das Ziel der eigenen Zusammenlegung fällt.
 * Der letzte ist der Preis dafür, dass es jeden Schlüssel je Fach nur einmal
 * gibt: „Kettenregle" kann nicht in „Kettenregel" umbenannt werden, solange
 * beide Zeilen dastehen. Alle drei sind Entscheidungen, die der Mensch treffen
 * muss. Die beiden letzten fängt die Suche nach dem vorhandenen Schlüssel ab,
 * damit daraus ein lesbarer Satz wird und kein Verstoß gegen den eindeutigen
 * Schlüssel, den die Datenbank als Laufzeitfehler zurückwirft.
 */
export async function renameTopic(
  userId: string,
  id: string,
  title: string,
): Promise<void> {
  if (!isId(id)) return;

  const topic = await findById(userId, id);
  if (!topic) return;

  const [cleaned] = normalizeTopics([title]);
  if (!cleaned) {
    throw new Error("Ein Thema braucht einen Titel.");
  }

  const matchKey = vocabularyKey(cleaned);
  if (!matchKey) {
    throw new Error(`Aus „${cleaned}" wird kein Thema — es fehlt ein Fachwort.`);
  }

  if (cleaned === topic.title && matchKey === topic.matchKey) return;

  const clash = await findByKey(userId, topic.subjectId, matchKey);
  if (clash && clash.id !== topic.id) {
    if (clash.id === topic.mergedInto) {
      throw new Error(
        `Diese Schreibweise zeigt schon auf „${clash.title}" — genauso heißen kann sie nicht. Trenn sie erst wieder ab.`,
      );
    }

    throw new Error(
      `„${clash.title}" gibt es in diesem Fach schon — leg die beiden lieber zusammen.`,
    );
  }

  await db
    .update(subjectTopics)
    .set({ title: cleaned, matchKey })
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, topic.id)));
}

/**
 * Legt das erste Thema in das zweite.
 *
 * Gegen Kreise (A in B, dann B in A) und gegen „sich selbst" schützt genau
 * eine Zeile: beide Seiten werden zuerst aufgelöst und danach verglichen.
 * Zeigt B schon irgendwo auf A, endet die Auflösung von B bei A — die ids sind
 * dann gleich und es passiert nichts.
 *
 * Die Aliasse des gefalteten Themas werden mitgezogen, damit ein Alias nie auf
 * einen Alias zeigt. Der Preis dafür ist ehrlich zu benennen: eine spätere
 * Trennung gibt das Thema zurück, seine früheren Schreibweisen bleiben aber
 * beim Ziel. Zurückgenommen wird ein Schritt, nicht die Vorgeschichte.
 */
export async function mergeTopics(
  userId: string,
  fromId: string,
  intoId: string,
): Promise<void> {
  const [from, into] = await Promise.all([
    resolveTopic(userId, fromId),
    resolveTopic(userId, intoId),
  ]);

  if (!from || !into) return;
  if (from.id === into.id) return;

  if (from.subjectId !== into.subjectId) {
    throw new Error("Zwei Themen aus verschiedenen Fächern gehören nicht zusammen.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(subjectTopics)
      .set({ mergedInto: into.id })
      .where(
        and(
          eq(subjectTopics.userId, userId),
          eq(subjectTopics.mergedInto, from.id),
        ),
      );

    await tx
      .update(subjectTopics)
      .set({ mergedInto: into.id })
      .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, from.id)));

    // Das Ziel erbt den jüngeren Tag, sonst rutschte es in den Vorschlägen
    // hinter die Schreibweise, die es gerade aufgenommen hat. Der Tag wandert
    // dabei nur nach vorn — zurückdrehen würde Geschichte verlieren.
    if (from.lastSeenAt > into.lastSeenAt) {
      await tx
        .update(subjectTopics)
        .set({ lastSeenAt: from.lastSeenAt })
        .where(
          and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, into.id)),
        );
    }
  });
}

/**
 * Nimmt eine Zusammenlegung zurück: die Spalte wird wieder geleert, die Zeile
 * stand ja die ganze Zeit da und hat ihren Schlüssel behalten.
 *
 * Die einzige Stelle, die eine id **nicht** auflöst — und der Grund steht oben
 * im Kopf der Datei: gemeint ist genau diese Alias-Zeile. Wer hier auflöste,
 * träfe das Ziel und machte aus einer Trennung ein Nichts.
 */
export async function unmergeTopic(userId: string, id: string): Promise<void> {
  if (!isId(id)) return;

  await db
    .update(subjectTopics)
    .set({ mergedInto: null })
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, id)));
}

/**
 * Folgt der Zusammenlegung bis zum eigenständigen Thema.
 *
 * Nach spätestens `MAX_ALIAS_HOPS` Schritten hört die Suche auf und gibt
 * zurück, wo sie steht. Das kann nur eine von Hand verbogene Kette sein; eine
 * Liste, die dann ein Alias zeigt, ist immer noch besser als eine Seite, die
 * sich aufhängt.
 */
export async function resolveTopic(
  userId: string,
  id: string,
): Promise<SubjectTopic | null> {
  if (!isId(id)) return null;

  let current = await findById(userId, id);
  if (!current) return null;

  for (let hop = 0; current.mergedInto && hop < MAX_ALIAS_HOPS; hop += 1) {
    const next = await findById(userId, current.mergedInto);
    // Der Fremdschlüssel steht auf „set null" — ein gelöschtes Ziel leert die
    // Spalte. Ins Leere zeigen kann sie also nicht; wenn doch, gilt das, was
    // wir in der Hand haben.
    if (!next) return current;
    current = next;
  }

  return current;
}

/**
 * Die Themen, die für eine Prüfung in Frage kommen — das zuletzt gesehene
 * zuerst.
 *
 * Das Fenster beginnt bei der letzten Prüfung desselben Fachs vor diesem
 * Termin, denn genau das ist der Stoff, der seitdem drankam: was davor lag,
 * wurde schon einmal geschrieben. Der Tag der letzten Prüfung zählt dabei mit
 * und wird nicht ausgeklammert. Das ist keine Nachlässigkeit, sondern der
 * Punkt: ins Vokabular kommt ein Thema über eine Prüfung oder von Hand, seine
 * `lastSeenAt` steht also auf dem Tag der letzten Klausur, in der es vorkam.
 * Wer diesen Tag ausschlösse, bekäme fast immer eine leere Liste — und zwar
 * genau dann, wenn die Vorschläge helfen sollen. Aufeinander aufbauende
 * Klausuren sind ohnehin die Regel.
 *
 * Gibt es keine frühere Prüfung, greifen die letzten 90 Tage. Ein Halbjahr
 * wäre zu viel: es käme das ganze Fach zurück, und eine Liste, in der alles
 * steht, schlägt nichts mehr vor.
 *
 * Der Beginn wird zusätzlich am heutigen Tag gedeckelt, und ohne das wäre die
 * Liste in genau den Fällen leer, für die sie gebaut ist. `lastSeenAt` kann
 * höchstens auf heute stehen; ein Fenster, das in der Zukunft beginnt, trifft
 * garantiert nichts. In die Zukunft rutscht es, sobald der Termin weiter als
 * 90 Tage voraus liegt — im September die Klausur im Dezember eintragen —, und
 * ebenso, wenn die „letzte" Prüfung selbst noch vorausgeplant ist. Ein Anker in
 * der Zukunft sagt nichts darüber, was seitdem drankam; dann gilt dasselbe
 * Rückfallfenster wie ohne Vorgänger, gerechnet ab heute.
 *
 * Heute kommt als Parameter herein und nicht aus der Systemuhr — dieselbe
 * Regel wie in @/lib/dates, und der Grund, warum sich der Fall überhaupt
 * prüfen lässt.
 */
export async function suggestTopicsForExam(
  userId: string,
  subjectId: string,
  examDate: string,
  today: string = todayInBerlin(),
): Promise<TopicItem[]> {
  if (!isCalendarDate(examDate)) return [];
  if (!isCalendarDate(today)) return [];
  if (!isId(subjectId)) return [];

  const [previous] = await db
    .select({ date: exams.date })
    .from(exams)
    .where(
      and(
        eq(exams.userId, userId),
        eq(exams.subjectId, subjectId),
        lt(exams.date, examDate),
      ),
    )
    .orderBy(desc(exams.date))
    .limit(1);

  const anchor = previous
    ? previous.date
    : addDays(examDate, -SUGGEST_FALLBACK_DAYS);

  const since =
    anchor <= today ? anchor : addDays(today, -SUGGEST_FALLBACK_DAYS);

  return listTopics(userId, subjectId, { since });
}

/**
 * Hängt die Themen einer Prüfung an das Vokabular des Fachs — additiv.
 *
 * Angefasst wird ausschließlich `exam_topics.subject_topic_id`. Zwei Fälle
 * kommen dran: die noch leere Spalte, und der Verweis, der nach einem
 * Fachwechsel der Prüfung in ein fremdes Fach zeigt.
 *
 * Der zweite ist die einzige Stelle dieser Datei, an der etwas überschrieben
 * wird, und ohne sie verschwände eine Klausur lautlos aus beiden Fächern:
 * stellt jemand seine Prüfung von Mathe auf Physik um, zeigen ihre Themen
 * weiter auf Mathe-Vokabeln. Gezählt werden sie danach nirgends mehr — für
 * Mathe nicht, weil die Prüfung im Fach Physik liegt, und für Physik nicht,
 * weil die Vokabel im Fach Mathe steht. Umgehängt wird deshalb auf die Vokabel
 * des jetzigen Fachs, die dabei entsteht, falls es sie dort noch nicht gibt.
 * Die alte Vokabel bleibt stehen, wo sie steht: sie gehört dem alten Fach und
 * wird dort weiter gebraucht.
 *
 * Ein schon gesetzter Verweis auf eine zusammengelegte Schreibweise DESSELBEN
 * Fachs bleibt dagegen unberührt. Aliasse werden beim Lesen aufgelöst, und ein
 * Umschreiben würde eine spätere Trennung um ihre Wirkung bringen.
 *
 * Fehlende Vokabeln entstehen dabei. Ein Klausurthema ohne Fachwort behält
 * seine leere Spalte — es steht weiter in der Prüfung, es steht nur in keinem
 * Verzeichnis. Zeigt so eines nach einem Fachwechsel ins fremde Fach, bleibt
 * sein Verweis stehen: umhängen ließe er sich nur auf eine Vokabel, die es zu
 * diesem Titel nicht geben kann, und gelöscht wird hier nichts.
 *
 * Wer eine Prüfung speichert, ruft das hier auf — nach jedem Speichern und
 * nicht nur beim ersten. `updateExam()` und `setTopics()` in @/lib/exams
 * wissen nichts vom Vokabular; ohne diesen Aufruf bleibt ein Fachwechsel
 * unrepariert und ein neu eingetipptes Thema ohne Eintrag.
 */
export async function linkExamTopics(
  userId: string,
  examId: string,
): Promise<void> {
  if (!isId(examId)) return;

  await linkPending(userId, await loadPending(userId, examId));
}

/**
 * Einmaliger Aufbau des Vokabulars aus allem, was schon eingetragen ist.
 *
 * Mehrfach aufrufbar: gefüllt werden nur leere Verweise, umgehängt nur
 * fachfremde, angelegt nur fehlende Vokabeln — ein zweiter Durchlauf meldet
 * lauter Nullen.
 *
 * `lastSeenAt` steht hinterher auf dem jüngsten Termin, in dem das Thema
 * vorkam: der Tag entsteht im Speicher als der größte über alle Posten
 * desselben Schlüssels und wandert beim Schreiben trotzdem nur nach vorn.
 * Treffen zwei Schreibweisen auf denselben Schlüssel, gewinnt als Anzeigeform
 * die der früheren Prüfung — deshalb kommen die Posten nach Datum sortiert
 * herein.
 *
 * Gebündelt und in einer Transaktion, nicht Prüfung für Prüfung. Ein
 * Schuljahr mit 60 Klausuren zu je acht Themen sind rund 480 Posten; einzeln
 * abgefragt wären das ein paar tausend Wege zur Datenbank, gegen ein Postgres
 * in der Cloud eine halbe Minute und mehr — länger, als eine Serverless-
 * Funktion leben darf, und ein Abbruch mitten im Aufbau. Stattdessen: eine
 * Abfrage für alle Posten, eine für das vorhandene Vokabular, ein Einfügen für
 * alle fehlenden Vokabeln und ein Update für alle Verweise. Es ist dieselbe
 * Entscheidungslogik wie beim Verknüpfen einer einzelnen Prüfung, weil beide
 * Wege durch dieselbe Funktion laufen — nur mit verschieden vielen Zeilen.
 */
export async function seedTopicsFromExams(userId: string): Promise<SeedResult> {
  return linkPending(userId, await loadPending(userId));
}

/**
 * Die Klausurzahl je Thema als eigene Abfrage, gruppiert auf das eigenständige
 * Thema: die Klausuren einer zusammengelegten Schreibweise zählen beim Ziel
 * mit, weil ihre Verweise beim Zusammenlegen absichtlich stehen bleiben.
 *
 * `count(distinct exam_id)`, damit zwei gleich benannte Posten derselben
 * Prüfung nicht zu zwei Klausuren werden. Der Verbund über `exams` filtert
 * zusätzlich nach Nutzer und bindet das Fach der Prüfung an das Fach der
 * Vokabel — gezählt wird nur, was wirklich zu diesem Fach gehört.
 *
 * `scope` sagt, um welche Fächer es überhaupt geht: um ein einzelnes bei
 * `listTopics()`, um mehrere bei `listTopicsForSubjects()`. Es ist dieselbe
 * Bedingung, die auch die äußere Abfrage einschränkt — die Zählung soll nicht
 * über Zeilen laufen, die danach ohnehin niemand ansieht.
 */
function examCounts(userId: string, scope: SQL) {
  const target = sql`coalesce(${subjectTopics.mergedInto}, ${subjectTopics.id})`;

  return db
    .select({
      topicId: target.as("topic_id"),
      examCount: sql<number>`cast(count(distinct ${examTopics.examId}) as int)`.as(
        "exam_count",
      ),
    })
    .from(examTopics)
    .innerJoin(subjectTopics, eq(subjectTopics.id, examTopics.subjectTopicId))
    .innerJoin(
      exams,
      and(
        eq(exams.id, examTopics.examId),
        eq(exams.userId, userId),
        eq(exams.subjectId, subjectTopics.subjectId),
      ),
    )
    .where(and(eq(subjectTopics.userId, userId), scope))
    .groupBy(target)
    .as("exam_counts");
}

/**
 * Dieselbe Zählung für die abfotografierten Blätter — Zeile für Zeile nach
 * demselben Muster wie `examCounts()`, und aus denselben Gründen.
 *
 * Gruppiert wird wieder auf das eigenständige Thema: die Blätter einer
 * zusammengelegten Schreibweise zählen beim Ziel mit. Das ist die Regel aus
 * dem Kopf dieser Datei, hier als `coalesce` in SQL statt als `resolveTopic()`
 * je Thema — dreißig Themen wären sonst dreißig zusätzliche Abfragen.
 *
 * `count(distinct material_id)`, damit ein Blatt, an dem nach einer
 * Zusammenlegung beide Schreibweisen hängen, nicht als zwei Blätter zählt.
 * Der Verbund über `materials` filtert zusätzlich nach Nutzer und bindet das
 * Fach des Blattes an das Fach der Vokabel — gezählt wird nur, was wirklich zu
 * diesem Fach gehört. Über die App kann ein Blatt gar kein Thema aus einem
 * anderen Fach tragen (`updateMaterial()` löst die Paarungen beim Fachwechsel
 * auf); die Bedingung steht trotzdem da, damit eine von Hand geschriebene
 * Zeile die Zahl nicht aufbläht.
 *
 * Die Schlüsselspalte heißt hier `material_topic_id` und nicht wie drüben
 * `topic_id`. Das ist kein Geschmack: beide Zählungen hängen in derselben
 * Abfrage als LEFT JOIN am selben `subject_topics`, und Drizzle schreibt die
 * Bedingung eines Verbunds auf eine Unterabfrage OHNE deren Namen davor —
 * `on "topic_id" = "subject_topics"."id"`. Hießen beide Spalten gleich, wüsste
 * Postgres nicht, welche gemeint ist, und wiese die Abfrage mit
 * „column reference \"topic_id\" is ambiguous" zurück. Wer hier umbenennt,
 * benennt drüben mit um.
 */
function materialCounts(userId: string, scope: SQL) {
  const target = sql`coalesce(${subjectTopics.mergedInto}, ${subjectTopics.id})`;

  return db
    .select({
      topicId: target.as("material_topic_id"),
      materialCount:
        sql<number>`cast(count(distinct ${materialTopics.materialId}) as int)`.as(
          "material_count",
        ),
    })
    .from(materialTopics)
    .innerJoin(
      subjectTopics,
      eq(subjectTopics.id, materialTopics.subjectTopicId),
    )
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialTopics.materialId),
        eq(materials.userId, userId),
        eq(materials.subjectId, subjectTopics.subjectId),
      ),
    )
    .where(and(eq(subjectTopics.userId, userId), scope))
    .groupBy(target)
    .as("material_counts");
}

/**
 * Themen samt Klausur- und Blattzahl in einer einzigen Abfrage. Eine Zählung
 * pro Thema wäre bei dreißig Themen dreißig Wege zur Datenbank für dieselbe
 * Liste; zwei getrennte Listen wären zwei Wege für dieselbe Zeile.
 *
 * Sortiert wird nach dem zuletzt gesehenen Tag; bei Gleichstand entscheidet der
 * Titel, damit die Reihenfolge zwischen zwei Aufrufen nicht springt.
 *
 * `scope` grenzt die Fächer ein, `extra` alles Weitere (Zusammenlegungen,
 * Zeitfenster). Der gemeinsame Rumpf ist der Grund, warum `listTopics()` und
 * `listTopicsForSubjects()` Fach für Fach dasselbe liefern.
 */
async function topicsWithCounts(
  userId: string,
  scope: SQL,
  extra: SQL | undefined,
): Promise<TopicItem[]> {
  const counts = examCounts(userId, scope);
  const sheets = materialCounts(userId, scope);

  const rows = await db
    .select({
      topic: subjectTopics,
      examCount: counts.examCount,
      materialCount: sheets.materialCount,
    })
    .from(subjectTopics)
    .leftJoin(counts, eq(counts.topicId, subjectTopics.id))
    .leftJoin(sheets, eq(sheets.topicId, subjectTopics.id))
    .where(and(eq(subjectTopics.userId, userId), scope, extra))
    .orderBy(desc(subjectTopics.lastSeenAt), asc(subjectTopics.title));

  // Beide Verbünde sind LEFT JOINs: ein Thema ohne jede Klausur und ein Thema
  // ohne jedes Blatt haben keine Zeile in ihrer Zählung und kommen als null
  // zurück — das ist die jeweilige Null. Ein Thema kann in der einen Zählung
  // stehen und in der anderen fehlen; deshalb zwei Verbünde und nicht einer.
  return rows.map((row) => ({
    ...row.topic,
    examCount: Number(row.examCount ?? 0),
    materialCount: Number(row.materialCount ?? 0),
  }));
}

/**
 * Ob aus einem Titel überhaupt ein Thema wird — und wie es dann heißt.
 *
 * Die eine Stelle, die diese Frage beantwortet. Der Einzelweg
 * (`ensureVocabulary()`) und der gebündelte Weg (`linkPending()`) fragen hier;
 * zwei Fassungen derselben Regel wären genau die Art von Doppelung, bei der
 * später zwei Türen verschieden entscheiden. Beides ist reine Rechnung aus
 * @/lib/topics und braucht keine Datenbank — deshalb lässt sich der Schlüssel
 * auch für tausend Posten im Speicher bilden.
 */
function topicCandidate(
  title: string,
): { title: string; matchKey: string } | null {
  // Zuschneiden nach denselben Regeln wie überall: getrimmt, gekürzt, ohne
  // Leerzeilen. Was danach kein Fachwort mehr enthält, ist kein Thema.
  const [cleaned] = normalizeTopics([title]);
  if (!cleaned) return null;

  const matchKey = vocabularyKey(cleaned);
  if (!matchKey) return null;

  return { title: cleaned, matchKey };
}

/**
 * Herkunft und „zuletzt gesehen", wie `ensureTopic()` und `ensureTopics()` sie
 * verstehen: was nicht als Herkunft vorgesehen oder kein Kalendertag ist, fällt
 * auf die Vorgabe zurück, statt so in die Spalte zu geraten.
 *
 * Beide Wege fragen hier, damit ein Titel einzeln und im Bündel unter denselben
 * Werten landet.
 */
function topicDefaults(options?: { origin?: TopicOrigin; seenAt?: string }): {
  origin: TopicOrigin;
  seenAt: string;
} {
  return {
    origin:
      options?.origin && isOrigin(options.origin) ? options.origin : "klausur",
    seenAt:
      options?.seenAt && isCalendarDate(options.seenAt)
        ? options.seenAt
        : todayInBerlin(),
  };
}

/**
 * Legt eine einzelne Vokabel an oder gibt die vorhandene zurück — der Kern von
 * `ensureTopic()`, also des Wegs, auf dem ein Mensch ein Thema von Hand
 * einträgt.
 *
 * Der eindeutige Schlüssel (Fach und `matchKey`) ist eine Zusage der Datenbank,
 * und damit auch die Stelle, an der zwei gleichzeitige Aufrufe aufeinander
 * treffen. Deshalb `onConflictDoNothing()` und danach neu lesen, statt den
 * Constraint als Laufzeitfehler hochschlagen zu lassen: wer zweiter ist,
 * bekommt das Thema des ersten.
 */
async function ensureVocabulary(
  userId: string,
  subjectId: string,
  title: string,
  origin: TopicOrigin,
  seenAt: string,
): Promise<SubjectTopic | null> {
  const candidate = topicCandidate(title);
  if (!candidate) return null;

  const [created] = await db
    .insert(subjectTopics)
    .values({
      userId,
      subjectId,
      title: candidate.title,
      matchKey: candidate.matchKey,
      origin,
      lastSeenAt: seenAt,
    })
    .onConflictDoNothing({
      target: [subjectTopics.subjectId, subjectTopics.matchKey],
    })
    .returning();

  // Eine eben erst angelegte Zeile ist noch in keine andere gelegt und damit
  // schon aufgelöst — hier hält der erste Zweig die Zusage von `ensureTopic()`.
  if (created) return created;

  const existing = await findByKey(userId, subjectId, candidate.matchKey);
  // Ohne Treffer wäre die Zeile zwischen Einfügen und Lesen gelöscht worden.
  // Dann lieber nichts zurückgeben als raten.
  if (!existing) return null;

  const topic = await resolveTopic(userId, existing.id);
  if (!topic) return null;

  return advanceLastSeen(userId, topic, seenAt);
}

/**
 * Schiebt den zuletzt gesehenen Tag nach vorn, nie zurück.
 *
 * Das Zurückdrehen zu verbieten ist der Grund, warum ein Nachtrag alter
 * Klausuren die Vorschlagsliste nicht durcheinanderbringt: ein Thema, das im
 * Mai drankam, bleibt auf Mai, auch wenn im August eine Prüfung vom Januar
 * nachgetragen wird.
 */
async function advanceLastSeen(
  userId: string,
  topic: SubjectTopic,
  seenAt: string,
): Promise<SubjectTopic> {
  if (seenAt <= topic.lastSeenAt) return topic;

  const [updated] = await db
    .update(subjectTopics)
    .set({ lastSeenAt: seenAt })
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, topic.id)))
    .returning();

  return updated ?? topic;
}

/**
 * Ein Klausurthema, das auf das Vokabular wartet: entweder ist sein Verweis
 * leer, oder er zeigt seit einem Fachwechsel der Prüfung in ein fremdes Fach.
 */
type PendingTopic = {
  id: string;
  examId: string;
  title: string;
  /** Das Fach, in dem die Prüfung **jetzt** liegt */
  subjectId: string;
  examDate: string;
  /** Der Verweis, wie er beim Laden dastand — leer oder fachfremd */
  from: string | null;
};

/**
 * Lädt in einer einzigen Abfrage alles, was drankommt: für eine Prüfung, wenn
 * `examId` dabeisteht, sonst für das ganze Schuljahr.
 *
 * Die zweite Hälfte der Bedingung ist die Reparatur nach einem Fachwechsel:
 * ein Verweis, dessen Vokabel in einem anderen Fach steht als die Prüfung. Der
 * äußere Verbund muss ein `leftJoin` sein, weil die erste Hälfte gerade die
 * Posten meint, die gar keinen Verweis haben.
 *
 * Beide Verbunde filtern zusätzlich nach `userId` — `exam_topics` selbst hat
 * keine solche Spalte, der Besitz hängt an der Prüfung und deren Fach.
 */
async function loadPending(
  userId: string,
  examId?: string,
): Promise<PendingTopic[]> {
  return db
    .select({
      id: examTopics.id,
      examId: examTopics.examId,
      title: examTopics.title,
      subjectId: exams.subjectId,
      examDate: exams.date,
      from: examTopics.subjectTopicId,
    })
    .from(examTopics)
    .innerJoin(
      exams,
      and(eq(exams.id, examTopics.examId), eq(exams.userId, userId)),
    )
    .innerJoin(
      subjects,
      and(eq(subjects.id, exams.subjectId), eq(subjects.userId, userId)),
    )
    .leftJoin(
      subjectTopics,
      and(
        eq(subjectTopics.id, examTopics.subjectTopicId),
        eq(subjectTopics.userId, userId),
      ),
    )
    .where(
      and(
        examId ? eq(examTopics.examId, examId) : undefined,
        or(
          isNull(examTopics.subjectTopicId),
          ne(subjectTopics.subjectId, exams.subjectId),
        ),
      ),
    )
    // Nach Datum, damit bei zwei Schreibweisen desselben Schlüssels die
    // Anzeigeform der früheren Prüfung gewinnt.
    .orderBy(asc(exams.date), asc(examTopics.sortOrder));
}

/**
 * Verknüpft eine ganze Ladung wartender Posten mit dem Vokabular ihrer Fächer.
 *
 * Der gemeinsame Weg von `linkExamTopics()` und `seedTopicsFromExams()` — eine
 * Prüfung ist hier nur eine kürzere Liste als ein Schuljahr. Ein zweiter Weg
 * durch dieselben Daten wäre die Stelle, an der später zwei Türen verschieden
 * entscheiden.
 *
 * Vier Schritte, und keiner davon je Posten:
 *
 * 1. Die Schlüssel entstehen im Speicher; `vocabularyKey()` ist reine Rechnung.
 * 2. Das vorhandene Vokabular der beteiligten Fächer kommt in einer Abfrage —
 *    vollständig, damit auch Zusammenlegungen ohne weitere Abfrage aufgelöst
 *    werden können.
 * 3. Alle fehlenden Vokabeln entstehen in einem Einfügen.
 * 4. Alle Verweise werden in einer Anweisung gesetzt.
 *
 * Geschrieben wird in einer Transaktion. Ein Abbruch mittendrin hinterließe
 * sonst ein halb aufgebautes Vokabular, und der nächste Versuch bräuchte
 * genauso lange wie der erste.
 */
async function linkPending(
  userId: string,
  pending: PendingTopic[],
): Promise<SeedResult> {
  /** Alles, was in einem Fach unter einem Schlüssel zusammenkommt. */
  type Wanted = {
    subjectId: string;
    title: string;
    matchKey: string;
    lastSeenAt: string;
    rows: PendingTopic[];
  };

  const wanted = new Map<string, Wanted>();
  const subjectIds = new Set<string>();

  for (const row of pending) {
    subjectIds.add(row.subjectId);

    // Ob ein Titel überhaupt ein Thema ist, entscheidet ausschließlich
    // `topicCandidate()`. Ein Posten ohne Fachwort behält seine leere Spalte.
    const candidate = topicCandidate(row.title);
    if (!candidate) continue;

    const key = vocabularyIndex(row.subjectId, candidate.matchKey);
    const entry = wanted.get(key);

    if (!entry) {
      wanted.set(key, {
        subjectId: row.subjectId,
        title: candidate.title,
        matchKey: candidate.matchKey,
        lastSeenAt: row.examDate,
        rows: [row],
      });
      continue;
    }

    // Die Anzeigeform der ersten Prüfung bleibt stehen, der Tag dagegen ist
    // der jüngste von allen — genau das, was ein Durchlauf Prüfung für
    // Prüfung hinterlassen hätte.
    entry.rows.push(row);
    if (row.examDate > entry.lastSeenAt) entry.lastSeenAt = row.examDate;
  }

  if (wanted.size === 0) return { angelegt: 0, verknuepft: 0, umgehaengt: 0 };

  const vocabulary = await db
    .select()
    .from(subjectTopics)
    .where(
      and(
        eq(subjectTopics.userId, userId),
        inArray(subjectTopics.subjectId, [...subjectIds]),
      ),
    );

  const byId = new Map<string, SubjectTopic>();
  const byKey = new Map<string, SubjectTopic>();

  function remember(topic: SubjectTopic): void {
    byId.set(topic.id, topic);
    byKey.set(vocabularyIndex(topic.subjectId, topic.matchKey), topic);
  }

  for (const topic of vocabulary) remember(topic);

  const isMissing = (entry: Wanted): boolean =>
    !byKey.has(vocabularyIndex(entry.subjectId, entry.matchKey));

  return db.transaction(async (tx) => {
    let angelegt = 0;

    const missing = [...wanted.values()].filter(isMissing);

    for (const part of chunks(missing)) {
      const created = await tx
        .insert(subjectTopics)
        .values(
          part.map((entry) => ({
            userId,
            subjectId: entry.subjectId,
            title: entry.title,
            matchKey: entry.matchKey,
            origin: "klausur" as TopicOrigin,
            lastSeenAt: entry.lastSeenAt,
          })),
        )
        // Der eindeutige Schlüssel (Fach und `matchKey`) ist die Stelle, an der
        // zwei gleichzeitige Aufrufe aufeinandertreffen. Wer zweiter ist,
        // bekommt das Thema des ersten, statt an einem Laufzeitfehler zu
        // scheitern.
        .onConflictDoNothing({
          target: [subjectTopics.subjectId, subjectTopics.matchKey],
        })
        .returning();

      angelegt += created.length;
      for (const topic of created) remember(topic);
    }

    // Was der Konflikt verschluckt hat, wird nachgelesen — wieder gebündelt
    // und nicht Fall für Fall.
    for (const part of chunks(missing.filter(isMissing))) {
      const rows = await tx
        .select()
        .from(subjectTopics)
        .where(
          and(
            eq(subjectTopics.userId, userId),
            inArray(subjectTopics.subjectId, [
              ...new Set(part.map((entry) => entry.subjectId)),
            ]),
            inArray(
              subjectTopics.matchKey,
              part.map((entry) => entry.matchKey),
            ),
          ),
        );

      for (const topic of rows) remember(topic);
    }

    const links: { row: PendingTopic; topicId: string }[] = [];
    /** Je Ziel-Thema der Tag, auf den es vorrücken soll. */
    const advance = new Map<string, string>();

    for (const entry of wanted.values()) {
      const found = byKey.get(vocabularyIndex(entry.subjectId, entry.matchKey));
      // Ohne Zeile wäre sie zwischen Einfügen und Nachlesen wieder
      // verschwunden. Dann bleibt der Posten lose; beim nächsten Aufruf klappt
      // es, denn er lädt genau die noch leeren Verweise.
      if (!found) continue;

      const target = followAlias(byId, found.id);
      // Über die App kann eine Zusammenlegung die Fachgrenze nicht überschreiten
      // (`mergeTopics()` lehnt das ab). Käme sie von Hand doch zustande, legten
      // wir hier gerade den fachfremden Verweis an, den wir reparieren wollen.
      if (!target || target.subjectId !== entry.subjectId) continue;

      for (const row of entry.rows) links.push({ row, topicId: target.id });

      const current = advance.get(target.id) ?? target.lastSeenAt;
      if (entry.lastSeenAt > current) advance.set(target.id, entry.lastSeenAt);
    }

    // Ein Update je Tag statt eines je Thema. Das `lt` beim Schreiben
    // wiederholt, was die Rechnung im Speicher schon weiß: der Tag wandert nur
    // nach vorn — auch dann, wenn ihn inzwischen ein anderer Aufruf
    // weitergeschoben hat.
    const byDate = new Map<string, string[]>();
    for (const [topicId, date] of advance) {
      const list = byDate.get(date);
      if (list) list.push(topicId);
      else byDate.set(date, [topicId]);
    }

    for (const [date, ids] of byDate) {
      for (const part of chunks(ids)) {
        await tx
          .update(subjectTopics)
          .set({ lastSeenAt: date })
          .where(
            and(
              eq(subjectTopics.userId, userId),
              inArray(subjectTopics.id, part),
              lt(subjectTopics.lastSeenAt, date),
            ),
          );
      }
    }

    let verknuepft = 0;
    let umgehaengt = 0;

    for (const part of chunks(links)) {
      // Ein einziges Update für das ganze Bündel: welcher Posten welchen
      // Verweis bekommt, steht als `case` in der Zuweisung. Der `else`-Zweig
      // greift nie — die Bedingung unten lässt nur die aufgezählten Zeilen
      // durch —, er gibt dem Ausdruck aber den Typ der Spalte.
      const value = sql.join(
        [
          sql`case`,
          ...part.map(
            (link) =>
              sql`when ${examTopics.id} = ${link.row.id}::uuid then ${link.topicId}::uuid`,
          ),
          sql`else ${examTopics.subjectTopicId} end`,
        ],
        sql` `,
      );

      // Die Bedingung beim Schreiben wiederholt, was beim Lesen dastand: leer
      // bleibt leer, fachfremd bleibt genau dieser fachfremde Verweis. Hat ein
      // anderer Aufruf den Posten dazwischen angefasst, trifft diese Zeile ihn
      // nicht mehr — und zählt dann auch nicht mit. Gezählt wird, was die
      // Datenbank wirklich geändert hat.
      const guard = or(
        ...part.map((link) =>
          and(
            eq(examTopics.id, link.row.id),
            eq(examTopics.examId, link.row.examId),
            link.row.from === null
              ? isNull(examTopics.subjectTopicId)
              : eq(examTopics.subjectTopicId, link.row.from),
          ),
        ),
      );
      if (!guard) continue;

      const changed = await tx
        .update(examTopics)
        .set({ subjectTopicId: value })
        .where(guard)
        .returning({ id: examTopics.id });

      const relinked = new Set(
        part
          .filter((link) => link.row.from !== null)
          .map((link) => link.row.id),
      );

      for (const row of changed) {
        if (relinked.has(row.id)) umgehaengt += 1;
        else verknuepft += 1;
      }
    }

    return { angelegt, verknuepft, umgehaengt };
  });
}

/**
 * Der Schlüssel, unter dem eine Vokabel im Speicher steht: Fach und
 * `matchKey` — genau das Paar, das die Datenbank eindeutig hält.
 *
 * Getrennt wird mit einem Nullbyte, weil es weder in einer uuid noch in einem
 * `matchKey` vorkommen kann. Mit einem Bindestrich ließen sich zwei
 * verschiedene Paare finden, die dieselbe Zeichenkette ergeben.
 */
function vocabularyIndex(subjectId: string, matchKey: string): string {
  return `${subjectId}\u0000${matchKey}`;
}

/**
 * Dasselbe wie `resolveTopic()`, nur auf schon geladenen Zeilen.
 *
 * Der gebündelte Weg hat das Vokabular der beteiligten Fächer vollständig in
 * der Hand; für jeden Schritt einer Kette noch einmal zur Datenbank zu gehen
 * wäre genau die Abfrage je Posten, die hier vermieden werden soll. Die
 * Schranke ist dieselbe und aus demselben Grund wie dort.
 */
function followAlias(
  byId: ReadonlyMap<string, SubjectTopic>,
  id: string,
): SubjectTopic | null {
  let current = byId.get(id) ?? null;
  if (!current) return null;

  for (let hop = 0; current.mergedInto && hop < MAX_ALIAS_HOPS; hop += 1) {
    const next = byId.get(current.mergedInto);
    // Zusammengelegt wird nur innerhalb eines Fachs, das Ziel ist also mit
    // geladen. Fehlt es doch, gilt das, was wir in der Hand haben.
    if (!next) return current;
    current = next;
  }

  return current;
}

/** Zerteilt eine Liste in Stücke, die als eine Anweisung durchgehen. */
function chunks<T>(list: readonly T[]): T[][] {
  const result: T[][] = [];

  for (let start = 0; start < list.length; start += MAX_ROWS_PER_STATEMENT) {
    result.push(list.slice(start, start + MAX_ROWS_PER_STATEMENT));
  }

  return result;
}

async function findById(
  userId: string,
  id: string,
): Promise<SubjectTopic | null> {
  const [topic] = await db
    .select()
    .from(subjectTopics)
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, id)))
    .limit(1);

  return topic ?? null;
}

async function findByKey(
  userId: string,
  subjectId: string,
  matchKey: string,
): Promise<SubjectTopic | null> {
  const [topic] = await db
    .select()
    .from(subjectTopics)
    .where(
      and(
        eq(subjectTopics.userId, userId),
        eq(subjectTopics.subjectId, subjectId),
        eq(subjectTopics.matchKey, matchKey),
      ),
    )
    .limit(1);

  return topic ?? null;
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
