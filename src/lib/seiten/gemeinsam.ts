import { addDays, berlinDay } from "@/lib/dates";
import { freePeriodOn, listFreePeriods } from "@/lib/free-days";
import type { HomeworkItem } from "@/lib/homework";
import { appTagVon } from "@/lib/kombi/tag-daten";
import { lessonRoom } from "@/lib/home";
import {
  loadWeek,
  mergeDoubleLessons,
  periodTimes,
  weekdayOf,
  type WeekPlan,
} from "@/lib/timetable";

/**
 * Was mehrere Nachschlage-Seiten teilen (Plan 3.2): der App-Tag, die
 * Anzeigenamen der Fächer, die Aufgabenzeile und ein kleiner Schulkalender aus
 * Stundenplan und freien Tagen. Alles hier gibt reine, serialisierbare Werte
 * zurück — keine Drizzle-Objekte, keine Datumsobjekte.
 */

/** Der App-Tag (Wechsel um 04:00, Plan 3.1). */
export const heuteApp = (now: Date = new Date()): string => appTagVon(now);

/**
 * Anzeigename eines Fachs („Mathe abgehakt“, Klausurzeile), wörtlich aus dem
 * Prototyp Z. 1094–1100: Mathematik → Mathe, Biologie → Bio, sonst der Name.
 * `subjects.short` ist ein Kürzel wie „M“ und taugt dafür nicht (Plan 3.2).
 */
const KURZ: Record<string, string> = { Mathematik: "Mathe", Biologie: "Bio" };
export const kurzVon = (name: string): string => KURZ[name] ?? name;

/** Eine Aufgabenzeile, wie sie die Seiten zeichnen (Prototyp `taskRow`). */
export type AufgabeDaten = {
  id: string;
  fachId: string;
  /** Anzeigename (`kurz`) */
  fach: string;
  text: string;
  /** Fällig am, 'YYYY-MM-DD' */
  due: string;
  done: boolean;
  /** Abgehakt am, ISO, oder null */
  doneAt: string | null;
  /** Hat die Aufgabe eine längere Notiz? Dann bearbeitet das Formular. */
  details: boolean;
};

export function aufgabeDaten(item: HomeworkItem): AufgabeDaten {
  return {
    id: item.id,
    fachId: item.subject.id,
    fach: kurzVon(item.subject.name),
    text: item.title,
    due: item.dueDate,
    done: item.done,
    doneAt: item.doneAt ? item.doneAt.toISOString() : null,
    details: !!item.details,
  };
}

/** Eine Stunde (Doppelstunden zusammengefasst) mit Zeit, Fach und Raum. */
export type StundeDaten = {
  /** erste Stunde des Blocks */
  nr: number;
  bisNr: number;
  von: string | null;
  bis: string | null;
  fachId: string;
  fach: string;
  raum: string | null;
  /** Hauptunterricht: die erste Stunde mit dem Fach der Epoche */
  hu: boolean;
};

/**
 * Welches Fach die App für die laufende Epoche hält: das Fach, das in der
 * ersten Stunde an den meisten Tagen steht (dieselbe Regel wie die Seite
 * „Epoche wechseln“). Null ohne Stundenplan.
 */
export function epocheAusWoche(week: WeekPlan): string | null {
  const zaehler = new Map<string, number>();
  for (const day of week.days) {
    for (const lesson of day.lessons) {
      if (lesson.period !== 1) continue;
      zaehler.set(lesson.subject.id, (zaehler.get(lesson.subject.id) ?? 0) + 1);
    }
  }
  let bestes: string | null = null;
  let meiste = 0;
  for (const [id, n] of zaehler) {
    if (n > meiste) {
      meiste = n;
      bestes = id;
    }
  }
  // Ein Fach, das nur an einem Tag in der ersten Stunde steht, ist keine Epoche.
  return meiste >= 2 ? bestes : null;
}

export type SchulKalender = {
  week: WeekPlan;
  epoche: string | null;
  /** Seit wann die Epoche läuft: der Tag, an dem ihre erste Stunde eingetragen
   *  wurde (wie `epoche.seit` im Zeilenvorrat). Null ohne Epoche. */
  epocheSeit: string | null;
  frei: (tag: string) => string | null;
  stundenAm: (tag: string) => StundeDaten[];
  schultag: (tag: string) => boolean;
  naechsterSchultag: (tag: string) => string;
  naechsteStunde: (fachId: string, ab: string) => string | null;
};

/** Stundenplan und freie Tage, einmal geladen, danach nur gelesen. */
export async function schulKalender(userId: string, heute: string): Promise<SchulKalender> {
  const [week, freie] = await Promise.all([
    loadWeek(userId),
    // Eine Woche zurück: die Woche-Seite zeigt den Montag dieser Woche.
    listFreePeriods(userId, addDays(heute, -7)),
  ]);
  const zeiten = periodTimes(week.periods);
  const epoche = epocheAusWoche(week);
  const seitMs = epoche
    ? week.days
        .flatMap((d) => d.lessons)
        .filter((l) => l.period === 1 && l.subjectId === epoche)
        .map((l) => l.createdAt.getTime())
        .sort((a, b) => a - b)[0]
    : undefined;
  const epocheSeit = seitMs ? berlinDay(new Date(seitMs)) : null;

  const frei = (tag: string) => {
    const p = freePeriodOn(freie, tag);
    return p ? (p.kind === "ferien" ? "Ferien" : p.title || "Frei") : null;
  };

  const roheStunden = (tag: string) => {
    const wd = weekdayOf(tag);
    if (wd < 1 || wd > 5) return [];
    return week.days.find((d) => d.weekday === wd)?.lessons ?? [];
  };

  const stundenAm = (tag: string): StundeDaten[] => {
    if (frei(tag)) return [];
    return mergeDoubleLessons(roheStunden(tag)).map((b) => ({
      nr: b.from,
      bisNr: b.to,
      von: zeiten.get(b.from)?.startsAt ?? null,
      bis: zeiten.get(b.to)?.endsAt ?? null,
      fachId: b.lesson.subject.id,
      fach: b.lesson.subject.name,
      raum: lessonRoom(b.lesson),
      hu: b.from === 1 && b.lesson.subject.id === epoche,
    }));
  };

  const schultag = (tag: string) => !frei(tag) && roheStunden(tag).length > 0;

  const naechsterSchultag = (tag: string) => {
    let d = tag;
    for (let i = 0; i < 120; i++) {
      d = addDays(d, 1);
      if (schultag(d)) return d;
    }
    return addDays(tag, 1);
  };

  const naechsteStunde = (fachId: string, ab: string) => {
    let d = ab;
    for (let i = 0; i < 60; i++) {
      d = addDays(d, 1);
      if (stundenAm(d).some((s) => s.fachId === fachId)) return d;
    }
    return null;
  };

  return { week, epoche, epocheSeit, frei, stundenAm, schultag, naechsterSchultag, naechsteStunde };
}
