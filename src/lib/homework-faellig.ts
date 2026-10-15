import { nextLessonDate, type LessonWithSubject } from "@/lib/timetable";

/**
 * Für jedes Fach der Tag seiner nächsten Stunde.
 *
 * nextLessonDate lässt den heutigen Tag bewusst aus: aufgegeben wird in der
 * Stunde, fällig ist es beim nächsten Mal. Fächer ohne Stunde im Plan tauchen
 * gar nicht erst auf — für sie greift der Rückfall im Formular.
 *
 * Fällt die nächste Stunde in die Ferien oder auf die Klassenfahrt, ist es die
 * erste danach: eine Aufgabe vom Freitag vor den Herbstferien ist nicht am
 * Montag in den Ferien fällig.
 *
 * Anlegen nutzt es als Vorbelegung, Bearbeiten am Rechner als Datums-Chip.
 */
export function nextLessonPerSubject(
  lessons: LessonWithSubject[],
  today: string,
  free: ReadonlySet<string>,
): Record<string, string> {
  const weekdays = new Map<string, number[]>();

  for (const lesson of lessons) {
    const days = weekdays.get(lesson.subjectId);
    if (days) days.push(lesson.weekday);
    else weekdays.set(lesson.subjectId, [lesson.weekday]);
  }

  const dates: Record<string, string> = {};

  for (const [subjectId, days] of weekdays) {
    let date = nextLessonDate(today, days);
    while (date && free.has(date)) date = nextLessonDate(date, days);
    if (date) dates[subjectId] = date;
  }

  return dates;
}
