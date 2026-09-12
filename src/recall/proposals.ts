import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  exams,
  materialPages,
  materials,
  subjectTopics,
  subjects,
} from "@/db/schema";
import { todayInBerlin } from "@/lib/dates";
import { istId } from "@/recall/ids";
import { createItem, type AnlageFehler } from "@/recall/items";
import {
  recallItems,
  recallProposalItems,
  recallProposals,
} from "@/recall/schema";

/**
 * Vorschläge: was ein Agent an Fragen gebaut hat, und der Weg in den Bestand.
 *
 * ── Die eine Regel, die diese Datei durchsetzt ───────────────────────────────
 *
 * Ein Vorschlag wird nicht in den Bestand kopiert, sondern durch `createItem()`
 * geschickt — durch dieselbe Tür wie eine von Hand angelegte Frage. Damit gilt
 * die Quellbindung (A5) für den Agenten genauso: Das Zitat muss wörtlich in der
 * Abschrift stehen und darf keine ⟨spitze Klammer⟩ enthalten. Was durchfällt,
 * fällt durch, ganz gleich wer es vorgeschlagen hat.
 *
 * Das ist der Unterschied zwischen „die KI darf schreiben" und „die KI darf
 * vorschlagen". Der Bericht begründet ihn mit einer Zahl: Trennschärfe 0,28 bei
 * drei dokumentierten Halluzinationstypen. Eine erfundene Musterlösung kann
 * niemand gegen das Foto halten, wie man es bei einer Abschrift kann.
 *
 * ── Und die Regel, die sie NICHT durchsetzt ──────────────────────────────────
 *
 * Ob die Frage fachlich gut ist. Das kann kein Code prüfen. Deshalb liegt die
 * Liste dem Menschen vor, mit Frage, Musterlösung, Verwechslungssatz und Zitat
 * beieinander — damit die Entscheidung möglich ist, statt nur gefordert zu
 * werden.
 */

export type VorschlagsFrage = {
  pageId: string;
  subjectTopicId?: string | null;
  promptFree: string;
  solution: string;
  misconception: string;
  sourceQuote: string;
  materialKind?: string;
};

/**
 * Wie lang die vier Teile einer vorgeschlagenen Frage werden dürfen.
 *
 * Die Zahlen stehen HIER, weil hier geprüft wird. Das Werkzeugverzeichnis
 * (@/lib/mcp/tools) holt sie von hier und schreibt sie dem Modell in die
 * Beschreibung — stünden dort eigene, versprächen die zwei Türen dem Agenten
 * Verschiedenes, und die engere wiese ab, was die weitere zugesagt hat. Es ist
 * dieselbe Regel, nach der `PROPOSAL_TRANSCRIPT_MAX` aus @/lib/inbox kommt und
 * nicht aus dem Verzeichnis.
 *
 * Die Höhe ist an der Sache gemessen und nicht gerundet: Eine Abruffrage, die
 * länger ist als ein Absatz, ist keine Frage mehr, sondern eine
 * Aufgabenstellung — und A1 verlangt freien Abruf, nicht Textverständnis. Die
 * Musterlösung darf ein Vielfaches sein, weil dort Rechenwege in mehreren
 * Zeilen stehen. Der Verwechslungssatz ist ein Satz. Und das Zitat ist ein
 * Ausschnitt einer Seite, die bei 8000 Zeichen endet: Was darüber liegt,
 * zitiert nicht mehr, sondern kopiert die Seite — und ein Zitat, das die ganze
 * Seite ist, belegt nichts mehr, weil es nicht mehr auf eine Stelle zeigt.
 *
 * `FRAGEN_MAX` deckelt den einzelnen Vorschlag, nicht den Tag. Die Zahl ist die
 * Geduld eines Menschen am Abend: Der Eingang wird von Hand durchgesehen, Frage
 * für Frage mit Lösung, Verwechslungssatz und Zitat daneben. Eine Liste mit
 * fünfzig Einträgen wird nicht sorgfältiger durchgesehen, sondern gar nicht.
 */
export const FRAGE_MAX = 500;
export const LOESUNG_MAX = 2000;
export const VERWECHSLUNG_MAX = 500;
export const ZITAT_MAX = 1000;
export const FRAGEN_MAX = 20;

/**
 * Und wie kurz sie ausfallen dürfen.
 *
 * Diese vier Zahlen standen bis heute im Formularschema unter /abruf — von
 * Hand getippt, zusammen mit den vier oben. Sie gehören hierher, weil es sie
 * seit dem Eingangskorb zweimal gibt: Was ein Mensch tippen darf, muss die KI
 * auch schicken dürfen, und umgekehrt. Wären die zwei Türen verschieden,
 * bekäme entweder der Mensch eine Abweisung für etwas, das die KI durchbringt,
 * oder die KI eine für etwas, das im Formular erlaubt ist — und beides fiele
 * erst auf, wenn jemand beide Wege nebeneinander ausprobiert.
 *
 * Das Zitat hat die höchste Untergrenze und den Grund dafür in `createItem()`:
 * Geprüft wird mit `includes()`, und je kürzer der Ausschnitt, desto
 * beliebiger die Stelle, die er trifft. Ein einzelnes Wort steht auf einer
 * halben Seite zehnmal; zehn Zeichen bezeichnen eine.
 */
export const FRAGE_MIN = 5;
export const LOESUNG_MIN = 1;
export const VERWECHSLUNG_MIN = 5;
export const ZITAT_MIN = 10;

/**
 * Der Satz, den der Agent dem Menschen mitschickt.
 *
 * Er steht über der Liste im Eingang und beantwortet „was hast du
 * weggelassen und warum" — ein Absatz, kein Bericht. Wäre er länger als die
 * Liste, wäre er das, was gelesen wird, und die Fragen wären es nicht.
 */
export const NOTIZ_MAX = 500;

/**
 * Warum ein Vorschlag gar nicht abgelegt wurde.
 *
 * Nicht zu verwechseln mit `AnlageFehler`: der sagt, warum eine EINZELNE Frage
 * beim Übernehmen durchfiel, und der gehört ins Protokoll. Dieser hier sagt,
 * warum überhaupt keine Zeile entstand — und er geht an den Agenten zurück,
 * der es gleich noch einmal versucht. „Es hat nicht geklappt" wäre für beide
 * Leser dieselbe nutzlose Auskunft.
 */
export type VorschlagAbweisung =
  | "keine-klausur"
  | "keine-fragen"
  | "zu-kurz"
  | "zu-lang"
  | "fremde-seiten";

/**
 * Einen Vorschlag ablegen.
 *
 * Hier wird NICHT geprüft, ob die Zitate stimmen — das passiert beim
 * Übernehmen. Der Grund: Ein Vorschlag, dessen schwache Fragen schon beim
 * Ablegen verschwinden, verschweigt dem Menschen, was der Agent wirklich
 * geliefert hat. Die Zahl der abgewiesenen Fragen IST das Maß dafür, wie
 * zuverlässig er arbeitet; sie darf nicht stillschweigend auf null sinken.
 *
 * Geprüft wird zweierlei, und beides sind Eigenschaften der Zeile und nicht
 * ihres Inhalts: dass die Seite zu diesem Nutzer gehört — ein Vorschlag auf
 * eine fremde Seite ist kein schwacher Vorschlag, sondern ein Angriff — und
 * dass die Texte in die Grenzen oben passen. Das zweite ist keine
 * Qualitätsprüfung durch die Hintertür: eine 50 000 Zeichen lange
 * „Musterlösung" ist keine schlechte Antwort, sondern keine, und sie macht die
 * Liste unlesbar, in der sie steht.
 */
export async function vorschlagAnlegen(
  userId: string,
  examId: string,
  fragen: readonly VorschlagsFrage[],
  note?: string | null,
): Promise<
  | {
      ok: true;
      proposalId: string;
      fragen: number;
      /** Fragen, deren Thema nicht zu diesem Schüler gehörte — es blieb leer. */
      themenVerworfen: number;
    }
  | { ok: false; grund: VorschlagAbweisung }
> {
  if (!istId(examId)) return { ok: false, grund: "keine-klausur" };

  const [klausur] = await db
    .select({ id: exams.id, subjectId: exams.subjectId })
    .from(exams)
    .where(and(eq(exams.id, examId), eq(exams.userId, userId)))
    .limit(1);

  if (!klausur) return { ok: false, grund: "keine-klausur" };
  if (fragen.length === 0 || fragen.length > FRAGEN_MAX) {
    return { ok: false, grund: "keine-fragen" };
  }

  // Gemessen wird am getrimmten Text, weil genau der gespeichert wird. Und
  // abgewiesen wird der GANZE Vorschlag, nicht die zu lange Frage: Eine Liste,
  // aus der still eine Frage verschwindet, sieht vollständig aus. Der Agent
  // bekommt seine zwanzig Fragen zurück und weiß, dass er kürzen muss — ein
  // Mensch bekäme sonst neunzehn und erführe nie, dass es zwanzig waren.
  const zuLang = fragen.some(
    (f) =>
      f.promptFree.trim().length > FRAGE_MAX ||
      f.solution.trim().length > LOESUNG_MAX ||
      f.misconception.trim().length > VERWECHSLUNG_MAX ||
      f.sourceQuote.trim().length > ZITAT_MAX,
  );
  if (zuLang || (note ?? "").trim().length > NOTIZ_MAX) {
    return { ok: false, grund: "zu-lang" };
  }

  // Und dieselbe Prüfung von unten. Der leere Verwechslungssatz ist der Fall,
  // auf den es dabei ankommt: In der Datenbank steht dafür eine CHECK-Regel,
  // und sie käme als englischer Postgres-Fehler durch die MCP-Tür zurück.
  const zuKurz = fragen.some(
    (f) =>
      f.promptFree.trim().length < FRAGE_MIN ||
      f.solution.trim().length < LOESUNG_MIN ||
      f.misconception.trim().length < VERWECHSLUNG_MIN ||
      f.sourceQuote.trim().length < ZITAT_MIN,
  );
  if (zuKurz) return { ok: false, grund: "zu-kurz" };

  // Alle Seiten in EINER Abfrage prüfen, nicht je Frage eine.
  const eigene = new Set(
    (
      await db
        .select({ id: materialPages.id })
        .from(materialPages)
        .innerJoin(
          materials,
          and(
            eq(materials.id, materialPages.materialId),
            eq(materials.userId, userId),
          ),
        )
    ).map((z) => z.id),
  );

  const erlaubt = fragen.filter((f) => eigene.has(f.pageId));
  if (erlaubt.length === 0) return { ok: false, grund: "fremde-seiten" };

  // Die Themen: dieselbe Frage wie bei den Seiten, mit einer anderen Antwort.
  //
  // Ein Thema, das gar keine id ist, käme beim Einfügen als
  // Fremdschlüsselfehler zurück: englisch, aus Postgres, mitten in einem
  // Werkzeugaufruf. Die Frage deswegen wegzuwerfen wäre aber
  // unverhältnismäßig: Das Thema ist die Einordnung, die Frage ist die Arbeit,
  // und ohne Thema bleibt sie vollständig beantwortbar. Sie wird also behalten
  // und das Thema fallen gelassen — gezählt allerdings, damit der Satz an den
  // Agenten es sagen kann. Stillschweigend wäre es die Art Fehler, die man
  // erst Wochen später in einer leeren Themenspalte sieht.
  //
  // Gefragt wird nach dem FACH DER KLAUSUR und nicht nach dem Schüler. Das ist
  // die engere Frage, und sie ist die richtige: „Passé composé" gehört diesem
  // Schüler, an einer Mathematikklausur ist es trotzdem falsch. Der Baustein
  // trüge dann `subject_id` = Mathematik und daneben ein französisches Thema —
  // eine Zeile, die sich selbst widerspricht, und beim Üben nach Thema tauchte
  // die Frage im falschen Fach auf. Die Probe vom 12.9.2026 hat genau diese
  // zu weite Prüfung gefunden.
  const genannt = [
    ...new Set(
      erlaubt
        .map((f) => f.subjectTopicId)
        .filter((id): id is string => typeof id === "string" && istId(id)),
    ),
  ];

  const eigeneThemen = new Set(
    genannt.length === 0
      ? []
      : (
          await db
            .select({ id: subjectTopics.id })
            .from(subjectTopics)
            .where(
              and(
                inArray(subjectTopics.id, genannt),
                eq(subjectTopics.subjectId, klausur.subjectId),
              ),
            )
        ).map((z) => z.id),
  );

  const themaVon = (f: VorschlagsFrage): string | null =>
    f.subjectTopicId && eigeneThemen.has(f.subjectTopicId)
      ? f.subjectTopicId
      : null;

  const themenVerworfen = erlaubt.filter(
    (f) => f.subjectTopicId && themaVon(f) === null,
  ).length;

  const [vorschlag] = await db
    .insert(recallProposals)
    .values({ userId, examId, origin: "agent", note: note?.trim() || null })
    .returning({ id: recallProposals.id });

  await db.insert(recallProposalItems).values(
    erlaubt.map((f, i) => ({
      proposalId: vorschlag.id,
      pageId: f.pageId,
      subjectTopicId: themaVon(f),
      sortOrder: i,
      promptFree: f.promptFree.trim(),
      solution: f.solution.trim(),
      misconception: f.misconception.trim(),
      sourceQuote: f.sourceQuote.trim(),
      materialKind: f.materialKind ?? "begriff",
    })),
  );

  return {
    ok: true,
    proposalId: vorschlag.id,
    fragen: erlaubt.length,
    themenVerworfen,
  };
}

/**
 * Was zu dieser Klausur schon da ist.
 *
 * ── Warum das an der Auskunft hängt und nicht in einer Merkliste ─────────────
 *
 * Der Postbote hat eine Merkliste (harness/gesehen.json), und sie ist dort mit
 * Bedacht die EINZIGE: „der Korb ist die Warteschlange". Für Fragen gibt es
 * diesen Korb auch — nur konnte ihn von außen niemand sehen. Ein Lauf, der das
 * nicht weiß, legt jede Nacht zwanzig neue Fragen auf dieselbe Klausur, und der
 * Mensch sieht am Morgen sechzig, von denen vierzig Dubletten sind.
 *
 * Also dieselbe Antwort wie beim Postboten, nur ohne Datei: Die Zahl steht in
 * der Auskunft, die ohnehin der erste Aufruf jedes Laufs ist. Damit gibt es
 * nichts, was zwischen App und Dienst auseinanderlaufen könnte — und nichts
 * aufzuräumen, wenn der Dienst wochenlang aus war.
 *
 * `seitenIds` kommt vom Aufrufer und wird hier nicht noch einmal hergeleitet:
 * Wer diese Zahl braucht, hat den Stoff gerade geholt (`stoffZuKlausur`) und
 * kennt die Seiten. Ein zweiter Weg über exam_topics wäre eine zweite Fassung
 * derselben Kette — und die erste, die sich ändert, wäre die falsche.
 */
export type KlausurVorrat = {
  /** Bausteine, die an einer Seite dieses Klausurstoffs hängen */
  bausteine: number;
  /** Fragen, die im Eingang liegen und noch niemand entschieden hat */
  offeneFragen: number;
};

export async function vorratZuKlausur(
  userId: string,
  examId: string,
  seitenIds: readonly string[],
): Promise<KlausurVorrat> {
  if (!istId(examId)) return { bausteine: 0, offeneFragen: 0 };

  const [fragen] = await db
    .select({ n: count() })
    .from(recallProposalItems)
    .innerJoin(
      recallProposals,
      and(
        eq(recallProposals.id, recallProposalItems.proposalId),
        eq(recallProposals.userId, userId),
        eq(recallProposals.examId, examId),
        isNull(recallProposals.settledAt),
      ),
    )
    .where(
      and(
        isNull(recallProposalItems.acceptedAt),
        isNull(recallProposalItems.rejectedReason),
      ),
    );

  // Ohne Seiten gibt es nichts zu zählen — und `inArray` mit einer leeren Liste
  // ist in SQL kein leeres Ergebnis, sondern ein Fehler.
  if (seitenIds.length === 0) {
    return { bausteine: 0, offeneFragen: Number(fragen?.n ?? 0) };
  }

  const [bausteine] = await db
    .select({ n: count() })
    .from(recallItems)
    .where(
      and(
        eq(recallItems.userId, userId),
        isNull(recallItems.retiredAt),
        inArray(recallItems.pageId, [...seitenIds]),
      ),
    );

  return {
    bausteine: Number(bausteine?.n ?? 0),
    offeneFragen: Number(fragen?.n ?? 0),
  };
}

export type OffeneFrage = {
  id: string;
  pageId: string;
  promptFree: string;
  solution: string;
  misconception: string;
  sourceQuote: string;
  materialKind: string;
  /** Der Titel des Blattes, aus dem sie stammt — damit der Mensch weiß, wo er ist */
  blattTitel: string;
  seitenNummer: number;
};

export type OffenerVorschlag = {
  id: string;
  examId: string;
  klausurtag: string;
  subjectName: string;
  subjectColor: string;
  note: string | null;
  createdAt: Date;
  fragen: OffeneFrage[];
};

/** Die Vorschläge, die noch keiner durchgesehen hat, der neueste zuerst. */
export async function offeneVorschlaege(
  userId: string,
): Promise<OffenerVorschlag[]> {
  const koepfe = await db
    .select({
      id: recallProposals.id,
      examId: recallProposals.examId,
      klausurtag: exams.date,
      subjectName: subjects.name,
      subjectColor: subjects.color,
      note: recallProposals.note,
      createdAt: recallProposals.createdAt,
    })
    .from(recallProposals)
    .innerJoin(exams, eq(exams.id, recallProposals.examId))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .where(
      and(
        eq(recallProposals.userId, userId),
        isNull(recallProposals.settledAt),
      ),
    )
    .orderBy(desc(recallProposals.createdAt));

  if (koepfe.length === 0) return [];

  const zeilen = await db
    .select({
      id: recallProposalItems.id,
      proposalId: recallProposalItems.proposalId,
      pageId: recallProposalItems.pageId,
      promptFree: recallProposalItems.promptFree,
      solution: recallProposalItems.solution,
      misconception: recallProposalItems.misconception,
      sourceQuote: recallProposalItems.sourceQuote,
      materialKind: recallProposalItems.materialKind,
      sortOrder: recallProposalItems.sortOrder,
      blattTitel: materials.title,
      seitenNummer: materialPages.sortOrder,
    })
    .from(recallProposalItems)
    .innerJoin(
      recallProposals,
      eq(recallProposals.id, recallProposalItems.proposalId),
    )
    .innerJoin(materialPages, eq(materialPages.id, recallProposalItems.pageId))
    .innerJoin(materials, eq(materials.id, materialPages.materialId))
    .where(
      and(
        eq(recallProposals.userId, userId),
        isNull(recallProposals.settledAt),
        isNull(recallProposalItems.acceptedAt),
        isNull(recallProposalItems.rejectedReason),
      ),
    )
    .orderBy(asc(recallProposalItems.sortOrder));

  const jeVorschlag = new Map<string, OffeneFrage[]>();
  for (const z of zeilen) {
    const liste = jeVorschlag.get(z.proposalId) ?? [];
    liste.push({
      id: z.id,
      pageId: z.pageId,
      promptFree: z.promptFree,
      solution: z.solution,
      misconception: z.misconception,
      sourceQuote: z.sourceQuote,
      materialKind: z.materialKind,
      blattTitel: z.blattTitel,
      seitenNummer: z.seitenNummer + 1,
    });
    jeVorschlag.set(z.proposalId, liste);
  }

  return koepfe.map((k) => ({ ...k, fragen: jeVorschlag.get(k.id) ?? [] }));
}

export type UebernahmeErgebnis = {
  uebernommen: number;
  abgewiesen: Array<{ frage: string; grund: AnlageFehler }>;
  abgewaehlt: number;
};

/** Die Sätze, mit denen eine abgewiesene Frage im Protokoll stehen bleibt. */
const ABWEISUNG: Record<AnlageFehler, string> = {
  "keine-seite": "Die Seite gibt es nicht mehr.",
  // Über diesen Weg unerreichbar: Das Fach kommt beim Übernehmen aus der
  // Klausur und nicht aus dem Vorschlag. Der Satz steht trotzdem da, weil die
  // Liste vollständig sein muss — und weil „unerreichbar" eine Aussage über
  // heutigen Code ist und nicht über morgigen.
  "kein-fach": "Zur Klausur gehörte kein gültiges Fach.",
  "keine-abschrift": "Die Seite hat keine Abschrift.",
  "zitat-leer": "Zu der Frage stand kein Zitat da.",
  "zitat-nicht-gefunden":
    "Das Zitat steht nicht wörtlich in der Abschrift — der Agent hat es nacherzählt.",
  "zitat-unsicher":
    "Das Zitat reicht in eine ⟨unsichere Stelle⟩ der Abschrift hinein.",
};

/**
 * Übernehmen: aus ausgewählten Vorschlägen werden Bausteine.
 *
 * ── Was hier NICHT passiert ──────────────────────────────────────────────────
 *
 * Kopieren. Jede Frage geht durch `createItem()`, und damit durch die
 * Quellbindung. Eine Frage, deren Zitat nicht wörtlich in der Abschrift steht,
 * wird abgewiesen und bleibt mit ihrem Grund stehen — nicht gelöscht. Denn die
 * Zahl dieser Abweisungen ist das einzige Maß dafür, wie zuverlässig der Agent
 * arbeitet, und ein Maß, das beim Aufräumen verschwindet, ist keines.
 *
 * Was der Mensch abgewählt hat, bekommt denselben Vermerk — mit einem anderen
 * Grund. Beides zusammen beantwortet später die Frage, ob sich der Agent lohnt.
 */
export async function vorschlagUebernehmen(
  userId: string,
  proposalId: string,
  gewaehlteIds: readonly string[],
  heute: string = todayInBerlin(),
): Promise<UebernahmeErgebnis | null> {
  // Die gewählten ids brauchen keinen Wächter: Sie werden gegen echte ids
  // verglichen und stehen in keiner Abfrage. Der Vorschlag selbst steht in
  // einer.
  if (!istId(proposalId)) return null;

  const [vorschlag] = await db
    .select({ id: recallProposals.id, subjectId: exams.subjectId })
    .from(recallProposals)
    .innerJoin(exams, eq(exams.id, recallProposals.examId))
    .where(
      and(
        eq(recallProposals.id, proposalId),
        eq(recallProposals.userId, userId),
      ),
    )
    .limit(1);

  if (!vorschlag) return null;

  const fragen = await db
    .select()
    .from(recallProposalItems)
    .where(
      and(
        eq(recallProposalItems.proposalId, proposalId),
        isNull(recallProposalItems.acceptedAt),
        isNull(recallProposalItems.rejectedReason),
      ),
    )
    .orderBy(asc(recallProposalItems.sortOrder));

  const gewaehlt = new Set(gewaehlteIds);
  const ergebnis: UebernahmeErgebnis = {
    uebernommen: 0,
    abgewiesen: [],
    abgewaehlt: 0,
  };

  for (const frage of fragen) {
    if (!gewaehlt.has(frage.id)) {
      await db
        .update(recallProposalItems)
        .set({ rejectedReason: "Vom Menschen abgewählt." })
        .where(eq(recallProposalItems.id, frage.id));
      ergebnis.abgewaehlt += 1;
      continue;
    }

    const angelegt = await createItem(
      userId,
      {
        pageId: frage.pageId,
        subjectId: vorschlag.subjectId,
        subjectTopicId: frage.subjectTopicId,
        promptFree: frage.promptFree,
        solution: frage.solution,
        misconception: frage.misconception,
        sourceQuote: frage.sourceQuote,
        materialKind: frage.materialKind,
      },
      heute,
    );

    if (angelegt.ok) {
      await db
        .update(recallProposalItems)
        .set({ acceptedAt: new Date(), itemId: angelegt.id })
        .where(eq(recallProposalItems.id, frage.id));
      ergebnis.uebernommen += 1;
    } else {
      await db
        .update(recallProposalItems)
        .set({ rejectedReason: ABWEISUNG[angelegt.fehler] })
        .where(eq(recallProposalItems.id, frage.id));
      ergebnis.abgewiesen.push({
        frage: frage.promptFree,
        grund: angelegt.fehler,
      });
    }
  }

  await db
    .update(recallProposals)
    .set({ settledAt: new Date() })
    .where(eq(recallProposals.id, proposalId));

  return ergebnis;
}

/** Den ganzen Vorschlag wegräumen, ohne etwas zu übernehmen. */
export async function vorschlagVerwerfen(
  userId: string,
  proposalId: string,
): Promise<boolean> {
  if (!istId(proposalId)) return false;

  const [zeile] = await db
    .update(recallProposals)
    .set({ settledAt: new Date() })
    .where(
      and(
        eq(recallProposals.id, proposalId),
        eq(recallProposals.userId, userId),
      ),
    )
    .returning({ id: recallProposals.id });

  if (!zeile) return false;

  await db
    .update(recallProposalItems)
    .set({ rejectedReason: "Der ganze Vorschlag wurde verworfen." })
    .where(
      and(
        eq(recallProposalItems.proposalId, proposalId),
        isNull(recallProposalItems.acceptedAt),
        isNull(recallProposalItems.rejectedReason),
      ),
    );

  return true;
}

export type ErledigteFrage = {
  promptFree: string;
  uebernommen: boolean;
  grund: string | null;
};

export type VorschlagsErgebnis = {
  id: string;
  subjectName: string;
  uebernommen: number;
  fragen: ErledigteFrage[];
};

/**
 * Was aus einem abgearbeiteten Vorschlag geworden ist.
 *
 * ── Warum das aus der Datenbank kommt und nicht aus dem Browser ──────────────
 *
 * Weil der Bericht im Browser nicht überleben kann. Am 12.9.2026 dreimal
 * gemessen: Jedes `revalidatePath()` in einer Server Action frischt die gerade
 * offene Route mit auf — egal, welcher Pfad angegeben ist. Die Vorschlagsliste
 * ist danach leer, die Seite zeigt ihren Leerzustand, und die Komponente mit
 * dem Bericht wird dabei ersetzt. Sichtbar blieb: „Kein Vorschlag im Eingang".
 * Unsichtbar wurde, dass eine Frage abgewiesen wurde, weil die KI ihr Zitat
 * nacherzählt hatte — die einzige Zahl, die beantwortet, ob man dem Agenten
 * trauen kann.
 *
 * Die Gründe liegen ohnehin in `rejected_reason`, aufgeschrieben beim
 * Übernehmen. Von dort gelesen, überlebt der Bericht auch ein Neuladen der
 * Seite, und man kann ihn sich später noch einmal ansehen.
 */
export async function vorschlagsErgebnis(
  userId: string,
  proposalId: string,
): Promise<VorschlagsErgebnis | null> {
  if (!istId(proposalId)) return null;

  const [kopf] = await db
    .select({ id: recallProposals.id, subjectName: subjects.name })
    .from(recallProposals)
    .innerJoin(exams, eq(exams.id, recallProposals.examId))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .where(
      and(
        eq(recallProposals.id, proposalId),
        eq(recallProposals.userId, userId),
      ),
    )
    .limit(1);

  if (!kopf) return null;

  const zeilen = await db
    .select({
      promptFree: recallProposalItems.promptFree,
      acceptedAt: recallProposalItems.acceptedAt,
      rejectedReason: recallProposalItems.rejectedReason,
    })
    .from(recallProposalItems)
    .where(eq(recallProposalItems.proposalId, proposalId))
    .orderBy(asc(recallProposalItems.sortOrder));

  const fragen = zeilen.map((z) => ({
    promptFree: z.promptFree,
    uebernommen: z.acceptedAt !== null,
    grund: z.rejectedReason,
  }));

  return {
    id: kopf.id,
    subjectName: kopf.subjectName,
    uebernommen: fragen.filter((f) => f.uebernommen).length,
    fragen,
  };
}
