import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { subjectTopics, type ThemaArt } from "@/db/schema";
import { fachSprache } from "@/lib/arbeitsblatt/sprache";
import { protokollieren, protokollLoeschen } from "@/lib/protokoll";

/**
 * Die Art eines Themas (Modell 23, Plan 3.6; Zusatz Arbeitsblätter):
 * `abfragen` heißt Karten, `ueben` heißt Arbeitsblatt zum Ausdrucken.
 *
 * Gespeichert wird nur, was der Nutzer umgestellt hat
 * (`subject_topics.art`). Sonst leitet die App die Art aus Fach und
 * Thementitel ab, wie der Prototyp (`artAbgeleitet`, Z. 1227):
 *
 * - Mathematik und Physik → üben;
 * - Deutsch, Französisch, Englisch mit einem Grammatik-Stichwort im
 *   Thementitel → üben;
 * - alles andere → abfragen.
 */

/**
 * Stichwörter für Grammatik im Thementitel. Verglichen wird ohne
 * Groß-/Kleinschreibung und ohne Akzente („passé“ = „passe“), als ganzes Wort
 * mit üblicher Endung („Zeiten“, „Satzglieder“).
 *
 * „Futur“ allein steht nicht hier: mit Endung träfe es englisch „future“
 * („My future job“). Hier stehen nur die französischen Zeiten; das nackte
 * Wort gilt in Französisch und Deutsch (`FUTUR_FAECHER`).
 */
export const GRAMMATIK_STICHWORTE = [
  "Grammatik",
  "Grammaire",
  "Grammar",
  "Zeit",
  "Zeitform",
  "passé",
  "passé composé",
  "imparfait",
  "plus-que-parfait",
  "futur simple",
  "futur proche",
  "futur composé",
  "futur antérieur",
  "subjonctif",
  "conditionnel",
  "tense",
  "present perfect",
  "simple past",
  "past progressive",
  "if-clause",
  "reported speech",
  "Konjunktiv",
  "Passiv",
  "Aktiv",
  "Kasus",
  "Satzglied",
  "Kommasetzung",
  "Zeichensetzung",
  "Konjugation",
  "Deklination",
  "indirekte Rede",
  "Relativsatz",
  // Englisch
  "if-sentence",
  "if sentence",
  "if clause",
  "conditional",
  "simple present",
  "present simple",
  "present progressive",
  "present continuous",
  "past continuous",
  "past perfect",
  "will-future",
  "going-to-future",
  "gerund",
  "infinitive",
  "participle",
  "passive",
  "modal verb",
  "question tag",
  "relative clause",
  "indirect speech",
  "pronoun",
  "adjective",
  "adverb",
  "comparative",
  "superlative",
  "irregular verb",
  // Französisch
  "participe passé",
  "accord du participe",
  "verbe",
  "pronom",
  "impératif",
  "gérondif",
  "négation",
  "comparatif",
  "superlatif",
  "article partitif",
  "discours indirect",
  // Deutsch
  "Partizip",
  "Infinitiv",
  "Imperativ",
  "Präsens",
  "Präteritum",
  "Perfekt",
  "Plusquamperfekt",
  "Modalverb",
  "Wortart",
  "Adjektiv",
  "Adverb",
  "Pronomen",
  "Präposition",
  "Nebensatz",
  "Satzbau",
  "Satzart",
  "Komparativ",
  "Superlativ",
  "dass-Satz",
  "Rechtschreibung",
] as const;

/** Klein, ohne Akzente, Umlaute ausgeschrieben — wie `norm()` im Prototyp. */
export function normText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STICHWORT_MUSTER = GRAMMATIK_STICHWORTE.map(
  (wort) =>
    new RegExp(
      `(^|[^a-z0-9])${escRe(normText(wort))}(en|n|e|s|es|er|form|formen)?($|[^a-z0-9])`,
    ),
);

/** „Futur“ als ganzes Wort, mit „Futur I“, „Futur II“, „le futur“. */
const FUTUR_MUSTER = /(^|[^a-z0-9])futur($|[^a-z0-9])/;

/** Fächer, in denen das nackte „Futur“ Grammatik ist. Englisch nicht. */
const FUTUR_FAECHER = new Set(["fr", "de"]);

/**
 * Hat der Titel ein Grammatik-Stichwort? Mit Fach gilt zusätzlich das nackte
 * „Futur“, wenn das Fach Französisch oder Deutsch ist.
 */
export function hatGrammatikStichwort(titel: string, fach?: { name: string }): boolean {
  const text = normText(titel);
  if (STICHWORT_MUSTER.some((muster) => muster.test(text))) return true;
  const sprache = fach ? fachSprache(fach.name) : null;
  return sprache !== null && FUTUR_FAECHER.has(sprache) && FUTUR_MUSTER.test(text);
}

/**
 * Ist dieses Thema ein Grammatikthema? Die eine Regel für die Zeile
 * („Blatt Grammatik …“, @/lib/kombi/grammatik-themen) und den Auftrag an Opus
 * (`grammatikBlatt`): ein Thema in Deutsch, Englisch oder Französisch mit
 * Grammatik-Stichwort im Titel, dessen geltende Art `ueben` ist.
 *
 * Von Hand umstellbar heißt: ein Stichwort-Thema, das auf „abfragen“ gestellt
 * wurde, ist keins mehr. Ein Thema ohne Stichwort, das auf „üben“ gestellt
 * wurde (etwa Wortschatz), bekommt ein Blatt in der Sprache des Fachs, ist
 * aber kein Grammatikthema.
 */
export function istGrammatikThema(
  thema: { title: string; art: ThemaArt | null },
  fach: { name: string },
): boolean {
  return (
    fachArt(fach.name) === "sprache" &&
    hatGrammatikStichwort(thema.title, fach) &&
    themaArt(thema, fach) === "ueben"
  );
}

/**
 * Ein Arbeitsblatt übt Grammatik, wenn sein Thema ein Grammatikthema ist
 * (`istGrammatikThema`, in der Quelle schon entschieden) und es keine
 * Probeklausur ist (die prüft den ganzen Stoff der Klausur).
 */
export function grammatikBlatt(quelle: { grammatik?: boolean }, probe: boolean | undefined): boolean {
  return !probe && quelle.grammatik === true;
}

type FachArt = "rechnen" | "sprache" | "wissen";

function fachArt(fachName: string): FachArt {
  const n = normText(fachName).trim();
  if (n.startsWith("mathe") || n.startsWith("physik")) return "rechnen";
  if (fachSprache(fachName)) return "sprache";
  return "wissen";
}

/** Die abgeleitete Art, ohne gespeicherten Wert. */
export function artAbgeleitet(
  thema: { title: string },
  fach: { name: string },
): ThemaArt {
  const art = fachArt(fach.name);
  if (art === "rechnen") return "ueben";
  if (art === "sprache" && hatGrammatikStichwort(thema.title, fach)) return "ueben";
  return "abfragen";
}

/** Die geltende Art: gespeicherter Wert, sonst abgeleitet. */
export function themaArt(
  thema: { title: string; art: ThemaArt | null },
  fach: { name: string },
): ThemaArt {
  return thema.art ?? artAbgeleitet(thema, fach);
}

/** Was in der Spalte steht, wenn der Nutzer `art` wählt: leer, wenn es der abgeleiteten entspricht. */
export function gespeicherteArt(
  thema: { title: string },
  fach: { name: string },
  art: ThemaArt,
): ThemaArt | null {
  return art === artAbgeleitet(thema, fach) ? null : art;
}

export type ArtUmstellung = {
  /** Der Wert der Spalte vorher — für Rückgängig */
  vorher: ThemaArt | null;
  protokollId: string;
};

/**
 * Stellt die Art eines Themas um (Kriterium 5): schreibt die Spalte und das
 * Protokoll `thema_art`. Rückgängig über `themaArtZuruecknehmen`.
 */
export async function themaArtSetzen(
  userId: string,
  topicId: string,
  art: ThemaArt,
  tag: string,
  fach: { name: string },
): Promise<ArtUmstellung> {
  const [thema] = await db
    .select({ title: subjectTopics.title, art: subjectTopics.art })
    .from(subjectTopics)
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, topicId)));
  if (!thema) throw new Error("Thema nicht gefunden");

  await db
    .update(subjectTopics)
    .set({ art: gespeicherteArt(thema, fach, art) })
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, topicId)));

  const protokollId = await protokollieren(userId, tag, "thema_art", topicId, {
    art,
  });
  return { vorher: thema.art, protokollId };
}

/** Rückgängig: alter Wert zurück, Protokolleintrag weg. */
export async function themaArtZuruecknehmen(
  userId: string,
  topicId: string,
  umstellung: ArtUmstellung,
): Promise<void> {
  await db
    .update(subjectTopics)
    .set({ art: umstellung.vorher })
    .where(and(eq(subjectTopics.userId, userId), eq(subjectTopics.id, topicId)));
  await protokollLoeschen(userId, umstellung.protokollId);
}
