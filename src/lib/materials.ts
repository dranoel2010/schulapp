import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { db } from "@/db";
import {
  materialPages,
  materialTopics,
  materials,
  subjectTopics,
  subjects,
} from "@/db/schema";
import { germanShortParts, isCalendarDate, todayInBerlin } from "@/lib/dates";
import {
  MAX_PAGES,
  MAX_PAGE_BYTES,
  MAX_THUMB_BYTES,
  isAllowedMime,
} from "@/lib/images";
import { ensureTopics, resolveTopic } from "@/lib/subject-topics";
import { normalizeTopics, topicKey } from "@/lib/topics";

/**
 * Abfotografierte Blätter — Validierung und Datenzugriff.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche, kein Import aus
 * Next. Verkleinert wird im Browser (siehe @/lib/images), hier kommen nur noch
 * fertige Bytes an.
 *
 * Jede Abfrage filtert zusätzlich nach userId, auch dort, wo die id schon
 * eindeutig wäre. Bei den Seiten hängt die userId nicht an der Zeile, sondern
 * am Blatt — deshalb steht in jeder Abfrage auf `material_pages` ein Join auf
 * `materials` mit `eq(materials.userId, userId)`, auch in `readPageImage()`.
 * Das ist die Stelle, an der die Bilder ausgeliefert werden; eine fehlende
 * Zeile dort hieße, dass eine geratene pageId fremde Blätter zeigt.
 *
 * **Für Listen wird `image` niemals mitselektiert.** Die Ablage holt bis zu
 * `LIST_LIMIT` Blätter auf einmal, also zweihundert; ein Vollbild wiegt nach
 * dem Verkleinern rund 250 KB, macht gut fünfzig Megabyte für eine Seite, die
 * 320 Pixel breite Bilder anzeigt. Deshalb steht in jeder
 * Abfrage hier eine ausdrückliche Feldliste und nie ein `select()` ohne
 * Argument — das holte beide bytea-Spalten mit.
 *
 * Datumsfelder sind reine Kalenderdaten als Zeichenkette ("2026-09-14"), wie
 * überall sonst im Projekt. Gerechnet wird ausschließlich in @/lib/dates.
 */

/** Länger als eine Zeile ist kein Titel mehr, sondern eine Beschreibung. */
export const MATERIAL_TITLE_MAX = 80;

/** Die Notiz ist ein Randvermerk, kein Aufsatz. */
export const MATERIAL_NOTE_MAX = 500;

/**
 * So viele Blätter kommen aus einer Abfrage höchstens zurück.
 *
 * Die Zahl ist zugleich die Grenze, an der die Nachfrage nach Seiten und
 * Themen eine einzige Anweisung bleibt: bei 200 Blättern stehen 200 Parameter
 * in der `IN`-Liste, und Postgres nimmt 65535 entgegen. Wer mehr sehen will,
 * filtert nach Fach.
 *
 * Ausgeführt, weil die Ablage sie kennen muss: eine Abfrage gibt Zeilen zurück
 * und sagt nicht, ob dahinter noch etwas liegt. Erst wer ausdrücklich nach
 * dieser Zahl fragt und genau so viele bekommt, weiß, dass er am Anschlag
 * steht — und kann es hinschreiben, statt still zu kürzen. Zweimal
 * hingeschrieben wäre die Zahl eine Falle: wird sie hier gesenkt und dort
 * vergessen, kommen weniger Zeilen zurück als gefragt und der Hinweis bliebe
 * stumm.
 */
export const LIST_LIMIT = 200;

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

export const materialInputSchema = z.object({
  subjectId: z.uuid("Zu welchem Fach gehört das Blatt?"),
  title: z
    .string("Wie soll das Blatt heißen?")
    .trim()
    .min(1, "Wie soll das Blatt heißen?")
    .max(
      MATERIAL_TITLE_MAX,
      "Der Titel ist zu lang — höchstens 80 Zeichen.",
    ),
  capturedOn: z
    .string("Von wann ist das Blatt?")
    .trim()
    .refine(isCalendarDate, "Dieses Datum gibt es nicht.")
    // Der Zukunfts-Test greift nur, wenn das Datum überhaupt lesbar ist —
    // sonst stünden zwei Meldungen an einem Feld.
    .refine(
      (value) => !isCalendarDate(value) || value <= todayInBerlin(),
      "Dieser Tag ist noch nicht gewesen.",
    ),
  note: optionalText(
    MATERIAL_NOTE_MAX,
    "Die Notiz ist zu lang — höchstens 500 Zeichen.",
  ),
});

export type MaterialInput = z.infer<typeof materialInputSchema>;

/**
 * Fehler pro Feld, so wie das Formular sie erwartet. "topics" steht mit dabei,
 * weil ein Thema abgelehnt werden kann, ohne dass an einem der vier Felder
 * etwas falsch ist.
 */
export type MaterialFieldErrors = Partial<
  Record<keyof MaterialInput | "topics", string>
>;

/** Rückgabe der Server Actions an useActionState. */
export type MaterialFormState = {
  /** Hinweis über dem Formular, wenn es nicht an einem einzelnen Feld liegt. */
  message?: string;
  /** Bestätigung nach dem Speichern. */
  notice?: string;
  errors?: MaterialFieldErrors;
  /**
   * Wie oft dieses Formular das Blatt geschrieben hat. Hochgezählt bei jedem
   * Speichern, das die Datenbank erreicht hat, und bei keinem, das vorher an
   * der Prüfung hängen geblieben ist.
   *
   * Die Zahl steht nirgends auf dem Bildschirm; sie ist das Zeichen, an dem
   * das Formular merkt, dass gespeichert wurde, und danach den nachgelieferten
   * Stand des Servers übernimmt statt seinen eigenen zu behalten. Warum es das
   * tun muss, steht in material-form.tsx.
   *
   * Ein Zähler und kein Schalter: zweimal hintereinander dasselbe zu speichern
   * muss zweimal nachziehen. „Übungen" bleibt beide Male ohne Wirkung, der
   * Chip müsste beide Male verschwinden — ein `true`, das schon `true` war,
   * bliebe dabei unbemerkt.
   */
  saves?: number;
};

/** Ein Thema, wie es unter einem Blatt steht. */
export type MaterialTopicRef = { id: string; title: string };

/**
 * Das Thema, nach dem die Ablage filtert — aufgelöst, benannt und einem Fach
 * zugeordnet.
 *
 * Ein eigener Typ und nicht `MaterialTopicRef`, obwohl zwei der drei Felder
 * gleich heißen: der Ref ist ein Chip UNTER einem Blatt, hier steht das eine
 * Thema ÜBER der ganzen Liste. Nähme man denselben Typ, ließe sich das eine
 * versehentlich für das andere einsetzen — und `subjectId` fehlte dem Ref
 * ohnehin, obwohl die Chip-Zeile genau danach fragt.
 */
export type MaterialTopicFilter = {
  /**
   * Die id, nach der wirklich gefiltert wird — bei einer zusammengelegten
   * Schreibweise das Ziel und nicht die angefragte Zeile.
   *
   * Die Oberfläche braucht genau diese und nicht die aus der Adresszeile: der
   * Chip, der gerade gilt, trägt `aria-current`, und der wird über diese id
   * gefunden. Käme die angefragte id zurück, stünde nach einem alten
   * Lesezeichen eine volle Liste da und kein einziger Chip wäre hervorgehoben.
   */
  id: string;
  /** Der Titel des Ziels, also die Schreibweise, die das Fach jetzt führt. */
  title: string;
  /**
   * Das Fach, zu dem das Thema gehört. Die Ablage kann zugleich nach Fach
   * gefiltert sein; erst damit lässt sich sagen, ob die beiden Filter
   * überhaupt zusammenpassen.
   */
  subjectId: string;
};

/**
 * Was aus den getippten Themen eines Blattes geworden ist.
 *
 * Die Schlüssel sind deutsch wie die Sätze, die daraus auf dem Bildschirm
 * werden; ausführlich steht an `setMaterialTopics()`, was in welche Liste
 * gehört.
 */
export type MaterialTopicResult = {
  /** Die Themen, wie sie jetzt am Blatt hängen — in der Schreibweise des Fachs. */
  gesetzt: string[];
  /** Getippte Titel ohne Fachwort. Sie sind nirgends angelegt worden. */
  verworfen: string[];
  /** Getippte Titel, die dieselbe Vokabel meinen wie ein früherer. */
  zusammengefallen: { getippt: string; thema: string }[];
  /**
   * Getippte Titel, die das Fach unter einer anderen Schreibweise schon führt
   * — am Blatt steht danach die des Fachs.
   *
   * „Kettenregel Übungen" landet als „Kettenregel", wenn das Fach diese Zeile
   * schon hat: `vocabularyKey()` faltet beide auf denselben Schlüssel, und
   * `ensureVocabulary()` gibt die gespeicherte Zeile zurück, nicht die
   * getippte. Ohne diese Liste fiele das zwischen den beiden anderen hindurch
   * — `verworfen` greift nur ohne Fachwort, `zusammengefallen` nur bei ZWEI
   * getippten Titeln auf derselben Vokabel. Ein einzelner Titel verschwände
   * kommentarlos, und wer ihn getippt hat, fände ihn nirgends wieder.
   *
   * Nur, wenn der Unterschied über Rand und Groß-/Kleinschreibung hinausgeht:
   * „kettenregel" zu „Kettenregel" ist keine Nachricht, sondern das, was jede
   * Vokabelliste tut.
   */
  umbenannt: { getippt: string; thema: string }[];
};

/**
 * Was die Oberfläche über eine Seite weiß — alles außer den Bytes selbst.
 * Die holt der Route Handler einzeln, und nur die, die gerade zu sehen ist.
 */
export type MaterialPageInfo = {
  id: string;
  sortOrder: number;
  width: number;
  height: number;
  mimeType: string;
  byteSize: number;
};

/** Ein Blatt in der Ablage. */
export type MaterialListItem = {
  id: string;
  title: string;
  capturedOn: string;
  note: string | null;
  subject: { id: string; name: string; short: string; color: string };
  pageCount: number;
  /**
   * id der ersten Seite, für das Vorschaubild. Null gibt es nicht — jedes
   * Blatt hat mindestens eine Seite, dafür sorgt `deletePage()`.
   */
  coverPageId: string | null;
  topics: MaterialTopicRef[];
};

/**
 * Ein Blatt in der Liste, ohne seine Themen.
 *
 * Der Typ ist geteilt und nicht bloß das Feld leer gelassen. Ein `topics: []`
 * an einem Blatt, dessen Themen gar nicht geladen wurden, hieße auf dem
 * Bildschirm „dieses Blatt hat keine Themen" — von der Wahrheit nicht zu
 * unterscheiden und deshalb eine stille Unwahrheit, sobald jemand die Liste
 * doch einmal mit Themen rendert. So verweigert stattdessen der Compiler den
 * Zugriff auf etwas, das niemand geladen hat.
 */
export type MaterialCard = Omit<MaterialListItem, "topics">;

/** Ein Blatt mit allen seinen Seiten. */
export type MaterialDetail = MaterialListItem & {
  pages: MaterialPageInfo[];
  /**
   * Wann das Blatt durchgesehen wurde; leer heißt: es liegt im Eingangskorb.
   *
   * Nur am Detail und nicht an jeder Zeile einer Liste. Die Ablage zeigt den
   * Zustand nicht — sie ist die Suche, nicht die Arbeitsliste —, und die
   * gemeinsame Feldliste aller Listen um eine Spalte zu erweitern, die
   * zweihundertmal geholt und keinmal gelesen wird, wäre der falsche Preis.
   * Die Detailseite braucht sie: dort steht, ob das Blatt noch wartet, und
   * dort liegt der Weg zurück in den Korb.
   */
  filedAt: Date | null;
};

/**
 * Eine frisch aufgenommene Seite, so wie sie aus der Server Action kommt.
 *
 * `image` und `thumb` sind fertig verkleinert; hier wird nichts mehr gerechnet
 * — auf dem Server steht dafür auch nichts zur Verfügung.
 */
export type NewPage = {
  mimeType: string;
  width: number;
  height: number;
  image: Uint8Array;
  thumb: Uint8Array;
};

/**
 * Wonach gefiltert und sortiert wird und wie viele Blätter höchstens
 * herauskommen.
 *
 * `subjectId` und `topicId` dürfen zusammen gesetzt sein und wirken dann
 * beide: „Mathematik" UND „Kettenregel". Sie schließen einander nicht aus,
 * denn die Ablage filtert erst nach Fach und dann innerhalb des Fachs nach
 * Thema — der zweite Filter dürfte den ersten nicht heimlich aufheben. Zeigt
 * das Thema in ein anderes Fach als das gewählte, bleibt die Liste leer; das
 * ist die ehrliche Antwort auf eine Frage, auf die es keine Blätter gibt, und
 * nicht der Fehler eines von beiden.
 *
 * Beide Filter fallen bei einer kaputten, erfundenen oder fremden id auf eine
 * LEERE Liste zurück und nicht auf die ungefilterte Ablage — der Grund steht
 * an den beiden Zeilen in `listRows()`, die das tun.
 */
type ListOptions = {
  subjectId?: string;
  /**
   * Nur Blätter zu diesem Thema.
   *
   * Die id darf die einer zusammengelegten Schreibweise sein — ein alter Link,
   * ein Lesezeichen aus der Zeit vor dem Aufräumen. Aufgelöst wird sie vor dem
   * Filtern, gezeigt werden dann die Blätter des Ziels. Eine leere Liste wäre
   * hier die falsche Antwort: die Blätter sind da, nur unter dem anderen
   * Namen.
   */
  topicId?: string;
  limit?: number;
  order?: "schultag" | "aufnahme";
};

/**
 * Die Blätter samt ihren Themen, das neueste zuerst — für die Ablage.
 *
 * Gefiltert wird nach Fach und nach Thema, beides freiwillig und beides
 * zusammen; was das im Einzelnen heißt, steht an `ListOptions`.
 *
 * Was „neueste" heißt, entscheidet `order` — und beide Antworten sind an je
 * einer Stelle die richtige:
 *
 * - `"schultag"` (Vorgabe) sortiert nach dem Tag, an dem das Blatt ausgeteilt
 *   wurde, und erst danach nach dem Zeitpunkt der Aufnahme. So sucht man in
 *   der Ablage: nach Unterricht („was war letzte Woche in Mathe?"), nicht
 *   danach, wann man zum Fotografieren kam. Der zweite Schlüssel läuft in
 *   dieselbe Richtung wie der erste: unter drei abends nachfotografierten
 *   Blättern desselben Tages steht das zuletzt hinzugekommene oben. In einer
 *   Liste, die das Neueste zuerst zeigt, gilt das auch innerhalb eines Tages —
 *   und vor allem steht damit überhaupt eine Reihenfolge fest und keine
 *   beliebige.
 * - `"aufnahme"` sortiert allein nach dem Zeitpunkt der Aufnahme. Das braucht
 *   die Reihe auf der Kamera-Seite: sie ist die Bestätigung, dass das eben
 *   ausgelöste Foto angekommen ist. Nach dem Schultag sortiert rutschte ein
 *   nachgetragenes Blatt von letzter Woche hinter sechs jüngere — wer nur die
 *   Kamera-Seite ansieht, müsste glauben, die Aufnahme sei verloren.
 */
export async function listMaterials(
  userId: string,
  options?: ListOptions,
): Promise<MaterialListItem[]> {
  return withTopics(userId, await listRows(userId, options));
}

/**
 * Dieselben Blätter ohne ihre Themen — für die Startseite und die Kamera-Seite.
 *
 * Beide zeigen kein einziges Thema an. Die Themen kosten aber einen Verbund
 * über `material_topics` und zweimal `subject_topics`, und die Startseite ruft
 * das bei jedem Aufruf von „/" auf — der heißesten Seite der App. Eine Abfrage
 * weniger je Aufruf, für etwas, das dort niemand liest.
 *
 * Sortierung, Filter und Obergrenze sind dieselben wie bei `listMaterials()`;
 * unterschieden wird allein, ob die Themen dazugeholt werden. Dass sie fehlen,
 * steht im Typ (`MaterialCard`) und nicht in einem leeren Feld — der Grund
 * dafür steht dort.
 */
export async function listMaterialCards(
  userId: string,
  options?: ListOptions,
): Promise<MaterialCard[]> {
  return listRows(userId, options);
}

/**
 * Schlägt nach, welches Thema hinter einer id steckt — die eine Auflösung für
 * den Themen-Filter.
 *
 * Die Oberfläche fragt hier, bevor sie überschreibt und hervorhebt: gibt es
 * dieses Thema, wie heißt es jetzt, zu welchem Fach gehört es, und auf welche
 * id ist es aufgelöst worden. `null` heißt: es gibt das Thema nicht, die id
 * ist keine, oder sie gehört jemand anderem. Drei Fälle, eine Antwort — für
 * den Nutzer sind sie dasselbe, und unterschieden würden sie nur, um einem
 * Fremden zu verraten, welche ids es gibt.
 *
 * Aufgelöst wird mit `resolveTopic()` aus @/lib/subject-topics und nicht mit
 * einer zweiten Fassung derselben Suche. Dort steht die Regel im Original:
 * höchstens `MAX_ALIAS_HOPS` Schritte, und am Ende einer von Hand verbogenen
 * Kette wird zurückgegeben, wo man steht, statt sich aufzuhängen. Zwei
 * Fassungen wären genau die Art von Doppelung, bei der später zwei Türen
 * verschieden entscheiden.
 *
 * **Aufgelöst wird EINMAL je Liste, hier, und nicht noch einmal in der
 * Abfrage.** `listRows()` fragt diese Funktion am Anfang und vergleicht danach
 * im SQL gegen genau diese eine id. Der andere Weg wäre, wie in `loadTopics()`
 * mit einem `leftJoin` je Zeile aufzulösen — dort ist er richtig und hier
 * falsch: dort trägt jedes Blatt seine eigenen Themen und die Auflösung muss
 * Zeile für Zeile mitlaufen, hier steht EIN Thema fest und viele Blätter
 * hängen daran. Ein Verbund, der bei jeder Zeile dieselbe Frage neu stellt,
 * beantwortet sie zweihundertmal gleich. Und die Oberfläche braucht Titel und
 * Fach ohnehin für den Chip — sie ruft dieselbe Funktion und baut sich keine
 * zweite Auflösung.
 *
 * Zurück kommen drei Felder und nicht die ganze Zeile aus `subject_topics`.
 * `matchKey`, `mergedInto` und `lastSeenAt` haben über einer Ablageliste
 * nichts zu suchen: der Schlüssel ist nie zur Anzeige gedacht, und
 * `mergedInto` lüde dazu ein, hinter dieser Auflösung noch einmal von Hand
 * weiterzugehen.
 *
 * **Die Chip-Zeile über der Ablage kommt nicht von hier, sondern aus
 * `listTopics()` in @/lib/subject-topics** — und die reicht dafür aus, ohne
 * dass hier eine eigene Abfrage entstehen musste. Sie liefert je Thema
 * `materialCount`; wer nur die Themen zeigen will, unter denen auch etwas
 * liegt, nimmt die mit `materialCount > 0` und lässt den Rest weg. Ein Chip,
 * der auf eine leere Liste führt, ist eine Sackgasse, und die Zahl daneben ist
 * dieselbe, nach der der Filter hier sucht (siehe `materialIdsForTopic()`).
 * Auch die beiden anderen Fragen beantwortet sie schon: zusammengelegte
 * Schreibweisen bleiben ohne `includeMerged` draußen — sonst stünde derselbe
 * Chip zweimal da, einmal unter dem alten und einmal unter dem neuen Namen —,
 * und sortiert ist die Liste nach dem zuletzt gesehenen Tag, was für eine
 * Chip-Zeile die richtige Reihenfolge ist: vorn steht, woran gerade gearbeitet
 * wird. Eine eigene Funktion hier wäre eine zweite Wahrheit über dieselbe
 * Menge gewesen.
 *
 * Eine Grenze hat die Zusage, und sie ist die alte: `listTopics()` zählt alle
 * Blätter, die Liste zeigt höchstens `LIST_LIMIT`. Bei mehr als zweihundert
 * Blättern zu einem einzigen Thema nennt der Chip also die größere Zahl — für
 * diesen Fall steht unter der Ablage schon der Satz, dass die Liste an ihrer
 * Grenze steht.
 */
export async function resolveMaterialTopic(
  userId: string,
  topicId: string,
): Promise<MaterialTopicFilter | null> {
  const topic = await resolveTopic(userId, topicId);
  if (!topic) return null;

  return { id: topic.id, title: topic.title, subjectId: topic.subjectId };
}

/** Ein einzelnes Blatt mit allen Seiten. */
export async function getMaterial(
  userId: string,
  id: string,
): Promise<MaterialDetail | null> {
  if (!isId(id)) return null;

  const [row] = await db
    // Die gemeinsame Feldliste plus die eine Spalte, die nur das Detail
    // braucht — `filed_at`. Sie in `MATERIAL_FIELDS` zu legen hieße, sie in
    // jeder Ablageliste mitzuholen, wo sie niemand liest.
    .select({ ...MATERIAL_FIELDS, filedAt: materials.filedAt })
    .from(materials)
    .innerJoin(
      subjects,
      and(eq(subjects.id, materials.subjectId), eq(subjects.userId, userId)),
    )
    .where(and(eq(materials.userId, userId), eq(materials.id, id)))
    .limit(1);

  if (!row) return null;

  const [item] = await withTopics(userId, await decorate(userId, [row]));
  if (!item) return null;

  const pages = await db
    .select({
      id: materialPages.id,
      sortOrder: materialPages.sortOrder,
      width: materialPages.width,
      height: materialPages.height,
      mimeType: materialPages.mimeType,
      byteSize: materialPages.byteSize,
    })
    .from(materialPages)
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialPages.materialId),
        eq(materials.userId, userId),
      ),
    )
    .where(eq(materialPages.materialId, id))
    .orderBy(asc(materialPages.sortOrder), asc(materialPages.createdAt));

  return { ...item, pages, filedAt: row.filedAt };
}

/**
 * Legt Blatt und erste Seite in einem Zug an und gibt die id des Blattes
 * zurück.
 *
 * Beides in einer Transaktion, weil ein Blatt ohne Seite ein leerer Eintrag
 * wäre, den niemand wiedererkennt — und weil er entstünde, während der Nutzer
 * schon auf die Detailseite geschickt wird. Drizzle kann das mit beiden
 * Treibern; `setTopics()` in @/lib/exams fährt seit Langem denselben Weg.
 *
 * Wirft, wenn das Fach nicht dem Nutzer gehört oder das Bild die Grenze reißt.
 * Beides kann über die Oberfläche nicht passieren — das Formular kennt nur die
 * eigenen Fächer, und verkleinert wird vorher. Wer die Server Action direkt
 * anspricht, bekommt einen fertigen deutschen Satz, den sie weiterreichen
 * kann. Stillschweigend anlegen dürfte sie es nicht: ein Blatt an einem
 * fremden Fach taucht in keiner Liste wieder auf.
 */
export async function createMaterialWithPage(
  userId: string,
  input: MaterialInput,
  page: NewPage,
): Promise<string> {
  if (!(await ownsSubject(userId, input.subjectId))) {
    throw new Error("Dieses Fach gibt es nicht mehr.");
  }

  const values = pageValues(page);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(materials)
      .values({
        userId,
        subjectId: input.subjectId,
        title: input.title,
        capturedOn: input.capturedOn,
        note: input.note,
      })
      .returning({ id: materials.id });

    if (!created) {
      throw new Error("Das Blatt konnte nicht gespeichert werden.");
    }

    await tx
      .insert(materialPages)
      .values({ ...values, materialId: created.id, sortOrder: 0 });

    return created.id;
  });
}

/**
 * Ändert Titel, Fach, Tag und Notiz. Falsch heißt: das Blatt gibt es nicht
 * (mehr), oder das gewählte Fach gehört jemand anderem.
 *
 * **Wechselt das Fach, fallen die Themen des Blattes weg.** Sie gehören dem
 * Vokabular des alten Fachs: „Kettenregel" ist ein Thema von Mathematik, und
 * an einem Blatt in Physik stünde es als Fremdwort da — die Themenliste des
 * neuen Fachs kennt es nicht, der Filter findet es nicht, und die Frage „was
 * habe ich zur Kettenregel?" bekäme eine Antwort aus dem falschen Fach. Sie
 * stehenzulassen wäre bequemer und stiller; sie fallen zu lassen ist auf dem
 * Bildschirm sofort sichtbar und in einem Tipp wiederhergestellt. Verloren
 * geht dabei nichts als die Paarung: die Vokabeln selbst bleiben im alten Fach
 * stehen, mit allem, was sonst noch an ihnen hängt.
 */
export async function updateMaterial(
  userId: string,
  id: string,
  input: MaterialInput,
): Promise<boolean> {
  if (!isId(id)) return false;

  const existing = await findMaterial(userId, id);
  if (!existing) return false;
  if (!(await ownsSubject(userId, input.subjectId))) return false;

  const subjectChanged = existing.subjectId !== input.subjectId;

  await db.transaction(async (tx) => {
    await tx
      .update(materials)
      .set({
        subjectId: input.subjectId,
        title: input.title,
        capturedOn: input.capturedOn,
        note: input.note,
      })
      .where(and(eq(materials.userId, userId), eq(materials.id, id)));

    if (subjectChanged) {
      await tx.delete(materialTopics).where(eq(materialTopics.materialId, id));
    }
  });

  return true;
}

/** Löscht ein Blatt samt Seiten und Themenpaarungen ("cascade"). */
export async function deleteMaterial(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!isId(id)) return false;

  const removed = await db
    .delete(materials)
    .where(and(eq(materials.userId, userId), eq(materials.id, id)))
    .returning({ id: materials.id });

  return removed.length > 0;
}

/**
 * Hängt eine Seite hinten an. Null, wenn es das Blatt nicht mehr gibt oder
 * `MAX_PAGES` erreicht ist.
 *
 * Zählen und Einfügen stehen in einer Transaktion, und die Zeile des Blattes
 * wird darin mit `for update` gesperrt, bevor gezählt wird. Erst die Sperre
 * hält die Zusage, dass zwei schnell hintereinander abgeschickte Seiten nicht
 * beide dieselbe freie Stelle sehen — weder bei der Nummer noch bei der
 * Obergrenze. Eine Transaktion allein tut das nicht: unter READ COMMITTED,
 * der Voreinstellung und damit dem Fall in der Cloud, sperrt ein gewöhnlicher
 * SELECT nichts. Beide Transaktionen läsen denselben Stand, vergäben dieselbe
 * sortOrder und kämen zusammen auf eine Seite mehr, als `MAX_PAGES` erlaubt.
 * Lokal fiele das nie auf, weil PGlite ohnehin nur eine Verbindung hat — die
 * Zusage gälte also genau dort nicht, wo sie gebraucht wird.
 *
 * Gesperrt wird die Zeile in `materials` und nicht die Seiten: die Seite, die
 * das Rennen verlieren soll, gibt es noch gar nicht, und eine Zeile, die es
 * nicht gibt, lässt sich nicht sperren. Das Blatt ist die Klammer um beide
 * Schreibvorgänge und damit die richtige Stelle.
 */
export async function addPage(
  userId: string,
  materialId: string,
  page: NewPage,
): Promise<string | null> {
  if (!isId(materialId)) return null;

  const values = pageValues(page);

  return db.transaction(async (tx): Promise<string | null> => {
    const [material] = await tx
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.userId, userId), eq(materials.id, materialId)))
      .limit(1)
      .for("update");

    if (!material) return null;

    const existing = await tx
      .select({ sortOrder: materialPages.sortOrder })
      .from(materialPages)
      .innerJoin(
        materials,
        and(
          eq(materials.id, materialPages.materialId),
          eq(materials.userId, userId),
        ),
      )
      .where(eq(materialPages.materialId, materialId));

    if (existing.length >= MAX_PAGES) return null;

    const highest = existing.reduce(
      (top, row) => Math.max(top, row.sortOrder),
      -1,
    );

    const [created] = await tx
      .insert(materialPages)
      .values({ ...values, materialId, sortOrder: highest + 1 })
      .returning({ id: materialPages.id });

    return created?.id ?? null;
  });
}

/**
 * Löscht eine Seite.
 *
 * "letzte" heißt: das war die einzige Seite, und sie bleibt stehen. Ein Blatt
 * ohne Seite wäre ein leerer Eintrag in der Ablage — ein Titel, ein Datum und
 * nichts zu sehen, das ihn wiedererkennbar macht. Wer das Blatt loswerden
 * will, löscht das Blatt; das ist eine andere Schaltfläche und eine andere
 * Frage. "weg" heißt: diese Seite gibt es nicht (mehr) oder sie gehört jemand
 * anderem — für den Nutzer dasselbe.
 *
 * Gezählt wird unter derselben Sperre auf der Zeile des Blattes wie in
 * `addPage()`; warum ein gewöhnlicher SELECT dafür nicht reicht, steht dort.
 * Hier bewacht sie dieselbe Zusage von der anderen Seite: `addPage()` hält die
 * Obergrenze, diese Funktion die Untergrenze. Ohne sie läsen zwei Geräte, die
 * im selben Moment je eine andere Seite eines zweiseitigen Blattes löschen,
 * beide zwei Zeilen, kämen beide an der Schranke vorbei — und übrig bliebe ein
 * Blatt ohne Seite. Genau das schließt der Typkommentar an `coverPageId` aus,
 * und er nennt diese Funktion als den Grund.
 */
export async function deletePage(
  userId: string,
  pageId: string,
): Promise<"geloescht" | "letzte" | "weg"> {
  if (!isId(pageId)) return "weg";

  return db.transaction(
    async (tx): Promise<"geloescht" | "letzte" | "weg"> => {
      const [page] = await tx
        .select({ materialId: materialPages.materialId })
        .from(materialPages)
        .innerJoin(
          materials,
          and(
            eq(materials.id, materialPages.materialId),
            eq(materials.userId, userId),
          ),
        )
        .where(eq(materialPages.id, pageId))
        .limit(1);

      if (!page) return "weg";

      const [material] = await tx
        .select({ id: materials.id })
        .from(materials)
        .where(
          and(eq(materials.userId, userId), eq(materials.id, page.materialId)),
        )
        .limit(1)
        .for("update");

      if (!material) return "weg";

      const pages = await tx
        .select({ id: materialPages.id })
        .from(materialPages)
        .innerJoin(
          materials,
          and(
            eq(materials.id, materialPages.materialId),
            eq(materials.userId, userId),
          ),
        )
        .where(eq(materialPages.materialId, page.materialId));

      // Erst unter der Sperre steht der Bestand fest. Dass die Seite oben noch
      // da war, heißt nicht, dass sie es jetzt noch ist: wer vor uns an der
      // Sperre stand, kann genau sie gelöscht haben. Dann ist sie weg und
      // nicht „gelöscht" — sonst meldete die App einen Erfolg für einen
      // Löschvorgang, der null Zeilen getroffen hat.
      if (!pages.some((row) => row.id === pageId)) return "weg";
      if (pages.length <= 1) return "letzte";

      await tx.delete(materialPages).where(eq(materialPages.id, pageId));
      return "geloescht";
    },
  );
}

/**
 * Setzt die Themen eines Blattes auf genau diese Titel.
 *
 * Fehlende Vokabeln entstehen dabei über `ensureTopics()` mit `origin: "blatt"`
 * — das ist der Wert, für den die Spalte schon angelegt wurde. Als „zuletzt
 * gesehen" gilt der Schultag des Blattes und nicht heute: ein nachgetragenes
 * Blatt vom Januar soll die Vorschlagsliste nicht durcheinanderbringen.
 *
 * Geschrieben wird nur mit aufgelösten ids — die Regel von
 * @/lib/subject-topics gilt hier genauso. Aufgelöst hat sie `ensureTopics()`
 * schon, und zwar in beiden Zweigen; die Zusage steht ausdrücklich an
 * `ensureTopics()` und wird hier nicht auf gut Glück angenommen. Ein zweites
 * `resolveTopic()` je Titel wäre bei vierzig Themen vierzig Abfragen, die
 * dieselbe Zeile noch einmal holen. Lösen zwei Schreibweisen nach einer
 * Zusammenlegung auf dasselbe Thema auf, steht es einmal am Blatt.
 *
 * Ob das Fach dem Nutzer gehört, wird einmal geprüft und nicht je Titel: es
 * steht am Blatt fest und kann sich zwischen zwei Titeln nicht ändern. Genau
 * dafür gibt es `ensureTopics()` neben `ensureTopic()`.
 *
 * Zurück kommen die Titel so, wie sie jetzt am Blatt stehen (`gesetzt`), und
 * daneben zwei Listen über das, was aus der Eingabe NICHT wurde. Beide sind
 * nötig, weil der Nutzer sonst einen Chip tippt und ihn nirgends wiederfindet:
 *
 * - `verworfen`: kein Fachwort. „Übungen" ist kein Thema, sondern das, was man
 *   damit macht — es wird nicht angelegt.
 * - `umbenannt`: das Fach führt diese Vokabel schon unter einer anderen
 *   Schreibweise, und die gilt. „Kettenregel Übungen" steht danach als
 *   „Kettenregel" am Blatt — dieselbe Faltung wie oben, nur mit einer Zeile,
 *   die es schon gab. Ohne diese Liste verschwände der getippte Titel zwischen
 *   den beiden anderen hindurch.
 * - `zusammengefallen`: zwei getippte Titel meinen dieselbe Vokabel und stehen
 *   deshalb einmal am Blatt. „Kettenregel Übungen" fällt auf „Kettenregel", und
 *   das ist Absicht (siehe `vocabularyKey()` in @/lib/topics) — aber auf dem
 *   Bildschirm bleibt danach ein Chip weniger stehen, als getippt wurde. Jeder
 *   Eintrag nennt beides: was getippt wurde und auf welches Thema es fiel.
 *
 * Beide Listen gehen an die Server Action, die sie hinschreibt. Was
 * `normalizeTopics()` vorher wegwirft (Leerzeilen, Dubletten und alles über 40
 * Themen), steht in keiner von beiden — dort ist nichts verlorengegangen, was
 * der Nutzer nicht doppelt getippt hätte.
 *
 * Ersetzt wird die ganze Menge statt sie abzugleichen. Die Zeile in
 * `material_topics` besteht nur aus dem Paar; sie trägt keine Reihenfolge,
 * kein Datum und keine Geschichte, die ein Abgleich retten könnte. Anders als
 * bei den Klausurthemen ist Wegwerfen hier also folgenlos.
 */
export async function setMaterialTopics(
  userId: string,
  materialId: string,
  titles: string[],
): Promise<MaterialTopicResult> {
  const material = await findMaterial(userId, materialId);
  if (!material) {
    return { gesetzt: [], verworfen: [], zusammengefallen: [], umbenannt: [] };
  }

  const wishes = normalizeTopics(titles);
  const found = await ensureTopics(userId, material.subjectId, wishes, {
    origin: "blatt",
    seenAt: material.capturedOn,
  });

  const gesetzt: string[] = [];
  const verworfen: string[] = [];
  const zusammengefallen: MaterialTopicResult["zusammengefallen"] = [];
  const umbenannt: MaterialTopicResult["umbenannt"] = [];
  const wanted: string[] = [];
  const seen = new Map<string, string>();

  // Die Antworten stehen in der Reihenfolge der Titel — nur so lässt sich
  // sagen, welcher Titel abgelehnt wurde und welcher auf einen früheren fiel.
  for (const [index, title] of wishes.entries()) {
    const topic = found[index];

    if (!topic) {
      verworfen.push(title);
      continue;
    }

    const bereits = seen.get(topic.id);
    if (bereits !== undefined) {
      zusammengefallen.push({ getippt: title, thema: bereits });
      continue;
    }

    // Das Fach führt diese Vokabel schon, aber anders geschrieben. Verglichen
    // wird mit `topicKey()` und nicht mit `!==`: Rand und Groß-/Kleinschreibung
    // gleicht jede Vokabelliste an, das ist keine Nachricht. Gemeint ist der
    // Fall, in dem aus „Kettenregel Übungen" ein „Kettenregel" wird.
    if (topicKey(title) !== topicKey(topic.title)) {
      umbenannt.push({ getippt: title, thema: topic.title });
    }

    seen.set(topic.id, topic.title);
    wanted.push(topic.id);
    gesetzt.push(topic.title);
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(materialTopics)
      .where(eq(materialTopics.materialId, materialId));

    if (wanted.length > 0) {
      await tx.insert(materialTopics).values(
        wanted.map((subjectTopicId) => ({ materialId, subjectTopicId })),
      );
    }
  });

  return { gesetzt, verworfen, zusammengefallen, umbenannt };
}

/**
 * Die Bytes einer Seite, für den Route Handler.
 *
 * Der Join auf `materials` ist hier keine Formsache: an der Seite selbst hängt
 * keine userId, und diese Funktion ist die einzige Stelle, an der Bilddaten
 * das Haus verlassen.
 *
 * Der Rückgabetyp ist enger als „irgendein Uint8Array": `new Response(bytes)`
 * verlangt seit TypeScript 5.7 ein `ArrayBufferView<ArrayBuffer>`. Käme hier
 * das voreingestellte `Uint8Array` heraus, müsste der Route Handler es
 * umtypen oder kopieren.
 */
export async function readPageImage(
  userId: string,
  pageId: string,
  variant: "voll" | "vorschau",
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string } | null> {
  if (!isId(pageId)) return null;

  const [row] = await db
    .select({
      bytes: variant === "vorschau" ? materialPages.thumb : materialPages.image,
      mimeType: materialPages.mimeType,
    })
    .from(materialPages)
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialPages.materialId),
        eq(materials.userId, userId),
      ),
    )
    .where(eq(materialPages.id, pageId))
    .limit(1);

  return row ?? null;
}

/**
 * Der Titelvorschlag, solange nichts getippt wurde: "Blatt vom 21.8."
 *
 * Ein Vorschlag und keine Erfindung — er steht im Feld und lässt sich
 * überschreiben, bevor gespeichert wird. Genau darum geht es beim Aufnehmen:
 * zwei Sekunden im Unterricht, das Richtigstellen kommt danach.
 */
export function defaultMaterialTitle(date: string): string {
  if (!isCalendarDate(date)) return "Blatt";

  return `Blatt vom ${germanShortParts(date).dayMonth}`;
}

/**
 * Die Felder eines Blattes samt Fach, in jeder Liste dieselben — und
 * ausdrücklich ohne die beiden bytea-Spalten.
 */
const MATERIAL_FIELDS = {
  id: materials.id,
  title: materials.title,
  capturedOn: materials.capturedOn,
  note: materials.note,
  subjectId: subjects.id,
  subjectName: subjects.name,
  subjectShort: subjects.short,
  subjectColor: subjects.color,
};

type MaterialRow = {
  id: string;
  title: string;
  capturedOn: string;
  note: string | null;
  subjectId: string;
  subjectName: string;
  subjectShort: string;
  subjectColor: string;
};

/**
 * Der gemeinsame Rumpf beider Listen: dieselbe Abfrage, dieselbe Sortierung,
 * dieselbe Obergrenze — nur die Themen fehlen noch.
 *
 * `listMaterials()` hängt sie mit `withTopics()` an, `listMaterialCards()`
 * lässt es. Zwei Fassungen der Abfrage wären zwei Stellen, an denen später
 * verschieden sortiert oder verschieden gefiltert würde.
 */
async function listRows(
  userId: string,
  options?: ListOptions,
): Promise<MaterialCard[]> {
  const subjectId = options?.subjectId;
  // Ein Fach, das es nicht gibt, hat keine Blätter — eine leere Liste ist die
  // ehrliche Antwort, nicht die ungefilterte Ablage.
  if (subjectId !== undefined && !isId(subjectId)) return [];

  // Das Thema wird aufgelöst, bevor gefiltert wird: gefragt sein kann die id
  // einer zusammengelegten Schreibweise, gemeint sind dann die Blätter des
  // Ziels. Die Auflösung steht hier oben und nicht in der Abfrage darunter —
  // warum, steht an `resolveMaterialTopic()`.
  //
  // Gefragt wird nur, wenn überhaupt nach Thema gefiltert werden soll: die
  // Startseite und die Kamera-Seite zahlen für diesen Filter nichts.
  const wanted = options?.topicId;
  const topic =
    wanted === undefined ? null : await resolveMaterialTopic(userId, wanted);

  // Ein Thema, das es nicht gibt, hat keine Blätter — dieselbe leere Liste wie
  // oben beim Fach und aus demselben Grund. Anders als dort reicht dafür keine
  // Formprüfung: eine id kann tadellos aussehen und trotzdem zu einem
  // gelöschten oder fremden Thema gehören.
  if (wanted !== undefined && topic === null) return [];

  const rows = await db
    .select(MATERIAL_FIELDS)
    .from(materials)
    .innerJoin(
      subjects,
      and(eq(subjects.id, materials.subjectId), eq(subjects.userId, userId)),
    )
    .where(
      and(
        eq(materials.userId, userId),
        subjectId ? eq(materials.subjectId, subjectId) : undefined,
        // Das Fach des Themas — die zweite Hälfte der Bedingung, die drüben in
        // `materialCounts()` als Verbund auf `materials` steht: gezählt und
        // gezeigt wird nur, was wirklich in dem Fach liegt, zu dem die Vokabel
        // gehört. Nach der Auflösung steht dieses Fach fest, also genügt hier
        // ein Vergleich gegen eine bekannte id.
        //
        // Steht daneben schon ein anderes Fach aus `subjectId`, widersprechen
        // sich die beiden und die Liste bleibt leer. Das ist kein Unfall,
        // sondern die Antwort auf „Kettenregel in Physik": danach gibt es
        // keine Blätter.
        topic ? eq(materials.subjectId, topic.subjectId) : undefined,
        topic
          ? inArray(materials.id, materialIdsForTopic(userId, topic))
          : undefined,
      ),
    )
    .orderBy(
      ...(options?.order === "aufnahme"
        ? [desc(materials.createdAt)]
        : [desc(materials.capturedOn), desc(materials.createdAt)]),
    )
    .limit(clampLimit(options?.limit));

  return decorate(userId, rows);
}

/**
 * Die Unterabfrage hinter dem Themen-Filter: die ids aller Blätter, an denen
 * dieses Thema hängt — einschließlich der Schreibweisen, die in es
 * zusammengelegt wurden.
 *
 * **Hier steht dieselbe Regel wie in `materialCounts()` in
 * @/lib/subject-topics, und sie muss dieselbe bleiben.** Dort wird über
 * `coalesce(merged_into, id)` gruppiert und gezählt — das ergibt die Zahl, die
 * in der Themenpflege unter dem Thema steht („3 Blätter"). Hier wird über
 * denselben Ausdruck gefiltert — das ergibt die Liste, die der Filter zeigt.
 * Rechneten die beiden verschieden, sagte die Pflegeansicht drei und die
 * Ablage zeigte eines, und von außen wäre nicht zu sehen, welche der beiden
 * Zahlen lügt. Wer dort etwas ändert, ändert hier mit; der Ausdruck ist
 * absichtlich Zeichen für Zeichen derselbe.
 *
 * Mitgezogen sind aus demselben Grund die beiden Einschränkungen von drüben:
 * das Thema gehört dem Nutzer, und es zählt nur innerhalb seines eigenen
 * Fachs. Die zweite steht dort als Verbund auf `materials`
 * (`materials.subject_id = subject_topics.subject_id`) und hier zweigeteilt —
 * einmal an der Vokabel und einmal am Blatt in `listRows()` —, weil das Fach
 * nach der Auflösung feststeht und `materials` dadurch aus dieser Abfrage
 * ganz herausfällt. Über die App kann ein Blatt ohnehin kein Thema aus einem
 * fremden Fach tragen (`updateMaterial()` löst die Paarungen beim Fachwechsel
 * auf); die Bedingung steht trotzdem da, damit eine von Hand geschriebene
 * Zeile die Liste nicht länger macht als die Zahl daneben.
 *
 * **`IN (Unterabfrage)` und nicht `distinct` auf einem Verbund.** Irgendetwas
 * muss es sein: hängen nach einer Zusammenlegung beide Schreibweisen an
 * demselben Blatt, träfe ein schlichter Verbund es zweimal, und das Blatt
 * stünde doppelt in der Ablage — drüben verhindert das `count(distinct …)`.
 * Schlimmer noch, `limit` zählte dann Paarungen statt Blätter und schnitte
 * mitten in die Dubletten hinein: zweihundert gefragt, hundertneunzig
 * verschiedene bekommen, und der Hinweis „hier ist die Grenze" stünde unter
 * einer Liste, die gar nicht voll ist. Gegen `distinct` sprechen zwei Dinge:
 *
 * - Es räumt hinterher weg, was der Verbund vorher angerichtet hat — erst
 *   vervielfachen, dann sortieren, dann Dubletten wegwerfen. Die Unterabfrage
 *   vervielfacht nicht: sie beantwortet nur „hängt daran etwas?", und Postgres
 *   darf beim ersten Treffer aufhören. Sie sieht `material_topics` dabei über
 *   `subject_topic_id` an — die Spalte, auf der `material_topics_topic_idx`
 *   liegt, und der einzige Grund, aus dem es diesen Index gibt.
 * - `select distinct` verlangt in Postgres, dass jeder Ausdruck aus dem
 *   `order by` auch in der Feldliste steht — nachgemessen, die Abfrage kommt
 *   sonst gar nicht durch: „for SELECT DISTINCT, ORDER BY expressions must
 *   appear in select list". Sortiert wird hier nach `materials.created_at`,
 *   und die Spalte steht bewusst nicht in `MATERIAL_FIELDS`. Die Ablage müsste
 *   sie also mitholen — und mit ihr jede andere Liste, denn die Feldliste ist
 *   eine gemeinsame. Ein Filter, der die Form aller Abfragen ändert, ist zu
 *   teuer für das, was er tut.
 */
function materialIdsForTopic(userId: string, topic: MaterialTopicFilter) {
  const target = sql`coalesce(${subjectTopics.mergedInto}, ${subjectTopics.id})`;

  return db
    .select({ materialId: materialTopics.materialId })
    .from(materialTopics)
    .innerJoin(
      subjectTopics,
      and(
        eq(subjectTopics.id, materialTopics.subjectTopicId),
        eq(subjectTopics.userId, userId),
        eq(subjectTopics.subjectId, topic.subjectId),
        eq(target, topic.id),
      ),
    );
}

/**
 * Hängt an die geladenen Blätter, was jede Liste zeigt: die Anzahl der Seiten
 * und die erste Seite fürs Vorschaubild.
 *
 * Eine Nachfrage für die ganze Liste statt einer je Blatt. Sie holt nur ids und
 * Reihenfolge — die Bytes bleiben, wo sie sind.
 */
async function decorate(
  userId: string,
  rows: MaterialRow[],
): Promise<MaterialCard[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const pages = await db
    .select({
      id: materialPages.id,
      materialId: materialPages.materialId,
      sortOrder: materialPages.sortOrder,
    })
    .from(materialPages)
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialPages.materialId),
        eq(materials.userId, userId),
      ),
    )
    .where(inArray(materialPages.materialId, ids))
    .orderBy(asc(materialPages.sortOrder), asc(materialPages.createdAt));

  const counts = new Map<string, number>();
  const covers = new Map<string, string>();

  for (const page of pages) {
    counts.set(page.materialId, (counts.get(page.materialId) ?? 0) + 1);
    if (!covers.has(page.materialId)) covers.set(page.materialId, page.id);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    capturedOn: row.capturedOn,
    note: row.note,
    subject: {
      id: row.subjectId,
      name: row.subjectName,
      short: row.subjectShort,
      color: row.subjectColor,
    },
    pageCount: counts.get(row.id) ?? 0,
    coverPageId: covers.get(row.id) ?? null,
  }));
}

/**
 * Holt die Themen zu einer fertigen Liste nach — der eine Schritt, der die
 * Ablage von der Startseite unterscheidet.
 *
 * Er steht getrennt, damit er wegbleiben kann: wer ihn nicht geht, bekommt
 * `MaterialCard[]` zurück und kann `topics` gar nicht erst lesen.
 */
async function withTopics(
  userId: string,
  cards: MaterialCard[],
): Promise<MaterialListItem[]> {
  if (cards.length === 0) return [];

  const topics = await loadTopics(
    userId,
    cards.map((card) => card.id),
  );

  return cards.map((card) => ({ ...card, topics: topics.get(card.id) ?? [] }));
}

/**
 * Die Themen mehrerer Blätter auf einmal.
 *
 * Auch beim Lesen gilt die Regel aus @/lib/subject-topics: wer eine
 * zusammengelegte Vokabel vor sich hat, zeigt ihr Ziel. Hier steht sie als
 * `leftJoin` auf dieselbe Tabelle statt als `resolveTopic()` je Thema — das
 * wäre eine eigene Abfrage je Thema, und eine volle Ablageliste hat
 * `LIST_LIMIT` Blätter mit je mehreren Themen: mehrere hundert Wege zur
 * Datenbank für eine einzige Liste.
 * Ein Schritt reicht dafür: nach der Regel dort ist eine Kette höchstens einen
 * Schritt lang, weil beim Zusammenlegen auch die vorhandenen Aliasse
 * umgehängt werden. Eine längere Kette kann nur von Hand in der Datenbank
 * entstehen, und dann zeigt die Liste den Zwischenschritt — sichtbar, nicht
 * still.
 *
 * Lösen dabei zwei Themen eines Blattes auf dasselbe Ziel auf, steht es
 * einmal da.
 */
async function loadTopics(
  userId: string,
  materialIds: string[],
): Promise<Map<string, MaterialTopicRef[]>> {
  const target = alias(subjectTopics, "merge_target");

  const rows = await db
    .select({
      materialId: materialTopics.materialId,
      ownId: subjectTopics.id,
      ownTitle: subjectTopics.title,
      targetId: target.id,
      targetTitle: target.title,
    })
    .from(materialTopics)
    .innerJoin(
      subjectTopics,
      and(
        eq(subjectTopics.id, materialTopics.subjectTopicId),
        eq(subjectTopics.userId, userId),
      ),
    )
    .leftJoin(
      target,
      and(
        eq(target.id, subjectTopics.mergedInto),
        eq(target.userId, userId),
      ),
    )
    .where(inArray(materialTopics.materialId, materialIds));

  const byMaterial = new Map<string, MaterialTopicRef[]>();

  for (const row of rows) {
    const topic: MaterialTopicRef = {
      id: row.targetId ?? row.ownId,
      title: row.targetTitle ?? row.ownTitle,
    };

    const list = byMaterial.get(row.materialId) ?? [];
    if (list.some((known) => known.id === topic.id)) continue;

    list.push(topic);
    byMaterial.set(row.materialId, list);
  }

  for (const list of byMaterial.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title, "de"));
  }

  return byMaterial;
}

/**
 * Was aus einer frisch aufgenommenen Seite in die Spalten geht.
 *
 * `byteSize` wird nicht geglaubt, sondern gezählt: die Zahl steht später unter
 * dem Blatt, und eine geschätzte Größe wäre eine erfundene.
 *
 * `new Uint8Array(...)` kopiert die Bytes einmal. Das ist der Weg vom
 * voreingestellten `Uint8Array` zu dem `Uint8Array<ArrayBuffer>`, das die
 * Spalte führt, ohne ein `as` — und bei 300 KB je Seite kostet er nichts.
 *
 * Die Grenzen aus @/lib/images werden hier ein zweites Mal geprüft, obwohl der
 * Browser längst verkleinert hat. Das ist die letzte Tür vor der Datenbank;
 * wer sie umgeht, bekommt keinen stillen Erfolg.
 *
 * Geprüft werden beide Bilder, jedes an seiner eigenen Grenze. Die Vorschau ist
 * dabei nicht der kleine Bruder, den man mitlaufen lassen kann: sie ist das
 * Bild, das später auf jeder Listenseite ausgeliefert wird. Wer an `readPage()`
 * in der Server Action vorbeigeht — genau der Fall, für den diese Tür da ist —,
 * könnte sonst eine 50-MB-Vorschau neben ein 1-KB-Vollbild legen, und die
 * Ablage lieferte sie danach zweihundertmal auf einmal aus.
 */
function pageValues(page: NewPage): {
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  image: Uint8Array<ArrayBuffer>;
  thumb: Uint8Array<ArrayBuffer>;
} {
  if (page.image.byteLength > MAX_PAGE_BYTES) {
    throw new Error("Das Bild ist zu groß — höchstens 3 MB je Seite.");
  }

  if (page.thumb.byteLength > MAX_THUMB_BYTES) {
    throw new Error("Die Vorschau ist zu groß — höchstens 400 KB je Seite.");
  }

  if (page.image.byteLength === 0 || page.thumb.byteLength === 0) {
    throw new Error("Von diesem Bild ist nichts angekommen.");
  }

  return {
    mimeType: isAllowedMime(page.mimeType) ? page.mimeType : "image/jpeg",
    width: pixels(page.width),
    height: pixels(page.height),
    byteSize: page.image.byteLength,
    image: new Uint8Array(page.image),
    thumb: new Uint8Array(page.thumb),
  };
}

/**
 * Eine Kantenlänge, die als ganze Zahl in die Spalte passt. Die Maße kommen
 * aus dem Browser und sind deshalb Eingabe wie jede andere — eine 0 hier
 * hieße auf der Seite ein Bild ohne Platz.
 */
function pixels(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20_000, Math.max(1, Math.round(value)));
}

/** Die Obergrenze gilt auch dann, wenn jemand eine höhere Zahl übergibt. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return LIST_LIMIT;
  return Math.min(LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Das Nötigste über ein Blatt: gibt es das, und zu welchem Fach gehört es? */
async function findMaterial(
  userId: string,
  id: string,
): Promise<{ id: string; subjectId: string; capturedOn: string } | null> {
  if (!isId(id)) return null;

  const [material] = await db
    .select({
      id: materials.id,
      subjectId: materials.subjectId,
      capturedOn: materials.capturedOn,
    })
    .from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.id, id)))
    .limit(1);

  return material ?? null;
}

/** Gehört das Fach diesem Nutzer? Ohne das legt sich ein Blatt ins Leere. */
/**
 * Gehört dieses Fach dem Nutzer? Eine kaputte oder fremde id heißt nein.
 *
 * Exportiert, weil beide `actions.ts` dieselbe Frage stellen, bevor sie ein
 * Fach in eine Zeile schreiben, und sie vorher jede für sich beantwortet
 * haben — über `listSubjects(…, { includeArchived: true })` und einen Vergleich
 * in JavaScript. Das war zweimal derselbe Satz und dreimal zu teuer: es holte
 * alle Fächer samt Farbe, Lehrkraft und Gewichtung, um eine id zu suchen. Hier
 * steht eine Abfrage auf `subjects_user_idx`, die eine Spalte liest.
 *
 * **Archivierte Fächer zählen mit**, und das ist keine Nachlässigkeit: ein
 * Blatt darf in einem abgewählten Fach liegen bleiben — was fotografiert
 * wurde, ist fotografiert —, und weder das Blattformular noch die Bestätigung
 * eines Vorschlags soll es dort herausdrängen. Wer nur aktive Fächer meint,
 * fragt `listSubjects()`.
 */
export async function ownsSubject(
  userId: string,
  subjectId: string,
): Promise<boolean> {
  if (!isId(subjectId)) return false;

  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, subjectId)))
    .limit(1);

  return Boolean(subject);
}
