import { daysBetween, germanShortParts } from "@/lib/dates";

/**
 * Die Fälligkeit einer Hausaufgabe in Kurzform — der Text und der Ton dazu.
 *
 * Reine Rechnung: kein JSX, keine Systemuhr — deshalb liegt die Datei in
 * src/lib und nicht bei den Bauteilen, und ihr Test liegt daneben. „heute“
 * kommt von außen, damit Liste, Startseite und Dashboard denselben Tag
 * meinen. Gerechnet wird ausschließlich über @/lib/dates und Kalenderdaten
 * „YYYY-MM-DD“ — eigene Date-Arithmetik würde bei der Umstellung auf
 * Sommerzeit einen Tag verschieben.
 *
 * Die Kurzform steht im Entwurf in Geist Mono und ist deshalb absichtlich
 * knapp: „heute“, „Do“, „24.9.“. Das ganze Datum steht auf der Seite der
 * Aufgabe.
 */

/** Ab sieben Tagen wiederholen sich die Wochentage — „Do“ wäre nicht mehr eindeutig. */
const WEEK = 7;

/**
 * Wie dringend eine Aufgabe ist. Erledigt ist kein Zeitpunkt, sondern ein
 * Zustand.
 *
 * Die Farbregel dazu gilt überall gleich und steht deshalb hier und nicht in
 * den Ansichten: **Warnfarbe trägt allein `overdue`.** „heute“ bleibt grau —
 * in der Aufgabenliste wie im Dashboard-Widget, so wie der Entwurf es
 * zeichnet. Was heute fällig ist, ist der Normalfall eines Schultags; färbte
 * man ihn, stünde die halbe Liste in Bernstein und das wirklich Überfällige
 * ginge darin unter. `done` ist am leisesten, alles andere bleibt grau.
 *
 * Die eine Ausnahme steht auf der Hausaufgaben-Kachel am Handy: dort setzt
 * der Entwurf die Caption ausdrücklich in `var(--warning)`, weil sie im
 * Kachelraster die einzige farbige Zeile ist.
 */
export type DueTone = "overdue" | "today" | "soon" | "later" | "done";

export function dueLabel(dueDate: string, today: string): string {
  const days = daysBetween(today, dueDate);

  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  if (days === -1) return "gestern";

  const { weekday, dayMonth } = germanShortParts(dueDate);

  // Innerhalb der nächsten Woche sagt der Wochentag mehr als das Datum.
  // Rückwärts nicht: „Do“ für einen vergangenen Donnerstag läse sich wie ein
  // Termin, der noch kommt — Überfälliges bekommt deshalb sein Datum.
  return days > 1 && days < WEEK ? weekday : dayMonth;
}

export function dueTone(
  dueDate: string,
  today: string,
  done: boolean,
): DueTone {
  // Erledigt schlägt alles: eine abgehakte Aufgabe von gestern ist nicht
  // überfällig, sie ist fertig.
  if (done) return "done";

  const days = daysBetween(today, dueDate);

  if (days < 0) return "overdue";
  if (days === 0) return "today";

  // Dieselbe Grenze wie oben: „soon“ ist genau das, was als Wochentag
  // dasteht, „later“ das, was als Datum dasteht.
  return days < WEEK ? "soon" : "later";
}
