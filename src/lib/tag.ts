import { addDays, berlinDay, timeInBerlin } from "@/lib/dates";
import { freePeriodOn, listAllFreePeriods, type FreeRange } from "@/lib/free-days";
import { ablaufSchritt, ablaufStand, type AblaufSchritt, type AblaufStand } from "@/lib/protokoll";
import {
  DEFAULT_PERIODS,
  listLessons,
  listPeriods,
  weekdayOf,
  type LessonWithSubject,
} from "@/lib/timetable";

/**
 * Uhr, Tag und Ansicht der Startseite (Modell 23, Plan 3.1; Prototyp
 * Z. 1052–1132 und `ansicht()` Z. 1335).
 *
 * - Der **App-Tag** wechselt um 04:00 Europe/Berlin (`appTag`): um 00:30 sieht
 *   er noch den Überblick des Abends.
 * - **Schultag** heißt Mo–Fr, mindestens eine Stunde im Plan, kein freier
 *   Zeitraum (`free_periods`).
 * - **Schulschluss** ist das Ende der spätesten Stunde des Tages.
 * - Die **Ansicht** rechnet der Server: kein Schultag → Überblick; vor
 *   Schulschluss → Morgens; danach ohne Eintrag `ablauf_beendet` oder
 *   `ablauf_uebersprungen` → Ablauf; sonst Überblick (V2 3.2).
 *
 * Die Rechnung selbst ist rein (`ansichtRechnen`, `Schulkalender`), damit sie
 * sich ohne Datenbank prüfen lässt; die async-Fassungen laden nur dazu.
 *
 * **Testuhr:** Nur mit `SCHULAPP_TESTUHR=1` liest `jetzt()` das Cookie
 * `testuhr` (gesetzt über `/api/testuhr?jetzt=…`, `?zeit=HH:MM&tag=…`). Auf
 * dem NAS ist die Variable nie gesetzt; dann ist `jetzt()` schlicht
 * `new Date()`.
 */

export type Ansicht = "morgens" | "ablauf" | "ueberblick" | "frueh";

// ── App-Tag ──────────────────────────────────────────────────────────────────

/** Der App-Tag: der Berliner Kalendertag von „jetzt minus 4 Stunden“. */
export function appTag(now: Date): string {
  return berlinDay(new Date(now.getTime() - 4 * 3600_000));
}

// ── Testuhr ──────────────────────────────────────────────────────────────────

export const TESTUHR_COOKIE = "testuhr";

export const testuhrErlaubt = (): boolean => process.env.SCHULAPP_TESTUHR === "1";

/**
 * Der Zeitpunkt zu einer Berliner Wanduhrzeit an einem Kalendertag — für
 * `?zeit=07:10` und die Testuhr. Zwei Schritte, damit auch der Tag der
 * Zeitumstellung stimmt.
 */
export function berlinZeitpunkt(tag: string, hhmm: string): Date {
  const [y, m, d] = tag.split("-").map(Number);
  const [H, M] = hhmm.split(":").map(Number);
  const wand = Date.UTC(y, m - 1, d, H, M);
  let t = wand;
  for (let i = 0; i < 2; i++) {
    const tagJetzt = berlinDay(new Date(t));
    const [hh, mm] = timeInBerlin(new Date(t)).split(":").map(Number);
    const [yy, mo, dd] = tagJetzt.split("-").map(Number);
    const gesehen = Date.UTC(yy, mo - 1, dd, hh, mm);
    t += wand - gesehen;
  }
  return new Date(t);
}

/**
 * Wert des Cookies: Start der Testuhr und wann sie gestellt wurde. Die Uhr
 * läuft von dort weiter wie eine echte (Prototyp `jetztMs`), damit ein
 * Wechsel um 13:10 auch beim Warten eintritt.
 */
export type Testuhr = { start: number; gestellt: number };

export function testuhrLesen(wert: string | undefined, real: number = Date.now()): Date | null {
  if (!wert) return null;
  try {
    const u = JSON.parse(decodeURIComponent(wert)) as Partial<Testuhr>;
    if (typeof u.start !== "number" || typeof u.gestellt !== "number") return null;
    return new Date(u.start + Math.max(0, real - u.gestellt));
  } catch {
    return null;
  }
}

/**
 * Aus den Prüfschaltern des Prototyps (Z. 1060): `?jetzt=2026-10-12T07:10`
 * (Berliner Zeit) oder `?zeit=07:10` (Montag, 12.10.) mit optional
 * `&tag=2026-10-13`. Null, wenn keiner gesetzt ist oder er nicht passt.
 */
export function testuhrAusParametern(p: URLSearchParams): Date | null {
  const j = p.get("jetzt");
  if (j) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})/.exec(j);
    if (m) return berlinZeitpunkt(m[1], m[2].padStart(5, "0"));
  }
  const z = p.get("zeit");
  if (z && /^\d{1,2}:\d{2}$/.test(z)) {
    const t = p.get("tag");
    const tag = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "2026-10-12";
    return berlinZeitpunkt(tag, z.padStart(5, "0"));
  }
  return null;
}

/**
 * „Jetzt“ für alle Lesewege der Startseite. Ohne Testuhr `new Date()`; mit
 * `SCHULAPP_TESTUHR=1` und gesetztem Cookie die Testuhr.
 */
export async function jetzt(): Promise<Date> {
  if (!testuhrErlaubt()) return new Date();
  const { cookies } = await import("next/headers");
  const wert = (await cookies()).get(TESTUHR_COOKIE)?.value;
  return testuhrLesen(wert) ?? new Date();
}

// ── Schulkalender (rein) ─────────────────────────────────────────────────────

/** Was die Tagesrechnung braucht: Stunden je Wochentag, Raster, freie Tage. */
export type Schulkalender = {
  /** Stunden je Wochentag (1 = Montag), nach Stunde sortiert */
  stunden: Map<number, LessonWithSubject[]>;
  /** Beginn und Ende je Stundennummer */
  raster: Map<number, { startsAt: string; endsAt: string }>;
  frei: readonly (FreeRange & { kind: string })[];
};

export function istSchultag(k: Schulkalender, tag: string): boolean {
  const w = weekdayOf(tag);
  if (w > 5) return false;
  if (freePeriodOn(k.frei, tag)) return false;
  return (k.stunden.get(w) ?? []).length > 0;
}

/** Die Stunden an einem Tag — leer an Tagen ohne Schule. */
export function stundenAm(k: Schulkalender, tag: string): LessonWithSubject[] {
  return istSchultag(k, tag) ? (k.stunden.get(weekdayOf(tag)) ?? []) : [];
}

/** Ende der spätesten Stunde als "HH:MM", ohne Schule null. */
export function schlussZeit(k: Schulkalender, tag: string): string | null {
  let spaet: string | null = null;
  for (const s of stundenAm(k, tag)) {
    const ende = k.raster.get(s.period)?.endsAt;
    if (ende && (!spaet || ende > spaet)) spaet = ende;
  }
  return spaet;
}

/** Der nächste Tag nach `tag`, an dem Schule ist (höchstens 60 Tage weit). */
export function naechsterSchultagIn(k: Schulkalender, tag: string): string {
  let d = tag;
  for (let i = 0; i < 60; i++) {
    d = addDays(d, 1);
    if (istSchultag(k, d)) return d;
  }
  // Ohne Stundenplan gibt es keinen Schultag: dann der nächste Werktag, nie Sa oder So.
  d = addDays(tag, 1);
  while (weekdayOf(d) > 5) d = addDays(d, 1);
  return d;
}

/** Ist Schulschluss des App-Tags vorbei? Nach Mitternacht (App-Tag ist gestern) immer. */
export function nachSchulschluss(k: Schulkalender, now: Date): boolean {
  const t = appTag(now);
  const schluss = schlussZeit(k, t);
  if (!schluss) return true;
  if (berlinDay(now) !== t) return true;
  return timeInBerlin(now) >= schluss;
}

/** Die Ansicht nach V2 3.2 (Prototyp `ansicht()`, Z. 1335). */
export function ansichtRechnen(k: Schulkalender, now: Date, stand: AblaufStand): Ansicht {
  const t = appTag(now);
  if (!istSchultag(k, t)) return "ueberblick";
  if (!nachSchulschluss(k, now)) return "morgens";
  if (!stand) return "ablauf";
  return "ueberblick";
}

// ── Mit Datenbank ────────────────────────────────────────────────────────────

export async function ladeKalender(userId: string): Promise<Schulkalender> {
  const [stunden, raster, frei] = await Promise.all([
    listLessons(userId),
    listPeriods(userId),
    listAllFreePeriods(userId),
  ]);
  const jeTag = new Map<number, LessonWithSubject[]>();
  for (const s of stunden) {
    const liste = jeTag.get(s.weekday) ?? [];
    liste.push(s);
    jeTag.set(s.weekday, liste);
  }
  for (const liste of jeTag.values()) liste.sort((a, b) => a.period - b.period);
  return {
    stunden: jeTag,
    // Ohne gespeichertes Raster gilt die Vorgabe — wie ensurePeriods(), nur ohne zu schreiben.
    raster: new Map(
      (raster.length ? raster : DEFAULT_PERIODS).map((p) => [p.number, { startsAt: p.startsAt, endsAt: p.endsAt }]),
    ),
    frei,
  };
}

export async function schultag(userId: string, tag: string): Promise<boolean> {
  return istSchultag(await ladeKalender(userId), tag);
}

export async function schulschluss(userId: string, tag: string): Promise<string | null> {
  return schlussZeit(await ladeKalender(userId), tag);
}

export async function naechsterSchultag(userId: string, tag: string): Promise<string> {
  return naechsterSchultagIn(await ladeKalender(userId), tag);
}

export type AnsichtStand = {
  ansicht: Ansicht;
  schritt: AblaufSchritt;
  stand: AblaufStand;
  tag: string;
};

/** Ansicht, Schritt des Ablaufs und dessen Stand für diesen Zeitpunkt. */
export async function ansicht(
  userId: string,
  now: Date,
  kalender?: Schulkalender,
): Promise<AnsichtStand> {
  const tag = appTag(now);
  const [k, stand, schritt] = await Promise.all([
    kalender ?? ladeKalender(userId),
    ablaufStand(userId, tag),
    ablaufSchritt(userId, tag),
  ]);
  return { ansicht: ansichtRechnen(k, now, stand), schritt, stand, tag };
}
