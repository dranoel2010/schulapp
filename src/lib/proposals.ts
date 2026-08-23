import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  materialPages,
  materials,
  proposals,
  subjects,
  type ProposalKind,
  type ProposalSource,
  type ProposalStatus,
} from "@/db/schema";
import { addDays, isCalendarDate, germanShortParts, todayInBerlin } from "@/lib/dates";
import { EXAM_KINDS } from "@/lib/exams";
import { normalizeTopics, topicKey } from "@/lib/topics";

/**
 * Der Eingangskorb — Datenzugriff und Prüfschemata.
 *
 * Hier liegt ein Vorschlag, bis ein Mensch ihn übernimmt oder verwirft. Ein
 * Vorschlag ist kein Datensatz der App: er ist die Frage, ob einer entstehen
 * soll. Deshalb steht in dieser Datei nichts, was Themen, Aufgaben oder
 * Prüfungen anlegt.
 *
 * **Übernommen wird durch dieselbe Tür wie ein Formular.** Die Server Action
 * des Korbs liest die Felder, die auf dem Bildschirm standen — nicht den
 * Vorschlag —, schickt sie durch `homeworkInputSchema`, `examInputSchema` oder
 * `setMaterialTopics()` und ruft danach `decideProposal()`. Der Vorschlag füllt
 * das Formular vor, mehr tut er nicht. Das ist die Bedingung, unter der ein
 * Agent überhaupt an diese App darf: er kann nichts schreiben, er kann nur
 * fragen, und die Antwort gibt ein Mensch mit denselben Prüfungen, die auch für
 * ihn selbst gelten.
 *
 * **Jeder Vorschlag hängt an einem Blatt.** Warum das kein nachträglich
 * eingeengter Fremdschlüssel ist, sondern die Aussage dieser Stufe, steht am
 * `proposals`-Block in @/db/schema.
 *
 * Jede Abfrage filtert zusätzlich nach userId, auch dort, wo die id schon
 * eindeutig wäre — dieselbe Regel wie überall in @/lib.
 *
 * Was in `payload` stehen darf, steht als zod-Schema weiter unten, und es wird
 * **zweimal** geprüft: beim Anlegen, und noch einmal bei jedem Lesen. Das ist
 * keine Doppelung aus Vorsicht. Eine jsonb-Spalte hält fest, was am Tag des
 * Schreibens erlaubt war; ändert sich das Schema, liegen in der Tabelle
 * Vorschläge, die heute keiner mehr anlegen dürfte. Ungeprüft gelesen ständen
 * sie als kaputte Karte auf dem Bildschirm. Geprüft gelesen fallen sie
 * stillschweigend heraus, und der Korb bleibt benutzbar.
 */

/**
 * So viele Vorschläge dürfen gleichzeitig offen stehen.
 *
 * Die Zahl ist kein Schutz vor einem böswilligen Agenten — der käme gar nicht
 * erst an ein Token —, sondern vor einem eifrigen. Ein Korb mit dreihundert
 * Karten wird nicht durchgesehen, er wird ignoriert, und dann ist der ganze
 * Weg umsonst gebaut. Fünfzig sind ein Nachmittag Arbeit; darüber ist die
 * ehrliche Antwort „räum erst auf“.
 */
export const MAX_OPEN_PROPOSALS = 50;

/**
 * So lange bleibt ein entschiedener Vorschlag im Korb sichtbar — dieselbe
 * Frist wie bei den abgehakten Hausaufgaben, und aus demselben Grund: man will
 * nachsehen können, was man gestern übernommen hat. Gelöscht wird nie.
 */
export const DECIDED_DAYS = 14;

/** Ein Satz zur Begründung, nicht ein Aufsatz. */
export const REASON_MAX = 300;

/** So lang darf der Titel einer vorgeschlagenen Aufgabe sein — wie im Formular. */
export const HOMEWORK_TITLE_MAX = 120;

/** Wie in `examInputSchema`: ein Titel neben dem Fach, keine Überschrift. */
export const EXAM_TITLE_MAX = 80;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eine kaputte id aus der Adresszeile würde Postgres sonst mit einem Typfehler
 * quittieren — hier wird daraus ein sauberes „gibt es nicht“.
 */
function isId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Leere Eingabe soll als `null` durchgehen und nicht als "". */
function optionalText(maxLength: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(maxLength, tooLong)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null));
}

/**
 * Ein Kalendertag, der auch fehlen darf.
 *
 * Geprüft wird nur, dass es den Tag gibt — nicht, ob er in der Zukunft liegt.
 * Ein Vorschlag ist eine Behauptung über ein Blatt („da stand: bis Freitag“),
 * kein Eintrag. Ob der Tag noch geht, entscheidet das Formular beim Übernehmen
 * mit demselben Schema, das auch für die Eingabe von Hand gilt. Ein Vorschlag,
 * der zwei Wochen im Korb lag, soll nicht beim Anlegen verboten worden sein,
 * sondern beim Übernehmen einen Satz bekommen, der sich beantworten lässt.
 */
const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine(
    (value) => value === null || isCalendarDate(value),
    "Diesen Tag gibt es nicht.",
  );

/**
 * Eine Themenliste, wie sie überall in der App zugeschnitten wird: getrimmt,
 * gekürzt, ohne Dubletten, höchstens `TOPIC_LIMIT` Stück. Dieselbe Funktion
 * wie im Klausurformular und in der Ablage — ein Agent bekommt hier keine
 * großzügigere Behandlung als ein Mensch.
 */
const topicList = z
  .array(z.string(), "Themen kommen als Liste von Titeln.")
  .transform(normalizeTopics);

/** Themen, die auf einem Blatt stehen. */
export const themenPayloadSchema = z.object({
  titel: topicList.refine(
    (titles) => titles.length > 0,
    "Ohne ein einziges Thema ist das kein Vorschlag.",
  ),
});

/** Eine Aufgabe, die auf einem Blatt steht. Das Fach kommt vom Blatt. */
export const hausaufgabePayloadSchema = z.object({
  titel: z
    .string("Was ist aufgegeben?")
    .trim()
    .min(1, "Was ist aufgegeben?")
    .max(
      HOMEWORK_TITLE_MAX,
      `Der Titel ist zu lang — höchstens ${HOMEWORK_TITLE_MAX} Zeichen.`,
    ),
  faellig: optionalDate,
  notiz: optionalText(2000, "Die Notiz ist zu lang — höchstens 2000 Zeichen."),
});

/** Ein Termin, der auf einem Blatt angekündigt ist. Das Fach kommt vom Blatt. */
export const klausurPayloadSchema = z.object({
  datum: z
    .string("Wann ist die Prüfung?")
    .trim()
    .refine(isCalendarDate, "Dieses Datum gibt es nicht."),
  art: z
    .enum(EXAM_KINDS, "Diese Art von Prüfung kennt die App nicht.")
    .default("klausur"),
  titel: optionalText(
    EXAM_TITLE_MAX,
    `Der Titel ist zu lang — höchstens ${EXAM_TITLE_MAX} Zeichen.`,
  ),
  themen: topicList.default([]),
});

export type ThemenPayload = z.infer<typeof themenPayloadSchema>;
export type HausaufgabePayload = z.infer<typeof hausaufgabePayloadSchema>;
export type KlausurPayload = z.infer<typeof klausurPayloadSchema>;

/**
 * Der Inhalt eines Vorschlags, in der Form seiner Art.
 *
 * Die Vereinigung ist nach `kind` unterscheidbar, aber `kind` steht als eigene
 * Spalte daneben und nicht im Inhalt — sonst könnten beide auseinandergehen,
 * und dann wüsste niemand, welchem von beiden zu glauben ist.
 */
export type ProposalPayload =
  | ThemenPayload
  | HausaufgabePayload
  | KlausurPayload;

/** Zu jeder Art ihr Schema — die einzige Stelle, die beides verbindet. */
const PAYLOAD_SCHEMAS = {
  themen: themenPayloadSchema,
  hausaufgabe: hausaufgabePayloadSchema,
  klausur: klausurPayloadSchema,
} as const;

export const PROPOSAL_KINDS = Object.keys(PAYLOAD_SCHEMAS) as ProposalKind[];

/** Ist das eine Art, die die App kennt? */
export function isProposalKind(value: string): value is ProposalKind {
  return (PROPOSAL_KINDS as string[]).includes(value);
}

/**
 * Der Inhalt eines Vorschlags einer bestimmten Art — oder ein deutscher Satz,
 * warum daraus keiner wird.
 *
 * Der Rückgabetyp ist bewusst nicht `ProposalPayload` allgemein, sondern der
 * Typ zur Art: wer mit `kind: "klausur"` fragt, bekommt einen Wert, an dem
 * `datum` steht, ohne ihn erst einzugrenzen.
 */
export function parsePayload<K extends ProposalKind>(
  kind: K,
  value: unknown,
): { ok: true; payload: PayloadFor<K> } | { ok: false; satz: string } {
  const parsed = PAYLOAD_SCHEMAS[kind].safeParse(value);

  if (!parsed.success) {
    const [first] = parsed.error.issues;
    return {
      ok: false,
      satz: first?.message ?? "Dieser Vorschlag ist nicht lesbar.",
    };
  }

  return { ok: true, payload: parsed.data as PayloadFor<K> };
}

/** Der Inhaltstyp zu einer Art. */
export type PayloadFor<K extends ProposalKind> = z.infer<
  (typeof PAYLOAD_SCHEMAS)[K]
>;

/**
 * Der Abdruck eines Vorschlags: Art, Blatt und Inhalt in einem Wort.
 *
 * Er trägt die Zusage aus dem Schema — derselbe Vorschlag steht kein zweites
 * Mal offen im Korb. Zwei Dinge sind daran wichtig:
 *
 * **Kanonisch je Art, nicht kanonisch als JSON.** Ein Agent, der dasselbe Blatt
 * zweimal liest, nennt dieselben Themen leicht in anderer Reihenfolge. Wären
 * die Titel bloß so, wie sie hereinkamen, in den Abdruck gegangen, stünden
 * danach zwei Karten im Korb, die dasselbe meinen. Deshalb werden Themenlisten
 * gefaltet und sortiert.
 *
 * **Gefaltet wird mit `topicKey()` und nicht mit `vocabularyKey()`.** Der
 * schärfere der beiden Schlüssel ist hier der richtige: er beantwortet die
 * Frage „ist das derselbe Vorschlag?“, nicht „meinen zwei Titel dasselbe
 * Thema?". Wer „Kettenregel“ und „Kettenregel Übungen“ vorschlägt, schlägt
 * zweierlei vor; dass am Ende ein Thema daraus wird, entscheidet die Ablage
 * beim Übernehmen und nicht der Korb beim Annehmen.
 *
 * Ein Hash und nicht der Text selbst: die Spalte trägt einen Index, und ein
 * Vorschlag mit vierzig Themen wäre darin ein Kilobyte lang.
 */
export function fingerprintOf(
  materialId: string,
  kind: ProposalKind,
  payload: ProposalPayload,
): string {
  return createHash("sha256")
    .update([kind, materialId, canonical(kind, payload)].join("\n"))
    .digest("hex");
}

/** Der Inhalt als vergleichbarer Text — je Art auf seine Weise. */
function canonical(kind: ProposalKind, payload: ProposalPayload): string {
  if (kind === "themen") {
    return topicsCanonical((payload as ThemenPayload).titel);
  }

  if (kind === "hausaufgabe") {
    const { titel, faellig, notiz } = payload as HausaufgabePayload;
    return [topicKey(titel), faellig ?? "", notiz ?? ""].join(" ");
  }

  const { datum, art, titel, themen } = payload as KlausurPayload;
  return [
    datum,
    art,
    titel ? topicKey(titel) : "",
    topicsCanonical(themen),
  ].join(" ");
}

function topicsCanonical(titles: readonly string[]): string {
  return [...titles].map(topicKey).sort().join("");
}

/** Das Blatt, so wie es über einem Vorschlag steht. */
export type ProposalMaterial = {
  id: string;
  title: string;
  capturedOn: string;
  subject: { id: string; name: string; short: string; color: string };
  pageCount: number;
  /** id der ersten Seite, fürs Vorschaubild */
  coverPageId: string | null;
};

/** Ein Vorschlag, wie ihn der Korb zeigt. */
export type ProposalItem = {
  id: string;
  kind: ProposalKind;
  source: ProposalSource;
  status: ProposalStatus;
  payload: ProposalPayload;
  reason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  material: ProposalMaterial;
};

/** Was aus einem `propose_*` geworden ist. */
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; grund: "blatt" | "inhalt" | "doppelt" | "voll"; satz: string };

/** Womit ein Vorschlag angelegt wird. */
export type ProposalInput = {
  materialId: string;
  kind: ProposalKind;
  /** Ungeprüft — hier geht auch durch, was aus einem Werkzeugaufruf kommt. */
  payload: unknown;
  reason?: string | null;
  /** Vorgabe „agent“; die Oberfläche legt mit „manuell“ an. */
  source?: ProposalSource;
};

/**
 * Legt einen Vorschlag in den Korb.
 *
 * Vier Gründe für ein Nein, und jeder bekommt seinen eigenen Satz — ein Agent
 * soll daraus lesen können, was er anders machen muss:
 *
 * - `blatt`: das Blatt gibt es nicht (mehr) oder es gehört jemand anderem.
 * - `inhalt`: der Vorschlag passt nicht zu seiner Art.
 * - `doppelt`: genau dieser Vorschlag steht schon offen im Korb.
 * - `voll`: mehr als `MAX_OPEN_PROPOSALS` offene Vorschläge.
 *
 * Das Doppelte wird nicht vorher gesucht, sondern am Fehler der Datenbank
 * erkannt. Nachsehen und dann Schreiben wäre ein Rennen: zwei Aufrufe kurz
 * hintereinander sähen beide nichts und legten beide an. Der eindeutige Index
 * `proposals_open_key` hält die Zusage auch dann, wenn niemand hinschaut —
 * hier steht nur die Übersetzung seines Fehlers in einen deutschen Satz.
 *
 * Die Obergrenze ist dagegen bewusst nur gezählt und nicht gesperrt: sie ist
 * eine Bequemlichkeitsschranke, keine Zusage. Ein Vorschlag mehr als fünfzig,
 * weil zwei Aufrufe gleichzeitig kamen, tut niemandem weh.
 */
export async function createProposal(
  userId: string,
  input: ProposalInput,
): Promise<CreateResult> {
  if (!isId(input.materialId)) {
    return { ok: false, grund: "blatt", satz: "Dieses Blatt gibt es nicht." };
  }

  const parsed = parsePayload(input.kind, input.payload);
  if (!parsed.ok) {
    return { ok: false, grund: "inhalt", satz: parsed.satz };
  }

  const [material] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.id, input.materialId)))
    .limit(1);

  if (!material) {
    return { ok: false, grund: "blatt", satz: "Dieses Blatt gibt es nicht." };
  }

  if ((await countOpenProposals(userId)) >= MAX_OPEN_PROPOSALS) {
    return {
      ok: false,
      grund: "voll",
      satz: `Im Eingangskorb stehen schon ${MAX_OPEN_PROPOSALS} offene Vorschläge. Sieh sie erst durch.`,
    };
  }

  // Gekürzt und nicht abgelehnt: die Begründung ist ein Nebensatz, und ein
  // Vorschlag, der an seinem Nebensatz scheitert, wäre eine Auskunft über
  // nichts. Wer sie ganz weglässt, bekommt `null` statt einer leeren Zeile.
  const reason = (input.reason ?? "").trim().slice(0, REASON_MAX);

  try {
    const [created] = await db
      .insert(proposals)
      .values({
        userId,
        materialId: input.materialId,
        kind: input.kind,
        source: input.source ?? "agent",
        payload: parsed.payload,
        reason: reason.length > 0 ? reason : null,
        fingerprint: fingerprintOf(
          input.materialId,
          input.kind,
          parsed.payload,
        ),
      })
      .returning({ id: proposals.id });

    if (!created) {
      return {
        ok: false,
        grund: "inhalt",
        satz: "Der Vorschlag konnte nicht gespeichert werden.",
      };
    }

    return { ok: true, id: created.id };
  } catch (error) {
    if (isDuplicate(error)) {
      return {
        ok: false,
        grund: "doppelt",
        satz: "Genau dieser Vorschlag steht schon offen im Eingangskorb.",
      };
    }

    throw error;
  }
}

/**
 * Erkennt den einen Fehler, der hier eine Antwort ist und keine Panne.
 *
 * Beide Treiber reichen den Postgres-Code `23505` (unique_violation) herauf,
 * aber an verschiedenen Stellen der Fehlerkette — postgres-js legt ihn auf das
 * Fehlerobjekt selbst, PGlite verpackt ihn. Deshalb wird die Kette abgelaufen
 * und zusätzlich der Name des Index gesucht: ein anderer eindeutiger Index auf
 * dieser Tabelle wäre ein echter Fehler und darf nicht als „schon da“
 * durchgehen.
 */
function isDuplicate(error: unknown): boolean {
  for (let current = error, hops = 0; current && hops < 5; hops += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };

    if (candidate.code === "23505") return true;
    if (
      typeof candidate.message === "string" &&
      candidate.message.includes("proposals_open_key")
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}

/** Wie viele Vorschläge gerade auf eine Antwort warten. */
export async function countOpenProposals(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(proposals)
    .where(and(eq(proposals.userId, userId), eq(proposals.status, "offen")));

  return row?.count ?? 0;
}

/** Wonach der Korb gefragt wird. */
export type ListOptions = {
  /** Genau dieser eine Vorschlag */
  id?: string;
  /** Nur eine Art */
  kind?: ProposalKind;
  /** Nur zu diesem Blatt */
  materialId?: string;
  /**
   * Auch das Entschiedene der letzten `DECIDED_DAYS` Tage. Ohne das kommt
   * allein, was offen ist.
   */
  includeDecided?: boolean;
  limit?: number;
};

/**
 * Die Vorschläge, das Neueste zuerst — und das Offene immer vor dem
 * Entschiedenen.
 *
 * Die zweistufige Sortierung ist der ganze Sinn der Liste: eine Karte, die
 * noch eine Antwort braucht, darf nie unter einer stehen, die längst
 * beantwortet ist. Innerhalb beider Gruppen zählt der Zeitpunkt.
 *
 * Was beim Lesen nicht mehr durch sein eigenes Schema geht, fällt heraus statt
 * als kaputte Karte dazustehen — der Grund steht im Kopf dieser Datei.
 */
export async function listProposals(
  userId: string,
  options?: ListOptions,
): Promise<ProposalItem[]> {
  if (options?.id !== undefined && !isId(options.id)) return [];
  if (options?.materialId !== undefined && !isId(options.materialId)) return [];

  const since = addDays(todayInBerlin(), -DECIDED_DAYS);

  const rows = await db
    .select({
      id: proposals.id,
      kind: proposals.kind,
      source: proposals.source,
      status: proposals.status,
      payload: proposals.payload,
      reason: proposals.reason,
      createdAt: proposals.createdAt,
      decidedAt: proposals.decidedAt,
      materialId: materials.id,
      materialTitle: materials.title,
      capturedOn: materials.capturedOn,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectShort: subjects.short,
      subjectColor: subjects.color,
    })
    .from(proposals)
    .innerJoin(
      materials,
      and(
        eq(materials.id, proposals.materialId),
        eq(materials.userId, userId),
      ),
    )
    .innerJoin(
      subjects,
      and(eq(subjects.id, materials.subjectId), eq(subjects.userId, userId)),
    )
    .where(
      and(
        eq(proposals.userId, userId),
        options?.id ? eq(proposals.id, options.id) : undefined,
        options?.kind ? eq(proposals.kind, options.kind) : undefined,
        options?.materialId
          ? eq(proposals.materialId, options.materialId)
          : undefined,
        options?.includeDecided
          ? or(
              eq(proposals.status, "offen"),
              gte(proposals.decidedAt, new Date(`${since}T00:00:00Z`)),
            )
          : eq(proposals.status, "offen"),
      ),
    )
    // `status = 'offen'` ist wahr für die offenen — absteigend sortiert stehen
    // sie damit oben, ohne dass die Reihenfolge an der Schreibweise der drei
    // Wörter hinge.
    .orderBy(
      desc(sql`${proposals.status} = 'offen'`),
      desc(proposals.createdAt),
    )
    .limit(clampLimit(options?.limit));

  const items: ProposalItem[] = [];
  const covers = await coverPages(
    userId,
    rows.map((row) => row.materialId),
  );

  for (const row of rows) {
    if (!isProposalKind(row.kind)) continue;

    const parsed = parsePayload(row.kind, row.payload);
    if (!parsed.ok) continue;

    const cover = covers.get(row.materialId);

    items.push({
      id: row.id,
      kind: row.kind,
      source: row.source === "manuell" ? "manuell" : "agent",
      status: toStatus(row.status),
      payload: parsed.payload,
      reason: row.reason,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
      material: {
        id: row.materialId,
        title: row.materialTitle,
        capturedOn: row.capturedOn,
        subject: {
          id: row.subjectId,
          name: row.subjectName,
          short: row.subjectShort,
          color: row.subjectColor,
        },
        pageCount: cover?.count ?? 0,
        coverPageId: cover?.id ?? null,
      },
    });
  }

  return items;
}

/**
 * Ein einzelner Vorschlag — für die Server Action, die ihn übernimmt.
 *
 * Über dieselbe Abfrage wie die Liste, nur auf eine id eingegrenzt: was der
 * Korb zeigt und was übernommen wird, muss durch dieselbe Prüfung gegangen
 * sein. Ein Vorschlag, der in der Liste herausfällt, weil sein Inhalt nicht
 * mehr durch sein Schema geht, darf hier nicht als brauchbar dastehen.
 *
 * `includeDecided` steht dabei ausdrücklich an: der Anspruch auf einen
 * Vorschlag wird an anderer Stelle geprüft (`decideProposal()`), und wer
 * gerade auf eine entschiedene Karte tippt, soll einen Satz darüber lesen und
 * kein „gibt es nicht“.
 */
export async function getProposal(
  userId: string,
  id: string,
): Promise<ProposalItem | null> {
  const [found] = await listProposals(userId, { id, includeDecided: true });

  return found ?? null;
}

/**
 * Nimmt einen offenen Vorschlag in Anspruch: er wird entschieden, aber nur,
 * wenn er es noch nicht war.
 *
 * `where status = 'offen'` ist hier kein Filter, sondern der ganze Punkt. Wer
 * zweimal auf „Übernehmen“ tippt, schickt zweimal ab; ohne diese Bedingung
 * liefe der zweite Versuch durch und legte die Aufgabe ein zweites Mal an.
 * Kommt keine Zeile zurück, war jemand schneller — dann bekommt der zweite
 * Versuch einen Satz statt eines zweiten Datensatzes.
 *
 * Geschrieben wird nach dem Anspruch, nicht davor: wer zuerst schriebe und
 * dann anspruchte, hätte bei einem Fehler dazwischen eine Aufgabe angelegt und
 * einen Vorschlag, der weiter offen dasteht. Andersherum bleibt im schlechten
 * Fall ein Vorschlag übernommen, aus dem nichts wurde — und genau dafür gibt
 * es `reopenProposal()`.
 */
export async function decideProposal(
  userId: string,
  id: string,
  status: Exclude<ProposalStatus, "offen">,
): Promise<boolean> {
  if (!isId(id)) return false;

  const changed = await db
    .update(proposals)
    .set({ status, decidedAt: new Date() })
    .where(
      and(
        eq(proposals.userId, userId),
        eq(proposals.id, id),
        eq(proposals.status, "offen"),
      ),
    )
    .returning({ id: proposals.id });

  return changed.length > 0;
}

/**
 * Macht einen Anspruch rückgängig, wenn das Schreiben danach doch nicht
 * geklappt hat. Der Vorschlag steht dann wieder offen da, so als wäre nichts
 * gewesen.
 */
export async function reopenProposal(
  userId: string,
  id: string,
): Promise<void> {
  if (!isId(id)) return;

  await db
    .update(proposals)
    .set({ status: "offen", decidedAt: null })
    .where(and(eq(proposals.userId, userId), eq(proposals.id, id)));
}

/**
 * Die Überschrift einer Karte: was hier vorgeschlagen wird, in einem
 * Halbsatz.
 *
 * Reine Rechnung, damit sie sich prüfen lässt — was auf einer Karte steht,
 * entscheidet, ob jemand sie versteht.
 */
export function proposalHeadline(
  kind: ProposalKind,
  payload: ProposalPayload,
): string {
  if (kind === "themen") {
    const count = (payload as ThemenPayload).titel.length;
    return count === 1 ? "Ein Thema für dieses Blatt" : `${count} Themen für dieses Blatt`;
  }

  if (kind === "hausaufgabe") {
    return "Eine Aufgabe von diesem Blatt";
  }

  const { datum, art } = payload as KlausurPayload;
  return `${EXAM_KIND_NOUNS[art]} am ${germanShortParts(datum).dayMonth}`;
}

/** Wie eine Prüfungsart in einem Satz heißt. */
const EXAM_KIND_NOUNS: Record<(typeof EXAM_KINDS)[number], string> = {
  klausur: "Eine Klausur",
  test: "Ein Test",
  referat: "Ein Referat",
  muendlich: "Eine mündliche Prüfung",
};

/** So viele Vorschläge holt eine Liste höchstens. */
const LIST_LIMIT = 200;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return LIST_LIMIT;
  return Math.min(LIST_LIMIT, Math.max(1, Math.trunc(limit)));
}

/** Ein Zustand, den die App kennt — alles andere gilt als offen. */
function toStatus(value: string): ProposalStatus {
  if (value === "uebernommen" || value === "verworfen") return value;
  return "offen";
}

/**
 * Zu jedem Blatt seine erste Seite und die Zahl seiner Seiten — dieselbe
 * Nachfrage wie in der Ablage, und aus demselben Grund eine für alle Zeilen
 * statt eine je Zeile. Geholt werden nur ids; die Bytes bleiben, wo sie sind.
 */
async function coverPages(
  userId: string,
  materialIds: string[],
): Promise<Map<string, { id: string; count: number }>> {
  const covers = new Map<string, { id: string; count: number }>();
  const ids = [...new Set(materialIds)];
  if (ids.length === 0) return covers;

  const pages = await db
    .select({
      id: materialPages.id,
      materialId: materialPages.materialId,
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

  for (const page of pages) {
    const seen = covers.get(page.materialId);
    if (seen) seen.count += 1;
    else covers.set(page.materialId, { id: page.id, count: 1 });
  }

  return covers;
}
