import { topicKey } from "@/lib/topics";

/**
 * „Mathe" ist ein Fach — die Übersetzung von dem, was ein Agent sagt, in das,
 * was die Datenschicht verlangt.
 *
 * Reine Rechnung über eine Liste, die der Aufrufer schon geholt hat. Damit ist
 * sie prüfbar, und vor allem entsteht daraus keine zweite Abfrage: die Werkzeuge
 * holen die Fächer ohnehin, um sie im Ergebnis zu nennen.
 *
 * **Drei Antworten und nicht zwei.** „keins" heißt: dazu gibt es nichts.
 * „mehrere" heißt: es könnte dieses oder jenes sein — und das ist etwas
 * anderes. Ein Werkzeug, das bei „Deutsch" wortlos das erste von zwei Fächern
 * nähme, legte ein Blatt ins falsche Fach, und dort findet es später niemand
 * wieder. Also fragt es lieber zurück, und dafür muss es den Unterschied
 * kennen.
 *
 * **Die Reihenfolge der Versuche ist die Reihenfolge der Sicherheit:** id,
 * dann voller Name, dann Kürzel, dann Anfang eines Namens, dann irgendwo im
 * Namen. Jeder Schritt kommt nur dran, wenn der vorige nichts gefunden hat —
 * sonst schlüge ein „Mathe", das genau einem Kürzel entspricht, plötzlich in
 * ein Fach namens „Mathematik-Vertiefung" um, nur weil beide passen.
 */

/** Was bei der Suche herauskam. */
export type Match<T> =
  | { art: "eins"; treffer: T }
  | { art: "mehrere"; namen: string[] }
  | { art: "keins" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sieht das aus wie eine id? Dann ist es keine Suche, sondern ein Verweis. */
export function looksLikeId(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

type SubjectLike = { id: string; name: string; short: string };

/** Findet das gemeinte Fach — id, voller Name, Kürzel oder ein Stück davon. */
export function matchSubject<T extends SubjectLike>(
  subjects: readonly T[],
  query: string,
): Match<T> {
  const wanted = fold(query);
  if (wanted === "") return { art: "keins" };

  if (looksLikeId(query)) {
    const byId = subjects.find((subject) => subject.id === query.trim());
    return byId ? { art: "eins", treffer: byId } : { art: "keins" };
  }

  return firstUnique(subjects, wanted, (subject) => [subject.name, subject.short], (subject) => subject.name);
}

type TopicLike = { id: string; title: string };

/**
 * Findet das gemeinte Thema innerhalb eines Fachs.
 *
 * **Zwei Faltungen, und das ist Absicht.** Der genaue Treffer läuft über
 * `topicKey()` aus @/lib/topics — dieselbe Faltung, mit der die App entscheidet,
 * ob zwei getippte Titel dasselbe Thema sind; eine eigene wäre hier eine zweite
 * Wahrheit über genau diese Frage. Die beiden Sprossen darunter (Anfang,
 * irgendwo) suchen dagegen etwas anderes: nicht „ist das dasselbe Thema", sondern
 * „welches Thema ist wohl gemeint". Dafür zieht `fold()` zusätzlich mehrfache
 * Leerzeichen zusammen, denn „Kettenregel  Übung" soll „Kettenregel Übung"
 * finden. Wer beide zusammenlegte, machte entweder die Gleichheit großzügiger —
 * und legte zwei verschiedene Themen zusammen — oder die Suche strenger.
 */
export function matchTopic<T extends TopicLike>(
  topics: readonly T[],
  query: string,
): Match<T> {
  const wanted = fold(query);
  if (wanted === "") return { art: "keins" };

  if (looksLikeId(query)) {
    const byId = topics.find((topic) => topic.id === query.trim());
    return byId ? { art: "eins", treffer: byId } : { art: "keins" };
  }

  const exact = topics.filter((topic) => topicKey(topic.title) === topicKey(query));
  if (exact.length === 1) return { art: "eins", treffer: exact[0]! };
  if (exact.length > 1) return { art: "mehrere", namen: exact.map((t) => t.title) };

  return firstUnique(topics, wanted, (topic) => [topic.title], (topic) => topic.title);
}

/**
 * Die Leiter: erst genau, dann von vorn, dann irgendwo — und auf jeder Sprosse
 * gilt, dass genau ein Treffer ein Treffer ist.
 *
 * Mehrere auf derselben Sprosse sind ausdrücklich kein Grund weiterzusuchen:
 * wer zwei Fächer hat, die beide „Deutsch" heißen, bekommt die Rückfrage und
 * nicht eine Verfeinerung, die zufällig eines von beiden trifft.
 */
function firstUnique<T>(
  items: readonly T[],
  wanted: string,
  fields: (item: T) => string[],
  label: (item: T) => string,
): Match<T> {
  const tests: ((value: string) => boolean)[] = [
    (value) => value === wanted,
    (value) => value.startsWith(wanted),
    (value) => value.includes(wanted),
  ];

  for (const passt of tests) {
    const hits = items.filter((item) => fields(item).some((value) => passt(fold(value))));

    if (hits.length === 1) return { art: "eins", treffer: hits[0]! };
    if (hits.length > 1) return { art: "mehrere", namen: hits.map(label) };
  }

  return { art: "keins" };
}

/**
 * Rand weg, Kleinschreibung, mehrfache Leerzeichen zu einem.
 *
 * `toLocaleLowerCase("de")` wie überall sonst im Projekt: ein „Ü" soll an jeder
 * Stelle zu demselben Zeichen werden.
 */
function fold(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
}
