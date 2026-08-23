import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { db } from "@/db";
import {
  materialPages,
  materialProposalTopics,
  materialProposals,
  materialTopics,
  materials,
  subjectTopics,
  subjects,
  type ProposalOrigin,
} from "@/db/schema";
import { germanShortParts, isCalendarDate, todayInBerlin } from "@/lib/dates";
import {
  MATERIAL_NOTE_MAX,
  MATERIAL_TITLE_MAX,
  getMaterial,
  type MaterialDetail,
  type MaterialListItem,
  type MaterialTopicRef,
} from "@/lib/materials";
import { TOPIC_LIMIT, normalizeTopics, vocabularyKey } from "@/lib/topics";

/**
 * Der Eingangskorb — Vorschläge zu einem Blatt, Validierung und Datenzugriff.
 *
 * Reine Datenschicht: keine Server Actions, keine Oberfläche, kein Import aus
 * Next. Was ein Vorschlag ist und warum es keinen Zustand „übernommen" gibt,
 * steht an `materialProposals` in src/db/schema.ts und wird hier nicht noch
 * einmal erzählt. Diese Datei hält sich an die eine Aussage von dort: **eine
 * Zeile in `material_proposals` ist ein offener Vorschlag, sonst nichts**, und
 * **leer heißt an jeder Spalte „dazu sage ich nichts"**.
 *
 * Weder `material_proposals` noch `material_proposal_topics` trägt eine
 * userId; sie hängt am Blatt. Deshalb steht in JEDER Abfrage auf diesen beiden
 * Tabellen ein `innerJoin` auf `materials` mit `eq(materials.userId, userId)`
 * — genau wie bei `material_pages` in @/lib/materials, und aus demselben
 * Grund: eine fehlende Zeile dort hieße, dass eine geratene id fremde Blätter
 * zeigt. Bei `material_proposal_topics` geht der Weg über zwei Verbünde, weil
 * die Zeile das Blatt nur über den Vorschlag kennt.
 *
 * Die schreibenden Anweisungen können das nicht halten: ein INSERT, ein
 * UPDATE und ein DELETE haben keinen Verbund. Sie fragen deshalb eine
 * Anweisung früher nach dem Besitzer — über dieselbe verbundene Abfrage wie
 * jedes Lesen, also `ownsMaterial()` oder `findProposal()` — und schreiben erst
 * danach über die geprüfte id. Das betrifft beide Anweisungen in
 * `createProposal()`, alle drei in `updateProposal()` und je eine in
 * `deleteProposal()` und `clearProposals()`.
 *
 * **`image` und `thumb` werden nirgends mitselektiert.** Der Korb ist eine
 * Liste mit Vorschaubildern, genau wie die Ablage; der ausführliche Grund
 * steht im Kopf von @/lib/materials. Jede Abfrage hier führt eine
 * ausdrückliche Feldliste.
 *
 * Kalendertage sind Zeichenketten („2026-09-14"), gerechnet wird
 * ausschließlich in @/lib/dates.
 */

/**
 * So viele Blätter kommen aus dem Korb höchstens zurück.
 *
 * Dieselbe Zahl und dieselbe Rechnung wie `LIST_LIMIT` in @/lib/materials: bei
 * 200 Blättern stehen 200 Parameter in der `IN`-Liste, mit der die Seiten, die
 * Themen und die Vorschläge nachgeholt werden, und Postgres nimmt 65535
 * entgegen.
 *
 * Ausgeführt, weil der Aufrufer sie kennen muss: eine Abfrage gibt Zeilen
 * zurück und sagt nicht, ob dahinter noch etwas liegt. Erst wer ausdrücklich
 * nach dieser Zahl fragt und genau so viele bekommt, weiß, dass er am Anschlag
 * steht — und kann es hinschreiben, statt still zu kürzen. Im Korb wiegt das
 * schwerer als in der Ablage: ein abgeschnittener Korb sieht aus wie ein
 * leergeräumter.
 */
export const INBOX_LIMIT = 200;

/**
 * So viele Themen kann ein Vorschlag höchstens nennen.
 *
 * Es ist `TOPIC_LIMIT` aus @/lib/topics, importiert und nicht abgeschrieben.
 * Ein Vorschlag ist der Entwurf eines Blattformulars; nähme er mehr Themen an,
 * als beim Übernehmen durch `normalizeTopics()` kommen, verschwänden die
 * überzähligen Chips genau in dem Moment, in dem der Mensch zustimmt. Zweimal
 * hingeschrieben wäre die Zahl die Falle, an der die eine Tür annimmt, was die
 * andere wegwirft.
 *
 * Gedeckelt wird ohnehin von `normalizeTopics()` selbst; diese Konstante steht
 * hier, damit die Oberfläche die Grenze nennen kann, ohne @/lib/topics zu
 * kennen.
 */
export const PROPOSAL_TOPIC_LIMIT = TOPIC_LIMIT;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eine kaputte id aus der Adresszeile würde Postgres sonst mit einem Typfehler
 * quittieren — hier wird daraus ein sauberes „gibt es nicht".
 *
 * Abgeschrieben aus @/lib/materials, weil sie dort nicht exportiert ist. Beide
 * Fassungen beantworten dieselbe Frage und dürfen sich nicht widersprechen:
 * wer eine von beiden ändert, ändert die andere mit.
 */
function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const PROPOSAL_ORIGINS: readonly ProposalOrigin[] = ["manuell", "agent"];

/**
 * Die Spalte ist `text` und kann deshalb alles enthalten, was jemand von Hand
 * hineinschreibt. Auf dem Bildschirm steht daraus ein Hinweis „von einem
 * Agenten vorgeschlagen"; ein unbekannter Wert gilt als „manuell", weil das
 * die Zeile ist, die nichts behauptet.
 */
function toOrigin(value: string): ProposalOrigin {
  return PROPOSAL_ORIGINS.find((origin) => origin === value) ?? "manuell";
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
 * Was ein Vorschlag sagen darf — und das ist absichtlich fast nichts.
 *
 * **Anders als `materialInputSchema` ist hier JEDES Feld optional.** Das ist
 * keine Nachlässigkeit, sondern die Aussage der Tabelle: ein Vorschlag schlägt
 * vor, was er weiß, und schweigt über den Rest. Wer beim Lesen eines Blattes
 * nur zwei Themen erkennt, soll keinen Titel erfinden müssen — ein erfundener
 * Titel steht danach im Formular und wird mitbestätigt, ein fehlender nicht.
 * Ein Pflichtfeld hier hieße also: der Vorschlag lügt, damit er gespeichert
 * werden darf.
 *
 * Ein **völlig leerer** Vorschlag ist trotzdem keiner. Er stünde als Zeile im
 * Korb, verlangte eine Entscheidung und hätte nichts, worüber zu entscheiden
 * wäre. Die Prüfung dafür hängt am ganzen Objekt und nicht an einem Feld: es
 * ist keines der fünf falsch, es fehlen alle fünf. Die Meldung landet deshalb
 * über dem Formular (`ProposalFormState.message`) und nicht unter einem Feld,
 * an dem sie niemand erwartet.
 *
 * Die Grenzen und Meldungen für Titel, Tag und Notiz sind wortgleich die des
 * Blattformulars, und die Zahlen kommen aus @/lib/materials. Ein Vorschlag ist
 * der Entwurf genau dieses Formulars; was hier durchkommt und dort abgewiesen
 * würde, wäre ein Vorschlag, den man nicht übernehmen kann.
 */
export const proposalInputSchema = z
  .object({
    /**
     * Leer heißt: das Fach des Blattes bleibt. Gefiltert wird gegen dieselbe
     * Form, die auch `isId()` vor jeder Abfrage verlangt — eine zweite
     * uuid-Regel wäre eine zweite Wahrheit. Ob das Fach dem Nutzer gehört,
     * kann ein Schema nicht wissen; das prüft `createProposal()`.
     */
    subjectId: z
      .string()
      .trim()
      .nullish()
      .transform((value) => (value && value.length > 0 ? value : null))
      .refine(
        (value) => value === null || isId(value),
        "Dieses Fach gibt es nicht.",
      ),
    title: optionalText(
      MATERIAL_TITLE_MAX,
      "Der Titel ist zu lang — höchstens 80 Zeichen.",
    ),
    capturedOn: z
      .string()
      .trim()
      .nullish()
      .transform((value) => (value && value.length > 0 ? value : null))
      .refine(
        (value) => value === null || isCalendarDate(value),
        "Dieses Datum gibt es nicht.",
      )
      // Der Zukunfts-Test greift nur, wenn das Datum überhaupt lesbar ist —
      // sonst stünden zwei Meldungen an einem Feld.
      .refine(
        (value) =>
          value === null ||
          !isCalendarDate(value) ||
          value <= todayInBerlin(),
        "Dieser Tag ist noch nicht gewesen.",
      ),
    note: optionalText(
      MATERIAL_NOTE_MAX,
      "Die Notiz ist zu lang — höchstens 500 Zeichen.",
    ),
    /**
     * Freier Text, kein Verweis ins Vokabular — der Grund dafür steht an
     * `materialProposalTopics`. `normalizeTopics()` schneidet hier schon zu,
     * was auch beim Übernehmen zugeschnitten würde: getrimmt, ohne Leerzeilen,
     * ohne Dubletten, höchstens `PROPOSAL_TOPIC_LIMIT` Stück.
     */
    topics: z
      .array(z.string())
      .nullish()
      .transform((value) => normalizeTopics(value ?? [])),
  })
  .refine(
    (input) =>
      input.subjectId !== null ||
      input.title !== null ||
      input.capturedOn !== null ||
      input.note !== null ||
      input.topics.length > 0,
    "Ein Vorschlag, der nichts vorschlägt, ist keiner.",
  );

export type ProposalInput = z.infer<typeof proposalInputSchema>;

/**
 * Fehler pro Feld, so wie das Formular sie einsammelt.
 *
 * „topics" steht anders als bei `MaterialFieldErrors` nicht zusätzlich dabei —
 * hier ist es ein Feld der Eingabe wie die vier anderen.
 */
export type ProposalFieldErrors = Partial<Record<keyof ProposalInput, string>>;

/** Rückgabe der Server Actions an useActionState. */
export type ProposalFormState = {
  /**
   * Hinweis über dem Formular, wenn es nicht an einem einzelnen Feld liegt —
   * hier vor allem der leere Vorschlag, dem kein Feld allein fehlt.
   */
  message?: string;
  /** Bestätigung nach dem Speichern. */
  notice?: string;
  errors?: ProposalFieldErrors;
  /**
   * Wie oft dieses Formular geschrieben hat. Hochgezählt bei jedem Speichern,
   * das die Datenbank erreicht hat, und bei keinem, das vorher an der Prüfung
   * hängen geblieben ist. Wozu der Zähler gut ist und warum es kein Schalter
   * sein darf, steht an `MaterialFormState` in @/lib/materials.
   */
  saves?: number;
};

/** Ein Vorschlag, so wie er auf dem Bildschirm steht. */
export type ProposalItem = {
  id: string;
  origin: ProposalOrigin;
  createdAt: Date;
  subjectId: string | null;
  title: string | null;
  capturedOn: string | null;
  note: string | null;
  /** Die vorgeschlagenen Themen als Titel, in ihrer Reihenfolge. */
  topics: string[];
};

/** Eine Zeile im Eingangskorb: ein Blatt und die Vorschläge daran. */
export type InboxEntry = MaterialListItem & {
  /** Wann das Blatt durchgesehen wurde. Leer heißt: es liegt noch im Korb. */
  filedAt: Date | null;
  proposals: ProposalItem[];
};

/** Das Blatt, wie es jetzt dasteht — die Ausgangslage der Rechnung. */
export type PrefillMaterial = {
  subjectId: string;
  subjectName: string;
  title: string;
  capturedOn: string;
  note: string | null;
  topics: string[];
};

/** Der Vorschlag daneben. Jedes Feld darf leer sein; leer heißt „schweigt". */
export type PrefillProposal = {
  subjectId: string | null;
  subjectName: string | null;
  title: string | null;
  capturedOn: string | null;
  note: string | null;
  topics: string[];
};

/** Ein Feld, das der Vorschlag am Blatt ändern würde. */
export type PrefillChange = {
  feld: "Fach" | "Titel" | "Tag" | "Notiz" | "Themen";
  vorher: string;
  nachher: string;
};

export type Prefill = {
  /** Genau die Werte, mit denen das Handformular vorbelegt wird. */
  werte: {
    subjectId: string;
    title: string;
    capturedOn: string;
    note: string | null;
    topics: string[];
  };
  /** Was sich dadurch gegenüber dem Blatt ändert — für die Gegenüberstellung. */
  aenderungen: PrefillChange[];
};

/** Wie viele Zeilen der Korb höchstens hergibt. */
type InboxOptions = { limit?: number };

/**
 * Der Eingangskorb: Blätter, die noch eine Entscheidung brauchen.
 *
 * Zwei Fälle kommen hinein, und der zweite ist der wichtigere:
 *
 * - Das Blatt ist nie durchgesehen worden (`filed_at is null`). Das ist der
 *   Zustand nach dem Auslösen der Kamera: „Blatt vom 21.8." ohne Thema.
 * - Am Blatt hängt mindestens ein offener Vorschlag. Ein Agent kann auch zu
 *   einem längst abgehakten Blatt etwas vorschlagen — der Vorschlag braucht
 *   trotzdem eine Entscheidung, und ein Korb, der ihn nicht zeigt, ist ein
 *   Korb, in dem er verhungert.
 *
 * **Sortiert wird nach dem jüngsten Ereignis am Blatt** und ausdrücklich nicht
 * nach `created_at` des Blattes allein: ein frischer Vorschlag zu einem alten
 * Blatt rutschte sonst ans Ende und wäre in einem Korb, den man von oben
 * abarbeitet, unsichtbar. Der Schlüssel ist deshalb
 * `greatest(materials.created_at, coalesce(<jüngster Vorschlag>,
 * materials.created_at))`, absteigend.
 *
 * Der jüngste Vorschlag kommt als Unterabfrage (`max(created_at) group by
 * material_id`) über einen `leftJoin` dazu, damit Sortierung UND `limit` in
 * SQL passieren. Nachträglich in JavaScript zu sortieren wäre nicht dasselbe:
 * das `limit` schnitte dann nach dem falschen Schlüssel ab — die Datenbank
 * gäbe die zweihundert jüngsten Blätter heraus und JavaScript sortierte
 * hinterher zweihundert falsche Zeilen um. Genau das eine Blatt, dessen
 * Vorschlag von heute Morgen ist, wäre nie dabei.
 *
 * Danach werden Seiten, Themen und Vorschläge nachgeholt — vier Abfragen für
 * die ganze Liste und keine je Blatt. Das Muster ist das von `decorate()` und
 * `withTopics()` in @/lib/materials; die beiden sind dort privat und deshalb
 * hier gleichwertig nachgebaut. `listMaterials()` selbst geht nicht: es
 * filtert nach Fach und sortiert nach Schultag, also nach beidem, was der Korb
 * gerade nicht will.
 */
export async function listInbox(
  userId: string,
  options?: InboxOptions,
): Promise<InboxEntry[]> {
  const latest = latestProposals(userId);

  const rows = await db
    .select(INBOX_FIELDS)
    .from(materials)
    .innerJoin(
      subjects,
      and(eq(subjects.id, materials.subjectId), eq(subjects.userId, userId)),
    )
    .leftJoin(latest, eq(latest.materialId, materials.id))
    .where(
      and(
        eq(materials.userId, userId),
        or(isNull(materials.filedAt), isNotNull(latest.lastAt)),
      ),
    )
    .orderBy(
      desc(lastEventAt(latest)),
      // Zwei Blätter, die im selben Moment aufgenommen wurden, brauchen
      // trotzdem eine feste Reihenfolge — sonst steht der Korb bei jedem
      // Neuladen anders da.
      desc(materials.createdAt),
      desc(materials.id),
    )
    .limit(clampLimit(options?.limit));

  return assemble(userId, rows);
}

/**
 * Wie viele Blätter im Korb liegen — die Zahl am Einstiegspunkt.
 *
 * Dieselbe Bedingung wie `listInbox()`, aber `count(*)` und keiner der
 * Nachladeschritte: `/material` fragt sie bei jedem Aufruf, und die Seite soll
 * dafür nicht zweihundert Zeilen samt Seiten, Themen und Vorschlägen holen,
 * um sie zu zählen.
 *
 * Der Verbund auf `subjects` fehlt hier, obwohl `listInbox()` ihn führt. Er
 * kann dort keine Zeile wegnehmen — `materials.subject_id` ist notNull und
 * hängt mit „cascade" am Fach, ein Blatt überlebt sein Fach also nicht. Der
 * Verbund steht drüben nur, weil die Liste Name, Kürzel und Farbe zeigt; zum
 * Zählen holte er dieselbe Zeile ein zweites Mal.
 */
export async function countInbox(userId: string): Promise<number> {
  const latest = latestProposals(userId);

  const [row] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(materials)
    .leftJoin(latest, eq(latest.materialId, materials.id))
    .where(
      and(
        eq(materials.userId, userId),
        or(isNull(materials.filedAt), isNotNull(latest.lastAt)),
      ),
    );

  return Number(row?.total ?? 0);
}

/**
 * Ein Vorschlag samt dem Blatt, zu dem er gehört — für die Bestätigungsseite.
 *
 * Beides zusammen, weil beides zusammen gebraucht wird: die Seite stellt den
 * Vorschlag dem Blatt gegenüber, und `prefillFromProposal()` braucht ohnehin
 * beide Seiten. Zwei Aufrufe an zwei Stellen wären zwei Gelegenheiten, das
 * falsche Blatt danebenzulegen.
 *
 * Das Blatt kommt über `getMaterial()` aus @/lib/materials und nicht über eine
 * eigene Abfrage — es ist dasselbe `MaterialDetail`, das die Detailseite
 * zeigt, mit denselben Seiten und denselben aufgelösten Themen.
 */
export async function getProposal(
  userId: string,
  id: string,
): Promise<{ proposal: ProposalItem; material: MaterialDetail } | null> {
  if (!isId(id)) return null;

  const row = await findProposal(userId, id);
  if (!row) return null;

  const material = await getMaterial(userId, row.materialId);
  if (!material) return null;

  const topics = await loadProposalTopics(userId, [row.id]);

  return { proposal: toProposalItem(row, topics.get(row.id) ?? []), material };
}

/**
 * Legt einen Vorschlag an und gibt seine id zurück. Null heißt: das Blatt
 * gehört dem Nutzer nicht (mehr), oder das vorgeschlagene Fach ist ein fremdes.
 *
 * Beides wird geprüft und nicht gehofft. Ein Vorschlag an einem fremden Blatt
 * wäre ein Schreibzugriff über die Blattgrenze hinweg — genau der Fall, gegen
 * den der Verbund in jeder Leseabfrage steht. Und ein Fachvorschlag auf ein
 * fremdes Fach schöbe das Blatt beim Übernehmen dorthin, wo es in keiner Liste
 * wieder auftaucht; `updateMaterial()` lehnte das später ab, aber dann steht
 * der Vorschlag schon im Korb und lässt sich nicht bestätigen.
 *
 * Vorschlag und Themen entstehen in einer Transaktion: ein Vorschlag ohne
 * seine Themen ist ein anderer Vorschlag, und beim Übernehmen ersetzte er
 * still die vorhandenen Themen durch nichts.
 *
 * `origin` steht als Parameter und nicht im Schema. Woher ein Vorschlag kommt,
 * entscheidet die Tür, durch die er hereinkommt — die Server Action des
 * Formulars oder das MCP-Tool des Agenten —, und nicht das Formular selbst.
 * Stünde es im Schema, könnte sich jeder Absender als Agent ausgeben oder,
 * schlimmer, ein Agent als Mensch.
 */
export async function createProposal(
  userId: string,
  materialId: string,
  input: ProposalInput,
  origin: ProposalOrigin = "manuell",
): Promise<string | null> {
  if (!isId(materialId)) return null;
  if (!(await ownsMaterial(userId, materialId))) return null;
  if (!(await ownsProposedSubject(userId, input.subjectId))) return null;

  return db.transaction(async (tx): Promise<string | null> => {
    const [created] = await tx
      .insert(materialProposals)
      .values({
        materialId,
        origin,
        subjectId: input.subjectId,
        title: input.title,
        capturedOn: input.capturedOn,
        note: input.note,
      })
      .returning({ id: materialProposals.id });

    if (!created) return null;

    if (input.topics.length > 0) {
      await tx.insert(materialProposalTopics).values(
        input.topics.map((title, index) => ({
          proposalId: created.id,
          title,
          sortOrder: index,
        })),
      );
    }

    return created.id;
  });
}

/**
 * Ändert einen Vorschlag. Falsch heißt: den Vorschlag gibt es nicht (mehr),
 * oder das vorgeschlagene Fach gehört jemand anderem.
 *
 * **Die Themen werden komplett ersetzt und nicht abgeglichen** — dieselbe
 * Begründung wie bei `setMaterialTopics()` in @/lib/materials: die Zeile in
 * `material_proposal_topics` besteht aus Titel und Reihenfolge und trägt keine
 * Geschichte, die ein Abgleich retten könnte. Wegwerfen ist hier also
 * folgenlos, und die Reihenfolge kommt dabei richtig heraus, statt aus alten
 * und neuen Nummern zusammengesetzt zu werden.
 *
 * Ersetzen und Ändern stehen in einer Transaktion: dazwischen stünde ein
 * Vorschlag ohne Themen, und wer in genau diesem Moment übernimmt, wischt sich
 * die Themen des Blattes weg.
 */
export async function updateProposal(
  userId: string,
  id: string,
  input: ProposalInput,
): Promise<boolean> {
  if (!isId(id)) return false;

  const existing = await findProposal(userId, id);
  if (!existing) return false;
  if (!(await ownsProposedSubject(userId, input.subjectId))) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(materialProposals)
      .set({
        subjectId: input.subjectId,
        title: input.title,
        capturedOn: input.capturedOn,
        note: input.note,
      })
      .where(eq(materialProposals.id, id));

    await tx
      .delete(materialProposalTopics)
      .where(eq(materialProposalTopics.proposalId, id));

    if (input.topics.length > 0) {
      await tx.insert(materialProposalTopics).values(
        input.topics.map((title, index) => ({
          proposalId: id,
          title,
          sortOrder: index,
        })),
      );
    }
  });

  return true;
}

/**
 * Verwirft einen Vorschlag. Die Zeile ist danach weg, samt ihren Themen
 * („cascade") — einen Zustand „verworfen" gibt es nicht, und warum, steht an
 * `materialProposals`.
 *
 * Gesucht wird über den Verbund, gelöscht über die geprüfte id. Ein DELETE
 * kennt keinen Verbund; die Frage nach dem Besitzer steht deshalb eine
 * Anweisung früher. Dass die id zwischen beiden Anweisungen den Besitzer
 * wechselt, kann nicht passieren: ein Vorschlag hängt über `material_id` an
 * genau einem Blatt, und ein Blatt wechselt den Nutzer nie.
 */
export async function deleteProposal(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!isId(id)) return false;

  const existing = await findProposal(userId, id);
  if (!existing) return false;

  const removed = await db
    .delete(materialProposals)
    .where(eq(materialProposals.id, id))
    .returning({ id: materialProposals.id });

  return removed.length > 0;
}

/**
 * Alle offenen Vorschläge eines Blattes wegräumen. Gibt zurück, wie viele es
 * waren.
 *
 * **Alle, ohne Ausnahme — auch der gerade übernommene.** Der Grund ist, dass
 * eine Entscheidung getroffen wurde: die anderen Vorschläge zu demselben Blatt
 * beziehen sich auf einen Titel, einen Tag und Themen, die es so nicht mehr
 * gibt, und der übernommene ist in dem Moment aufgegangen, in dem er den
 * Bestand erreicht hat. Sie stehenzulassen hieße, dass der Korb nach einer
 * Entscheidung nicht leerer wird, sondern voller Entwürfe steht, die gegen
 * einen Stand geprüft werden müssten, den niemand mehr sieht.
 *
 * Hier gab es einmal einen Parameter, der einen einzelnen Vorschlag ausnahm.
 * Er ist wieder weg, weil ihn niemand gerufen hat und weil er die Aussage der
 * Tabelle verwässerte: eine Zeile darin ist ein OFFENER Vorschlag, und ein
 * übernommener ist keiner mehr.
 *
 * Die Zahl ist die der wirklich gelöschten Zeilen und keine Schätzung. Wer
 * daraus „wie viele andere fielen weg?" ableiten will, zieht den übernommenen
 * ab — das tut `confirmProposalAction()`, und es steht dort hingeschrieben.
 */
export async function clearProposals(
  userId: string,
  materialId: string,
): Promise<number> {
  if (!isId(materialId)) return 0;
  if (!(await ownsMaterial(userId, materialId))) return 0;

  const removed = await db
    .delete(materialProposals)
    .where(eq(materialProposals.materialId, materialId))
    .returning({ id: materialProposals.id });

  return removed.length;
}

/**
 * Legt das Blatt aus dem Korb („durchgesehen") oder wieder hinein.
 *
 * **Ein schon gesetzter Zeitpunkt bleibt stehen.** `filed_at` beantwortet die
 * Frage „wann hat ein Mensch hingesehen?", und die hat genau eine Antwort.
 * Gesetzt wird die Spalte an drei Stellen — beim Abhaken, beim Speichern des
 * Blattformulars und beim Übernehmen eines Vorschlags —, und zwei davon können
 * am selben Blatt nacheinander vorkommen. Schriebe jede von ihnen `now()`,
 * verschöbe ein zweites Speichern den Tag auf heute, und „seit wann liegt das
 * da?" wäre nicht mehr zu beantworten.
 *
 * Deshalb steht die Frage vor dem Schreiben und nicht als `coalesce` in einem
 * einzigen UPDATE: der Weg ist derselbe wie bei `updateMaterial()` — erst
 * suchen, dann schreiben —, und er sagt in einer Zeile, was er tut. Zwei
 * Geräte, die im selben Moment abhaken, könnten sich dabei um Millisekunden
 * überholen; das ist der ganze Schaden, und er trifft eine Spalte, die auf den
 * Tag genau gelesen wird.
 *
 * **Drei Antworten und nicht zwei.** „weg" heißt: das Blatt gibt es nicht
 * (mehr) oder es gehört jemand anderem. „gesetzt" heißt: es hat den Zustand
 * gewechselt. „unveraendert" heißt: es war schon so — auch das ist ein Erfolg,
 * aber ein anderer.
 *
 * Der Unterschied zwischen den beiden letzten ist kein Selbstzweck. Das
 * Blattformular hakt beim Speichern mit ab, und es soll das nur dann
 * hinschreiben, wenn wirklich etwas umgeschaltet wurde — ein Satz „damit ist
 * es aus dem Eingangskorb heraus" unter jedem Speichern eines längst
 * durchgesehenen Blattes wäre eine Meldung über nichts. Ein blankes `true`
 * ließe das nicht unterscheiden, und die Action müsste vorher selbst
 * nachsehen: eine zweite Abfrage für eine Antwort, die diese Funktion schon
 * in der Hand hält.
 */
export async function markFiled(
  userId: string,
  materialId: string,
  filed: boolean,
): Promise<"gesetzt" | "unveraendert" | "weg"> {
  if (!isId(materialId)) return "weg";

  const [row] = await db
    .select({ id: materials.id, filedAt: materials.filedAt })
    .from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.id, materialId)))
    .limit(1);

  if (!row) return "weg";

  const istAbgehakt = row.filedAt !== null;
  if (filed === istAbgehakt) return "unveraendert";

  await db
    .update(materials)
    .set({ filedAt: filed ? new Date() : null })
    .where(and(eq(materials.userId, userId), eq(materials.id, materialId)));

  return "gesetzt";
}

/**
 * Was aus Blatt und Vorschlag zusammen wird: die Vorbelegung des Handformulars
 * und die Gegenüberstellung daneben.
 *
 * Die eine Stelle, an der „leer heißt: dazu sage ich nichts" ausgerechnet
 * wird. Ohne sie stünde dieselbe Entscheidung an vier Feldern in einer
 * Komponente, und ein vergessenes `??` machte aus einem Schweigen ein Löschen.
 *
 * Die Regeln, und jede hat ihren Grund:
 *
 * - **Je Feld gilt der Wert des Vorschlags, wenn er gesetzt ist, sonst der des
 *   Blattes.** Leer heißt „dazu sage ich nichts" und nicht „lösch das". Ein
 *   Vorschlag kann deshalb nichts entfernen, nur ersetzen — wer die Notiz
 *   loswerden will, leert das Feld im Formular, und das ist ein Mensch und
 *   kein Agent.
 * - **Themen: die des Vorschlags, wenn er welche nennt, sonst die des
 *   Blattes.** Das ist dieselbe Regel, aber sie muss hinstehen, weil sie sonst
 *   still bricht: beim Übernehmen ersetzt `setMaterialTopics()` die ganze
 *   Menge, eine leere Liste löschte also alle Themen des Blattes — und zwar
 *   ohne dass irgendwo etwas danach aussähe.
 * - **`aenderungen` nennt ein Feld nur, wenn der Wert sich wirklich vom Blatt
 *   unterscheidet.** Ein Vorschlag, der denselben Titel noch einmal sagt, ist
 *   keine Änderung; stünde er in der Liste, müsste der Mensch bei jeder
 *   Bestätigung Zeilen lesen, in denen zweimal dasselbe steht, und übersähe
 *   darin die eine, die zählt.
 * - **Themen gelten als gleich, wenn dieselbe Menge dasteht** — Reihenfolge
 *   und Groß-/Kleinschreibung zählen nicht. Verglichen wird über `topicKey()`
 *   aus @/lib/topics, also über genau die Faltung, mit der auch sonst zwei
 *   Titel als derselbe gelten; eine eigene hier wäre eine zweite Wahrheit.
 *   Sortiert wird nach Zeichencode und nicht mit `localeCompare` — verglichen
 *   werden Schlüssel und keine Anzeigetitel, und das Ergebnis darf nicht davon
 *   abhängen, welche Sortiertabelle die Laufzeit mitbringt.
 * - **Beim Fach stehen Namen und keine ids**, denn die Zeile landet auf dem
 *   Bildschirm. Verglichen wird trotzdem über die id: zwei Fächer dürfen
 *   denselben Namen tragen. Kennt der Aufrufer den Namen des vorgeschlagenen
 *   Fachs nicht, steht dort das Zeichen für „nichts" — die Änderung zu
 *   verschweigen wäre schlimmer als sie unvollständig zu zeigen.
 * - **Der Tag steht als „14.9.2026" da**, mit Jahr. Die Kurzform aus
 *   @/lib/dates lässt es weg, und „Mi, 14.9." gegen „So, 14.9." sähe in einer
 *   Gegenüberstellung nach einem Wochentagsfehler aus statt nach einem Jahr
 *   Unterschied. Verglichen wird auf den Kalendertagen selbst, formatiert wird
 *   nur, was angezeigt wird.
 * - **Was leer ist, steht als „—" da** und nicht als leere Zelle. Eine leere
 *   Zelle liest sich wie ein Fehler in der Darstellung; „—" liest sich wie
 *   eine Aussage, und genau eine ist es. Bei der Notiz kann das Zeichen nur
 *   links stehen: ein Vorschlag kann eine Notiz hinzufügen, aber keine
 *   wegnehmen.
 *
 * Reine Rechnung: keine Datenbank, keine Systemuhr. Deshalb steht sie hier und
 * lässt sich prüfen, ohne dass ein Test eine Datenbank braucht.
 */
export function prefillFromProposal(
  material: PrefillMaterial,
  proposal: PrefillProposal,
): Prefill {
  const subjectId = proposal.subjectId ?? material.subjectId;
  const title = proposal.title ?? material.title;
  const capturedOn = proposal.capturedOn ?? material.capturedOn;
  const note = proposal.note ?? material.note;

  // **Wechselt das Fach, fallen die Themen des Blattes weg** — auch dann, wenn
  // der Vorschlag über Themen schweigt.
  //
  // Das ist dieselbe Entscheidung, die `updateMaterial()` beim Fachwechsel
  // trifft und die das Blattformular sichtbar vorwegnimmt (`chooseSubject()`
  // leert dort die Chips). Auf diesem Weg griff sie nicht: das Formular
  // vergleicht gegen `item.subjectId`, und das ist hier schon das
  // VORGESCHLAGENE Fach — für das Formular hat also niemand gewechselt.
  //
  // Ohne diese Zeilen ginge Folgendes still schief: ein Vorschlag, der nur
  // „Physik" sagt, nähme „Kettenregel" mit — `updateMaterial()` löste die
  // Paarung im Mathematik-Vokabular auf, und `setMaterialTopics()` legte die
  // Vokabel danach in Physik NEU an. Übrig bliebe ein Fachwort, das dort nie
  // jemand getippt hat, und Themen lassen sich nirgends löschen; man könnte es
  // nur noch umbenennen oder hinter einem anderen verstecken.
  //
  // Nennt der Vorschlag eigene Themen, gelten die — auch im neuen Fach. Dann
  // ist es keine Mitnahme, sondern eine Aussage, und sie steht in der
  // Gegenüberstellung.
  const subjectChanged = subjectId !== material.subjectId;
  const topics =
    proposal.topics.length > 0
      ? proposal.topics
      : subjectChanged
        ? []
        : material.topics;

  const aenderungen: PrefillChange[] = [];

  if (subjectChanged) {
    aenderungen.push({
      feld: "Fach",
      vorher: material.subjectName,
      nachher: proposal.subjectName ?? EMPTY_VALUE,
    });
  }

  if (title !== material.title) {
    aenderungen.push({ feld: "Titel", vorher: material.title, nachher: title });
  }

  if (capturedOn !== material.capturedOn) {
    aenderungen.push({
      feld: "Tag",
      vorher: dayLabel(material.capturedOn),
      nachher: dayLabel(capturedOn),
    });
  }

  if (note !== material.note) {
    aenderungen.push({
      feld: "Notiz",
      vorher: material.note ?? EMPTY_VALUE,
      nachher: note ?? EMPTY_VALUE,
    });
  }

  if (!sameTopics(material.topics, topics)) {
    aenderungen.push({
      feld: "Themen",
      vorher: topicLabel(material.topics),
      nachher: topicLabel(topics),
    });
  }

  return {
    werte: { subjectId, title, capturedOn, note, topics },
    aenderungen,
  };
}

/** Das Zeichen für „hier steht nichts", überall dasselbe. */
const EMPTY_VALUE = "—";

/**
 * Die Felder eines Blattes im Korb: dieselben wie in der Ablage, plus
 * `filedAt` — und ausdrücklich ohne die beiden bytea-Spalten.
 */
const INBOX_FIELDS = {
  id: materials.id,
  title: materials.title,
  capturedOn: materials.capturedOn,
  note: materials.note,
  filedAt: materials.filedAt,
  subjectId: subjects.id,
  subjectName: subjects.name,
  subjectShort: subjects.short,
  subjectColor: subjects.color,
};

type InboxRow = {
  id: string;
  title: string;
  capturedOn: string;
  note: string | null;
  filedAt: Date | null;
  subjectId: string;
  subjectName: string;
  subjectShort: string;
  subjectColor: string;
};

/** Die Felder eines Vorschlags, in jeder Abfrage dieselben. */
const PROPOSAL_FIELDS = {
  id: materialProposals.id,
  materialId: materialProposals.materialId,
  origin: materialProposals.origin,
  createdAt: materialProposals.createdAt,
  subjectId: materialProposals.subjectId,
  title: materialProposals.title,
  capturedOn: materialProposals.capturedOn,
  note: materialProposals.note,
};

type ProposalRow = {
  id: string;
  materialId: string;
  origin: string;
  createdAt: Date;
  subjectId: string | null;
  title: string | null;
  capturedOn: string | null;
  note: string | null;
};

/**
 * Der jüngste Vorschlag je Blatt, als Unterabfrage.
 *
 * Sie steht getrennt, weil `listInbox()` und `countInbox()` dieselbe Bedingung
 * stellen müssen: die Zahl am Einstiegspunkt und die Liste dahinter dürfen
 * nicht verschieden zählen. Zwei Fassungen wären genau die Stelle, an der die
 * eine Seite „3" sagt und die andere zwei Zeilen zeigt.
 *
 * Der Verbund auf `materials` steht auch hier, obwohl die äußere Abfrage schon
 * nach dem Nutzer filtert: die Regel aus dem Kopf dieser Datei gilt für jede
 * Abfrage auf `material_proposals`, nicht nur für die, bei denen es auffiele.
 * Er läuft über einen Aliasnamen, weil `materials` in der äußeren Abfrage
 * schon steht und Postgres sonst nicht wüsste, welche der beiden gemeint ist.
 *
 * Die Spalten tragen eigene Namen (`proposal_material_id`,
 * `last_proposal_at`). Drizzle schreibt die Bedingung eines Verbunds auf eine
 * Unterabfrage ohne deren Namen davor; hieße die Spalte schlicht `material_id`
 * und stünde in derselben Abfrage noch eine gleichnamige, wiese Postgres sie
 * als mehrdeutig zurück.
 */
function latestProposals(userId: string) {
  const owner = alias(materials, "proposal_owner");

  return db
    .select({
      materialId: sql<string>`${materialProposals.materialId}`.as(
        "proposal_material_id",
      ),
      lastAt: sql<Date>`max(${materialProposals.createdAt})`.as(
        "last_proposal_at",
      ),
    })
    .from(materialProposals)
    .innerJoin(
      owner,
      and(
        eq(owner.id, materialProposals.materialId),
        eq(owner.userId, userId),
      ),
    )
    .groupBy(materialProposals.materialId)
    .as("latest_proposals");
}

/**
 * Der Sortierschlüssel des Korbs: das jüngste Ereignis am Blatt.
 *
 * `coalesce` fängt das Blatt ohne Vorschlag ab (der `leftJoin` liefert dort
 * null), `greatest` sorgt dafür, dass ein Blatt nicht nach hinten rutscht,
 * weil sein einziger Vorschlag älter ist als es selbst — das kann nach einem
 * Löschen und Neuanlegen vorkommen.
 */
function lastEventAt(latest: ReturnType<typeof latestProposals>) {
  return sql`greatest(
    ${materials.createdAt},
    coalesce(${latest.lastAt}, ${materials.createdAt})
  )`;
}

/**
 * Hängt an die geladenen Blätter, was der Korb zeigt: Seitenzahl und
 * Vorschaubild, die Themen des Blattes und die Vorschläge daran.
 *
 * Drei Nachfragen für die ganze Liste (die Themen der Vorschläge sind die
 * vierte) und keine je Blatt. Nacheinander und nicht nebeneinander: PGlite
 * führt genau eine Verbindung, ein `Promise.all` gewänne dort nichts und
 * verstellte nur den Blick darauf, welche Abfrage gerade läuft.
 */
async function assemble(
  userId: string,
  rows: InboxRow[],
): Promise<InboxEntry[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const pages = await loadPages(userId, ids);
  const topics = await loadMaterialTopics(userId, ids);
  const proposals = await loadProposals(userId, ids);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    capturedOn: row.capturedOn,
    note: row.note,
    filedAt: row.filedAt,
    subject: {
      id: row.subjectId,
      name: row.subjectName,
      short: row.subjectShort,
      color: row.subjectColor,
    },
    pageCount: pages.get(row.id)?.pageCount ?? 0,
    coverPageId: pages.get(row.id)?.coverPageId ?? null,
    topics: topics.get(row.id) ?? [],
    proposals: proposals.get(row.id) ?? [],
  }));
}

/**
 * Seitenzahl und erste Seite für eine ganze Liste auf einmal.
 *
 * Geholt werden nur ids und Reihenfolge — die Bytes bleiben, wo sie sind.
 */
async function loadPages(
  userId: string,
  materialIds: string[],
): Promise<Map<string, { pageCount: number; coverPageId: string }>> {
  const byMaterial = new Map<
    string,
    { pageCount: number; coverPageId: string }
  >();

  const rows = await db
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
    .where(inArray(materialPages.materialId, materialIds))
    .orderBy(asc(materialPages.sortOrder), asc(materialPages.createdAt));

  for (const row of rows) {
    const known = byMaterial.get(row.materialId);

    if (known) {
      known.pageCount += 1;
      continue;
    }

    byMaterial.set(row.materialId, { pageCount: 1, coverPageId: row.id });
  }

  return byMaterial;
}

/**
 * Die Themen mehrerer Blätter auf einmal, samt aufgelösten Zusammenlegungen.
 *
 * Gleichwertig zu `loadTopics()` in @/lib/materials, das dort privat ist. Der
 * `leftJoin` auf dieselbe Tabelle hält die Regel aus @/lib/subject-topics: wer
 * eine zusammengelegte Vokabel vor sich hat, zeigt ihr Ziel. Ein
 * `resolveTopic()` je Thema wäre bei einem vollen Korb mehrere hundert Wege
 * zur Datenbank für eine einzige Liste.
 */
async function loadMaterialTopics(
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
      and(eq(target.id, subjectTopics.mergedInto), eq(target.userId, userId)),
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
 * Die Vorschläge mehrerer Blätter auf einmal, je Blatt der jüngste zuerst.
 *
 * Zwei Abfragen für die ganze Liste: eine für die Vorschläge, eine für ihre
 * Themen. Je Vorschlag eine wären bei einem Korb voller Agentenvorschläge
 * zweihundert Wege zur Datenbank für dieselbe Seite.
 */
async function loadProposals(
  userId: string,
  materialIds: string[],
): Promise<Map<string, ProposalItem[]>> {
  const byMaterial = new Map<string, ProposalItem[]>();
  if (materialIds.length === 0) return byMaterial;

  const rows = await db
    .select(PROPOSAL_FIELDS)
    .from(materialProposals)
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialProposals.materialId),
        eq(materials.userId, userId),
      ),
    )
    .where(inArray(materialProposals.materialId, materialIds))
    // Die id als zweiter Schlüssel: zwei Vorschläge aus derselben Sekunde
    // brauchen eine feste Reihenfolge, sonst steht die Seite bei jedem
    // Neuladen anders da.
    .orderBy(desc(materialProposals.createdAt), desc(materialProposals.id));

  if (rows.length === 0) return byMaterial;

  const topics = await loadProposalTopics(
    userId,
    rows.map((row) => row.id),
  );

  for (const row of rows) {
    const list = byMaterial.get(row.materialId) ?? [];
    list.push(toProposalItem(row, topics.get(row.id) ?? []));
    byMaterial.set(row.materialId, list);
  }

  return byMaterial;
}

/**
 * Die vorgeschlagenen Themen mehrerer Vorschläge auf einmal, in ihrer
 * Reihenfolge.
 *
 * Der Weg zum Nutzer geht über zwei Verbünde: die Zeile kennt nur ihren
 * Vorschlag, der Vorschlag kennt das Blatt, und erst am Blatt steht die
 * userId. Ohne den zweiten Verbund zeigte eine geratene proposalId fremde
 * Themen.
 */
async function loadProposalTopics(
  userId: string,
  proposalIds: string[],
): Promise<Map<string, string[]>> {
  const byProposal = new Map<string, string[]>();
  if (proposalIds.length === 0) return byProposal;

  const rows = await db
    .select({
      proposalId: materialProposalTopics.proposalId,
      title: materialProposalTopics.title,
    })
    .from(materialProposalTopics)
    .innerJoin(
      materialProposals,
      eq(materialProposals.id, materialProposalTopics.proposalId),
    )
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialProposals.materialId),
        eq(materials.userId, userId),
      ),
    )
    .where(inArray(materialProposalTopics.proposalId, proposalIds))
    .orderBy(
      asc(materialProposalTopics.proposalId),
      asc(materialProposalTopics.sortOrder),
      asc(materialProposalTopics.id),
    );

  for (const row of rows) {
    const list = byProposal.get(row.proposalId) ?? [];
    list.push(row.title);
    byProposal.set(row.proposalId, list);
  }

  return byProposal;
}

/** Aus der Zeile wird der Vorschlag, wie ihn die Oberfläche sieht. */
function toProposalItem(row: ProposalRow, topics: string[]): ProposalItem {
  return {
    id: row.id,
    origin: toOrigin(row.origin),
    createdAt: row.createdAt,
    subjectId: row.subjectId,
    title: row.title,
    capturedOn: row.capturedOn,
    note: row.note,
    topics,
  };
}

/** Ein einzelner Vorschlag samt dem Blatt, an dem er hängt. */
async function findProposal(
  userId: string,
  id: string,
): Promise<ProposalRow | null> {
  if (!isId(id)) return null;

  const [row] = await db
    .select(PROPOSAL_FIELDS)
    .from(materialProposals)
    .innerJoin(
      materials,
      and(
        eq(materials.id, materialProposals.materialId),
        eq(materials.userId, userId),
      ),
    )
    .where(eq(materialProposals.id, id))
    .limit(1);

  return row ?? null;
}

/** Gehört das Blatt diesem Nutzer? Ohne das hängt der Vorschlag im Leeren. */
async function ownsMaterial(
  userId: string,
  materialId: string,
): Promise<boolean> {
  if (!isId(materialId)) return false;

  const [material] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.id, materialId)))
    .limit(1);

  return Boolean(material);
}

/**
 * Darf dieser Fachvorschlag so stehen bleiben?
 *
 * Kein Fach ist in Ordnung — leer heißt „das Fach des Blattes bleibt". Steht
 * eines da, muss es dem Nutzer gehören; die Frage stellen `createProposal()`
 * und `updateProposal()`, und sie soll für beide dieselbe sein.
 */
async function ownsProposedSubject(
  userId: string,
  subjectId: string | null,
): Promise<boolean> {
  return subjectId === null || (await ownsSubject(userId, subjectId));
}

/** Gehört das Fach diesem Nutzer? Prüfen, nicht hoffen. */
async function ownsSubject(userId: string, subjectId: string): Promise<boolean> {
  if (!isId(subjectId)) return false;

  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.id, subjectId)))
    .limit(1);

  return Boolean(subject);
}

/** Die Obergrenze gilt auch dann, wenn jemand eine höhere Zahl übergibt. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return INBOX_LIMIT;
  return Math.min(INBOX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Der Kalendertag, wie er in der Gegenüberstellung steht: „14.9.2026".
 *
 * Tag und Monat kommen aus `germanShortParts()`, damit die Schreibweise
 * dieselbe ist wie überall sonst; das Jahr steht dahinter, weil zwei Tage aus
 * verschiedenen Jahren sonst nicht zu unterscheiden wären. Ein Wert, der kein
 * Kalendertag ist, bleibt stehen, wie er ist — er kommt aus der Datenbank oder
 * aus dem geprüften Schema und kann es eigentlich nicht geben; ein Wurf wäre
 * hier trotzdem der falsche Preis.
 */
function dayLabel(date: string): string {
  if (!isCalendarDate(date)) return date;

  return `${germanShortParts(date).dayMonth}${date.slice(0, 4)}`;
}

/** Die Themen als eine Zeile. Keine Themen sind auch eine Aussage. */
function topicLabel(titles: string[]): string {
  return titles.length > 0 ? titles.join(", ") : EMPTY_VALUE;
}

/**
 * Meinen zwei Themenlisten dasselbe?
 *
 * **Verglichen wird mit `vocabularyKey()` und ausdrücklich nicht mit
 * `topicKey()`.** Das ist keine Feinheit, sondern die Bedingung dafür, dass
 * die Gegenüberstellung nicht lügt: Geschrieben wird beim Übernehmen über
 * `setMaterialTopics()` → `ensureTopics()` → `ensureVocabulary()`, und dort
 * entscheidet `vocabularyKey()`, welche Vokabel gemeint ist. Der faltet
 * erheblich mehr als `topicKey()` — „Kettenregel" und „Kettenregel Übungen"
 * fallen auf denselben Schlüssel, „Photosynthese" und „Fotosynthese" auch.
 *
 * Mit `topicKey()` verglichen kündigte die Seite an „Themen: Kettenregel →
 * Kettenregel Übungen", beim Übernehmen bliebe am Blatt aber alles beim Alten,
 * und kein Satz sagte es: „verworfen" greift nur bei einem Titel ohne Fachwort,
 * „zusammengefallen" nur, wenn ZWEI getippte Titel auf dieselbe Vokabel fallen.
 * Ein einzelner Titel, der auf eine vorhandene Vokabel fällt, verschwände
 * zwischen den beiden Listen hindurch. Wer hier den Schlüssel ändert, ändert
 * ihn in `ensureVocabulary()` mit — oder die Ankündigung ist wieder eine andere
 * Rechnung als die Tat.
 *
 * Was der Vergleich trotzdem nicht wissen kann: unter welcher **Schreibweise**
 * eine Vokabel im Fach schon steht. „Kettenregel Übungen" landet als
 * „Kettenregel" am Blatt, wenn das Fach diese Zeile führt — dazu müsste diese
 * reine Funktion die Datenbank lesen. Angekündigt wird deshalb der getippte
 * Titel, und was wirklich daraus wurde, sagt `setMaterialTopics()` hinterher
 * über `umbenannt`.
 *
 * Reihenfolge und Dubletten zählen nicht — die Begründung steht an
 * `prefillFromProposal()`.
 */
function sameTopics(left: string[], right: string[]): boolean {
  const a = topicKeys(left);
  const b = topicKeys(right);

  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** Die Schlüssel einer Themenliste, ohne Dubletten und in fester Ordnung. */
function topicKeys(titles: string[]): string[] {
  return [...new Set(titles.map(vocabularyKey))].sort();
}
