import { daysBetween, formatGerman, todayInBerlin } from "@/lib/dates";
import {
  MAX_DATA_CHARS,
  auskunftZeichen,
  tausender,
  zahl,
} from "@/lib/mcp/auskunft";
import type { ToolArgs } from "@/lib/mcp/tools";
import {
  vorratZuKlausur,
  type KlausurVorrat,
  type VorschlagsFrage,
} from "@/recall/proposals";
import type { KlausurStoff, KlausurThema } from "@/recall/source";

/**
 * Der Stoff einer Klausur, so wie ein Modell ihn bekommt — und der Weg zurück
 * von seinen Fragen zum Vorschlag (seit dem 11.10.2026).
 *
 * **Eine Auskunft für zwei Wege.** Bis zu diesem Tag stand das alles im
 * Werkzeug read_exam_material (@/lib/mcp/run), und das Modell, das Fragen
 * baute, holte es sich dort: im Chat der Claude-App, und unbeaufsichtigt im
 * Käfig des Postboten (harness/fragen.mts). Seit dem Tag ruft die App Opus
 * selbst, ohne Werkzeuge (@/lib/fragenlauf), und legt ihm den Stoff gleich in
 * den Auftrag. Es ist dieselbe Auskunft — derselbe Satz mit denselben
 * Warnungen, dieselben Felder, dieselbe Grenze —, und deshalb steht sie hier
 * und nicht zweimal: Eine Warnung, die nur einer der beiden Wege kennt (etwa
 * die zu maschinell gelesenen Seiten), ließe den anderen Fragen auf einen
 * Lesefehler bauen, ohne dass er es wissen könnte.
 *
 * **Was hier NICHT steht:** wie ein einzelnes Thema gefunden wird (`topic`
 * an read_exam_material — eine Frage nur des Chats, @/lib/mcp/run) und die
 * Sätze, mit denen ein abgewiesener Vorschlag an ein Modell zurückgeht. Die
 * gehen im Chat an das Modell, das es gleich noch einmal versucht; im
 * Fragenlauf versucht niemand es noch einmal.
 *
 * Gelesen wird über den Abrufkern (@/recall/source, @/recall/proposals) und
 * sonst nichts. Diese Datei liegt bewusst NICHT unter src/recall: sie kennt
 * die Werkzeuge des Web MCP, und der Kern darf aus der Schulapp nur wenig
 * importieren (src/recall/grenzen.test.ts).
 */

/** Eine abgeschriebene Seite, wie das Modell sie liest. */
export type StoffSeite = {
  id: string;
  sortOrder: number;
  chars: number;
  transcript: string;
  maschinell: boolean;
};

/** Ein Thema der Klausur, wie das Modell es liest. */
export type StoffThema = {
  id: string;
  title: string;
  /** Für das Feld `topic` an propose_questions. NULL heißt: freier Text. */
  subjectTopicId: string | null;
  linked: boolean;
  pages: string[];
};

/** Der Datenteil der Auskunft — das JSON unter dem Satz. */
export type StoffDaten = {
  exam: string;
  subject: string;
  subjectId: string;
  kind: string;
  date: string;
  today: string;
  topics: StoffThema[];
  pages: StoffSeite[];
  stock: {
    items: number;
    openQuestions: number;
    discardedQuestions: number;
  };
};

/** Die ganze Auskunft: ein Satz, die Daten, und ob sie in die Grenze passt. */
export type StoffAuskunft = {
  satz: string;
  daten: StoffDaten;
  /** Gezählt wie ein Werkzeugergebnis (`auskunftZeichen()`). */
  zeichen: number;
  /** Länger als `MAX_DATA_CHARS` — im Chat ein Fehler, im Fragenlauf kein Aufruf. */
  zuGross: boolean;
};

/**
 * Die Seiten der genannten Themen, jede nur einmal.
 *
 * Die Seiten werden HIER noch einmal zusammengefasst und nicht aus
 * `seitenGesamt` genommen: Das gilt für alle Themen, und mit `topic` ist
 * nur eines gemeint. Stünde dort die Gesamtliste, lieferte die engere Frage
 * dieselbe Datenmenge wie die weite — genau das, was `topic` verhindern
 * soll — und dazu Seiten, die zum genannten Thema nicht gehören.
 */
export function stoffSeiten(themen: readonly KlausurThema[]): StoffSeite[] {
  const gesehen = new Set<string>();
  const seiten: StoffSeite[] = [];

  for (const thema of themen) {
    for (const seite of thema.seiten) {
      if (gesehen.has(seite.pageId)) continue;
      gesehen.add(seite.pageId);
      seiten.push({
        id: seite.pageId,
        sortOrder: seite.sortOrder,
        chars: seite.transcript.length,
        transcript: seite.transcript,
        // Seit dem 6.10.2026: diese Abschrift hat die App aus Docling
        // geschrieben, und niemand hat sie gegengelesen. Ein Zitat daraus
        // besteht die Quellbindung genauso — es steht ja wörtlich da —,
        // kann aber einen Lesefehler zitieren, den keine ⟨Klammer⟩ verrät.
        // Der Fragen-Eingang zeigt deshalb an solchen Fragen einen Hinweis.
        maschinell: seite.maschinell,
      });
    }
  }

  return seiten;
}

/**
 * Die Auskunft, gerechnet — ohne Datenbank, damit jeder Satz einzeln
 * prüfbar ist (klausur-stoff.test.ts). Den Vorrat holt `stoffAuskunft()`.
 */
export function stoffAuskunftBauen(eingabe: {
  stoff: KlausurStoff;
  themen: readonly KlausurThema[];
  vorrat: KlausurVorrat;
  heute: string;
}): StoffAuskunft {
  const { stoff, themen, vorrat, heute } = eingabe;
  const seiten = stoffSeiten(themen);
  const maschinell = seiten.filter((seite) => seite.maschinell).length;

  const tage = daysBetween(heute, stoff.klausurtag);
  const ohneBlatt = themen.filter((t) => !t.verknuepft).length;
  // „Verknüpft, aber ohne Seite" ist EIN Fall und nicht zwei: Die Abfrage
  // liefert nur Seiten MIT Abschrift, also sieht ein Thema ohne jedes Blatt
  // genauso aus wie eines, dessen Blätter noch niemand abgeschrieben hat. Der
  // Satz darf die Unterscheidung deshalb nicht behaupten — bis zum 12.9.2026
  // stand dort „hat Blätter, aber keine Abschrift", und das war bei einem
  // Thema ohne jedes Blatt einfach falsch. Die Oberfläche unter
  // /abruf/klausur sagt es seit dem ersten Tag richtig; hier stand es anders.
  const ohneAbschrift = themen.filter(
    (t) => t.verknuepft && t.seiten.length === 0,
  ).length;

  // Der Satz sagt zuerst, was da ist, und dann, was fehlt — in dieser
  // Reihenfolge, weil das Fehlende den nächsten Schritt bestimmt. Null
  // Seiten bei vorhandenen Themen ist der Fall aus dem 11.9.: vier Themen
  // standen im falschen Fach, und der Stoff war trotzdem da.
  const satz = `${stoff.subjectName} am ${formatGerman(stoff.klausurtag)}${
    tage >= 0 ? ` (in ${tage} ${tage === 1 ? "Tag" : "Tagen"})` : ""
  }: ${zahl(themen.length, "Thema", "Themen")}, ${zahl(seiten.length, "abgeschriebene Seite", "abgeschriebene Seiten", "f")} mit ${tausender(seiten.reduce((summe, seite) => summe + seite.chars, 0))} Zeichen.${
    ohneBlatt > 0
      ? ` ${ohneBlatt} ${ohneBlatt === 1 ? "Thema hängt" : "Themen hängen"} an keinem Blatt.`
      : ""
  }${
    ohneAbschrift > 0
      ? ` Zu ${ohneAbschrift} ${ohneAbschrift === 1 ? "Thema führt kein abgeschriebenes Blatt" : "Themen führt kein abgeschriebenes Blatt"} — entweder ist keines abfotografiert, oder es ist noch nicht abgeschrieben.`
      : ""
  }${
    seiten.length === 0
      ? " Ohne abgeschriebene Seite lässt sich keine Frage stellen — melde das, statt eine zu erfinden. Häufigste Ursache: das Thema steht im falschen Fach."
      : ""
  }${
    maschinell > 0
      ? ` ${maschinell === 1 ? "Eine Seite hat" : `${maschinell} Seiten hat`} die App maschinell gelesen (Docling, „maschinell: true“) — dort können Lesefehler stehen, die keine ⟨Klammer⟩ markiert; zitiere von dort nur, was in sich stimmig ist.`
      : ""
  }${
    vorrat.offeneFragen > 0
      ? ` Im Eingang liegen schon ${vorrat.offeneFragen} unentschiedene ${vorrat.offeneFragen === 1 ? "Frage" : "Fragen"} zu dieser Klausur — schlag nichts vor, was dort schon liegt.`
      : ""
  }${
    vorrat.bausteine > 0
      ? ` ${vorrat.bausteine} ${vorrat.bausteine === 1 ? "Baustein" : "Bausteine"} sind aus diesem Stoff bereits gebaut.`
      : ""
  }${
    vorrat.verworfen > 0
      ? ` ${vorrat.verworfen} ${vorrat.verworfen === 1 ? "Frage wollte der Mensch" : "Fragen wollte der Mensch"} zu dieser Klausur nicht — bau nicht dasselbe noch einmal.`
      : ""
  }`;

  const daten: StoffDaten = {
    exam: stoff.examId,
    subject: stoff.subjectName,
    subjectId: stoff.subjectId,
    kind: stoff.kind,
    date: stoff.klausurtag,
    today: heute,
    topics: themen.map((thema) => ({
      id: thema.examTopicId,
      title: thema.title,
      subjectTopicId: thema.subjectTopicId,
      linked: thema.verknuepft,
      // Die ids und nicht die Seiten selbst: Eine Seite kann an mehreren
      // Themen hängen, und ihr Wortlaut stünde sonst mehrfach in derselben
      // Antwort — bei zwei Themen das Doppelte an Kosten für nichts.
      pages: thema.seiten.map((seite) => seite.pageId),
    })),
    pages: seiten,
    /**
     * Was zu dieser Klausur schon da ist — die Antwort auf „liegt da schon
     * was?". Ohne sie legt ein Lauf ohne Mensch daneben dieselben Fragen
     * noch einmal in den Korb.
     */
    stock: {
      items: vorrat.bausteine,
      openQuestions: vorrat.offeneFragen,
      /**
       * Fragen, die der Mensch zu dieser Klausur NICHT wollte. Ohne diese
       * Zahl baute ein Lauf nach einem verworfenen Vorschlag dieselben
       * Fragen noch einmal — `openQuestions` fällt beim Verwerfen ja auf
       * null.
       */
      discardedQuestions: vorrat.verworfen,
    },
  };

  const zeichen = auskunftZeichen(satz, daten);
  return { satz, daten, zeichen, zuGross: zeichen > MAX_DATA_CHARS };
}

/**
 * Die Auskunft über diese Themen einer Klausur.
 *
 * Der Vorrat wird über die Seiten DIESER Auskunft gezählt und nicht über
 * alle der Klausur: Mit `topic` ist nur ein Thema gemeint, und „18
 * Bausteine" neben einem Thema, zu dem keiner gehört, wäre eine Zahl, die
 * zur falschen Frage antwortet.
 */
export async function stoffAuskunft(
  userId: string,
  stoff: KlausurStoff,
  themen: readonly KlausurThema[],
): Promise<StoffAuskunft> {
  const vorrat = await vorratZuKlausur(
    userId,
    stoff.examId,
    stoffSeiten(themen).map((seite) => seite.id),
  );

  return stoffAuskunftBauen({ stoff, themen, vorrat, heute: todayInBerlin() });
}

/**
 * Die Fragen aus propose_questions, wie `vorschlagAnlegen()` sie nimmt.
 *
 * Draußen heißen die Felder wie im Werkzeug (`page`, `quote`), drinnen wie im
 * Abrufkern (`pageId`, `sourceQuote`); übersetzt wird hier, an einer Stelle,
 * für den Chat (@/lib/mcp/run) und den Fragenlauf (@/lib/fragenlauf) zugleich.
 * Kommt an propose_questions ein Feld dazu, fehlt es sonst in einem der beiden
 * Wege, ohne dass es jemand merkt.
 */
export function vorschlagsFragen(
  fragen: readonly ToolArgs<"propose_questions">["questions"][number][],
): VorschlagsFrage[] {
  return fragen.map((frage) => ({
    pageId: frage.page,
    subjectTopicId: frage.topic ?? null,
    promptFree: frage.question,
    solution: frage.solution,
    misconception: frage.misconception,
    sourceQuote: frage.quote,
    materialKind: frage.kind,
  }));
}
