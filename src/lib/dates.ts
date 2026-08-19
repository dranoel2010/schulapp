/**
 * Kalenderdaten als Zeichenkette "YYYY-MM-DD".
 *
 * Ein Prüfungstag ist ein Tag im Kalender, kein Zeitpunkt. Deshalb rechnet
 * dieses Modul ausschließlich über UTC-Mitternacht: sonst würde die Umstellung
 * auf Sommerzeit einen Tag um eine Stunde verschieben, und "plus 7 Tage" läge
 * plötzlich auf dem falschen Datum.
 *
 * Regel für alle Aufrufer: "heute" wird hereingereicht, nicht im Modul aus der
 * Systemuhr gezogen. Einzige Ausnahme ist todayInBerlin() — die Funktion, deren
 * einziger Zweck genau das ist.
 */

const MS_PER_DAY = 86_400_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAYS_LONG = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

/** "2026-09-14" → Millisekunden auf UTC-Mitternacht. */
function toUtc(date: string): number {
  if (typeof date !== "string" || !ISO_DATE.test(date)) {
    throw new RangeError(`Kein Kalenderdatum im Format YYYY-MM-DD: ${date}`);
  }

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError(`Diesen Tag gibt es nicht: ${date}`);
  }

  // Über setUTCFullYear, weil Date.UTC zweistellige Jahre ins 20. Jahrhundert
  // schiebt.
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value.getTime();
}

/** Millisekunden → "2026-09-14". */
function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

let berlinFormat: Intl.DateTimeFormat | null = null;

/**
 * Das heutige Datum in Berlin. "sv-SE" ist der kürzeste Weg zu YYYY-MM-DD,
 * die schwedische Schreibweise entspricht genau ISO.
 *
 * Der Zeitpunkt ist optional übergebbar, damit sich Tageswechsel testen lassen.
 */
export function todayInBerlin(now: Date = new Date()): string {
  berlinFormat ??= new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return berlinFormat.format(now);
}

/** Verschiebt ein Datum um ganze Tage, auch rückwärts. */
export function addDays(date: string, days: number): string {
  return toIso(toUtc(date) + Math.trunc(days) * MS_PER_DAY);
}

/** Ganze Tage von `from` bis `to`. Negativ, wenn `to` früher liegt. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

/** 0 = Montag … 6 = Sonntag. */
export function weekdayIndex(date: string): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

/**
 * "lang" → "Mittwoch, 14. September", "kurz" → "Mi, 14.9."
 *
 * Bewusst mit festen Wortlisten statt über Intl: die App zeigt diese Zeilen
 * täglich, und ICU liefert je nach Umgebung mal "Mi.", mal "Mi".
 */
export function formatGerman(
  date: string,
  style: "lang" | "kurz" = "lang",
): string {
  const value = new Date(toUtc(date));
  const day = value.getUTCDate();
  const month = value.getUTCMonth();
  const weekday = weekdayIndex(date);

  if (style === "kurz") {
    return `${WEEKDAYS_SHORT[weekday]}, ${day}.${month + 1}.`;
  }

  return `${WEEKDAYS_LONG[weekday]}, ${day}. ${MONTHS[month]}`;
}

/** Abstand in Alltagssprache: "heute", "in 5 Tagen", "vor 2 Tagen". */
export function formatCountdown(fromDate: string, toDate: string): string {
  const days = daysBetween(fromDate, toDate);

  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  if (days === 2) return "übermorgen";
  if (days === -1) return "gestern";
  if (days > 0) return `in ${days} Tagen`;
  return `vor ${-days} Tagen`;
}

/** Liegt das Datum vor dem übergebenen Heute? */
export function isPast(date: string, today: string): boolean {
  return daysBetween(today, date) < 0;
}
