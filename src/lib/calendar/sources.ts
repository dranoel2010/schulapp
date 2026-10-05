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
import { iservAuswahl } from "@/lib/iserv/auswahl";
import { iservConfig, iservConfigured } from "@/lib/iserv/config";
import { klasseVeraltet } from "@/lib/iserv/parse";
import { leseQuellen } from "@/lib/iserv/report";
import { readSnapshots, readState } from "@/lib/iserv/store";

/**
 * Woher die Termine kommen — eine Quelle ist eine Funktion, die die
 * gewünschten Termine einer Art liefert.
 *
 * Heute sind es drei, und mit IServ vier: Prüfungen, offene Hausaufgaben, freie
 * Tage — und, wenn ISERV_* gesetzt ist, die Termine aus IServ, die die Klasse
 * des Schülers betreffen (`iservSource`). **Lernblöcke
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
 * Schulhomepage und Termine von Blättern — jede ist eine weitere Quelle:
 *
 *   1. eine neue `CalendarKind` in @/lib/calendar/events, mit einem Präfix
 *      NUR aus a–v (reserviert: „sab" Blatt, „sas" Schulhomepage) und einer
 *      Farbe,
 *   2. ein Builder daneben, der einen `WantedEvent` baut,
 *   3. ein Eintrag in `SOURCES` hier — oder, wenn die Quelle eine Umgebung
 *      braucht, in `activeSources()` wie IServ.
 *
 * Plan und Ausführung bleiben unverändert. **IServ ist erledigt** (Art
 * `iserv`, Präfix „sai", Pfau): Die Quelle liest NIE das Netz, sondern nur den
 * letzten guten Snapshot, den der stündliche Cron abgeholt hat
 * (@/lib/iserv/abruf). Ein blockiertes oder gescheitertes IServ liefert damit
 * weiter den alten Stand, statt seine Termine aus Google zu nehmen. Eine
 * Quelle ohne UUID baut ihre `idBase` als Präfix + `sha256(fremdId)` (siehe
 * `iservIdentity()`), Termine mit Uhrzeit stehen als `{ dateTime, timeZone }`
 * in `CalendarEventBody`.
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

/**
 * Was IServ zuletzt geliefert hat und die Klasse betrifft (@/lib/iserv/auswahl).
 *
 * Liest nur die Snapshots — nie IServ selbst. Fehlt der des öffentlichen
 * Kalenders, gab es noch keinen guten Abruf: Dann wirft die Quelle, und die
 * Art `iserv` bleibt in diesem Lauf unberührt, statt leer zu gelten und alles
 * zu löschen.
 *
 * Aus der zuletzt gelesenen Liste der Kalender kommt, ob ISERV_KLASSE
 * womöglich vom letzten Schuljahr ist (`klasseVeraltet()`); dann nimmt der
 * Filter keinen Termin, der die eingestellte Klasse nennt.
 */
export const iservSource: CalendarSource = {
  kind: "iserv",
  async wanted(ctx) {
    const cfg = iservConfig();
    if (!cfg.ok) throw new Error("IServ ist nicht eingerichtet.");

    const [snaps, frei, zustand] = await Promise.all([
      readSnapshots(ctx.userId),
      listAllFreePeriods(ctx.userId),
      readState(ctx.userId),
    ]);

    if (!snaps.has("oeffentlich")) {
      throw new Error(
        "Noch kein Stand aus IServ — der erste Abruf steht aus oder ist gescheitert (Einstellungen → IServ).",
      );
    }

    const { klasse, auch, nie, klassenkalender } = cfg.config;
    const quellen = leseQuellen(zustand?.sourcesJson ?? "[]");

    return iservAuswahl({
      items: [...snaps.values()].flatMap((snap) => snap.items),
      filter: { klasse, auch, nie, klasseUnsicher: klasseVeraltet(quellen, klasse, klassenkalender) },
      freieZeiten: frei,
      iservOrigin: cfg.config.zugang.origin,
      appOrigin: ctx.appOrigin,
    }).wuensche;
  },
};

export const SOURCES: readonly CalendarSource[] = [
  examSource,
  homeworkSource,
  freePeriodSource,
];

/**
 * Die Quellen dieses Laufs: immer die drei aus `SOURCES`, dazu IServ, wenn
 * die Umgebung es einschaltet. Ohne ISERV_* fehlt die Art `iserv` damit in
 * `complete` — ihre Zeilen bleiben unberührt, die Termine bleiben in Google
 * stehen, und es gibt keinen Fehler.
 */
export function activeSources(): readonly CalendarSource[] {
  return iservConfigured() ? [...SOURCES, iservSource] : SOURCES;
}

/**
 * Alle Quellen fragen, jede für sich. Was eine Quelle nicht vollständig
 * liefern konnte — sie hat geworfen, oder ein Schlüssel kam doppelt vor —,
 * fehlt in `complete`, und keiner ihrer Wünsche kommt in `wanted`.
 */
export async function collectWishes(
  ctx: SourceContext,
  sources: readonly CalendarSource[] = activeSources(),
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
