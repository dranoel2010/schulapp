/**
 * Texthelfer und Datumsformate wie im Prototyp (Z. 999–1002, 1084–1091,
 * 1130). Alle Formate rechnen mit `timeZone: 'Europe/Berlin'`, damit Server
 * (im Container UTC) und Browser dasselbe schreiben — sonst gibt es
 * Hydration-Fehler.
 *
 * Tage sind Kalendertage als 'YYYY-MM-DD'. Sie werden für die Formatierung
 * als 12:00 UTC gelesen, das ist in Berlin immer derselbe Tag.
 */

const ZONE = "Europe/Berlin";

export const TAG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;
export const TK = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
export const MONAT = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
] as const;

const mittag = (tag: string) => new Date(`${tag}T12:00:00Z`);

const teileFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  weekday: "short",
  day: "numeric",
  month: "numeric",
  year: "numeric",
});
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function teile(tag: string): { wd: number; d: number; m: number } {
  const p = Object.fromEntries(
    teileFormat.formatToParts(mittag(tag)).map((x) => [x.type, x.value]),
  );
  return { wd: WD[p.weekday], d: Number(p.day), m: Number(p.month) };
}

/** Wochentag 0 = Sonntag … 6 = Samstag. */
export const wd = (tag: string): number => teile(tag).wd;
/** „12.10.“ */
export const dm = (tag: string): string => {
  const t = teile(tag);
  return `${t.d}.${t.m}.`;
};
/** „Mo 12.10.“ */
export const kurz = (tag: string): string => `${TK[wd(tag)]} ${dm(tag)}`;
/** „Montag, 12.10.“ */
export const lang = (tag: string): string => `${TAG[wd(tag)]}, ${dm(tag)}`;
/** „Montag, 12. Oktober“ — die Datumszeile */
export const voll = (tag: string): string => {
  const t = teile(tag);
  return `${TAG[t.wd]}, ${t.d}. ${MONAT[t.m - 1]}`;
};

/** Tage zwischen zwei Kalendertagen. */
export const diffDays = (a: string, b: string): number =>
  Math.round((mittag(b).getTime() - mittag(a).getTime()) / 864e5);

/** Innerhalb einer Woche der Wochentag, sonst „Montag, 19.10.“ */
export const weekdayOrDate = (tag: string, heute: string): string =>
  diffDays(heute, tag) <= 6 ? TAG[wd(tag)] : lang(tag);

const uhrFormat = new Intl.DateTimeFormat("de-DE", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** „16:40“ — eine Uhrzeit in Berlin (z. B. „Stand 16:40“). */
export const uhrzeit = (zeitpunkt: Date): string => uhrFormat.format(zeitpunkt);

/** HTML-Zeichen maskieren. */
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/** Zahlen mit proportionalen Trennzeichen (Prototyp `tn`), als HTML. */
export const tn = (s: unknown): string =>
  esc(s).replace(/[:.,]/g, (m) => `<span class="c">${m}</span>`);

/** {…} markiert eine Formel: kursiv in Newsreader (Prototyp `fx`), als HTML. */
export const fx = (s: unknown): string =>
  esc(s).replace(/\{([^}]+)\}/g, (_m, f: string, i: number) => `<span class="f-in${i === 0 ? " lead" : ""}">${f}</span>`);

export type FxTeil = { text: string; formel: boolean; lead: boolean };

/** Dieselbe Zerlegung wie `fx`, aber als Teile für React (nie innerHTML). */
export function fxTeile(s: string): FxTeil[] {
  const out: FxTeil[] = [];
  const re = /\{([^}]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), formel: false, lead: false });
    out.push({ text: m[1], formel: true, lead: m.index === 0 });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), formel: false, lead: false });
  return out;
}

const ZAHL = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];
/** Zahlwort bis zwölf (g = 'n' für „ein“). */
export function zahl(n: number, g?: "n"): string {
  if (n === 1) return g === "n" ? "ein" : "eine";
  return n <= 12 ? ZAHL[n] : String(n);
}
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
