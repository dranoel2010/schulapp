/**
 * Themen einer Prüfung — die Regeln, nach denen ein Titel zugeschnitten wird.
 *
 * Reine Rechnung: keine Datenbank, kein React, kein Next. Genau deshalb liegt
 * das hier und nicht in @/lib/exams — `topic-input.tsx` ist eine Client-
 * Komponente, und ein Import aus einem Modul mit Datenbankzugriff zöge die
 * Datenbank ins Browser-Bundle.
 *
 * Die Grenzen standen vorher an zwei Stellen: als TOPIC_MAX_LENGTH und
 * TOPIC_LIMIT in den Server Actions der Klausuren, und noch einmal als
 * MAX_LENGTH im Eingabefeld. `setTopics()` in @/lib/exams kannte beide nicht —
 * über das Formular wurde also gekürzt und gedeckelt, über einen direkten
 * Aufruf nicht. Sobald eine dritte Tür dazukommt, ist das die Stelle, an der
 * die App an einer Tür annimmt, was sie an einer anderen ablehnt.
 */

/** Länger als eine Zeile ist kein Thema mehr, sondern eine Zusammenfassung. */
export const TOPIC_MAX_LENGTH = 80;

/** So viele Themen kann ein Mensch vor einer Prüfung nicht durcharbeiten. */
export const TOPIC_LIMIT = 40;

/**
 * Der Schlüssel, unter dem zwei Titel als derselbe gelten.
 *
 * Er faltet nur Rand und Groß-/Kleinschreibung — „Kettenregel " und
 * „kettenregel" sind dasselbe Thema, „Ableitungsregeln" und „Kettenregel"
 * nicht. Umformulierungen erkennt er also ausdrücklich nicht; das wäre eine
 * eigene Aufgabe mit eigenen Fehlern.
 *
 * `toLocaleLowerCase("de")` statt `toLowerCase()`, damit an allen Stellen
 * dieselbe Faltung gilt — vorher benutzte das Formular die eine und
 * `setTopics()` die andere.
 */
export function topicKey(title: string): string {
  return title.trim().toLocaleLowerCase("de");
}

/**
 * Schneidet eine Themenliste auf das zu, was gespeichert werden darf:
 * getrimmt, auf `TOPIC_MAX_LENGTH` gekürzt, ohne Leerzeilen, ohne Dubletten,
 * höchstens `TOPIC_LIMIT` Stück.
 *
 * Die Reihenfolge bleibt erhalten, und bei zwei gleichen Titeln gewinnt der
 * erste — sonst könnten nicht beide ihr vorhandenes Thema behalten, und die
 * Lernblöcke daran zeigten ins Leere.
 */
export function normalizeTopics(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of titles) {
    if (typeof raw !== "string") continue;

    const title = raw.trim().slice(0, TOPIC_MAX_LENGTH);
    if (!title) continue;

    const key = topicKey(title);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(title);
    if (result.length >= TOPIC_LIMIT) break;
  }

  return result;
}
