/**
 * Wohin ein Tipp auf eine Push-Erinnerung führt (Modell 23, Abschnitt F).
 *
 * `/lernen` gibt es nicht mehr; der Lernplan steht auf der Klausurseite. Die
 * Seite öffnet bei direktem Aufruf im Stapel über der Startseite (Plan 2.1).
 *
 * - „Heute lernen“: alle Blöcke zur selben Klausur → deren Seite; Blöcke zu
 *   mehreren Klausuren → `/` (Überblick mit der Lernblockzeile).
 * - Countdown: eine Klausur → ihre Seite; mehrere → `/klausuren`.
 */

export function zielHeuteLernen(bloecke: readonly { examId: string }[]): string {
  const klausuren = new Set(bloecke.map((b) => b.examId));
  return klausuren.size === 1 ? `/klausuren/${[...klausuren][0]}` : "/";
}

export function zielCountdown(klausuren: readonly { id: string }[]): string {
  return klausuren.length === 1 ? `/klausuren/${klausuren[0].id}` : "/klausuren";
}
