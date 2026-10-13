import { addDays, daysBetween, weekdayIndex } from "@/lib/dates";

/**
 * Der Lernplan.
 *
 * Aus Prüfungsdatum, Vorlauf und Themenliste entstehen Lernblöcke: jedes Thema
 * einmal zum Durcharbeiten, einmal zum Wiederholen. Die Themen werden über den
 * ganzen Zeitraum gestreckt statt vorne zusammengedrängt — zwei Wochen vor der
 * Klausur alles zu lernen und danach nichts mehr bringt nichts.
 *
 * Dazu kommt bei Klausur und Test eine Probeklausur (Antwort 4 vom
 * 13.10.2026): ein Arbeitsblatt im Klausurformat über den ganzen Stoff, ein
 * bis zwei Tage vor dem Termin (`probeTagFuer`). Ihr Tag gehört allein ihr,
 * gelernt und wiederholt wird an den übrigen Tagen.
 *
 * Alles hier ist reine Rechnung: keine Datenbank, keine Systemuhr. "heute"
 * kommt von außen, dieselbe Eingabe ergibt immer dieselbe Ausgabe.
 */

/** learn = erstes Durcharbeiten, review = Wiederholung, probe = Probeklausur */
export type PlanKind = "learn" | "review" | "probe";

/** Eine Probeklausur dauert so lange wie eine Klausur. */
export const PROBE_MINUTEN = 45;

export type PlanTopic = { id: string; title: string };

export type PlannedBlock = {
  date: string;
  topicId: string | null;
  kind: PlanKind;
  minutes: number;
  sortOrder: number;
};

export type PlanWarning = "no-topics" | "no-days" | "tight";

export type Plan = {
  blocks: PlannedBlock[];
  studyDays: string[];
  reviewDays: string[];
  warnings: PlanWarning[];
};

export type PlanInput = {
  /** "YYYY-MM-DD" */
  examDate: string;
  /** "YYYY-MM-DD" */
  today: string;
  topics: PlanTopic[];
  /** Wie viele Tage vor der Prüfung gelernt wird, Standard 10 */
  leadDays: number;
  /** Lernzeit pro Tag in Minuten, Standard 45 */
  minutesPerDay: number;
  /** Tage, an denen nichts geht — Urlaub, Feiertag, anderer Termin */
  excludedDates?: string[];
  /**
   * Minuten, die an einem Tag schon vergeben sind — etwa durch einen bereits
   * erledigten Block. Ohne diese Angabe würde beim Neuverteilen ein zweiter
   * Block auf denselben Tag wandern und das Tagesbudget verdoppeln.
   */
  occupied?: Record<string, number>;
  /** Mit Probeklausur (bei Klausur und Test). Ohne Angabe: keine. */
  probe?: boolean;
};

const FALLBACK_LEAD_DAYS = 10;
const FALLBACK_MINUTES_PER_DAY = 45;
/** Kürzer als eine Viertelstunde lohnt sich kein Aufschlagen des Hefts. */
const MIN_BLOCK_MINUTES = 10;

function sanitizeLeadDays(value: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : FALLBACK_LEAD_DAYS;
}

function sanitizeMinutes(value: number): number {
  return Number.isFinite(value)
    ? Math.max(MIN_BLOCK_MINUTES, Math.floor(value))
    : FALLBACK_MINUTES_PER_DAY;
}

/**
 * Die Lerntage: von spätestens (Prüfung minus Vorlauf) bis zum Tag vor der
 * Prüfung. Was schon vorbei ist, fällt weg — ein Plan beginnt frühestens heute.
 * Der Prüfungstag selbst gehört nie dazu.
 */
export function studyDaysFor(input: {
  examDate: string;
  today: string;
  leadDays: number;
  excludedDates?: string[];
}): string[] {
  const lead = sanitizeLeadDays(input.leadDays);
  const earliest = addDays(input.examDate, -lead);
  const lastDay = addDays(input.examDate, -1);
  const start = daysBetween(earliest, input.today) > 0 ? input.today : earliest;
  const span = daysBetween(start, lastDay);

  if (span < 0) return [];

  const excluded = new Set(input.excludedDates ?? []);
  const days: string[] = [];

  for (let offset = 0; offset <= span; offset += 1) {
    const day = addDays(start, offset);
    if (!excluded.has(day)) days.push(day);
  }

  return days;
}

/**
 * Die letzten Tage gehören der Wiederholung: ab vier Tagen die letzten zwei,
 * bei zwei oder drei Tagen der letzte. Bleibt nur ein Tag, passiert alles an
 * diesem Tag.
 */
function splitDays(days: string[]): {
  learnDays: string[];
  reviewDays: string[];
} {
  if (days.length <= 1) return { learnDays: days, reviewDays: [] };

  const reviewCount = days.length >= 4 ? 2 : 1;
  return {
    learnDays: days.slice(0, days.length - reviewCount),
    reviewDays: days.slice(days.length - reviewCount),
  };
}

/**
 * Der Tag der Probeklausur: mit genug Vorlauf (mindestens vier Lerntage) zwei
 * Tage vor dem Termin, sonst einer. Fällt er auf ein Wochenende oder einen
 * freien Tag, gilt der nächstfrühere Schultag unter den Lerntagen. Nie der
 * Prüfungstag, nie vor heute (beides steckt schon in `studyDays`).
 *
 * Bleibt nur ein Lerntag und ist er ein Schultag (Test morgen), gehört er der
 * Probeklausur: „sonst einen Tag vorher“ gilt auch hier. Null, wenn kein
 * Schultag in Frage kommt.
 */
export function probeTagFuer(examDate: string, studyDays: string[]): string | null {
  if (studyDays.length === 0) return null;
  return probeTagMitAbstand(examDate, studyDays, studyDays.length >= 4 ? 2 : 1);
}

function probeTagMitAbstand(examDate: string, studyDays: string[], abstand: number): string | null {
  const ziel = addDays(examDate, -abstand);
  const schultage = studyDays.filter((day) => weekdayIndex(day) < 5);
  const passend = schultage.filter((day) => day <= ziel);
  if (passend.length > 0) return passend[passend.length - 1];
  // Vor dem Ziel liegt kein Schultag (nur bei zwei Tagen Abstand möglich):
  // dann der Tag davor, wenn er ein Schultag ist.
  const vortag = addDays(examDate, -1);
  return schultage.includes(vortag) ? vortag : null;
}

/**
 * Darf eine Probeklausur, die schon im Plan steht, an ihrem Tag bleiben? Ja,
 * wenn der Tag noch ein Lerntag ist (nicht vorbei, nicht frei, nicht der
 * Prüfungstag) und zur Regel passt, mit zwei oder einem Tag Abstand. Der
 * Abstand gilt ab dem Planen: bleiben beim Nachholen weniger als vier
 * Lerntage, rückt die Probe deshalb nicht auf den Tag vor der Prüfung.
 */
export function probeTagGueltig(examDate: string, studyDays: string[], tag: string): boolean {
  if (!studyDays.includes(tag) || weekdayIndex(tag) >= 5) return false;
  return probeTagMitAbstand(examDate, studyDays, 2) === tag || probeTagMitAbstand(examDate, studyDays, 1) === tag;
}

/**
 * Teilt die Lerntage auf: Probetag, Tage zum Durcharbeiten, Tage zum
 * Wiederholen.
 *
 * Durchgearbeitet wird nur vor der Probeklausur, sonst prüfte sie Stoff, der
 * laut Plan noch gar nicht dran war. Lerntage nach ihr (Klausur am Montag,
 * Probe am Freitag davor, das Wochenende dazwischen) sind Wiederholungstage.
 * Liegt vor der Probe kein Tag zum Durcharbeiten mehr, entfällt sie, außer
 * sie ist der einzige Lerntag überhaupt (siehe `probeTagFuer`).
 *
 * Beim Neuverteilen (`replanOpen`) gilt das Entfallen nur, wenn noch etwas
 * durchzuarbeiten ist: `fest` ist der Tag einer Probe, die schon im Plan
 * steht und bleiben darf, `behalten` heißt, sie bleibt auch ohne Lerntag
 * davor (nichts mehr durchzuarbeiten, oder ihr Tag ist heute). `abstand`
 * legt eine Probe neu, deren Tag nicht mehr gilt, mit dem Abstand, den sie
 * beim Planen bekommen hat.
 */
export function tageAufteilen(
  examDate: string,
  studyDays: string[],
  mitProbe: boolean,
  optionen: { fest?: string | null; abstand?: 1 | 2; behalten?: (probeTag: string) => boolean } = {},
): { probeTag: string | null; learnDays: string[]; reviewDays: string[] } {
  const probeTag = !mitProbe
    ? null
    : (optionen.fest ??
      (optionen.abstand && studyDays.length > 0
        ? probeTagMitAbstand(examDate, studyDays, optionen.abstand)
        : probeTagFuer(examDate, studyDays)));
  if (!probeTag) return { probeTag: null, ...splitDays(studyDays) };

  const rest = studyDays.filter((day) => day !== probeTag);
  if (rest.length === 0) return { probeTag, learnDays: [], reviewDays: [] };

  const { learnDays, reviewDays } = splitDays(rest);
  const vorher = learnDays.filter((day) => day < probeTag);
  const nachher = learnDays.filter((day) => day > probeTag);
  if (vorher.length === 0) {
    if (optionen.fest || optionen.behalten?.(probeTag)) {
      // Die Probe bleibt; was noch durchzuarbeiten ist, kommt danach, zuerst
      // durcharbeiten, dann wiederholen.
      return { probeTag, ...splitDays(rest) };
    }
    return { probeTag: null, ...splitDays(studyDays) };
  }

  return {
    probeTag,
    learnDays: vorher,
    reviewDays: [...nachher, ...reviewDays].sort(),
  };
}

/**
 * Verteilt `count` Dinge gleichmäßig auf `slots` Tage: Ding Nummer `index`
 * landet auf Tag floor(index * slots / count). Dadurch bleibt der Abstand
 * zwischen zwei Themen überall gleich groß.
 */
function slotFor(index: number, count: number, slots: number): number {
  return Math.min(slots - 1, Math.floor((index * slots) / count));
}

/**
 * Die Tagesminuten werden gleichmäßig auf die Blöcke des Tages verteilt, auf
 * volle fünf Minuten abgerundet. Der Tag darf dabei kürzer ausfallen als
 * geplant, aber nie länger.
 *
 * Ausnahme ist der überfüllte Tag: liegen so viele Themen auf einem Tag, dass
 * rechnerisch weniger als zehn Minuten übrig blieben, gewinnt die Untergrenze.
 * Ein Block von fünf Minuten wäre nur eine Zeile im Plan, keine Lernzeit.
 */
function blockMinutes(minutesPerDay: number, blocksOnDay: number): number {
  const share = Math.floor(minutesPerDay / blocksOnDay / 5) * 5;
  return Math.max(MIN_BLOCK_MINUTES, share);
}

type Draft = { topicId: string | null; kind: PlanKind };

/** Sammelt Entwürfe je Tag und bringt sie in die Reihenfolge lernen → wiederholen. */
function collect(entries: { date: string; draft: Draft }[]): Map<string, Draft[]> {
  const byDay = new Map<string, Draft[]>();

  for (const entry of entries) {
    const existing = byDay.get(entry.date);
    if (existing) existing.push(entry.draft);
    else byDay.set(entry.date, [entry.draft]);
  }

  for (const drafts of byDay.values()) {
    drafts.sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
  }

  return byDay;
}

function kindRank(kind: PlanKind): number {
  return kind === "learn" ? 0 : kind === "review" ? 1 : 2;
}

/** Wie viele Minuten an einem Tag noch frei sind. */
function roomLeft(
  day: string,
  minutesPerDay: number,
  occupied: Record<string, number> | undefined,
): number {
  return Math.max(0, minutesPerDay - (occupied?.[day] ?? 0));
}

/** Baut den kompletten Lernplan für eine Prüfung. */
export function buildPlan(input: PlanInput): Plan {
  const minutesPerDay = sanitizeMinutes(input.minutesPerDay);
  const topics = input.topics ?? [];
  const studyDays = studyDaysFor(input);
  const { probeTag, learnDays, reviewDays } = tageAufteilen(
    input.examDate,
    studyDays,
    Boolean(input.probe),
  );

  const warnings: PlanWarning[] = [];
  if (topics.length === 0) warnings.push("no-topics");
  if (studyDays.length === 0) warnings.push("no-days");
  if (topics.length > 0 && studyDays.length > 0 && reviewDays.length === 0 && !probeTag) {
    // Ein einziger Tag: es reicht gerade fürs Durcharbeiten, wiederholt wird nicht mehr.
    warnings.push("tight");
  }

  if (topics.length === 0 || studyDays.length === 0) {
    return { blocks: [], studyDays, reviewDays, warnings };
  }

  const entries: { date: string; draft: Draft }[] = [];

  // Ohne Tag zum Durcharbeiten (der einzige Lerntag gehört der Probeklausur)
  // deckt die Probe den ganzen Stoff ab.
  if (learnDays.length > 0) {
    topics.forEach((topic, index) => {
      const date = learnDays[slotFor(index, topics.length, learnDays.length)];
      entries.push({ date, draft: { topicId: topic.id, kind: "learn" } });
    });
  }

  if (reviewDays.length > 0) {
    topics.forEach((topic, index) => {
      const date = reviewDays[slotFor(index, topics.length, reviewDays.length)];
      entries.push({ date, draft: { topicId: topic.id, kind: "review" } });
    });
  }

  const byDay = collect(entries);
  const blocks: PlannedBlock[] = [];

  for (const day of studyDays) {
    if (day === probeTag) {
      blocks.push({ date: day, topicId: null, kind: "probe", minutes: PROBE_MINUTEN, sortOrder: 0 });
      continue;
    }
    const drafts = byDay.get(day);
    if (!drafts || drafts.length === 0) continue;

    const minutes = blockMinutes(
      Math.max(roomLeft(day, minutesPerDay, input.occupied), MIN_BLOCK_MINUTES),
      drafts.length,
    );
    drafts.forEach((draft, sortOrder) => {
      blocks.push({
        date: day,
        topicId: draft.topicId,
        kind: draft.kind,
        minutes,
        sortOrder,
      });
    });
  }

  return { blocks, studyDays, reviewDays, warnings };
}

/**
 * Verteilt offene Blöcke neu — für den Fall, dass ein Lerntag liegen geblieben
 * ist und der Nutzer nachholen statt streichen will.
 *
 * Verplant werden nur die übergebenen Blöcke; alles Erledigte bleibt, wo es
 * ist. Reicht die Zeit nicht mehr, wird trotzdem alles untergebracht: ein
 * voller Tag ist besser als ein verlorenes Thema.
 */
export function replanOpen(
  input: PlanInput & {
    /** `date`: der bisherige Tag (nur bei der Probeklausur ausgewertet) */
    open: { id: string; topicId: string | null; kind: PlanKind; date?: string | null }[];
  },
): { id: string; date: string; minutes: number; sortOrder: number }[] {
  const open = input.open ?? [];
  if (open.length === 0) return [];

  const minutesPerDay = sanitizeMinutes(input.minutesPerDay);
  const studyDays = studyDaysFor(input);
  const ersteProbe = open.find((block) => block.kind === "probe");
  // Eine Probe, die schon im Plan steht und deren Tag noch gilt, bleibt dort.
  const fest =
    ersteProbe?.date && probeTagGueltig(input.examDate, studyDays, ersteProbe.date)
      ? ersteProbe.date
      : null;
  // Muss sie neu gelegt werden, behält sie ihren Abstand vom Planen (zwei
  // Tage oder einer), statt ihn aus den übrigen Lerntagen neu zu rechnen.
  const abstand = ersteProbe?.date && !fest ? (ersteProbe.date <= addDays(input.examDate, -2) ? 2 : 1) : undefined;
  const lernenOffen = open.some((block) => block.kind === "learn");
  const { probeTag, learnDays, reviewDays } = tageAufteilen(input.examDate, studyDays, Boolean(ersteProbe), {
    fest,
    abstand,
    behalten: (tag) => !lernenOffen || tag === input.today,
  });

  // Tage, an denen schon gelernt wurde, sind ganz oder teilweise verbraucht.
  // Wir weichen zuerst auf Tage mit Platz aus; ist gar keiner mehr frei, wird
  // trotzdem gelegt — ein voller Tag ist besser als ein verlorenes Thema.
  const preferFree = (days: string[]) => {
    const free = days.filter(
      (day) =>
        roomLeft(day, minutesPerDay, input.occupied) >= MIN_BLOCK_MINUTES,
    );
    return free.length > 0 ? free : days;
  };
  const freeLearnDays = preferFree(learnDays);
  const freeReviewDays = preferFree(reviewDays);

  // Wenn nichts mehr übrig ist, bleibt heute — auch wenn die Prüfung schon läuft.
  const lastResort = [input.today];
  const learnTargets =
    freeLearnDays.length > 0
      ? freeLearnDays
      : freeReviewDays.length > 0
        ? freeReviewDays
        : lastResort;
  const reviewTargets =
    freeReviewDays.length > 0
      ? freeReviewDays
      : freeLearnDays.length > 0
        ? [freeLearnDays[freeLearnDays.length - 1]]
        : lastResort;

  const learn = open.filter((block) => block.kind === "learn");
  const review = open.filter((block) => block.kind === "review");
  // Die Probeklausur hat ihren eigenen Tag. Gibt es keinen mehr (kein
  // Schultag vor der Prüfung, oder vor ihr wäre noch durchzuarbeiten), bekommt
  // sie keinen Platz: der Aufrufer streicht sie, statt sie auf den
  // Prüfungstag oder in die Vergangenheit zu legen.
  const probe = open.filter((block) => block.kind === "probe");

  const dateById = new Map<string, string>();
  learn.forEach((block, index) => {
    dateById.set(
      block.id,
      learnTargets[slotFor(index, learn.length, learnTargets.length)],
    );
  });
  review.forEach((block, index) => {
    dateById.set(
      block.id,
      reviewTargets[slotFor(index, review.length, reviewTargets.length)],
    );
  });

  // Lernen vor Wiederholen, sonst in der Reihenfolge der Eingabe.
  const placement = new Map<string, { date: string; sortOrder: number }>();
  const usedPerDay = new Map<string, number>();

  for (const block of [...learn, ...review]) {
    const date = dateById.get(block.id) ?? input.today;
    const sortOrder = usedPerDay.get(date) ?? 0;
    usedPerDay.set(date, sortOrder + 1);
    placement.set(block.id, { date, sortOrder });
  }

  const geplant = open.flatMap((block) => {
    if (block.kind !== "probe") return [block];
    // Nur eine Probeklausur je Prüfung; eine zweite (Altlast) bekommt keinen Platz.
    return probeTag && block === probe[0] ? [block] : [];
  });

  return geplant.map((block) => {
    if (block.kind === "probe") {
      const sortOrder = usedPerDay.get(probeTag!) ?? 0;
      return { id: block.id, date: probeTag!, minutes: PROBE_MINUTEN, sortOrder };
    }
    const place = placement.get(block.id) ?? { date: input.today, sortOrder: 0 };
    return {
      id: block.id,
      date: place.date,
      minutes: blockMinutes(
        Math.max(
          roomLeft(place.date, minutesPerDay, input.occupied),
          MIN_BLOCK_MINUTES,
        ),
        usedPerDay.get(place.date) ?? 1,
      ),
      sortOrder: place.sortOrder,
    };
  });
}

/**
 * Der Name eines Planeintrags (Plan 3.5, Prototyp `planRows`): ein Lernblock
 * heißt nach seinem Thema, sonst „Wiederholung“, „Probeklausur“ oder
 * „Gesamtwiederholung“.
 */
export function planEintragTitel(kind: string, thema: string | null | undefined): string {
  if (kind === "review") return "Wiederholung";
  if (kind === "probe") return "Probeklausur";
  return thema ? thema : "Gesamtwiederholung";
}

/** Die Art eines Planeintrags, wie die Lernblockzeile sie nennt („Nächster Lernblock Do · Probeklausur“). */
export function planEintragArt(kind: string): "Lernblock" | "Wiederholung" | "Probeklausur" {
  if (kind === "review") return "Wiederholung";
  if (kind === "probe") return "Probeklausur";
  return "Lernblock";
}
