import { bare } from "@/lib/kombi/fach-alias";

/**
 * Die Sprache eines Arbeitsblatts (Modell 23, Antwort 5 vom 13.10.2026):
 * ein Grammatikblatt richtet sich nach der Sprache des Fachs. Englisch gibt
 * ein Blatt auf Englisch, Französisch auf Französisch, Deutsch auf Deutsch.
 * Kurze Arbeitsanweisungen auf Deutsch dürfen dabeistehen, wie in der Schule.
 *
 * Rein, ohne Datenbank: Zeile (Client) und Bau (Server) nutzen dieselbe Regel.
 */

export type BlattSprache = "en" | "fr" | "de";

export const SPRACH_NAME: Record<BlattSprache, string> = {
  en: "Englisch",
  fr: "Französisch",
  de: "Deutsch",
};

/** Die Sprache eines Fachs, am Fachnamen erkannt — sonst null (Mathematik, Geschichte …). */
export function fachSprache(fachName: string): BlattSprache | null {
  const n = bare(fachName);
  if (n.startsWith("englisch") || n.startsWith("english")) return "en";
  if (n.startsWith("franz") || n.startsWith("francais")) return "fr";
  if (n.startsWith("deutsch")) return "de";
  return null;
}

/** Wörter, an denen die Zeile eine Sprache erkennt, auch wenn es das Fach dazu nicht gibt. */
const SPRACH_WORTE: Record<string, BlattSprache> = {
  englisch: "en",
  english: "en",
  franzoesisch: "fr",
  franzosisch: "fr",
  francais: "fr",
  franz: "fr",
  frz: "fr",
  deutsch: "de",
};

/** Ein Wort der Zeile als Sprache: „Englisch“, „französisch“, „frz“ — sonst null. */
export function spracheAusWort(wort: string): BlattSprache | null {
  return SPRACH_WORTE[bare(wort)] ?? null;
}

/** So heißt die Aufgabenstellung in der Sprache, als Beispiel für das Modell. */
const BEISPIEL: Record<BlattSprache, string> = {
  en: "„Complete the sentences.“, „Put the verbs into the simple past.“",
  fr: "„Complète les phrases.“, „Mets les verbes au passé composé.“",
  de: "„Bestimme die Satzglieder.“, „Setze die Kommas.“",
};

/** Beispiele ohne Grammatik, für Probeklausuren und Themen über Texte oder Wortschatz. */
const BEISPIEL_ALLGEMEIN: Record<BlattSprache, string> = {
  en: "„Answer the questions.“, „Complete the sentences.“",
  fr: "„Réponds aux questions.“, „Complète les phrases.“",
  de: "„Beantworte die Fragen.“, „Erkläre mit eigenen Worten.“",
};

/**
 * Der Absatz im Auftrag, der die Sprache des Blatts festlegt. Bei Englisch und
 * Französisch steht das Blatt in der Fremdsprache wie im Schulbuch; bei
 * Deutsch ist alles auf Deutsch und nichts kursiv.
 *
 * `grammatik`: nur ein Grammatikthema (Stichwort im Titel, keine
 * Probeklausur) heißt im Auftrag „Grammatikblatt“ und übt eine Regel aus den
 * Abschriften. Sonst legt der Absatz nur die Sprache fest, damit er einer
 * Probeklausur über Texte oder Wortschatz nicht widerspricht.
 */
export function spracheAbsatz(sprache: BlattSprache, { grammatik }: { grammatik: boolean }): string {
  const name = SPRACH_NAME[sprache];
  const beispiel = grammatik ? BEISPIEL[sprache] : BEISPIEL_ALLGEMEIN[sprache];
  if (sprache === "de") {
    return [
      grammatik
        ? `Sprache des Blatts: Deutsch. Es ist ein Grammatikblatt für den Deutschunterricht: Aufgabenstellungen, Übungssätze und Lösungen stehen auf Deutsch, etwa ${beispiel}.`
        : `Sprache des Blatts: Deutsch. Aufgabenstellungen und Lösungen stehen auf Deutsch, etwa ${beispiel}.`,
      ...(grammatik ? ["Die Übungssätze dürfen neu sein; die Regel, die sie üben, kommt aus den Abschriften."] : []),
      "fr bleibt weg, nichts wird kursiv gesetzt.",
    ].join(" ");
  }
  return [
    grammatik
      ? `Sprache des Blatts: ${name}. Es ist ein Grammatikblatt für den ${name}unterricht und sieht aus wie dort: die Aufgabenstellung (q) schreibst du auf ${name}, wie im Schulbuch, etwa ${beispiel}`
      : `Sprache des Blatts: ${name}. Die Aufgabenstellung (q) schreibst du auf ${name}, wie im Schulbuch, etwa ${beispiel}`,
    "Dahinter darf eine kurze Arbeitsanweisung auf Deutsch in Klammern stehen, wenn sie die Aufgabe klarer macht, wie in der Schule üblich.",
    grammatik
      ? `Übungssätze, Lückentexte und Teile stehen auf ${name} und bekommen fr = true; eine Übersetzungsaufgabe darf deutsche Sätze haben, die ins ${name}e übersetzt werden.`
      : `Sätze, Texte und Teile auf ${name} bekommen fr = true; eine Übersetzungsaufgabe darf deutsche Sätze haben, die ins ${name}e übersetzt werden.`,
    `Die Lösungen auf Seite 2 (teile, erg) stehen auf ${name}; eine Erklärung (p) oder ein typischer Fehler (hint) darf kurz auf Deutsch sein.`,
    ...(grammatik
      ? [`Die Übungssätze dürfen neu sein, mit Wörtern, die ein Schüler der 10. Klasse kennt; die Grammatik, die sie üben, kommt aus den Abschriften.`]
      : []),
    "kurz und teil schreibst du auf Deutsch, mit dem Fachbegriff, wie er im Unterricht heißt.",
  ].join(" ");
}
