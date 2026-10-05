import { timingSafeEqual } from "node:crypto";

/**
 * Darf diese Anfrage einen Cron-Lauf auslösen? „Authorization: Bearer
 * <CRON_SECRET>", kein Cookie.
 *
 * Drei Türen, eine Prüfung — /api/cron/reminders, /api/cron/wiki und
 * /api/cron/kalender —, und sie darf an keiner schwächer sein als an den
 * anderen. Bis zur zweiten Tür stand sie wortgleich in jeder Route. Die
 * Zusammenlegung folgt der Regel, die an `isCalendarDate()` in @/lib/dates
 * steht: bei der dritten Tür, denn ab dann wäre es die Stelle, an der die App
 * an einer Tür annimmt, was sie an einer anderen ablehnt.
 *
 * Zeichenweise gleich lange Prüfung, damit sich das Geheimnis nicht über die
 * Antwortzeit erraten lässt.
 */
export function isCronAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length) return false;

  return timingSafeEqual(given, expected);
}
