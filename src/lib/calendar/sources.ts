import {
  examEvent,
  freePeriodEvent,
  homeworkEvent,
  type CalendarKind,
  type WantedEvent,
} from "@/lib/calendar/events";
import { errorText } from "@/lib/calendar/error-text";
import { examTopicTitles, listExams } from "@/lib/exams";
import { listAllFreePeriods } from "@/lib/free-days";
import { listHomework } from "@/lib/homework";

/**
 * Woher die Termine kommen — eine Quelle ist eine Funktion, die die
 * gewünschten Termine einer Art liefert.
 *
 * Heute sind es drei: Prüfungen, offene Hausaufgaben, freie Tage. **Lernblöcke
 * und Abruf-Termine kommen NIE hierher.** Sie sind ein Vorschlag der App für
 * den eigenen Tag, keine Verabredung mit der Schule, und ein Kalender voller
 * Lernblöcke machte aus der App den Tagesplaner, der sie ausdrücklich nicht
 * sein soll.
 *
 * ── Eine Quelle liefert VOLLSTÄNDIG oder wirft ───────────────────────────────
 *
 * Was eine Quelle nicht liefert, wird aus Google gelöscht. Eine Liste mit
 * LIMIT, ein Filter auf „ab heute", eine halb gelesene Antwort von außen — all
 * das sähe aus wie viele Löschungen. Deshalb gilt: alles oder ein Wurf.
 * `collectWishes()` fängt den Wurf, und die Art der gescheiterten Quelle fehlt
 * dann in `complete` — ihre Zeilen bleiben in diesem Lauf unberührt, die
 * anderen Arten laufen weiter. Eine scheiternde externe Quelle friert also nur
 * ihre eigene Art ein.
 *
 * Archivierte Fächer werden nicht herausgefiltert, wie in den Listen der App:
 * Eine Klausur in einem abgewählten Fach hat trotzdem stattgefunden.
 *
 * ── Die Stufen 3–5 andocken ──────────────────────────────────────────────────
 *
 * Schulhomepage, Termine von Blättern, IServ — jede ist eine weitere Quelle:
 *
 *   1. eine neue `CalendarKind` in @/lib/calendar/events, mit einem Präfix
 *      NUR aus a–v (reserviert: „sab" Blatt, „sas" Schulhomepage, „sai" IServ)
 *      und einer Farbe,
 *   2. ein Builder daneben, der einen `WantedEvent` baut,
 *   3. ein Eintrag in `SOURCES` hier.
 *
 * Plan und Ausführung bleiben unverändert. Eine Quelle ohne UUID (IServ)
 * baut ihre `idBase` als Präfix + `sha256(fremdeId).hex.slice(0, 32)` — Hex ist
 * eine Teilmenge von base32hex. Termine mit Uhrzeit erweitern
 * `CalendarEventBody` um `{ dateTime, timeZone }`; Plan und Ausführung hashen
 * den Termin nur und reichen ihn weiter.
 */

export type SourceContext = {
  userId: string;
  reminderHour: number;
  appOrigin: string;
};

/** Alles, was diese Quelle jetzt im Kalender haben will — VOLLSTÄNDIG, ohne LIMIT. Wirft, wenn sie es nicht sicher weiß. */
export type CalendarSource = {
  kind: CalendarKind;
  wanted(ctx: SourceContext): Promise<WantedEvent[]>;
};

/** Alle Prüfungen, auch die vergangenen — sie bleiben im Kalender stehen. */
export const examSource: CalendarSource = {
  kind: "klausur",
  async wanted(ctx) {
    const [exams, topics] = await Promise.all([
      listExams(ctx.userId, { includePast: true }),
      examTopicTitles(ctx.userId),
    ]);

    return exams.map((exam) =>
      examEvent({
        exam,
        subjectName: exam.subject.name,
        topics: topics.get(exam.id) ?? [],
        appOrigin: ctx.appOrigin,
      }),
    );
  },
};

/**
 * Nur offene Hausaufgaben, auch überfällige. Wird eine abgehakt, fehlt sie hier
 * — und die App nimmt sie aus Google. Das ist eine Löschung DURCH DIE APP, kein
 * „verworfen": Wird sie wieder geöffnet, kommt sie zurück.
 */
export const homeworkSource: CalendarSource = {
  kind: "hausaufgabe",
  async wanted(ctx) {
    const items = await listHomework(ctx.userId);

    return items.map((item) =>
      homeworkEvent({
        homework: item,
        subjectName: item.subject.name,
        reminderHour: ctx.reminderHour,
        appOrigin: ctx.appOrigin,
      }),
    );
  },
};

/** ALLE freien Zeiträume — nicht `listFreePeriods()`, die filtert Vergangenes heraus. */
export const freePeriodSource: CalendarSource = {
  kind: "frei",
  async wanted(ctx) {
    const periods = await listAllFreePeriods(ctx.userId);

    return periods.map((period) =>
      freePeriodEvent({ period, appOrigin: ctx.appOrigin }),
    );
  },
};

export const SOURCES: readonly CalendarSource[] = [
  examSource,
  homeworkSource,
  freePeriodSource,
];

/**
 * Alle Quellen fragen, jede für sich. Was eine Quelle nicht vollständig
 * liefern konnte — sie hat geworfen, oder ein Schlüssel kam doppelt vor —,
 * fehlt in `complete`, und keiner ihrer Wünsche kommt in `wanted`.
 */
export async function collectWishes(
  ctx: SourceContext,
  sources: readonly CalendarSource[] = SOURCES,
): Promise<{
  wanted: WantedEvent[];
  complete: Set<string>;
  errors: { kind: string; sentence: string }[];
}> {
  const wanted: WantedEvent[] = [];
  const complete = new Set<string>();
  const errors: { kind: string; sentence: string }[] = [];

  for (const source of sources) {
    try {
      const list = await source.wanted(ctx);
      const keys = new Set<string>();

      for (const wish of list) {
        if (wish.kind !== source.kind) {
          throw new Error(`Die Quelle „${source.kind}" liefert einen Termin der Art „${wish.kind}".`);
        }
        if (keys.has(wish.key)) {
          throw new Error(`Der Schlüssel ${wish.key} kommt zweimal vor.`);
        }
        keys.add(wish.key);
      }

      wanted.push(...list);
      complete.add(source.kind);
    } catch (fehler) {
      const sentence = errorText(fehler);
      errors.push({ kind: source.kind, sentence });
      console.error("Google-Kalender: Quelle gescheitert", source.kind, sentence);
    }
  }

  return { wanted, complete, errors };
}
